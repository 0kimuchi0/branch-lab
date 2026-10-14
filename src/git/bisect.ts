/**
 * git bisect。良いコミットと悪いコミットの間を二分探索して、最初に悪くなったコミットを探す。
 */
import { show } from './inspect'
import {
  GitError,
  ancestors,
  getCommit,
  headCommitId,
  headLabel,
  moveHead,
  requireNoOperation,
  resolveRef,
  subject,
  type BisectState,
  type CommitId,
  type OperationResult,
  type Repo,
} from './model'

function requireBisect(repo: Repo): BisectState {
  if (!repo.bisect) throw new GitError('bisect していません。git bisect start で始めてください')
  return repo.bisect
}

function describe(repo: Repo, id: CommitId): string {
  return `[${id}] ${subject(getCommit(repo, id).message)}`
}

/** 悪いコミットの祖先のうち、良いコミットの祖先ではないもの (最初に悪くなったコミットの候補)。 */
export function bisectCandidates(repo: Repo, state: BisectState): Set<CommitId> {
  if (state.bad === null) return new Set()
  const excluded = new Set<CommitId>()
  for (const good of state.good) for (const id of ancestors(repo.commits, good)) excluded.add(id)
  return new Set([...ancestors(repo.commits, state.bad)].filter((id) => !excluded.has(id)))
}

function checkout(repo: Repo, id: CommitId): Repo {
  return moveHead(repo, { type: 'detached', id }, id, 'bisect', id)
}

/** 次に調べるコミットを選んで checkout する。候補が 1 つに絞れたら、それが最初の悪いコミット。 */
function nextStep(repo: Repo): OperationResult {
  const state = requireBisect(repo)
  if (state.bad === null || state.good.length === 0) {
    const waiting =
      state.bad === null && state.good.length === 0 ? 'waiting for both good and bad commits'
      : state.bad === null ? `waiting for bad commit, ${state.good.length} good commit known`
      : 'waiting for good commit(s), bad commit known'
    return { repo, output: `status: ${waiting}` }
  }
  const candidates = bisectCandidates(repo, state)
  if (!candidates.has(state.bad)) {
    throw new GitError(`fatal: 悪いコミット ${state.bad} が、良いコミットの祖先になっています`)
  }
  const skipped = new Set(state.skipped)
  const testable = [...candidates].filter((id) => id !== state.bad && !skipped.has(id))
  if (testable.length === 0) {
    const remaining = [...candidates].filter((id) => id === state.bad || skipped.has(id))
    if (remaining.length === 1) {
      const found: Repo = { ...repo, bisect: { ...state, found: state.bad } }
      return {
        repo: found,
        output: `${state.bad} is the first bad commit\n${show(found, state.bad, { stat: true }).output}`,
      }
    }
    return {
      repo,
      output: [
        "skip した (調べていない) コミットしか残っていません。最初の悪いコミットは次のどれかです:",
        ...remaining.sort().map((id) => describe(repo, id)),
      ].join('\n'),
    }
  }
  // 候補をできるだけ半分に分けるコミットを選ぶ (祖先側と子孫側の数の小さいほうが最大になるもの)
  const total = candidates.size
  const score = (id: CommitId) => {
    const below = [...ancestors(repo.commits, id)].filter((ancestor) => candidates.has(ancestor)).length
    return { id, below, balance: Math.min(below, total - below) }
  }
  const best = testable
    .map(score)
    .sort((a, b) => b.balance - a.balance || Number(a.id.slice(1)) - Number(b.id.slice(1)))[0] as {
    id: CommitId
    below: number
  }
  const left = Math.max(best.below - 1, total - best.below - 1)
  const steps = left <= 0 ? 0 : Math.ceil(Math.log2(left + 1))
  return {
    repo: checkout(repo, best.id),
    output: `Bisecting: ${left} revision${left === 1 ? '' : 's'} left to test after this (roughly ${steps} step${steps === 1 ? '' : 's'})\n${describe(repo, best.id)}`,
  }
}

/** git bisect start [<悪いコミット> [<良いコミット>...]] */
export function bisectStart(repo: Repo, bad?: string, goods: readonly string[] = []): OperationResult {
  requireNoOperation(repo)
  const started: Repo = {
    ...repo,
    bisect: { start: repo.bisect?.start ?? headLabel(repo), bad: null, good: [], skipped: [], found: null, log: ['git bisect start'] },
  }
  if (bad === undefined) return nextStep(started)
  const withBad = mark(started, 'bad', [bad])
  return goods.length === 0 ? nextStep(withBad) : nextStep(mark(withBad, 'good', goods))
}

function mark(repo: Repo, kind: 'good' | 'bad' | 'skip', revs: readonly string[]): Repo {
  const state = requireBisect(repo)
  const ids = (revs.length === 0 ? ['HEAD'] : revs).map((rev) => resolveRef(repo, rev))
  const log = [
    ...state.log,
    ...ids.flatMap((id) => [`# ${kind}: ${describe(repo, id)}`, `git bisect ${kind} ${id}`]),
  ]
  const next: BisectState =
    kind === 'bad' ? { ...state, bad: ids[ids.length - 1] as CommitId, log }
    : kind === 'good' ? { ...state, good: [...state.good, ...ids], log }
    : { ...state, skipped: [...state.skipped, ...ids], log }
  return { ...repo, bisect: next }
}

/** git bisect good / bad / skip [<コミット>...]: コミットを判定して、次に調べるコミットに進む。 */
export function bisectMark(repo: Repo, kind: 'good' | 'bad' | 'skip', revs: readonly string[] = []): OperationResult {
  const state = requireBisect(repo)
  if (state.found) {
    throw new GitError(`最初の悪いコミット ${state.found} はもう見つかっています。git bisect reset で終わらせてください`)
  }
  return nextStep(mark(repo, kind, revs))
}

/** git bisect reset [<コミット>]: bisect を終わらせて、始めたときの位置 (または指定したコミット) に戻る。 */
export function bisectReset(repo: Repo, target?: string): OperationResult {
  if (!repo.bisect) return { repo, output: 'bisect していません' }
  const back = target ?? repo.bisect.start
  const cleared: Repo = { ...repo, bisect: null }
  if (back in repo.branches) {
    const moved = moveHead(cleared, { type: 'branch', name: back }, repo.branches[back] as CommitId, 'bisect reset', back)
    return { repo: moved, output: `ブランチ '${back}' に戻りました` }
  }
  const id = resolveRef(repo, back)
  if (id === headCommitId(repo)) return { repo: cleared, output: '' }
  return { repo: moveHead(cleared, { type: 'detached', id }, id, 'bisect reset', back), output: `HEAD は ${describe(repo, id)} にあります` }
}

export function bisectLog(repo: Repo): OperationResult {
  return { repo, output: requireBisect(repo).log.join('\n') }
}

/** bisect run で、まだ判定を続けるか (最初の悪いコミットが見つかっておらず、良い・悪いの両方がわかっている)。 */
export function bisectRunning(repo: Repo): boolean {
  return repo.bisect !== null && repo.bisect.found === null && repo.bisect.bad !== null && repo.bisect.good.length > 0
}
