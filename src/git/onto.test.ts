import { describe, expect, it } from 'vitest'
import { commitFile, run } from '../test/run'
import { executeCommand } from './commands'
import { currentBranch, type Repo } from './model'

function output(repo: Repo, command: string): string {
  const result = executeCommand(repo, command)
  if (!result.ok) throw new Error(`"${command}" が失敗しました:\n${result.output}`)
  return result.output
}

/** main: C0 - C1 (M)、feature: C0 - C2 (F)、topic: feature から分けた C3 (T1) - C4 (T2) */
function stacked(): Repo {
  return run([
    ...commitFile('m.txt', 'm', 'M'),
    'git switch -c feature C0',
    ...commitFile('f.txt', 'f', 'F'),
    'git switch -c topic',
    ...commitFile('t.txt', 't1', 'T1'),
    ...commitFile('u.txt', 't2', 'T2'),
  ])
}

describe('git rebase --onto', () => {
  it('<上流>..HEAD のコミットだけを、新しい土台の上に付け替える', () => {
    const repo = run(['git rebase --onto main feature'], stacked())
    expect(output(repo, 'git log --oneline')).toBe(['C6 (HEAD -> topic) T2', 'C5 T1', 'C1 (main) M', 'C0 (origin/main) Initial commit'].join('\n'))
    expect('f.txt' in repo.workdir).toBe(false)
    expect(repo.reflogs['HEAD']?.[0]?.message).toBe('rebase (finish): returning to refs/heads/topic')
  })

  it('<ブランチ> を書くと、先にそのブランチに切り替える', () => {
    const repo = run(['git switch main', 'git rebase --onto main feature topic'], stacked())
    expect(currentBranch(repo)).toBe('topic')
    expect(repo.commits[repo.branches['topic'] as string]?.parents).toEqual(['C5'])
  })

  it('コミットを取り除くのにも使える (C3 を飛ばして C4 だけを残す)', () => {
    const repo = run(['git rebase --onto C2 C3'], stacked())
    expect(output(repo, 'git log --oneline -3')).toBe(['C5 (HEAD -> topic) T2', 'C2 (feature) F', 'C0 (origin/main) Initial commit'].join('\n'))
  })

  it('すでに新しい土台の上にあれば up to date。-i でも使える', () => {
    expect(output(stacked(), 'git rebase --onto feature feature')).toBe('Current branch topic is up to date.')
    const editing = executeCommand(stacked(), 'git rebase -i --onto main feature')
    expect(editing.repo.editor?.text).toContain('# C2..C4 を C1 の上にリベースします (2 個のコマンド)')
    expect(run([':wq'], editing.repo).commits[run([':wq'], editing.repo).branches['topic'] as string]?.parents).toEqual(['C5'])
  })

  it('<上流> を省くと、今のブランチの upstream に付け替える', () => {
    const repo = run([...commitFile('a.txt', 'a', 'A'), 'teammate', 'git fetch', 'git rebase'])
    expect(repo.commits[repo.branches['main'] as string]?.parents).toEqual(['C2'])
    expect(executeCommand(run(['git switch -c local']), 'git rebase').output).toContain('There is no tracking information for the current branch.')
  })
})

describe('git push --force-with-lease', () => {
  /** push してから amend して、履歴が分かれた状態。 */
  const amended = () => run([...commitFile('a.txt', 'a', 'A'), 'git push', 'git commit --amend -m "A (直した)"'])

  it('リモートが最後に fetch したときのままなら上書きする', () => {
    const result = executeCommand(amended(), 'git push --force-with-lease')
    expect(result.output).toBe('To https://example.com/branch-lab.git\n + C1...C2 main -> main (forced update)')
    expect(result.repo.remotes['origin']?.branches['main']).toBe('C2')
  })

  it('他の人が push していたら stale info で拒否する (fetch すると上書きできる)', () => {
    const repo = run(['teammate'], amended())
    const rejected = executeCommand(repo, 'git push --force-with-lease')
    expect(rejected.ok).toBe(false)
    expect(rejected.output.split('\n').slice(0, 2)).toEqual(['To https://example.com/branch-lab.git', ' ! [rejected]        main -> main (stale info)'])
    expect(executeCommand(repo, 'git push -f').ok).toBe(true)
    expect(executeCommand(run(['git fetch'], repo), 'git push --force-with-lease').ok).toBe(true)
  })

  it('=<ブランチ>:<コミット> で期待する位置を指定する', () => {
    const repo = run(['teammate'], amended())
    expect(executeCommand(repo, 'git push --force-with-lease=main:C3').ok).toBe(true)
    expect(executeCommand(repo, 'git push --force-with-lease=main:C1').ok).toBe(false)
  })
})
