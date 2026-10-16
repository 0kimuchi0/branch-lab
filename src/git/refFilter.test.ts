import { describe, expect, it } from 'vitest'
import { commitFile, run } from '../test/run'
import { executeCommand } from './commands'
import type { Repo } from './model'

const out = (repo: Repo, line: string) => {
  const result = executeCommand(repo, line)
  if (!result.ok) throw new Error(`"${line}" が失敗しました:\n${result.output}`)
  return result.output
}

/** main は done を (早送りで) マージ済みで、wip はその先に 1 コミット進んでいる。 */
function branches(): Repo {
  return run([
    ...commitFile('a.txt', 'a'), 'git tag v1',
    'git switch -c done', ...commitFile('d.txt', 'd'),
    'git switch main', 'git merge --no-edit done', 'git tag -a v2 -m "二つ目"',
    'git switch -c wip', ...commitFile('w.txt', 'w'), 'git tag v3',
    'git switch main',
  ])
}

describe('git branch の絞り込み', () => {
  it('--merged / --no-merged (省略すると HEAD)', () => {
    expect(out(branches(), 'git branch --merged')).toBe('  done\n* main')
    expect(out(branches(), 'git branch --no-merged')).toBe('  wip')
    expect(out(branches(), 'git branch --merged wip')).toBe('  done\n* main\n  wip')
  })

  it('--contains / --no-contains', () => {
    expect(out(branches(), 'git branch --contains done')).toBe('  done\n* main\n  wip')
    expect(out(branches(), 'git branch --contains wip')).toBe('  wip')
    expect(out(branches(), 'git branch --no-contains wip')).toBe('  done\n* main')
    expect(executeCommand(branches(), 'git branch --contains nothing').ok).toBe(false)
  })

  it('--list のパターンと -v', () => {
    expect(out(branches(), 'git branch --list "w*"')).toBe('  wip')
    expect(out(branches(), 'git branch -v').split('\n')[1]).toMatch(/^\* main C\d+ d$/)
  })

  it('-r はリモート追跡ブランチだけ、-vv は upstream との差も出す', () => {
    const repo = run(['git push -u origin main', ...commitFile('x.txt', 'x')], branches())
    expect(out(repo, 'git branch -r')).toBe('  origin/main')
    expect(out(repo, 'git branch -a').split('\n').at(-1)).toBe('  remotes/origin/main')
    expect(out(repo, 'git branch -vv').split('\n')[1]).toMatch(/^\* main C\d+ \[origin\/main: ahead 1\] x$/)
  })
})

describe('git tag の絞り込み', () => {
  it('--contains / --no-contains / --merged / --points-at', () => {
    expect(out(branches(), 'git tag --contains v2')).toBe('v2\nv3')
    expect(out(branches(), 'git tag --no-contains v2')).toBe('v1')
    expect(out(branches(), 'git tag --merged')).toBe('v1\nv2')
    expect(out(branches(), 'git tag --points-at wip')).toBe('v3')
  })

  it('-n は注釈 (軽量タグならコミットの件名) を出す', () => {
    expect(out(branches(), 'git tag -n')).toBe(`${'v1'.padEnd(15)} a\n${'v2'.padEnd(15)} 二つ目\n${'v3'.padEnd(15)} w`)
    expect(out(branches(), 'git tag -l -n "v2"')).toBe(`${'v2'.padEnd(15)} 二つ目`)
  })
})
