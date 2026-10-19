/**
 * git log。リビジョンの範囲 (A..B / A...B / ^A)、並べ方 (--graph のときは topo-order)、
 * 絞り込み (-n / --first-parent / --merges / --grep / -S / -G / パス) と、表示の形 (--oneline / --format / --graph / -p / --stat)。
 */
import { diffTrees, editScript } from './diff'
import {
  GitError,
  ancestors,
  getCommit,
  headCommitId,
  refNames,
  resolveRef,
  subject,
  type Commit,
  authorOf,
  type CommitId,
  type OperationResult,
  type Repo,
} from './model'

export interface LogOptions {
  /** 位置引数のリビジョン (A, ^A, A..B, A...B)。 */
  readonly revisions?: readonly string[]
  readonly all?: boolean
  readonly branches?: boolean
  readonly tags?: boolean
  readonly remotes?: boolean
  readonly maxCount?: number
  /** oneline / short / medium / full / format:<書式> (tformat: も可)。既定は medium。 */
  readonly format?: string
  readonly graph?: boolean
  readonly reverse?: boolean
  readonly firstParent?: boolean
  /** true ならマージコミットだけ、false ならマージコミット以外だけ。 */
  readonly merges?: boolean
  readonly grep?: string
  readonly invertGrep?: boolean
  /** --author=<パターン>: 作者で絞り込む。 */
  readonly author?: string
  /** -i: --grep・--author・-S・-G で大文字と小文字を区別しない。 */
  readonly ignoreCase?: boolean
  /** -S<文字列>: その文字列の出てくる数が変わったコミットだけ。 */
  readonly pickaxe?: string
  /** --pickaxe-regex: -S を正規表現として扱う。 */
  readonly pickaxeRegex?: boolean
  /** -G<正規表現>: 足した行か消した行が一致するコミットだけ。 */
  readonly pickaxeGrep?: string
  /** --pickaxe-all: -S / -G で -p のとき、一致しないファイルの差分も出す。 */
  readonly pickaxeAll?: boolean
  readonly paths?: readonly string[]
  readonly patch?: boolean
  readonly stat?: boolean
  readonly nameOnly?: boolean
  readonly decorate?: boolean
  /** --no-notes なら false。 */
  readonly notes?: boolean
}

/** コミット ID の番号 (C12 なら 12)。新しいコミットほど大きい。 */
function idNumber(id: CommitId): number {
  return Number(/\d+$/.exec(id)?.[0] ?? 0)
}

function walk(repo: Repo, tips: readonly CommitId[], firstParent: boolean): Set<CommitId> {
  if (!firstParent) {
    const result = new Set<CommitId>()
    for (const tip of tips) for (const id of ancestors(repo.commits, tip)) result.add(id)
    return result
  }
  const result = new Set<CommitId>()
  for (const tip of tips) {
    let id: CommitId | undefined = tip
    while (id !== undefined && !result.has(id)) {
      result.add(id)
      id = repo.commits[id]?.parents[0]
    }
  }
  return result
}

/** 表示するコミットの集合 (並べる前)。 */
function selectCommits(repo: Repo, options: LogOptions): Set<CommitId> {
  const include: CommitId[] = []
  const exclude: CommitId[] = []
  let symmetric: [CommitId, CommitId] | null = null
  for (const rev of options.revisions ?? []) {
    if (rev.includes('...')) {
      const [a = '', b = ''] = rev.split('...')
      symmetric = [resolveRef(repo, a || 'HEAD'), resolveRef(repo, b || 'HEAD')]
    } else if (rev.includes('..')) {
      const [a = '', b = ''] = rev.split('..')
      exclude.push(resolveRef(repo, a || 'HEAD'))
      include.push(resolveRef(repo, b || 'HEAD'))
    } else if (rev.startsWith('^')) {
      exclude.push(resolveRef(repo, rev.slice(1)))
    } else {
      include.push(resolveRef(repo, rev))
    }
  }
  if (options.all || options.branches) include.push(...Object.values(repo.branches))
  if (options.all || options.tags) include.push(...Object.values(repo.tags).map((tag) => tag.target))
  if (options.all || options.remotes) include.push(...Object.values(repo.remoteBranches))
  // --all は refs/ の下のすべての参照 (refs/original/ と refs/replace/ も) と HEAD
  if (options.all) include.push(...Object.values(repo.originalRefs), ...Object.values(repo.replaces), headCommitId(repo))
  if (include.length === 0 && symmetric === null) include.push(resolveRef(repo, 'HEAD'))

  const firstParent = options.firstParent ?? false
  const selected = walk(repo, include, firstParent)
  if (symmetric !== null) {
    const [a, b] = symmetric
    const left = walk(repo, [a], firstParent)
    const right = walk(repo, [b], firstParent)
    for (const id of left) if (!right.has(id)) selected.add(id)
    for (const id of right) if (!left.has(id)) selected.add(id)
  }
  for (const id of walk(repo, exclude, false)) selected.delete(id)
  return selected
}

function changesPath(repo: Repo, commit: Commit, specs: readonly string[]): boolean {
  const touched = (from: Readonly<Record<string, string>>) =>
    Object.keys({ ...from, ...commit.tree }).some(
      (path) =>
        from[path] !== commit.tree[path] &&
        specs.some((spec) => spec === '.' || path === spec || path.startsWith(`${spec.replace(/\/$/, '')}/`)),
    )
  if (commit.parents.length === 0) return touched({})
  // マージコミットは、どの親と比べても変わっているときだけ (Git の既定の履歴の単純化と同じ)
  return commit.parents.every((parent) => touched(getCommit(repo, parent).tree))
}

function matchesGrep(message: string, pattern: string, ignoreCase = false): boolean {
  try {
    return new RegExp(pattern, ignoreCase ? 'i' : '').test(message)
  } catch {
    return ignoreCase ? message.toLowerCase().includes(pattern.toLowerCase()) : message.includes(pattern)
  }
}

function pickaxeRegExp(pattern: string, flags: string): RegExp {
  try {
    return new RegExp(pattern, flags)
  } catch {
    throw new GitError(`fatal: invalid regex: ${pattern}`)
  }
}

function matchesPath(path: string, specs: readonly string[] | undefined): boolean {
  return !specs || specs.length === 0 || specs.some((spec) => spec === '.' || path === spec || path.startsWith(`${spec.replace(/\/$/, '')}/`))
}

/**
 * -S / -G に一致するファイル。マージコミットは (本物の log と同じく差分を出さないので) どれも一致しない。
 * -S は文字列の出てくる数が変わったファイル、-G は足した行か消した行が正規表現に一致するファイル。
 */
function pickaxePaths(repo: Repo, commit: Commit, options: LogOptions): Set<string> {
  const matched = new Set<string>()
  if (commit.parents.length > 1) return matched
  const before = commit.parents[0] === undefined ? {} : getCommit(repo, commit.parents[0]).tree
  const flags = options.ignoreCase ? 'gi' : 'g'
  const count = (text: string | undefined): number => {
    if (text === undefined || options.pickaxe === undefined || options.pickaxe === '') return 0
    if (options.pickaxeRegex) return [...text.matchAll(pickaxeRegExp(options.pickaxe, flags))].length
    const [haystack, needle] = options.ignoreCase ? [text.toLowerCase(), options.pickaxe.toLowerCase()] : [text, options.pickaxe]
    return haystack.split(needle).length - 1
  }
  const grep = options.pickaxeGrep === undefined ? null : pickaxeRegExp(options.pickaxeGrep, options.ignoreCase ? 'i' : '')
  for (const path of Object.keys({ ...before, ...commit.tree })) {
    const [a, b] = [before[path], commit.tree[path]]
    if (a === b || !matchesPath(path, options.paths)) continue
    if (options.pickaxe !== undefined && count(a) !== count(b)) matched.add(path)
    if (grep !== null) {
      const lines = (text: string | undefined) => (text === undefined || text === '' ? [] : text.replace(/\n$/, '').split('\n'))
      if (editScript(lines(a), lines(b)).some((op) => op.type !== ' ' && grep.test(op.line))) matched.add(path)
    }
  }
  return matched
}

function hasPickaxe(options: LogOptions): boolean {
  return options.pickaxe !== undefined || options.pickaxeGrep !== undefined
}

function only(tree: Readonly<Record<string, string>>, paths: ReadonlySet<string>): Record<string, string> {
  return Object.fromEntries(Object.entries(tree).filter(([path]) => paths.has(path)))
}

/** --graph のときの並べ方 (Git の --topo-order と同じく、子をすべて出してから親を出し、ブランチごとにまとめる)。 */
function topoOrder(ids: ReadonlySet<CommitId>, parentsOf: (id: CommitId) => CommitId[]): CommitId[] {
  const indegree = new Map<CommitId, number>([...ids].map((id) => [id, 0]))
  for (const id of ids) for (const parent of parentsOf(id)) indegree.set(parent, (indegree.get(parent) ?? 0) + 1)
  // 子のないコミット (先端) を新しい順に積み、後入れ先出しで取り出す
  const stack = [...ids].filter((id) => indegree.get(id) === 0).sort((a, b) => idNumber(a) - idNumber(b))
  const order: CommitId[] = []
  while (stack.length > 0) {
    const id = stack.pop() as CommitId
    order.push(id)
    // Git と同じく親を順に積むので、マージした側の枝が先に出る
    for (const parent of parentsOf(id)) {
      const rest = (indegree.get(parent) ?? 1) - 1
      indegree.set(parent, rest)
      if (rest === 0) stack.push(parent)
    }
  }
  return order
}

/** 表示しないコミットを飛ばした親 (第 1 親をたどって、表示するコミットに行き着くまで)。 */
function rewrittenParents(repo: Repo, id: CommitId, shown: ReadonlySet<CommitId>, firstParent: boolean): CommitId[] {
  const parents = getCommit(repo, id).parents.slice(0, firstParent ? 1 : undefined)
  const result: CommitId[] = []
  for (const parent of parents) {
    let current: CommitId | undefined = parent
    while (current !== undefined && !shown.has(current)) current = repo.commits[current]?.parents[0]
    if (current !== undefined && !result.includes(current)) result.push(current)
  }
  return result
}

const NAMED_FORMATS = new Set(['oneline', 'short', 'medium', 'full', 'fuller'])

/** --format の書式を 1 つのコミットに当てはめる。 */
function applyFormat(template: string, commit: Commit, decoration: string[], notes: string | undefined): string {
  const [first, ...rest] = commit.message.split('\n')
  const body = rest.join('\n').replace(/^\n+/, '')
  const values: Record<string, string> = {
    H: commit.id,
    h: commit.id,
    s: first ?? '',
    b: body === '' ? '' : `${body}\n`,
    B: `${commit.message}\n`,
    d: decoration.length > 0 ? ` (${decoration.join(', ')})` : '',
    D: decoration.join(', '),
    P: commit.parents.join(' '),
    p: commit.parents.join(' '),
    an: authorOf(commit),
    N: notes === undefined ? '' : `${notes}\n`,
    n: '\n',
    '%': '%',
  }
  return template.replace(/%(an|[HhsbBdDPpNn%])/g, (_, key: string) => values[key] ?? '')
}

/** 1 つのコミットの表示 (行の配列)。 */
function entryLines(repo: Repo, commit: Commit, options: LogOptions, format: string): string[] {
  const decoration = options.decorate === false ? [] : refNames(repo, commit.id)
  const deco = decoration.length > 0 ? ` (${decoration.join(', ')})` : ''
  const notes = options.notes === false ? undefined : repo.notes[commit.id]
  let lines: string[]
  if (format === 'oneline') {
    lines = [`${commit.id}${deco} ${subject(commit.message)}`]
  } else if (format.startsWith('format:') || format.startsWith('tformat:') || !NAMED_FORMATS.has(format)) {
    const template = format.replace(/^t?format:/, '')
    lines = applyFormat(template, commit, decoration, notes).replace(/\n$/, '').split('\n')
  } else {
    lines = [`commit ${commit.id}${deco}`]
    if (commit.parents.length > 1) lines.push(`Merge: ${commit.parents.join(' ')}`)
    lines.push(`Author: ${authorOf(commit)}`)
    const message = format === 'short' ? [subject(commit.message)] : commit.message.split('\n')
    lines.push('', ...message.map((line) => (line === '' ? '' : `    ${line}`)))
    if (notes !== undefined && format !== 'short') {
      lines.push('', 'Notes:', ...notes.split('\n').map((line) => `    ${line}`))
    }
  }
  if ((options.patch || options.stat || options.nameOnly) && commit.parents.length <= 1) {
    let parentTree = commit.parents[0] === undefined ? {} : getCommit(repo, commit.parents[0]).tree
    let tree = commit.tree
    // -S / -G では、--pickaxe-all がなければ一致したファイルの差分だけを出す
    if (hasPickaxe(options) && !options.pickaxeAll) {
      const paths = pickaxePaths(repo, commit, options)
      parentTree = only(parentTree, paths)
      tree = only(tree, paths)
    }
    const diffs: string[] = []
    if (options.stat) diffs.push(diffTrees(parentTree, tree, { stat: true }))
    if (options.nameOnly) diffs.push(diffTrees(parentTree, tree, { nameOnly: true }))
    if (options.patch) diffs.push(diffTrees(parentTree, tree))
    const text = diffs.filter((diff) => diff !== '').join('\n\n')
    if (text !== '') lines.push(...(format === 'oneline' ? [] : ['']), ...text.split('\n'))
  }
  return lines
}

export function log(repo: Repo, options: LogOptions = {}): OperationResult {
  if (options.graph && options.reverse) {
    throw new GitError("fatal: options '--reverse' and '--graph' cannot be used together")
  }
  const format = options.format ?? 'medium'
  const selected = selectCommits(repo, options)
  const shown = new Set(
    [...selected].filter((id) => {
      const commit = getCommit(repo, id)
      if (options.merges === true && commit.parents.length < 2) return false
      if (options.merges === false && commit.parents.length > 1) return false
      if (options.grep !== undefined && matchesGrep(commit.message, options.grep, options.ignoreCase) === Boolean(options.invertGrep)) return false
      if (options.author !== undefined && !matchesGrep(authorOf(commit), options.author, options.ignoreCase)) return false
      if (hasPickaxe(options) && pickaxePaths(repo, commit, options).size === 0) return false
      if (options.paths && options.paths.length > 0 && !changesPath(repo, commit, options.paths)) return false
      return true
    }),
  )
  const firstParent = options.firstParent ?? false
  const parentsOf = (id: CommitId) => rewrittenParents(repo, id, shown, firstParent)
  const full = options.graph ? topoOrder(shown, parentsOf) : [...shown].sort((a, b) => idNumber(b) - idNumber(a))
  const order = options.maxCount === undefined ? [...full] : full.slice(0, Math.max(0, options.maxCount))
  if (options.reverse) order.reverse()

  const separate = format !== 'oneline' && !format.startsWith('tformat:') && NAMED_FORMATS.has(format)
  const entries = order.map((id, index) => {
    const lines = entryLines(repo, getCommit(repo, id), options, format)
    return separate && index < order.length - 1 ? [...lines, ''] : lines
  })
  if (!options.graph) return { repo, output: entries.flat().join('\n') }
  // -n で切っても、グラフの線は表示しないコミットへ続くように描く
  return { repo, output: drawGraph(order, parentsOf, entries).join('\n') }
}

// ---- --graph ----

function render(chars: string[]): string {
  return chars.join('').replace(/\s+$/, '')
}

function blank(width: number): string[] {
  return Array.from({ length: Math.max(0, width) }, () => ' ')
}

/**
 * 2 つの列が同じコミットを待っているとき、右の列 (j) の線を左の列 (index) に寄せる行。
 * Git と同じく 1 行に 1 列ずつ左へ動かし、間の列とは交差させる (| |/ のあとに |/|)。
 */
function collapseRows(columns: readonly CommitId[], index: number, j: number): string[] {
  const rows: string[] = []
  for (let position = j; position > index; position--) {
    const chars = blank(2 * columns.length)
    columns.forEach((_, k) => {
      if (k === j) return
      // j より右の列は、最初の行で 1 列ぶん左へ寄る
      if (k > j) chars[position === j ? 2 * k - 1 : 2 * (k - 1)] = position === j ? '/' : '|'
      else chars[2 * k] = '|'
    })
    chars[2 * position - 1] = '/'
    rows.push(render(chars))
  }
  return rows
}

/**
 * Git の --graph と同じ形の文字のグラフを、各コミットの表示の左に付ける。
 * 列ごとに「次に来るコミット」を持ち、コミットの行 (*)・マージの行 (|\)・合流の行 (|/) を描く。
 */
function drawGraph(order: readonly CommitId[], parentsOf: (id: CommitId) => CommitId[], entries: readonly string[][]): string[] {
  const out: string[] = []
  let columns: CommitId[] = []
  order.forEach((id, n) => {
    let index = columns.indexOf(id)
    if (index === -1) {
      columns.push(id)
      index = columns.length - 1
    } else {
      for (let j = columns.indexOf(id, index + 1); j !== -1; j = columns.indexOf(id, index + 1)) {
        out.push(...collapseRows(columns, index, j))
        columns.splice(j, 1)
      }
    }
    const parents = parentsOf(id)
    const after = [...columns]
    after.splice(index, 1, ...parents)
    const width = 2 * Math.max(columns.length, after.length)

    // コミットの行
    const row = blank(width)
    columns.forEach((_, k) => {
      row[2 * k] = '|'
    })
    row[2 * index] = '*'
    if (parents.length > 2) {
      // octopus は *-. の形 (親が 4 つなら *---.)
      const marker = `${'-'.repeat(2 * (parents.length - 2) - 1)}.`
      ;[...marker].forEach((char, offset) => {
        row[2 * index + 1 + offset] = char
      })
    }
    const lines = entries[n] ?? ['']
    out.push(`${row.join('')}${lines[0] ?? ''}`.replace(/\s+$/, ''))

    // マージの行 (|\) または、列がなくなって右の列が寄る行 (|/)
    let edge: string | null = null
    if (parents.length >= 2) {
      const chars = blank(2 * after.length)
      after.forEach((_, k) => {
        if (k <= index) chars[2 * k] = '|'
        else chars[2 * k - 1] = '\\'
      })
      edge = render(chars)
    } else if (parents.length === 0 && index < columns.length - 1) {
      const chars = blank(2 * columns.length)
      after.forEach((_, k) => {
        if (k < index) chars[2 * k] = '|'
        else chars[2 * k + 1] = '/'
      })
      edge = render(chars)
    }
    const continuation = after.map(() => '|').join(' ')
    const pad = (prefix: string, text: string) =>
      `${prefix.padEnd(2 * after.length)}${text}`.replace(/\s+$/, '')
    const rest = lines.slice(1)
    if (edge !== null) out.push(pad(edge, rest.shift() ?? ''))
    for (const line of rest) out.push(pad(continuation, line))
    columns = after
  })
  return out
}
