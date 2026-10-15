import { describe as group, expect, it } from 'vitest'
import { commitFile, run } from '../test/run'
import { executeCommand } from './commands'
import { authorOf, type Repo } from './model'

function output(repo: Repo, command: string): string {
  const result = executeCommand(repo, command)
  if (!result.ok) throw new Error(`"${command}" が失敗しました:\n${result.output}`)
  return result.output
}

group('コミットの作者', () => {
  it('user.name を作者にする (設定していなければ「あなた」)', () => {
    const repo = run([...commitFile('a.txt', 'a', 'A'), 'git config user.name "花子"', ...commitFile('b.txt', 'b', 'B')])
    expect(authorOf(repo.commits['C1'] as never)).toBe('あなた')
    expect(repo.commits['C2']?.author).toBe('花子')
    expect(output(repo, 'git log --format="%h %an" -2')).toBe('C2 花子\nC1 あなた')
    expect(output(repo, 'git log --oneline --author=花子')).toBe('C2 (HEAD -> main) B')
    expect(output(repo, 'git show --stat')).toContain('Author: 花子')
  })

  it('cherry-pick・rebase・--amend は元の作者のまま。teammate はチームメイト', () => {
    const repo = run([
      'git config user.name "花子"',
      'git switch -c topic',
      ...commitFile('t.txt', 't', 'T'),
      'git switch main',
      'git config user.name "太郎"',
      ...commitFile('m.txt', 'm', 'M'),
      'git cherry-pick topic',
      'git commit --amend --no-edit',
    ])
    const tip = repo.branches['main'] as string
    expect(repo.commits[tip]?.author).toBe('花子')
    expect(run(['teammate', 'git fetch'], repo).commits['C5']?.author).toBe('チームメイト')
  })
})

group('git describe', () => {
  const tagged = () =>
    run([...commitFile('a.txt', 'a', 'A'), 'git tag -a v1 -m v1', ...commitFile('b.txt', 'b', 'B'), ...commitFile('c.txt', 'c', 'C'), 'git tag light'])

  it('近い注釈付きタグからの位置で表す', () => {
    expect(output(tagged(), 'git describe')).toBe('v1-2-gC3')
    expect(output(tagged(), 'git describe C1')).toBe('v1')
    expect(output(tagged(), 'git describe --long C1')).toBe('v1-0-gC1')
    expect(output(tagged(), 'git describe --abbrev=0')).toBe('v1')
    expect(output(tagged(), 'git describe --tags')).toBe('light')
    expect(output(tagged(), 'git describe --all C2')).toBe('tags/v1-1-gC2')
    expect(output(run(['echo x >> a.txt'], tagged()), 'git describe --dirty')).toBe('v1-2-gC3-dirty')
  })

  it('使えるタグがなければ本物と同じエラー (--always ならコミット ID)', () => {
    expect(executeCommand(run([]), 'git describe').output).toBe('fatal: No names found, cannot describe anything.')
    expect(executeCommand(run(['git tag light']), 'git describe').output).toBe(
      "fatal: No annotated tags can describe 'C0'.\nHowever, there were unannotated tags: try --tags.",
    )
    expect(output(run([]), 'git describe --always')).toBe('C0')
    expect(executeCommand(tagged(), 'git describe --exact-match').output).toBe("fatal: no tag exactly matches 'C3'")
  })
})

group('git shortlog', () => {
  it('作者ごとに、古いものから件名を並べる', () => {
    const repo = run([
      ...commitFile('a.txt', 'a', 'A'),
      'git config user.name "花子"',
      ...commitFile('b.txt', 'b', 'B'),
      ...commitFile('c.txt', 'c', 'C'),
    ])
    expect(output(repo, 'git shortlog')).toBe(['あなた (2):', '      Initial commit', '      A', '', '花子 (2):', '      B', '      C'].join('\n'))
    expect(output(repo, 'git shortlog -sn C0..HEAD')).toBe('     2\t花子\n     1\tあなた')
  })
})

group('git grep', () => {
  const repo = () => run([...commitFile('a.txt', 'Hello', 'A'), 'echo "hello world" >> a.txt', 'echo Hello > new.txt'])

  it('追跡しているファイルの作業ディレクトリの内容から探す', () => {
    expect(output(repo(), 'git grep -n -i hello')).toBe('a.txt:1:Hello\na.txt:2:hello world')
    expect(output(repo(), 'git grep -l Hello')).toBe('a.txt')
    expect(output(repo(), 'git grep -c -i hello -- a.txt')).toBe('a.txt:2')
    expect(executeCommand(repo(), 'git grep nothing').ok).toBe(false)
  })

  it('コミットを指定すると、そのときのファイルから探す', () => {
    expect(output(repo(), 'git grep -i hello HEAD')).toBe('HEAD:a.txt:Hello')
    expect(output(repo(), 'git grep -e Branch -e Hello C0')).toBe('C0:README.md:# BranchLab')
  })
})
