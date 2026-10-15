/** git diff と git show。リポジトリの状態から比べる 2 つの Tree を選ぶ。 */
import { diffTrees, type DiffOptions } from './diff'
import {
  GitError,
  getCommit,
  headCommitId,
  headTree,
  refNames,
  resolveRef,
  subject,
  type CommitId,
  type OperationResult,
  type Repo,
} from './model'
import { tagHeader } from './tag'
import { lcsPairs, splitLines, type Tree } from './tree'

export interface GitDiffOptions extends Omit<DiffOptions, 'only'> {
  /** --staged / --cached: ステージを比べる。 */
  readonly staged?: boolean
  /** 比べるコミット (0〜2 個)。 */
  readonly commits?: readonly string[]
}

function treeOf(repo: Repo, ref: string): Tree {
  return getCommit(repo, resolveRef(repo, ref)).tree
}

/**
 * git diff。引数によって比べるものが変わる。
 * - なし: ステージ → 作業ディレクトリ (--staged なら HEAD → ステージ)
 * - コミット 1 つ: そのコミット → 作業ディレクトリ (--staged なら → ステージ)
 * - コミット 2 つ (A B または A..B): A → B
 * 作業ディレクトリと比べるときは、追跡しているファイルだけを比べる。
 */
export function gitDiff(repo: Repo, options: GitDiffOptions = {}): OperationResult {
  const refs = (options.commits ?? []).flatMap((ref) => (ref.includes('..') ? ref.split('..') : [ref]))
  if (refs.length > 2) throw new GitError('使い方: git diff [--staged] [<コミット> [<コミット>]] [-- <ファイル>...]')
  const resolved = refs.map((ref) => treeOf(repo, ref === '' ? 'HEAD' : ref))
  const { paths, nameOnly, stat } = options
  const base: DiffOptions = {
    ...(paths ? { paths } : {}),
    ...(nameOnly ? { nameOnly } : {}),
    ...(stat ? { stat } : {}),
  }

  if (resolved.length === 2) {
    return { repo, output: diffTrees(resolved[0] as Tree, resolved[1] as Tree, base) }
  }
  const conflicted = new Set(repo.conflicts.map((conflict) => conflict.path))
  const from = resolved[0] ?? (options.staged ? headTree(repo) : repo.index)
  const to = options.staged ? repo.index : repo.workdir
  const tracked = new Set([...Object.keys(repo.index), ...Object.keys(from)].filter((path) => !conflicted.has(path)))
  const output = diffTrees(from, to, { ...base, only: tracked })
  const unmerged = [...conflicted].sort().map((path) => `* Unmerged path ${path}`)
  return { repo, output: [...unmerged, output].filter(Boolean).join('\n') }
}

/** git show: コミットの情報と、親からの変更を表示する (マージコミットは差分を省く)。 */
export function show(repo: Repo, ref = 'HEAD', options: Omit<DiffOptions, 'only'> = {}): OperationResult {
  const id = resolveRef(repo, ref)
  const commit = getCommit(repo, id)
  const names = refNames(repo, id)
  const lines = [...tagHeader(repo, ref), `commit ${id}${names.length > 0 ? ` (${names.join(', ')})` : ''}`]
  if (commit.parents.length > 1) lines.push(`Merge: ${commit.parents.join(' ')}`)
  lines.push('', ...commit.message.split('\n').map((line) => (line === '' ? '' : `    ${line}`)))
  const note = repo.notes[id]
  if (note !== undefined) lines.push('', 'Notes:', ...note.split('\n').map((line) => `    ${line}`))
  if (commit.parents.length <= 1) {
    const parentTree = commit.parents[0] === undefined ? {} : getCommit(repo, commit.parents[0]).tree
    const diff = diffTrees(parentTree, commit.tree, options)
    if (diff) lines.push('', diff)
  }
  return { repo, output: lines.join('\n') }
}

/** blame の 1 行: その行を最後に変えたコミット (まだコミットしていなければ null)。 */
export interface BlameLine {
  readonly id: CommitId | null
  readonly text: string
}

/**
 * commit 時点の path の各行を、最後に変えたコミットに割り当てる。
 * 親と同じ行は親にさかのぼって調べ (マージコミットは 1 番目の親を優先)、どの親にもない行はそのコミットのもの。
 */
export function blameCommit(repo: Repo, id: CommitId, path: string): CommitId[] {
  const memo = new Map<CommitId, CommitId[]>()
  const visit = (current: CommitId): CommitId[] => {
    const known = memo.get(current)
    if (known) return known
    const commit = getCommit(repo, current)
    const lines = splitLines(commit.tree[path] ?? '')
    const owners: Array<CommitId | undefined> = lines.map(() => undefined)
    for (const parentId of commit.parents) {
      const parentText = getCommit(repo, parentId).tree[path]
      if (parentText === undefined) continue
      const parentOwners = visit(parentId)
      for (const [i, j] of lcsPairs(splitLines(parentText), lines)) {
        if (owners[j] === undefined) owners[j] = parentOwners[i]
      }
    }
    const result = owners.map((owner) => owner ?? current)
    memo.set(current, result)
    return result
  }
  return visit(id)
}

/** 作業ディレクトリ (rev を指定すればそのコミット) の path を blame する。 */
export function blameFile(repo: Repo, path: string, rev?: string): BlameLine[] {
  if (rev !== undefined) {
    const id = resolveRef(repo, rev)
    const text = getCommit(repo, id).tree[path]
    if (text === undefined) throw new GitError(`fatal: ${id} には '${path}' というファイルはありません`)
    const owners = blameCommit(repo, id, path)
    return splitLines(text).map((line, index) => ({ id: owners[index] as CommitId, text: line }))
  }
  const text = repo.workdir[path]
  const headId = headCommitId(repo)
  const committed = getCommit(repo, headId).tree[path]
  if (text === undefined) throw new GitError(`fatal: '${path}' というファイルはありません`)
  if (committed === undefined) throw new GitError(`fatal: '${path}' はまだコミットされていません`)
  const headOwners = blameCommit(repo, headId, path)
  const lines = splitLines(text)
  const owners: Array<CommitId | null> = lines.map(() => null)
  for (const [i, j] of lcsPairs(splitLines(committed), lines)) owners[j] = headOwners[i] as CommitId
  return lines.map((line, index) => ({ id: owners[index] ?? null, text: line }))
}

/** git blame [-L <開始>,<終了>] <ファイル> [<コミット>]: 各行を最後に変えたコミットと件名を表示する。 */
export function blame(
  repo: Repo,
  path: string,
  options: { readonly rev?: string; readonly range?: readonly [number, number] } = {},
): OperationResult {
  const lines = blameFile(repo, path, options.rev)
  const [start, end] = options.range ?? [1, lines.length]
  if (start < 1 || end < start || start > lines.length) {
    throw new GitError(`fatal: ファイルの行数 (${lines.length} 行) を超えた範囲です`)
  }
  const picked = lines.slice(start - 1, end)
  const label = (line: BlameLine) => {
    if (line.id === null) return ['0000000', 'Not Committed Yet']
    const commit = getCommit(repo, line.id)
    // 親のないコミットは、本物の Git と同じく ^ を付ける
    return [`${commit.parents.length === 0 ? '^' : ''}${line.id}`, subject(commit.message)]
  }
  const labels = picked.map(label)
  const idWidth = Math.max(...labels.map(([id]) => (id as string).length))
  const nameWidth = Math.min(20, Math.max(...labels.map(([, name]) => [...(name as string)].length)))
  const numberWidth = String(end).length
  const output = picked.map((line, index) => {
    const [id, name] = labels[index] as [string, string]
    const chars = [...name]
    const shown = chars.length > nameWidth ? `${chars.slice(0, nameWidth - 1).join('')}…` : name
    const number = String(start + index).padStart(numberWidth)
    return `${id.padEnd(idWidth)} (${shown.padEnd(nameWidth)} ${number}) ${line.text.replace(/\n$/, '')}`
  })
  return { repo, output: output.join('\n') }
}
