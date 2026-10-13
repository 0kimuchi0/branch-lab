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
    const state = { mode: 'puzzle' as const, puzzleId: 'merge', commands: ['git merge feature'] }
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
    const restored = restoreShare({ mode: 'free', commands: ['git commit --allow-empty'] }, puzzles)
    expect(restored?.mode).toBe('free')
    expect(restored?.repo.branches['main']).toBe('C1')
  })

  it('お題モードはお題の初期状態から再現し、正解の状態も再現できる', () => {
    const restored = restoreShare(
      { mode: 'puzzle', puzzleId: 'merge', commands: ['git merge feature'] },
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
