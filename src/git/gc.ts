/**
 * git gc / prune / fsck と、git reflog expire / delete、git notes prune。
 * このアプリのコミットには作った時刻がないので、すべてのコミットと reflog は「今作ったもの」として扱う。
 * そのため、期限に now (または all) を指定したときだけ、期限で消える (既定の 2 週間・90 日などでは消えない)。
 */
import {
  GitError,
  ancestors,
  currentWorktreeState,
  reachableCommits,
  type CommitId,
  type OperationResult,
  type ReflogEntry,
  type Repo,
} from './model'

/** C2 < C10 のように、頭文字と番号の順に並べる。 */
export function compareIds(a: CommitId, b: CommitId): number {
  return a.localeCompare(b, 'en', { numeric: true })
}

/** 期限の指定が「今」(now・all) か。never などや、過去の日時 (2.weeks.ago など) なら false。 */
function expiresNow(value: string | undefined): boolean {
  return value === 'now' || value === 'all'
}

/** reflog のエントリが指すコミット (今いない worktree の HEAD の reflog も含む)。 */
function reflogCommits(repo: Repo): CommitId[] {
  const entries: ReflogEntry[] = [
    ...Object.values(repo.reflogs).flat(),
    ...Object.values(repo.worktrees).flatMap((state) => state.headReflog),
  ]
  return entries.map((entry) => entry.id)
}

/**
 * gc・prune・fsck が残すコミット。参照 (ブランチ・タグ・リモート追跡ブランチ・refs/original・refs/replace)・
 * 各 worktree の HEAD・stash・途中の操作で使うコミットと、reflogs が true なら reflog の指すコミットからたどれるもの。
 * git notes のメモは、メモを付けたコミットを残す理由にならない (本物と同じ)。
 */
export function liveCommits(repo: Repo, options: { readonly reflogs?: boolean } = {}): Set<CommitId> {
  const live = reachableCommits(repo)
  const tips: CommitId[] = repo.stash.map((entry) => entry.base)
  for (const state of [currentWorktreeState(repo), ...Object.values(repo.worktrees)]) {
    const op = state.operation
    if (op === null || op.type === 'merge' || op.type === 'am') continue
    for (const item of [op.current, ...op.todo]) {
      if (item !== null && 'id' in item && item.id !== null) tips.push(item.id)
    }
  }
  if (options.reflogs ?? true) tips.push(...reflogCommits(repo))
  for (const tip of tips) {
    if (!(tip in repo.commits)) continue
    for (const id of ancestors(repo.commits, tip)) live.add(id)
  }
  return live
}

/** どこからもたどれないコミット (番号の順)。 */
export function unreachableCommits(repo: Repo, options: { readonly reflogs?: boolean } = {}): CommitId[] {
  const live = liveCommits(repo, options)
  return Object.keys(repo.commits).filter((id) => !live.has(id)).sort(compareIds)
}

/** コミットを消す。消したコミットを指す FETCH_HEAD も消す。 */
function removeCommits(repo: Repo, ids: readonly CommitId[]): Repo {
  if (ids.length === 0) return repo
  const commits = { ...repo.commits }
  for (const id of ids) delete commits[id]
  const fetchHead = repo.fetchHead !== null && !(repo.fetchHead.id in commits) ? null : repo.fetchHead
  return { ...repo, commits, fetchHead }
}

export interface PruneOptions {
  /** -n: 消すものを表示するだけ。 */
  readonly dryRun?: boolean
  /** -v: 消したものを表示する。 */
  readonly verbose?: boolean
  /** --expire <時刻>: これより古いものだけ消す (省略するとすべて)。 */
  readonly expire?: string
}

/** git prune: 参照・reflog などからたどれないコミットを消す。 */
export function prune(repo: Repo, options: PruneOptions = {}): OperationResult {
  if (options.expire !== undefined && !expiresNow(options.expire)) return { repo, output: '' }
  const targets = unreachableCommits(repo)
  const output = options.dryRun || options.verbose ? targets.map((id) => `${id} commit`).join('\n') : ''
  return { repo: options.dryRun ? repo : removeCommits(repo, targets), output }
}

export interface ReflogExpireOptions {
  /** --expire=<時刻>: これより古いエントリを消す。 */
  readonly expire?: string
  /** --expire-unreachable=<時刻>: 参照の今の先端からたどれないエントリのうち、これより古いものを消す。 */
  readonly expireUnreachable?: string
  readonly all?: boolean
  readonly dryRun?: boolean
}

/** reflog の名前 (HEAD・main・refs/heads/main) を Repo.reflogs のキーにする。 */
function reflogKey(name: string): string {
  if (name === '@') return 'HEAD'
  return name.startsWith('refs/heads/') ? name.slice('refs/heads/'.length) : name
}

/** git reflog expire [--expire=<時刻>] [--expire-unreachable=<時刻>] [--all | <参照>...] */
export function reflogExpire(repo: Repo, refs: readonly string[], options: ReflogExpireOptions = {}): OperationResult {
  const expire = options.expire ?? repo.config['gc.reflogexpire']
  const expireUnreachable = options.expireUnreachable ?? repo.config['gc.reflogexpireunreachable']
  const removeAll = expiresNow(expire)
  const removeUnreachable = removeAll || expiresNow(expireUnreachable)
  if (!removeUnreachable || options.dryRun) return { repo, output: '' }
  const keys = options.all ? Object.keys(repo.reflogs) : refs.map(reflogKey)
  for (const [index, key] of keys.entries()) {
    if (!(key in repo.reflogs)) throw new GitError(`error: ${refs[index] ?? key} points nowhere!`)
  }
  // HEAD の reflog は、どれかの参照からたどれるかで、ブランチの reflog はそのブランチからたどれるかで決める
  const fromAllRefs = reachableCommits(repo)
  const keep = (key: string, entry: ReflogEntry, branchTip: CommitId | undefined): boolean => {
    if (removeAll) return false
    if (key === 'HEAD') return fromAllRefs.has(entry.id)
    return branchTip !== undefined && ancestors(repo.commits, branchTip).has(entry.id)
  }
  const reflogs = { ...repo.reflogs }
  for (const key of keys) {
    reflogs[key] = (repo.reflogs[key] ?? []).filter((entry) => keep(key, entry, repo.branches[key]))
  }
  // --all なら、ほかの worktree の HEAD の reflog も同じように消す
  const worktrees = options.all
    ? Object.fromEntries(
        Object.entries(repo.worktrees).map(([path, state]) => [
          path,
          { ...state, headReflog: state.headReflog.filter((entry) => keep('HEAD', entry, undefined)) },
        ]),
      )
    : repo.worktrees
  return { repo: { ...repo, reflogs, worktrees }, output: '' }
}

/** git reflog delete <参照>@{<n>}...: reflog のエントリを消す。 */
export function reflogDelete(repo: Repo, specs: readonly string[]): OperationResult {
  if (specs.length === 0) throw new GitError('fatal: no reflog specified to delete')
  let reflogs = repo.reflogs
  // 後ろのエントリから消して、前のエントリの番号がずれないようにする
  const parsed = specs.map((spec) => {
    const match = /^(.*)@\{(\d+)\}$/.exec(spec)
    if (!match) throw new GitError(`error: not a reflog: ${spec}`)
    return { spec, key: reflogKey(match[1] === '' ? 'HEAD' : (match[1] as string)), index: Number(match[2]) }
  })
  for (const { spec, key, index } of [...parsed].sort((a, b) => b.index - a.index)) {
    const entries = reflogs[key]
    if (entries === undefined) throw new GitError(`error: no reflog for '${spec}'`)
    // 番号のエントリがなければ何もしない (本物と同じ)
    reflogs = { ...reflogs, [key]: entries.filter((_, i) => i !== index) }
  }
  return { repo: { ...repo, reflogs }, output: '' }
}

export interface GcOptions {
  /** --prune=<時刻> (既定は gc.pruneExpire の設定か 2.weeks.ago)。--no-prune なら never。 */
  readonly prune?: string
  readonly aggressive?: boolean
  readonly auto?: boolean
  readonly quiet?: boolean
}

/**
 * git gc: reflog の期限切れのエントリを消し (gc.reflogExpire / gc.reflogExpireUnreachable)、
 * 期限 (--prune / gc.pruneExpire) を過ぎた、どこからもたどれないコミットを消す。
 */
export function gc(repo: Repo, options: GcOptions = {}): OperationResult {
  // --auto は、オブジェクトが少ないうちは何もしない (本物も同じ)
  if (options.auto) return { repo, output: '' }
  let current = repo
  current = reflogExpire(current, [], { all: true }).repo
  const expire = options.prune ?? repo.config['gc.pruneexpire'] ?? '2.weeks.ago'
  const unreachable = unreachableCommits(current)
  const pruned = expiresNow(expire) ? unreachable : []
  current = removeCommits(current, pruned)
  if (options.quiet) return { repo: current, output: '' }
  const lines: string[] = []
  if (pruned.length > 0) lines.push(`(どこからもたどれないコミットを削除しました: ${pruned.join(', ')})`)
  else if (unreachable.length > 0) {
    lines.push(
      `(どこからもたどれないコミット ${unreachable.join(', ')} は、作ってから 2 週間たっていないため残しました。` +
        'git gc --prune=now で今すぐ削除します)',
    )
  }
  const kept = unreachableCommits(current, { reflogs: false }).filter((id) => !unreachable.includes(id))
  if (kept.length > 0) {
    lines.push(
      `(reflog から参照されているコミット ${kept.join(', ')} は残しました。` +
        'git reflog expire --expire=now --all で reflog を消すと削除できます)',
    )
  }
  return { repo: current, output: lines.join('\n') }
}

export interface FsckOptions {
  /** --unreachable: たどれないコミットをすべて表示する。 */
  readonly unreachable?: boolean
  /** --no-reflogs: reflog だけから参照されているコミットも、たどれないものとして扱う。 */
  readonly noReflogs?: boolean
  /** --no-dangling: dangling の行を出さない。 */
  readonly noDangling?: boolean
  /** --root: ルートコミットを表示する。 */
  readonly root?: boolean
  /** --lost-found: dangling のコミットを .git/lost-found/commit/ に書く。 */
  readonly lostFound?: boolean
}

/**
 * git fsck: 壊れた親のリンクと、たどれないコミットを調べる。
 * dangling はたどれないコミットのうち、ほかのたどれないコミットの親になっていないもの (たどれない履歴の先端)。
 */
export function fsck(repo: Repo, options: FsckOptions = {}): OperationResult {
  const lines: string[] = []
  const ids = Object.keys(repo.commits).sort(compareIds)
  for (const id of ids) {
    for (const parent of repo.commits[id]?.parents ?? []) {
      if (parent in repo.commits) continue
      lines.push(`broken link from    commit ${id}`, `              to    commit ${parent}`, `missing commit ${parent}`)
    }
  }
  const unreachable = unreachableCommits(repo, { reflogs: !options.noReflogs })
  const parentsOfUnreachable = new Set(unreachable.flatMap((id) => repo.commits[id]?.parents ?? []))
  const dangling = unreachable.filter((id) => !parentsOfUnreachable.has(id))
  if (options.root) {
    for (const id of ids) if (repo.commits[id]?.parents.length === 0) lines.push(`root ${id}`)
  }
  if (options.unreachable) lines.push(...unreachable.map((id) => `unreachable commit ${id}`))
  else if (!options.noDangling) lines.push(...dangling.map((id) => `dangling commit ${id}`))
  let current = repo
  if (options.lostFound && dangling.length > 0) {
    const gitFiles = { ...repo.gitFiles }
    for (const id of dangling) gitFiles[`lost-found/commit/${id}`] = { content: `${id}\n`, executable: false }
    current = { ...repo, gitFiles }
  }
  return { repo: current, output: lines.join('\n') }
}

/** git notes prune [-n] [-v]: なくなったコミットに付けたメモを消す。 */
export function notesPrune(repo: Repo, options: { readonly dryRun?: boolean; readonly verbose?: boolean } = {}): OperationResult {
  const targets = Object.keys(repo.notes).filter((id) => !(id in repo.commits)).sort(compareIds)
  const output = options.dryRun || options.verbose ? targets.join('\n') : ''
  if (options.dryRun || targets.length === 0) return { repo, output }
  const notes = { ...repo.notes }
  for (const id of targets) delete notes[id]
  return { repo: { ...repo, notes }, output }
}
