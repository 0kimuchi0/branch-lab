import { describe, expect, it } from 'vitest'
import { computeLayout } from '../graph/layout'
import { commitFile, run } from '../test/run'
import { executeCommand } from './commands'
import { currentBranch, headCommitId, type Repo } from './model'

/** C1〜C8 の 8 コミット。C5 で bug.txt を入れ (そこから悪くなり)、あとは別のファイルを触る。 */
function history(): Repo {
  const lines: string[] = []
  for (let i = 1; i <= 8; i++) {
    lines.push(...(i === 5 ? commitFile('bug.txt', 'バグ', `変更 ${i}`) : commitFile('app.txt', `${i}`, `変更 ${i}`)))
  }
  return run(lines)
}

function out(repo: Repo, line: string): { repo: Repo; output: string } {
  const result = executeCommand(repo, line)
  expect(result.ok, result.output).toBe(true)
  return result
}

/** bug.txt があれば bad、なければ good と判定しながら進める。 */
function judge(repo: Repo): Repo {
  let current = repo
  for (let i = 0; i < 10 && current.bisect?.found === null; i++) {
    const bad = 'bug.txt' in current.workdir
    current = out(current, `git bisect ${bad ? 'bad' : 'good'}`).repo
  }
  return current
}

describe('git bisect', () => {
  it('start に悪いコミットと良いコミットを渡すと、真ん中あたりを checkout する', () => {
    const { repo, output } = out(history(), 'git bisect start HEAD C1')
    expect(output).toMatch(/^Bisecting: 3 revisions left to test after this \(roughly 2 steps\)\n\[C4\] 変更 4$/)
    expect(repo.head).toEqual({ type: 'detached', id: 'C4' })
    expect(computeLayout(repo).labels.map((label) => label.text)).toEqual(
      expect.arrayContaining(['bisect/bad', 'bisect/good']),
    )
  })

  it('good / bad を繰り返すと、最初の悪いコミットを見つける', () => {
    const found = judge(out(history(), 'git bisect start HEAD C1').repo)
    expect(found.bisect?.found).toBe('C5')
    const last = executeCommand(found, 'git bisect log').output
    expect(last).toContain('git bisect start')
    expect(last).toContain('git bisect bad C8')
  })

  it('見つかったら "is the first bad commit" と内容を表示する', () => {
    let repo = out(history(), 'git bisect start').repo
    repo = out(repo, 'git bisect bad').repo
    const { output } = out(repo, 'git bisect good C4')
    expect(output).toContain('Bisecting:')
    const done = judge(out(repo, 'git bisect good C4').repo)
    expect(done.bisect?.found).toBe('C5')
    expect(executeCommand(done, 'git bisect good').ok).toBe(false)
  })

  it('reset で始めたブランチに戻る', () => {
    const repo = out(history(), 'git bisect start HEAD C1').repo
    const back = out(repo, 'git bisect reset').repo
    expect(back.bisect).toBeNull()
    expect(currentBranch(back)).toBe('main')
    expect(headCommitId(back)).toBe('C8')
  })

  it('bisect run はコマンドの成功を good、失敗を bad として最後まで進める (! で逆にする)', () => {
    const started = out(history(), 'git bisect start HEAD C1').repo
    const ran = out(started, 'git bisect run ! cat bug.txt')
    expect(ran.repo.bisect?.found).toBe('C5')
    expect(ran.output).toContain('C5 is the first bad commit')
    expect(ran.output).toContain('bisect found first bad commit')
    expect(executeCommand(history(), 'git bisect run ls').ok).toBe(false)
  })

  it('skip したコミットしか残らなければ、候補を並べる', () => {
    let repo = out(history(), 'git bisect start C6 C4').repo
    // C4..C6 の候補は C5 と C6。C5 を skip すると、どちらが最初か決められない
    expect(repo.head).toEqual({ type: 'detached', id: 'C5' })
    const { output } = out(repo, 'git bisect skip')
    expect(output).toContain('最初の悪いコミットは次のどれかです')
    repo = out(repo, 'git bisect reset').repo
    expect(repo.bisect).toBeNull()
  })

  it('良い・悪いがそろうまでは待つ', () => {
    const repo = out(history(), 'git bisect start').repo
    expect(out(repo, 'git bisect good C1').output).toBe('status: waiting for bad commit, 1 good commit known')
    expect(executeCommand(history(), 'git bisect good').ok).toBe(false)
  })
})
