/**
 * git filter-branch。指定した範囲のコミットを古いものから順に、フィルタ (このアプリのコマンド) を通して作り直し、
 * ブランチを付け替える。元の位置は refs/original/ に残す。
 * 置き換え (git replace) は反映して読むので、--graft で付け替えた親は書き換えたあとの履歴に残る (本物と同じ)。
 */
import {
  GitError,
  ancestors,
  allRefs,
  fullRefTarget,
  getCommit,
  logRefs,
  requireNoOperation,
  resolveRef,
  storeCommit,
  workspaceStatus,
  type Commit,
  type CommitId,
  type OperationResult,
  type Repo,
} from './model'
import { setRef } from './refs'
import { withReplacements } from './replace'
import { treesEqual, type Tree } from './tree'

/** フィルタのコマンドを実行する (stdin を渡すと、cat・sed・grep の入力になる)。 */
export type FilterRunner = (
  repo: Repo,
  command: string,
  stdin?: string,
) => { readonly repo: Repo; readonly output: string; readonly ok: boolean }

export interface FilterBranchOptions {
  readonly treeFilter?: string
  readonly indexFilter?: string
  readonly msgFilter?: string
  readonly parentFilter?: string
  readonly tagNameFilter?: string
  readonly subdirectoryFilter?: string
  readonly pruneEmpty?: boolean
  readonly force?: boolean
  /** --original <名前空間>: 元の参照を残す場所 (既定は refs/original/)。 */
  readonly original?: string
  /** FILTER_BRANCH_SQUELCH_WARNING=1: 最初の警告を出さない。 */
  readonly squelchWarning?: boolean
}

const WARNING = [
  'WARNING: git-filter-branch には、履歴を壊しやすい落とし穴がたくさんあります。',
  "\t 本物の Git では、代わりに 'git filter-repo' (https://github.com/newren/git-filter-repo/)",
  '\t を使うことが勧められています。この警告は FILTER_BRANCH_SQUELCH_WARNING=1 で消せます。',
  'Proceeding with filter-branch...',
  '',
]

/** 書き換える参照 (refs/ から始まる名前、detached HEAD なら HEAD)。 */
function refsToRewrite(repo: Repo, positives: readonly string[], kinds: ReadonlySet<string>, lines: string[]): string[] {
  const names = new Set<string>()
  const refs = allRefs(repo)
  if (kinds.has('--all') || kinds.has('--branches')) for (const [name] of refs) if (name.startsWith('refs/heads/')) names.add(name)
  if (kinds.has('--all') || kinds.has('--remotes')) for (const [name] of refs) if (name.startsWith('refs/remotes/')) names.add(name)
  if (kinds.has('--all') || kinds.has('--tags')) for (const [name] of refs) if (name.startsWith('refs/tags/')) names.add(name)
  for (const positive of positives) {
    if (positive === 'HEAD' || positive === '@') {
      names.add(repo.head.type === 'branch' ? `refs/heads/${repo.head.name}` : 'HEAD')
    } else if (positive.startsWith('refs/') && fullRefTarget(repo, positive) !== undefined) names.add(positive)
    else if (positive in repo.tags) names.add(`refs/tags/${positive}`)
    else if (positive in repo.branches) names.add(`refs/heads/${positive}`)
    else if (positive in repo.remoteBranches) names.add(`refs/remotes/${positive}`)
    else if (positive in repo.commits) lines.push(`WARNING: not rewriting '${positive}' (not a ref)`)
    else throw new GitError(`fatal: ambiguous argument '${positive}': unknown revision or path not in the working tree.`)
  }
  return [...names].sort()
}

function refTarget(repo: Repo, name: string): CommitId | undefined {
  if (name === 'HEAD') return repo.head.type === 'detached' ? repo.head.id : undefined
  return fullRefTarget(repo, name)
}

/** commits の中で、親が先になる順 (同じ深さなら番号の順)。 */
function topoOrder(commits: Readonly<Record<CommitId, Commit>>, ids: ReadonlySet<CommitId>): CommitId[] {
  const order: CommitId[] = []
  const done = new Set<CommitId>()
  const visit = (id: CommitId) => {
    if (done.has(id) || !ids.has(id)) return
    done.add(id)
    for (const parent of commits[id]?.parents ?? []) visit(parent)
    order.push(id)
  }
  for (const id of [...ids].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))) visit(id)
  return order
}

/** dir の下のファイルだけを、dir を取り除いたパスにした tree。 */
function subtree(tree: Tree, dir: string): Tree {
  const prefix = `${dir.replace(/\/+$/, '')}/`
  return Object.fromEntries(Object.entries(tree).filter(([path]) => path.startsWith(prefix)).map(([path, content]) => [path.slice(prefix.length), content]))
}

/** フィルタの中の $GIT_COMMIT を、書き換えているコミットの ID にする。 */
function expand(command: string, id: CommitId): string {
  return command.replace(/\$\{GIT_COMMIT\}|\$GIT_COMMIT\b/g, id)
}

/** git filter-branch [<オプション>] [--] [<リビジョン>...] */
export function filterBranch(raw: Repo, args: readonly string[], options: FilterBranchOptions, run: FilterRunner): OperationResult {
  requireNoOperation(raw)
  const status = workspaceStatus(raw)
  if (status.unstaged.length > 0 || status.staged.length > 0) {
    const reasons =
      status.unstaged.length > 0
        ? ['Cannot rewrite branches: You have unstaged changes.', ...(status.staged.length > 0 ? ['Additionally, your index contains uncommitted changes.'] : [])]
        : ['Cannot rewrite branches: Your index contains uncommitted changes.']
    throw new GitError(reasons.join('\n'))
  }
  const namespace = `${(options.original ?? 'refs/original').replace(/\/+$/, '')}/`
  if (!options.force && Object.keys(raw.originalRefs).some((name) => name.startsWith(namespace))) {
    throw new GitError(`Cannot create a new backup.\nA previous backup already exists in ${namespace}\nForce overwriting the backup with -f`)
  }
  const lines: string[] = options.squelchWarning ? [] : [...WARNING]

  // 範囲の指定: A..B は A を除いて B、^A は A を除く。--all などは参照の種類
  const positives: string[] = []
  const negatives: string[] = []
  const kinds = new Set<string>()
  for (const arg of args) {
    if (['--all', '--branches', '--tags', '--remotes'].includes(arg)) kinds.add(arg)
    else if (arg.startsWith('-')) throw new GitError(`fatal: このアプリの filter-branch では、リビジョンのオプション ${arg} は未対応です`)
    else if (arg.includes('..')) {
      const [from, to] = arg.split(/\.{2,3}/) as [string, string]
      negatives.push(from === '' ? 'HEAD' : from)
      positives.push(to === '' ? 'HEAD' : to)
    } else if (arg.startsWith('^')) negatives.push(arg.slice(1))
    else positives.push(arg)
  }
  if (positives.length === 0 && kinds.size === 0) positives.push('HEAD')
  const refs = refsToRewrite(raw, positives, kinds, lines)
  if (refs.length === 0) throw new GitError([...lines, 'You must specify a ref to rewrite.'].join('\n'))

  const view = withReplacements(raw)
  const included = new Set<CommitId>()
  for (const ref of refs) {
    const tip = refTarget(raw, ref)
    if (tip !== undefined) for (const id of ancestors(view.commits, tip)) if (id in view.commits) included.add(id)
  }
  for (const negative of negatives) {
    for (const id of ancestors(view.commits, resolveRef(raw, negative))) included.delete(id)
  }
  const order = topoOrder(view.commits, included)
  if (order.length === 0) throw new GitError([...lines, 'Found nothing to rewrite'].join('\n'))

  let current = raw
  /** 書き換えたコミット → 書き換えたあとのコミット (取り除いたら、代わりになる親。空ならなくなった)。 */
  const mapped = new Map<CommitId, readonly CommitId[]>()
  const mapParent = (id: CommitId): readonly CommitId[] => mapped.get(id) ?? [id]
  const treeOf = (id: CommitId): Tree => (current.commits[id] ?? view.commits[id] ?? getCommit(raw, id)).tree
  const dir = options.subdirectoryFilter

  for (const [index, id] of order.entries()) {
    const commit = view.commits[id] as Commit
    const progress = `Rewrite ${id} (${index + 1}/${order.length}) (0 seconds passed, remaining 0 predicted)`
    const fail = (message: string): never => {
      throw new GitError([...lines, progress, message].join('\n'))
    }
    // --subdirectory-filter: そのディレクトリを変えていないコミットは飛ばす
    if (dir !== undefined) {
      const own = subtree(commit.tree, dir)
      const same = commit.parents.find((parent) => treesEqual(subtree(view.commits[parent]?.tree ?? {}, dir), own))
      if (same !== undefined || (commit.parents.length === 0 && Object.keys(own).length === 0)) {
        mapped.set(id, same === undefined ? [] : mapParent(same))
        continue
      }
    }
    let parents = [...new Set(commit.parents.flatMap(mapParent))]
    let tree: Tree = dir === undefined ? commit.tree : subtree(commit.tree, dir)
    const scratch = (files: Tree): Repo => ({
      ...current,
      head: { type: 'detached', id },
      index: files,
      workdir: files,
      operation: null,
      conflicts: [],
      editor: null,
      sparse: null,
    })
    if (options.treeFilter !== undefined) {
      const ran = run(scratch(tree), expand(options.treeFilter, id))
      if (!ran.ok) fail([ran.output, `tree filter failed: ${options.treeFilter}`].filter(Boolean).join('\n'))
      tree = ran.repo.workdir
    }
    if (options.indexFilter !== undefined) {
      const ran = run(scratch(tree), expand(options.indexFilter, id))
      if (!ran.ok) fail([ran.output, `index filter failed: ${options.indexFilter}`].filter(Boolean).join('\n'))
      tree = ran.repo.index
    }
    if (options.parentFilter !== undefined) {
      const ran = run(current, expand(options.parentFilter, id), parents.map((parent) => `-p ${parent}`).join(' '))
      if (!ran.ok) fail([ran.output, `parent filter failed: ${options.parentFilter}`].filter(Boolean).join('\n'))
      const words = ran.output.split(/\s+/).filter(Boolean)
      parents = []
      for (let i = 0; i < words.length; i++) {
        if (words[i] !== '-p' || words[i + 1] === undefined) continue
        const parent = words[++i] as string
        if (!(parent in current.commits)) fail(`fatal: not a valid object name ${parent}`)
        parents.push(parent)
      }
    }
    let message = commit.message
    if (options.msgFilter !== undefined) {
      const ran = run(current, expand(options.msgFilter, id), `${commit.message}\n`)
      if (!ran.ok) fail([ran.output, `msg filter failed: ${options.msgFilter}`].filter(Boolean).join('\n'))
      message = ran.output.replace(/\n+$/, '')
    }
    // --prune-empty: 親が 1 つで親と同じ tree、または親がなく空の tree なら、コミットを作らない
    if (options.pruneEmpty && parents.length <= 1) {
      const parentTree = parents.length === 1 ? treeOf(parents[0] as CommitId) : {}
      if (treesEqual(parentTree, tree)) {
        mapped.set(id, parents)
        continue
      }
    }
    // 内容が元のコミット (置き換える前) と同じなら、同じコミットのまま (本物でもハッシュが同じになる)
    const original = raw.commits[id] as Commit
    const sameAsOriginal =
      treesEqual(original.tree, tree) &&
      original.message === message &&
      original.parents.length === parents.length &&
      original.parents.every((parent, i) => parent === parents[i])
    if (sameAsOriginal) {
      mapped.set(id, [id])
      continue
    }
    const stored = storeCommit(current, {
      parents,
      message,
      tree,
      source: commit.source ?? id,
      ...(commit.reverts === undefined ? {} : { reverts: commit.reverts }),
    })
    current = stored.repo
    mapped.set(id, [stored.id])
  }
  lines.push(`Rewrite ${order.at(-1) as CommitId} (${order.length}/${order.length}) (0 seconds passed, remaining 0 predicted)`)

  // 参照を付け替え、元の位置を <名前空間><参照> に残す
  const before = current
  let updated = current
  const originalRefs = { ...current.originalRefs }
  for (const ref of refs) {
    const old = refTarget(raw, ref)
    if (old === undefined) continue
    const next = included.has(old) ? mapParent(old) : [old]
    if (next.length === 1 && next[0] === old) {
      lines.push(`WARNING: Ref '${ref}' is unchanged`)
      continue
    }
    const target = next[0]
    if (ref.startsWith('refs/tags/') && raw.tags[ref.slice('refs/tags/'.length)]?.message !== undefined) {
      lines.push(`Ref '${ref}' was rewritten`)
      if (options.tagNameFilter === undefined) {
        lines.push(
          'WARNING: You said to rewrite tagged commits, but not the corresponding tag.',
          "WARNING: Perhaps use '--tag-name-filter cat' to rewrite the tag.",
        )
      }
      // 注釈付きタグは参照としては書き換えられないが、元の位置は残す (本物と同じ)
      originalRefs[`${namespace}${ref}`] = old
      continue
    }
    lines.push(target === undefined ? `Ref '${ref}' was deleted` : `Ref '${ref}' was rewritten`)
    updated = setRef(updated, ref, target)
    originalRefs[`${namespace}${ref}`] = old
  }
  updated = logRefs(before, { ...updated, originalRefs }, 'filter-branch: rewrite')

  // --tag-name-filter: 書き換えたコミットを指すタグを、フィルタが出した名前で付け直す
  if (options.tagNameFilter !== undefined) {
    for (const name of Object.keys(raw.tags).sort()) {
      const tag = raw.tags[name] as NonNullable<Repo['tags'][string]>
      if (!included.has(tag.target)) continue
      const next = mapParent(tag.target)[0]
      if (next === undefined || next === tag.target) continue
      const ran = run(updated, options.tagNameFilter, `${name}\n`)
      if (!ran.ok) throw new GitError([...lines, `tag name filter failed: ${options.tagNameFilter}`].join('\n'))
      const newName = ran.output.trim()
      if (newName === '') continue
      lines.push(`${name} -> ${newName} (${tag.target} -> ${next})`)
      updated = { ...updated, tags: { ...updated.tags, [newName]: { ...tag, target: next } } }
    }
  }

  // 今のブランチを書き換えたら、ステージと作業ディレクトリを新しい HEAD に合わせる (git read-tree -u -m HEAD)
  const headBefore = raw.head.type === 'branch' ? raw.branches[raw.head.name] : raw.head.id
  const headAfter = updated.head.type === 'branch' ? updated.branches[updated.head.name] : updated.head.id
  if (headAfter !== headBefore) {
    const tree = headAfter === undefined ? {} : (updated.commits[headAfter] as Commit).tree
    const untracked = Object.fromEntries(Object.entries(raw.workdir).filter(([path]) => !(path in raw.index)))
    updated = { ...updated, index: tree, workdir: { ...untracked, ...tree } }
  }
  return { repo: updated, output: lines.join('\n') }
}
