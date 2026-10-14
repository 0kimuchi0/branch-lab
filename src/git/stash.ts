/**
 * git stash。コミットしていない変更をスタックに退避し、あとで戻す。
 * 本物の Git は退避した内容を特別なコミットとして保存するが、ここでは Repo.stash に持ち、グラフには描かない。
 */
import { diffTrees } from './diff'
import {
  GitError,
  carryChanges,
  createBranch,
  currentBranch,
  dirtyPaths,
  getCommit,
  headCommitId,
  headTree,
  logRefs,
  requireNoConflicts,
  requireNoEditor,
  status,
  subject,
  type OperationResult,
  type Repo,
  type StashEntry,
} from './model'
import { changedPaths, mergeTrees, treesEqual, withFile, type Tree } from './tree'

export function stashRef(index: number): string {
  return `stash@{${index}}`
}

/** stash@{n} または n を、スタックの位置に変換する。 */
export function resolveStash(repo: Repo, ref = 'stash@{0}'): number {
  const match = /^(?:stash@\{(\d+)\}|(\d+))$/.exec(ref)
  const index = match ? Number(match[1] ?? match[2]) : Number.NaN
  if (Number.isNaN(index)) throw new GitError(`error: '${ref}' は stash の指定として使えません`)
  if (index >= repo.stash.length) {
    throw new GitError(repo.stash.length === 0 ? 'No stash entries found.' : `error: ${ref} は存在しません`)
  }
  return index
}

function pick(tree: Tree, paths: Iterable<string>): Tree {
  let result: Tree = {}
  for (const path of paths) result = withFile(result, path, tree[path])
  return result
}

export interface StashPushOptions {
  readonly message?: string
  /** -u: 追跡していないファイルも退避する。 */
  readonly includeUntracked?: boolean
  /** -k: ステージした変更は残す。 */
  readonly keepIndex?: boolean
}

/** git stash / git stash push: 変更を退避して、作業ディレクトリとステージを HEAD に戻す。 */
export function stashPush(repo: Repo, options: StashPushOptions = {}): OperationResult {
  requireNoEditor(repo)
  requireNoConflicts(repo)
  const head = headTree(repo)
  const headId = headCommitId(repo)
  const tracked = new Set([...Object.keys(head), ...Object.keys(repo.index)])
  const untrackedPaths = Object.keys(repo.workdir).filter((path) => !tracked.has(path))
  const workdir = pick(repo.workdir, tracked)
  const untracked = options.includeUntracked ? pick(repo.workdir, untrackedPaths) : {}

  if (treesEqual(head, repo.index) && treesEqual(repo.index, workdir) && Object.keys(untracked).length === 0) {
    throw new GitError('No local changes to save')
  }
  const branch = currentBranch(repo) ?? '(no branch)'
  const description = options.message?.trim()
    ? `On ${branch}: ${options.message.trim()}`
    : `WIP on ${branch}: ${headId} ${subject(getCommit(repo, headId).message)}`
  const entry: StashEntry = { base: headId, message: description, index: repo.index, workdir, untracked }

  const nextIndex = options.keepIndex ? repo.index : head
  let nextWorkdir: Tree = nextIndex
  if (!options.includeUntracked) {
    for (const path of untrackedPaths) nextWorkdir = withFile(nextWorkdir, path, repo.workdir[path])
  }
  return {
    repo: { ...repo, index: nextIndex, workdir: nextWorkdir, stash: [entry, ...repo.stash] },
    output: `Saved working directory and index state ${description}`,
  }
}

export function stashList(repo: Repo): OperationResult {
  return {
    repo,
    output: repo.stash.map((entry, index) => `${stashRef(index)}: ${entry.message}`).join('\n'),
  }
}

/** git stash show: 退避した変更を、退避したときの HEAD と比べて表示する (既定は --stat)。 */
export function stashShow(repo: Repo, ref?: string, options: { readonly patch?: boolean } = {}): OperationResult {
  const entry = repo.stash[resolveStash(repo, ref)] as StashEntry
  const base = getCommit(repo, entry.base).tree
  return { repo, output: diffTrees(base, entry.workdir, options.patch ? {} : { stat: true }) }
}

export function stashDrop(repo: Repo, ref?: string): OperationResult {
  requireNoEditor(repo)
  const index = resolveStash(repo, ref)
  return {
    repo: { ...repo, stash: repo.stash.filter((_, i) => i !== index) },
    output: `Dropped ${stashRef(index)}`,
  }
}

export function stashClear(repo: Repo): OperationResult {
  requireNoEditor(repo)
  return { repo: { ...repo, stash: [] }, output: '' }
}

/**
 * git stash apply: 退避した変更を、今の HEAD に 3-way マージで戻す。
 * --index ならステージの状態も戻す。コンフリクトしたら、マーカーを入れて止まる (stash は残る)。
 */
export function stashApply(
  repo: Repo,
  ref?: string,
  options: { readonly index?: boolean } = {},
): OperationResult & { readonly conflicted: boolean } {
  requireNoEditor(repo)
  requireNoConflicts(repo)
  const position = resolveStash(repo, ref)
  const entry = repo.stash[position] as StashEntry
  const base = getCommit(repo, entry.base).tree
  const head = headTree(repo)

  const clobbered = Object.keys(entry.untracked).filter((path) => path in repo.workdir)
  if (clobbered.length > 0) {
    throw new GitError(clobbered.map((path) => `${path} already exists, no checkout`).join('\n') + '\nerror: 退避した追跡していないファイルを戻せませんでした')
  }

  const merged = mergeTrees(base, head, entry.workdir, { ours: 'Updated upstream', theirs: 'Stashed changes' })
  // 退避した変更が、コミットしていない変更を上書きするなら中止する
  const dirty = new Set(dirtyPaths(repo))
  const overwritten = changedPaths(head, merged.tree).filter((path) => dirty.has(path))
  if (overwritten.length > 0) {
    throw new GitError(
      [
        'error: 次のファイルのローカルの変更はマージによって上書きされます:',
        ...overwritten.map((path) => `\t${path}`),
        '変更をコミットするか stash してから、もう一度実行してください。',
      ].join('\n'),
    )
  }
  const carried = carryChanges(repo, merged.tree, 'stash apply')
  let workdir = carried.workdir
  for (const [path, content] of Object.entries(entry.untracked)) workdir = withFile(workdir, path, content)

  let index = repo.index
  if (options.index && merged.conflicts.length === 0) {
    const indexMerge = mergeTrees(base, repo.index, entry.index, { ours: 'Updated upstream', theirs: 'Stashed changes' })
    if (indexMerge.conflicts.length > 0) {
      throw new GitError('Conflicts in index. Try without --index.')
    }
    index = indexMerge.tree
  } else {
    // 退避したときに新しく追加していたファイルは、追跡が外れないようにステージに戻す
    for (const path of Object.keys(entry.index)) {
      if (!(path in base) && path in merged.tree) index = withFile(index, path, merged.tree[path])
    }
  }
  for (const conflict of merged.conflicts) index = withFile(index, conflict.path, head[conflict.path])

  const next: Repo = { ...repo, index, workdir, conflicts: merged.conflicts }
  const lines =
    merged.conflicts.length > 0
      ? merged.conflicts.map((conflict) => `CONFLICT (content): ${conflict.path} でマージのコンフリクトが発生しました`)
      : [status(next).output]
  return { repo: next, output: lines.join('\n'), conflicted: merged.conflicts.length > 0 }
}

/** git stash pop: apply して、コンフリクトがなければその stash を消す。 */
export function stashPop(repo: Repo, ref?: string, options: { readonly index?: boolean } = {}): OperationResult {
  const position = resolveStash(repo, ref)
  const applied = stashApply(repo, stashRef(position), options)
  if (applied.conflicted) {
    return { repo: applied.repo, output: `${applied.output}\nThe stash entry is kept in case you need it again.` }
  }
  const dropped = stashDrop(applied.repo, stashRef(position))
  return { repo: dropped.repo, output: `${applied.output}\n${dropped.output}` }
}

/** git stash branch: 退避したときの HEAD から新しいブランチを作り、そこに stash を pop する。 */
export function stashBranch(repo: Repo, name: string, ref?: string): OperationResult {
  requireNoEditor(repo)
  const position = resolveStash(repo, ref)
  const entry = repo.stash[position] as StashEntry
  const created = createBranch(repo, name, entry.base).repo
  const tree = getCommit(repo, entry.base).tree
  const moved = carryChanges(created, tree, 'stash branch')
  const switched: Repo = logRefs(
    created,
    { ...created, head: { type: 'branch', name }, ...moved },
    `checkout: moving from ${currentBranch(created) ?? headCommitId(created)} to ${name}`,
    { forceHead: true },
  )
  const popped = stashPop(switched, stashRef(position), { index: true })
  return { repo: popped.repo, output: `新しいブランチ '${name}' に切り替えました\n${popped.output}` }
}
