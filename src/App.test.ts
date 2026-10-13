import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import App from './App'
import { GraphView } from './components/GraphView'
import { executeCommand } from './git/commands'
import { createRepo } from './git/model'

describe('描画のスモークテスト', () => {
  it('初期状態の App が描画できる', () => {
    const html = renderToStaticMarkup(createElement(App))
    expect(html).toContain('BranchLab')
    expect(html).toContain('HEAD: main @ C0')
  })

  it('マージ後のグラフにすべてのコミットとブランチ名が描画される', () => {
    let repo = createRepo()
    for (const line of [
      'switch -c feature',
      'commit -m "add form"',
      'switch main',
      'commit -m "fix typo"',
      'merge feature',
    ]) {
      repo = executeCommand(repo, line).repo
    }
    const html = renderToStaticMarkup(createElement(GraphView, { repo }))
    for (const id of ['C0', 'C1', 'C2', 'C3']) {
      expect(html).toContain(`>${id}<`)
    }
    expect(html).toContain('HEAD → main')
    expect(html).toContain('feature')
  })
})
