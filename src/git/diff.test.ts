import { describe, expect, it } from 'vitest'
import { diffHunks, diffTrees } from './diff'

describe('diffHunks', () => {
  it('変更の前後 3 行を文脈として付ける', () => {
    const old = '1\n2\n3\n4\n5\n6\n7\n8\n9\n'
    const next = '1\n2\n3\n4\nfive\n6\n7\n8\n9\n'
    expect(diffHunks(old, next)).toEqual(['@@ -2,7 +2,7 @@', ' 2', ' 3', ' 4', '-5', '+five', ' 6', ' 7', ' 8'])
  })

  it('離れた変更は別のハンクにする', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `${i + 1}\n`)
    const next = [...lines]
    next[0] = 'one\n'
    next[19] = 'twenty\n'
    const hunks = diffHunks(lines.join(''), next.join(''))
    expect(hunks.filter((line) => line.startsWith('@@'))).toEqual(['@@ -1,4 +1,4 @@', '@@ -17,4 +17,4 @@'])
  })

  it('空のファイルからの追加は -0,0 で表し、末尾に改行がなければ注記する', () => {
    expect(diffHunks('', 'a\nb')).toEqual(['@@ -0,0 +1,2 @@', '+a', '+b', '\\ No newline at end of file'])
  })
})

describe('diffTrees', () => {
  it('追加・変更・削除を git diff の形式で出す', () => {
    const output = diffTrees({ 'a.txt': 'a\n', 'gone.txt': 'x\n' }, { 'a.txt': 'A\n', 'new.txt': 'n\n' })
    expect(output).toBe(
      [
        'diff --git a/a.txt b/a.txt', '--- a/a.txt', '+++ b/a.txt', '@@ -1 +1 @@', '-a', '+A',
        'diff --git a/gone.txt b/gone.txt', 'deleted file mode 100644', '--- a/gone.txt', '+++ /dev/null', '@@ -1 +0,0 @@', '-x',
        'diff --git a/new.txt b/new.txt', 'new file mode 100644', '--- /dev/null', '+++ b/new.txt', '@@ -0,0 +1 @@', '+n',
      ].join('\n'),
    )
  })

  it('空のファイルの追加はヘッダーだけ', () => {
    expect(diffTrees({}, { 'e.txt': '' })).toBe('diff --git a/e.txt b/e.txt\nnew file mode 100644')
  })

  it('--name-only と --stat、パスの絞り込み', () => {
    const from = { 'a.txt': 'a\n', 'dir/b.txt': 'b\n' }
    const to = { 'a.txt': 'a\nmore\n', 'dir/b.txt': 'B\n' }
    expect(diffTrees(from, to, { nameOnly: true })).toBe('a.txt\ndir/b.txt')
    expect(diffTrees(from, to, { nameOnly: true, paths: ['dir'] })).toBe('dir/b.txt')
    expect(diffTrees(from, to, { stat: true })).toBe(
      ' a.txt     |  1 +\n dir/b.txt |  2 +-\n 2 files changed, 2 insertions(+), 1 deletion(-)',
    )
  })
})
