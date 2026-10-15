import { describe, expect, it } from 'vitest'
import { run } from '../test/run'
import { executeCommand } from './commands'
import { headCommitId, type Repo } from './model'
import { activeRepo } from './submodule'
import { parseGitlink } from './tree'
import { currentDirectory } from './worktree'

function output(repo: Repo, command: string): string {
  const result = executeCommand(repo, command)
  if (!result.ok) throw new Error(`"${command}" が失敗しました:\n${result.output}`)
  return result.output
}

/** lib (サブモジュール) の中に util (サブモジュール) があり、それぞれ push 済みの状態。 */
function nested(): Repo {
  return run([
    'git submodule add https://example.com/lib.git',
    'cd lib',
    'git submodule add https://example.com/util.git',
    'git commit -m "util を追加"',
    'git push',
    'cd ~/branch-lab',
    'git add lib',
    'git commit -m "lib を追加"',
    'git push',
  ])
}

describe('サブモジュールの中のサブモジュール', () => {
  it('cd で中に入り、そこでコマンドを実行する', () => {
    const repo = run(['cd lib/util', 'echo u > u.txt', 'git add u.txt', 'git commit -m U'], nested())
    expect(currentDirectory(repo)).toBe('~/branch-lab/lib/util')
    expect(headCommitId(activeRepo(repo))).toBe('U1')
    // 親の作業ディレクトリの gitlink は、中のサブモジュールの HEAD に合わせる
    const lib = repo.submodules['lib'] as Repo
    expect(parseGitlink(lib.workdir['util'])).toBe('U1')
    expect(output(run(['cd ..'], repo), 'git status')).toContain('変更:  util (new commits)')
    expect(output(run(['cd ~/branch-lab'], repo), 'git status')).toContain('変更:  lib (modified content)')
  })

  it('status / update / foreach の --recursive', () => {
    const repo = nested()
    expect(output(repo, 'git submodule status --recursive')).toBe(' L1 lib (heads/main)\n U0 lib/util (heads/main)')
    expect(output(repo, 'git submodule foreach --recursive "echo $displaypath $sha1 $toplevel"')).toBe(
      ["Entering 'lib'", 'lib L1 ~/branch-lab', "Entering 'lib/util'", 'lib/util U0 ~/branch-lab/lib'].join('\n'),
    )
    const cloned = run(['git clone https://example.com/branch-lab.git ../fresh', 'cd ../fresh'], repo)
    expect(output(cloned, 'git submodule update --init --recursive')).toBe(
      [
        "Submodule 'lib' (https://example.com/lib.git) registered for path 'lib'",
        "Cloning into '~/fresh/lib'...",
        "Submodule path 'lib': checked out 'L1'",
        "Submodule 'util' (https://example.com/util.git) registered for path 'lib/util'",
        "Cloning into '~/fresh/lib/util'...",
        "Submodule path 'lib/util': checked out 'U0'",
      ].join('\n'),
    )
    // --recursive がなければ lib だけ
    const shallow = run(['git submodule update --init'], cloned)
    expect(shallow.clones['~/fresh']?.submodules['lib']?.submodules).toEqual({})
  })

  it('clone --recurse-submodules は中のサブモジュールまで取ってくる', () => {
    const repo = run(['git clone --recurse-submodules https://example.com/branch-lab.git ../fresh', 'cd ../fresh/lib/util'], nested())
    expect(currentDirectory(repo)).toBe('~/fresh/lib/util')
    expect(headCommitId(activeRepo(repo))).toBe('U0')
  })

  it('チェックアウトしていない中のサブモジュールには cd できない', () => {
    const repo = run(['git clone --recurse-submodules https://example.com/branch-lab.git ../fresh', 'cd ../fresh/lib', 'git submodule deinit --all'], nested())
    expect(executeCommand(repo, 'cd util').output).toBe('cd: util: サブモジュールの中身がありません (git submodule update --init で取得します)')
  })
})

describe('clone したリポジトリとサブモジュールの中の worktree', () => {
  it('clone したリポジトリで worktree を作って移る', () => {
    const repo = run(
      [
        'git clone https://example.com/branch-lab.git ../teammate',
        'cd ../teammate',
        'git worktree add -b topic ../teammate-topic',
        'cd ../teammate-topic',
        'echo t > t.txt',
        'git add t.txt',
        'git commit -m T',
      ],
      nested(),
    )
    expect(currentDirectory(repo)).toBe('~/teammate-topic')
    const teammate = repo.clones['~/teammate'] as Repo
    expect(teammate.branches['topic']).toBe('C2')
    expect(output(repo, 'git worktree list')).toBe('~/teammate       C1 [main]\n~/teammate-topic C2 [topic]')
    expect(executeCommand(repo, 'git worktree remove ../teammate').output).toBe("fatal: '~/teammate' is a main working tree")
    expect(currentDirectory(run(['cd ../teammate'], repo))).toBe('~/teammate')
  })

  it('サブモジュールの worktree で作業しても、親の gitlink はサブモジュールの元の場所に合わせる', () => {
    const repo = run(['cd lib', 'git worktree add ../../lib-wt', 'cd ~/lib-wt', 'echo w > w.txt', 'git add w.txt', 'git commit -m W'], nested())
    expect(currentDirectory(repo)).toBe('~/lib-wt')
    const lib = repo.submodules['lib'] as Repo
    expect(lib.branches['lib-wt']).toBe('L2')
    expect(parseGitlink(repo.workdir['lib'])).toBe('L1')
    // 親に戻ると、サブモジュールは元の場所の状態に戻る
    const back = run(['cd ~/branch-lab'], repo)
    expect(back.submodules['lib']?.worktree).toBe('~/branch-lab/lib')
    expect(output(back, 'git submodule status')).toBe(' L1 lib (heads/main)')
  })

  it('ほかのリポジトリや worktree と同じ場所には作れない', () => {
    const repo = run(['git clone https://example.com/branch-lab.git ../teammate'], nested())
    expect(executeCommand(repo, 'cd lib').ok).toBe(true)
    const inLib = run(['cd lib'], repo)
    expect(executeCommand(inLib, 'git worktree add ../../teammate').output).toBe("fatal: '~/teammate' already exists")
  })
})
