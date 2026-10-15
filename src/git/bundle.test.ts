import { describe, expect, it } from 'vitest'
import { commitFile, run } from '../test/run'
import { executeCommand } from './commands'
import { currentBranch, headCommitId, type Repo } from './model'
import { activeRepo } from './submodule'

const out = (repo: Repo, line: string) => executeCommand(repo, line).output

/** a・b をコミットした Repo。 */
function project(): Repo {
  return run([...commitFile('a.txt', 'a'), ...commitFile('b.txt', 'b')])
}

describe('git bundle', () => {
  it('create でファイルにまとめ、verify と list-heads で中身を確かめる', () => {
    const repo = run(['git bundle create repo.bundle --all'], project())
    expect(repo.workdir['repo.bundle']?.split('\n').slice(0, 4)).toEqual([
      '# v2 git bundle',
      'C2 refs/heads/main',
      'C0 refs/remotes/origin/main',
      'C2 HEAD',
    ])
    expect(out(repo, 'git bundle verify repo.bundle')).toBe(
      [
        'The bundle contains these 3 refs:',
        'C2 refs/heads/main',
        'C0 refs/remotes/origin/main',
        'C2 HEAD',
        'The bundle records a complete history.',
        'repo.bundle is okay',
      ].join('\n'),
    )
    expect(out(repo, 'git bundle list-heads repo.bundle')).toBe('C2 refs/heads/main\nC0 refs/remotes/origin/main\nC2 HEAD')
    expect(executeCommand(project(), 'git bundle create empty.bundle C2..C2').output).toBe('fatal: Refusing to create empty bundle.')
  })

  it('範囲で作ると、前提のコミットが必要になる', () => {
    const repo = run(['git bundle create part.bundle C1..main'], project())
    expect(repo.workdir['part.bundle']?.split('\n').slice(0, 3)).toEqual(['# v2 git bundle', '-C1 a', 'C2 refs/heads/main'])
    expect(out(repo, 'git bundle verify part.bundle')).toContain('The bundle requires this ref:\nC1')
  })

  it('バンドルのファイルから clone し、fetch・pull で取り込む', () => {
    const repo = run(['git bundle create repo.bundle main'], project())
    const cloned = run(['git clone repo.bundle ../copy', 'cd ../copy'], repo)
    expect(currentBranch(activeRepo(cloned))).toBe('main')
    expect(headCommitId(activeRepo(cloned))).toBe('C2')
    expect(activeRepo(cloned).remotes.origin?.url).toBe('~/branch-lab/repo.bundle')

    // 前のコミットのリポジトリに、新しいコミットを差分のバンドルで渡す
    const older = run(['git switch -c old C1', 'git bundle create next.bundle C1..main'], project())
    const fetched = executeCommand(older, 'git fetch next.bundle main:from-bundle')
    expect(fetched.output).toBe('From next.bundle\n * [new branch]      main -> from-bundle')
    expect(fetched.repo.branches['from-bundle']).toBe('C2')
    const pulled = run(['git pull next.bundle main'], older)
    expect(pulled.branches['old']).toBe('C2')
    expect(executeCommand(older, 'git fetch next.bundle').output).toBe('From next.bundle\n * branch            main -> FETCH_HEAD')
  })

  it('前提のコミットがないリポジトリには取り込めない', () => {
    const bundle = run(['git bundle create part.bundle C1..main'], project()).workdir['part.bundle'] as string
    const base = run([])
    const other: Repo = { ...base, workdir: { ...base.workdir, 'part.bundle': bundle } }
    const result = executeCommand(other, 'git fetch part.bundle main:x')
    expect(result.ok).toBe(false)
    expect(result.output).toBe('error: Repository lacks these prerequisite commits:\nerror: C1 a')
  })
})

describe('FETCH_HEAD', () => {
  it('git fetch のあとで git merge FETCH_HEAD ができる', () => {
    const repo = run(['teammate', 'git fetch'])
    expect(repo.fetchHead?.id).toBe('C1')
    const merged = run(['git merge FETCH_HEAD'], repo)
    expect(merged.branches['main']).toBe('C1')
  })
})
