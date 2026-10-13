import { describe, expect, it } from 'vitest'
import { executeCommand } from '../git/commands'
import { createRepo, type Repo } from '../git/model'
import { computeLayout } from './layout'

function run(lines: string[]): Repo {
  return lines.reduce((repo, line) => executeCommand(repo, line).repo, createRepo())
}

describe('computeLayout', () => {
  it('main は最上段 (レーン 0) に一直線に並ぶ', () => {
    const layout = computeLayout(run(['commit', 'commit']))
    const nodes = layout.nodes
    expect(nodes.map((n) => n.lane)).toEqual([0, 0, 0])
    expect(nodes[0]!.x).toBeLessThan(nodes[1]!.x)
    expect(nodes[1]!.x).toBeLessThan(nodes[2]!.x)
    expect(new Set(nodes.map((n) => n.y)).size).toBe(1)
  })

  it('ブランチ上のコミットは別レーンに置かれる', () => {
    const layout = computeLayout(
      run(['switch -c feature', 'commit', 'switch main', 'commit']),
    )
    const byId = new Map(layout.nodes.map((n) => [n.id, n]))
    expect(byId.get('C0')!.lane).toBe(0)
    expect(byId.get('C2')!.lane).toBe(0) // main 側のコミット
    expect(byId.get('C1')!.lane).toBe(1) // feature 側のコミット
    expect(byId.get('C1')!.y).toBeGreaterThan(byId.get('C2')!.y)
  })

  it('マージコミットは両親から辺が伸び、合流線は合流元の色になる', () => {
    const layout = computeLayout(
      run(['switch -c feature', 'commit', 'switch main', 'commit', 'merge feature']),
    )
    const mergeNode = layout.nodes.find((n) => n.isMerge)!
    expect(mergeNode.lane).toBe(0)
    const incoming = layout.edges.filter((e) => e.key.endsWith(`->${mergeNode.id}`))
    expect(incoming).toHaveLength(2)
    expect(incoming.map((e) => e.lane).sort()).toEqual([0, 1])
  })

  it('ブランチ名ラベルは指しているコミットの上に表示され、HEAD が最も近い', () => {
    const layout = computeLayout(run(['branch feature']))
    const labels = layout.labels
    expect(labels.map((l) => l.text)).toEqual(['HEAD → main', 'feature'])
    expect(labels[0]!.y).toBeGreaterThan(labels[1]!.y)
    expect(labels.every((l) => l.x === layout.nodes[0]!.x)).toBe(true)
  })

  it('コミットが増えると幅が広がる', () => {
    const small = computeLayout(run([]))
    const large = computeLayout(run(['commit', 'commit', 'commit']))
    expect(large.width).toBeGreaterThan(small.width)
  })

  it('reset で外れたコミットは別レーンに置かれ、到達不能として扱われる', () => {
    const layout = computeLayout(
      run(['commit', 'commit', 'reset --hard HEAD~2', 'commit']),
    )
    const byId = new Map(layout.nodes.map((n) => [n.id, n]))
    expect(byId.get('C3')).toMatchObject({ lane: 0, reachable: true })
    expect(byId.get('C1')).toMatchObject({ lane: 1, reachable: false })
    expect(byId.get('C2')).toMatchObject({ lane: 1, reachable: false })
    // 新しいコミット C3 と外れた C1 は同じ深さだが重ならない
    expect(byId.get('C3')!.x).toBe(byId.get('C1')!.x)
    expect(byId.get('C3')!.y).not.toBe(byId.get('C1')!.y)

    const edge = (key: string) => layout.edges.find((e) => e.key === key)!
    expect(edge('C0->C1').reachable).toBe(false)
    expect(edge('C0->C3').reachable).toBe(true)
  })
})
