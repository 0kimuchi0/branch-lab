/**
 * リモート (origin) とのやりとり。push・fetch・pull と、
 * 他の人が origin に push したことを再現する補助操作 (teammate)。
 */
import {
  GitError,
  REMOTE_NAME,
  ancestors,
  currentBranch,
  getCommit,
  isAncestor,
  requireNoOperation,
  type Commit,
  type CommitId,
  type OperationResult,
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

export interface PushOptions {
  /** 指定しなければ現在のブランチ。 */
  readonly branch?: string
  readonly force?: boolean
  /** -u: upstream (追跡ブランチ) を設定する。 */
  readonly setUpstream?: boolean
  /** リモート名を書いたかどうか (git push origin <branch> の形)。 */
  readonly explicit?: boolean
}

/** タグを origin に push する。リモートに同じ名前で別のコミットを指すタグがあれば、-f がない限り拒否する。 */
export function pushTags(
  repo: Repo,
  names: readonly string[],
  options: { readonly force?: boolean } = {},
): OperationResult {
  let remote = repo.remote
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
        `To ${REMOTE_NAME}`,
        ...rejected,
        `error: 一部の参照を '${REMOTE_NAME}' に push できませんでした`,
        'ヒント: リモートにすでに同じ名前のタグがあります。上書きするには -f を付けてください。',
      ].join('\n'),
    )
  }
  if (lines.length === 0) return { repo, output: 'Everything up-to-date' }
  return { repo: { ...repo, remote }, output: [`To ${REMOTE_NAME}`, ...lines].join('\n') }
}

/** git push origin --delete <名前>: リモートのブランチまたはタグを消す。 */
export function pushDelete(repo: Repo, name: string): OperationResult {
  if (name in repo.remote.branches) {
    const branches = { ...repo.remote.branches }
    delete branches[name]
    const remoteBranches = { ...repo.remoteBranches }
    delete remoteBranches[name]
    return {
      repo: { ...repo, remote: { ...repo.remote, branches }, remoteBranches },
      output: `To ${REMOTE_NAME}\n - [deleted]         ${name}`,
    }
  }
  if (name in repo.remote.tags) {
    const tags = { ...repo.remote.tags }
    delete tags[name]
    return {
      repo: { ...repo, remote: { ...repo.remote, tags } },
      output: `To ${REMOTE_NAME}\n - [deleted]         ${name}`,
    }
  }
  throw new GitError(`error: '${name}' を削除できません: リモートにその参照はありません`)
}

export function push(repo: Repo, options: PushOptions = {}): OperationResult {
  if (options.branch !== undefined && !(options.branch in repo.branches) && options.branch in repo.tags) {
    return pushTags(repo, [options.branch], { force: options.force ?? false })
  }
  const current = currentBranch(repo)
  const branch = options.branch ?? current
  if (branch === null) {
    throw new GitError(
      'fatal: 現在どのブランチにもいません (detached HEAD)。\n' +
        'push するブランチを git push origin <ブランチ名> で指定してください',
    )
  }
  const localId = repo.branches[branch]
  if (localId === undefined) {
    throw new GitError(`error: src refspec ${branch} がどれにも一致しません`)
  }
  const upstream = repo.upstreams[branch]
  if (!options.explicit && !options.setUpstream && upstream === undefined) {
    throw new GitError(
      `fatal: 現在のブランチ ${branch} には upstream ブランチが設定されていません。\n` +
        `現在のブランチを push して、リモートを upstream として設定するには\n\n` +
        `    git push -u ${REMOTE_NAME} ${branch}\n\nを実行してください。`,
    )
  }
  const remoteName = options.explicit || options.setUpstream ? branch : (upstream ?? branch)
  const remoteId = repo.remote.branches[remoteName]
  const ref = `${branch} -> ${remoteName}`

  if (remoteId === localId) {
    return { repo, output: 'Everything up-to-date' }
  }
  const fastForward = remoteId === undefined || isRemoteAncestor(repo, remoteId, localId)
  if (!fastForward && !options.force) {
    throw new GitError(
      [
        `To ${REMOTE_NAME}`,
        ` ! [rejected]        ${ref} (non-fast-forward)`,
        `error: 一部の参照を '${REMOTE_NAME}' に push できませんでした`,
        'ヒント: リモートに、手元にないコミットがあるため更新が拒否されました。',
        'ヒント: 先に git pull でリモートの変更を取り込んでから、もう一度 push してください。',
      ].join('\n'),
    )
  }

  const next: Repo = {
    ...repo,
    remote: {
      ...repo.remote,
      commits: copyCommits(repo.commits, repo.remote.commits, localId),
      branches: { ...repo.remote.branches, [remoteName]: localId },
    },
    remoteBranches: { ...repo.remoteBranches, [remoteName]: localId },
    upstreams: options.setUpstream ? { ...repo.upstreams, [branch]: remoteName } : repo.upstreams,
  }
  const line =
    remoteId === undefined ? ` * [new branch]      ${ref}`
    : fastForward ? `   ${remoteId}..${localId}  ${ref}`
    : ` + ${remoteId}...${localId} ${ref} (forced update)`
  const lines = [`To ${REMOTE_NAME}`, line]
  if (options.setUpstream) {
    lines.push(`ブランチ '${branch}' は '${REMOTE_NAME}/${remoteName}' を追跡するように設定されました。`)
  }
  return { repo: next, output: lines.join('\n') }
}

/** git fetch: origin のコミットとブランチの位置を取り込み、origin/* を更新する。 */
export function fetch(repo: Repo): OperationResult {
  let commits: Record<CommitId, Commit> = { ...repo.commits }
  const lines: string[] = []
  for (const [name, id] of Object.entries(repo.remote.branches).sort()) {
    commits = copyCommits(repo.remote.commits, commits, id)
    const before = repo.remoteBranches[name]
    if (before === id) continue
    const ref = `${name} -> ${REMOTE_NAME}/${name}`
    if (before === undefined) lines.push(` * [new branch]      ${ref}`)
    else if (ancestors(commits, id).has(before)) lines.push(`   ${before}..${id}  ${ref}`)
    else lines.push(` + ${before}...${id} ${ref} (forced update)`)
  }
  // リモートのタグも取り込む。手元に同じ名前で別のタグがあれば上書きしない (Git と同じ)
  let tags = { ...repo.tags }
  for (const [name, tag] of Object.entries(repo.remote.tags).sort()) {
    const local = tags[name]
    if (local?.target === tag.target) continue
    if (local) {
      lines.push(` ! [rejected]        ${name} -> ${name} (would clobber existing tag)`)
      continue
    }
    commits = copyCommits(repo.remote.commits, commits, tag.target)
    tags = { ...tags, [name]: tag }
    lines.push(` * [new tag]         ${name} -> ${name}`)
  }
  const next: Repo = { ...repo, commits, tags, remoteBranches: { ...repo.remote.branches } }
  return {
    repo: next,
    output: lines.length === 0 ? '' : [`From ${REMOTE_NAME}`, ...lines].join('\n'),
  }
}

export interface PullOptions {
  /** true なら rebase、false なら merge。未指定で分岐している場合は Git と同じく中止する。 */
  readonly rebase?: boolean
  readonly fastForwardOnly?: boolean
  /** --no-edit: マージコミットのメッセージをエディタで編集しない。 */
  readonly noEdit?: boolean
}

/** git pull: fetch してから、upstream を merge (または rebase) する。 */
export function pull(repo: Repo, options: PullOptions = {}): OperationResult {
  requireNoOperation(repo)
  const branch = currentBranch(repo)
  if (branch === null) {
    throw new GitError('fatal: 現在どのブランチにもいません (detached HEAD)')
  }
  const upstream = repo.upstreams[branch]
  if (upstream === undefined) {
    throw new GitError(
      'このブランチには追跡情報 (upstream) がありません。\n' +
        `git push -u ${REMOTE_NAME} ${branch} で設定するか、git branch -u ${REMOTE_NAME}/<ブランチ> で設定してください`,
    )
  }
  const fetched = fetch(repo)
  const remoteId = fetched.repo.remoteBranches[upstream]
  if (remoteId === undefined) {
    throw new GitError(`fatal: リモートに ${upstream} というブランチはありません`)
  }
  const localId = fetched.repo.branches[branch] as CommitId
  const ref = `${REMOTE_NAME}/${upstream}`
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
        defaultMessage: `Merge branch '${upstream}' of ${REMOTE_NAME}`,
        noEdit: options.noEdit ?? false,
        fastForwardOnly: options.fastForwardOnly ?? false,
      })
  lines.push(integrated.output)
  return { repo: integrated.repo, output: lines.join('\n') }
}

/**
 * 他の人が origin の branch にコミットを push したことにする (このアプリ独自の補助コマンド)。
 * team.txt に 1 行追記するコミットを、手元には取り込まずにリモートにだけ作る。
 */
export function teammateCommit(repo: Repo, branch = 'main'): OperationResult {
  const tipId = repo.remote.branches[branch]
  if (tipId === undefined) {
    throw new GitError(`origin に ${branch} というブランチはありません`)
  }
  const tip = repo.remote.commits[tipId] ?? getCommit(repo, tipId)
  const id = `C${repo.nextId}`
  const tree = { ...tip.tree, 'team.txt': `${tip.tree['team.txt'] ?? ''}他の人の変更 (${id})\n` }
  const created: Commit = { id, parents: [tipId], message: `他の人の変更 (${id})`, tree }
  return {
    repo: {
      ...repo,
      remote: {
        ...repo.remote,
        commits: { ...repo.remote.commits, [id]: created },
        branches: { ...repo.remote.branches, [branch]: id },
      },
      nextId: repo.nextId + 1,
    },
    output: `他の人が origin/${branch} に ${id} を push しました (git fetch や git pull で取り込めます)`,
  }
}
