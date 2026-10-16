import { describe, expect, it } from 'vitest'
import { run } from '../test/run'
import { executeCommand } from './commands'
import { ignoringRule } from './ignore'
import { workspaceStatus, type Repo } from './model'

function output(repo: Repo, command: string): string {
  const result = executeCommand(repo, command)
  if (!result.ok) throw new Error(`"${command}" が失敗しました:\n${result.output}`)
  return result.output
}

describe('.gitignore のパターン', () => {
  const workdir = {
    '.gitignore': '# ログ\n*.log\n!keep.log\nbuild/\n/root.txt\ndocs/**/*.tmp\n',
    'sub/.gitignore': 'local.txt\n',
  }
  const ignored = (path: string) => ignoringRule(workdir, path) !== null

  it('本物と同じ書き方で一致する', () => {
    expect(ignored('debug.log')).toBe(true)
    expect(ignored('a/b/debug.log')).toBe(true)
    expect(ignored('keep.log')).toBe(false)
    expect(ignored('build/out.js')).toBe(true)
    expect(ignored('src/build/out.js')).toBe(true)
    expect(ignored('build')).toBe(false)
    expect(ignored('root.txt')).toBe(true)
    expect(ignored('sub/root.txt')).toBe(false)
    expect(ignored('docs/a/b/x.tmp')).toBe(true)
    expect(ignored('docs/x.tmp')).toBe(true)
    expect(ignored('sub/local.txt')).toBe(true)
    expect(ignored('local.txt')).toBe(false)
  })

  it('無視したディレクトリの中は、! で打ち消せない', () => {
    expect(ignoringRule({ '.gitignore': 'build/\n!build/keep.txt\n' }, 'build/keep.txt')).not.toBeNull()
  })
})

describe('.gitignore と status / add / stash / check-ignore', () => {
  const base = () => run(['echo "*.log" > .gitignore', 'echo x > debug.log', 'echo a > a.txt'])

  it('status は無視したファイルを出さない (--ignored なら出す)', () => {
    const repo = base()
    expect(workspaceStatus(repo).untracked).toEqual(['.gitignore', 'a.txt'])
    expect(output(repo, 'git status')).not.toContain('debug.log')
    expect(output(repo, 'git status --ignored')).toContain('無視したファイル (.gitignore):\n  (コミットに含めるなら "git add -f <ファイル>...")\n\tdebug.log')
  })

  it('add . は無視したファイルを入れず、名前を書くと -f が要る', () => {
    const repo = run(['git add .'], base())
    expect(Object.keys(repo.index).sort()).toEqual(['.gitignore', 'README.md', 'a.txt'])
    expect(executeCommand(repo, 'git add debug.log').output).toBe(
      'The following paths are ignored by one of your .gitignore files:\ndebug.log\nhint: Use -f if you really want to add them.',
    )
    expect('debug.log' in run(['git add -f debug.log'], repo).index).toBe(true)
    // 追跡しているファイルは、パターンに一致しても無視しない
    const tracked = run(['git add -f debug.log', 'git commit -m log', 'echo y >> debug.log'], repo)
    expect(output(tracked, 'git status')).toContain('debug.log')
  })

  it('stash -u は無視したファイルを残し、-a は退避する', () => {
    const repo = run(['git add .gitignore', 'git commit -m ignore'], base())
    const u = run(['git stash -u'], repo)
    expect(Object.keys(u.workdir).sort()).toEqual(['.gitignore', 'README.md', 'debug.log'])
    const a = run(['git stash -a'], repo)
    expect(Object.keys(a.workdir).sort()).toEqual(['.gitignore', 'README.md'])
    expect(Object.keys(run(['git stash pop'], a).workdir).sort()).toEqual(['.gitignore', 'README.md', 'a.txt', 'debug.log'])
  })

  it('check-ignore は無視しているパスと、決めたパターンを表示する', () => {
    const repo = base()
    expect(output(repo, 'git check-ignore debug.log a.txt')).toBe('debug.log')
    expect(output(repo, 'git check-ignore -v debug.log')).toBe('.gitignore:1:*.log\tdebug.log')
    expect(executeCommand(repo, 'git check-ignore a.txt').ok).toBe(false)
  })
})
