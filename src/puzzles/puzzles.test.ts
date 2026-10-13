import { describe, expect, it } from 'vitest'
import { run } from '../test/run'
import { PUZZLES, buildPuzzle, isSolved, type Puzzle } from './puzzles'

function puzzle(id: string): Puzzle {
  const found = PUZZLES.find((p) => p.id === id)
  if (!found) throw new Error(id)
  return found
}

describe('PUZZLES', () => {
  it('ID が重複していない', () => {
    expect(new Set(PUZZLES.map((p) => p.id)).size).toBe(PUZZLES.length)
  })

  for (const p of PUZZLES) {
    it(`${p.title}: 初期状態は未正解で、どの解答例でも正解になる`, () => {
      const built = buildPuzzle(p)
      expect(isSolved(built, built.start)).toBe(false)
      for (const solution of p.solutions) {
        expect(isSolved(built, run(solution, built.start)), solution.join(' / ')).toBe(true)
      }
    })
  }
})

describe('isSolved', () => {
  it('コミット ID がずれても、履歴の形と由来が同じなら正解', () => {
    const built = buildPuzzle(puzzle('branch'))
    const repo = run(
      ['git commit --allow-empty', 'git reset --hard HEAD~1', 'git switch -c feature', 'git commit --allow-empty', 'git switch main', 'git commit --allow-empty'],
      built.start,
    )
    expect(repo.branches['main']).toBe('C3')
    expect(isSolved(built, repo)).toBe(true)
  })

  it('別の手順で同じ結果になっても正解 (merge の代わりに fetch と merge)', () => {
    const built = buildPuzzle(puzzle('pull-push'))
    expect(isSolved(built, run(['git fetch', 'git merge origin/main', 'git push'], built.start))).toBe(true)
  })

  it('履歴が違えば不正解', () => {
    // cherry-pick の代わりに feature をまるごとマージする
    const cherry = buildPuzzle(puzzle('cherry-pick'))
    expect(isSolved(cherry, run(['git merge feature'], cherry.start))).toBe(false)
    // revert の代わりに reset して強制 push する
    const revert = buildPuzzle(puzzle('revert'))
    expect(isSolved(revert, run(['git reset --hard HEAD~1', 'git push -f'], revert.start))).toBe(false)
    // push を忘れる
    expect(isSolved(revert, run(['git revert HEAD'], revert.start))).toBe(false)
  })

  it('コンフリクトの途中やマーカーが残ったままでは正解にならない', () => {
    const built = buildPuzzle(puzzle('conflict'))
    expect(isSolved(built, run(['git merge feature'], built.start))).toBe(false)
    expect(isSolved(built, run(['git merge feature', 'git add .', 'git commit'], built.start))).toBe(false)
  })

  it('amend の代わりに新しいコミットを足すと不正解', () => {
    const built = buildPuzzle(puzzle('amend'))
    const repo = run(['echo "<h1>Hello</h1>" > index.html', 'git commit -am "typo を修正"'], built.start)
    expect(isSolved(built, repo)).toBe(false)
  })
})
