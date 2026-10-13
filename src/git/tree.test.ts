import { describe, expect, it } from 'vitest'
import { changedPaths, mergeTrees, treesEqual, withFile } from './tree'

const labels = { ours: 'HEAD', theirs: 'feature' }

describe('changedPaths / treesEqual / withFile', () => {
  it('内容が異なるパスと片方にしかないパスを返す', () => {
    expect(changedPaths({ a: '1', b: '2' }, { a: '1', b: '3', c: '4' })).toEqual(['b', 'c'])
    expect(treesEqual({ a: '1' }, { a: '1' })).toBe(true)
  })

  it('withFile は元の Tree を変えずに追加・削除する', () => {
    const tree = { a: '1' }
    expect(withFile(tree, 'b', '2')).toEqual({ a: '1', b: '2' })
    expect(withFile(tree, 'a', undefined)).toEqual({})
    expect(tree).toEqual({ a: '1' })
  })
})

describe('mergeTrees', () => {
  it('片方だけの変更はそのまま取り込む', () => {
    const result = mergeTrees({ a: '1' }, { a: '1', b: '2' }, { a: '9' }, labels)
    expect(result).toEqual({ tree: { a: '9', b: '2' }, conflicts: [] })
  })

  it('同じ変更はコンフリクトにしない', () => {
    const result = mergeTrees({ a: '1' }, { a: '2' }, { a: '2' }, labels)
    expect(result.conflicts).toEqual([])
  })

  it('両方が別々に変えたファイルはマーカー付きでコンフリクトにする', () => {
    const result = mergeTrees({ a: '1' }, { a: '2' }, {}, labels)
    expect(result.conflicts).toEqual(['a'])
    expect(result.tree['a']).toBe(
      '<<<<<<< HEAD\n2\n=======\n(削除)\n>>>>>>> feature',
    )
  })
})
