import { describe, expect, it } from 'vitest'
import { commitFile, run } from '../test/run'
import { executeCommand } from './commands'
import type { Repo } from './model'
import { conflictKey } from './tree'

/** README.md の同じ行を feature (C1) と main (C2) で別々に変えた Repo。 */
function conflicting(setup: readonly string[] = ['git config rerere.enabled true']): Repo {
  return run([
    ...setup,
    'git switch -c feature',
    'echo "feature" > README.md',
    'git commit -am "feature 側"',
    'git switch main',
    'echo "main" > README.md',
    'git commit -am "main 側"',
  ])
}

/** マージしてコンフリクトを解決し、そのマージを取り消した Repo (解決は記録済み)。 */
function resolvedOnce(setup?: readonly string[]): Repo {
  return run(
    ['git merge feature', 'echo "both" > README.md', 'git add README.md', 'git commit --no-edit', 'git reset --hard HEAD~1'],
    conflicting(setup),
  )
}

describe('conflictKey', () => {
  it('ラベルを除き、両側の順序をそろえる', () => {
    const a = 'x\n<<<<<<< HEAD\nmain\n=======\nfeature\n>>>>>>> feature\ny\n'
    const b = 'x\n<<<<<<< HEAD\nfeature\n=======\nmain\n>>>>>>> main\ny\n'
    expect(conflictKey(a)).toBe(conflictKey(b))
    expect(conflictKey('x\n')).toBeNull()
  })
})

describe('git rerere', () => {
  it('コンフリクトを記録し、解決をコミットしたときに覚える', () => {
    const stopped = executeCommand(conflicting(), 'git merge feature')
    expect(stopped.output).toContain("Recorded preimage for 'README.md'")
    expect(executeCommand(stopped.repo, 'git rerere status').output).toBe('README.md')
    const committed = executeCommand(
      run(['echo "both" > README.md', 'git add README.md'], stopped.repo),
      'git commit --no-edit',
    )
    expect(committed.output.split('\n')[0]).toBe("Recorded resolution for 'README.md'.")
    expect(committed.repo.rerere.pending).toEqual({})
  })

  it('同じコンフリクトが起きたら、覚えた解決で作業ディレクトリのファイルを直す (ステージはしない)', () => {
    const again = executeCommand(resolvedOnce(), 'git merge feature')
    expect(again.output).toContain("Resolved 'README.md' using previous resolution.")
    expect(again.repo.workdir['README.md']).toBe('both\n')
    expect(again.repo.conflicts.map((conflict) => conflict.path)).toEqual(['README.md'])
    expect(executeCommand(again.repo, 'git rerere remaining').output).toBe('README.md')
    const done = run(['git add README.md', 'git commit --no-edit'], again.repo)
    expect(done.commits[done.branches['main'] as string]?.tree['README.md']).toBe('both\n')
  })

  it('rerere.autoupdate なら、直したファイルをステージまでする', () => {
    const repo = resolvedOnce(['git config rerere.enabled true', 'git config rerere.autoUpdate true'])
    const again = executeCommand(repo, 'git merge feature')
    expect(again.output).toContain("Staged 'README.md' using previous resolution.")
    expect(again.repo.conflicts).toEqual([])
    expect(run(['git commit --no-edit'], again.repo).operation).toBeNull()
  })

  it('向きが逆 (feature に main をマージ) でも、rebase でも、同じ解決を使う', () => {
    const repo = resolvedOnce()
    const reversed = executeCommand(run(['git switch feature'], repo), 'git merge main')
    expect(reversed.output).toContain("Resolved 'README.md' using previous resolution.")
    expect(reversed.repo.workdir['README.md']).toBe('both\n')
    const rebased = executeCommand(run(['git switch feature'], repo), 'git rebase main')
    expect(rebased.output).toContain("Resolved 'README.md' using previous resolution.")
    const done = run(['git add README.md', 'git rebase --continue', ':wq'], rebased.repo)
    expect(done.operation).toBeNull()
  })

  it('rerere.enabled がなければ何もしない', () => {
    const stopped = executeCommand(conflicting([]), 'git merge feature')
    expect(stopped.output).not.toContain('Recorded preimage')
    expect(stopped.repo.rerere.pending).toEqual({})
  })

  it('diff・forget・clear と、中止したときに記録の途中を忘れること', () => {
    const again = executeCommand(resolvedOnce(), 'git merge feature').repo
    expect(executeCommand(again, 'git rerere diff').output).toContain('+both')
    const forgot = executeCommand(again, 'git rerere forget README.md')
    expect(forgot.output).toBe("Updated preimage for 'README.md'\nForgot resolution for 'README.md'")
    expect(forgot.repo.rerere.resolved).toEqual({})
    expect(executeCommand(forgot.repo, 'git rerere forget README.md').ok).toBe(false)
    expect(run(['git rerere clear'], again).rerere.pending).toEqual({})
    expect(run(['git merge --abort'], again).rerere.pending).toEqual({})
    expect(run(['git reset --hard'], again).rerere.pending).toEqual({})
  })

  it('git rerere で、コミットする前に解決を記録できる', () => {
    const stopped = run(['git merge feature', 'echo "both" > README.md'], conflicting())
    const recorded = executeCommand(stopped, 'git rerere')
    expect(recorded.output).toBe("Recorded resolution for 'README.md'.")
    // コミットしたときには、同じ内容をもう一度記録しない
    const committed = executeCommand(run(['git add README.md'], recorded.repo), 'git commit --no-edit')
    expect(committed.output).not.toContain('Recorded resolution')
  })
})

describe('git config', () => {
  it('値の設定・取得・削除・一覧 (セクションと変数名は大文字・小文字を区別しない)', () => {
    const repo = run(['git config Rerere.Enabled true', 'git config --global user.name "Alice"'])
    expect(executeCommand(repo, 'git config rerere.enabled').output).toBe('true')
    expect(executeCommand(repo, 'git config --list').output).toBe('rerere.enabled=true\nuser.name=Alice')
    const unset = run(['git config --unset user.name'], repo)
    const missing = executeCommand(unset, 'git config user.name')
    expect(missing.ok).toBe(false)
    expect(missing.output).toBe('')
    expect(executeCommand(repo, 'git config nosection').output).toBe('error: key does not contain a section: nosection')
  })

  it('pull.rebase と merge.ff の設定が、オプションを省略したときの既定になる', () => {
    const diverged = run(['teammate', ...commitFile('a.txt', 'a')])
    const rebased = run(['git config pull.rebase true', 'git pull'], diverged)
    expect(rebased.commits[rebased.branches['main'] as string]?.parents).toHaveLength(1)
    expect(rebased.commits[rebased.branches['main'] as string]?.parents[0]).toBe('C1')
    const repo = run(['git switch -c topic', ...commitFile('t.txt', 't'), 'git switch main', 'git config merge.ff false'])
    const merged = run(['git merge --no-edit topic'], repo)
    expect(merged.commits[merged.branches['main'] as string]?.parents).toHaveLength(2)
    const ff = run(['git merge --ff topic'], repo)
    expect(ff.branches['main']).toBe('C1')
  })
})
