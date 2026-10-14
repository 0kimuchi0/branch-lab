import { describe, expect, it } from 'vitest'
import { commitFile, run } from '../test/run'
import { executeCommand } from './commands'
import { MAIN_WORKTREE, currentBranch, headCommitId, reachableCommits } from './model'
import { resolvePath } from './worktree'

describe('resolvePath', () => {
  it('~ からのパスに正規化する', () => {
    expect(resolvePath('~/branch-lab', '../hotfix')).toBe('~/hotfix')
    expect(resolvePath('~/branch-lab', 'sub/dir')).toBe('~/branch-lab/sub/dir')
    expect(resolvePath('~/hotfix', '~/branch-lab')).toBe('~/branch-lab')
    expect(resolvePath('~/hotfix', './../branch-lab/')).toBe('~/branch-lab')
  })
})

describe('git worktree', () => {
  it('add はパスの名前のブランチを作り、cd で移ると HEAD とファイルが別々になる', () => {
    const added = executeCommand(run(commitFile('a.txt', 'a')), 'git worktree add ../hotfix')
    expect(added.output).toBe("Preparing worktree (new branch 'hotfix')\nHEAD is now at C1 a")
    expect(added.repo.worktree).toBe(MAIN_WORKTREE)
    expect(added.repo.branches['hotfix']).toBe('C1')

    const inside = run(['cd ../hotfix', 'echo "fix" > fix.txt', 'git add fix.txt', 'git commit -m "急ぎの修正"'], added.repo)
    expect(executeCommand(inside, 'pwd').output).toBe('~/hotfix')
    expect(currentBranch(inside)).toBe('hotfix')
    expect(inside.branches['hotfix']).toBe('C2')
    expect(inside.branches['main']).toBe('C1')

    const back = run(['cd ~/branch-lab'], inside)
    expect(currentBranch(back)).toBe('main')
    expect(back.workdir['fix.txt']).toBeUndefined()
    // main の worktree からも、hotfix のコミットは見える
    expect(run(['git merge hotfix'], back).branches['main']).toBe('C2')
  })

  it('worktree list と branch の + 印', () => {
    const repo = run(['git worktree add -b feature ../feature-work', 'git worktree add --detach ../review C0'])
    expect(executeCommand(repo, 'git worktree list').output).toBe(
      ['~/branch-lab   C0 [main]', '~/feature-work C0 [feature]', '~/review       C0 (detached HEAD)'].join('\n'),
    )
    expect(executeCommand(repo, 'git branch').output).toBe('+ feature\n* main')
  })

  it('ほかの worktree でチェックアウトしているブランチには切り替えられず、削除もできない', () => {
    const repo = run(['git switch -c topic', 'git switch main', 'git worktree add ../t topic'])
    const switched = executeCommand(repo, 'git switch topic')
    expect(switched.ok).toBe(false)
    expect(switched.output).toBe("fatal: 'topic' is already used by worktree at '~/t'")
    expect(executeCommand(repo, 'git branch -D topic').output).toBe(
      "error: cannot delete branch 'topic' used by worktree at '~/t'",
    )
    expect(executeCommand(repo, 'git worktree add ../t2 topic').ok).toBe(false)
    expect(executeCommand(repo, 'git worktree add ../t2 main').output).toBe(
      "fatal: 'main' is already used by worktree at '~/branch-lab'",
    )
    // 名前を変えると、ほかの worktree の HEAD も付け替わる
    const renamed = run(['git branch -m topic topic2', 'cd ../t'], repo)
    expect(currentBranch(renamed)).toBe('topic2')
  })

  it('remove: 変更があれば --force が必要。メインと今いる worktree は消せない', () => {
    const repo = run(['git worktree add ../w', 'cd ../w', 'echo "x" > x.txt', 'cd ../branch-lab'])
    expect(executeCommand(repo, 'git worktree remove ../w').output).toBe(
      "fatal: '~/w' contains modified or untracked files, use --force to delete it",
    )
    const removed = run(['git worktree remove -f ../w'], repo)
    expect(removed.worktrees).toEqual({})
    expect(executeCommand(removed, 'cd ../w').ok).toBe(false)
    expect(executeCommand(removed, 'git worktree remove .').ok).toBe(false)
    // 消したあとはブランチを削除できる
    expect(run(['git branch -D w'], removed).branches['w']).toBeUndefined()
  })

  it('ほかの worktree の detached HEAD や途中の操作が指すコミットは、どこからもたどれるものとして扱う', () => {
    const repo = run([
      'git worktree add --detach ../d',
      'cd ../d',
      ...commitFile('d.txt', 'd'),
      'cd ../branch-lab',
    ])
    expect(reachableCommits(repo).has('C1')).toBe(true)
    expect(headCommitId(repo)).toBe('C0')
  })

  it('途中の操作 (コンフリクトで止まった merge) は worktree ごとに持つ', () => {
    const repo = run([
      'git switch -c feature', 'echo "f" > README.md', 'git commit -am f',
      'git switch main', 'git worktree add ../other',
      'echo "m" > README.md', 'git commit -am m',
    ])
    const stopped = executeCommand(repo, 'git merge feature').repo
    expect(stopped.operation?.type).toBe('merge')
    const other = run(['cd ../other'], stopped)
    expect(other.operation).toBeNull()
    expect(other.conflicts).toEqual([])
    expect(run(['cd ../branch-lab'], other).operation?.type).toBe('merge')
  })
})
