import { describe, expect, it } from 'vitest'
import { executeCommand, tokenize } from './commands'
import { createRepo, currentBranch } from './model'

describe('tokenize', () => {
  it('引用符で囲まれた部分を 1 つのトークンにする', () => {
    expect(tokenize('commit -m "add login form"')).toEqual([
      'commit',
      '-m',
      'add login form',
    ])
    expect(tokenize("commit -m 'it works'")).toEqual(['commit', '-m', 'it works'])
  })
})

describe('executeCommand', () => {
  it('先頭の git は省略できる', () => {
    const a = executeCommand(createRepo(), 'commit -m "x"')
    const b = executeCommand(createRepo(), 'git commit -m "x"')
    expect(a.repo).toEqual(b.repo)
    expect(a.ok).toBe(true)
  })

  it('一連の操作を順に実行できる', () => {
    let repo = createRepo()
    for (const line of [
      'switch -c feature',
      'commit -m "f1"',
      'switch main',
      'commit -m "m1"',
      'merge feature',
    ]) {
      const result = executeCommand(repo, line)
      expect(result.ok).toBe(true)
      repo = result.repo
    }
    expect(currentBranch(repo)).toBe('main')
    expect(Object.keys(repo.commits)).toHaveLength(4)
  })

  it('規則に反する操作は ok: false を返し Repo を変えない', () => {
    const repo = createRepo()
    const result = executeCommand(repo, 'switch nope')
    expect(result.ok).toBe(false)
    expect(result.repo).toBe(repo)
  })

  it('引数不足や未対応コマンドは ok: false を返す', () => {
    const repo = createRepo()
    expect(executeCommand(repo, 'branch').ok).toBe(false)
    expect(executeCommand(repo, 'commit -m').ok).toBe(false)
    expect(executeCommand(repo, 'rebase main').ok).toBe(false)
  })

  it('空入力は何もしない', () => {
    const repo = createRepo()
    const result = executeCommand(repo, '   ')
    expect(result).toEqual({ repo, output: '', ok: true })
  })
})
