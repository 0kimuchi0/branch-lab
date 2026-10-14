/**
 * 作業ディレクトリとステージに表示するファイルの一覧を作る純粋関数。
 * 作業ディレクトリはステージと、ステージは HEAD と比べた状態を付ける。
 */
import { headTree, REMOTE_NAME, type Repo } from '../git/model'
import { changedPaths } from '../git/tree'

export type FileState = 'clean' | 'untracked' | 'added' | 'modified' | 'deleted' | 'conflict'

export interface AreaFile {
  readonly path: string
  readonly state: FileState
  /** ファイルの内容。削除されたファイルは undefined。 */
  readonly content: string | undefined
}

export const FILE_STATE_LABELS: Readonly<Record<FileState, string>> = {
  clean: '',
  untracked: '未追跡',
  added: '新規',
  modified: '変更',
  deleted: '削除',
  conflict: 'コンフリクト',
}

function allPaths(...trees: ReadonlyArray<Readonly<Record<string, string>>>): string[] {
  return [...new Set(trees.flatMap((tree) => Object.keys(tree)))].sort()
}

/** 作業ディレクトリのファイル。ステージとの違いを状態にする。 */
export function workdirFiles(repo: Repo): AreaFile[] {
  const conflicted = new Set(repo.conflicts.map((conflict) => conflict.path))
  const changed = new Set(changedPaths(repo.index, repo.workdir))
  return allPaths(repo.workdir, repo.index).map((path) => {
    const content = repo.workdir[path]
    const state: FileState =
      conflicted.has(path) ? 'conflict'
      : !changed.has(path) ? 'clean'
      : !(path in repo.index) ? 'untracked'
      : content === undefined ? 'deleted'
      : 'modified'
    return { path, state, content }
  })
}

/** ステージのファイル。HEAD (直前のコミット) との違いを状態にする。 */
export function stagedFiles(repo: Repo): AreaFile[] {
  const head = headTree(repo)
  const conflicted = new Set(repo.conflicts.map((conflict) => conflict.path))
  const changed = new Set(changedPaths(head, repo.index))
  return allPaths(repo.index, head).map((path) => {
    const content = repo.index[path]
    const state: FileState =
      conflicted.has(path) ? 'conflict'
      : !changed.has(path) ? 'clean'
      : !(path in head) ? 'added'
      : content === undefined ? 'deleted'
      : 'modified'
    return { path, state, content }
  })
}

/** 画面に並べるリモート名。origin を先頭にして、残りは名前順。 */
export function remoteNames(repo: Repo): string[] {
  return Object.keys(repo.remotes).sort(
    (a, b) => Number(b === REMOTE_NAME) - Number(a === REMOTE_NAME) || a.localeCompare(b),
  )
}
