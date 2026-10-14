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
  it('rebase-merges: ふつうの rebase で一直線にすると不正解', () => {
    const built = buildPuzzle(puzzle('rebase-merges'))
    expect(isSolved(built, run(['git rebase main'], built.start))).toBe(false)
  })

  it('remotes: origin に push しなければ不正解、pull upstream main でも正解', () => {
    const built = buildPuzzle(puzzle('remotes'))
    expect(isSolved(built, run(['git pull upstream main'], built.start))).toBe(false)
    expect(isSolved(built, run(['git pull upstream main', 'git push'], built.start))).toBe(true)
  })

  it('bisect: タグを付けても bisect を終えていなければ不正解', () => {
    const built = buildPuzzle(puzzle('bisect'))
    expect(isSolved(built, run(['git bisect start main C1', 'git tag bug C5'], built.start))).toBe(false)
    expect(isSolved(built, run(['git tag bug C5'], built.start))).toBe(true)
  })

  it('コミット ID がずれても、履歴の形と由来が同じなら正解', () => {
    const built = buildPuzzle(puzzle('branch'))
    const repo = run(
      ['git commit --allow-empty -m x', 'git reset --hard HEAD~1', 'git switch -c feature', 'git commit --allow-empty -m x', 'git switch main', 'git commit --allow-empty -m x'],
      built.start,
    )
    expect(repo.branches['main']).toBe('C3')
    expect(isSolved(built, repo)).toBe(true)
  })

  it('別の手順で同じ結果になっても正解 (merge の代わりに fetch と merge)', () => {
    const built = buildPuzzle(puzzle('pull-push'))
    expect(isSolved(built, run(['git fetch', 'git merge --no-edit origin/main', 'git push'], built.start))).toBe(true)
  })

  it('履歴が違えば不正解', () => {
    // cherry-pick の代わりに feature をまるごとマージする
    const cherry = buildPuzzle(puzzle('cherry-pick'))
    expect(isSolved(cherry, run(['git merge --no-edit feature'], cherry.start))).toBe(false)
    // revert の代わりに reset して強制 push する
    const revert = buildPuzzle(puzzle('revert'))
    expect(isSolved(revert, run(['git reset --hard HEAD~1', 'git push -f'], revert.start))).toBe(false)
    // push を忘れる
    expect(isSolved(revert, run(['git revert --no-edit HEAD'], revert.start))).toBe(false)
  })

  it('コンフリクトの途中やマーカーが残ったままでは正解にならない', () => {
    const built = buildPuzzle(puzzle('conflict'))
    expect(isSolved(built, run(['git merge --no-edit feature'], built.start))).toBe(false)
    expect(isSolved(built, run(['git merge --no-edit feature', 'git add .', 'git commit --no-edit'], built.start))).toBe(false)
  })

  it('rebase -i の代わりに reset --soft でまとめても正解', () => {
    const built = buildPuzzle(puzzle('squash'))
    expect(isSolved(built, run(['git reset --soft HEAD~3', 'git commit -m "機能を追加"'], built.start))).toBe(true)
    // まとめずに pick のまま閉じると不正解
    expect(isSolved(built, run(['git rebase -i HEAD~3', ':wq'], built.start))).toBe(false)
  })

  it('stash した変更を戻し忘れると不正解', () => {
    const built = buildPuzzle(puzzle('stash'))
    const forgot = run(['git stash', 'echo "fix" > fix.txt', 'git add fix.txt', 'git commit -m fix'], built.start)
    expect(isSolved(built, forgot)).toBe(false)
    // 書きかけの変更まで一緒にコミットしても不正解
    expect(isSolved(built, run(['echo "fix" > fix.txt', 'git add .', 'git commit -m fix'], built.start))).toBe(false)
  })

  it('タグは push まで、付ける場所も含めて確かめる', () => {
    const built = buildPuzzle(puzzle('tag'))
    expect(isSolved(built, run(['git tag v1.0 C2'], built.start))).toBe(false)
    expect(isSolved(built, run(['git tag v1.0', 'git push origin v1.0'], built.start))).toBe(false)
    expect(isSolved(built, run(['git tag -m "最初のリリース" v1.0 HEAD~1', 'git push --tags'], built.start))).toBe(true)
  })

  it('reflog の代わりにコミット ID を指定して戻しても正解', () => {
    const built = buildPuzzle(puzzle('reflog'))
    expect(isSolved(built, run(['git reset --hard C3'], built.start))).toBe(true)
  })

  it('エディタが開いたままでは正解にならない', () => {
    const built = buildPuzzle(puzzle('merge'))
    expect(isSolved(built, run(['git merge feature'], built.start))).toBe(false)
    expect(isSolved(built, run(['git merge feature', ':wq'], built.start))).toBe(true)
  })

  it('amend の代わりに新しいコミットを足すと不正解', () => {
    const built = buildPuzzle(puzzle('amend'))
    const repo = run(['echo "<h1>Hello</h1>" > index.html', 'git commit -am "typo を修正"'], built.start)
    expect(isSolved(built, repo)).toBe(false)
  })
})
