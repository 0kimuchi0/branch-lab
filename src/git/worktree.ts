/**
 * git worktree と、worktree の間を移動する cd。
 * 各 worktree は HEAD・ステージ・作業ディレクトリ・途中の操作を別々に持ち、コミットやブランチは共有する。
 * パスは ~ (ホーム) からの模擬のパスで、メインの worktree は ~/branch-lab。
 */
import {
  GitError,
  MAIN_WORKTREE,
  createBranch,
  currentWorktreeState,
  enterWorktree,
  getCommit,
  isSubmodulePath,
  requireBranchFree,
  resolveRef,
  subject,
  type CommitId,
  type Head,
  type OperationResult,
  type Repo,
  type WorktreeState,
} from './model'

/** base から見た path を、~ から始まる正規化したパスにする。 */
export function resolvePath(base: string, path: string): string {
  const parts = path === '~' || path.startsWith('~/') ? [] : base.split('/')
  for (const part of (path.startsWith('~') ? path.slice(1) : path).split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length <= 1) throw new GitError(`'${path}' はこのアプリでは扱えないパスです (~ の中を指定してください)`)
      parts.pop()
    } else {
      parts.push(part)
    }
  }
  return ['~', ...parts.filter((part) => part !== '~')].join('/')
}

/** すべての worktree のパス (メインが先頭、残りは名前順)。 */
export function worktreePaths(repo: Repo): string[] {
  const paths = new Set([repo.worktree, ...Object.keys(repo.worktrees)])
  paths.delete(MAIN_WORKTREE)
  return [MAIN_WORKTREE, ...[...paths].sort()]
}

function stateOf(repo: Repo, path: string): WorktreeState {
  return path === repo.worktree ? currentWorktreeState(repo) : (repo.worktrees[path] as WorktreeState)
}

/** 今いる場所のパス (clone したリポジトリやサブモジュールの中なら、その中)。 */
export function currentDirectory(root: Repo): string {
  const clone = root.clone === null ? undefined : root.clones[root.clone]
  if (clone) return currentDirectory(clone)
  return root.submodule === null ? root.worktree : `${root.worktree}/${root.submodule}`
}

/**
 * cd <パス>: 別の worktree や、チェックアウトしたサブモジュールの中に移る (root は一番外側のリポジトリ)。
 * 引数がなければメインの worktree に戻る。
 */
export function changeDirectory(root: Repo, path: string | undefined): OperationResult {
  const target = resolvePath(currentDirectory(root), path ?? MAIN_WORKTREE)
  const outside: Repo = { ...root, submodule: null, clone: null }
  // clone したリポジトリ (とその中のサブモジュール) に入る
  for (const [clonePath, cloned] of Object.entries(root.clones)) {
    if (target !== clonePath && !target.startsWith(`${clonePath}/`)) continue
    const inner = changeDirectory({ ...cloned, submodule: null }, target)
    return { repo: { ...outside, clones: { ...root.clones, [clonePath]: inner.repo }, clone: clonePath }, output: '' }
  }
  const paths = worktreePaths(outside)
  if (paths.includes(target)) return { repo: enterWorktree(outside, target), output: '' }
  const worktree = paths.filter((wt) => target.startsWith(`${wt}/`)).sort((a, b) => b.length - a.length)[0]
  if (worktree !== undefined) {
    const entered = enterWorktree(outside, worktree)
    const sub = target.slice(worktree.length + 1)
    if (sub in entered.submodules) return { repo: { ...entered, submodule: sub }, output: '' }
    if (isSubmodulePath(entered, sub)) {
      throw new GitError(`cd: ${path}: サブモジュールの中身がありません (git submodule update --init で取得します)`)
    }
  }
  throw new GitError(`cd: ${path}: そのようなディレクトリはありません (移動できるのは worktree とサブモジュールだけです)`)
}

export interface WorktreeAddOptions {
  /** -b <名前>: 新しいブランチを作ってチェックアウトする。 */
  readonly newBranch?: string
  readonly detach?: boolean
}

/** git worktree add <パス> [<コミット>]: 新しい worktree を作る (cd はしない)。 */
export function worktreeAdd(
  repo: Repo,
  rawPath: string,
  commitish: string | undefined,
  options: WorktreeAddOptions = {},
): OperationResult {
  const path = resolvePath(repo.worktree, rawPath)
  if (worktreePaths(repo).includes(path) || worktreePaths(repo).some((other) => other.startsWith(`${path}/`))) {
    throw new GitError(`fatal: '${path}' はすでに存在します`)
  }
  let current = repo
  let head: Head
  let preparing: string
  const name = path.split('/').at(-1) as string
  if (options.newBranch !== undefined) {
    current = createBranch(repo, options.newBranch, commitish ?? 'HEAD').repo
    head = { type: 'branch', name: options.newBranch }
    preparing = `Preparing worktree (new branch '${options.newBranch}')`
  } else if (options.detach || (commitish !== undefined && !(commitish in repo.branches))) {
    const id = resolveRef(repo, commitish ?? 'HEAD')
    head = { type: 'detached', id }
    preparing = `Preparing worktree (detached HEAD ${id})`
  } else {
    // ブランチを指定したらそれを、何も指定しなければパスの最後の名前のブランチをチェックアウトする (なければ作る)
    const branch = commitish ?? name
    if (branch in repo.branches) {
      if (repo.head.type === 'branch' && repo.head.name === branch) {
        throw new GitError(`fatal: '${branch}' is already used by worktree at '${repo.worktree}'`)
      }
      requireBranchFree(repo, branch)
      head = { type: 'branch', name: branch }
      preparing = `Preparing worktree (checking out '${branch}')`
    } else {
      current = createBranch(repo, branch, 'HEAD').repo
      head = { type: 'branch', name: branch }
      preparing = `Preparing worktree (new branch '${branch}')`
    }
  }
  const id = head.type === 'branch' ? (current.branches[head.name] as CommitId) : head.id
  const tree = getCommit(current, id).tree
  const state: WorktreeState = {
    head,
    index: tree,
    workdir: tree,
    conflicts: [],
    operation: null,
    editor: null,
    bisect: null,
    headReflog: [{ id, message: `worktree add: ${path}` }],
    rererePending: {},
    // サブモジュールは、新しい worktree では git submodule update --init するまで空のまま
    submodules: {},
    sparse: null,
  }
  return {
    repo: { ...current, worktrees: { ...current.worktrees, [path]: state } },
    output: `${preparing}\nHEAD is now at ${id} ${subject(getCommit(current, id).message)}`,
  }
}

/** git worktree list */
export function worktreeList(repo: Repo): OperationResult {
  const paths = worktreePaths(repo)
  const width = Math.max(...paths.map((path) => path.length))
  const lines = paths.map((path) => {
    const { head } = stateOf(repo, path)
    const id = head.type === 'branch' ? (repo.branches[head.name] as CommitId) : head.id
    const where = head.type === 'branch' ? `[${head.name}]` : '(detached HEAD)'
    return `${path.padEnd(width)} ${id} ${where}`
  })
  return { repo, output: lines.join('\n') }
}

/** git worktree remove [-f] <パス> */
export function worktreeRemove(repo: Repo, rawPath: string, force = false): OperationResult {
  const path = resolvePath(repo.worktree, rawPath)
  if (path === MAIN_WORKTREE) throw new GitError(`fatal: '${path}' is a main working tree`)
  if (path === repo.worktree) {
    throw new GitError('fatal: 今いる worktree は削除できません (cd で別の worktree に移動してください)')
  }
  const state = repo.worktrees[path]
  if (state === undefined) throw new GitError(`fatal: '${rawPath}' は worktree ではありません`)
  const id = state.head.type === 'branch' ? (repo.branches[state.head.name] as CommitId) : state.head.id
  if (!force && hasLocalChanges(repo, state, id)) {
    throw new GitError(`fatal: '${path}' contains modified or untracked files, use --force to delete it`)
  }
  const worktrees = { ...repo.worktrees }
  delete worktrees[path]
  return { repo: { ...repo, worktrees }, output: '' }
}

/** HEAD から変えたファイル・追跡していないファイル・途中の操作があるか。 */
function hasLocalChanges(repo: Repo, state: WorktreeState, id: CommitId): boolean {
  const tree = getCommit(repo, id).tree
  const same = (a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>) =>
    Object.keys({ ...a, ...b }).every((file) => a[file] === b[file])
  return !same(tree, state.index) || !same(state.index, state.workdir) || state.operation !== null
}

/** worktree prune: 模擬のファイルシステムでは消えた worktree が出ないので、何もしない。 */
export function worktreePrune(repo: Repo): OperationResult {
  return { repo, output: '' }
}

