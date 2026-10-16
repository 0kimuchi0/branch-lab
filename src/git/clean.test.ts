import { describe, expect, it } from 'vitest'
import { run } from '../test/run'
import { executeCommand } from './commands'
import { type Repo } from './model'

function output(repo: Repo, command: string): string {
  const result = executeCommand(repo, command)
  if (!result.ok) throw new Error(`"${command}" が失敗しました:\n${result.output}`)
  return result.output
}

/** 追跡している src/app.txt と .gitignore (*.log) があり、追跡していない tmp.txt・src/new.txt・out/a.js・debug.log がある。 */
function messy(): Repo {
  return run([
    'echo "*.log" > .gitignore',
    'echo app > src/app.txt',
    'git add .',
    'git commit -m base',
    'echo t > tmp.txt',
    'echo n > src/new.txt',
    'echo a > out/a.js',
    'echo x > debug.log',
  ])
}

describe('git clean', () => {
  it('-f がなければ拒否する (clean.requireForce)', () => {
    expect(executeCommand(messy(), 'git clean').output).toBe('fatal: clean.requireForce is true and -f not given: refusing to clean')
    expect(run(['git config clean.requireForce false', 'git clean'], messy()).workdir['tmp.txt']).toBeUndefined()
  })

  it('-n で消すものを表示する。-d がなければ追跡していないディレクトリには入らない', () => {
    expect(output(messy(), 'git clean -n')).toBe('Would remove src/new.txt\nWould remove tmp.txt')
    expect(output(messy(), 'git clean -nd')).toBe('Would remove out/\nWould remove src/new.txt\nWould remove tmp.txt')
    expect(output(messy(), 'git clean -nX')).toBe('Would remove debug.log')
    expect(output(messy(), 'git clean -n src')).toBe('Would remove src/new.txt')
  })

  it('-f で消し、-x なら無視しているファイルも消す', () => {
    const repo = run(['git clean -fd'], messy())
    expect(Object.keys(repo.workdir).sort()).toEqual(['.gitignore', 'README.md', 'debug.log', 'src/app.txt'])
    const all = executeCommand(messy(), 'git clean -fdx')
    expect(all.output).toBe('Removing debug.log\nRemoving out/\nRemoving src/new.txt\nRemoving tmp.txt')
    expect(Object.keys(all.repo.workdir).sort()).toEqual(['.gitignore', 'README.md', 'src/app.txt'])
  })
})

describe('git mv', () => {
  it('名前を変えて、そのことをステージする', () => {
    const repo = run(['git mv src/app.txt src/main.txt'], messy())
    expect(repo.index['src/main.txt']).toBe('app\n')
    expect('src/app.txt' in repo.index).toBe(false)
    expect(repo.workdir['src/main.txt']).toBe('app\n')
    expect(output(repo, 'git status')).toContain('削除:  src/app.txt')
  })

  it('ディレクトリに移す・ディレクトリごと移す', () => {
    const repo = run(['git mv README.md src/', 'git mv src lib'], messy())
    expect(Object.keys(repo.index).sort()).toEqual(['.gitignore', 'lib/README.md', 'lib/app.txt'])
    expect(repo.workdir['lib/new.txt']).toBeUndefined()
    expect(repo.workdir['src/new.txt']).toBe('n\n')
  })

  it('追跡していないファイル・ある先は本物と同じエラー', () => {
    expect(executeCommand(messy(), 'git mv tmp.txt x.txt').output).toBe('fatal: not under version control, source=tmp.txt, destination=x.txt')
    expect(executeCommand(messy(), 'git mv README.md .gitignore').output).toBe('fatal: destination exists, source=README.md, destination=.gitignore')
    expect(executeCommand(messy(), 'git mv nothing x').output).toBe('fatal: bad source, source=nothing, destination=x')
    expect(output(messy(), 'git mv -n README.md docs.md')).toBe("Checking rename of 'README.md' to 'docs.md'\nRenaming README.md to docs.md")
  })
})
