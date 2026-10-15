import { describe, expect, it } from 'vitest'
import { commitFile, run } from '../test/run'
import { executeCommand } from './commands'
import type { Repo } from './model'

const out = (repo: Repo, line: string) => {
  const result = executeCommand(repo, line)
  expect(result.ok, result.output).toBe(true)
  return result.output
}

describe('git diff', () => {
  const repo = run(['echo "staged" >> README.md', 'git add .', 'echo "unstaged" >> README.md', 'touch new.txt'])

  it('引数なしはステージ → 作業ディレクトリで、未追跡ファイルは含めない', () => {
    expect(out(repo, 'git diff')).toBe(
      'diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1,2 +1,3 @@\n # BranchLab\n staged\n+unstaged',
    )
  })

  it('--staged / --cached は HEAD → ステージ', () => {
    expect(out(repo, 'git diff --staged')).toContain('+staged')
    expect(out(repo, 'git diff --cached')).not.toContain('unstaged')
  })

  it('コミットを指定すると、そのコミットと比べる', () => {
    const committed = run([...commitFile('a.txt', 'one'), ...commitFile('a.txt', 'two')])
    expect(out(committed, 'git diff HEAD~1 HEAD')).toContain('+two')
    expect(out(committed, 'git diff C1..C2')).toContain('+two')
    expect(out(committed, 'git diff HEAD~2 --stat')).toContain('1 file changed, 2 insertions(+)')
    expect(out(committed, 'git diff')).toBe('')
  })

  it('コンフリクト中のファイルは Unmerged path と表示する', () => {
    const stopped = run([
      'git switch -c feature', 'echo "f" > README.md', 'git commit -am f',
      'git switch main', 'echo "m" > README.md', 'git commit -am m', 'git merge --no-edit feature',
    ])
    expect(out(stopped, 'git diff')).toBe('* Unmerged path README.md')
  })
})

describe('git show', () => {
  it('コミットの情報と親からの変更を表示する', () => {
    const repo = run(commitFile('a.txt', 'hello', 'a を追加'))
    expect(out(repo, 'git show')).toBe(
      [
        'commit C1 (HEAD -> main)', 'Author: あなた', '', '    a を追加', '',
        'diff --git a/a.txt b/a.txt', 'new file mode 100644', '--- /dev/null', '+++ b/a.txt', '@@ -0,0 +1 @@', '+hello',
      ].join('\n'),
    )
    expect(out(repo, 'git show C0 --name-only')).toContain('README.md')
  })
})

describe('git blame', () => {
  /** app.txt を 3 回に分けて書いた Repo。C2 で 2 行目を書き換えている。 */
  const history = () =>
    run([
      'echo "1 行目" > app.txt', 'echo "2 行目" >> app.txt', 'git add .', 'git commit -m "最初の版"',
      'echo "1 行目" > app.txt', 'echo "2 行目 (修正)" >> app.txt', 'git commit -am "2 行目を直す"',
      'echo "3 行目" >> app.txt', 'git commit -am "3 行目を足す"',
    ])

  it('各行を最後に変えたコミットに割り当てる', () => {
    expect(out(history(), 'git blame app.txt')).toBe(
      ['C1 (最初の版    1) 1 行目', 'C2 (2 行目を直す 2) 2 行目 (修正)', 'C3 (3 行目を足す 3) 3 行目'].join('\n'),
    )
  })

  it('コミットを指定するとその時点で調べ、-L で範囲を絞る', () => {
    expect(out(history(), 'git blame app.txt HEAD~1')).toBe('C1 (最初の版    1) 1 行目\nC2 (2 行目を直す 2) 2 行目 (修正)')
    expect(out(history(), 'git blame -L2,3 app.txt')).toBe('C2 (2 行目を直す 2) 2 行目 (修正)\nC3 (3 行目を足す 3) 3 行目')
  })

  it('まだコミットしていない行と、親のないコミットの行を区別する', () => {
    const repo = run(['echo "作業中" >> README.md'])
    expect(out(repo, 'git blame README.md')).toBe(
      '^C0     (Initial commit    1) # BranchLab\n0000000 (Not Committed Yet 2) 作業中',
    )
  })

  it('マージで取り込んだ行は、取り込んだ元のコミットのもの', () => {
    const repo = run([
      'echo "a" > f.txt', 'echo "b" >> f.txt', 'echo "c" >> f.txt', 'git add .', 'git commit -m base',
      'git switch -c feature', 'echo "A" > f.txt', 'echo "b" >> f.txt', 'echo "c" >> f.txt', 'git commit -am "A に"',
      'git switch main', 'echo "a" > f.txt', 'echo "b" >> f.txt', 'echo "C" >> f.txt', 'git commit -am "C に"',
      'git merge --no-edit feature',
    ])
    expect(out(repo, 'git blame f.txt').split('\n').map((line) => line.slice(0, 2))).toEqual(['C2', 'C1', 'C3'])
  })

  it('ないファイルや範囲外はエラー', () => {
    const repo = history()
    expect(executeCommand(repo, 'git blame nope.txt').ok).toBe(false)
    expect(executeCommand(repo, 'git blame -L 5,6 app.txt').ok).toBe(false)
    expect(executeCommand(run(['touch new.txt']), 'git blame new.txt').ok).toBe(false)
  })
})
