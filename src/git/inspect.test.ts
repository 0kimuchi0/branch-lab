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
      'git switch main', 'echo "m" > README.md', 'git commit -am m', 'git merge feature',
    ])
    expect(out(stopped, 'git diff')).toBe('* Unmerged path README.md')
  })
})

describe('git show', () => {
  it('コミットの情報と親からの変更を表示する', () => {
    const repo = run(commitFile('a.txt', 'hello', 'a を追加'))
    expect(out(repo, 'git show')).toBe(
      [
        'commit C1 (HEAD -> main)', '', '    a を追加', '',
        'diff --git a/a.txt b/a.txt', 'new file mode 100644', '--- /dev/null', '+++ b/a.txt', '@@ -0,0 +1 @@', '+hello',
      ].join('\n'),
    )
    expect(out(repo, 'git show C0 --name-only')).toContain('README.md')
  })
})
