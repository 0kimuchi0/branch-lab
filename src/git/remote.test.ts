import { describe, expect, it } from 'vitest'
import { commitFile, run } from '../test/run'
import { executeCommand } from './commands'
import { trackingLine } from './model'

describe('push', () => {
  it('upstream に fast-forward で push し、origin/main も進む', () => {
    const repo = run(commitFile('a.txt', 'a'))
    expect(trackingLine(repo, 'main')).toContain('1 コミット進んでいます')
    const result = executeCommand(repo, 'git push')
    expect(result.output).toBe('To https://example.com/branch-lab.git\n   C0..C1  main -> main')
    expect(result.repo.remotes.origin!.branches['main']).toBe('C1')
    expect(result.repo.remotes.origin!.commits['C1']).toBeDefined()
    expect(result.repo.remoteBranches['origin/main']).toBe('C1')
  })

  it('upstream がないブランチは -u か origin <ブランチ> の指定が必要', () => {
    const repo = run(['git switch -c feature', 'git commit --allow-empty -m x'])
    expect(executeCommand(repo, 'git push').output).toContain('git push -u origin feature')
    const pushed = run(['git push -u origin feature'], repo)
    expect(pushed.upstreams['feature']).toBe('origin/feature')
    expect(pushed.remotes.origin!.branches['feature']).toBe('C1')
    expect(run(['git push origin feature'], repo).upstreams['feature']).toBeUndefined()
  })

  it('リモートに手元にないコミットがあると拒否され、-f なら上書きする', () => {
    const repo = run(['teammate', 'git commit --allow-empty -m x'])
    const rejected = executeCommand(repo, 'git push')
    expect(rejected.ok).toBe(false)
    expect(rejected.output).toContain('[rejected]')
    const forced = run(['git push -f'], repo)
    expect(forced.remotes.origin!.branches['main']).toBe('C2')
  })
})

describe('fetch / pull', () => {
  it('teammate はリモートにだけコミットを作り、fetch で origin/main に取り込む', () => {
    const repo = run(['teammate'])
    expect(repo.remotes.origin!.branches['main']).toBe('C1')
    expect(repo.commits['C1']).toBeUndefined()
    const fetched = run(['git fetch'], repo)
    expect(fetched.remoteBranches['origin/main']).toBe('C1')
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

    const merged = run(['git pull --no-rebase --no-edit'], repo)
    expect(merged.commits['C3']).toMatchObject({ parents: ['C2', 'C1'], message: "Merge branch 'main' of origin" })

    const rebased = run(['git pull --rebase'], repo)
    expect(rebased.commits['C3']).toMatchObject({ parents: ['C1'], source: 'C2' })
    expect(run(['git push'], rebased).remotes.origin!.branches['main']).toBe('C3')
  })
})

describe('複数のリモート', () => {
  const out = (repo: ReturnType<typeof run>, line: string) => executeCommand(repo, line).output

  it('remote add で空のリモートを追加し、-v で URL を表示する', () => {
    const repo = run(['git remote add upstream https://example.com/upstream.git'])
    expect(out(repo, 'git remote')).toBe('origin\nupstream')
    expect(out(repo, 'git remote -v')).toBe(
      'origin\thttps://example.com/branch-lab.git (fetch)\n' +
        'origin\thttps://example.com/branch-lab.git (push)\n' +
        'upstream\thttps://example.com/upstream.git (fetch)\n' +
        'upstream\thttps://example.com/upstream.git (push)',
    )
    expect(repo.remotes.upstream?.branches).toEqual({})
    expect(executeCommand(repo, 'git remote add upstream x').ok).toBe(false)
  })

  it('別のリモートに push -u すると、追跡ブランチと upstream がそのリモートになる', () => {
    const repo = run([
      'git remote add backup https://example.com/backup.git',
      ...commitFile('a.txt', 'a'),
      'git push -u backup main',
    ])
    expect(repo.remotes.backup?.branches['main']).toBe('C1')
    expect(repo.remotes.origin?.branches['main']).toBe('C0')
    expect(repo.remoteBranches['backup/main']).toBe('C1')
    expect(repo.upstreams['main']).toBe('backup/main')
    // upstream が backup になったので、引数なしの push も backup に行く
    const next = run([...commitFile('b.txt', 'b'), 'git push'], repo)
    expect(next.remotes.backup?.branches['main']).toBe('C2')
    expect(next.remotes.origin?.branches['main']).toBe('C0')
  })

  it('存在しないリモートは拒否する', () => {
    const result = executeCommand(run([]), 'git push nowhere main')
    expect(result.ok).toBe(false)
    expect(result.output).toContain("'nowhere' はリモートリポジトリではありません")
  })

  it('fetch <リモート> と fetch --all、pull <リモート> <ブランチ>', () => {
    const repo = run([
      'git remote add upstream https://example.com/upstream.git',
      'git push upstream main',
      'teammate upstream main',
      'teammate',
    ])
    const fetched = run(['git fetch upstream'], repo)
    expect(fetched.remoteBranches['upstream/main']).toBe('C1')
    expect(fetched.remoteBranches['origin/main']).toBe('C0')
    const all = executeCommand(repo, 'git fetch --all')
    expect(all.output).toContain('Fetching origin')
    expect(all.output).toContain('Fetching upstream')
    expect(all.repo.remoteBranches['origin/main']).toBe('C2')
    expect(all.repo.remoteBranches['upstream/main']).toBe('C1')
    const pulled = run(['git pull upstream main'], repo)
    expect(pulled.branches['main']).toBe('C1')
    expect(pulled.upstreams['main']).toBe('origin/main')
  })

  it('rename で追跡ブランチと upstream も付け替え、remove で消す', () => {
    const renamed = run(['git remote rename origin github'])
    expect(renamed.remoteBranches).toEqual({ 'github/main': 'C0' })
    expect(renamed.upstreams['main']).toBe('github/main')
    expect(renamed.remotes.github).toBeDefined()
    const removed = run(['git remote remove github'], renamed)
    expect(removed.remotes).toEqual({})
    expect(removed.remoteBranches).toEqual({})
    expect(removed.upstreams).toEqual({})
    expect(executeCommand(removed, 'git push').ok).toBe(false)
  })

  it('同じ名前のブランチが 2 つのリモートにあると、switch は追跡ブランチを自動で作らない', () => {
    const repo = run([
      'git remote add upstream https://example.com/upstream.git',
      'git switch -c topic',
      'git push origin topic',
      'git push upstream topic',
      'git switch main',
      'git branch -D topic',
    ])
    expect(executeCommand(repo, 'git switch topic').ok).toBe(false)
    // リモート追跡ブランチを起点にすると、それが upstream になる
    const tracked = executeCommand(repo, 'git switch -c topic upstream/topic')
    expect(tracked.output).toContain("ブランチ 'topic' は 'upstream/topic' を追跡するように設定されました。")
    expect(tracked.repo.upstreams['topic']).toBe('upstream/topic')
  })
})
