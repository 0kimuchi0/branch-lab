/**
 * お題の正解判定。コミット ID は操作の順番で変わるので、ID ではなく
 * 「履歴の形」と「各コミットの由来」(お題の初期状態にあったコミットか、
 * そのコピーか、それを打ち消したものか、新しく作ったものか) で比べる。
 */
import type { Commit, CommitId, Repo } from '../git/model'

type Commits = Readonly<Record<CommitId, Commit>>

/** 初期状態にあったコミット (ID の番号が setupNextId より小さい) は ID で、それ以外は 'new' で区別する。 */
function baseIdentity(id: CommitId, setupNextId: number): string {
  return Number(id.slice(1)) < setupNextId ? id : 'new'
}

function identity(commits: Commits, commit: Commit, setupNextId: number): string {
  if (commit.source !== undefined) return `copy:${baseIdentity(commit.source, setupNextId)}`
  if (commit.reverts !== undefined) {
    const target = commits[commit.reverts]
    return `revert:${target ? identity(commits, target, setupNextId) : commit.reverts}`
  }
  if (commit.parents.length > 1) return 'merge'
  return baseIdentity(commit.id, setupNextId)
}

/** a の aId と b の bId から祖先へたどった履歴が、同じ形・同じ由来かどうか。 */
export function sameHistory(
  a: Commits,
  aId: CommitId,
  b: Commits,
  bId: CommitId,
  setupNextId: number,
  memo = new Map<string, boolean>(),
): boolean {
  const key = `${aId}|${bId}`
  const known = memo.get(key)
  if (known !== undefined) return known
  const ca = a[aId]
  const cb = b[bId]
  const same =
    ca !== undefined &&
    cb !== undefined &&
    identity(a, ca, setupNextId) === identity(b, cb, setupNextId) &&
    ca.parents.length === cb.parents.length &&
    ca.parents.every((parent, index) =>
      sameHistory(a, parent, b, cb.parents[index] as CommitId, setupNextId, memo),
    )
  memo.set(key, same)
  return same
}

export interface MatchOptions {
  readonly setupNextId: number
  /** HEAD の位置 (どのブランチにいるか) も比べるか。 */
  readonly checkHead?: boolean
  /** リモート (origin) のブランチも比べるか。 */
  readonly checkRemote?: boolean
}

function branchesMatch(
  actualCommits: Commits,
  actualBranches: Readonly<Record<string, CommitId>>,
  goalCommits: Commits,
  goalBranches: Readonly<Record<string, CommitId>>,
  setupNextId: number,
): boolean {
  return Object.entries(goalBranches).every(([name, goalId]) => {
    const actualId = actualBranches[name]
    return (
      actualId !== undefined &&
      sameHistory(actualCommits, actualId, goalCommits, goalId, setupNextId)
    )
  })
}

/** 途中で止まっている操作やコンフリクトマーカーがなく、目標と同じ履歴になっているか。 */
export function matchesGoal(actual: Repo, goal: Repo, options: MatchOptions): boolean {
  if (actual.operation !== null) return false
  const headId = actual.head.type === 'branch' ? actual.branches[actual.head.name] : actual.head.id
  const headTree = headId === undefined ? undefined : actual.commits[headId]?.tree
  if (headTree && Object.values(headTree).some((content) => content.includes('<<<<<<<'))) {
    return false
  }
  if (!branchesMatch(actual.commits, actual.branches, goal.commits, goal.branches, options.setupNextId)) {
    return false
  }
  if (options.checkHead) {
    if (goal.head.type === 'branch') {
      if (actual.head.type !== 'branch' || actual.head.name !== goal.head.name) return false
    } else if (
      actual.head.type !== 'detached' ||
      !sameHistory(actual.commits, actual.head.id, goal.commits, goal.head.id, options.setupNextId)
    ) {
      return false
    }
  }
  if (options.checkRemote) {
    return branchesMatch(
      actual.remote.commits,
      actual.remote.branches,
      goal.remote.commits,
      goal.remote.branches,
      options.setupNextId,
    )
  }
  return true
}
