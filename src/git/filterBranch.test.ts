import { describe, expect, it } from 'vitest'
import { commitFile, run } from '../test/run'
import { executeCommand } from './commands'
import { headTree, type Repo } from './model'

const QUIET = 'FILTER_BRANCH_SQUELCH_WARNING=1 '

function output(repo: Repo, command: string): string {
  const result = executeCommand(repo, command)
  if (!result.ok) throw new Error(`"${command}" が失敗しました:\n${result.output}`)
  return result.output
}

/** main: C0 - C1 (A) - C2 (secret.txt を追加) - C3 (B) */
function withSecret(): Repo {
  return run([
    ...commitFile('app.txt', 'A', 'A'),
    ...commitFile('secret.txt', 'password', '設定を追加'),
    ...commitFile('app.txt', 'B', 'B'),
  ])
}

describe('git filter-branch', () => {
  it('--index-filter と --prune-empty で、ファイルを履歴から取り除く', () => {
    const result = executeCommand(withSecret(), "git filter-branch --index-filter 'git rm --cached --ignore-unmatch secret.txt' --prune-empty")
    expect(result.ok).toBe(true)
    expect(result.output).toContain('WARNING: git-filter-branch には')
    expect(result.output.split('\n').slice(-2)).toEqual([
      'Rewrite C3 (4/4) (0 seconds passed, remaining 0 predicted)',
      "Ref 'refs/heads/main' was rewritten",
    ])
    const repo = result.repo
    expect(output(repo, 'git log --oneline')).toBe(['C4 (HEAD -> main) B', 'C1 A', 'C0 (origin/main) Initial commit'].join('\n'))
    expect(repo.commits['C4']).toMatchObject({ parents: ['C1'], source: 'C3' })
    expect(repo.originalRefs).toEqual({ 'refs/original/refs/heads/main': 'C3' })
    expect(repo.reflogs['main']?.[0]).toEqual({ id: 'C4', message: 'filter-branch: rewrite' })
    expect(Object.keys(repo.workdir).sort()).toEqual(['README.md', 'app.txt'])
    expect(Object.keys(repo.index).sort()).toEqual(['README.md', 'app.txt'])
  })

  it('--tree-filter は作業ディレクトリでコマンドを実行する', () => {
    const repo = run([`${QUIET}git filter-branch --tree-filter 'rm -f secret.txt && echo "# $GIT_COMMIT" >> app.txt'`], withSecret())
    expect(output(repo, 'git log --oneline')).toBe(
      ['C7 (HEAD -> main) B', 'C6 設定を追加', 'C5 A', 'C4 Initial commit'].join('\n'),
    )
    expect(headTree(repo)['app.txt']).toBe('A\nB\n# C3\n')
    expect('secret.txt' in headTree(repo)).toBe(false)
  })

  it('--msg-filter は標準入力のメッセージを書き換える', () => {
    const repo = run([`${QUIET}git filter-branch --msg-filter 'sed "s/^/[app] /"' HEAD~2..HEAD`], withSecret())
    expect(output(repo, 'git log --oneline')).toBe(
      ['C5 (HEAD -> main) [app] B', 'C4 [app] 設定を追加', 'C1 A', 'C0 (origin/main) Initial commit'].join('\n'),
    )
    const appended = run([`${QUIET}git filter-branch --msg-filter 'cat && echo "Signed-off-by: me"' HEAD~1..HEAD`], withSecret())
    expect(appended.commits['C4']?.message).toBe('B\nSigned-off-by: me')
  })

  it('内容が変わらないコミットは同じ ID のまま。何も変わらなければ unchanged の警告', () => {
    const result = executeCommand(withSecret(), `${QUIET}git filter-branch --msg-filter cat`)
    expect(result.ok).toBe(true)
    expect(result.output).toContain("WARNING: Ref 'refs/heads/main' is unchanged")
    expect(result.repo.originalRefs).toEqual({})
    expect(result.repo.branches['main']).toBe('C3')
  })

  it('--subdirectory-filter でディレクトリを一番上にし、関係ないコミットを除く', () => {
    const repo = run(
      [
        ...commitFile('lib/a.txt', 'a', 'lib A'),
        ...commitFile('app.txt', 'x', 'アプリ'),
        ...commitFile('lib/b.txt', 'b', 'lib B'),
        `${QUIET}git filter-branch --subdirectory-filter lib`,
      ],
    )
    expect(output(repo, 'git log --oneline')).toBe('C5 (HEAD -> main) lib B\nC4 lib A')
    expect(Object.keys(headTree(repo)).sort()).toEqual(['a.txt', 'b.txt'])
    expect(Object.keys(repo.workdir).sort()).toEqual(['a.txt', 'b.txt'])
  })

  it('--parent-filter で親を付け替える', () => {
    const repo = run([`${QUIET}git filter-branch --parent-filter 'sed "s/-p C1/-p C0/"' C1..HEAD`], withSecret())
    expect(output(repo, 'git log --oneline')).toBe(['C5 (HEAD -> main) B', 'C4 設定を追加', 'C0 (origin/main) Initial commit'].join('\n'))
  })

  it('前のバックアップがあれば -f が必要。update-ref -d で消せば、gc で元のコミットも消える', () => {
    const first = run([`${QUIET}git filter-branch --index-filter 'git rm --cached --ignore-unmatch secret.txt' --prune-empty`], withSecret())
    expect(executeCommand(first, `${QUIET}git filter-branch --msg-filter cat`).output).toBe(
      'Cannot create a new backup.\nA previous backup already exists in refs/original/\nForce overwriting the backup with -f',
    )
    const cleaned = run(
      ['git update-ref -d refs/original/refs/heads/main', 'git reflog expire --expire=now --all', 'git gc --prune=now'],
      first,
    )
    expect(Object.keys(cleaned.commits).sort()).toEqual(['C0', 'C1', 'C4'])
    expect(Object.values(cleaned.commits).some((commit) => 'secret.txt' in commit.tree)).toBe(false)
  })

  it('変更が残っていれば書き換えない', () => {
    const repo = run(['echo x >> app.txt'], withSecret())
    expect(executeCommand(repo, 'git filter-branch --msg-filter cat').output).toBe('Cannot rewrite branches: You have unstaged changes.')
    const staged = run(['git add app.txt'], repo)
    expect(executeCommand(staged, 'git filter-branch --msg-filter cat').output).toBe(
      'Cannot rewrite branches: Your index contains uncommitted changes.',
    )
  })

  it('-- --all はすべてのブランチを書き換え、--tag-name-filter cat でタグも付け直す', () => {
    const repo = run(
      [
        'git tag -a v1 -m "リリース" C2',
        'git branch topic C2',
        `${QUIET}git filter-branch --index-filter 'git rm --cached --ignore-unmatch secret.txt' --tag-name-filter cat -- --all`,
      ],
      withSecret(),
    )
    expect(repo.branches['topic']).toBe('C4')
    expect(repo.tags['v1']).toEqual({ target: 'C4', message: 'リリース' })
    expect(repo.originalRefs).toEqual({
      'refs/original/refs/heads/main': 'C3',
      'refs/original/refs/heads/topic': 'C2',
      'refs/original/refs/tags/v1': 'C2',
    })
    expect(output(repo, 'git log --oneline --all')).toContain('C3 (refs/original/refs/heads/main) B')
  })

  it('フィルタが失敗したら何も変えない', () => {
    const result = executeCommand(withSecret(), `${QUIET}git filter-branch --tree-filter 'cat nothing.txt'`)
    expect(result.ok).toBe(false)
    expect(result.output).toContain("tree filter failed: cat nothing.txt")
    expect(result.repo.branches['main']).toBe('C3')
  })

  it('--graft の置き換えを、書き換えた履歴に残す', () => {
    const repo = run(['git replace --graft C3 C1', `${QUIET}git filter-branch -- --all`, 'git replace -d C3'], withSecret())
    expect(output(repo, 'git log --oneline')).toBe(['C5 (HEAD -> main) B', 'C1 A', 'C0 (origin/main) Initial commit'].join('\n'))
  })
})

describe('フィルタで使うシェルのコマンド', () => {
  it('sed は s・d と -i・-E が使える', () => {
    const repo = run(['echo "foo bar" > a.txt', 'echo "baz" >> a.txt'])
    expect(output(repo, "sed 's/o/0/g' a.txt")).toBe('f00 bar\nbaz')
    expect(output(repo, "sed -E 's/(f)(o+)/\\2\\1/' a.txt")).toBe('oof bar\nbaz')
    expect(output(repo, "sed 's/\\(b\\)a/\\1A/' a.txt")).toBe('foo bAr\nbAz')
    expect(output(repo, "sed '/baz/d' a.txt")).toBe('foo bar')
    expect(output(repo, "sed -e 1d -e 's/z/Z/' a.txt")).toBe('baZ')
    expect(run(["sed -i 's/foo/FOO/' a.txt"], repo).workdir['a.txt']).toBe('FOO bar\nbaz\n')
  })

  it('mv・rm -r・mkdir', () => {
    const repo = run(['echo a > dir/a.txt', 'echo b > dir/b.txt', 'mkdir -p out', 'mv dir/a.txt out/', 'mv dir/b.txt c.txt'])
    expect(Object.keys(repo.workdir).sort()).toEqual(['README.md', 'c.txt', 'out/a.txt'])
    expect(executeCommand(repo, 'rm out').output).toBe("rm: cannot remove 'out': Is a directory")
    expect(Object.keys(run(['rm -rf out', 'rm -f nothing.txt'], repo).workdir).sort()).toEqual(['README.md', 'c.txt'])
  })
})
