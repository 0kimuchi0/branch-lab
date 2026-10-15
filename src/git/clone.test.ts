import { describe, expect, it } from 'vitest'
import { commitFile, run } from '../test/run'
import { executeCommand } from './commands'
import { ORIGIN_URL, currentBranch, headCommitId, type Repo } from './model'
import { activeRepo } from './submodule'

const out = (repo: Repo, line: string) => executeCommand(repo, line).output

describe('git clone', () => {
  it('origin の URL を clone し、cd で中に入ってコミットして push すると、元のリポジトリから pull できる', () => {
    const cloned = executeCommand(run(commitFile('a.txt', 'a').concat('git push')), `git clone ${ORIGIN_URL} ../teammate`)
    expect(cloned.output).toBe("Cloning into '../teammate'...")
    const teammate = run(['cd ../teammate', ...commitFile('t.txt', 't'), 'git push'], cloned.repo)
    expect(out(teammate, 'pwd')).toBe('~/teammate')
    expect(headCommitId(activeRepo(teammate))).toBe('C2')
    // コミット ID は元のリポジトリと共有の連番 (ぶつからない)
    const back = run(['cd ../branch-lab', 'git pull'], teammate)
    expect(back.branches['main']).toBe('C2')
    expect(run([...commitFile('b.txt', 'b')], back).branches['main']).toBe('C3')
  })

  it('既にある場所や、知らない URL は拒否する。--branch で clone するブランチを選ぶ', () => {
    const repo = run(['git switch -c dev', ...commitFile('d.txt', 'd'), 'git push -u origin dev', 'git switch main'])
    expect(out(repo, 'git clone https://example.com/nothing.git')).toContain("fatal: repository 'https://example.com/nothing.git' not found")
    expect(out(repo, `git clone ${ORIGIN_URL} ../branch-lab`)).toBe(
      "fatal: destination path '../branch-lab' already exists and is not an empty directory.",
    )
    const dev = run([`git clone -b dev ${ORIGIN_URL} ~/dev`, 'cd ~/dev'], repo)
    expect(currentBranch(activeRepo(dev))).toBe('dev')
    expect(out(dev, 'git branch -a')).toBe('* dev\n  remotes/origin/dev\n  remotes/origin/main')
  })

  it('--recurse-submodules でサブモジュールも取得する', () => {
    const repo = run(['git submodule add https://example.com/lib.git', 'git commit -m "lib を追加"', 'git push'])
    const cloned = executeCommand(repo, `git clone --recurse-submodules ${ORIGIN_URL} ../copy`)
    expect(cloned.output).toBe(
      [
        "Cloning into '../copy'...",
        "Submodule 'lib' (https://example.com/lib.git) registered for path 'lib'",
        "Cloning into '~/copy/lib'...",
        "Submodule path 'lib': checked out 'L0'",
      ].join('\n'),
    )
    const inside = run(['cd ../copy/lib', ...commitFile('x.txt', 'x')], cloned.repo)
    expect(out(inside, 'pwd')).toBe('~/copy/lib')
    // サブモジュールなしの clone は空のまま
    const plain = run([`git clone ${ORIGIN_URL} ../plain`, 'cd ../plain'], repo)
    expect(out(plain, 'git submodule status')).toBe('-L0 lib')
  })
})

describe('--recurse-submodules / submodule.recurse', () => {
  it('switch で、サブモジュールも記録したコミットにする', () => {
    const repo = run([
      'git submodule add https://example.com/lib.git',
      'git commit -m "lib を追加"',
      'git switch -c new',
      'cd lib', ...commitFile('x.txt', 'x'), 'cd ..',
      'git commit -am "lib を進める"',
    ])
    const plain = run(['git switch main'], repo)
    expect(out(plain, 'git submodule status')).toBe('+L1 lib (heads/main)')
    const recursed = executeCommand(repo, 'git switch --recurse-submodules main')
    expect(recursed.output).toContain("Submodule path 'lib': checked out 'L0'")
    expect(out(recursed.repo, 'git submodule status')).toBe(' L0 lib (remotes/origin/main)')
    const configured = run(['git config submodule.recurse true', 'git switch main'], repo)
    expect(out(configured, 'git submodule status')).toBe(' L0 lib (remotes/origin/main)')
  })
})
