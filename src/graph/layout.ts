/**
 * Repo からコミットグラフの座標を計算する純粋関数。
 * - x: 祖先からの深さ (左から右へ時間が進む)
 * - y: ブランチごとのレーン (main が最上段)
 */
import {
  DEFAULT_BRANCH,
  currentBranch,
  reachableCommits,
  type CommitId,
  type Repo,
} from '../git/model'

export const X_GAP = 96
export const Y_GAP = 96
export const PAD_X = 90
export const PAD_BOTTOM = 56
const LABEL_BASE = 30
const LABEL_STEP = 24

export interface LayoutNode {
  readonly id: CommitId
  readonly message: string
  readonly x: number
  readonly y: number
  readonly lane: number
  readonly isMerge: boolean
  /** ブランチや HEAD からたどれるか。reset で外れたコミットは false。 */
  readonly reachable: boolean
}

export interface LayoutEdge {
  readonly key: string
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
  /** 線の色に使うレーン番号。マージの合流線は合流元のレーンの色にする。 */
  readonly lane: number
  readonly reachable: boolean
}

export interface LayoutLabel {
  readonly key: string
  readonly text: string
  readonly kind: 'branch' | 'current' | 'head'
  readonly x: number
  readonly y: number
  readonly width: number
  readonly lane: number
}

export interface GraphLayout {
  readonly nodes: readonly LayoutNode[]
  readonly edges: readonly LayoutEdge[]
  readonly labels: readonly LayoutLabel[]
  readonly width: number
  readonly height: number
}

function computeDepths(repo: Repo): Map<CommitId, number> {
  const depths = new Map<CommitId, number>()
  const visit = (id: CommitId): number => {
    const known = depths.get(id)
    if (known !== undefined) return known
    const commit = repo.commits[id]
    const depth =
      !commit || commit.parents.length === 0
        ? 0
        : 1 + Math.max(...commit.parents.map(visit))
    depths.set(id, depth)
    return depth
  }
  Object.keys(repo.commits).forEach(visit)
  return depths
}

/**
 * main を先頭に、各ブランチの先頭から第 1 親をたどって、
 * まだレーンが決まっていないコミットにそのブランチのレーンを割り当てる。
 * どこからもたどれないコミットは、新しいものから順に後ろのレーンに置く。
 */
function assignLanes(
  repo: Repo,
  depths: ReadonlyMap<CommitId, number>,
  reachable: ReadonlySet<CommitId>,
): Map<CommitId, number> {
  const names = Object.keys(repo.branches).sort((a, b) => {
    if (a === b) return 0
    if (a === DEFAULT_BRANCH) return -1
    if (b === DEFAULT_BRANCH) return 1
    return 0
  })
  const tips = names.map((name) => repo.branches[name] as CommitId)
  if (repo.head.type === 'detached') tips.push(repo.head.id)
  const unreachable = Object.keys(repo.commits)
    .filter((id) => !reachable.has(id))
    .sort((a, b) => (depths.get(b) ?? 0) - (depths.get(a) ?? 0))
  tips.push(...unreachable)

  const lanes = new Map<CommitId, number>()
  let nextLane = 0
  for (const tip of tips) {
    let lane: number | undefined
    let id: CommitId | undefined = tip
    while (id !== undefined && !lanes.has(id)) {
      lane ??= nextLane++
      lanes.set(id, lane)
      id = repo.commits[id]?.parents[0]
    }
  }
  for (const id of Object.keys(repo.commits)) {
    if (!lanes.has(id)) lanes.set(id, 0)
  }
  return lanes
}

function estimateLabelWidth(text: string): number {
  let width = 18
  for (const char of text) width += char.charCodeAt(0) > 255 ? 13 : 7.2
  return Math.ceil(width)
}

interface PendingLabel {
  readonly key: string
  readonly text: string
  readonly kind: LayoutLabel['kind']
}

export function computeLayout(repo: Repo): GraphLayout {
  const depths = computeDepths(repo)
  const reachable = reachableCommits(repo)
  const lanes = assignLanes(repo, depths, reachable)
  const current = currentBranch(repo)

  // コミットごとに、そこを指しているラベル (ブランチ名・HEAD) を集める
  const pending = new Map<CommitId, PendingLabel[]>()
  const addLabel = (commitId: CommitId, label: PendingLabel) => {
    const list = pending.get(commitId) ?? []
    list.push(label)
    pending.set(commitId, list)
  }
  for (const [name, commitId] of Object.entries(repo.branches)) {
    const isCurrent = name === current
    addLabel(commitId, {
      key: `branch:${name}`,
      text: isCurrent ? `HEAD → ${name}` : name,
      kind: isCurrent ? 'current' : 'branch',
    })
  }
  if (repo.head.type === 'detached') {
    addLabel(repo.head.id, { key: 'head', text: 'HEAD', kind: 'head' })
  }

  const maxStack = Math.max(1, ...[...pending.values()].map((l) => l.length))
  const padTop = LABEL_BASE + (maxStack - 1) * LABEL_STEP + 16

  const nodes: LayoutNode[] = Object.values(repo.commits).map((commit) => {
    const lane = lanes.get(commit.id) ?? 0
    return {
      id: commit.id,
      message: commit.message,
      x: PAD_X + (depths.get(commit.id) ?? 0) * X_GAP,
      y: padTop + lane * Y_GAP,
      lane,
      isMerge: commit.parents.length > 1,
      reachable: reachable.has(commit.id),
    }
  })
  const nodeById = new Map(nodes.map((node) => [node.id, node]))

  const edges: LayoutEdge[] = []
  for (const commit of Object.values(repo.commits)) {
    const child = nodeById.get(commit.id)
    if (!child) continue
    commit.parents.forEach((parentId, index) => {
      const parent = nodeById.get(parentId)
      if (!parent) return
      edges.push({
        key: `${parentId}->${commit.id}`,
        x1: parent.x,
        y1: parent.y,
        x2: child.x,
        y2: child.y,
        lane: index === 0 ? child.lane : parent.lane,
        reachable: child.reachable,
      })
    })
  }

  const labels: LayoutLabel[] = []
  for (const [commitId, list] of pending) {
    const node = nodeById.get(commitId)
    if (!node) continue
    // 現在のブランチ (HEAD) をコミットに最も近い位置に置く
    const ordered = [...list].sort(
      (a, b) => Number(b.kind !== 'branch') - Number(a.kind !== 'branch'),
    )
    ordered.forEach((label, index) => {
      labels.push({
        ...label,
        x: node.x,
        y: node.y - LABEL_BASE - index * LABEL_STEP,
        width: estimateLabelWidth(label.text),
        lane: node.lane,
      })
    })
  }

  const laneCount = Math.max(1, ...nodes.map((node) => node.lane + 1))
  const maxDepth = Math.max(0, ...depths.values())
  const labelRight = Math.max(0, ...labels.map((l) => l.x + l.width / 2))
  const width = Math.max(PAD_X * 2 + maxDepth * X_GAP, labelRight + 24)
  const height = padTop + (laneCount - 1) * Y_GAP + PAD_BOTTOM

  return { nodes, edges, labels, width, height }
}
