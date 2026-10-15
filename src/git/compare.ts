/**
 * 2 つの履歴のパッチを比べるコマンド。git cherry (上流に同じ変更が入ったかを調べる) と
 * git range-diff (rebase の前後など、2 つのコミットの並びを対応づけて違いを見る)。
 * パッチが同じかは、差分から行番号を除いたもの (Git の patch-id と同じ考え方) で比べる。
 */
import { diffHunks, diffTrees } from './diff'
import {
  GitError,
  ancestors,
  getCommit,
  resolveRef,
  subject,
  type Commit,
  type CommitId,
  type OperationResult,
  type Repo,
} from './model'
import { changedPaths, displayContent } from './tree'

function parentTree(repo: Repo, commit: Commit) {
  return commit.parents[0] === undefined ? {} : getCommit(repo, commit.parents[0]).tree
}

/** パッチの中身 (行番号を除いた差分)。マージコミットは null。 */
export function patchId(repo: Repo, id: CommitId): string | null {
  const commit = getCommit(repo, id)
  if (commit.parents.length > 1) return null
  const before = parentTree(repo, commit)
  return changedPaths(before, commit.tree)
    .map((path) => {
      const hunks = diffHunks(
        before[path] === undefined ? '' : displayContent(before[path] as string),
        commit.tree[path] === undefined ? '' : displayContent(commit.tree[path] as string),
      ).filter((line) => !line.startsWith('@@'))
      return [`${path}${before[path] === undefined ? ' (new)' : commit.tree[path] === undefined ? ' (deleted)' : ''}`, ...hunks].join('\n')
    })
    .join('\n')
}

/** from から到達できず to から到達できるコミット (古い順、マージコミットを除く)。 */
function rangeCommits(repo: Repo, from: CommitId, to: CommitId): CommitId[] {
  const exclude = ancestors(repo.commits, from)
  return [...ancestors(repo.commits, to)]
    .filter((id) => !exclude.has(id) && getCommit(repo, id).parents.length <= 1)
    .sort((a, b) => Number(/\d+$/.exec(a)?.[0]) - Number(/\d+$/.exec(b)?.[0]))
}

/**
 * git cherry [-v] <上流> [<先端> [<境界>]]: 先端にあって上流にないコミットに、同じ変更が上流にあれば -、なければ + を付ける。
 */
export function cherry(repo: Repo, upstreamRef: string, headRef = 'HEAD', limitRef?: string, verbose = false): OperationResult {
  const upstream = resolveRef(repo, upstreamRef)
  const head = resolveRef(repo, headRef)
  const mine = rangeCommits(repo, limitRef === undefined ? upstream : resolveRef(repo, limitRef), head)
  const theirs = new Set(rangeCommits(repo, head, upstream).map((id) => patchId(repo, id)))
  const lines = mine.map((id) => {
    const mark = theirs.has(patchId(repo, id)) ? '-' : '+'
    return `${mark} ${id}${verbose ? ` ${subject(getCommit(repo, id).message)}` : ''}`
  })
  return { repo, output: lines.join('\n') }
}

/** range-diff で比べる、1 つのコミットの中身 (メッセージと差分)。 */
function patchText(repo: Repo, id: CommitId): string {
  const commit = getCommit(repo, id)
  const message = commit.message.split('\n').map((line) => (line === '' ? '' : `    ${line}`))
  const diff = diffTrees(parentTree(repo, commit), commit.tree)
    .split('\n')
    .filter((line) => !/^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode)/.test(line))
  const files = changedPaths(parentTree(repo, commit), commit.tree)
  const sections: string[] = ['## Commit message ##', ...message, '']
  let fileIndex = 0
  for (const line of diff) {
    if (line.startsWith('@@ -') && fileIndex < files.length && !sections.includes(`## ${files[fileIndex]} ##`)) {
      sections.push(`## ${files[fileIndex]} ##`)
      fileIndex++
    }
    sections.push(line)
  }
  return `${sections.join('\n')}\n`
}

/** 範囲の書き方 (A..B / A...B / <base> <rev1> <rev2> / <range1> <range2>) を 2 つの範囲にする。 */
function parseRanges(repo: Repo, args: readonly string[]): [CommitId[], CommitId[]] {
  const range = (text: string): CommitId[] => {
    const [from = '', to = ''] = text.split('..')
    return rangeCommits(repo, resolveRef(repo, from || 'HEAD'), resolveRef(repo, to || 'HEAD'))
  }
  if (args.length === 1 && args[0]?.includes('...')) {
    const [a = '', b = ''] = (args[0] as string).split('...')
    return [range(`${b || 'HEAD'}..${a || 'HEAD'}`), range(`${a || 'HEAD'}..${b || 'HEAD'}`)]
  }
  if (args.length === 2 && args.every((arg) => arg.includes('..'))) {
    return [range(args[0] as string), range(args[1] as string)]
  }
  if (args.length === 3) {
    const [base, first, second] = args as [string, string, string]
    return [range(`${base}..${first}`), range(`${base}..${second}`)]
  }
  throw new GitError('使い方: git range-diff <A>...<B> / <基点> <A> <B> / <範囲1> <範囲2>')
}

/**
 * git range-diff: 2 つの範囲のコミットを対応づけて並べる。
 * = は同じパッチ、! は違いのあるパッチ (下にパッチどうしの差分を付ける)、< は古い側だけ、> は新しい側だけ。
 */
export function rangeDiff(repo: Repo, args: readonly string[]): OperationResult {
  const [olds, news] = parseRanges(repo, args)
  const pairs = new Map<number, number>()
  const used = new Set<number>()
  // 同じパッチ → 同じ由来 (cherry-pick・rebase で複製したもの) → 同じ件名、の順に対応づける
  const matchers: Array<(a: Commit, b: Commit) => boolean> = [
    (a, b) => patchId(repo, a.id) === patchId(repo, b.id) && a.message === b.message,
    (a, b) => (a.source ?? a.id) === (b.source ?? b.id),
    (a, b) => subject(a.message) === subject(b.message),
  ]
  for (const matches of matchers) {
    news.forEach((newId, j) => {
      if ([...pairs.values()].includes(j)) return
      const i = olds.findIndex((oldId, index) => !used.has(index) && matches(getCommit(repo, oldId), getCommit(repo, newId)))
      if (i === -1) return
      pairs.set(i, j)
      used.add(i)
    })
  }
  const width = Math.max(7, ...[...olds, ...news].map((id) => id.length))
  const numberWidth = String(Math.max(olds.length, news.length)).length
  const num = (n: number | null) => (n === null ? '-' : String(n + 1)).padStart(numberWidth)
  const hash = (id: CommitId | null) => (id === null ? '-'.repeat(width) : id.padEnd(width))
  const line = (i: number | null, mark: string, j: number | null) => {
    const oldId = i === null ? null : (olds[i] as CommitId)
    const newId = j === null ? null : (news[j] as CommitId)
    const title = subject(getCommit(repo, (newId ?? oldId) as CommitId).message)
    return `${num(i)}:  ${hash(oldId)} ${mark} ${num(j)}:  ${hash(newId)} ${title}`
  }
  // Git と同じ並べ方: 古い側だけのものは古い側の順で、新しい側は新しい側の順で出す
  const newMatch = new Map([...pairs.entries()].map(([i, j]) => [j, i]))
  const out: string[] = []
  const shown = new Set<number>()
  let i = 0
  let j = 0
  while (i < olds.length || j < news.length) {
    while (i < olds.length && shown.has(i)) i++
    if (i < olds.length && !pairs.has(i)) {
      out.push(line(i, '<', null))
      shown.add(i)
      i++
      continue
    }
    if (j >= news.length) break
    const match = newMatch.get(j)
    if (match === undefined) {
      out.push(line(null, '>', j))
      j++
      continue
    }
    const oldText = patchText(repo, olds[match] as CommitId)
    const newText = patchText(repo, news[j] as CommitId)
    if (oldText === newText) out.push(line(match, '=', j))
    else out.push(line(match, '!', j), ...diffHunks(oldText, newText).map((hunkLine) => `    ${hunkLine}`))
    shown.add(match)
    j++
  }
  return { repo, output: out.join('\n') }
}
