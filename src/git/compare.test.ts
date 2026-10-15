import { describe, expect, it } from 'vitest'
import { commitFile, run } from '../test/run'
import { executeCommand } from './commands'
import type { Repo } from './model'

const out = (repo: Repo, line: string) => executeCommand(repo, line).output

/** topic に a・b・c をコミットし、main に b だけを cherry-pick した Repo。 */
function picked(): Repo {
  return run([
    'git switch -c topic',
    ...commitFile('a.txt', 'a'),
    ...commitFile('b.txt', 'b'),
    ...commitFile('c.txt', 'c'),
    'git switch main',
    'git cherry-pick C2',
    'git switch topic',
  ])
}

describe('git cherry', () => {
  it('上流に同じ変更があるコミットには -、ないコミットには + を付ける', () => {
    expect(out(picked(), 'git cherry main')).toBe('+ C1\n- C2\n+ C3')
    expect(out(picked(), 'git cherry -v main topic')).toBe('+ C1 a\n- C2 b\n+ C3 c')
  })

  it('上流を省略すると upstream と比べる', () => {
    const repo = run(['git switch main', ...commitFile('x.txt', 'x')])
    expect(out(repo, 'git cherry')).toBe('+ C1')
  })
})

describe('git range-diff', () => {
  /** topic (a, b, c) を、b のメッセージと c の中身を変えて rebase し直した Repo。 */
  function rewritten(): Repo {
    return run([
      'git switch -c topic',
      ...commitFile('a.txt', 'a'),
      ...commitFile('b.txt', 'b'),
      ...commitFile('c.txt', 'c'),
      'git branch old',
      'git switch main',
      ...commitFile('m.txt', 'm'),
      'git switch topic',
      'git rebase main',
      'git rebase -i HEAD~3',
      `:wq ${JSON.stringify('pick C5 a\nreword C6 b\ndrop C7 c\n')}`,
      ':wq "b (説明を直した)"',
      ...commitFile('d.txt', 'd'),
    ])
  }

  it('= は同じパッチ、! は違いのあるパッチ、< は古い側だけ、> は新しい側だけ', () => {
    const lines = out(rewritten(), 'git range-diff main old topic').split('\n')
    expect(lines[0]).toBe('1:  C1      = 1:  C5      a')
    expect(lines[1]).toBe('2:  C2      ! 2:  C8      b (説明を直した)')
    expect(lines).toContain('    -    b')
    expect(lines).toContain('    +    b (説明を直した)')
    expect(lines.slice(-2)).toEqual(['3:  C3      < -:  ------- c', '-:  ------- > 3:  C9      d'])
  })

  it('A...B と、<範囲1> <範囲2> の書き方', () => {
    const repo = rewritten()
    expect(out(repo, 'git range-diff old...topic')).toBe(out(repo, 'git range-diff topic..old old..topic'))
    expect(executeCommand(repo, 'git range-diff old').ok).toBe(false)
  })
})
