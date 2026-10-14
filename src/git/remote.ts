/**
 * リモートとのやりとり。push・fetch・pull、git remote によるリモートの追加・削除・名前の変更と、
 * 他の人がリモートに push したことを再現する補助操作 (teammate)。
 */
import {
  GitError,
  REMOTE_NAME,
  ancestors,
  currentBranch,
  getCommit,
  getRemote,
  isAncestor,
  requireNoOperation,
  splitRemoteRef,
  validateRefName,
  type Commit,
  type CommitId,
  type OperationResult,
  type Remote,
  type Repo,
} from './model'
import { merge, rebase } from './history'

function copyCommits(
  from: Readonly<Record<CommitId, Commit>>,
  to: Readonly<Record<CommitId, Commit>>,
  tip: CommitId,
): Record<CommitId, Commit> {
  const result: Record<CommitId, Commit> = { ...to }
  for (const id of ancestors(from, tip)) {
    const commit = from[id]
    if (commit && !(id in result)) result[id] = commit
  }
  return result
}

function isRemoteAncestor(repo: Repo, ancestor: CommitId, descendant: CommitId): boolean {
  return ancestors(repo.commits, descendant).has(ancestor)
}

function withRemote(repo: Repo, remote: Remote): Repo {
  return { ...repo, remotes: { ...repo.remotes, [remote.name]: remote } }
}

// ---- git remote ----

/** git remote [-v]: リモートの一覧。 */
export function listRemotes(repo: Repo, verbose = false): OperationResult {
  const names = Object.keys(repo.remotes).sort()
  const lines = verbose
    ? names.flatMap((name) => {
        const url = (repo.remotes[name] as Remote).url
        return [`${name}\t${url} (fetch)`, `${name}\t${url} (push)`]
      })
    : names
  return { repo, output: lines.join('\n') }
}

/**
 * git remote add <名前> <URL>: リモートを追加する。
 * 模擬のリモートなので、追加したリモートは空のリポジトリ (GitHub で新しく作った直後のような状態) から始まる。
 */
export function addRemote(repo: Repo, name: string, url: string): OperationResult {
  validateRefName(name)
  if (name in repo.remotes) throw new GitError(`error: リモート ${name} はすでに存在します`)
  return { repo: withRemote(repo, { name, url, commits: {}, branches: {}, tags: {} }), output: '' }
}

/** git remote remove <名前>: リモートと、そのリモート追跡ブランチ・upstream の設定を消す。 */
export function removeRemote(repo: Repo, name: string): OperationResult {
  getRemote(repo, name)
  const remotes = { ...repo.remotes }
  delete remotes[name]
  const prefix = `${name}/`
  const remoteBranches = Object.fromEntries(
    Object.entries(repo.remoteBranches).filter(([ref]) => !ref.startsWith(prefix)),
  )
  const upstreams = Object.fromEntries(
    Object.entries(repo.upstreams).filter(([, upstream]) => !upstream.startsWith(prefix)),
  )
  return { repo: { ...repo, remotes, remoteBranches, upstreams }, output: '' }
}

/** git remote rename <古い名前> <新しい名前>: リモート追跡ブランチと upstream の名前も付け替える。 */
export function renameRemote(repo: Repo, from: string, to: string): OperationResult {
  const remote = getRemote(repo, from)
  validateRefName(to)
  if (to in repo.remotes) throw new GitError(`error: リモート ${to} はすでに存在します`)
  const rename = (ref: string) => (ref.startsWith(`${from}/`) ? `${to}/${ref.slice(from.length + 1)}` : ref)
  const remotes = { ...repo.remotes, [to]: { ...remote, name: to } }
  delete remotes[from]
  return {
    repo: {
      ...repo,
      remotes,
      remoteBranches: Object.fromEntries(Object.entries(repo.remoteBranches).map(([ref, id]) => [rename(ref), id])),
      upstreams: Object.fromEntries(Object.entries(repo.upstreams).map(([branch, ref]) => [branch, rename(ref)])),
    },
    output: '',
  }
}

/** git remote set-url <名前> <URL> */
export function setRemoteUrl(repo: Repo, name: string, url: string): OperationResult {
  return { repo: withRemote(repo, { ...getRemote(repo, name), url }), output: '' }
}

// ---- push ----

export interface PushOptions {
  /** push する先のリモート。指定しなければ upstream のリモート (なければ origin)。 */
  readonly remote?: string
  /** 指定しなければ現在のブランチ。 */
  readonly branch?: string
  readonly force?: boolean
  /** -u: upstream (追跡ブランチ) を設定する。 */
  readonly setUpstream?: boolean
}

/** タグをリモートに push する。リモートに同じ名前で別のコミットを指すタグがあれば、-f がない限り拒否する。 */
export function pushTags(
  repo: Repo,
  names: readonly string[],
  options: { readonly remote?: string; readonly force?: boolean } = {},
): OperationResult {
  let remote = getRemote(repo, options.remote ?? REMOTE_NAME)
  const lines: string[] = []
  const rejected: string[] = []
  for (const name of names) {
    const tag = repo.tags[name]
    if (!tag) throw new GitError(`error: src refspec ${name} がどれにも一致しません`)
    const existing = remote.tags[name]
    const ref = `${name} -> ${name}`
    if (existing?.target === tag.target && existing.message === tag.message) continue
    if (existing && !options.force) {
      rejected.push(` ! [rejected]        ${ref} (already exists)`)
      continue
    }
    remote = {
      ...remote,
      commits: copyCommits(repo.commits, remote.commits, tag.target),
      tags: { ...remote.tags, [name]: tag },
    }
    lines.push(existing ? ` + ${existing.target}...${tag.target} ${ref} (forced update)` : ` * [new tag]         ${ref}`)
  }
  if (rejected.length > 0) {
    throw new GitError(
      [
        `To ${remote.url}`,
        ...rejected,
        `error: 一部の参照を '${remote.url}' に push できませんでした`,
        'ヒント: リモートにすでに同じ名前のタグがあります。上書きするには -f を付けてください。',
      ].join('\n'),
    )
  }
  if (lines.length === 0) return { repo, output: 'Everything up-to-date' }
  return { repo: withRemote(repo, remote), output: [`To ${remote.url}`, ...lines].join('\n') }
}

/** git push <リモート> --delete <名前>: リモートのブランチまたはタグを消す。 */
export function pushDelete(repo: Repo, name: string, remoteName = REMOTE_NAME): OperationResult {
  const remote = getRemote(repo, remoteName)
  if (name in remote.branches) {
    const branches = { ...remote.branches }
    delete branches[name]
    const remoteBranches = { ...repo.remoteBranches }
    delete remoteBranches[`${remoteName}/${name}`]
    return {
      repo: { ...withRemote(repo, { ...remote, branches }), remoteBranches },
      output: `To ${remote.url}\n - [deleted]         ${name}`,
    }
  }
  if (name in remote.tags) {
    const tags = { ...remote.tags }
    delete tags[name]
    return {
      repo: withRemote(repo, { ...remote, tags }),
      output: `To ${remote.url}\n - [deleted]         ${name}`,
    }
  }
  throw new GitError(`error: '${name}' を削除できません: リモートにその参照はありません`)
}

export function push(repo: Repo, options: PushOptions = {}): OperationResult {
  if (options.branch !== undefined && !(options.branch in repo.branches) && options.branch in repo.tags) {
    return pushTags(repo, [options.branch], {
      force: options.force ?? false,
      ...(options.remote === undefined ? {} : { remote: options.remote }),
    })
  }
  const current = currentBranch(repo)
  const branch = options.branch ?? current
  if (branch === null) {
    throw new GitError(
      'fatal: 現在どのブランチにもいません (detached HEAD)。\n' +
        'push するブランチを git push <リモート> <ブランチ名> で指定してください',
    )
  }
  const localId = repo.branches[branch]
  if (localId === undefined) {
    throw new GitError(`error: src refspec ${branch} がどれにも一致しません`)
  }
  const upstream = repo.upstreams[branch]
  const tracked = upstream === undefined ? null : splitRemoteRef(repo, upstream)
  const explicit = options.branch !== undefined
  if (!explicit && !options.setUpstream && tracked === null) {
    throw new GitError(
      `fatal: 現在のブランチ ${branch} には upstream ブランチが設定されていません。\n` +
        `現在のブランチを push して、リモートを upstream として設定するには\n\n` +
        `    git push -u ${options.remote ?? REMOTE_NAME} ${branch}\n\nを実行してください。`,
    )
  }
  // ブランチを書いたとき・-u のときは同じ名前に、そうでなければ upstream に push する
  const remoteName = options.remote ?? tracked?.remote ?? REMOTE_NAME
  const remote = getRemote(repo, remoteName)
  const target = explicit || options.setUpstream || tracked?.remote !== remoteName ? branch : (tracked?.branch ?? branch)
  const remoteId = remote.branches[target]
  const ref = `${branch} -> ${target}`
  const trackingRef = `${remoteName}/${target}`

  if (remoteId === localId) {
    const upstreams = options.setUpstream ? { ...repo.upstreams, [branch]: trackingRef } : repo.upstreams
    return { repo: { ...repo, upstreams }, output: 'Everything up-to-date' }
  }
  const fastForward = remoteId === undefined || isRemoteAncestor(repo, remoteId, localId)
  if (!fastForward && !options.force) {
    throw new GitError(
      [
        `To ${remote.url}`,
        ` ! [rejected]        ${ref} (non-fast-forward)`,
        `error: 一部の参照を '${remote.url}' に push できませんでした`,
        'ヒント: リモートに、手元にないコミットがあるため更新が拒否されました。',
        'ヒント: 先に git pull でリモートの変更を取り込んでから、もう一度 push してください。',
      ].join('\n'),
    )
  }

  const next: Repo = {
    ...withRemote(repo, {
      ...remote,
      commits: copyCommits(repo.commits, remote.commits, localId),
      branches: { ...remote.branches, [target]: localId },
    }),
    remoteBranches: { ...repo.remoteBranches, [trackingRef]: localId },
    upstreams: options.setUpstream ? { ...repo.upstreams, [branch]: trackingRef } : repo.upstreams,
  }
  const line =
    remoteId === undefined ? ` * [new branch]      ${ref}`
    : fastForward ? `   ${remoteId}..${localId}  ${ref}`
    : ` + ${remoteId}...${localId} ${ref} (forced update)`
  const lines = [`To ${remote.url}`, line]
  if (options.setUpstream) {
    lines.push(`ブランチ '${branch}' は '${trackingRef}' を追跡するように設定されました。`)
  }
  return { repo: next, output: lines.join('\n') }
}

// ---- fetch / pull ----

/** 1 つのリモートのコミット・ブランチ・タグを取り込み、<リモート>/* を更新する。 */
function fetchOne(repo: Repo, remoteName: string): { repo: Repo; lines: string[] } {
  const remote = getRemote(repo, remoteName)
  let commits: Record<CommitId, Commit> = { ...repo.commits }
  const lines: string[] = []
  const prefix = `${remoteName}/`
  for (const [name, id] of Object.entries(remote.branches).sort()) {
    commits = copyCommits(remote.commits, commits, id)
    const before = repo.remoteBranches[`${prefix}${name}`]
    if (before === id) continue
    const ref = `${name} -> ${prefix}${name}`
    if (before === undefined) lines.push(` * [new branch]      ${ref}`)
    else if (ancestors(commits, id).has(before)) lines.push(`   ${before}..${id}  ${ref}`)
    else lines.push(` + ${before}...${id} ${ref} (forced update)`)
  }
  // リモートのタグも取り込む。手元に同じ名前で別のタグがあれば上書きしない (Git と同じ)
  let tags = { ...repo.tags }
  for (const [name, tag] of Object.entries(remote.tags).sort()) {
    const local = tags[name]
    if (local?.target === tag.target) continue
    if (local) {
      lines.push(` ! [rejected]        ${name} -> ${name} (would clobber existing tag)`)
      continue
    }
    commits = copyCommits(remote.commits, commits, tag.target)
    tags = { ...tags, [name]: tag }
    lines.push(` * [new tag]         ${name} -> ${name}`)
  }
  // このリモートの追跡ブランチだけを入れ替える (ほかのリモートのものは残す)
  const remoteBranches: Record<string, CommitId> = Object.fromEntries(
    Object.entries(repo.remoteBranches).filter(([ref]) => !ref.startsWith(prefix)),
  )
  for (const [name, id] of Object.entries(remote.branches)) remoteBranches[`${prefix}${name}`] = id
  return {
    repo: { ...repo, commits, tags, remoteBranches },
    lines: lines.length === 0 ? [] : [`From ${remote.url}`, ...lines],
  }
}

/** git fetch [<リモート>] / git fetch --all */
export function fetch(repo: Repo, options: { readonly remote?: string; readonly all?: boolean } = {}): OperationResult {
  const names = options.all ? Object.keys(repo.remotes).sort() : [options.remote ?? defaultRemote(repo)]
  let current = repo
  const lines: string[] = []
  for (const name of names) {
    if (options.all) lines.push(`Fetching ${name}`)
    const fetched = fetchOne(current, name)
    current = fetched.repo
    lines.push(...fetched.lines)
  }
  return { repo: current, output: lines.join('\n') }
}

/** 引数なしの fetch / pull の対象: 現在のブランチの upstream のリモート (なければ origin)。 */
function defaultRemote(repo: Repo): string {
  const branch = currentBranch(repo)
  const upstream = branch === null ? undefined : repo.upstreams[branch]
  return (upstream === undefined ? null : splitRemoteRef(repo, upstream))?.remote ?? REMOTE_NAME
}

export interface PullOptions {
  /** git pull <リモート> <ブランチ> の形で取り込む先を書いた場合。 */
  readonly remote?: string
  readonly branch?: string
  /** true なら rebase、false なら merge。未指定で分岐している場合は Git と同じく中止する。 */
  readonly rebase?: boolean
  readonly fastForwardOnly?: boolean
  /** --no-edit: マージコミットのメッセージをエディタで編集しない。 */
  readonly noEdit?: boolean
}

/** git pull [<リモート> [<ブランチ>]]: fetch してから、upstream (または指定したブランチ) を merge / rebase する。 */
export function pull(repo: Repo, options: PullOptions = {}): OperationResult {
  requireNoOperation(repo)
  const branch = currentBranch(repo)
  if (branch === null) {
    throw new GitError('fatal: 現在どのブランチにもいません (detached HEAD)')
  }
  const upstream = repo.upstreams[branch]
  const tracked = upstream === undefined ? null : splitRemoteRef(repo, upstream)
  const remoteName = options.remote ?? tracked?.remote ?? REMOTE_NAME
  const remoteBranch = options.branch ?? (tracked?.remote === remoteName ? tracked.branch : undefined)
  if (remoteBranch === undefined) {
    throw new GitError(
      'このブランチには追跡情報 (upstream) がありません。\n' +
        `git pull ${remoteName} <ブランチ> で取り込む先を指定するか、` +
        `git branch -u ${remoteName}/<ブランチ> で設定してください`,
    )
  }
  const fetched = fetch(repo, { remote: remoteName })
  const ref = `${remoteName}/${remoteBranch}`
  const remoteId = fetched.repo.remoteBranches[ref]
  if (remoteId === undefined) {
    throw new GitError(`fatal: リモート ${remoteName} に ${remoteBranch} というブランチはありません`)
  }
  const localId = fetched.repo.branches[branch] as CommitId
  const lines = fetched.output === '' ? [] : [fetched.output]

  const diverged =
    !isAncestor(fetched.repo, remoteId, localId) && !isAncestor(fetched.repo, localId, remoteId)
  if (diverged && options.fastForwardOnly) {
    throw new GitError(
      [...lines, 'fatal: fast-forward できないため、中止しました'].join('\n'),
    )
  }
  if (diverged && options.rebase === undefined) {
    throw new GitError(
      [
        ...lines,
        'ヒント: 手元のブランチとリモートのブランチが分岐しています。',
        'ヒント: どうやって統合するかを指定してください:',
        'ヒント:   git pull --no-rebase   (マージする)',
        'ヒント:   git pull --rebase      (リベースする)',
        'ヒント:   git pull --ff-only     (fast-forward のみ)',
        'fatal: 分岐したブランチを統合する方法を指定する必要があります。',
      ].join('\n'),
    )
  }
  const integrated = options.rebase
    ? rebase(fetched.repo, ref)
    : merge(fetched.repo, ref, {
        defaultMessage: `Merge branch '${remoteBranch}' of ${remoteName === REMOTE_NAME ? REMOTE_NAME : getRemote(repo, remoteName).url}`,
        noEdit: options.noEdit ?? false,
        fastForwardOnly: options.fastForwardOnly ?? false,
        reflogAction: 'pull',
      })
  lines.push(integrated.output)
  return { repo: integrated.repo, output: lines.join('\n') }
}

/**
 * 他の人がリモートの branch にコミットを push したことにする (このアプリ独自の補助コマンド)。
 * team.txt に 1 行追記するコミットを、手元には取り込まずにリモートにだけ作る。
 */
export function teammateCommit(repo: Repo, branch = 'main', remoteName = REMOTE_NAME): OperationResult {
  const remote = getRemote(repo, remoteName)
  const tipId = remote.branches[branch]
  if (tipId === undefined) {
    throw new GitError(`${remoteName} に ${branch} というブランチはありません`)
  }
  const tip = remote.commits[tipId] ?? getCommit(repo, tipId)
  const id = `C${repo.nextId}`
  const tree = { ...tip.tree, 'team.txt': `${tip.tree['team.txt'] ?? ''}他の人の変更 (${id})\n` }
  const created: Commit = { id, parents: [tipId], message: `他の人の変更 (${id})`, tree }
  return {
    repo: {
      ...withRemote(repo, {
        ...remote,
        commits: { ...remote.commits, [id]: created },
        branches: { ...remote.branches, [branch]: id },
      }),
      nextId: repo.nextId + 1,
    },
    output: `他の人が ${remoteName}/${branch} に ${id} を push しました (git fetch や git pull で取り込めます)`,
  }
}
