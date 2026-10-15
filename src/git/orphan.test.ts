import { describe, expect, it } from 'vitest'
import { commitFile, run } from '../test/run'
import { executeCommand } from './commands'
import { currentBranch, headCommitIdOrNull, isUnborn } from './model'

describe('switch --orphan / checkout --orphan', () => {
  it('switch --orphan は履歴のないブランチに移り、最初のコミットが root commit になる', () => {
    const repo = run([...commitFile('a.txt', 'a'), 'echo "メモ" > memo.txt', 'git switch --orphan gh-pages'])
    expect(currentBranch(repo)).toBe('gh-pages')
    expect(isUnborn(repo)).toBe(true)
    expect(repo.index).toEqual({})
    // 追跡していないファイルは残る
    expect(Object.keys(repo.workdir)).toEqual(['memo.txt'])
    expect(executeCommand(repo, 'git status').output).toContain('まだコミットはありません')
    expect(executeCommand(repo, 'git log').output).toBe("fatal: your current branch 'gh-pages' does not have any commits yet")
    const committed = executeCommand(run(['echo "<h1>pages</h1>" > index.html', 'git add index.html'], repo), 'git commit -m "最初のページ"')
    expect(committed.output).toBe('[gh-pages (root-commit) C2] 最初のページ')
    expect(committed.repo.commits['C2']?.parents).toEqual([])
    expect(committed.repo.reflogs['HEAD']?.[0]?.message).toBe('commit (initial): 最初のページ')
    expect(executeCommand(committed.repo, 'git merge main').output).toBe('fatal: refusing to merge unrelated histories')
    const merged = run(['git merge --allow-unrelated-histories --no-edit main'], committed.repo)
    expect(merged.commits[headCommitIdOrNull(merged) as string]?.parents).toEqual(['C2', 'C1'])
  })

  it('checkout --orphan はステージと作業ディレクトリを残す。コミットする前に別のブランチへ戻れる', () => {
    const repo = run([...commitFile('a.txt', 'a'), 'git checkout --orphan fresh'])
    expect(repo.index['a.txt']).toBe('a\n')
    expect(headCommitIdOrNull(repo)).toBeNull()
    expect(executeCommand(repo, 'git status').output).toContain('新規ファイル:  a.txt')
    const back = run(['git switch main'], repo)
    expect(currentBranch(back)).toBe('main')
    expect(back.branches['fresh']).toBeUndefined()
    expect(executeCommand(repo, 'git switch --orphan main').ok).toBe(false)
    expect(executeCommand(repo, 'git commit --amend -m x').output).toBe('fatal: You have nothing to amend.')
  })
})
