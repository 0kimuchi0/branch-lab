/**
 * Repo からコミットグラフの座標を計算する純粋関数。
 * - x: 祖先からの深さ (左から右へ時間が進む)
 * - y: ブランチごとのレーン (main が最上段)
 */
import {
  DEFAULT_BRANCH,
  REMOTE_NAME,
  ancestors,
  currentBranch,
  type Commit,
  type CommitId,
  type Repo,
} from '../git/model'

export const X_GAP = 100
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

export type LabelKind = 'branch' | 'current' | 'head' | 'remote'

export interface LayoutLabel {
  readonly key: string
  readonly text: string
  readonly kind: LabelKind
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

type Commits = Readonly<Record<CommitId, Commit>>

/** グラフに描く参照 (ブランチ名や HEAD のラベル)。並び順がレーンの優先順になる。 */
export interface GraphRef {
  readonly key: string
  readonly text: string
  readonly kind: LabelKind
  readonly target: CommitId
}

function computeDepths(commits: Commits): Map<CommitId, number> {
  const depths = new Map<CommitId, number>()
  const visit = (id: CommitId): number => {
    const known = depths.get(id)
    if (known !== undefined) return known
    const commit = commits[id]
    const parents = commit?.parents.filter((parent) => parent in commits) ?? []
    const depth = parents.length === 0 ? 0 : 1 + Math.max(...parents.map(visit))
    depths.set(id, depth)
    return depth
  }
  Object.keys(commits).forEach(visit)
  return depths
}

/**
 * 参照の並び順に、その参照から第 1 親をたどって、
 * まだレーンが決まっていないコミットにその参照のレーンを割り当てる。
 * 残ったコミット (マージで取り込まれ、ブランチ名が付いていない側の親や、
 * どこからもたどれないコミット) は、新しいものから順に後ろのレーンに置く。
 */
function assignLanes(
  commits: Commits,
  tips: readonly CommitId[],
  depths: ReadonlyMap<CommitId, number>,
  reachable: ReadonlySet<CommitId>,
): Map<CommitId, number> {
  // たどれるコミットを先に、それぞれ新しい (深い) ものから
  const rest = Object.keys(commits).sort(
    (a, b) =>
      Number(reachable.has(b)) - Number(reachable.has(a)) ||
      (depths.get(b) ?? 0) - (depths.get(a) ?? 0),
  )

  const lanes = new Map<CommitId, number>()
  let nextLane = 0
  for (const tip of [...tips, ...rest]) {
    let lane: number | undefined
    let id: CommitId | undefined = tip
    while (id !== undefined && id in commits && !lanes.has(id)) {
      lane ??= nextLane++
      lanes.set(id, lane)
      id = commits[id]?.parents[0]
    }
  }
  return lanes
}

function estimateLabelWidth(text: string): number {
  let width = 18
  for (const char of text) width += char.charCodeAt(0) > 255 ? 13 : 7.2
  return Math.ceil(width)
}

/** コミットに最も近い位置に置くラベルほど小さい値。 */
const LABEL_ORDER: Readonly<Record<LabelKind, number>> = {
  current: 0,
  head: 0,
  branch: 1,
  remote: 2,
}

/** コミットと参照からグラフの座標を計算する。 */
export function layoutGraph(commits: Commits, refs: readonly GraphRef[]): GraphLayout {
  const depths = computeDepths(commits)
  const reachable = new Set<CommitId>()
  for (const ref of refs) for (const id of ancestors(commits, ref.target)) reachable.add(id)
  const lanes = assignLanes(
    commits,
    refs.map((ref) => ref.target),
    depths,
    reachable,
  )

  // コミットごとに、そこを指しているラベルを集める
  const pending = new Map<CommitId, GraphRef[]>()
  for (const ref of refs) {
    if (!(ref.target in commits)) continue
    const list = pending.get(ref.target) ?? []
    list.push(ref)
    pending.set(ref.target, list)
  }

  const maxStack = Math.max(1, ...[...pending.values()].map((l) => l.length))
  const padTop = LABEL_BASE + (maxStack - 1) * LABEL_STEP + 16
  // 下のレーンに積んだラベルが、上のレーンのメッセージに重ならない間隔にする
  const laneGap = Math.max(Y_GAP, padTop + 46)

  const nodes: LayoutNode[] = Object.values(commits).map((commit) => {
    const lane = lanes.get(commit.id) ?? 0
    return {
      id: commit.id,
      message: commit.message,
      x: PAD_X + (depths.get(commit.id) ?? 0) * X_GAP,
      y: padTop + lane * laneGap,
      lane,
      isMerge: commit.parents.length > 1,
      reachable: reachable.has(commit.id),
    }
  })
  const nodeById = new Map(nodes.map((node) => [node.id, node]))

  const edges: LayoutEdge[] = []
  for (const commit of Object.values(commits)) {
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
    const ordered = [...list].sort((a, b) => LABEL_ORDER[a.kind] - LABEL_ORDER[b.kind])
    ordered.forEach((ref, index) => {
      labels.push({
        key: ref.key,
        text: ref.text,
        kind: ref.kind,
        x: node.x,
        y: node.y - LABEL_BASE - index * LABEL_STEP,
        width: estimateLabelWidth(ref.text),
        lane: node.lane,
      })
    })
  }

  const laneCount = Math.max(1, ...nodes.map((node) => node.lane + 1))
  const maxDepth = Math.max(0, ...depths.values())
  const labelRight = Math.max(0, ...labels.map((l) => l.x + l.width / 2))
  const width = Math.max(PAD_X * 2 + maxDepth * X_GAP, labelRight + 24)
  const height = padTop + (laneCount - 1) * laneGap + PAD_BOTTOM

  return { nodes, edges, labels, width, height }
}

/** main を先頭にしたブランチ名の並び。 */
function branchOrder(names: Iterable<string>): string[] {
  return [...names].sort((a, b) => Number(b === DEFAULT_BRANCH) - Number(a === DEFAULT_BRANCH))
}

/** ローカルリポジトリのグラフ。ブランチ・HEAD・リモート追跡ブランチ (origin/main など) を描く。 */
export function computeLayout(repo: Repo): GraphLayout {
  const current = currentBranch(repo)
  const refs: GraphRef[] = branchOrder(Object.keys(repo.branches)).map((name) => ({
    key: `branch:${name}`,
    text: name === current ? `HEAD → ${name}` : name,
    kind: name === current ? 'current' : 'branch',
    target: repo.branches[name] as CommitId,
  }))
  if (repo.head.type === 'detached') {
    refs.push({ key: 'head', text: 'HEAD', kind: 'head', target: repo.head.id })
  }
  if (repo.operation?.type === 'merge') {
    refs.push({ key: 'merge-head', text: 'MERGE_HEAD', kind: 'head', target: repo.operation.theirs })
  }
  for (const name of branchOrder(Object.keys(repo.remoteBranches))) {
    refs.push({
      key: `remote:${name}`,
      text: `${REMOTE_NAME}/${name}`,
      kind: 'remote',
      target: repo.remoteBranches[name] as CommitId,
    })
  }
  return layoutGraph(repo.commits, refs)
}

/** リモート (origin) のグラフ。 */
export function computeRemoteLayout(repo: Repo): GraphLayout {
  const refs: GraphRef[] = branchOrder(Object.keys(repo.remote.branches)).map((name) => ({
    key: `branch:${name}`,
    text: name,
    kind: 'branch',
    target: repo.remote.branches[name] as CommitId,
  }))
  return layoutGraph(repo.remote.commits, refs)
}
