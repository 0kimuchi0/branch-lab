import { describe, expect, it } from 'vitest'
import { commitFile, run } from '../test/run'
import { executeCommand } from './commands'
import { trackingLine } from './model'

describe('push', () => {
  it('upstream に fast-forward で push し、origin/main も進む', () => {
    const repo = run(commitFile('a.txt', 'a'))
    expect(trackingLine(repo, 'main')).toContain('1 コミット進んでいます')
    const result = executeCommand(repo, 'git push')
    expect(result.output).toBe('To origin\n   C0..C1  main -> main')
    expect(result.repo.remote.branches['main']).toBe('C1')
    expect(result.repo.remote.commits['C1']).toBeDefined()
    expect(result.repo.remoteBranches['main']).toBe('C1')
  })

  it('upstream がないブランチは -u か origin <ブランチ> の指定が必要', () => {
    const repo = run(['git switch -c feature', 'git commit --allow-empty'])
    expect(executeCommand(repo, 'git push').output).toContain('git push -u origin feature')
    const pushed = run(['git push -u origin feature'], repo)
    expect(pushed.upstreams['feature']).toBe('feature')
    expect(pushed.remote.branches['feature']).toBe('C1')
    expect(run(['git push origin feature'], repo).upstreams['feature']).toBeUndefined()
  })

  it('リモートに手元にないコミットがあると拒否され、-f なら上書きする', () => {
    const repo = run(['teammate', 'git commit --allow-empty'])
    const rejected = executeCommand(repo, 'git push')
    expect(rejected.ok).toBe(false)
    expect(rejected.output).toContain('[rejected]')
    const forced = run(['git push -f'], repo)
    expect(forced.remote.branches['main']).toBe('C2')
  })
})

describe('fetch / pull', () => {
  it('teammate はリモートにだけコミットを作り、fetch で origin/main に取り込む', () => {
    const repo = run(['teammate'])
    expect(repo.remote.branches['main']).toBe('C1')
    expect(repo.commits['C1']).toBeUndefined()
    const fetched = run(['git fetch'], repo)
    expect(fetched.remoteBranches['main']).toBe('C1')
    expect(fetched.branches['main']).toBe('C0')
    expect(trackingLine(fetched, 'main')).toContain('1 コミット遅れています')
  })

  it('pull は fast-forward できればそのまま取り込む', () => {
    const repo = run(['teammate', 'git pull'])
    expect(repo.branches['main']).toBe('C1')
    expect(repo.workdir['team.txt']).toBe('他の人の変更 (C1)\n')
  })

  it('分岐しているときは --rebase か --no-rebase の指定が必要', () => {
    const repo = run(['teammate', ...commitFile('a.txt', 'a')])
    const result = executeCommand(repo, 'git pull')
    expect(result.ok).toBe(false)
    expect(result.output).toContain('統合する方法を指定する必要があります')

    const merged = run(['git pull --no-rebase'], repo)
    expect(merged.commits['C3']).toMatchObject({ parents: ['C2', 'C1'], message: "Merge branch 'main' of origin" })

    const rebased = run(['git pull --rebase'], repo)
    expect(rebased.commits['C3']).toMatchObject({ parents: ['C1'], source: 'C2' })
    expect(run(['git push'], rebased).remote.branches['main']).toBe('C3')
  })
})
