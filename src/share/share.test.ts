import { describe, expect, it } from 'vitest'
import { PUZZLES, buildPuzzle, isSolved } from '../puzzles/puzzles'
import { run } from '../test/run'
import { MAX_COMMANDS, decodeShare, encodeShare, replay, restoreShare } from './share'

const puzzles = PUZZLES.map(buildPuzzle)

describe('encodeShare / decodeShare', () => {
  it('日本語や記号を含むコマンドもそのまま往復できる', () => {
    const state = {
      mode: 'free' as const,
      commands: ['echo "こんにちは > 世界" >> a.txt', "git commit -am 'テスト'", 'git log --oneline'],
    }
    const hash = encodeShare(state)
    expect(hash).toMatch(/^#s=[A-Za-z0-9_-]+$/)
    expect(decodeShare(hash)).toEqual(state)
  })

  it('お題モードではお題の ID も入る', () => {
    const state = { mode: 'puzzle' as const, puzzleId: 'merge', commands: ['git merge --no-edit feature'] }
    expect(decodeShare(encodeShare(state))).toEqual(state)
  })

  it('共有の形式でないハッシュや壊れたデータは null', () => {
    for (const hash of ['', '#', '#top', '#s=', '#s=!!!', '#s=e30', `#s=${btoa('[1,2]')}`]) {
      expect(decodeShare(hash), hash).toBeNull()
    }
    const tooMany = encodeShare({ mode: 'free', commands: new Array(MAX_COMMANDS + 1).fill('ls') })
    expect(decodeShare(tooMany)).toBeNull()
    const noPuzzle = encodeShare({ mode: 'puzzle', commands: [] })
    expect(decodeShare(noPuzzle)).toBeNull()
  })
})

describe('replay / restoreShare', () => {
  it('コマンドを実行し直して同じ Repo とログを作る', () => {
    const commands = ['echo a > a.txt', 'git add .', 'git commit -m a', 'git switch nope']
    const { repo, log } = replay(run([]), commands)
    expect(repo).toEqual(run(commands.slice(0, 3)))
    expect(log.map((entry) => entry.ok)).toEqual([true, true, true, false])
    expect(log[2]?.output).toBe('[main C1] a')
  })

  it('自由モードは clone 直後の状態から再現する', () => {
    const restored = restoreShare({ mode: 'free', commands: ['git commit --allow-empty -m x'] }, puzzles)
    expect(restored?.mode).toBe('free')
    expect(restored?.repo.branches['main']).toBe('C1')
  })

  it('お題モードはお題の初期状態から再現し、正解の状態も再現できる', () => {
    const restored = restoreShare(
      { mode: 'puzzle', puzzleId: 'merge', commands: ['git merge --no-edit feature'] },
      puzzles,
    )
    expect(restored?.puzzleIndex).toBe(PUZZLES.findIndex((p) => p.id === 'merge'))
    const built = puzzles[restored!.puzzleIndex]!
    expect(isSolved(built, restored!.repo)).toBe(true)
  })

  it('存在しないお題は null', () => {
    expect(restoreShare({ mode: 'puzzle', puzzleId: 'nope', commands: [] }, puzzles)).toBeNull()
  })
})

describe('チュートリアルの共有', () => {
  it('レッスンとステップも往復でき、コマンドを実行し直して復元する', async () => {
    const { LESSONS } = await import('../tutorial/lessons')
    const state = { mode: 'tutorial' as const, lessonId: 'branch', step: 2, commands: ['git switch -c feature'] }
    const decoded = decodeShare(encodeShare(state))
    expect(decoded).toEqual(state)
    const restored = restoreShare(decoded as NonNullable<typeof decoded>, puzzles)
    expect(restored?.lessonIndex).toBe(LESSONS.findIndex((lesson) => lesson.id === 'branch'))
    expect(restored?.step).toBe(2)
    expect(restored?.repo.head).toEqual({ type: 'branch', name: 'feature' })
    expect(restoreShare({ ...state, lessonId: 'nothing' }, puzzles)).toBeNull()
  })

  it('途中のステップから始めたときは、そのステップの始めの状態から実行し直す', () => {
    const state = { mode: 'tutorial' as const, lessonId: 'merge', step: 3, base: 3, commands: ['git merge --no-edit docs'] }
    const decoded = decodeShare(encodeShare(state))
    expect(decoded).toEqual(state)
    const restored = restoreShare(decoded as NonNullable<typeof decoded>, puzzles)
    expect(restored?.base).toBe(3)
    expect(restored?.log.every((entry) => entry.ok)).toBe(true)
    const main = restored?.repo.branches['main']
    expect(main && restored?.repo.commits[main]?.parents).toHaveLength(2)
  })

  it('前の形式 (v2) のチュートリアルのリンクは、レッスンの始めから実行し直す', () => {
    const v2 = `#s=${btoa(JSON.stringify({ v: 2, m: 'tutorial', l: 'branch', i: 1, c: ['git branch'] }))}`
    const decoded = decodeShare(v2)
    expect(decoded).toEqual({ mode: 'tutorial', lessonId: 'branch', step: 1, commands: ['git branch'] })
    expect(restoreShare(decoded as NonNullable<typeof decoded>, puzzles)?.base).toBe(0)
  })

  it('前の形式 (v1) のリンクも読める', () => {
    const v1 = `#s=${btoa(JSON.stringify({ v: 1, m: 'free', c: ['git status'] }))}`
    expect(decodeShare(v1)).toEqual({ mode: 'free', commands: ['git status'] })
  })
})
