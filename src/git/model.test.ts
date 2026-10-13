import { describe, expect, it } from 'vitest'
import {
  GitError,
  commit,
  createBranch,
  createRepo,
  currentBranch,
  headCommitId,
  isAncestor,
  merge,
  switchBranch,
} from './model'

describe('createRepo', () => {
  it('main ブランチとルートコミットを持つ', () => {
    const repo = createRepo()
    expect(currentBranch(repo)).toBe('main')
    expect(headCommitId(repo)).toBe('C0')
    expect(repo.commits['C0']?.parents).toEqual([])
  })
})

describe('commit', () => {
  it('現在のブランチを進め、親を HEAD に向ける', () => {
    const { repo } = commit(createRepo(), 'first')
    expect(repo.branches['main']).toBe('C1')
    expect(repo.commits['C1']).toEqual({
      id: 'C1',
      parents: ['C0'],
      message: 'first',
    })
  })

  it('メッセージ省略時は連番のメッセージを付ける', () => {
    const { repo } = commit(createRepo())
    expect(repo.commits['C1']?.message).toBe('Commit 1')
  })

  it('元の Repo を変更しない', () => {
    const before = createRepo()
    commit(before, 'x')
    expect(before.branches['main']).toBe('C0')
    expect(Object.keys(before.commits)).toEqual(['C0'])
  })
})

describe('createBranch / switchBranch', () => {
  it('HEAD と同じコミットを指すブランチを作る', () => {
    const { repo } = createBranch(createRepo(), 'feature')
    expect(repo.branches['feature']).toBe('C0')
    expect(currentBranch(repo)).toBe('main')
  })

  it('既存のブランチ名はエラーになる', () => {
    expect(() => createBranch(createRepo(), 'main')).toThrow(GitError)
  })

  it('不正なブランチ名はエラーになる', () => {
    const repo = createRepo()
    expect(() => createBranch(repo, '-bad')).toThrow(GitError)
    expect(() => createBranch(repo, 'a..b')).toThrow(GitError)
    expect(() => createBranch(repo, 'has space')).toThrow(GitError)
  })

  it('switch でブランチを切り替え、以降のコミットはそちらに積まれる', () => {
    let repo = createBranch(createRepo(), 'feature').repo
    repo = switchBranch(repo, 'feature').repo
    repo = commit(repo, 'on feature').repo
    expect(repo.branches['feature']).toBe('C1')
    expect(repo.branches['main']).toBe('C0')
  })

  it('switch -c で作成と切り替えを同時に行う', () => {
    const { repo } = switchBranch(createRepo(), 'topic', true)
    expect(currentBranch(repo)).toBe('topic')
    expect(repo.branches['topic']).toBe('C0')
  })

  it('存在しないブランチへの switch はエラーになる', () => {
    expect(() => switchBranch(createRepo(), 'nope')).toThrow(GitError)
  })
})

describe('isAncestor', () => {
  it('自分自身と祖先を判定できる', () => {
    const repo = commit(commit(createRepo(), 'a').repo, 'b').repo
    expect(isAncestor(repo, 'C0', 'C2')).toBe(true)
    expect(isAncestor(repo, 'C2', 'C2')).toBe(true)
    expect(isAncestor(repo, 'C2', 'C0')).toBe(false)
  })
})

describe('merge', () => {
  it('fast-forward できる場合はブランチを進めるだけでコミットを作らない', () => {
    let repo = switchBranch(createRepo(), 'feature', true).repo
    repo = commit(repo, 'f1').repo
    repo = switchBranch(repo, 'main').repo

    const result = merge(repo, 'feature')
    expect(result.repo.branches['main']).toBe('C1')
    expect(Object.keys(result.repo.commits)).toHaveLength(2)
  })

  it('分岐している場合は親が 2 つのマージコミットを作る', () => {
    let repo = switchBranch(createRepo(), 'feature', true).repo
    repo = commit(repo, 'f1').repo
    repo = switchBranch(repo, 'main').repo
    repo = commit(repo, 'm1').repo

    const result = merge(repo, 'feature')
    const mergeId = result.repo.branches['main'] as string
    const mergeCommit = result.repo.commits[mergeId]
    expect(mergeCommit?.parents).toEqual(['C2', 'C1'])
    expect(mergeCommit?.message).toBe('Merge feature into main')
  })

  it('すでに取り込み済みなら何も変更しない', () => {
    let repo = switchBranch(createRepo(), 'feature', true).repo
    repo = commit(repo, 'f1').repo
    // main は C0 のまま。feature から main をマージしても変化しない
    const result = merge(repo, 'main')
    expect(result.repo).toBe(repo)
    expect(result.output).toContain('Already up to date')
  })

  it('マージ後は双方のブランチが祖先になる', () => {
    let repo = switchBranch(createRepo(), 'feature', true).repo
    repo = commit(repo, 'f1').repo
    repo = switchBranch(repo, 'main').repo
    repo = commit(repo, 'm1').repo
    repo = merge(repo, 'feature').repo

    const head = headCommitId(repo)
    expect(isAncestor(repo, 'C1', head)).toBe(true)
    expect(isAncestor(repo, 'C2', head)).toBe(true)
  })

  it('存在しないブランチと自分自身のマージはエラーになる', () => {
    const repo = createRepo()
    expect(() => merge(repo, 'nope')).toThrow(GitError)
    expect(() => merge(repo, 'main')).toThrow(GitError)
  })
})
