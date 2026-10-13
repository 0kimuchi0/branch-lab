/**
 * Git の内部モデル (コミットの DAG・ブランチ・HEAD)。
 * UI には一切依存せず、すべての操作は新しい Repo を返す純粋関数として実装する。
 */

export type CommitId = string

export interface Commit {
  readonly id: CommitId
  /** 親コミット。通常のコミットは 1 つ、マージコミットは 2 つ、ルートは 0 個。 */
  readonly parents: readonly CommitId[]
  readonly message: string
}

export type Head =
  | { readonly type: 'branch'; readonly name: string }
  | { readonly type: 'detached'; readonly id: CommitId }

export interface Repo {
  readonly commits: Readonly<Record<CommitId, Commit>>
  readonly branches: Readonly<Record<string, CommitId>>
  readonly head: Head
  /** 次に採番するコミット番号。 */
  readonly nextId: number
}

export interface OperationResult {
  readonly repo: Repo
  readonly output: string
}

/** ユーザーの操作が Git の規則に反するときに投げるエラー。 */
export class GitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitError'
  }
}

export const DEFAULT_BRANCH = 'main'

const BRANCH_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

export function createRepo(): Repo {
  const root: Commit = { id: 'C0', parents: [], message: 'Initial commit' }
  return {
    commits: { [root.id]: root },
    branches: { [DEFAULT_BRANCH]: root.id },
    head: { type: 'branch', name: DEFAULT_BRANCH },
    nextId: 1,
  }
}

export function headCommitId(repo: Repo): CommitId {
  if (repo.head.type === 'detached') return repo.head.id
  const id = repo.branches[repo.head.name]
  if (id === undefined) {
    throw new GitError(`ブランチ ${repo.head.name} が見つかりません`)
  }
  return id
}

export function currentBranch(repo: Repo): string | null {
  return repo.head.type === 'branch' ? repo.head.name : null
}

/** ancestor が descendant の祖先 (自分自身を含む) かどうか。 */
export function isAncestor(
  repo: Repo,
  ancestor: CommitId,
  descendant: CommitId,
): boolean {
  const visited = new Set<CommitId>()
  const stack: CommitId[] = [descendant]
  while (stack.length > 0) {
    const id = stack.pop() as CommitId
    if (id === ancestor) return true
    if (visited.has(id)) continue
    visited.add(id)
    const commit = repo.commits[id]
    if (commit) stack.push(...commit.parents)
  }
  return false
}

function validateBranchName(name: string): void {
  if (!BRANCH_NAME_PATTERN.test(name) || name.includes('..')) {
    throw new GitError(`'${name}' はブランチ名として使えません`)
  }
}

function addCommit(
  repo: Repo,
  parents: readonly CommitId[],
  message: string,
): { repo: Repo; commit: Commit } {
  const commit: Commit = { id: `C${repo.nextId}`, parents, message }
  const commits = { ...repo.commits, [commit.id]: commit }
  const next: Repo =
    repo.head.type === 'branch'
      ? {
          ...repo,
          commits,
          branches: { ...repo.branches, [repo.head.name]: commit.id },
          nextId: repo.nextId + 1,
        }
      : {
          ...repo,
          commits,
          head: { type: 'detached', id: commit.id },
          nextId: repo.nextId + 1,
        }
  return { repo: next, commit }
}

export function commit(repo: Repo, message?: string): OperationResult {
  const text = message?.trim() || `Commit ${repo.nextId}`
  const { repo: next, commit: created } = addCommit(
    repo,
    [headCommitId(repo)],
    text,
  )
  return { repo: next, output: `[${created.id}] ${created.message}` }
}

export function createBranch(repo: Repo, name: string): OperationResult {
  validateBranchName(name)
  if (name in repo.branches) {
    throw new GitError(`ブランチ ${name} はすでに存在します`)
  }
  return {
    repo: { ...repo, branches: { ...repo.branches, [name]: headCommitId(repo) } },
    output: `ブランチ ${name} を作成しました`,
  }
}

export function switchBranch(
  repo: Repo,
  name: string,
  create = false,
): OperationResult {
  if (create) {
    const created = createBranch(repo, name).repo
    return {
      repo: { ...created, head: { type: 'branch', name } },
      output: `新しいブランチ ${name} に切り替えました`,
    }
  }
  if (!(name in repo.branches)) {
    throw new GitError(`ブランチ ${name} は存在しません`)
  }
  return {
    repo: { ...repo, head: { type: 'branch', name } },
    output: `ブランチ ${name} に切り替えました`,
  }
}

export function merge(repo: Repo, name: string): OperationResult {
  const current = currentBranch(repo)
  if (current === null) {
    throw new GitError('detached HEAD 状態ではマージできません')
  }
  const targetId = repo.branches[name]
  if (targetId === undefined) {
    throw new GitError(`ブランチ ${name} は存在しません`)
  }
  if (name === current) {
    throw new GitError('現在のブランチ自身はマージできません')
  }

  const currentId = headCommitId(repo)

  if (isAncestor(repo, targetId, currentId)) {
    return { repo, output: 'すでに最新です (Already up to date)' }
  }

  if (isAncestor(repo, currentId, targetId)) {
    return {
      repo: { ...repo, branches: { ...repo.branches, [current]: targetId } },
      output: `Fast-forward: ${current} を ${targetId} まで進めました`,
    }
  }

  const { repo: next, commit: mergeCommit } = addCommit(
    repo,
    [currentId, targetId],
    `Merge ${name} into ${current}`,
  )
  return {
    repo: next,
    output: `マージコミット ${mergeCommit.id} を作成しました`,
  }
}
