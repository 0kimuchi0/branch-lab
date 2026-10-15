import { describe, expect, it } from 'vitest'
import { run } from '../test/run'
import { executeCommand } from './commands'
import { headTree, type Repo } from './model'

function output(repo: Repo, command: string): string {
  const result = executeCommand(repo, command)
  if (!result.ok) throw new Error(`"${command}" が失敗しました:\n${result.output}`)
  return result.output
}

const LINES = Array.from({ length: 12 }, (_, i) => `l${i + 1}`)

/** 行を 1 行ずつ書くコマンド。 */
function write(file: string, lines: readonly string[]): string[] {
  return lines.map((line, index) => `echo ${line} ${index === 0 ? '>' : '>>'} ${file}`)
}

/** a.txt の 1 行目と 12 行目 (離れた 2 つのハンク) と、b.txt を変えた状態。 */
function changed(): Repo {
  return run([
    ...write('a.txt', LINES),
    'echo b > b.txt',
    'git add .',
    'git commit -m base',
    "sed -i 's/^l1$/L1/' a.txt",
    "sed -i 's/l12/L12/' a.txt",
    'echo b2 >> b.txt',
  ])
}

describe('git add -p', () => {
  it('ハンクごとに尋ね、y のハンクだけをステージする', () => {
    const first = executeCommand(changed(), 'git add -p')
    expect(first.output).toBe(
      [
        'diff --git a/a.txt b/a.txt',
        '--- a/a.txt',
        '+++ b/a.txt',
        '@@ -1,4 +1,4 @@',
        '-l1',
        '+L1',
        ' l2',
        ' l3',
        ' l4',
        '(1/2) このハンクをステージしますか [y,n,q,a,d,?]? ',
      ].join('\n'),
    )
    expect(first.repo.prompt?.command).toBe('git add -p')
    const repo = run(['n', 'y', 'y'], first.repo)
    expect(repo.prompt).toBeNull()
    expect(repo.index['a.txt']).toBe(`${LINES.slice(0, 11).join('\n')}\nL12\n`)
    expect(repo.index['b.txt']).toBe('b\nb2\n')
    expect(repo.workdir['a.txt']?.startsWith('L1\n')).toBe(true)
  })

  it('a はこのファイルの残りをすべて、d はすべてしない、q はそこで終わる', () => {
    expect(run(['git add -p', 'a', 'n'], changed()).index['a.txt']).toBe(changed().workdir['a.txt'])
    const skipped = run(['git add -p', 'd', 'y'], changed())
    expect(skipped.index['a.txt']).toBe(changed().index['a.txt'])
    expect(skipped.index['b.txt']).toBe('b\nb2\n')
    const quit = run(['git add -p', 'y', 'q'], changed())
    expect(quit.prompt).toBeNull()
    expect(quit.index['a.txt']?.startsWith('L1\n')).toBe(true)
    expect(quit.index['b.txt']).toBe('b\n')
  })

  it('s で、近くにある変更を小さなハンクに分ける', () => {
    const repo = run([...write('c.txt', ['x1', 'x2', 'x3', 'x4']), 'git add c.txt', 'git commit -m c', "sed -i 's/x1/X1/' c.txt", "sed -i 's/x4/X4/' c.txt"])
    const started = executeCommand(repo, 'git add -p')
    expect(started.output.endsWith('(1/1) このハンクをステージしますか [y,n,q,a,d,s,?]? ')).toBe(true)
    const split = executeCommand(started.repo, 's')
    expect(split.output.split('\n')[0]).toBe('Split into 2 hunks.')
    expect(split.output.endsWith('(1/2) このハンクをステージしますか [y,n,q,a,d,?]? ')).toBe(true)
    expect(run(['n', 'y'], split.repo).index['c.txt']).toBe('x1\nx2\nx3\nX4\n')
  })

  it('? でヘルプを出し、答えるまでほかのコマンドは答えとして読む', () => {
    const started = executeCommand(changed(), 'git add -p').repo
    expect(output(started, '?')).toContain('y - このハンクをステージする')
    expect(output(started, 'git status')).toContain('d - このハンクと、このファイルの残りのハンクをすべて n にする')
    expect(executeCommand(started, 'cd ..').ok).toBe(false)
  })

  it('ファイルの削除はまとめて尋ね、追跡していないファイルは尋ねない', () => {
    const repo = run(['rm README.md', 'echo n > new.txt'])
    const started = executeCommand(repo, 'git add -p')
    expect(started.output.endsWith('(1/1) このファイルの削除をステージしますか [y,n,q,a,d,?]? ')).toBe(true)
    expect('README.md' in run(['y'], started.repo).index).toBe(false)
    expect(output(run([]), 'git add -p')).toBe('No changes.')
  })
})

describe('git restore -p / reset -p / checkout -p', () => {
  it('restore -p は y の変更を作業ディレクトリから捨てる', () => {
    const repo = run(['git restore -p', 'y', 'n', 'n'], changed())
    expect(repo.workdir['a.txt']).toBe(`${LINES.slice(0, 11).join('\n')}\nL12\n`)
    expect(repo.workdir['b.txt']).toBe('b\nb2\n')
    expect(run(['git checkout -p', 'y', 'y', 'y'], changed()).workdir).toEqual(headTree(changed()))
  })

  it('restore --staged -p と reset -p は、y の変更のステージを取り消す', () => {
    const staged = run(['git add .'], changed())
    const started = executeCommand(staged, 'git restore --staged -p a.txt')
    expect(started.output.endsWith('(1/2) このハンクのステージを取り消しますか [y,n,q,a,d,?]? ')).toBe(true)
    const repo = run(['y', 'n'], started.repo)
    expect(repo.index['a.txt']).toBe(`${LINES.slice(0, 11).join('\n')}\nL12\n`)
    expect(repo.workdir['a.txt']).toBe(staged.workdir['a.txt'])
    expect(run(['git reset -p', 'a'], staged).index['b.txt']).toBe(staged.index['b.txt'])
    expect(run(['git reset -p', 'd', 'y'], staged).index['b.txt']).toBe('b\n')
  })
})
