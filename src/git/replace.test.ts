import { describe, expect, it } from 'vitest'
import { computeLayout } from '../graph/layout'
import { commitFile, run } from '../test/run'
import { executeCommand } from './commands'
import { type Repo } from './model'

function output(repo: Repo, command: string): string {
  const result = executeCommand(repo, command)
  if (!result.ok) throw new Error(`"${command}" が失敗しました:\n${result.output}`)
  return result.output
}

/** main: C0 - C1 (A) - C2 (B) - C3 (C) */
function linear(): Repo {
  return run([...commitFile('a.txt', 'a', 'A'), ...commitFile('b.txt', 'b', 'B'), ...commitFile('c.txt', 'c', 'C')])
}

describe('git replace', () => {
  it('置き換えたコミットは、元の ID のまま置き換え先の内容で読む', () => {
    const repo = run(['git replace C2 C1'], linear())
    expect(output(repo, 'git log --oneline')).toBe(
      ['C3 (HEAD -> main) C', 'C2 (replaced) A', 'C0 (origin/main) Initial commit'].join('\n'),
    )
    expect(output(repo, 'git show --stat C2')).toContain('A')
    // 元のコミットは変わらない
    expect(repo.commits['C2']?.message).toBe('B')
    expect(output(repo, 'git replace')).toBe('C2')
    expect(output(repo, 'git replace -l --format=medium')).toBe('C2 -> C1')
    expect(output(repo, 'git replace --format=long')).toBe('C2 (commit) -> C1 (commit)')
  })

  it('git --no-replace-objects では、置き換えを使わない', () => {
    const repo = run(['git replace C2 C1'], linear())
    expect(output(repo, 'git --no-replace-objects log --oneline')).toBe(
      ['C3 (HEAD -> main) C', 'C2 B', 'C1 A', 'C0 (origin/main) Initial commit'].join('\n'),
    )
  })

  it('--graft は親だけを変えたコミットを作って置き換える', () => {
    const repo = run(['git replace --graft C3 C1'], linear())
    expect(repo.replaces).toEqual({ C3: 'C4' })
    expect(repo.commits['C4']).toMatchObject({ parents: ['C1'], message: 'C' })
    expect(output(repo, 'git log --oneline')).toBe(
      ['C3 (HEAD -> main, replaced) C', 'C1 A', 'C0 (origin/main) Initial commit'].join('\n'),
    )
    // 親のないコミットにもできる
    expect(output(run(['git replace --graft C3'], linear()), 'git log --oneline')).toBe('C3 (HEAD -> main, replaced) C')
    expect(output(linear(), 'git replace --graft C3 C2')).toBe("warning: graft for 'C3' unnecessary")
  })

  it('置き換えはマージの共通祖先や rebase にも効く', () => {
    const repo = run([
      ...commitFile('a.txt', 'a', 'A'),
      'git switch -c topic',
      ...commitFile('t.txt', 't', 'T'),
      'git switch main',
      ...commitFile('m.txt', 'm', 'M'),
      // T の親を M にすると、topic は main の先にあるように見える
      'git replace --graft C2 C3',
      'git merge topic',
    ])
    expect(repo.branches['main']).toBe('C2')
    expect(repo.commits['C2']?.parents).toEqual(['C1'])
  })

  it('すでに置き換えていれば -f が必要。同じコミットには置き換えられない', () => {
    const repo = run(['git replace C2 C1'], linear())
    expect(executeCommand(repo, 'git replace C2 C0').output).toBe("error: replace ref 'refs/replace/C2' already exists")
    expect(run(['git replace -f C2 C0'], repo).replaces).toEqual({ C2: 'C0' })
    expect(executeCommand(linear(), 'git replace C1 C1').output).toBe("error: new object is the same as the old one: 'C1'")
  })

  it('-d で置き換えをやめる', () => {
    const repo = run(['git replace C2 C1'], linear())
    const deleted = executeCommand(repo, 'git replace -d C2')
    expect(deleted.output).toBe("Deleted replace ref 'C2'")
    expect(deleted.repo.replaces).toEqual({})
    expect(executeCommand(repo, 'git replace -d C3').output).toBe("error: replace ref 'C3' not found")
  })

  it('置き換え先は refs/replace から参照されるので、gc で消えない', () => {
    const repo = run(['git replace --graft C3 C1', 'git gc --prune=now'], linear())
    expect('C4' in repo.commits).toBe(true)
    expect(output(repo, 'git for-each-ref refs/replace')).toBe('C4 commit\trefs/replace/C3')
  })

  it('グラフは置き換えたあとの親で描き、置き換えたコミットに replaced と付ける', () => {
    const layout = computeLayout(run(['git replace --graft C3 C1'], linear()))
    expect(layout.edges.map((edge) => edge.key)).toContain('C1->C3')
    expect(layout.edges.map((edge) => edge.key)).not.toContain('C2->C3')
    expect(layout.nodes.map((node) => node.id)).not.toContain('C4')
    expect(layout.labels.filter((label) => label.kind === 'replaced').map((label) => label.key)).toEqual(['replaced:C3'])
  })
})

describe('git update-ref / for-each-ref / show-ref', () => {
  it('update-ref でブランチを動かし、reflog に記録する', () => {
    const repo = run(['git update-ref -m "やり直し" refs/heads/main C1'], linear())
    expect(repo.branches['main']).toBe('C1')
    expect(repo.reflogs['main']?.[0]).toEqual({ id: 'C1', message: 'やり直し' })
  })

  it('古い値が違えば失敗する。-d で消す', () => {
    expect(executeCommand(linear(), 'git update-ref refs/heads/main C1 C2').output).toBe(
      "fatal: update_ref failed for ref 'refs/heads/main': cannot lock ref 'refs/heads/main': is at C3 but expected C2",
    )
    const repo = run(['git branch topic C1', 'git update-ref -d refs/heads/topic'], linear())
    expect('topic' in repo.branches).toBe(false)
  })

  it('for-each-ref と show-ref ですべての参照を見る', () => {
    const repo = run(['git tag v1 C1', 'git branch topic C2'], linear())
    expect(output(repo, 'git for-each-ref')).toBe(
      ['C3 commit\trefs/heads/main', 'C2 commit\trefs/heads/topic', 'C0 commit\trefs/remotes/origin/main', 'C1 commit\trefs/tags/v1'].join('\n'),
    )
    expect(output(repo, 'git for-each-ref --format="%(refname:short) %(subject)" refs/heads')).toBe('main C\ntopic B')
    expect(output(repo, 'git show-ref --heads')).toBe('C3 refs/heads/main\nC2 refs/heads/topic')
    expect(output(repo, 'git show-ref v1')).toBe('C1 refs/tags/v1')
  })
})
