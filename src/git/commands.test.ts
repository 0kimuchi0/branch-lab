import { describe, expect, it } from 'vitest'
import { run } from '../test/run'
import { executeCommand, tokenize } from './commands'
import { createRepo, currentBranch } from './model'

describe('tokenize', () => {
  it('引用符で囲まれた部分を 1 つのトークンにする', () => {
    expect(tokenize('commit -m "add login form"')).toEqual(['commit', '-m', 'add login form'])
    expect(tokenize("commit -m 'it works'")).toEqual(['commit', '-m', 'it works'])
  })

  it('リダイレクトは空白がなくても分ける', () => {
    expect(tokenize('echo hi>>a.txt')).toEqual(['echo', 'hi', '>>', 'a.txt'])
  })
})

describe('シェルのコマンド', () => {
  it('echo の > は上書き、>> は追記し、cat で表示する', () => {
    const repo = run(['echo "one" > a.txt', 'echo two >> a.txt'])
    expect(repo.workdir['a.txt']).toBe('one\ntwo\n')
    expect(executeCommand(repo, 'cat a.txt').output).toBe('one\ntwo')
    expect(executeCommand(repo, 'ls').output).toBe('README.md\na.txt')
  })

  it('引用符の中の > はリダイレクトにしない', () => {
    expect(executeCommand(createRepo(), 'echo "a > b"').output).toBe('a > b')
  })

  it('不正なファイル名やないファイルはエラーになる', () => {
    const repo = createRepo()
    expect(executeCommand(repo, 'echo x > ../a').ok).toBe(false)
    expect(executeCommand(repo, 'cat nope').ok).toBe(false)
    expect(executeCommand(repo, 'rm nope').ok).toBe(false)
  })
})

describe('executeCommand', () => {
  it('先頭の git は省略できる', () => {
    const a = executeCommand(createRepo(), 'commit --allow-empty -m "x"')
    const b = executeCommand(createRepo(), 'git commit --allow-empty -m "x"')
    expect(a.repo).toEqual(b.repo)
    expect(a.ok).toBe(true)
  })

  it('一連の操作を順に実行できる', () => {
    const repo = run([
      'git switch -c feature',
      'echo "f" > f.txt',
      'git add .',
      'git commit -m "f1"',
      'git switch main',
      'echo "m" > m.txt',
      'git add m.txt',
      'git commit -m "m1"',
      'git merge --no-edit feature',
    ])
    expect(currentBranch(repo)).toBe('main')
    expect(Object.keys(repo.commits)).toHaveLength(4)
  })

  it('-am はまとめて指定できる', () => {
    const repo = run(['echo "x" >> README.md', 'git commit -am "edit"'])
    expect(repo.commits['C1']?.message).toBe('edit')
  })

  it('checkout はブランチ・コミット・ファイルで動きを変える', () => {
    const repo = run(['git commit --allow-empty -m x', 'git checkout -b topic'])
    expect(currentBranch(repo)).toBe('topic')
    expect(run(['git checkout C0'], repo).head).toEqual({ type: 'detached', id: 'C0' })
    const edited = run(['echo x >> README.md', 'git checkout -- README.md'], repo)
    expect(edited.workdir).toEqual(repo.workdir)
  })

  it('switch にコミットを渡すと --detach を案内する', () => {
    const result = executeCommand(createRepo(), 'git switch C0')
    expect(result.ok).toBe(false)
    expect(result.output).toContain('git switch --detach C0')
  })

  it('reset はモードと移動先、ファイル指定を区別する', () => {
    const repo = run(['git commit --allow-empty -m x', 'git commit --allow-empty -m x', 'git commit --allow-empty -m x'])
    const hard = executeCommand(repo, 'git reset --hard HEAD~2')
    expect(hard.repo.branches['main']).toBe('C1')
    expect(hard.output).toBe('HEAD is now at C1 x')
    expect(executeCommand(repo, 'reset C2 --soft').repo.branches['main']).toBe('C2')
    expect(executeCommand(hard.repo, 'reset C3').repo.branches['main']).toBe('C3')
    expect(executeCommand(repo, 'git reset --hard README.md').ok).toBe(false)
  })

  it('規則に反する操作は ok: false を返し Repo を変えない', () => {
    const repo = createRepo()
    for (const line of [
      'git switch nope',
      'git commit',
      'git commit -m',
      'git reset nope',
      'git reset HEAD~1',
      'git reset --keep',
      'git reset --soft --hard',
      'git merge',
      'git push upstream main',
      'git stash',
      'teammate nope',
    ]) {
      const result = executeCommand(repo, line)
      expect(result.ok, line).toBe(false)
      expect(result.repo).toBe(repo)
    }
  })

  it('git だけ、または help で使い方を表示する', () => {
    expect(executeCommand(createRepo(), 'git').output).toContain('記録する (基本):')
    expect(executeCommand(createRepo(), 'help').output).toContain('git rm を区別')
  })

  it('空入力は何もしない', () => {
    const repo = createRepo()
    expect(executeCommand(repo, '   ')).toEqual({ repo, output: '', ok: true })
  })
})
