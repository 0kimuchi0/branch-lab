/**
 * 作業ディレクトリとステージに表示するファイルの一覧を作る純粋関数。
 * 作業ディレクトリはステージと、ステージは HEAD と比べた状態を付ける。
 */
import { MAIN_WORKTREE, headTree, isSparseHidden, REMOTE_NAME, type Repo } from '../git/model'
import { changedPaths, displayContent } from '../git/tree'

/** 画面に出すファイルの内容 (サブモジュールは Subproject commit、バンドルは見出しとコミットの数)。 */
function fileContent(content: string): string {
  if (!content.startsWith('# v2 git bundle\n')) return displayContent(content)
  const [header = ''] = content.split('\nPACK ')
  const count = (content.match(/"parents":/g) ?? []).length
  return `${header.replace(/\n+$/, '')}\n(バンドルの中身: コミット ${count} 個)\n`
}

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
  // sparse-checkout で作業ディレクトリに出していないファイルは並べない
  return allPaths(repo.workdir, repo.index).filter((path) => !isSparseHidden(repo, path)).map((path) => {
    const content = repo.workdir[path]
    const state: FileState =
      conflicted.has(path) ? 'conflict'
      : !changed.has(path) ? 'clean'
      : !(path in repo.index) ? 'untracked'
      : content === undefined ? 'deleted'
      : 'modified'
    return { path, state, content: content === undefined ? undefined : fileContent(content) }
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
    return { path, state, content: content === undefined ? undefined : fileContent(content) }
  })
}

/** 画面に並べるリモート名。origin を先頭にして、残りは名前順。 */
export function remoteNames(repo: Repo): string[] {
  return Object.keys(repo.remotes).sort(
    (a, b) => Number(b === REMOTE_NAME) - Number(a === REMOTE_NAME) || a.localeCompare(b),
  )
}

export interface WorktreeRow {
  readonly path: string
  /** チェックアウトしているブランチ名、または detached HEAD のコミット ID。 */
  readonly checkedOut: string
  readonly current: boolean
}

/** worktree の一覧 (メインが先頭)。git worktree add をしていなければ 1 行だけ。 */
export function worktreeRows(repo: Repo): WorktreeRow[] {
  const states = { ...repo.worktrees, [repo.worktree]: { head: repo.head } }
  const main = repo.home ?? MAIN_WORKTREE
  const paths = Object.keys(states).sort((a, b) => Number(b === main) - Number(a === main) || a.localeCompare(b))
  return paths.map((path) => {
    const head = (states[path] as { head: Repo['head'] }).head
    return {
      path,
      checkedOut: head.type === 'branch' ? head.name : `${head.id} (detached HEAD)`,
      current: path === repo.worktree,
    }
  })
}

export interface HookRow {
  readonly name: string
  readonly executable: boolean
}

/** .git/hooks に置いたフック。 */
export function hookRows(repo: Repo): HookRow[] {
  return Object.entries(repo.gitFiles)
    .filter(([path]) => path.startsWith('hooks/'))
    .map(([path, file]) => ({ name: path.slice('hooks/'.length), executable: file.executable }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
