/**
 * 履歴やファイルを調べるコマンド: describe / shortlog / git grep。
 */
import { log, type LogOptions } from './log'
import {
  GitError,
  ancestors,
  authorOf,
  getCommit,
  hasTrackedChanges,
  headCommitId,
  resolveRef,
  subject,
  tryResolveRef,
  type CommitId,
  type OperationResult,
  type Repo,
} from './model'
import { parseGitlink, splitLines, type Tree } from './tree'

export interface DescribeOptions {
  /** --tags: 軽量タグも使う。 */
  readonly tags?: boolean
  /** --all: ブランチなど、すべての参照を使う。 */
  readonly all?: boolean
  /** --always: 使えるタグがなければコミット ID を出す。 */
  readonly always?: boolean
  /** --long: タグちょうどでも -0-g<ID> を付ける。 */
  readonly long?: boolean
  /** --abbrev=0: タグの名前だけを出す。 */
  readonly abbrevZero?: boolean
  /** --dirty[=<印>]: コミットしていない変更があれば印 (既定は -dirty) を付ける。 */
  readonly dirty?: string
  /** --exact-match: タグちょうどのときだけ。 */
  readonly exactMatch?: boolean
}

/** describe に使える名前 → コミット。 */
function candidates(repo: Repo, options: DescribeOptions): Array<[string, CommitId]> {
  const tags = Object.entries(repo.tags)
    .filter(([, tag]) => options.tags || options.all || tag.message !== undefined)
    .map(([name, tag]): [string, CommitId] => [options.all ? `tags/${name}` : name, tag.target])
  if (!options.all) return tags
  return [
    ...tags,
    ...Object.entries(repo.branches).map(([name, id]): [string, CommitId] => [`heads/${name}`, id]),
    ...Object.entries(repo.remoteBranches).map(([name, id]): [string, CommitId] => [`remotes/${name}`, id]),
  ]
}

function idNumber(id: CommitId): number {
  return Number(/\d+$/.exec(id)?.[0] ?? 0)
}

function describeOne(repo: Repo, rev: string, options: DescribeOptions): string {
  const target = resolveRef(repo, rev)
  const reachable = ancestors(repo.commits, target)
  const found = candidates(repo, options)
    .filter(([, id]) => reachable.has(id))
    .map(([name, id]) => {
      const behind = ancestors(repo.commits, id)
      return { name, id, distance: [...reachable].filter((other) => !behind.has(other)).length }
    })
    // 近いものを優先し、同じ距離なら新しいタグ (同じなら名前の順)
    .sort((a, b) => a.distance - b.distance || idNumber(b.id) - idNumber(a.id) || a.name.localeCompare(b.name))
  const best = found[0]
  if (best === undefined || (options.exactMatch && best.distance > 0)) {
    if (options.exactMatch) throw new GitError(`fatal: no tag exactly matches '${target}'`)
    if (options.always) return target
    if (candidates(repo, { ...options, tags: true }).length === 0) throw new GitError('fatal: No names found, cannot describe anything.')
    if (!options.tags && !options.all && Object.keys(repo.tags).length > 0) {
      throw new GitError(`fatal: No annotated tags can describe '${target}'.\nHowever, there were unannotated tags: try --tags.`)
    }
    throw new GitError(`fatal: No tags can describe '${target}'.\nTry --always, or create some tags.`)
  }
  if (options.abbrevZero) return best.name
  if (best.distance === 0 && !options.long) return best.name
  return `${best.name}-${best.distance}-g${target}`
}

/** git describe [--tags] [--all] [--always] [--long] [--abbrev=0] [--dirty] [<コミット>...] */
export function describe(repo: Repo, revs: readonly string[], options: DescribeOptions = {}): OperationResult {
  if (options.dirty !== undefined && revs.length > 0) throw new GitError('fatal: option \'--dirty\' and commit-ishes cannot be used together')
  const lines = (revs.length === 0 ? ['HEAD'] : revs).map((rev) => {
    const text = describeOne(repo, rev, options)
    return options.dirty !== undefined && hasTrackedChanges(repo) ? `${text}${options.dirty}` : text
  })
  return { repo, output: lines.join('\n') }
}

export interface ShortlogOptions extends Pick<LogOptions, 'revisions' | 'all' | 'merges' | 'paths'> {
  /** -s: 作者ごとの数だけ。 */
  readonly summary?: boolean
  /** -n: 数の多い順。 */
  readonly numbered?: boolean
}

/** git shortlog [-s] [-n] [<リビジョン>...]: 作者ごとにコミットの件名をまとめる。 */
export function shortlog(repo: Repo, options: ShortlogOptions = {}): OperationResult {
  headCommitId(repo)
  const ids = log(repo, { ...options, format: 'format:%H', decorate: false }).output.split('\n').filter(Boolean)
  const groups = new Map<string, string[]>()
  // 作者ごとに、古いコミットから並べる (本物と同じ)
  for (const id of [...ids].reverse()) {
    const commit = getCommit(repo, id)
    const author = authorOf(commit)
    groups.set(author, [...(groups.get(author) ?? []), subject(commit.message)])
  }
  const authors = [...groups.keys()].sort((a, b) =>
    options.numbered ? (groups.get(b)?.length ?? 0) - (groups.get(a)?.length ?? 0) || a.localeCompare(b) : a.localeCompare(b),
  )
  const lines = authors.flatMap((author) => {
    const subjects = groups.get(author) ?? []
    if (options.summary) return [`${String(subjects.length).padStart(6)}\t${author}`]
    return [`${author} (${subjects.length}):`, ...subjects.map((text) => `      ${text}`), '']
  })
  return { repo, output: lines.join('\n').replace(/\n+$/, '') }
}

export interface GrepOptions {
  readonly patterns: readonly string[]
  readonly ignoreCase?: boolean
  readonly lineNumber?: boolean
  readonly count?: boolean
  /** -l: 一致したファイルの名前だけ。 */
  readonly filesWithMatches?: boolean
  readonly invert?: boolean
  /** -w: 単語として一致するものだけ。 */
  readonly word?: boolean
  /** -F: パターンを文字列として扱う。 */
  readonly fixed?: boolean
  /** --cached: 作業ディレクトリではなくステージを探す。 */
  readonly cached?: boolean
  /** 探すコミット (指定すると、そのコミットのファイルを探す)。 */
  readonly tree?: string
  readonly paths?: readonly string[]
}

/** git grep: 追跡しているファイル (またはコミットのファイル) から、一致する行を探す。なければ失敗する。 */
export function gitGrep(repo: Repo, options: GrepOptions): OperationResult {
  if (options.patterns.length === 0) throw new GitError('fatal: no pattern given')
  const regexes = options.patterns.map((pattern) => {
    const source = options.fixed ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : pattern
    try {
      return new RegExp(options.word ? `(?<![\\w])(?:${source})(?![\\w])` : source, options.ignoreCase ? 'i' : '')
    } catch {
      throw new GitError(`fatal: command line, '${pattern}': 正規表現として読めません`)
    }
  })
  let files: Tree
  let prefix = ''
  if (options.tree !== undefined) {
    const id = resolveRef(repo, options.tree)
    files = getCommit(repo, id).tree
    prefix = `${options.tree}:`
  } else if (options.cached) {
    files = repo.index
  } else {
    // 作業ディレクトリのうち、追跡しているファイル
    files = Object.fromEntries(Object.keys(repo.index).flatMap((path) => (path in repo.workdir ? [[path, repo.workdir[path] as string]] : [])))
  }
  const paths = Object.keys(files)
    .filter((path) => parseGitlink(files[path]) === null)
    .filter((path) => !options.paths || options.paths.length === 0 || options.paths.some((spec) => spec === '.' || path === spec || path.startsWith(`${spec.replace(/\/+$/, '')}/`)))
    .sort()
  const lines: string[] = []
  for (const path of paths) {
    const matched = splitLines(files[path] as string)
      .map((line, index) => ({ text: line.replace(/\n$/, ''), number: index + 1 }))
      .filter(({ text }) => regexes.some((regex) => regex.test(text)) !== Boolean(options.invert))
    if (matched.length === 0) continue
    if (options.filesWithMatches) lines.push(`${prefix}${path}`)
    else if (options.count) lines.push(`${prefix}${path}:${matched.length}`)
    else for (const { text, number } of matched) lines.push(`${prefix}${path}:${options.lineNumber ? `${number}:` : ''}${text}`)
  }
  if (lines.length === 0) throw new GitError('')
  return { repo, output: lines.join('\n') }
}

/** git grep の位置引数のうち、コミットとして読めてファイルでないもの。 */
export function grepTree(repo: Repo, arg: string): boolean {
  return tryResolveRef(repo, arg) !== null && !(arg in repo.workdir) && !(arg in repo.index)
}
