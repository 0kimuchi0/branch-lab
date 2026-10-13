import { describe, expect, it } from 'vitest'
import { changedPaths, mergeText, mergeTrees, splitLines, treesEqual, withFile } from './tree'

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

  it('片方が削除し、もう片方が変更したファイルは変更側を残してコンフリクトにする', () => {
    const result = mergeTrees({ a: '1\n' }, { a: '2\n' }, {}, labels)
    expect(result).toEqual({ tree: { a: '2\n' }, conflicts: [{ path: 'a', kind: 'deleted-by-them' }] })
  })

  it('両方が同じファイルを変えたら行単位でマージする', () => {
    const merged = mergeTrees({ a: '1\n2\n3\n' }, { a: '1!\n2\n3\n' }, { a: '1\n2\n3!\n' }, labels)
    expect(merged).toEqual({ tree: { a: '1!\n2\n3!\n' }, conflicts: [] })
  })
})

describe('mergeText', () => {
  it('改行を残したまま行に分ける', () => {
    expect(splitLines('a\nb')).toEqual(['a\n', 'b'])
    expect(splitLines('')).toEqual([])
  })

  it('同じ箇所を別々に変えたら Git と同じマーカーを入れ、ほかの行は残す', () => {
    const result = mergeText('top\nx\nend\n', 'top\nours\nend\n', 'top\ntheirs\nend\n', labels)
    expect(result.conflict).toBe(true)
    expect(result.text).toBe('top\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> feature\nend\n')
  })

  it('両方が末尾に別々に追記したらコンフリクトになる', () => {
    const result = mergeText('a\n', 'a\nb\n', 'a\nc\n', labels)
    expect(result.text).toBe('a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> feature\n')
  })

  it('base がなくても (両方で追加) 共通部分は残す', () => {
    const result = mergeText('', 'same\nours\n', 'same\ntheirs\n', labels)
    expect(result.text).toBe('same\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> feature\n')
  })
})
