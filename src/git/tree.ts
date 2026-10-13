/**
 * ファイルのスナップショット (パス → 内容) と、その比較・3-way マージ。
 * コミット・ステージ・作業ディレクトリはどれもこの形で表す。
 */

export type Tree = Readonly<Record<string, string>>

/** a と b で内容が異なるパス (片方にしかないものを含む) を名前順に返す。 */
export function changedPaths(a: Tree, b: Tree): string[] {
  const paths = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...paths].filter((path) => a[path] !== b[path]).sort()
}

export function treesEqual(a: Tree, b: Tree): boolean {
  return changedPaths(a, b).length === 0
}

/** path の内容を置き換えた Tree を返す。content が undefined なら削除する。 */
export function withFile(tree: Tree, path: string, content: string | undefined): Tree {
  if (content === undefined) {
    if (!(path in tree)) return tree
    const next = { ...tree }
    delete next[path]
    return next
  }
  return { ...tree, [path]: content }
}

export interface TreeMerge {
  readonly tree: Tree
  /** 両方で異なる変更があったパス。tree にはコンフリクトマーカー付きの内容が入る。 */
  readonly conflicts: readonly string[]
}

function conflictText(
  ours: string | undefined,
  theirs: string | undefined,
  labels: { readonly ours: string; readonly theirs: string },
): string {
  return [
    `<<<<<<< ${labels.ours}`,
    ours ?? '(削除)',
    '=======',
    theirs ?? '(削除)',
    `>>>>>>> ${labels.theirs}`,
  ].join('\n')
}

/**
 * base から ours と theirs への変更をファイル単位で合成する。
 * 片方だけが変えたファイルはその内容を採用し、両方が別々に変えたファイルはコンフリクトにする。
 */
export function mergeTrees(
  base: Tree,
  ours: Tree,
  theirs: Tree,
  labels: { readonly ours: string; readonly theirs: string },
): TreeMerge {
  let tree: Tree = ours
  const conflicts: string[] = []
  for (const path of changedPaths(ours, theirs)) {
    const o = ours[path]
    const t = theirs[path]
    if (base[path] === o) {
      tree = withFile(tree, path, t)
    } else if (base[path] !== t) {
      tree = withFile(tree, path, conflictText(o, t, labels))
      conflicts.push(path)
    }
  }
  return { tree, conflicts }
}
