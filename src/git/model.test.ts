import { describe, expect, it } from 'vitest'
import { commitFile, run } from '../test/run'
import { executeCommand } from './commands'
import {
  GitError,
  commit,
  createBranch,
  createRepo,
  currentBranch,
  headCommitId,
  isAncestor,
  mergeBase,
  reachableCommits,
  reset,
  resolveRef,
  switchBranch,
  workspaceStatus,
  type Repo,
} from './model'

/** main に C1, C2, C3 を積んだ Repo。 */
function linearRepo(): Repo {
  return run([...commitFile('a.txt', 'a'), ...commitFile('a.txt', 'b'), ...commitFile('a.txt', 'c')])
}

describe('createRepo', () => {
  it('origin から clone した直後の状態になる', () => {
    const repo = createRepo()
    expect(currentBranch(repo)).toBe('main')
    expect(headCommitId(repo)).toBe('C0')
    expect(repo.workdir).toEqual({ 'README.md': '# BranchLab\n' })
    expect(repo.index).toEqual(repo.workdir)
    expect(repo.remote.branches).toEqual({ main: 'C0' })
    expect(repo.remoteBranches).toEqual({ main: 'C0' })
    expect(repo.upstreams).toEqual({ main: 'main' })
  })
})

describe('add / commit', () => {
  it('ステージした内容だけがコミットされる', () => {
    const repo = run(['echo "a" > a.txt', 'echo "b" > b.txt', 'git add a.txt', 'git commit -m "add a"'])
    expect(repo.commits['C1']).toMatchObject({ parents: ['C0'], message: 'add a' })
    expect(repo.commits['C1']?.tree).toEqual({ 'README.md': '# BranchLab\n', 'a.txt': 'a\n' })
    expect(workspaceStatus(repo).untracked).toEqual(['b.txt'])
  })

  it('ステージに変更がなければコミットできない', () => {
    expect(() => commit(createRepo())).toThrow('コミットするものはありません')
    const edited = run(['echo "x" >> README.md'])
    expect(() => commit(edited)).toThrow('git add')
  })

  it('--allow-empty なら変更がなくてもコミットできる', () => {
    const { repo } = commit(createRepo(), { allowEmpty: true, message: 'empty' })
    expect(repo.branches['main']).toBe('C1')
    expect(repo.commits['C1']?.message).toBe('empty')
  })

  it('-a は追跡しているファイルの変更だけをステージする', () => {
    const repo = run(['echo "x" >> README.md', 'touch new.txt', 'git commit -am "edit"'])
    expect(repo.commits['C1']?.tree).toEqual({ 'README.md': '# BranchLab\nx\n' })
    expect(workspaceStatus(repo).untracked).toEqual(['new.txt'])
  })

  it('--amend は直前のコミットを作り直し、元のコミットは外れる', () => {
    const repo = run([...commitFile('a.txt', 'a'), 'echo "b" >> a.txt', 'git commit -a --amend --no-edit'])
    expect(repo.branches['main']).toBe('C2')
    expect(repo.commits['C2']).toMatchObject({ parents: ['C0'], message: 'a' })
    expect(reachableCommits(repo).has('C1')).toBe(false)
  })

  it('元の Repo を変更しない', () => {
    const before = createRepo()
    commit(before, { allowEmpty: true })
    expect(before.branches['main']).toBe('C0')
    expect(Object.keys(before.commits)).toEqual(['C0'])
  })
})

describe('restore / rm', () => {
  it('restore は作業ディレクトリを、--staged はステージを戻す', () => {
    const staged = run(['echo "x" >> README.md', 'git add README.md'])
    const unstaged = run(['git restore --staged README.md'], staged)
    expect(workspaceStatus(unstaged).unstaged).toEqual([{ path: 'README.md', change: 'modified' }])
    const discarded = run(['git restore README.md'], unstaged)
    expect(discarded.workdir).toEqual(createRepo().workdir)
  })

  it('git rm はステージと作業ディレクトリから消し、rm は作業ディレクトリからだけ消す', () => {
    const gitRm = run(['git rm README.md'])
    expect(gitRm.index).toEqual({})
    expect(gitRm.workdir).toEqual({})
    const shellRm = run(['rm README.md'])
    expect(shellRm.index).toEqual(createRepo().index)
    expect(workspaceStatus(shellRm).unstaged).toEqual([{ path: 'README.md', change: 'deleted' }])
  })

  it('git rm はコミットしていない変更があるファイルを消さない', () => {
    const repo = run(['echo "x" >> README.md'])
    expect(executeCommand(repo, 'git rm README.md').ok).toBe(false)
    expect(executeCommand(repo, 'git rm -f README.md').ok).toBe(true)
  })
})

describe('branch / switch', () => {
  it('HEAD と同じコミットを指すブランチを作る', () => {
    const { repo } = createBranch(createRepo(), 'feature')
    expect(repo.branches['feature']).toBe('C0')
    expect(currentBranch(repo)).toBe('main')
  })

  it('既存のブランチ名や不正なブランチ名はエラーになる', () => {
    const repo = createRepo()
    expect(() => createBranch(repo, 'main')).toThrow(GitError)
    expect(() => createBranch(repo, '-bad')).toThrow(GitError)
    expect(() => createBranch(repo, 'a..b')).toThrow(GitError)
  })

  it('switch で作業ディレクトリが切り替え先のコミットの内容になる', () => {
    const repo = run(['git switch -c feature', ...commitFile('f.txt', 'f'), 'git switch main'])
    expect(repo.workdir).toEqual(createRepo().workdir)
    expect(run(['git switch feature'], repo).workdir['f.txt']).toBe('f\n')
  })

  it('上書きされないコミットしていない変更は、切り替え先に持ち越す', () => {
    const repo = run(['git switch -c feature', ...commitFile('f.txt', 'f'), 'git switch main', 'echo "x" >> README.md', 'git switch feature'])
    expect(repo.workdir['README.md']).toBe('# BranchLab\nx\n')
    expect(repo.workdir['f.txt']).toBe('f\n')
  })

  it('上書きされる変更があると switch できない', () => {
    const repo = run(['git switch -c feature', ...commitFile('README.md', 'f'), 'git switch main', 'echo "x" >> README.md'])
    const result = executeCommand(repo, 'git switch feature')
    expect(result.ok).toBe(false)
    expect(result.output).toContain('上書きされます')
    expect(result.output).toContain('README.md')
  })

  it('origin にだけあるブランチへの switch は追跡ブランチを作る', () => {
    const repo = run(['git switch -c topic', 'git commit --allow-empty -m t', 'git push -u origin topic', 'git switch main', 'git branch -D topic', 'git switch topic'])
    expect(repo.branches['topic']).toBe('C1')
    expect(repo.upstreams['topic']).toBe('topic')
  })

  it('存在しないブランチへの switch はエラーになる', () => {
    expect(() => switchBranch(createRepo(), 'nope')).toThrow(GitError)
  })

  it('branch -d はマージされていないブランチを消さない', () => {
    const repo = run(['git switch -c feature', 'git commit --allow-empty -m f', 'git switch main'])
    expect(executeCommand(repo, 'git branch -d feature').ok).toBe(false)
    expect(run(['git branch -D feature'], repo).branches['feature']).toBeUndefined()
  })
})

describe('isAncestor / mergeBase', () => {
  it('祖先と最も新しい共通祖先を求める', () => {
    const repo = run(['git commit --allow-empty -m x', 'git switch -c feature', 'git commit --allow-empty -m x', 'git switch main', 'git commit --allow-empty -m x'])
    expect(isAncestor(repo, 'C0', 'C2')).toBe(true)
    expect(isAncestor(repo, 'C2', 'C2')).toBe(true)
    expect(isAncestor(repo, 'C2', 'C0')).toBe(false)
    expect(mergeBase(repo, 'C2', 'C3')).toBe('C1')
  })
})

describe('resolveRef', () => {
  it('HEAD・ブランチ名・origin/<名前>・コミット ID を解決する', () => {
    const repo = run(['git branch feature'], linearRepo())
    expect(resolveRef(repo, 'HEAD')).toBe('C3')
    expect(resolveRef(repo, '@')).toBe('C3')
    expect(resolveRef(repo, 'feature')).toBe('C3')
    expect(resolveRef(repo, 'origin/main')).toBe('C0')
    expect(resolveRef(repo, 'C1')).toBe('C1')
  })

  it('~n は第 1 親を n 回たどり、^ は親をたどる', () => {
    const repo = linearRepo()
    expect(resolveRef(repo, 'HEAD~')).toBe('C2')
    expect(resolveRef(repo, 'HEAD~2')).toBe('C1')
    expect(resolveRef(repo, 'HEAD^^')).toBe('C1')
    expect(resolveRef(repo, 'main~1^')).toBe('C1')
    expect(resolveRef(repo, 'HEAD^0')).toBe('C3')
  })

  it('^2 はマージコミットの 2 番目の親をたどる', () => {
    const repo = run(['git switch -c feature', ...commitFile('f.txt', 'f'), 'git switch main', ...commitFile('m.txt', 'm'), 'git merge --no-edit feature'])
    expect(resolveRef(repo, 'HEAD^1')).toBe('C2')
    expect(resolveRef(repo, 'HEAD^2')).toBe('C1')
  })

  it('存在しない指定や親のないコミットはエラーになる', () => {
    const repo = linearRepo()
    expect(() => resolveRef(repo, 'nope')).toThrow(GitError)
    expect(() => resolveRef(repo, 'HEAD~4')).toThrow(GitError)
    expect(() => resolveRef(repo, 'HEAD^2')).toThrow(GitError)
    expect(() => resolveRef(repo, '~1')).toThrow(GitError)
  })
})

describe('reset', () => {
  it('現在のブランチだけを移動し、--hard はステージと作業ディレクトリも戻す', () => {
    const before = run(['git branch keep'], linearRepo())
    const { repo, output } = reset(before, 'HEAD~2', 'hard')
    expect(repo.branches['main']).toBe('C1')
    expect(repo.branches['keep']).toBe('C3')
    expect(repo.workdir['a.txt']).toBe('a\n')
    expect(repo.index).toEqual(repo.workdir)
    expect(output).toBe('HEAD is now at C1 a')
  })

  it('--soft は変更をステージに残し、--mixed は作業ディレクトリに残す', () => {
    const soft = reset(linearRepo(), 'HEAD~1', 'soft').repo
    expect(workspaceStatus(soft).staged).toEqual([{ path: 'a.txt', change: 'modified' }])
    const mixed = reset(linearRepo(), 'HEAD~1', 'mixed').repo
    expect(workspaceStatus(mixed).staged).toEqual([])
    expect(workspaceStatus(mixed).unstaged).toEqual([{ path: 'a.txt', change: 'modified' }])
    expect(mixed.workdir['a.txt']).toBe('a\nb\nc\n')
  })

  it('外れたコミットは消さずに残し、コミット ID で戻れる', () => {
    const back = reset(linearRepo(), 'C1', 'hard').repo
    expect(Object.keys(back.commits)).toHaveLength(4)
    expect(reachableCommits(back)).toEqual(new Set(['C0', 'C1']))
    const forward = reset(back, 'C3', 'hard').repo
    expect(forward.branches['main']).toBe('C3')
    expect(reachableCommits(forward).size).toBe(4)
  })

  it('reset <ファイル> はステージだけを戻す', () => {
    const repo = run(['echo "x" >> README.md', 'git add .', 'git reset README.md'])
    expect(repo.index).toEqual(createRepo().index)
    expect(repo.workdir['README.md']).toBe('# BranchLab\nx\n')
  })

  it('detached HEAD では HEAD そのものを移動する', () => {
    const before = run(['git switch --detach HEAD'], linearRepo())
    const { repo } = reset(before, 'HEAD~1', 'hard')
    expect(repo.head).toEqual({ type: 'detached', id: 'C2' })
    expect(repo.branches['main']).toBe('C3')
  })
})

describe('status', () => {
  it('ステージ済み・未ステージ・未追跡を分けて表示する', () => {
    const repo = run(['echo "x" >> README.md', 'echo "a" > a.txt', 'git add a.txt', 'touch b.txt'])
    const { output } = executeCommand(repo, 'git status')
    expect(output).toContain('ブランチ main')
    expect(output).toContain("このブランチは 'origin/main' と比較して最新です。")
    expect(output).toMatch(/コミット予定の変更点:\n\t新規ファイル: {2}a\.txt/)
    expect(output).toMatch(/コミット予定に含まれていない変更:\n\t変更: {2}README\.md/)
    expect(output).toMatch(/追跡されていないファイル:\n\tb\.txt/)
  })

  it('クリーンなら作業ツリーがクリーンだと表示する', () => {
    expect(executeCommand(createRepo(), 'git status').output).toContain('作業ツリーはクリーンです')
  })
})
