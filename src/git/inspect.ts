/** git diff と git show。リポジトリの状態から比べる 2 つの Tree を選ぶ。 */
import { diffTrees, type DiffOptions } from './diff'
import {
  GitError,
  getCommit,
  headTree,
  refNames,
  resolveRef,
  type OperationResult,
  type Repo,
} from './model'
import type { Tree } from './tree'

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
  const lines = [`commit ${id}${names.length > 0 ? ` (${names.join(', ')})` : ''}`]
  if (commit.parents.length > 1) lines.push(`Merge: ${commit.parents.join(' ')}`)
  lines.push('', ...commit.message.split('\n').map((line) => (line === '' ? '' : `    ${line}`)))
  if (commit.parents.length <= 1) {
    const parentTree = commit.parents[0] === undefined ? {} : getCommit(repo, commit.parents[0]).tree
    const diff = diffTrees(parentTree, commit.tree, options)
    if (diff) lines.push('', diff)
  }
  return { repo, output: lines.join('\n') }
}
