import { describe, expect, it } from 'vitest'
import { run } from '../test/run'
import { executeCommand } from './commands'
import { inSparseCone, type Repo } from './model'
import { workdirFiles } from '../view/workspace'

/** docs/・src/app/・src/lib/ にファイルがある Repo。 */
function project(): Repo {
  return run([
    'echo "guide" > docs/guide.md',
    'echo "main" > src/main.ts',
    'echo "app" > src/app/app.ts',
    'echo "lib" > src/lib/lib.ts',
    'git add .',
    'git commit -m "プロジェクト"',
  ])
}

const out = (repo: Repo, line: string) => executeCommand(repo, line).output

describe('inSparseCone', () => {
  it('ルートのファイル・指定したディレクトリの中・親ディレクトリの直下のファイルが入る', () => {
    expect(inSparseCone(['src/app'], 'README.md')).toBe(true)
    expect(inSparseCone(['src/app'], 'src/app/app.ts')).toBe(true)
    expect(inSparseCone(['src/app'], 'src/main.ts')).toBe(true)
    expect(inSparseCone(['src/app'], 'src/lib/lib.ts')).toBe(false)
    expect(inSparseCone(['src/app'], 'docs/guide.md')).toBe(false)
  })
})

describe('git sparse-checkout', () => {
  it('set で作業ディレクトリに出すファイルを絞り、ステージとコミットには残す', () => {
    const repo = run(['git sparse-checkout set src/app'], project())
    expect(out(repo, 'ls')).toBe('README.md\nsrc/app/app.ts\nsrc/main.ts')
    expect(out(repo, 'cat docs/guide.md')).toBe('cat: docs/guide.md: そのようなファイルはありません')
    expect(repo.index['docs/guide.md']).toBe('guide\n')
    expect(workdirFiles(repo).map((file) => file.path)).toEqual(['README.md', 'src/app/app.ts', 'src/main.ts'])
    expect(out(repo, 'git status')).toContain('スパースチェックアウト中です (追跡しているファイルの 60% が作業ディレクトリにあります)')
    expect(out(repo, 'git status')).toContain('作業ツリーはクリーンです')
    expect(out(repo, 'git sparse-checkout list')).toBe('src/app')
  })

  it('add で広げ、disable ですべて出す。ブランチを切り替えても絞ったまま', () => {
    const repo = run(['git sparse-checkout init', 'git sparse-checkout add docs/'], project())
    expect(out(repo, 'ls')).toBe('README.md\ndocs/guide.md')
    const switched = run(['git switch -c other', 'git switch main'], repo)
    expect(out(switched, 'ls')).toBe('README.md\ndocs/guide.md')
    expect(out(run(['git sparse-checkout disable'], repo), 'ls').split('\n')).toHaveLength(5)
    expect(executeCommand(project(), 'git sparse-checkout list').output).toBe('fatal: this worktree is not sparse')
  })

  it('外のファイルに書くと作業ディレクトリに出て、変更として扱う', () => {
    const repo = run(['git sparse-checkout set src/app', 'echo "new lib" > src/lib/lib.ts'], project())
    expect(out(repo, 'ls')).toContain('src/lib/lib.ts')
    expect(out(repo, 'git status')).toContain('src/lib/lib.ts')
  })

  it('worktree ごとに持つ', () => {
    const repo = run(['git worktree add ../other', 'git sparse-checkout set docs', 'cd ../other'], project())
    expect(repo.sparse).toBeNull()
    expect(out(run(['cd ../branch-lab'], repo), 'git sparse-checkout list')).toBe('docs')
  })
})
