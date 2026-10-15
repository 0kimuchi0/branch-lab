import { describe, expect, it } from 'vitest'
import { commitFile, run } from '../test/run'
import { executeCommand } from './commands'
import { headCommitId, type Repo } from './model'
import { activeRepo, parseGitmodules } from './submodule'
import { gitlink } from './tree'

const URL = 'https://example.com/lib.git'

/** lib をサブモジュールとして追加してコミットした Repo。 */
function withSubmodule(): Repo {
  return run([`git submodule add ${URL}`, 'git commit -m "lib を追加"'])
}

describe('git submodule', () => {
  it('add は取得元を clone し、gitlink と .gitmodules をステージする', () => {
    const added = executeCommand(run([]), `git submodule add ${URL}`)
    expect(added.output).toBe("Cloning into '~/branch-lab/lib'...\ndone.")
    const repo = added.repo
    expect(repo.index['lib']).toBe(gitlink('L0'))
    expect(parseGitmodules(repo.index['.gitmodules'])).toEqual([{ name: 'lib', path: 'lib', url: URL }])
    expect(repo.submodules['lib']?.commits['L0']?.tree).toEqual({ 'README.md': '# lib\n' })
    expect(executeCommand(repo, 'git status').output).toContain('新規ファイル:  lib')
    expect(executeCommand(repo, 'git diff --staged lib').output).toContain('+Subproject commit L0')
    expect(executeCommand(repo, 'ls').output).toBe('.gitmodules\nREADME.md\nlib/')
    expect(executeCommand(repo, 'cat lib').output).toBe('cat: lib: ディレクトリです')
    expect(executeCommand(repo, `git submodule add ${URL}`).output).toBe("fatal: 'lib' already exists in the index")
  })

  it('cd でサブモジュールの中に入ると、そのリポジトリでコマンドが動く', () => {
    const inside = run(['cd lib', ...commitFile('util.txt', 'util'), 'git push'], withSubmodule())
    expect(inside.submodule).toBe('lib')
    expect(executeCommand(inside, 'pwd').output).toBe('~/branch-lab/lib')
    const nested = activeRepo(inside)
    expect(headCommitId(nested)).toBe('L1')
    expect(nested.commits['C1']).toBeUndefined()
    // 親から見ると、サブモジュールのコミットが変わっている
    const outside = run(['cd ..'], inside)
    expect(outside.submodule).toBeNull()
    expect(executeCommand(outside, 'git status').output).toContain('変更:  lib (new commits)')
    expect(executeCommand(outside, 'git diff').output).toContain('-Subproject commit L0\n+Subproject commit L1')
    const committed = run(['git add lib', 'git commit -m "lib を更新"'], outside)
    expect(committed.commits[headCommitId(committed)]?.tree['lib']).toBe(gitlink('L1'))
    expect(committed.libraries[URL]?.remote.branches['main']).toBe('L1')
  })

  it('中に変更があれば (modified content)、未追跡のファイルがあれば (untracked content) と出る', () => {
    const repo = run(['cd lib', 'echo "x" >> README.md', 'echo "y" > new.txt', 'cd ..'], withSubmodule())
    expect(executeCommand(repo, 'git status').output).toContain('変更:  lib (modified content, untracked content)')
  })

  it('status と、親のブランチを切り替えたあとの update', () => {
    const repo = run(['cd lib', ...commitFile('a.txt', 'a'), 'cd ..', 'git commit -am "lib を進める"'], withSubmodule())
    expect(executeCommand(repo, 'git submodule').output).toBe(' L1 lib (heads/main)')
    // 古いコミットに戻すと、サブモジュールはそのまま (+ が付く)。update で記録したコミットにする
    const back = run(['git switch --detach HEAD~1'], repo)
    expect(executeCommand(back, 'git submodule status').output).toBe('+L1 lib (heads/main)')
    const updated = executeCommand(back, 'git submodule update')
    expect(updated.output).toBe("Submodule path 'lib': checked out 'L0'")
    expect(executeCommand(updated.repo, 'git submodule status').output).toBe(' L0 lib (remotes/origin/main)')
    expect(executeCommand(updated.repo, 'git status').output).not.toContain('lib')
  })

  it('別の worktree では空のまま。update --init で同じ取得元から clone する', () => {
    const repo = run(['cd lib', ...commitFile('a.txt', 'a'), 'git push', 'cd ..', 'git commit -am "lib を進める"'], withSubmodule())
    const other = run(['git worktree add ../other', 'cd ../other'], repo)
    expect(other.submodules).toEqual({})
    expect(executeCommand(other, 'git submodule status').output).toBe('-L1 lib')
    expect(executeCommand(other, 'cd lib').output).toContain('サブモジュールの中身がありません')
    expect(executeCommand(other, 'git status').output).not.toContain('lib')
    const updated = executeCommand(other, 'git submodule update --init')
    expect(updated.output).toBe(
      [
        // 設定 (.git/config) は worktree の間で共有するので、登録はすでに済んでいる
        "Cloning into '~/other/lib'...",
        "Submodule path 'lib': checked out 'L1'",
      ].join('\n'),
    )
    // 2 つの clone でコミットしても ID がぶつからない
    const second = run(['cd lib', 'git switch main', ...commitFile('b.txt', 'b')], updated.repo)
    expect(headCommitId(activeRepo(second))).toBe('L2')
  })

  it('update --remote は取得元の最新にし、foreach は各サブモジュールでコマンドを実行する', () => {
    const repo = run(['cd lib', 'teammate', 'cd ..'], withSubmodule())
    const updated = executeCommand(repo, 'git submodule update --remote')
    expect(updated.output).toBe("Submodule path 'lib': checked out 'L1'")
    expect(executeCommand(updated.repo, 'git status').output).toContain('lib (new commits)')
    const each = executeCommand(repo, 'git submodule foreach "git log --oneline"')
    expect(each.output).toBe("Entering 'lib'\nL0 (HEAD -> main, origin/main) Initial commit")
  })

  it('deinit で中身を消し、git rm で gitlink と .gitmodules の記述を消す', () => {
    const repo = withSubmodule()
    const deinit = executeCommand(repo, 'git submodule deinit lib')
    expect(deinit.output).toBe(`Cleared directory 'lib'\nSubmodule 'lib' (${URL}) unregistered for path 'lib'`)
    expect(deinit.repo.submodules).toEqual({})
    expect(executeCommand(deinit.repo, 'git status').output).not.toContain('lib')
    const removed = executeCommand(repo, 'git rm lib')
    expect(removed.output).toBe("rm 'lib'")
    expect(removed.repo.index['lib']).toBeUndefined()
    expect(removed.repo.index['.gitmodules']).toBeUndefined()
    expect(removed.repo.submodules).toEqual({})
  })

  it('マージで両方がサブモジュールを別のコミットに進めたら、コンフリクトにする', () => {
    const repo = run(
      [
        'git switch -c other',
        'cd lib', 'git switch -c x', ...commitFile('x.txt', 'x'), 'cd ..', 'git commit -am "x"',
        'git switch main',
        'cd lib', 'git switch main', ...commitFile('y.txt', 'y'), 'cd ..', 'git commit -am "y"',
      ],
      withSubmodule(),
    )
    const merged = executeCommand(repo, 'git merge other')
    expect(merged.repo.conflicts.map((conflict) => conflict.path)).toEqual(['lib'])
  })
})
