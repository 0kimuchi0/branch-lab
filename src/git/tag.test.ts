import { describe, expect, it } from 'vitest'
import { commitFile, run } from '../test/run'
import { computeLayout, computeRemoteLayout } from '../graph/layout'
import { editorSaveCommand, executeCommand } from './commands'
import { reachableCommits, resolveRef, type Repo } from './model'

function out(repo: Repo, line: string): string {
  const result = executeCommand(repo, line)
  expect(result.ok, result.output).toBe(true)
  return result.output
}

/** main に C1, C2 を積んだ Repo。 */
function twoCommits(): Repo {
  return run([...commitFile('a.txt', 'a', '機能 A'), ...commitFile('b.txt', 'b', '機能 B')])
}

describe('git tag', () => {
  it('軽量タグは HEAD (または指定したコミット) に名前を付け、ref として使える', () => {
    const repo = run(['git tag v1.0', 'git tag v0.9 HEAD~1'], twoCommits())
    expect(repo.tags).toEqual({ 'v1.0': { target: 'C2' }, 'v0.9': { target: 'C1' } })
    expect(resolveRef(repo, 'v0.9')).toBe('C1')
    expect(resolveRef(repo, 'v1.0~1')).toBe('C1')
    expect(out(repo, 'git tag')).toBe('v0.9\nv1.0')
    expect(out(repo, 'git tag -l "v1*"')).toBe('v1.0')
  })

  it('-m は注釈付きタグになり、-a で -m がなければエディタを開く', () => {
    const repo = run(['git tag -m "最初のリリース" v1.0'], twoCommits())
    expect(repo.tags['v1.0']).toEqual({ target: 'C2', message: '最初のリリース' })
    expect(out(repo, 'git show v1.0')).toMatch(/^tag v1\.0\n\n最初のリリース\n\ncommit C2/)

    const opened = run(['git tag -a v2.0'], twoCommits())
    expect(opened.editor?.file).toBe('TAG_EDITMSG')
    expect(run([editorSaveCommand('次のリリース')], opened).tags['v2.0']).toEqual({ target: 'C2', message: '次のリリース' })
    expect(executeCommand(opened, ':wq').ok).toBe(false)
  })

  it('同じ名前は -f がないと付けられず、-d で消せる', () => {
    const repo = run(['git tag v1.0 C1'], twoCommits())
    expect(executeCommand(repo, 'git tag v1.0').output).toContain('すでに存在します')
    expect(out(repo, 'git tag -f v1.0')).toBe("Updated tag 'v1.0' (was C1)")
    expect(out(repo, 'git tag -d v1.0')).toBe("Deleted tag 'v1.0' (was C1)")
    expect(executeCommand(repo, 'git tag -d nope').ok).toBe(false)
  })

  it('タグとブランチが同じ名前なら、ref としてはタグを優先する', () => {
    const repo = run(['git branch dup C1', 'git tag dup C2'], twoCommits())
    expect(resolveRef(repo, 'dup')).toBe('C2')
  })

  it('タグが指すコミットは、ブランチから外れても到達可能として扱う', () => {
    const repo = run(['git tag keep', 'git reset --hard HEAD~1'], twoCommits())
    expect(reachableCommits(repo).has('C2')).toBe(true)
  })

  it('log のラベルとグラフにタグを表示する', () => {
    const repo = run(['git tag v1.0'], twoCommits())
    expect(out(repo, 'git log --oneline')).toContain('C2 (HEAD -> main, tag: v1.0) 機能 B')
    expect(computeLayout(repo).labels.map((label) => [label.text, label.kind])).toContainEqual(['tag: v1.0', 'tag'])
  })
})

describe('タグの push / fetch', () => {
  it('push origin <タグ> と --tags でリモートにタグを送る', () => {
    const repo = run(['git tag v1.0', 'git tag v0.9 C1'], twoCommits())
    expect(out(repo, 'git push origin v1.0')).toBe('To https://example.com/branch-lab.git\n * [new tag]         v1.0 -> v1.0')
    const pushed = run(['git push --tags'], repo)
    expect(Object.keys(pushed.remotes.origin!.tags).sort()).toEqual(['v0.9', 'v1.0'])
    expect(pushed.remotes.origin!.commits['C2']).toBeDefined()
    expect(computeRemoteLayout(pushed).labels.map((label) => label.text)).toContain('tag: v1.0')
    expect(out(pushed, 'git push --tags')).toBe('Everything up-to-date')
  })

  it('リモートに別のコミットを指す同じ名前のタグがあれば、-f がない限り拒否する', () => {
    const repo = run(['git tag v1.0 C1', 'git push origin v1.0', 'git tag -f v1.0 C2'], twoCommits())
    expect(executeCommand(repo, 'git push origin v1.0').output).toContain('(already exists)')
    expect(run(['git push -f origin v1.0'], repo).remotes.origin!.tags['v1.0']?.target).toBe('C2')
  })

  it('fetch はリモートのタグを取り込み、手元の別のタグは上書きしない', () => {
    const base = run(['git tag v1.0', 'git push origin v1.0', 'git tag -d v1.0'], twoCommits())
    const fetched = executeCommand(base, 'git fetch')
    expect(fetched.output).toContain(' * [new tag]         v1.0 -> v1.0')
    expect(fetched.repo.tags['v1.0']?.target).toBe('C2')

    const clash = run(['git tag v1.0 C1'], base)
    expect(executeCommand(clash, 'git fetch').output).toContain('would clobber existing tag')
  })

  it('push origin --delete でリモートのタグやブランチを消す', () => {
    const repo = run(['git tag v1.0', 'git push origin v1.0', 'git switch -c topic', 'git push -u origin topic'], twoCommits())
    const deleted = run(['git push origin --delete v1.0', 'git push origin --delete topic'], repo)
    expect(deleted.remotes.origin!.tags).toEqual({})
    expect(deleted.remotes.origin!.branches['topic']).toBeUndefined()
    expect(deleted.remoteBranches['origin/topic']).toBeUndefined()
    expect(executeCommand(deleted, 'git push origin --delete nope').ok).toBe(false)
  })
})
