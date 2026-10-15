/**
 * git submodule。サブモジュールは別の Repo として持ち、親のリポジトリには gitlink (そのコミット ID) と
 * .gitmodules だけを記録する。サブモジュールの取得元は URL ごとの模擬のサーバー (Repo.libraries) で、
 * 初めて使う URL なら README.md だけの小さなリポジトリができる。
 */
import {
  DEFAULT_BRANCH,
  GitError,
  createRepo,
  detachHead,
  hasTrackedChanges,
  headCommitId,
  headCommitIdOrNull,
  requireNoOperation,
  type Commit,
  type CommitId,
  type Library,
  type OperationResult,
  type Remote,
  type Repo,
} from './model'
import { fetch } from './remote'
import { gitlink, parseGitlink, withFile, type Tree } from './tree'

export const GITMODULES = '.gitmodules'

interface SubmoduleConfig {
  readonly name: string
  readonly path: string
  readonly url: string
  readonly branch?: string
}

/** .gitmodules を読む。 */
export function parseGitmodules(text: string | undefined): SubmoduleConfig[] {
  const result: SubmoduleConfig[] = []
  let current: { name: string; path?: string; url?: string; branch?: string } | null = null
  const flush = () => {
    if (current?.path !== undefined && current.url !== undefined) {
      result.push({
        name: current.name,
        path: current.path,
        url: current.url,
        ...(current.branch === undefined ? {} : { branch: current.branch }),
      })
    }
  }
  for (const raw of (text ?? '').split('\n')) {
    const line = raw.trim()
    const section = /^\[submodule "(.+)"\]$/.exec(line)
    if (section) {
      flush()
      current = { name: section[1] as string }
      continue
    }
    const entry = /^(path|url|branch)\s*=\s*(.+)$/.exec(line)
    if (entry && current) current[entry[1] as 'path' | 'url' | 'branch'] = (entry[2] as string).trim()
  }
  flush()
  return result
}

function formatGitmodules(entries: readonly SubmoduleConfig[]): string {
  return entries
    .map(
      (entry) =>
        `[submodule "${entry.name}"]\n\tpath = ${entry.path}\n\turl = ${entry.url}\n` +
        (entry.branch === undefined ? '' : `\tbranch = ${entry.branch}\n`),
    )
    .join('')
}

/** ステージにある (コミットされる) サブモジュールの一覧。.gitmodules に書いてあるもの。 */
function submoduleEntries(repo: Repo): SubmoduleConfig[] {
  const configs = parseGitmodules(repo.workdir[GITMODULES] ?? repo.index[GITMODULES])
  return Object.keys(repo.index)
    .filter((path) => parseGitlink(repo.index[path]) !== null)
    .sort()
    .map((path) => configs.find((entry) => entry.path === path) ?? { name: path, path, url: '' })
}

function select(repo: Repo, paths: readonly string[]): SubmoduleConfig[] {
  const entries = submoduleEntries(repo)
  for (const path of paths) {
    if (!entries.some((entry) => entry.path === path.replace(/\/$/, ''))) {
      throw new GitError(`error: pathspec '${path}' did not match any file(s) known to git`)
    }
  }
  return paths.length === 0 ? entries : entries.filter((entry) => paths.some((path) => path.replace(/\/$/, '') === entry.path))
}

/** URL の最後の名前 (.git を除く)。git submodule add でパスを省略したときに使う。 */
function nameFromUrl(url: string): string {
  const name = url.replace(/\/+$/, '').split(/[/:]/).at(-1)?.replace(/\.git$/, '') ?? ''
  if (name === '') throw new GitError(`fatal: '${url}' からパスを決められません。パスも指定してください`)
  return name
}

/** URL の取得元。初めての URL なら、README.md だけの小さなリポジトリを作る。 */
function ensureLibrary(repo: Repo, url: string): { repo: Repo; library: Library } {
  const existing = repo.libraries[url]
  if (existing) return { repo, library: existing }
  // コミット ID の頭文字は、名前の頭文字 (使われていれば空いている文字) にする
  const used = new Set(['C', ...Object.values(repo.libraries).map((library) => library.prefix)])
  const first = nameFromUrl(url).charAt(0).toUpperCase()
  const prefix = /^[A-Z]$/.test(first) && !used.has(first) ? first : ([...'LMNOPQRSTUVWXYZABDEFGHIJK'].find((c) => !used.has(c)) ?? 'Z')
  const id = `${prefix}0`
  const root: Commit = { id, parents: [], message: 'Initial commit', tree: { 'README.md': `# ${nameFromUrl(url)}\n` } }
  const library: Library = {
    remote: { name: 'origin', url, commits: { [id]: root }, branches: { [DEFAULT_BRANCH]: id }, tags: {} },
    prefix,
    nextId: 1,
  }
  return { repo: { ...repo, libraries: { ...repo.libraries, [url]: library } }, library }
}

export interface CloneOptions {
  /** clone 先の場所 (~/teammate など)。 */
  readonly worktree: string
  /** コミット ID の頭文字 (origin と同じ C なら undefined)。 */
  readonly prefix?: string
  readonly nextId: number
  /** --branch: チェックアウトするブランチ (既定は main)。 */
  readonly branch?: string
  /** このコミットで detached HEAD にする (git submodule update)。 */
  readonly at?: CommitId
}

/** 模擬のサーバーのリポジトリ (remote) を clone した Repo。 */
export function cloneRemote(remote: Remote, options: CloneOptions): Repo {
  const fallback = DEFAULT_BRANCH in remote.branches ? DEFAULT_BRANCH : Object.keys(remote.branches).sort()[0]
  const branch = options.branch ?? fallback
  if (branch === undefined) throw new GitError('warning: 空のリポジトリを clone しました。このアプリでは空のリポジトリの clone は未対応です')
  const tip = remote.branches[branch]
  if (tip === undefined) throw new GitError(`fatal: Remote branch ${branch} not found in upstream origin`)
  const at = options.at
  const id = at ?? tip
  const tree: Tree = (remote.commits[id] as Commit).tree
  const message = `clone: from ${remote.url}`
  return {
    ...createRepo(),
    commits: remote.commits,
    branches: { [branch]: tip },
    head: at === undefined ? { type: 'branch', name: branch } : { type: 'detached', id },
    index: tree,
    workdir: tree,
    tags: remote.tags,
    reflogs: {
      HEAD: [...(at === undefined ? [] : [{ id, message: `checkout: moving from ${branch} to ${id}` }]), { id: tip, message }],
      [branch]: [{ id: tip, message }],
    },
    remotes: { origin: { ...remote, name: 'origin' } },
    remoteBranches: Object.fromEntries(Object.entries(remote.branches).map(([name, target]) => [`origin/${name}`, target])),
    upstreams: { [branch]: `origin/${branch}` },
    nextId: options.nextId,
    ...(options.prefix === undefined ? {} : { idPrefix: options.prefix }),
    worktree: options.worktree,
    home: options.worktree,
  }
}

/** 取得元を clone したサブモジュールの Repo。at を指定するとそのコミットで detached HEAD にする。 */
function cloneLibrary(library: Library, worktree: string, at?: CommitId): Repo {
  return cloneRemote(library.remote, {
    worktree,
    prefix: library.prefix,
    nextId: library.nextId,
    ...(at === undefined ? {} : { at }),
  })
}

/** サブモジュールの、取得元と同じ URL のリモートの名前。 */
function libraryRemoteName(nested: Repo, url: string): string | null {
  return Object.keys(nested.remotes).find((name) => nested.remotes[name]?.url === url) ?? null
}

/**
 * 入れ子のリポジトリ (clone・サブモジュール) でコマンドを実行する前に、模擬のサーバー
 * (一番外側のリポジトリのリモートと、サブモジュールの取得元) の最新の中身を、同じ URL のリモートに反映する。
 * コミットの採番も、同じ頭文字のリポジトリどうしで共有する (ID がぶつからないように)。
 */
export function syncServersIn(root: Repo, nested: Repo): Repo {
  const remotes = { ...nested.remotes }
  let nextId = nested.nextId
  for (const [name, remote] of Object.entries(nested.remotes)) {
    const server = Object.values(root.remotes).find((other) => other.url === remote.url) ?? root.libraries[remote.url]?.remote
    if (server) remotes[name] = { ...server, name }
  }
  if (nested.idPrefix === undefined) nextId = Math.max(nextId, root.nextId)
  for (const library of Object.values(root.libraries)) {
    if (library.prefix === nested.idPrefix) nextId = Math.max(nextId, library.nextId)
  }
  return { ...nested, remotes, nextId, libraries: root.libraries }
}

/** 入れ子のリポジトリでコマンドを実行したあとに、push した内容と採番を模擬のサーバーに書き戻す。 */
export function syncServersOut(root: Repo, nested: Repo): Repo {
  const remotes = { ...root.remotes }
  const libraries = { ...root.libraries, ...nested.libraries }
  for (const remote of Object.values(nested.remotes)) {
    for (const [name, other] of Object.entries(root.remotes)) {
      if (other.url === remote.url) remotes[name] = { ...remote, name }
    }
    const library = libraries[remote.url]
    if (library) libraries[remote.url] = { ...library, remote: { ...remote, name: 'origin' } }
  }
  for (const [url, library] of Object.entries(libraries)) {
    if (library.prefix === nested.idPrefix) libraries[url] = { ...library, nextId: Math.max(library.nextId, nested.nextId) }
  }
  const nextId = nested.idPrefix === undefined ? Math.max(root.nextId, nested.nextId) : root.nextId
  return { ...root, remotes, libraries, nextId }
}

/**
 * 親の作業ディレクトリの gitlink を、サブモジュールの今の HEAD に合わせる。
 * (git status で "modified: lib (new commits)" と出るのは、この値がステージと違うとき)
 */
export function syncSubmodules(root: Repo): Repo {
  let workdir = root.workdir
  const paths = new Set([...Object.keys(root.submodules), ...Object.keys(root.index).filter((p) => parseGitlink(root.index[p]) !== null)])
  for (const path of paths) {
    const nested = root.submodules[path]
    const staged = root.index[path]
    const head = nested ? checkedOut(nested) : null
    const value = head !== null ? gitlink(head) : parseGitlink(staged) !== null ? staged : undefined
    if (workdir[path] !== value) workdir = withFile(workdir, path, value)
  }
  return workdir === root.workdir ? root : { ...root, workdir }
}

/** 今いるリポジトリ (clone したリポジトリやサブモジュールの中にいれば、そのリポジトリ)。 */
export function activeRepo(root: Repo): Repo {
  const clone = root.clone === null ? undefined : root.clones[root.clone]
  if (clone) return activeRepo(clone)
  const nested = root.submodule === null ? undefined : root.submodules[root.submodule]
  return nested ? activeRepo(nested) : root
}

/**
 * サブモジュールの、親のリポジトリの中の場所 (メインの worktree) でチェックアウトしているコミット。
 * サブモジュールの別の worktree に cd していても、親の gitlink はこちらに合わせる。
 */
function checkedOut(nested: Repo): CommitId | null {
  const main = nested.home ?? nested.worktree
  if (nested.worktree === main) return headCommitIdOrNull(nested)
  const state = nested.worktrees[main]
  if (state === undefined) return headCommitIdOrNull(nested)
  return state.head.type === 'branch' ? (nested.branches[state.head.name] ?? null) : state.head.id
}

/** git submodule add [-b <ブランチ>] <URL> [<パス>] */
export function submoduleAdd(repo: Repo, url: string, rawPath?: string, branch?: string): OperationResult {
  requireNoOperation(repo)
  const path = (rawPath ?? nameFromUrl(url)).replace(/\/$/, '')
  if (path in repo.index) throw new GitError(`fatal: '${path}' already exists in the index`)
  if (path in repo.workdir || Object.keys(repo.workdir).some((file) => file.startsWith(`${path}/`))) {
    throw new GitError(`fatal: '${path}' already exists and is not a valid git repo`)
  }
  const { repo: withLibrary, library } = ensureLibrary(repo, url)
  if (branch !== undefined && !(branch in library.remote.branches)) {
    throw new GitError(`fatal: 'origin/${branch}' is not a commit and a branch '${branch}' cannot be created from it`)
  }
  let nested = cloneLibrary(library, `${repo.worktree}/${path}`)
  if (branch !== undefined && branch !== DEFAULT_BRANCH) {
    nested = detachHead(nested, `origin/${branch}`).repo
  }
  const entries = [
    ...parseGitmodules(repo.workdir[GITMODULES]),
    { name: path, path, url, ...(branch === undefined ? {} : { branch }) },
  ]
  const modules = formatGitmodules(entries)
  const link = gitlink(headCommitId(nested))
  return {
    repo: {
      ...withLibrary,
      submodules: { ...withLibrary.submodules, [path]: nested },
      index: withFile(withFile(withLibrary.index, path, link), GITMODULES, modules),
      workdir: withFile(withFile(withLibrary.workdir, path, link), GITMODULES, modules),
      config: { ...withLibrary.config, [`submodule.${path}.url`]: url },
    },
    output: `Cloning into '${repo.worktree}/${path}'...\ndone.`,
  }
}

/** git submodule [status] [--recursive] [<パス>...] (prefix は入れ子のサブモジュールのパスの前に付ける) */
export function submoduleStatus(repo: Repo, paths: readonly string[], recursive = false, prefix = ''): OperationResult {
  const lines = select(repo, paths).flatMap((entry) => {
    const recorded = parseGitlink(repo.index[entry.path]) as string
    const nested = repo.submodules[entry.path]
    if (!nested) return [`-${recorded} ${prefix}${entry.path}`]
    const head = headCommitId(nested)
    const conflicted = repo.conflicts.some((conflict) => conflict.path === entry.path)
    const mark = conflicted ? 'U' : head === recorded ? ' ' : '+'
    const line = `${mark}${head} ${prefix}${entry.path}${describe(nested, head)}`
    if (!recursive) return [line]
    const inner = submoduleStatus(nested, [], true, `${prefix}${entry.path}/`).output
    return inner === '' ? [line] : [line, inner]
  })
  return { repo, output: lines.join('\n') }
}

/** git submodule status が括弧で添える、そのコミットを指す参照 (git describe --all)。 */
function describe(nested: Repo, id: CommitId): string {
  if (nested.head.type === 'branch') return ` (heads/${nested.head.name})`
  const tag = Object.keys(nested.tags).sort().find((name) => nested.tags[name]?.target === id)
  if (tag !== undefined) return ` (tags/${tag})`
  const branch = Object.keys(nested.branches).sort().find((name) => nested.branches[name] === id)
  if (branch !== undefined) return ` (heads/${branch})`
  const remote = Object.keys(nested.remoteBranches).sort().find((name) => nested.remoteBranches[name] === id)
  return remote === undefined ? '' : ` (remotes/${remote})`
}

/** git submodule init [<パス>...]: .gitmodules の URL を設定に登録する。 */
export function submoduleInit(repo: Repo, paths: readonly string[], prefix = ''): OperationResult {
  let config = repo.config
  const lines: string[] = []
  for (const entry of select(repo, paths)) {
    const key = `submodule.${entry.name}.url`
    if (key in config || entry.url === '') continue
    config = { ...config, [key]: entry.url }
    lines.push(`Submodule '${entry.name}' (${entry.url}) registered for path '${prefix}${entry.path}'`)
  }
  return { repo: { ...repo, config }, output: lines.join('\n') }
}

export interface SubmoduleUpdateOptions {
  readonly init?: boolean
  /** --remote: 記録したコミットではなく、取得元のブランチの最新にする。 */
  readonly remote?: boolean
  /** --recursive: サブモジュールの中のサブモジュールも同じように更新する。 */
  readonly recursive?: boolean
}

/**
 * git submodule update [--init] [--remote] [--recursive] [<パス>...]: サブモジュールを記録したコミット (detached HEAD) にする。
 * prefix は、入れ子のサブモジュールを表示するときにパスの前に付ける (lib/ など)。
 */
export function submoduleUpdate(
  repo: Repo,
  paths: readonly string[],
  options: SubmoduleUpdateOptions = {},
  prefix = '',
): OperationResult {
  requireNoOperation(repo)
  const lines: string[] = []
  let current = repo
  if (options.init) {
    const initialized = submoduleInit(current, paths, prefix)
    current = initialized.repo
    if (initialized.output) lines.push(initialized.output)
  }
  for (const entry of select(current, paths)) {
    const url = current.config[`submodule.${entry.name}.url`]
    if (url === undefined) continue
    const { repo: withLibrary, library } = ensureLibrary(current, url)
    current = withLibrary
    const recorded = parseGitlink(current.index[entry.path]) as CommitId
    let nested = current.submodules[entry.path]
    if (!nested) {
      lines.push(`Cloning into '${current.worktree}/${entry.path}'...`)
      nested = cloneLibrary(library, `${current.worktree}/${entry.path}`)
    }
    nested = syncServersIn(current, nested)
    let target = recorded
    if (options.remote || !(recorded in nested.commits)) {
      const remoteName = libraryRemoteName(nested, url) ?? 'origin'
      nested = fetch(nested, { remote: remoteName }).repo
      if (options.remote) {
        const branch = entry.branch ?? DEFAULT_BRANCH
        const tip = nested.remoteBranches[`${remoteName}/${branch}`]
        if (tip === undefined) throw new GitError(`fatal: サブモジュール '${entry.path}' に ${remoteName}/${branch} がありません`)
        target = tip
      }
    }
    if (!(target in nested.commits)) {
      throw new GitError(
        `fatal: Fetched in submodule path '${prefix}${entry.path}', but it did not contain ${target}. ` +
          'Direct fetching of that commit failed.',
      )
    }
    if (headCommitId(nested) !== target || nested.head.type === 'branch') {
      try {
        nested = detachHead(nested, target).repo
      } catch (error) {
        if (!(error instanceof GitError)) throw error
        throw new GitError(`${error.message}\nfatal: Unable to checkout '${target}' in submodule path '${prefix}${entry.path}'`)
      }
      lines.push(`Submodule path '${prefix}${entry.path}': checked out '${target}'`)
    }
    if (options.recursive) {
      const inner = submoduleUpdate(nested, [], options, `${prefix}${entry.path}/`)
      nested = inner.repo
      if (inner.output) lines.push(inner.output)
    }
    current = syncServersOut({ ...current, submodules: { ...current.submodules, [entry.path]: nested } }, nested)
  }
  return { repo: syncSubmodules(current), output: lines.join('\n') }
}

/** git submodule deinit [-f] (<パス>... | --all): サブモジュールの中身を消し、設定の登録を外す。 */
export function submoduleDeinit(repo: Repo, paths: readonly string[], options: { force?: boolean; all?: boolean } = {}): OperationResult {
  if (paths.length === 0 && !options.all) {
    throw new GitError('fatal: Use \'--all\' if you really want to deinitialize all submodules')
  }
  const lines: string[] = []
  let current = repo
  for (const entry of select(repo, paths)) {
    const nested = current.submodules[entry.path]
    const key = `submodule.${entry.name}.url`
    if (nested) {
      const untracked = Object.keys(nested.workdir).some((file) => !(file in nested.index))
      if (!options.force && (hasTrackedChanges(nested) || untracked)) {
        throw new GitError(
          `error: the following file has local modifications:\n    ${entry.path}\n(use --cached to keep the file, or -f to force removal)`,
        )
      }
      const submodules = { ...current.submodules }
      delete submodules[entry.path]
      current = { ...current, submodules }
      lines.push(`Cleared directory '${entry.path}'`)
    }
    const url = current.config[key]
    if (url !== undefined) {
      const config = { ...current.config }
      delete config[key]
      current = { ...current, config }
      lines.push(`Submodule '${entry.name}' (${url}) unregistered for path '${entry.path}'`)
    }
  }
  return { repo: syncSubmodules(current), output: lines.join('\n') }
}

/** git rm <サブモジュール>: gitlink と .gitmodules の記述と、サブモジュールの中身を消す。 */
export function removeSubmodule(repo: Repo, path: string, cached: boolean): OperationResult {
  const entries = parseGitmodules(repo.workdir[GITMODULES])
  const rest = entries.filter((entry) => entry.path !== path)
  const modules = rest.length === 0 ? undefined : formatGitmodules(rest)
  const submodules = { ...repo.submodules }
  if (!cached) delete submodules[path]
  const config = { ...repo.config }
  for (const entry of entries.filter((other) => other.path === path)) delete config[`submodule.${entry.name}.url`]
  const changed = entries.length !== rest.length
  return {
    repo: syncSubmodules({
      ...repo,
      submodules,
      config,
      index: changed ? withFile(withFile(repo.index, path, undefined), GITMODULES, modules) : withFile(repo.index, path, undefined),
      workdir: changed ? withFile(withFile(repo.workdir, path, undefined), GITMODULES, modules) : withFile(repo.workdir, path, undefined),
    }),
    output: `rm '${path}'`,
  }
}
