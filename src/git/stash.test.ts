import { describe, expect, it } from 'vitest'
import { commitFile, run } from '../test/run'
import { executeCommand } from './commands'
import { createRepo, workspaceStatus, type Repo } from './model'

function out(repo: Repo, line: string): string {
  const result = executeCommand(repo, line)
  expect(result.ok, result.output).toBe(true)
  return result.output
}

/** README.md の変更をステージし、さらに作業ディレクトリでも変え、未追跡ファイルもある Repo。 */
function dirty(): Repo {
  return run(['echo "staged" >> README.md', 'git add .', 'echo "unstaged" >> README.md', 'touch note.txt'])
}

describe('git stash push', () => {
  it('追跡しているファイルの変更を退避し、HEAD の状態に戻す (未追跡ファイルは残る)', () => {
    const repo = run(['git stash'], dirty())
    expect(repo.stash).toHaveLength(1)
    expect(repo.stash[0]?.message).toBe('WIP on main: C0 Initial commit')
    expect(repo.index).toEqual(createRepo().index)
    expect(repo.workdir).toEqual({ ...createRepo().workdir, 'note.txt': '' })
    expect(out(repo, 'git stash list')).toBe('stash@{0}: WIP on main: C0 Initial commit')
  })

  it('-m でメッセージを付け、-u で未追跡ファイルも退避する', () => {
    const repo = run(['git stash push -u -m "作業中"'], dirty())
    expect(repo.stash[0]?.message).toBe('On main: 作業中')
    expect(repo.workdir).toEqual(createRepo().workdir)
  })

  it('-k はステージした変更を残す', () => {
    const repo = run(['git stash -k'], dirty())
    expect(repo.index['README.md']).toBe('# BranchLab\nstaged\n')
    expect(repo.workdir['README.md']).toBe('# BranchLab\nstaged\n')
  })

  it('変更がなければ失敗し、新しいものほど stash@{0} になる', () => {
    expect(executeCommand(createRepo(), 'git stash').output).toBe('No local changes to save')
    const repo = run(['echo a >> README.md', 'git stash', 'echo b >> README.md', 'git stash -m second'])
    expect(out(repo, 'git stash list')).toBe(
      'stash@{0}: On main: second\nstash@{1}: WIP on main: C0 Initial commit',
    )
  })
})

describe('git stash apply / pop', () => {
  it('pop で変更を戻して stash を消す。--index ならステージの状態も戻す', () => {
    const stashed = run(['git stash'], dirty())
    const popped = run(['git stash pop'], stashed)
    expect(popped.stash).toEqual([])
    expect(popped.workdir['README.md']).toBe('# BranchLab\nstaged\nunstaged\n')
    expect(workspaceStatus(popped).staged).toEqual([])

    const withIndex = run(['git stash pop --index'], stashed)
    expect(withIndex.index['README.md']).toBe('# BranchLab\nstaged\n')
  })

  it('apply は stash を残し、別のコミットの上にも戻せる', () => {
    const repo = run(['echo wip > wip.txt', 'git add .', 'git stash', ...commitFile('other.txt', 'x'), 'git stash apply'])
    expect(repo.stash).toHaveLength(1)
    expect(repo.workdir).toMatchObject({ 'wip.txt': 'wip\n', 'other.txt': 'x\n' })
    // 退避したときに新しく追加したファイルは、ステージにも戻る
    expect(repo.index['wip.txt']).toBe('wip\n')
  })

  it('同じ箇所が変わっていたらコンフリクトし、pop でも stash は残る', () => {
    const repo = run(['echo "mine" > README.md', 'git stash', 'echo "theirs" > README.md', 'git commit -am theirs'])
    const result = executeCommand(repo, 'git stash pop')
    expect(result.output).toContain('The stash entry is kept')
    expect(result.repo.stash).toHaveLength(1)
    expect(result.repo.conflicts).toEqual([{ path: 'README.md', kind: 'both-modified' }])
    expect(result.repo.workdir['README.md']).toBe(
      '<<<<<<< Updated upstream\ntheirs\n=======\nmine\n>>>>>>> Stashed changes\n',
    )
  })

  it('コミットしていない変更が上書きされるなら中止する', () => {
    const repo = run(['echo "a" >> README.md', 'git stash', 'echo "b" >> README.md'])
    const result = executeCommand(repo, 'git stash apply')
    expect(result.ok).toBe(false)
    expect(result.output).toContain('上書きされます')
  })

  it('show・drop・clear・存在しない stash', () => {
    const repo = run(['echo "a" >> README.md', 'git stash'])
    expect(out(repo, 'git stash show')).toContain('README.md | 1 +')
    expect(out(repo, 'git stash show -p')).toContain('+a')
    expect(run(['git stash drop'], repo).stash).toEqual([])
    expect(run(['git stash clear'], repo).stash).toEqual([])
    expect(executeCommand(repo, 'git stash pop stash@{3}').ok).toBe(false)
    expect(executeCommand(createRepo(), 'git stash pop').output).toBe('No stash entries found.')
  })

  it('stash branch は退避したときの HEAD から新しいブランチを作って pop する', () => {
    const repo = run(['echo wip >> README.md', 'git stash', ...commitFile('x.txt', 'x'), 'git stash branch wip'])
    expect(repo.head).toEqual({ type: 'branch', name: 'wip' })
    expect(repo.branches['wip']).toBe('C0')
    expect(repo.workdir['README.md']).toBe('# BranchLab\nwip\n')
    expect(repo.stash).toEqual([])
  })
})
