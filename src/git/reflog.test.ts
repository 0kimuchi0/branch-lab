import { describe, expect, it } from 'vitest'
import { commitFile, run } from '../test/run'
import { editorSaveCommand, executeCommand } from './commands'
import { createRepo, currentBranch, resolveRef, type Repo } from './model'

function messages(repo: Repo, key = 'HEAD'): string[] {
  return (repo.reflogs[key] ?? []).map((entry) => `${entry.id} ${entry.message}`)
}

describe('reflog', () => {
  it('clone 直後は clone の 1 行だけ', () => {
    expect(messages(createRepo())).toEqual(['C0 clone: from origin'])
    expect(messages(createRepo(), 'main')).toEqual(['C0 clone: from origin'])
  })

  it('commit・checkout・reset・merge を Git と同じ形で記録する', () => {
    const repo = run([
      ...commitFile('a.txt', 'a', 'A を追加'),
      'git switch -c feature',
      ...commitFile('f.txt', 'f', 'F を追加'),
      'git switch main',
      'git merge feature',
      'git reset --hard HEAD~0',
    ])
    expect(messages(repo)).toEqual([
      'C2 reset: moving to HEAD~0',
      'C2 merge feature: Fast-forward',
      'C1 checkout: moving from feature to main',
      'C2 commit: F を追加',
      'C1 checkout: moving from main to feature',
      'C1 commit: A を追加',
      'C0 clone: from origin',
    ])
    expect(messages(repo, 'feature')).toEqual(['C2 commit: F を追加', 'C1 branch: Created from HEAD'])
    expect(messages(repo, 'main')).toEqual([
      'C2 reset: moving to HEAD~0',
      'C2 merge feature: Fast-forward',
      'C1 commit: A を追加',
      'C0 clone: from origin',
    ])
  })

  it('amend・マージコミット・rebase の各段階を記録する', () => {
    const amended = run([...commitFile('a.txt', 'a'), 'echo b >> a.txt', 'git commit -a --amend -m "a (修正)"'])
    expect(messages(amended)[0]).toBe('C2 commit (amend): a (修正)')

    const merged = run([
      'git switch -c feature', ...commitFile('f.txt', 'f'), 'git switch main', ...commitFile('m.txt', 'm'),
      'git merge feature', ':wq',
    ])
    expect(messages(merged)[0]).toBe("C3 merge feature: Merge made by the 'ort' strategy.")

    const rebased = run([
      'git switch -c feature', ...commitFile('f.txt', 'f'), 'git switch main', ...commitFile('m.txt', 'm'),
      'git switch feature', 'git rebase main',
    ])
    expect(messages(rebased).slice(0, 3)).toEqual([
      'C3 rebase (finish): returning to refs/heads/feature',
      'C3 rebase (pick): f',
      'C2 rebase (start): checkout C2',
    ])
    expect(messages(rebased, 'feature')[0]).toBe('C3 rebase (finish): refs/heads/feature onto C3')
  })

  it('HEAD@{n}・main@{n}・@{n} で reflog をたどり、reset --hard で失ったコミットを取り戻せる', () => {
    const lost = run([...commitFile('a.txt', '1'), ...commitFile('a.txt', '2'), 'git reset --hard HEAD~2'])
    expect(lost.branches['main']).toBe('C0')
    expect(resolveRef(lost, 'HEAD@{1}')).toBe('C2')
    expect(resolveRef(lost, 'main@{2}')).toBe('C1')
    expect(resolveRef(lost, '@{1}')).toBe('C2')
    expect(resolveRef(lost, 'HEAD@{1}~1')).toBe('C1')
    expect(run(['git reset --hard HEAD@{1}'], lost).branches['main']).toBe('C2')
    expect(executeCommand(lost, 'git reset HEAD@{9}').output).toContain('エントリしかありません')
  })

  it('git reflog は新しい順に表示し、ブランチ名も指定できる', () => {
    const repo = run(['git commit --allow-empty -m first', 'git switch -c topic'])
    expect(executeCommand(repo, 'git reflog').output).toBe(
      [
        'C1 (HEAD -> topic, main) HEAD@{0}: checkout: moving from main to topic',
        'C1 (HEAD -> topic, main) HEAD@{1}: commit: first',
        'C0 (origin/main) HEAD@{2}: clone: from origin',
      ].join('\n'),
    )
    expect(executeCommand(repo, 'git reflog show topic').output).toBe(
      'C1 (HEAD -> topic, main) topic@{0}: branch: Created from HEAD',
    )
    expect(executeCommand(repo, 'git reflog nope').ok).toBe(false)
  })

  it('switch - と @{-1} は直前にいたブランチを指す', () => {
    const repo = run(['git switch -c feature', 'git commit --allow-empty -m f', 'git switch main'])
    expect(resolveRef(repo, '@{-1}')).toBe('C1')
    const back = run(['git switch -'], repo)
    expect(currentBranch(back)).toBe('feature')
    expect(currentBranch(run(['git checkout -'], back))).toBe('main')
  })

  it('ブランチの削除と名前の変更で reflog も消える・移る', () => {
    const repo = run(['git branch topic', 'git branch -m topic renamed'])
    expect(repo.reflogs['topic']).toBeUndefined()
    expect(messages(repo, 'renamed')[0]).toBe('C0 Branch: renamed refs/heads/topic to refs/heads/renamed')
    expect(run(['git branch -d renamed'], repo).reflogs['renamed']).toBeUndefined()
  })

  it('rebase -i の reword や cherry-pick も記録する', () => {
    const base = run([...commitFile('a.txt', 'a', '1 つ目'), ...commitFile('b.txt', 'b', '2 つ目')])
    const reworded = run(['git rebase -i HEAD~1', editorSaveCommand('reword C2\n'), editorSaveCommand('2 つ目 (直し)')], base)
    expect(messages(reworded)).toContain('C3 rebase (reword): 2 つ目 (直し)')

    const picked = run(['git switch -c other C0', 'git cherry-pick C2'], base)
    expect(messages(picked)[0]).toBe('C3 cherry-pick: 2 つ目')
  })
})
