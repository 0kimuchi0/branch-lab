import { describe, expect, it } from 'vitest'
import { commitFile, run } from '../test/run'
import { executeCommand } from './commands'
import { type Repo } from './model'

function output(repo: Repo, command: string): string {
  const result = executeCommand(repo, command)
  if (!result.ok) throw new Error(`"${command}" が失敗しました:\n${result.output}`)
  return result.output
}

/** C1 の上に C2 を作り、reset --hard で C2 を外した状態 (C2 は reflog だけから参照される)。 */
function resetAway(): Repo {
  return run([...commitFile('a.txt', 'a', 'A'), ...commitFile('b.txt', 'b', 'B'), 'git reset --hard HEAD~1'])
}

describe('git gc / prune', () => {
  it('既定の gc は、reflog から参照されているコミットを残す', () => {
    const repo = run(['git gc'], resetAway())
    expect('C2' in repo.commits).toBe(true)
    expect(output(resetAway(), 'git gc')).toContain('reflog から参照されているコミット C2 は残しました')
  })

  it('reflog expire --expire=now --all のあとの gc --prune=now で消える', () => {
    const repo = run(['git reflog expire --expire=now --all', 'git gc --prune=now'], resetAway())
    expect(Object.keys(repo.commits).sort()).toEqual(['C0', 'C1'])
    expect(repo.reflogs['HEAD']).toEqual([])
    expect(output(repo, 'git log --oneline')).toBe('C1 (HEAD -> main) A\nC0 (origin/main) Initial commit')
  })

  it('期限が今でなければ、たどれないコミットも 2 週間は残す', () => {
    const expired = run(['git reflog expire --expire=now --all'], resetAway())
    const kept = executeCommand(expired, 'git gc')
    expect('C2' in kept.repo.commits).toBe(true)
    expect(kept.output).toContain('2 週間たっていない')
    expect('C2' in run(['git gc --prune=2.weeks.ago'], expired).commits).toBe(true)
    expect('C2' in run(['git gc --no-prune'], expired).commits).toBe(true)
    // gc.pruneExpire の設定でも期限を変えられる
    expect('C2' in run(['git config gc.pruneExpire now', 'git gc'], expired).commits).toBe(false)
  })

  it('gc.reflogExpire=now なら、gc が reflog も消す', () => {
    const repo = run(['git config gc.reflogExpire now', 'git gc --prune=now'], resetAway())
    expect('C2' in repo.commits).toBe(false)
  })

  it('--expire-unreachable=now は、今の参照からたどれない reflog のエントリだけを消す', () => {
    const repo = run(['git reflog expire --expire-unreachable=now --all'], resetAway())
    expect((repo.reflogs['HEAD'] ?? []).map((entry) => entry.id)).toEqual(['C1', 'C1', 'C0'])
    expect((repo.reflogs['main'] ?? []).map((entry) => entry.id)).toEqual(['C1', 'C1', 'C0'])
    expect('C2' in run(['git gc --prune=now'], repo).commits).toBe(false)
  })

  it('ブランチ・タグ・stash・ほかの worktree の HEAD からたどれるコミットは消さない', () => {
    const repo = run([
      ...commitFile('a.txt', 'a', 'A'),
      'git tag v1',
      'git switch -c topic',
      ...commitFile('t.txt', 't', 'T'),
      'git switch main',
      'git worktree add --detach ../wt topic',
      'git branch -D topic',
      'echo x >> a.txt',
      'git stash',
      'git reset --hard C0',
      'git tag -d v1',
      'git reflog expire --expire=now --all',
      'git gc --prune=now',
    ])
    // C1 は stash の元、C2 は ../wt の HEAD
    expect(Object.keys(repo.commits).sort()).toEqual(['C0', 'C1', 'C2'])
  })

  it('git prune は reflog を残したまま、たどれないコミットを消す。-n は表示だけ', () => {
    const expired = run(['git reflog expire --expire=now --all'], resetAway())
    expect(output(expired, 'git prune -n')).toBe('C2 commit')
    expect('C2' in run(['git prune -n'], expired).commits).toBe(true)
    expect('C2' in run(['git prune'], expired).commits).toBe(false)
    expect('C2' in run(['git prune'], resetAway()).commits).toBe(true)
  })

  it('reflog delete で 1 つのエントリを消す', () => {
    const repo = run(['git reflog delete HEAD@{1}'], resetAway())
    expect((repo.reflogs['HEAD'] ?? []).map((entry) => entry.message)).toEqual([
      'reset: moving to HEAD~1',
      'commit: A',
      'clone: from origin',
    ])
    expect(executeCommand(repo, 'git reflog delete HEAD@{9}').repo.reflogs).toEqual(repo.reflogs)
    expect(executeCommand(repo, 'git reflog delete nothing@{0}').output).toBe("error: no reflog for 'nothing@{0}'")
    expect(executeCommand(repo, 'git reflog expire --expire=now nothing').output).toBe('error: nothing points nowhere!')
    expect(executeCommand(repo, 'git reflog delete HEAD').output).toBe('error: not a reflog: HEAD')
  })

  it('notes prune は、なくなったコミットのメモを消す', () => {
    const repo = run(['git notes add -m "メモ" C2', 'git reflog expire --expire=now --all', 'git gc --prune=now'], resetAway())
    expect(repo.notes).toEqual({ C2: 'メモ' })
    expect(output(repo, 'git notes prune -n')).toBe('C2')
    expect(run(['git notes prune'], repo).notes).toEqual({})
  })
})

describe('git fsck', () => {
  it('reflog から参照されているコミットは dangling にならない (--no-reflogs なら dangling)', () => {
    expect(output(resetAway(), 'git fsck')).toBe('')
    expect(output(resetAway(), 'git fsck --no-reflogs')).toBe('dangling commit C2')
  })

  it('dangling はたどれない履歴の先端だけ、--unreachable はすべて', () => {
    const repo = run(
      [...commitFile('a.txt', 'a', 'A'), ...commitFile('b.txt', 'b', 'B'), ...commitFile('c.txt', 'c', 'C'), 'git reset --hard C1', 'git reflog expire --expire=now --all'],
    )
    expect(output(repo, 'git fsck')).toBe('dangling commit C3')
    expect(output(repo, 'git fsck --unreachable')).toBe('unreachable commit C2\nunreachable commit C3')
    expect(output(repo, 'git fsck --no-dangling')).toBe('')
    expect(output(repo, 'git fsck --root --no-dangling')).toBe('root C0')
  })

  it('--lost-found は dangling のコミットを .git/lost-found/commit に書く', () => {
    const repo = run(['git reflog expire --expire=now --all', 'git fsck --lost-found'], resetAway())
    expect(output(repo, 'cat .git/lost-found/commit/C2')).toBe('C2')
  })
})
