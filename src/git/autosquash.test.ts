import { describe, expect, it } from 'vitest'
import { commitFile, run } from '../test/run'
import { executeCommand } from './commands'
import { headCommitId, type Repo } from './model'

/** a (C1)・b (C2) のあとに、a の直し (C3) をコミットした Repo。 */
function withFixup(kind: 'fixup' | 'squash' = 'fixup', extra = ''): Repo {
  return run([
    ...commitFile('a.txt', 'a'),
    ...commitFile('b.txt', 'b'),
    'echo "a2" >> a.txt',
    'git add a.txt',
    `git commit --${kind}=C1${extra}`,
  ])
}

describe('git commit --fixup / --squash', () => {
  it('件名が fixup! <対象の件名> のコミットを作る', () => {
    const repo = withFixup()
    expect(repo.commits['C3']?.message).toBe('fixup! a')
    const extra = withFixup('fixup', ' -m "typo を直す"')
    expect(extra.commits['C3']?.message).toBe('fixup! a\n\ntypo を直す')
    expect(withFixup('squash', ' -m "説明を足す"').commits['C3']?.message).toBe('squash! a\n\n説明を足す')
  })

  it('--squash で -m がなければ、squash! <件名> の入ったエディタを開く', () => {
    const opened = executeCommand(
      run([...commitFile('a.txt', 'a'), 'echo "x" >> a.txt', 'git add a.txt']),
      'git commit --squash=HEAD',
    )
    expect(opened.repo.editor?.text.startsWith('squash! a\n')).toBe(true)
  })
})

describe('git rebase --autosquash', () => {
  it('-i の todo で、fixup! のコミットを対象の直後に fixup として並べる', () => {
    const todo = executeCommand(withFixup(), 'git rebase -i --autosquash C0').repo.editor?.text ?? ''
    expect(todo.split('\n\n')[0]).toBe('pick C1 a\nfixup C3 fixup! a\npick C2 b')
  })

  it('-i なしでも、まとめた結果のコミットにする', () => {
    const repo = run(['git rebase --autosquash C0'], withFixup())
    const tip = repo.commits[headCommitId(repo)]
    const first = repo.commits[tip?.parents[0] as string]
    expect(tip?.message).toBe('b')
    expect(first?.message).toBe('a')
    expect(first?.tree['a.txt']).toBe('a\na2\n')
    expect(first?.parents).toEqual(['C0'])
  })

  it('squash! はメッセージをまとめるエディタを開く', () => {
    const stopped = executeCommand(withFixup('squash', ' -m "説明を足す"'), 'git rebase --autosquash C0')
    expect(stopped.repo.editor?.text).toContain('squash! a')
    const done = run([`:wq ${JSON.stringify('a\n\n説明を足す')}`], stopped.repo)
    expect(done.operation).toBeNull()
    expect(done.commits[done.commits[headCommitId(done)]?.parents[0] as string]?.message).toBe('a\n\n説明を足す')
  })

  it('rebase.autoSquash の設定は -i のときの既定になり、--no-autosquash で外せる', () => {
    const repo = run(['git config rebase.autoSquash true'], withFixup())
    expect(executeCommand(repo, 'git rebase -i C0').repo.editor?.text).toContain('fixup C3')
    expect(executeCommand(repo, 'git rebase -i --no-autosquash C0').repo.editor?.text).toContain('pick C3')
  })

  it('-x の exec は、まとめるコミットの最後のあとに入れる', () => {
    const todo = executeCommand(withFixup(), 'git rebase -i --autosquash -x "git status" C0').repo.editor?.text ?? ''
    expect(todo.split('\n\n')[0]).toBe('pick C1 a\nfixup C3 fixup! a\nexec git status\npick C2 b\nexec git status')
  })
})
