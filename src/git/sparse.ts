/**
 * git sparse-checkout (cone モード)。作業ディレクトリに出すディレクトリを絞る。
 * ステージとコミットにはすべてのファイルが残り、外のファイルは作業ディレクトリに出ない (ls・cat・画面に出ない)。
 */
import { GitError, type OperationResult, type Repo } from './model'

function normalize(dirs: readonly string[]): string[] {
  const result: string[] = []
  for (const raw of dirs) {
    const dir = raw.replace(/^\.\//, '').replace(/\/+$/, '')
    if (dir === '' || dir === '.') continue
    if (dir.includes('*') || dir.startsWith('!')) {
      throw new GitError(`fatal: '${raw}' は cone モードでは使えません (ディレクトリを指定してください)`)
    }
    if (!result.includes(dir)) result.push(dir)
  }
  return result.sort()
}

/** git sparse-checkout init: ルートのファイルだけを出す。 */
export function sparseInit(repo: Repo): OperationResult {
  return { repo: { ...repo, sparse: repo.sparse ?? [] }, output: '' }
}

/** git sparse-checkout set <ディレクトリ>... */
export function sparseSet(repo: Repo, dirs: readonly string[]): OperationResult {
  return { repo: { ...repo, sparse: normalize(dirs) }, output: '' }
}

/** git sparse-checkout add <ディレクトリ>... */
export function sparseAdd(repo: Repo, dirs: readonly string[]): OperationResult {
  if (repo.sparse === null) throw new GitError('fatal: no sparse-checkout to add to')
  return { repo: { ...repo, sparse: normalize([...repo.sparse, ...dirs]) }, output: '' }
}

/** git sparse-checkout list */
export function sparseList(repo: Repo): OperationResult {
  if (repo.sparse === null) throw new GitError('fatal: this worktree is not sparse')
  return { repo, output: repo.sparse.join('\n') }
}

/** git sparse-checkout disable: すべてのファイルを出す。 */
export function sparseDisable(repo: Repo): OperationResult {
  return { repo: { ...repo, sparse: null }, output: '' }
}
