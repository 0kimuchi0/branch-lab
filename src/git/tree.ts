/**
 * ファイルのスナップショット (パス → 内容) と、その比較・3-way マージ。
 * コミット・ステージ・作業ディレクトリはどれもこの形で表す。
 */

export type Tree = Readonly<Record<string, string>>

/**
 * サブモジュールの位置に置く値 (gitlink)。本物の Git では tree に「コミット ID を指す特別な項目」として入る。
 * ここではファイルの内容として、echo では書けない文字 (\0) から始まる文字列で表す。
 */
const GITLINK_PREFIX = '\u0000gitlink '

export function gitlink(id: string): string {
  return `${GITLINK_PREFIX}${id}`
}

/** gitlink ならサブモジュールのコミット ID、そうでなければ null。 */
export function parseGitlink(content: string | undefined): string | null {
  return content?.startsWith(GITLINK_PREFIX) ? content.slice(GITLINK_PREFIX.length) : null
}

/** 表示用の内容 (gitlink は git diff と同じく "Subproject commit <ID>" にする)。 */
export function displayContent(content: string): string {
  const id = parseGitlink(content)
  return id === null ? content : `Subproject commit ${id}\n`
}

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

/** 改行を含めたまま行に分割する。 */
export function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? []
}

/** a と b の最長共通部分列を、対応する行番号の組で返す。 */
export function lcsPairs(a: readonly string[], b: readonly string[]): Array<[number, number]> {
  const dp = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  )
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i]![j] =
        a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  const pairs: Array<[number, number]> = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pairs.push([i, j])
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      i++
    } else {
      j++
    }
  }
  return pairs
}

function sameLines(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, index) => line === b[index])
}

function withNewline(lines: readonly string[]): string[] {
  const last = lines.at(-1)
  if (last === undefined || last.endsWith('\n')) return [...lines]
  return [...lines.slice(0, -1), `${last}\n`]
}

export interface MergeLabels {
  readonly ours: string
  readonly theirs: string
  /** -X ours / -X theirs: 両方が変えた箇所は、コンフリクトにせずにこちらの側を採る。 */
  readonly favor?: 'ours' | 'theirs'
}

/**
 * diff3 による行単位の 3-way マージ。
 * 両方が同じ箇所を別々に変えたときだけ、Git と同じ形式のコンフリクトマーカーを入れる
 * (labels.favor があれば、マーカーを入れずにその側を採る)。
 */
export function mergeText(
  base: string,
  ours: string,
  theirs: string,
  labels: MergeLabels,
): { readonly text: string; readonly conflict: boolean } {
  const o = splitLines(base)
  const a = splitLines(ours)
  const b = splitLines(theirs)
  const aMatch = new Map(lcsPairs(o, a))
  const bMatch = new Map(lcsPairs(o, b))

  const out: string[] = []
  let conflict = false
  let i = 0
  let j = 0
  let k = 0
  const flush = (oEnd: number, aEnd: number, bEnd: number) => {
    const oChunk = o.slice(i, oEnd)
    const aChunk = a.slice(j, aEnd)
    const bChunk = b.slice(k, bEnd)
    if (sameLines(aChunk, oChunk)) out.push(...bChunk)
    else if (sameLines(bChunk, oChunk) || sameLines(aChunk, bChunk)) out.push(...aChunk)
    else if (labels.favor) out.push(...(labels.favor === 'ours' ? aChunk : bChunk))
    else {
      // Git と同じく、両側で共通する先頭と末尾の行はマーカーの外に出す
      let head = 0
      while (head < aChunk.length && head < bChunk.length && aChunk[head] === bChunk[head]) head++
      let tail = 0
      while (
        tail < aChunk.length - head &&
        tail < bChunk.length - head &&
        aChunk[aChunk.length - 1 - tail] === bChunk[bChunk.length - 1 - tail]
      ) {
        tail++
      }
      conflict = true
      out.push(...aChunk.slice(0, head))
      if (out.length > 0) out.splice(0, out.length, ...withNewline(out))
      out.push(
        `<<<<<<< ${labels.ours}\n`,
        ...withNewline(aChunk.slice(head, aChunk.length - tail)),
        '=======\n',
        ...withNewline(bChunk.slice(head, bChunk.length - tail)),
        `>>>>>>> ${labels.theirs}\n`,
        ...aChunk.slice(aChunk.length - tail),
      )
    }
  }

  for (;;) {
    // base・ours・theirs の 3 つで共通している次の行 (安定した行) を探す
    let m = i
    while (m < o.length && !(aMatch.has(m) && bMatch.has(m))) m++
    if (m === o.length) {
      flush(o.length, a.length, b.length)
      break
    }
    const aNext = aMatch.get(m) as number
    const bNext = bMatch.get(m) as number
    if (m === i && aNext === j && bNext === k) {
      out.push(o[i] as string)
      i++
      j++
      k++
      continue
    }
    flush(m, aNext, bNext)
    i = m
    j = aNext
    k = bNext
  }
  return { text: out.join(''), conflict }
}

export type ConflictKind = 'both-modified' | 'both-added' | 'deleted-by-us' | 'deleted-by-them'

export interface Conflict {
  readonly path: string
  readonly kind: ConflictKind
}

export interface TreeMerge {
  readonly tree: Tree
  /** 自動でマージできなかったファイル。tree にはコンフリクトマーカー付きの内容が入る。 */
  readonly conflicts: readonly Conflict[]
}

/**
 * base から ours と theirs への変更を合成する。
 * 片方だけが変えたファイルはその内容を採用し、両方が変えたファイルは行単位でマージする。
 * 片方が削除し、もう片方が変更したファイルは、変更した側の内容を残してコンフリクトにする。
 */
export function mergeTrees(
  base: Tree,
  ours: Tree,
  theirs: Tree,
  labels: MergeLabels,
): TreeMerge {
  let tree: Tree = ours
  const conflicts: Conflict[] = []
  for (const path of changedPaths(ours, theirs)) {
    const o = base[path]
    const a = ours[path]
    const b = theirs[path]
    if (o === a) {
      tree = withFile(tree, path, b)
    } else if (o === b) {
      continue
    } else if (a === undefined || b === undefined) {
      tree = withFile(tree, path, a ?? b)
      conflicts.push({ path, kind: a === undefined ? 'deleted-by-us' : 'deleted-by-them' })
    } else if (parseGitlink(a) !== null || parseGitlink(b) !== null) {
      // サブモジュールの指すコミットは行単位にマージできない。こちらの側を残してコンフリクトにする
      conflicts.push({ path, kind: o === undefined ? 'both-added' : 'both-modified' })
    } else {
      const merged = mergeText(o ?? '', a, b, labels)
      tree = withFile(tree, path, merged.text)
      if (merged.conflict) {
        conflicts.push({ path, kind: o === undefined ? 'both-added' : 'both-modified' })
      }
    }
  }
  return { tree, conflicts }
}

/**
 * rerere でコンフリクトを見分けるための鍵。コンフリクトマーカーのラベルを取り除き、
 * 各コンフリクトの 2 つの側を並べ替えてそろえる (ours と theirs が入れ替わっても同じ鍵になる)。
 * マーカーがなければ null。
 */
export function conflictKey(text: string): string | null {
  const out: string[] = []
  let sides: [string[], string[]] | null = null
  let side = 0
  let found = false
  for (const line of splitLines(text)) {
    if (sides === null && line.startsWith('<<<<<<<')) {
      sides = [[], []]
      side = 0
      found = true
    } else if (sides !== null && side === 0 && line.startsWith('=======')) {
      side = 1
    } else if (sides !== null && side === 1 && line.startsWith('>>>>>>>')) {
      const [a, b] = sides.map((lines) => lines.join('')).sort() as [string, string]
      out.push('<<<<<<<\n', a, '=======\n', b, '>>>>>>>\n')
      sides = null
    } else if (sides !== null) {
      sides[side]?.push(line)
    } else {
      out.push(line)
    }
  }
  return found && sides === null ? out.join('') : null
}
