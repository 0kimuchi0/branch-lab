import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import App from './App'
import { PuzzlePanel } from './components/PuzzlePanel'
import { PUZZLES, buildPuzzle } from './puzzles/puzzles'
import { GraphView } from './components/GraphView'
import { computeLayout } from './graph/layout'
import { run } from './test/run'

function renderGraph(lines: string[]): string {
  return renderToStaticMarkup(
    createElement(GraphView, { layout: computeLayout(run(lines)), label: 'グラフ' }),
  )
}

describe('描画のスモークテスト', () => {
  it('初期状態の App が描画できる', () => {
    const html = renderToStaticMarkup(createElement(App))
    expect(html).toContain('BranchLab')
    expect(html).toContain('HEAD: main @ C0')
  })

  it('マージ後のグラフにすべてのコミットとブランチ名が描画される', () => {
    const html = renderGraph([
      'git switch -c feature',
      'git commit --allow-empty -m "add form"',
      'git switch main',
      'git commit --allow-empty -m "fix typo"',
      'git merge feature',
    ])
    for (const id of ['C0', 'C1', 'C2', 'C3']) {
      expect(html).toContain(`>${id}<`)
    }
    expect(html).toContain('HEAD → main')
    expect(html).toContain('feature')
    expect(html).toContain('origin/main')
  })

  it('reset で外れたコミットは薄く描画される', () => {
    const html = renderGraph([
      'git commit --allow-empty',
      'git commit --allow-empty',
      'git reset --hard HEAD~1',
    ])
    expect(html.match(/node-group unreachable/g)).toHaveLength(1)
    expect(html).toContain('C2: Commit 2 (どのブランチからもたどれません)')
  })

  it('お題パネルに目標のグラフと進み具合が描画される', () => {
    const puzzles = PUZZLES.map(buildPuzzle)
    const html = renderToStaticMarkup(
      createElement(PuzzlePanel, {
        puzzles,
        index: 3,
        solved: true,
        solvedIds: new Set(['first-commit']),
        onSelect: () => {},
      }),
    )
    expect(html).toContain('4. マージする')
    expect(html).toContain('1 / 10 問クリア')
    expect(html).toContain('正解です！')
    expect(html).toContain('目標のローカルリポジトリのコミットグラフ')
  })
})
