/**
 * git diff と同じ unified 形式の差分を作る。
 * 行の対応は tree.ts の最長共通部分列で求め、前後 3 行を文脈として付ける。
 */
import { changedPaths, displayContent, lcsPairs, splitLines, type Tree } from './tree'

const CONTEXT = 3

type Op = { readonly type: ' ' | '-' | '+'; readonly line: string }

function editScript(a: readonly string[], b: readonly string[]): Op[] {
  const ops: Op[] = []
  let i = 0
  let j = 0
  for (const [ai, bj] of [...lcsPairs(a, b), [a.length, b.length] as [number, number]]) {
    while (i < ai) ops.push({ type: '-', line: a[i++] as string })
    while (j < bj) ops.push({ type: '+', line: b[j++] as string })
    if (ai < a.length) {
      ops.push({ type: ' ', line: a[i] as string })
      i++
      j++
    }
  }
  return ops
}

function formatLine(op: Op): string[] {
  const text = op.line.endsWith('\n') ? op.line.slice(0, -1) : op.line
  const lines = [`${op.type}${text}`]
  if (!op.line.endsWith('\n')) lines.push('\\ No newline at end of file')
  return lines
}

function range(start: number, count: number): string {
  // 0 行の範囲は直前の行番号で表す (git と同じ)
  const first = count === 0 ? start - 1 : start
  return count === 1 ? `${first}` : `${first},${count}`
}

/** 2 つの内容の差分のハンク (@@ から始まる部分) を作る。 */
export function diffHunks(oldText: string, newText: string): string[] {
  const ops = editScript(splitLines(oldText), splitLines(newText))
  const changes = ops.flatMap((op, index) => (op.type === ' ' ? [] : [index]))
  if (changes.length === 0) return []

  // 文脈が重なる変更どうしを 1 つのハンクにまとめる
  const groups: Array<[number, number]> = []
  for (const index of changes) {
    const last = groups.at(-1)
    if (last && index - last[1] <= CONTEXT * 2) last[1] = index
    else groups.push([index, index])
  }

  const out: string[] = []
  for (const [first, last] of groups) {
    const start = Math.max(0, first - CONTEXT)
    const end = Math.min(ops.length - 1, last + CONTEXT)
    let oldLine = 1
    let newLine = 1
    for (const op of ops.slice(0, start)) {
      if (op.type !== '+') oldLine++
      if (op.type !== '-') newLine++
    }
    const hunk = ops.slice(start, end + 1)
    const oldCount = hunk.filter((op) => op.type !== '+').length
    const newCount = hunk.filter((op) => op.type !== '-').length
    out.push(`@@ -${range(oldLine, oldCount)} +${range(newLine, newCount)} @@`)
    for (const op of hunk) out.push(...formatLine(op))
  }
  return out
}

/** 1 つのファイルの差分。old / new が undefined ならそのファイルは存在しない。 */
export function fileDiff(path: string, oldText: string | undefined, newText: string | undefined): string[] {
  const lines = [`diff --git a/${path} b/${path}`]
  if (oldText === undefined) lines.push('new file mode 100644')
  if (newText === undefined) lines.push('deleted file mode 100644')
  // サブモジュールは "Subproject commit <ID>" の 1 行として比べる (本物の Git と同じ)
  const hunks = diffHunks(oldText === undefined ? '' : displayContent(oldText), newText === undefined ? '' : displayContent(newText))
  if (hunks.length > 0) {
    lines.push(oldText === undefined ? '--- /dev/null' : `--- a/${path}`)
    lines.push(newText === undefined ? '+++ /dev/null' : `+++ b/${path}`)
    lines.push(...hunks)
  }
  return lines
}

export interface DiffOptions {
  /** 比べるパスを絞り込む pathspec。 */
  readonly paths?: readonly string[]
  /** 比べる対象にするパス。指定がなければ両方の Tree にあるすべてのパス。 */
  readonly only?: ReadonlySet<string>
  readonly nameOnly?: boolean
  readonly stat?: boolean
}

function matches(path: string, specs: readonly string[] | undefined): boolean {
  if (!specs || specs.length === 0) return true
  return specs.some((spec) => spec === '.' || path === spec || path.startsWith(spec.endsWith('/') ? spec : `${spec}/`))
}

function countChanges(oldText: string | undefined, newText: string | undefined): [number, number] {
  const ops = editScript(
    splitLines(oldText === undefined ? '' : displayContent(oldText)),
    splitLines(newText === undefined ? '' : displayContent(newText)),
  )
  return [ops.filter((op) => op.type === '+').length, ops.filter((op) => op.type === '-').length]
}

/** from から to への差分を git diff の形式で返す。 */
export function diffTrees(from: Tree, to: Tree, options: DiffOptions = {}): string {
  const paths = changedPaths(from, to).filter(
    (path) => matches(path, options.paths) && (!options.only || options.only.has(path)),
  )
  if (options.nameOnly) return paths.join('\n')
  if (options.stat) {
    if (paths.length === 0) return ''
    const counts = paths.map((path) => countChanges(from[path], to[path]))
    const width = Math.max(...paths.map((path) => path.length))
    // 変更行数の桁は、いちばん大きい数に合わせる (git と同じ)
    const digits = Math.max(...counts.map(([added, removed]) => String(added + removed).length))
    const lines = paths.map((path, index) => {
      const [added, removed] = counts[index] as [number, number]
      const total = String(added + removed).padStart(digits)
      return ` ${path.padEnd(width)} | ${total} ${'+'.repeat(added)}${'-'.repeat(removed)}`
    })
    const insertions = counts.reduce((sum, [added]) => sum + added, 0)
    const deletions = counts.reduce((sum, [, removed]) => sum + removed, 0)
    const parts = [`${paths.length} file${paths.length === 1 ? '' : 's'} changed`]
    if (insertions > 0) parts.push(`${insertions} insertion${insertions === 1 ? '' : 's'}(+)`)
    if (deletions > 0) parts.push(`${deletions} deletion${deletions === 1 ? '' : 's'}(-)`)
    return [...lines, ` ${parts.join(', ')}`].join('\n')
  }
  return paths.flatMap((path) => fileDiff(path, from[path], to[path])).join('\n')
}
