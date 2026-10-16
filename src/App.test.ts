import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import App from './App'
import { HelpDialog } from './components/HelpDialog'
import { PuzzlePanel } from './components/PuzzlePanel'
import { TutorialPanel } from './components/TutorialPanel'
import { LESSONS } from './tutorial/lessons'
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
      'git merge --no-edit feature',
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
      'git commit --allow-empty -m x',
      'git commit --allow-empty -m x',
      'git reset --hard HEAD~1',
    ])
    expect(html.match(/node-group unreachable/g)).toHaveLength(1)
    expect(html).toContain('C2: x (どのブランチからもたどれません)')
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
    expect(html).toContain('1 / 37 問クリア')
    expect(html).toContain('正解です！')
    expect(html).toContain('目標のローカルリポジトリのコミットグラフ')
  })

  it('チュートリアルのパネルにステップと課題が描画される', () => {
    const html = renderToStaticMarkup(
      createElement(TutorialPanel, {
        lessons: LESSONS,
        lessonIndex: 0,
        step: 1,
        done: true,
        completedIds: new Set<string>(),
        onSelectLesson: () => {},
        onStep: () => {},
        onInsert: () => {},
        onFinish: () => {},
      }),
    )
    expect(html).toContain('レッスン 1: はじめてのコミット')
    expect(html).toContain('今の状態を見る')
    expect(html).toContain('<code>git status</code>')
    expect(html).toContain('できました！')
    expect(html).toContain(`0 / ${LESSONS.length} レッスン完了`)
  })

  it('ヘルプにコマンドの一覧が描画される', () => {
    const html = renderToStaticMarkup(createElement(HelpDialog, { onClose: () => {}, onInsert: () => {}, onStartTutorial: () => {} }))
    expect(html).toContain('コマンドのヘルプ')
    expect(html).toContain('はじめての方へ')
    expect(html).toContain('<code>git commit</code>')
  })
})
