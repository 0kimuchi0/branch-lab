/**
 * Git の内部モデル (コミットの DAG・ブランチ・HEAD・ステージ・作業ディレクトリ・リモート)。
 * UI には一切依存せず、すべての操作は新しい Repo を返す純粋関数として実装する。
 */
import {
  changedPaths,
  conflictKey,
  parseGitlink,
  treesEqual,
  withFile,
  type Conflict,
  type Tree,
} from './tree'

export type CommitId = string

export interface Commit {
  readonly id: CommitId
  /** 親コミット。通常のコミットは 1 つ、マージコミットは 2 つ、ルートは 0 個。 */
  readonly parents: readonly CommitId[]
  readonly message: string
  /** このコミット時点のファイルのスナップショット。 */
  readonly tree: Tree
  /** cherry-pick や rebase でコピーしたときの、コピー元をたどった最初のコミット。 */
  readonly source?: CommitId
  /** revert で打ち消したコミット。 */
  readonly reverts?: CommitId
}

export type Head =
  | { readonly type: 'branch'; readonly name: string }
  | { readonly type: 'detached'; readonly id: CommitId }

/** rebase -i の todo の 1 行 (cherry-pick・revert・通常の rebase はすべて pick)。 */
export type TodoAction = 'pick' | 'reword' | 'edit' | 'squash' | 'fixup'

/** コミットを適用する todo の行。 */
export interface PickItem {
  readonly action: TodoAction
  readonly id: CommitId
}

/**
 * rebase --rebase-merges の merge の行。label の位置のコミットを HEAD にマージする (2 つ以上なら octopus)。
 * id は -C / -c で指定した元のマージコミット (メッセージをそこから取る)。edit ならメッセージをエディタで編集する。
 */
export interface MergeItem {
  readonly action: 'merge'
  readonly id: CommitId | null
  readonly labels: readonly string[]
  readonly edit: boolean
}

/**
 * rebase -i の todo の 1 行。exec はコマンドを実行し、break はそこで止まる。
 * label・reset・merge は --rebase-merges で使う (HEAD に名前を付ける・名前の位置に戻る・マージする)。
 */
export type TodoItem =
  | PickItem
  | MergeItem
  | { readonly action: 'exec'; readonly command: string }
  | { readonly action: 'break' }
  | { readonly action: 'label'; readonly name: string }
  | { readonly action: 'reset'; readonly target: string }

/** squash / fixup でまとめているコミットのメッセージ (fixup のものは skip)。 */
export interface SquashPart {
  readonly message: string
  readonly skip: boolean
}

export type SequenceType = 'cherry-pick' | 'revert' | 'rebase'

export interface SequenceOperation {
  readonly type: SequenceType
  /** 適用中 (コンフリクトなどで止まっている) の項目。確定済みなら null。 */
  readonly current: PickItem | MergeItem | null
  /** これから適用する項目。 */
  readonly todo: readonly TodoItem[]
  /** 操作を始める前の HEAD。--abort で戻る先。 */
  readonly origHead: CommitId
  /** 操作を始めたときのブランチ (detached HEAD なら null)。rebase はこのブランチを付け替える。 */
  readonly branch: string | null
  /** もともと空のコミットも複製するか (rebase と cherry-pick --allow-empty)。 */
  readonly keepEmpty: boolean
  /** 各コミットのメッセージをエディタで編集するか (revert の既定、cherry-pick -e)。 */
  readonly edit: boolean
  /** squash / fixup でまとめている途中のメッセージ。 */
  readonly squash: readonly SquashPart[] | null
  /** -m: マージコミットを cherry-pick / revert するときに基準にする親の番号 (1 始まり)。 */
  readonly mainline: number | null
  /** rebase --rebase-merges の label で付けた名前 (refs/rewritten/<名前>)。 */
  readonly labels?: Readonly<Record<string, CommitId>>
  /** -X ours / -X theirs: コンフリクトする箇所をどちらの側で解決するか。 */
  readonly favor?: 'ours' | 'theirs'
}

/** merge の行でマージする相手のコミット (label の名前か、コミットそのもの)。 */
export function mergeTarget(repo: Repo, op: SequenceOperation, ref: string): CommitId {
  return op.labels?.[ref] ?? resolveRef(repo, ref)
}

/** merge の行で作るコミットのメッセージ。 */
export function mergeItemMessage(repo: Repo, item: MergeItem): string {
  if (item.id !== null) return getCommit(repo, item.id).message
  return `Merge ${item.labels.length > 1 ? 'branches' : 'branch'} ${joinNames(item.labels.map((label) => `'${label}'`))}`
}

/** "a", "a and b", "a, b and c" の形に並べる (Git のマージメッセージと同じ)。 */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/** パッチの 1 つのハンク (@@ から始まる部分)。newline が false の行は、末尾に改行がない。 */
export interface Hunk {
  readonly oldStart: number
  readonly oldCount: number
  readonly newStart: number
  readonly newCount: number
  readonly lines: ReadonlyArray<{ readonly type: ' ' | '-' | '+'; readonly text: string; readonly newline: boolean }>
}

/** パッチの 1 つのファイルの変更。 */
export interface FilePatch {
  readonly path: string
  readonly newFile: boolean
  readonly deleted: boolean
  readonly hunks: readonly Hunk[]
}

/** git am で取り込む 1 通のパッチ。 */
export interface AmPatch {
  /** 読んだファイルの名前。 */
  readonly name: string
  /** format-patch の From 行にある、元のコミット。 */
  readonly source?: CommitId
  readonly message: string
  /** パッチの全文 (--show-current-patch で表示する)。 */
  readonly raw: string
  readonly files: readonly FilePatch[]
}

/** git am の途中の状態。 */
export interface AmOperation {
  readonly type: 'am'
  /** 当てられずに止まっているパッチ。 */
  readonly current: AmPatch | null
  /** これから当てるパッチ。 */
  readonly todo: readonly AmPatch[]
  readonly origHead: CommitId
  readonly branch: string | null
  /** 当て終わったパッチの数。 */
  readonly done: number
  /** -3: 当てられなければ 3-way マージにする。 */
  readonly threeWay: boolean
}

/** 途中で止まっている操作 (コンフリクトの解消待ちなど)。 */
export type Operation =
  | {
      readonly type: 'merge'
      readonly theirs: CommitId
      readonly message: string
    }
  | SequenceOperation
  | AmOperation

/** エディタで書いたメッセージを付けて作るコミット。 */
export interface PendingCommit {
  readonly parents: readonly CommitId[]
  readonly tree: Tree
  readonly source?: CommitId
  readonly reverts?: CommitId
  /** reflog に書く操作の名前 (既定は commit)。"<操作>: <件名>" の形で記録する。 */
  readonly reflogAction?: string
  /** reflog に書くメッセージ (件名の代わりにこれをそのまま記録する。マージなど)。 */
  readonly reflogMessage?: string
}

/** reflog の 1 行。HEAD やブランチがどのコミットに移ったかと、そのときの操作。 */
export interface ReflogEntry {
  readonly id: CommitId
  readonly message: string
}

/** エディタを保存して閉じたあとに続ける処理。 */
export type AfterEdit =
  /** コミットを作り、operation をこの値にする。 */
  | { readonly kind: 'commit'; readonly commit: PendingCommit; readonly operation: Operation | null }
  /**
   * コミットを作り、cherry-pick / revert / rebase の続きを実行する。
   * stop なら続きは実行せずに止まる (rebase -i の edit)。
   */
  | {
      readonly kind: 'sequence'
      readonly commit: PendingCommit
      readonly operation: SequenceOperation
      readonly stop?: boolean
    }
  /** 注釈付きタグを作る (git tag -a でメッセージを書いた場合)。 */
  | {
      readonly kind: 'tag'
      readonly name: string
      readonly target: CommitId
      readonly force: boolean
    }
  /** git notes add / edit でメッセージを書いた場合。 */
  | { readonly kind: 'note'; readonly target: CommitId }
  /** rebase -i の todo を読んで rebase を始める。 */
  | {
      readonly kind: 'todo'
      readonly onto: CommitId
      readonly origHead: CommitId
      readonly branch: string | null
      readonly commits: readonly CommitId[]
      readonly favor?: 'ours' | 'theirs'
    }

/** 開いているエディタ。Git がエディタを開いて、閉じられるのを待っている状態。 */
export interface Editor {
  /** 編集しているファイルの名前 (表示用)。 */
  readonly file: 'COMMIT_EDITMSG' | 'MERGE_MSG' | 'TAG_EDITMSG' | 'NOTES_EDITMSG' | 'git-rebase-todo'
  /** エディタを開いたときの内容。 */
  readonly text: string
  readonly after: AfterEdit
}

/** git stash で退避した変更。 */
export interface StashEntry {
  /** 退避したときの HEAD。 */
  readonly base: CommitId
  /** stash list に出す説明 (WIP on main: C3 ... や On main: <メッセージ>)。 */
  readonly message: string
  readonly index: Tree
  /** 追跡しているファイルの、作業ディレクトリの内容。 */
  readonly workdir: Tree
  /** -u で退避した、追跡していないファイル。 */
  readonly untracked: Tree
}

/** タグ。message があれば注釈付きタグ (git tag -a)、なければ軽量タグ。 */
export interface Tag {
  readonly target: CommitId
  readonly message?: string
}

/** git bisect の状態。 */
export interface BisectState {
  /** bisect を始めたときの HEAD (ブランチ名か、detached ならコミット ID)。bisect reset で戻る。 */
  readonly start: string
  readonly bad: CommitId | null
  readonly good: readonly CommitId[]
  readonly skipped: readonly CommitId[]
  /** 見つかった最初の悪いコミット。 */
  readonly found: CommitId | null
  /** git bisect log の内容。 */
  readonly log: readonly string[]
}

export interface Remote {
  readonly name: string
  /** git remote add で指定した URL (模擬なので表示にだけ使う)。 */
  readonly url: string
  readonly commits: Readonly<Record<CommitId, Commit>>
  readonly branches: Readonly<Record<string, CommitId>>
  readonly tags: Readonly<Record<string, Tag>>
}

export interface Repo {
  readonly commits: Readonly<Record<CommitId, Commit>>
  readonly branches: Readonly<Record<string, CommitId>>
  readonly head: Head
  /** ステージ (インデックス)。次にコミットされるスナップショット。 */
  readonly index: Tree
  readonly workdir: Tree
  readonly operation: Operation | null
  readonly conflicts: readonly Conflict[]
  /** 開いているエディタ。開いている間は、保存して閉じる以外の操作はできない。 */
  readonly editor: Editor | null
  /** git stash のスタック。先頭が stash@{0} (最新)。 */
  readonly stash: readonly StashEntry[]
  readonly tags: Readonly<Record<string, Tag>>
  readonly bisect: BisectState | null
  /** HEAD とブランチの reflog。キーは "HEAD" かブランチ名で、先頭が最新 (HEAD@{0})。 */
  readonly reflogs: Readonly<Record<string, readonly ReflogEntry[]>>
  /** リモート (origin など)。キーはリモートの名前。 */
  readonly remotes: Readonly<Record<string, Remote>>
  /** リモート追跡ブランチ。キーは "<リモート>/<ブランチ>" (origin/main など)。 */
  readonly remoteBranches: Readonly<Record<string, CommitId>>
  /** ローカルブランチ → 追跡するリモート追跡ブランチ (upstream、"origin/main" の形)。 */
  readonly upstreams: Readonly<Record<string, string>>
  /** 次に採番するコミット番号。 */
  readonly nextId: number
  /** git config で設定した値。キーは "rerere.enabled" のような小文字の名前。 */
  readonly config: Readonly<Record<string, string>>
  readonly rerere: RerereState
  /** 今いる worktree のパス (メインの worktree は MAIN_WORKTREE)。 */
  readonly worktree: string
  /**
   * ほかの worktree (git worktree add で作ったもの・今いないメインの worktree) の状態。キーはパス。
   * 今いる worktree の状態は Repo の head・index・workdir などにある。
   */
  readonly worktrees: Readonly<Record<string, WorktreeState>>
  /**
   * 今いる worktree でチェックアウトしているサブモジュール (パス → そのリポジトリ)。
   * サブモジュールも 1 つの Repo で、コミット ID の頭文字 (idPrefix) で区別する。
   */
  readonly submodules: Readonly<Record<string, Repo>>
  /** cd でサブモジュールの中にいるなら、そのパス。コマンドはそのサブモジュールで実行する。 */
  readonly submodule: string | null
  /** サブモジュールの取得元 (URL → 模擬のサーバー)。どの worktree から clone しても同じ中身になる。 */
  readonly libraries: Readonly<Record<string, Library>>
  /** コミット ID の頭文字 (既定は C)。 */
  readonly idPrefix?: string
  /**
   * clone やサブモジュールとして入れ子に持つリポジトリなら、その場所 (~/teammate など)。
   * 一番外側のリポジトリ (~/branch-lab) では undefined。
   */
  readonly home?: string
  /** git clone で作ったリポジトリ (場所 → そのリポジトリ)。一番外側のリポジトリだけが持つ。 */
  readonly clones: Readonly<Record<string, Repo>>
  /** cd で clone したリポジトリの中にいるなら、その場所。 */
  readonly clone: string | null
  /**
   * git sparse-checkout (cone モード) で作業ディレクトリに出すディレクトリ。null なら無効 (すべて出す)。
   * 外のファイルも作業ディレクトリ (workdir) にはステージと同じ内容で持ち、ls・cat・画面では見えないようにする。
   */
  readonly sparse: readonly string[] | null
  /** git notes: コミット → そのコミットに付けたメモ。 */
  readonly notes: Readonly<Record<CommitId, string>>
}

/**
 * サブモジュールの取得元になる、模擬のサーバー上のリポジトリ。
 * prefix はそのコミット ID の頭文字、nextId は次に採番する番号 (clone どうしで ID がぶつからないように共有する)。
 */
export interface Library {
  readonly remote: Remote
  readonly prefix: string
  readonly nextId: number
}

/** worktree ごとに持つ状態 (それ以外のブランチ・コミット・stash・設定などは共有する)。 */
export interface WorktreeState {
  readonly head: Head
  readonly index: Tree
  readonly workdir: Tree
  readonly conflicts: readonly Conflict[]
  readonly operation: Operation | null
  readonly editor: Editor | null
  readonly bisect: BisectState | null
  /** この worktree の HEAD の reflog。 */
  readonly headReflog: readonly ReflogEntry[]
  readonly rererePending: RerereState['pending']
  readonly submodules: Readonly<Record<string, Repo>>
  readonly sparse: readonly string[] | null
}

/** メインの worktree (clone したディレクトリ) のパス。 */
export const MAIN_WORKTREE = '~/branch-lab'

/** 今いる worktree の状態を取り出す。 */
export function currentWorktreeState(repo: Repo): WorktreeState {
  return {
    head: repo.head,
    index: repo.index,
    workdir: repo.workdir,
    conflicts: repo.conflicts,
    operation: repo.operation,
    editor: repo.editor,
    bisect: repo.bisect,
    headReflog: repo.reflogs['HEAD'] ?? [],
    rererePending: repo.rerere.pending,
    submodules: repo.submodules,
    sparse: repo.sparse,
  }
}

/** 別の worktree に移る (cd)。今いる worktree の状態はしまっておく。 */
export function enterWorktree(repo: Repo, path: string): Repo {
  if (path === repo.worktree) return repo
  const target = repo.worktrees[path]
  if (target === undefined) throw new GitError(`fatal: '${path}' は worktree ではありません`)
  const worktrees = { ...repo.worktrees, [repo.worktree]: currentWorktreeState(repo) }
  delete worktrees[path]
  return {
    ...repo,
    head: target.head,
    index: target.index,
    workdir: target.workdir,
    conflicts: target.conflicts,
    operation: target.operation,
    editor: target.editor,
    bisect: target.bisect,
    reflogs: { ...repo.reflogs, HEAD: target.headReflog },
    rerere: { ...repo.rerere, pending: target.rererePending },
    worktree: path,
    worktrees,
    submodules: target.submodules,
    submodule: null,
    sparse: target.sparse,
  }
}

/** ほかの worktree で使っている (チェックアウトしている、またはその上で rebase している) ブランチなら、その worktree のパス。 */
export function branchWorktree(repo: Repo, name: string): string | null {
  for (const [path, state] of Object.entries(repo.worktrees)) {
    if (state.head.type === 'branch' && state.head.name === name) return path
    if (state.operation && state.operation.type !== 'merge' && state.operation.branch === name) return path
    if (state.bisect && state.bisect.start === name) return path
  }
  return null
}

/** ほかの worktree で使っているブランチには切り替えられない。 */
export function requireBranchFree(repo: Repo, name: string): void {
  const path = branchWorktree(repo, name)
  if (path !== null) throw new GitError(`fatal: '${name}' is already used by worktree at '${path}'`)
}

/** git rerere の記録 (.git/rr-cache と MERGE_RR)。 */
export interface RerereState {
  /** 今コンフリクトしていて、解決を記録する対象のパス → コンフリクトの鍵と、そのときの内容 (preimage)。 */
  readonly pending: Readonly<Record<string, { readonly key: string; readonly preimage: string }>>
  /** 記録した解決: コンフリクトの鍵 → 解決したあとの内容 (postimage)。 */
  readonly resolved: Readonly<Record<string, string>>
}

export const EMPTY_RERERE: RerereState = { pending: {}, resolved: {} }

/** git config の真偽値 (true / yes / on / 1)。未設定なら undefined。 */
export function configBool(repo: Repo, key: string): boolean | undefined {
  const value = repo.config[key]
  if (value === undefined) return undefined
  return ['true', 'yes', 'on', '1'].includes(value.toLowerCase())
}

export interface OperationResult {
  readonly repo: Repo
  readonly output: string
}

/** ユーザーの操作が Git の規則に反するときに投げるエラー。 */
export class GitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitError'
  }
}

export const DEFAULT_BRANCH = 'main'
export const REMOTE_NAME = 'origin'
export const ORIGIN_URL = 'https://example.com/branch-lab.git'

const BRANCH_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

/** origin から clone した直後の状態を作る。 */
export function createRepo(): Repo {
  const tree: Tree = { 'README.md': '# BranchLab\n' }
  const root: Commit = { id: 'C0', parents: [], message: 'Initial commit', tree }
  const commits = { [root.id]: root }
  return {
    commits,
    branches: { [DEFAULT_BRANCH]: root.id },
    head: { type: 'branch', name: DEFAULT_BRANCH },
    index: tree,
    workdir: tree,
    operation: null,
    conflicts: [],
    editor: null,
    stash: [],
    tags: {},
    bisect: null,
    config: {},
    rerere: EMPTY_RERERE,
    worktree: MAIN_WORKTREE,
    worktrees: {},
    submodules: {},
    submodule: null,
    libraries: {},
    notes: {},
    sparse: null,
    clones: {},
    clone: null,
    reflogs: {
      HEAD: [{ id: root.id, message: `clone: from ${REMOTE_NAME}` }],
      [DEFAULT_BRANCH]: [{ id: root.id, message: `clone: from ${REMOTE_NAME}` }],
    },
    remotes: {
      [REMOTE_NAME]: {
        name: REMOTE_NAME,
        url: ORIGIN_URL,
        commits,
        branches: { [DEFAULT_BRANCH]: root.id },
        tags: {},
      },
    },
    remoteBranches: { [`${REMOTE_NAME}/${DEFAULT_BRANCH}`]: root.id },
    upstreams: { [DEFAULT_BRANCH]: `${REMOTE_NAME}/${DEFAULT_BRANCH}` },
    nextId: 1,
  }
}

// ---- 参照 ----

export function headCommitId(repo: Repo): CommitId {
  if (repo.head.type === 'detached') return repo.head.id
  const id = repo.branches[repo.head.name]
  if (id === undefined) {
    throw new GitError(`ブランチ ${repo.head.name} が見つかりません`)
  }
  return id
}

export function currentBranch(repo: Repo): string | null {
  return repo.head.type === 'branch' ? repo.head.name : null
}

export function getCommit(repo: Repo, id: CommitId): Commit {
  const commit = repo.commits[id]
  if (!commit) throw new GitError(`コミット ${id} が見つかりません`)
  return commit
}

export function headTree(repo: Repo): Tree {
  return getCommit(repo, headCommitId(repo)).tree
}

/** id とその祖先すべて。 */
export function ancestors(
  commits: Readonly<Record<CommitId, Commit>>,
  id: CommitId,
): Set<CommitId> {
  const visited = new Set<CommitId>()
  const stack: CommitId[] = [id]
  while (stack.length > 0) {
    const current = stack.pop() as CommitId
    if (visited.has(current)) continue
    visited.add(current)
    const commit = commits[current]
    if (commit) stack.push(...commit.parents)
  }
  return visited
}

/** ancestor が descendant の祖先 (自分自身を含む) かどうか。 */
export function isAncestor(
  repo: Repo,
  ancestor: CommitId,
  descendant: CommitId,
): boolean {
  return ancestors(repo.commits, descendant).has(ancestor)
}

/** 2 つのコミットの共通祖先のうち、最も新しいもの。 */
export function mergeBase(repo: Repo, a: CommitId, b: CommitId): CommitId | null {
  const ofA = ancestors(repo.commits, a)
  const common = [...ancestors(repo.commits, b)].filter((id) => ofA.has(id))
  const best = common.filter(
    (id) => !common.some((other) => other !== id && isAncestor(repo, id, other)),
  )
  return best[0] ?? null
}

/** ブランチ・タグ・リモート追跡ブランチ・HEAD からたどれるコミット。 */
export function reachableCommits(repo: Repo): Set<CommitId> {
  const tips = [
    ...Object.values(repo.branches),
    ...Object.values(repo.tags).map((tag) => tag.target),
    ...Object.values(repo.remoteBranches),
  ]
  tips.push(headCommitId(repo))
  if (repo.operation?.type === 'merge') tips.push(repo.operation.theirs)
  if (repo.bisect) tips.push(...(repo.bisect.bad === null ? [] : [repo.bisect.bad]), ...repo.bisect.good)
  for (const state of [currentWorktreeState(repo), ...Object.values(repo.worktrees)]) {
    tips.push(state.head.type === 'branch' ? (repo.branches[state.head.name] as CommitId) : state.head.id)
    const op = state.operation
    if (op?.type === 'merge') tips.push(op.theirs)
    else if (op?.type === 'am') tips.push(op.origHead)
    else if (op) tips.push(op.origHead, ...Object.values(op.labels ?? {}))
    if (state.bisect) tips.push(...(state.bisect.bad === null ? [] : [state.bisect.bad]), ...state.bisect.good)
  }
  const reachable = new Set<CommitId>()
  for (const tip of tips) {
    for (const id of ancestors(repo.commits, tip)) reachable.add(id)
  }
  return reachable
}

const REF_PATTERN = /^([^~^]+)((?:[~^]\d*)*)$/

/** "<リモート>/<ブランチ>" を分ける。リモートの名前でなければ null。 */
export function splitRemoteRef(repo: Repo, ref: string): { remote: string; branch: string } | null {
  for (const remote of Object.keys(repo.remotes)) {
    if (ref.startsWith(`${remote}/`) && ref.length > remote.length + 1) {
      return { remote, branch: ref.slice(remote.length + 1) }
    }
  }
  return null
}

export function getRemote(repo: Repo, name: string): Remote {
  const remote = repo.remotes[name]
  if (!remote) {
    throw new GitError(`fatal: '${name}' というリモートはありません (git remote で一覧を確認できます)`)
  }
  return remote
}

/** ref を解決できれば CommitId、できなければ null。 */
export function tryResolveRef(repo: Repo, ref: string): CommitId | null {
  try {
    return resolveRef(repo, ref)
  } catch {
    return null
  }
}

/**
 * コミットの指定 (タグ名・ブランチ名・origin/<ブランチ名>・コミット ID・HEAD) を解決する。
 * タグとブランチが同じ名前なら、Git と同じくタグを優先する。
 * 末尾の ~n は第 1 親を n 回、^n は n 番目の親をたどる (n の省略は 1)。
 */
export function resolveRef(repo: Repo, ref: string): CommitId {
  const match = REF_PATTERN.exec(ref)
  if (!match) throw new GitError(`'${ref}' はコミットの指定として使えません`)
  const [, base = '', suffix = ''] = match

  const reflogRef = /^(.*)@\{(-?\d+)\}$/.exec(base)
  let id: CommitId
  if (reflogRef) id = resolveReflogRef(repo, reflogRef[1] ?? '', Number(reflogRef[2]))
  else if (base === 'HEAD' || base === '@') id = headCommitId(repo)
  else if (base in repo.tags) id = (repo.tags[base] as Tag).target
  else if (base in repo.branches) id = repo.branches[base] as CommitId
  else if (base in repo.remoteBranches) id = repo.remoteBranches[base] as CommitId
  else if (base in repo.commits) id = base
  else throw new GitError(`'${base}' というブランチやコミットはありません`)

  for (const [, op, digits] of suffix.matchAll(/([~^])(\d*)/g)) {
    const n = digits === '' ? 1 : Number(digits)
    if (op === '~') {
      for (let i = 0; i < n; i++) id = parentOf(repo, id, 0, ref)
    } else if (n > 0) {
      id = parentOf(repo, id, n - 1, ref)
    }
  }
  return id
}

/** n 個前に checkout していたブランチ (git switch - や @{-1})。 */
export function previousBranch(repo: Repo, n = 1): string {
  let count = 0
  for (const entry of repo.reflogs['HEAD'] ?? []) {
    const match = /^checkout: moving from (\S+) to /.exec(entry.message)
    if (match && ++count === n) return match[1] as string
  }
  throw new GitError(`fatal: ${n} 個前に checkout していたブランチはありません`)
}

/** <名前>@{n}: reflog の n 個前。名前を省くと現在のブランチ、@{-n} は n 個前のブランチ。 */
function resolveReflogRef(repo: Repo, name: string, n: number): CommitId {
  if (n < 0) {
    if (name !== '') throw new GitError(`'${name}@{${n}}' はコミットの指定として使えません`)
    return resolveRef(repo, previousBranch(repo, -n))
  }
  const key = name === '' ? (currentBranch(repo) ?? 'HEAD') : name
  const entries = repo.reflogs[key]
  if (!entries) throw new GitError(`fatal: '${key}' の reflog はありません`)
  const entry = entries[n]
  if (!entry) throw new GitError(`fatal: '${key}' の reflog には ${entries.length} 個のエントリしかありません`)
  return entry.id
}

/** git reflog [<ref>]: HEAD (またはブランチ) が移動した履歴を新しいものから表示する。 */
export function reflog(repo: Repo, ref = 'HEAD'): OperationResult {
  const key = ref === '@' ? 'HEAD' : ref
  const entries = repo.reflogs[key]
  if (!entries) throw new GitError(`fatal: '${ref}' の reflog はありません`)
  const lines = entries.map((entry, index) => {
    const names = refNames(repo, entry.id)
    const decoration = names.length > 0 ? ` (${names.join(', ')})` : ''
    return `${entry.id}${decoration} ${key}@{${index}}: ${entry.message}`
  })
  return { repo, output: lines.join('\n') }
}

function parentOf(repo: Repo, id: CommitId, index: number, ref: string): CommitId {
  const parent = repo.commits[id]?.parents[index]
  if (parent === undefined) {
    throw new GitError(`${ref}: ${id} には ${index + 1} 番目の親がありません`)
  }
  return parent
}

/** コミットを指しているブランチなどの名前 (log の表示用)。 */
export function refNames(repo: Repo, id: CommitId): string[] {
  const names: string[] = []
  const current = currentBranch(repo)
  if (repo.head.type === 'detached' && repo.head.id === id) names.push('HEAD')
  // 現在のブランチを先頭に (git log と同じ "HEAD -> main, feature" の順)
  if (current !== null && repo.branches[current] === id) names.push(`HEAD -> ${current}`)
  for (const [name, target] of Object.entries(repo.branches)) {
    if (target === id && name !== current) names.push(name)
  }
  for (const [name, tag] of Object.entries(repo.tags).sort(([a], [b]) => a.localeCompare(b))) {
    if (tag.target === id) names.push(`tag: ${name}`)
  }
  for (const [name, target] of Object.entries(repo.remoteBranches)) {
    if (target === id) names.push(name)
  }
  return names
}

// ---- 作業ディレクトリとステージ ----

/** コミットしていない変更 (ステージ済み・未ステージ・未追跡) があるパス。 */
export function dirtyPaths(repo: Repo): string[] {
  const head = headTree(repo)
  return [
    ...new Set([...changedPaths(head, repo.index), ...changedPaths(repo.index, repo.workdir)]),
  ].sort()
}

/** ステージ済み・未ステージの変更 (未追跡ファイルを除く) があるか。 */
export function hasTrackedChanges(repo: Repo): boolean {
  if (!treesEqual(headTree(repo), repo.index)) return true
  return changedPaths(repo.index, repo.workdir).some((path) => path in repo.index)
}

export function requireNoOperation(repo: Repo): void {
  requireNoEditor(repo)
  const op = repo.operation
  if (!op) return
  throw new GitError(
    `${op.type} の途中です。コンフリクトを解消して git ${op.type} --continue で続けるか、` +
      `git ${op.type} --abort で中止してください`,
  )
}

/**
 * HEAD を nextTree のコミットに移すとき、コミットしていない変更を引き継いだ
 * ステージと作業ディレクトリを返す。変更が上書きされる場合は Git と同じく中止する。
 */
export function carryChanges(
  repo: Repo,
  nextTree: Tree,
  action: string,
): { index: Tree; workdir: Tree } {
  const head = headTree(repo)
  // サブモジュールの中で HEAD を動かしただけ (未ステージの gitlink) なら、Git と同じく上書きの対象にしない
  const dirty = dirtyPaths(repo).filter(
    (path) => !(parseGitlink(repo.workdir[path]) !== null && repo.index[path] === head[path]),
  )
  const tracked = dirty.filter((path) => path in head || path in repo.index)
  const untracked = dirty.filter((path) => !tracked.includes(path))

  const overwritten = tracked.filter((path) => nextTree[path] !== head[path])
  if (overwritten.length > 0) {
    throw new GitError(
      [
        `error: 次のファイルのローカルの変更は ${action} によって上書きされます:`,
        ...overwritten.map((path) => `\t${path}`),
        '変更をコミットするか restore で取り消してから、もう一度実行してください。',
      ].join('\n'),
    )
  }
  const clobbered = untracked.filter((path) => path in nextTree)
  if (clobbered.length > 0) {
    throw new GitError(
      [
        `error: 次の追跡されていないファイルは ${action} によって上書きされます:`,
        ...clobbered.map((path) => `\t${path}`),
        'ファイルを移動するか削除してから、もう一度実行してください。',
      ].join('\n'),
    )
  }

  let index = nextTree
  let workdir = nextTree
  for (const path of dirty) {
    index = withFile(index, path, repo.index[path])
    workdir = withFile(workdir, path, repo.workdir[path])
  }
  return { index, workdir }
}

const PATH_PATTERN = /^[^\s/][^\s]*$/

function validatePath(path: string): void {
  const segments = path.split('/')
  if (
    !PATH_PATTERN.test(path) ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new GitError(`'${path}' はファイル名として使えません`)
  }
}

/** pathspec ('.'、ファイル名、ディレクトリ名) に当てはまるパス。 */
function matchPaths(paths: Iterable<string>, spec: string): string[] {
  const prefix = spec.endsWith('/') ? spec : `${spec}/`
  return [...paths].filter((path) => spec === '.' || path === spec || path.startsWith(prefix))
}

export function writeFile(
  repo: Repo,
  path: string,
  text: string,
  append: boolean,
): OperationResult {
  validatePath(path)
  if (Object.keys(repo.workdir).some((other) => other.startsWith(`${path}/`)) || isSubmodulePath(repo, path)) {
    throw new GitError(`${path} はディレクトリです`)
  }
  const inSubmodule = submoduleContaining(repo, path)
  if (inSubmodule !== null) {
    throw new GitError(`${path} はサブモジュール '${inSubmodule}' の中です (cd ${inSubmodule} で中に移動してください)`)
  }
  // sparse-checkout で出していないファイルは、作業ディレクトリにないものとして書く
  const base = isSparseHidden(repo, path) ? '' : (repo.workdir[path] ?? '')
  const content = append ? base + text : text
  return { repo: { ...repo, workdir: withFile(repo.workdir, path, content) }, output: '' }
}

export function touchFile(repo: Repo, path: string): OperationResult {
  if (path in repo.workdir && !isSubmodulePath(repo, path) && !isSparseHidden(repo, path)) return { repo, output: '' }
  return writeFile(repo, path, '', false)
}

export function readFile(repo: Repo, path: string): OperationResult {
  if (isSubmodulePath(repo, path)) throw new GitError(`cat: ${path}: ディレクトリです`)
  const content = isSparseHidden(repo, path) ? undefined : repo.workdir[path]
  if (content === undefined) {
    throw new GitError(`cat: ${path}: そのようなファイルはありません`)
  }
  return { repo, output: content.replace(/\n$/, '') }
}

export function listFiles(repo: Repo): OperationResult {
  return {
    repo,
    output: Object.keys(repo.workdir)
      .filter((path) => !isSparseHidden(repo, path))
      .sort()
      .map((path) => (isSubmodulePath(repo, path) ? `${path}/` : path))
      .join('\n'),
  }
}

/**
 * sparse-checkout の cone に入るパスか。ルートのファイルと、指定したディレクトリの中、
 * 指定したディレクトリの親ディレクトリの直下のファイルが入る (Git の cone モードと同じ)。
 */
export function inSparseCone(dirs: readonly string[], path: string): boolean {
  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  if (parent === '') return true
  return dirs.some((dir) => path.startsWith(`${dir}/`) || dir === parent || dir.startsWith(`${parent}/`))
}

/** sparse-checkout で作業ディレクトリに出していないファイルか (変更したファイルは出す)。 */
export function isSparseHidden(repo: Repo, path: string): boolean {
  return (
    repo.sparse !== null &&
    !inSparseCone(repo.sparse, path) &&
    path in repo.index &&
    repo.workdir[path] === repo.index[path]
  )
}

/** path がサブモジュール (gitlink) の位置か。 */
export function isSubmodulePath(repo: Repo, path: string): boolean {
  return parseGitlink(repo.workdir[path] ?? repo.index[path]) !== null || path in repo.submodules
}

/** path がサブモジュールの中のファイルなら、そのサブモジュールのパス。 */
export function submoduleContaining(repo: Repo, path: string): string | null {
  const paths = new Set([...Object.keys(repo.submodules), ...Object.keys(repo.index).filter((p) => parseGitlink(repo.index[p]) !== null)])
  return [...paths].find((sub) => path.startsWith(`${sub}/`)) ?? null
}

/** シェルの rm。作業ディレクトリからだけ削除する。 */
export function removeFile(repo: Repo, path: string): OperationResult {
  if (isSubmodulePath(repo, path)) throw new GitError(`rm: ${path} を削除できません: ディレクトリです`)
  if (!(path in repo.workdir) || isSparseHidden(repo, path)) {
    throw new GitError(`rm: ${path}: そのようなファイルはありません`)
  }
  return { repo: { ...repo, workdir: withFile(repo.workdir, path, undefined) }, output: '' }
}

function withoutConflicts(repo: Repo, paths: readonly string[]): readonly Conflict[] {
  return repo.conflicts.filter((conflict) => !paths.includes(conflict.path))
}

/** git add。pathspec に当てはまる作業ディレクトリの内容をステージする。 */
export function add(repo: Repo, specs: readonly string[]): OperationResult {
  if (specs.length === 0) {
    throw new GitError('ステージするファイルを指定してください (例: git add README.md, git add .)')
  }
  const known = new Set([...Object.keys(repo.workdir), ...Object.keys(repo.index)])
  const paths = new Set<string>()
  for (const spec of specs) {
    const matched = matchPaths(known, spec === '-A' || spec === '--all' ? '.' : spec)
    if (matched.length === 0 && spec !== '.' && spec !== '-A' && spec !== '--all') {
      throw new GitError(`fatal: pathspec '${spec}' に一致するファイルはありません`)
    }
    for (const path of matched) paths.add(path)
  }
  let index = repo.index
  for (const path of paths) index = withFile(index, path, repo.workdir[path])
  return {
    repo: { ...repo, index, conflicts: withoutConflicts(repo, [...paths]) },
    output: '',
  }
}

/** git rm。ステージと作業ディレクトリから削除する (--cached ならステージからだけ)。 */
export function gitRemove(
  repo: Repo,
  specs: readonly string[],
  options: { readonly cached?: boolean; readonly force?: boolean } = {},
): OperationResult {
  if (specs.length === 0) throw new GitError('削除するファイルを指定してください')
  const head = headTree(repo)
  const paths: string[] = []
  for (const spec of specs) {
    const matched = matchPaths(Object.keys(repo.index), spec)
    if (matched.length === 0) {
      throw new GitError(`fatal: pathspec '${spec}' に一致するファイルはありません`)
    }
    paths.push(...matched)
  }
  if (!options.force) {
    const staged = paths.filter((path) => repo.index[path] !== head[path])
    const modified = paths.filter(
      (path) => path in repo.workdir && repo.workdir[path] !== repo.index[path],
    )
    const blocked = options.cached
      ? staged.filter((path) => modified.includes(path))
      : [...new Set([...staged, ...modified])]
    if (blocked.length > 0) {
      throw new GitError(
        [
          'error: 次のファイルにはコミットしていない変更があります:',
          ...blocked.map((path) => `    ${path}`),
          '(--cached でファイルを残すか、-f で強制的に削除できます)',
        ].join('\n'),
      )
    }
  }
  let index = repo.index
  let workdir = repo.workdir
  for (const path of paths) {
    index = withFile(index, path, undefined)
    if (!options.cached) workdir = withFile(workdir, path, undefined)
  }
  return {
    repo: { ...repo, index, workdir, conflicts: withoutConflicts(repo, paths) },
    output: paths.map((path) => `rm '${path}'`).join('\n'),
  }
}

/**
 * git restore。staged ならステージを source (既定は HEAD) の内容に、
 * そうでなければ作業ディレクトリをステージの内容に戻す。
 */
export function restore(
  repo: Repo,
  specs: readonly string[],
  options: { readonly staged?: boolean; readonly source?: string } = {},
): OperationResult {
  if (specs.length === 0) throw new GitError('元に戻すファイルを指定してください')
  const sourceTree =
    options.source !== undefined
      ? getCommit(repo, resolveRef(repo, options.source)).tree
      : options.staged
        ? headTree(repo)
        : repo.index
  const target = options.staged ? repo.index : repo.workdir
  let next = target
  for (const spec of specs) {
    const matched = matchPaths(new Set([...Object.keys(sourceTree), ...Object.keys(target)]), spec)
    if (matched.length === 0) {
      throw new GitError(`error: pathspec '${spec}' に一致するファイルはありません`)
    }
    for (const path of matched) next = withFile(next, path, sourceTree[path])
  }
  return {
    repo: options.staged ? { ...repo, index: next } : { ...repo, workdir: next },
    output: '',
  }
}

// ---- コミット ----

/**
 * before から after への HEAD とブランチの移動を reflog に記録する。
 * HEAD は指すコミットが変わったとき (forceHead なら変わらなくても) に、
 * ブランチは先端が変わったときに記録し、消えたブランチの reflog は消す。
 */
export function logRefs(
  before: Repo,
  after: Repo,
  message: string,
  options: { readonly forceHead?: boolean; readonly forceBranch?: boolean } = {},
): Repo {
  const reflogs: Record<string, readonly ReflogEntry[]> = {}
  for (const [name, entries] of Object.entries(after.reflogs)) {
    if (name === 'HEAD' || name in after.branches) reflogs[name] = entries
  }
  const add = (name: string, id: CommitId) => {
    reflogs[name] = [{ id, message }, ...(reflogs[name] ?? [])]
  }
  const headId = headCommitId(after)
  if (options.forceHead || headId !== headCommitId(before)) add('HEAD', headId)
  const current = currentBranch(after)
  for (const [name, id] of Object.entries(after.branches)) {
    if (before.branches[name] !== id || (options.forceBranch && name === current)) add(name, id)
  }
  return { ...after, reflogs }
}

/**
 * 新しいコミットを作って HEAD (ブランチにいればそのブランチ) を進める。
 * ステージと作業ディレクトリは変更しない。
 */
export function addCommit(
  repo: Repo,
  fields: Omit<Commit, 'id'>,
): { repo: Repo; commit: Commit } {
  const commit: Commit = { id: `${repo.idPrefix ?? 'C'}${repo.nextId}`, ...fields }
  const commits = { ...repo.commits, [commit.id]: commit }
  const next: Repo =
    repo.head.type === 'branch'
      ? {
          ...repo,
          commits,
          branches: { ...repo.branches, [repo.head.name]: commit.id },
          nextId: repo.nextId + 1,
        }
      : {
          ...repo,
          commits,
          head: { type: 'detached', id: commit.id },
          nextId: repo.nextId + 1,
        }
  return { repo: next, commit }
}

export function requireNoConflicts(repo: Repo): void {
  if (repo.conflicts.length === 0) return
  throw new GitError(
    [
      'error: マージされていないファイルがあるため、コミットできません:',
      ...repo.conflicts.map((conflict) => `\t${conflict.path}`),
      'ファイルを編集してコンフリクトを解消し、git add してください。',
    ].join('\n'),
  )
}

/** コミットメッセージの 1 行目 (件名)。 */
export function subject(message: string): string {
  return message.split('\n')[0] ?? ''
}

export function commitSummary(commit: Commit, branch: string | null): string {
  const where = branch ?? 'detached HEAD'
  return `[${where} ${commit.id}] ${subject(commit.message)}`
}

/**
 * エディタで書いたメッセージを Git と同じように整える。
 * '#' で始まる行と行末の空白を取り除き、連続する空行を 1 つにして、前後の空行を削る。
 */
export function cleanupMessage(text: string): string {
  const lines = text
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .map((line) => line.replace(/\s+$/, ''))
  const collapsed = lines.filter((line, index) => line !== '' || (index > 0 && lines[index - 1] !== ''))
  return collapsed.join('\n').trim()
}

/** コミットメッセージのエディタに出すテンプレート。 */
export function messageTemplate(repo: Repo, message: string, note?: string): string {
  return [
    message,
    '',
    ...(note ? note.split('\n').map((line) => `# ${line}`) : []),
    '# 変更内容のコミットメッセージを入力してください。\'#\' で始まる行は無視され、',
    '# 空のメッセージの場合はコミットを中止します。',
    '#',
    ...statusLines(repo).map((line) => (line === '' ? '#' : `# ${line}`)),
    '',
  ].join('\n')
}

/** エディタを開いて、閉じられるのを待つ状態にする。 */
export function openEditor(repo: Repo, editor: Editor): Repo {
  return { ...repo, editor }
}

export const EDITOR_WAITING =
  'エディタが閉じられるのを待っています... (内容を書いて「保存して閉じる」を押してください)'

export function requireNoEditor(repo: Repo): void {
  if (repo.editor) {
    throw new GitError('エディタが開いています。先にエディタを保存して閉じてください')
  }
}

export interface CommitOptions {
  /** -m で指定したメッセージ。指定しなければエディタを開く。 */
  readonly message?: string
  /** -a: 追跡しているファイルの変更をすべてステージしてからコミットする。 */
  readonly all?: boolean
  readonly allowEmpty?: boolean
  readonly amend?: boolean
  /** --no-edit: エディタを開かず、既定のメッセージ (amend なら元のメッセージ) を使う。 */
  readonly noEdit?: boolean
  /** エディタに最初から入れておくメッセージ (git commit --squash の "squash! 件名")。 */
  readonly template?: string
}

/** コミットを作る。output は git commit の 1 行目と同じ形。 */
export function createCommit(repo: Repo, pending: PendingCommit, message: string): { repo: Repo; output: string } {
  const { reflogAction, reflogMessage, ...fields } = pending
  const recorded = recordResolutions(repo, fields.tree)
  const { repo: next, commit: created } = addCommit(recorded.repo, { ...fields, message })
  const entry = reflogMessage ?? `${reflogAction ?? 'commit'}: ${subject(message)}`
  return {
    repo: logRefs(recorded.repo, next, entry),
    output: [...recorded.lines, commitSummary(created, currentBranch(next))].join('\n'),
  }
}

/**
 * rerere: コンフリクトを解決した内容を記録する (コミットするときと git rerere で呼ぶ)。
 * tree の内容にまだコンフリクトマーカーが残っているパスは記録しない。
 */
export function recordResolutions(repo: Repo, tree: Tree, clear = true): { repo: Repo; lines: string[] } {
  const entries = Object.entries(repo.rerere.pending)
  if (entries.length === 0) return { repo, lines: [] }
  const resolved = { ...repo.rerere.resolved }
  const lines: string[] = []
  for (const [path, { key }] of entries) {
    const content = tree[path]
    if (content === undefined || conflictKey(content) !== null || resolved[key] === content) continue
    resolved[key] = content
    lines.push(`Recorded resolution for '${path}'.`)
  }
  return { repo: { ...repo, rerere: { pending: clear ? {} : repo.rerere.pending, resolved } }, lines }
}

/** ステージ (インデックス) の内容でコミットする。メッセージがなければエディタを開く。 */
export function commit(repo: Repo, options: CommitOptions = {}): OperationResult {
  const op = repo.operation
  if (options.amend && op && !(op.type === 'rebase' && op.current === null)) requireNoOperation(repo)

  let staged = repo
  if (options.all) {
    let index = repo.index
    for (const path of Object.keys(repo.index)) index = withFile(index, path, repo.workdir[path])
    staged = { ...repo, index, conflicts: withoutConflicts(repo, Object.keys(repo.index)) }
  }
  requireNoConflicts(staged)

  const headId = headCommitId(staged)
  const head = getCommit(staged, headId)
  // rebase --rebase-merges の merge の行で止まっている場合は、マージコミットを作る
  const sequence = op && op.type !== 'merge' && op.type !== 'am' ? op : null
  const merging = sequence?.current?.action === 'merge' ? sequence.current : null
  const parents =
    options.amend ? head.parents
    : op?.type === 'merge' ? [headId, op.theirs]
    : merging && sequence ? [headId, ...merging.labels.map((label) => mergeTarget(staged, sequence, label))]
    : [headId]
  const parentTree = options.amend
    ? (staged.commits[head.parents[0] ?? '']?.tree ?? {})
    : head.tree

  const pickedId = sequence?.current && sequence.current.action !== 'merge' ? sequence.current.id : null
  const picked = pickedId === null ? null : getCommit(repo, pickedId)
  if (op?.type !== 'merge' && !merging && !options.allowEmpty && treesEqual(staged.index, parentTree)) {
    if (options.amend) {
      throw new GitError('コミットの内容が親と同じになります。--allow-empty を付けてください')
    }
    if (picked) {
      throw new GitError(
        `${picked.id} の変更はすでに含まれているため、コミットが空になります。\n` +
          `git ${op?.type} --skip で飛ばすか、git commit --allow-empty で空のコミットを作ってください`,
      )
    }
    const lines = statusLines(staged)
    if (!treesEqual(staged.index, staged.workdir)) {
      lines.push('コミット予定の変更はありません ("git add" や "git commit -a" を使ってください)')
    }
    throw new GitError(lines.join('\n'))
  }

  const pending: PendingCommit = {
    parents,
    tree: staged.index,
    ...(picked && op?.type !== 'revert' ? { source: picked.source ?? picked.id } : {}),
    ...(picked && op?.type === 'revert' ? { reverts: picked.id } : {}),
    ...(merging && merging.id !== null ? { source: getCommit(repo, merging.id).source ?? merging.id } : {}),
    reflogAction:
      options.amend ? 'commit (amend)'
      : op?.type === 'merge' ? 'commit (merge)'
      : (picked || merging) && op ? (op.type === 'rebase' ? 'rebase (continue)' : op.type)
      : 'commit',
  }
  const defaultMessage =
    options.template !== undefined ? options.template
    : options.amend ? head.message
    : op?.type === 'merge' ? op.message
    : merging ? mergeItemMessage(repo, merging)
    : picked && op?.type === 'revert' ? revertMessage(picked, op.mainline)
    : picked ? picked.message
    : ''
  const finishedOp: Operation | null =
    !op ? null
    : op.type === 'merge' ? null
    : op.current === null ? op
    : op.todo.length === 0 && op.type !== 'rebase' ? null
    : { ...op, current: null }

  const message = options.message?.trim()
  if (message || (options.noEdit && defaultMessage)) {
    const created = createCommit(staged, pending, message || defaultMessage)
    return { repo: { ...created.repo, operation: finishedOp }, output: created.output }
  }
  if (options.noEdit) {
    throw new GitError('メッセージが空のため、コミットを中止しました (-m でメッセージを指定してください)')
  }
  const editor: Editor = {
    file: op?.type === 'merge' ? 'MERGE_MSG' : 'COMMIT_EDITMSG',
    text: messageTemplate(staged, defaultMessage),
    after: { kind: 'commit', commit: pending, operation: finishedOp },
  }
  return { repo: openEditor(staged, editor), output: EDITOR_WAITING }
}

/** revert のメッセージ。マージコミットを -m で revert したときは、基準にした親も書く (Git と同じ)。 */
export function revertMessage(commit: Commit, mainline: number | null = null): string {
  const title = `Revert "${subject(commit.message)}"`
  const parent = mainline === null || commit.parents.length < 2 ? undefined : commit.parents[mainline - 1]
  return parent === undefined
    ? `${title}\n\nThis reverts commit ${commit.id}.`
    : `${title}\n\nThis reverts commit ${commit.id}, reversing\nchanges made to ${parent}.`
}

// ---- ブランチ ----

export function validateRefName(name: string): void {
  if (!BRANCH_NAME_PATTERN.test(name) || name.includes('..') || name === 'HEAD') {
    throw new GitError(`fatal: '${name}' はブランチ名として使えません`)
  }
}

export function createBranch(repo: Repo, name: string, startPoint = 'HEAD'): OperationResult {
  validateRefName(name)
  if (name in repo.branches) {
    throw new GitError(`fatal: ブランチ '${name}' はすでに存在します`)
  }
  // Git と同じく、リモート追跡ブランチから作ったブランチはそれを upstream にする (branch.autoSetupMerge)
  const tracking = startPoint in repo.remoteBranches
  const next: Repo = {
    ...repo,
    branches: { ...repo.branches, [name]: resolveRef(repo, startPoint) },
    ...(tracking ? { upstreams: { ...repo.upstreams, [name]: startPoint } } : {}),
  }
  return {
    repo: logRefs(repo, next, `branch: Created from ${startPoint}`),
    output: tracking ? `ブランチ '${name}' は '${startPoint}' を追跡するように設定されました。` : '',
  }
}

export function listBranches(repo: Repo, options: { readonly remotes?: boolean } = {}): string {
  const current = currentBranch(repo)
  const lines: string[] = []
  if (repo.head.type === 'detached') lines.push(`* (HEAD detached at ${repo.head.id})`)
  for (const name of Object.keys(repo.branches).sort()) {
    // ほかの worktree でチェックアウトしているブランチには + を付ける (Git と同じ)
    const mark = name === current ? '*' : branchWorktree(repo, name) !== null ? '+' : ' '
    lines.push(`${mark} ${name}`)
  }
  if (options.remotes) {
    for (const name of Object.keys(repo.remoteBranches).sort()) {
      lines.push(`  remotes/${name}`)
    }
  }
  return lines.join('\n')
}

export function deleteBranch(repo: Repo, name: string, force = false): OperationResult {
  const target = repo.branches[name]
  if (target === undefined) {
    throw new GitError(`error: ブランチ '${name}' は見つかりません`)
  }
  if (name === currentBranch(repo)) {
    throw new GitError(`error: 現在いるブランチ '${name}' は削除できません`)
  }
  const usedBy = branchWorktree(repo, name)
  if (usedBy !== null) {
    throw new GitError(`error: cannot delete branch '${name}' used by worktree at '${usedBy}'`)
  }
  const upstream = repo.upstreams[name]
  const upstreamId = upstream === undefined ? undefined : repo.remoteBranches[upstream]
  const merged =
    isAncestor(repo, target, headCommitId(repo)) ||
    (upstreamId !== undefined && isAncestor(repo, target, upstreamId))
  if (!force && !merged) {
    throw new GitError(
      `error: ブランチ '${name}' は完全にはマージされていません。\n` +
        `本当に削除する場合は 'git branch -D ${name}' を実行してください。`,
    )
  }
  const branches = { ...repo.branches }
  delete branches[name]
  const upstreams = { ...repo.upstreams }
  delete upstreams[name]
  const reflogs = { ...repo.reflogs }
  delete reflogs[name]
  return {
    repo: { ...repo, branches, upstreams, reflogs },
    output: `ブランチ ${name} を削除しました (${target})`,
  }
}

export function renameBranch(repo: Repo, from: string, to: string): OperationResult {
  const target = repo.branches[from]
  if (target === undefined) throw new GitError(`error: ブランチ '${from}' は見つかりません`)
  validateRefName(to)
  if (to in repo.branches) throw new GitError(`fatal: ブランチ '${to}' はすでに存在します`)
  const branches: Record<string, CommitId> = {}
  for (const [name, id] of Object.entries(repo.branches)) {
    branches[name === from ? to : name] = id
  }
  const upstreams: Record<string, string> = {}
  for (const [name, remote] of Object.entries(repo.upstreams)) {
    upstreams[name === from ? to : name] = remote
  }
  const head: Head =
    repo.head.type === 'branch' && repo.head.name === from ? { type: 'branch', name: to } : repo.head
  // ほかの worktree でチェックアウトしていれば、そちらの HEAD も付け替える
  const worktrees = Object.fromEntries(
    Object.entries(repo.worktrees).map(([path, state]): [string, WorktreeState] => [
      path,
      state.head.type === 'branch' && state.head.name === from ? { ...state, head: { type: 'branch', name: to } } : state,
    ]),
  )
  const reflogs: Record<string, readonly ReflogEntry[]> = { ...repo.reflogs }
  reflogs[to] = [
    { id: target, message: `Branch: renamed refs/heads/${from} to refs/heads/${to}` },
    ...(reflogs[from] ?? []),
  ]
  delete reflogs[from]
  return { repo: { ...repo, branches, upstreams, head, reflogs, worktrees }, output: '' }
}

/** git branch -u origin/<ブランチ>: branch の upstream を設定する。 */
export function setUpstream(repo: Repo, remoteRef: string, branch?: string): OperationResult {
  const name = branch ?? currentBranch(repo)
  if (name === null) throw new GitError('fatal: detached HEAD では upstream を設定できません')
  if (!(name in repo.branches)) throw new GitError(`error: ブランチ '${name}' は見つかりません`)
  if (!(remoteRef in repo.remoteBranches)) {
    throw new GitError(`fatal: '${remoteRef}' というリモート追跡ブランチはありません`)
  }
  return {
    repo: { ...repo, upstreams: { ...repo.upstreams, [name]: remoteRef } },
    output: `ブランチ '${name}' は '${remoteRef}' を追跡するように設定されました。`,
  }
}

/** detached HEAD から離れるとき、どこからもたどれなくなるコミットの警告。 */
function leavingBehindWarning(before: Repo, after: Repo): string | null {
  if (before.head.type !== 'detached') return null
  const reachable = reachableCommits(after)
  const lost = [...ancestors(before.commits, before.head.id)].filter((id) => !reachable.has(id))
  if (lost.length === 0) return null
  return (
    `警告: どのブランチにもつながっていない ${lost.length} 個のコミットを置いていきます: ` +
    `${lost.join(', ')}\n残したい場合は git branch <新しいブランチ名> ${before.head.id} で保存できます`
  )
}

/** HEAD の今の位置の名前 (ブランチ名、detached ならコミット ID)。reflog に書く。 */
export function headLabel(repo: Repo): string {
  return repo.head.type === 'branch' ? repo.head.name : repo.head.id
}

export function moveHead(repo: Repo, head: Head, targetId: CommitId, action: string, to: string): Repo {
  const { index, workdir } = carryChanges(repo, getCommit(repo, targetId).tree, action)
  return logRefs(repo, { ...repo, head, index, workdir }, `checkout: moving from ${headLabel(repo)} to ${to}`, {
    forceHead: true,
  })
}

function joinLines(...lines: Array<string | null>): string {
  return lines.filter((line): line is string => line !== null && line !== '').join('\n')
}

export function switchBranch(
  repo: Repo,
  name: string,
  options: { readonly create?: boolean; readonly startPoint?: string } = {},
): OperationResult {
  requireNoOperation(repo)
  if (options.create) {
    const { repo: created, output: tracking } = createBranch(repo, name, options.startPoint)
    const next = moveHead(created, { type: 'branch', name }, created.branches[name] as CommitId, 'switch', name)
    return {
      repo: next,
      output: joinLines(leavingBehindWarning(repo, next), tracking, `新しいブランチ '${name}' に切り替えました`),
    }
  }

  if (!(name in repo.branches)) {
    // リモートにだけあるブランチは、追跡ブランチを作って切り替える (同じ名前が 1 つのリモートにだけある場合)
    const matches = Object.keys(repo.remoteBranches).filter((ref) => splitRemoteRef(repo, ref)?.branch === name)
    if (matches.length === 0) {
      throw new GitError(`fatal: '${name}' というブランチはありません`)
    }
    if (matches.length > 1) {
      throw new GitError(
        `fatal: '${name}' は複数のリモートにあります (${matches.join(', ')})。\n` +
          `git switch -c ${name} <リモート>/${name} のように、どれを追跡するか指定してください`,
      )
    }
    const tracking = matches[0] as string
    const remoteId = repo.remoteBranches[tracking] as CommitId
    const created: Repo = logRefs(
      repo,
      { ...repo, branches: { ...repo.branches, [name]: remoteId }, upstreams: { ...repo.upstreams, [name]: tracking } },
      `branch: Created from ${tracking}`,
    )
    const next = moveHead(created, { type: 'branch', name }, remoteId, 'switch', name)
    return {
      repo: next,
      output: joinLines(
        `ブランチ '${name}' は '${tracking}' を追跡するように設定されました。`,
        `新しいブランチ '${name}' に切り替えました`,
      ),
    }
  }

  if (currentBranch(repo) === name) {
    return { repo, output: `すでに '${name}' にいます` }
  }
  requireBranchFree(repo, name)
  const next = moveHead(repo, { type: 'branch', name }, repo.branches[name] as CommitId, 'switch', name)
  return {
    repo: next,
    output: joinLines(leavingBehindWarning(repo, next), `ブランチ '${name}' に切り替えました`),
  }
}

/** HEAD をブランチから切り離して、コミットを直接指す (detached HEAD)。 */
export function detachHead(repo: Repo, ref: string): OperationResult {
  requireNoOperation(repo)
  const id = resolveRef(repo, ref)
  const next = moveHead(repo, { type: 'detached', id }, id, 'switch', ref)
  return {
    repo: next,
    output: joinLines(
      leavingBehindWarning(repo, next),
      `HEAD は ${id} (${subject(getCommit(repo, id).message)}) を直接指しています (detached HEAD)`,
    ),
  }
}

// ---- reset ----

export type ResetMode = 'soft' | 'mixed' | 'hard'

/**
 * 現在のブランチ (detached HEAD なら HEAD) を target に移動する。
 * --soft はステージと作業ディレクトリをそのまま、--mixed はステージを、
 * --hard はステージと作業ディレクトリも target の内容にする。
 * 外れたコミットは削除せず残すので、コミット ID を指定すれば戻れる。
 */
export function reset(
  repo: Repo,
  target = 'HEAD',
  mode: ResetMode = 'mixed',
): OperationResult {
  if (repo.operation && mode !== 'hard') requireNoOperation(repo)
  const targetId = resolveRef(repo, target)
  const tree = getCommit(repo, targetId).tree
  const moved: Repo =
    repo.head.type === 'branch'
      ? { ...repo, branches: { ...repo.branches, [repo.head.name]: targetId } }
      : { ...repo, head: { type: 'detached', id: targetId } }
  const logged = logRefs(repo, moved, `reset: moving to ${target}`, { forceHead: true, forceBranch: true })
  const cleared: Repo =
    mode === 'hard' && repo.operation?.type !== 'rebase'
      ? { ...logged, operation: null, conflicts: [], rerere: { ...logged.rerere, pending: {} } }
      : mode === 'hard'
        ? { ...logged, conflicts: [], rerere: { ...logged.rerere, pending: {} } }
        : logged
  const next: Repo =
    mode === 'soft' ? cleared
    : mode === 'mixed' ? { ...cleared, index: tree }
    : { ...cleared, index: tree, workdir: tree }

  if (mode === 'hard') {
    return {
      repo: next,
      output: `HEAD is now at ${targetId} ${subject(getCommit(repo, targetId).message)}`,
    }
  }
  if (mode === 'mixed') {
    const unstaged = changedPaths(next.index, next.workdir).filter((path) => path in next.index)
    return {
      repo: next,
      output:
        unstaged.length === 0
          ? ''
          : ['リセット後にステージされていない変更:', ...unstaged.map((path) => `M\t${path}`)].join(
              '\n',
            ),
    }
  }
  return { repo: next, output: '' }
}

/** git reset <path>: ステージを HEAD の内容に戻す (git restore --staged と同じ)。 */
export function resetPaths(repo: Repo, specs: readonly string[]): OperationResult {
  return restore(repo, specs, { staged: true })
}

// ---- 状態の表示 ----

export type FileChange = 'added' | 'modified' | 'deleted'

export interface FileEntry {
  readonly path: string
  readonly change: FileChange
}

export interface WorkspaceStatus {
  /** HEAD とステージの差分 (コミット予定の変更)。 */
  readonly staged: readonly FileEntry[]
  /** ステージと作業ディレクトリの差分 (未追跡ファイルを除く)。 */
  readonly unstaged: readonly FileEntry[]
  readonly untracked: readonly string[]
  readonly conflicts: readonly Conflict[]
}

function diffEntries(from: Tree, to: Tree, skip: ReadonlySet<string>): FileEntry[] {
  return changedPaths(from, to)
    .filter((path) => !skip.has(path))
    .map((path) => ({
      path,
      change: !(path in from) ? 'added' : !(path in to) ? 'deleted' : 'modified',
    }))
}

export function workspaceStatus(repo: Repo): WorkspaceStatus {
  const conflicted = new Set(repo.conflicts.map((conflict) => conflict.path))
  const untracked = Object.keys(repo.workdir)
    .filter((path) => !(path in repo.index) && !conflicted.has(path))
    .sort()
  const untrackedSet = new Set(untracked)
  return {
    staged: diffEntries(headTree(repo), repo.index, conflicted),
    unstaged: diffEntries(repo.index, repo.workdir, new Set([...conflicted, ...untrackedSet])),
    untracked,
    conflicts: repo.conflicts,
  }
}

const CHANGE_LABELS: Readonly<Record<FileChange, string>> = {
  added: '新規ファイル:',
  modified: '変更:',
  deleted: '削除:',
}

const CONFLICT_LABELS: Readonly<Record<Conflict['kind'], string>> = {
  'both-modified': '両方とも変更:',
  'both-added': '両方とも追加:',
  'deleted-by-us': 'こちらで削除:',
  'deleted-by-them': 'あちらで削除:',
}

function countOnly(repo: Repo, from: CommitId, notIn: CommitId): number {
  const exclude = ancestors(repo.commits, notIn)
  return [...ancestors(repo.commits, from)].filter((id) => !exclude.has(id)).length
}

/** ブランチと upstream の関係 (git status の 2 行目)。 */
export function trackingLine(repo: Repo, branch: string): string | null {
  const upstream = repo.upstreams[branch]
  if (upstream === undefined) return null
  const remoteId = repo.remoteBranches[upstream]
  const localId = repo.branches[branch]
  const name = upstream
  if (remoteId === undefined || localId === undefined) {
    return `このブランチは '${name}' を追跡していますが、リモートにありません。`
  }
  const ahead = countOnly(repo, localId, remoteId)
  const behind = countOnly(repo, remoteId, localId)
  if (ahead === 0 && behind === 0) return `このブランチは '${name}' と比較して最新です。`
  if (behind === 0) {
    return `このブランチは '${name}' よりも ${ahead} コミット進んでいます。("git push" で公開できます)`
  }
  if (ahead === 0) {
    return `このブランチは '${name}' よりも ${behind} コミット遅れています。fast-forward できます。("git pull" で更新できます)`
  }
  return `このブランチと '${name}' は分岐しており、それぞれ ${ahead} と ${behind} の異なるコミットがあります。`
}

function statusLines(repo: Repo): string[] {
  const lines: string[] = []
  const branch = currentBranch(repo)
  const op = repo.operation
  if (op?.type === 'rebase') {
    lines.push(`リベース中です (${op.branch ?? 'detached HEAD'} を ${headCommitId(repo)} の上に付け替えています)`)
  } else if (branch === null) {
    lines.push(`HEAD は ${headCommitId(repo)} で切り離されています (detached HEAD)`)
  } else {
    lines.push(`ブランチ ${branch}`)
    const tracking = trackingLine(repo, branch)
    if (tracking) lines.push(tracking)
  }
  if (repo.sparse !== null) {
    const tracked = Object.keys(repo.index)
    const present = tracked.filter((path) => !isSparseHidden(repo, path)).length
    const percent = tracked.length === 0 ? 100 : Math.round((present / tracked.length) * 100)
    lines.push(`スパースチェックアウト中です (追跡しているファイルの ${percent}% が作業ディレクトリにあります)`)
  }
  if (repo.bisect) {
    lines.push(`bisect 中です ('${repo.bisect.start}' から始めました)。git bisect good / bad で判定してください`)
  }
  if (op?.type === 'merge') {
    lines.push(
      repo.conflicts.length > 0
        ? 'マージしていないパスがあります。(コンフリクトを解消して "git commit" を実行してください)'
        : 'すべてのコンフリクトが解消されました。"git commit" でマージを完了してください',
    )
  } else if (op?.type === 'am') {
    lines.push('メールボックス (パッチ) を取り込んでいる途中です (git am)。')
    if (op.current !== null) {
      lines.push('直してステージしたら "git am --continue"、飛ばすには "git am --skip" を実行してください')
    }
  } else if (op && op.current !== null) {
    lines.push(`${op.type} の途中です (${op.current.action === 'merge' ? `merge ${op.current.labels.join(' ')}` : op.current.id} を適用中)`)
  } else if (op?.type === 'rebase') {
    lines.push('コミットを修正できます。終わったら "git rebase --continue" を実行してください')
  }
  if (op) lines.push(`(中止するには "git ${op.type} --abort")`)

  const status = workspaceStatus(repo)
  if (status.staged.length > 0) {
    lines.push('', 'コミット予定の変更点:')
    for (const entry of status.staged) lines.push(`\t${CHANGE_LABELS[entry.change]}  ${entry.path}`)
  }
  if (status.conflicts.length > 0) {
    lines.push('', 'マージされていないパス:')
    for (const conflict of status.conflicts) {
      lines.push(`\t${CONFLICT_LABELS[conflict.kind]}  ${conflict.path}`)
    }
  }
  // サブモジュールは、中のコミットが変わった・中に変更がある、を Git と同じく括弧で添える
  const unstaged = [...status.unstaged.map((entry) => ({ ...entry, note: submoduleNote(repo, entry.path) }))]
  for (const path of Object.keys(repo.submodules).sort()) {
    const note = submoduleNote(repo, path)
    if (note !== '' && !unstaged.some((entry) => entry.path === path)) unstaged.push({ path, change: 'modified', note })
  }
  if (unstaged.length > 0) {
    lines.push('', 'コミット予定に含まれていない変更:')
    for (const entry of unstaged) {
      lines.push(`\t${CHANGE_LABELS[entry.change]}  ${entry.path}${entry.note}`)
    }
  }
  if (status.untracked.length > 0) {
    lines.push('', '追跡されていないファイル:')
    for (const path of status.untracked) lines.push(`\t${path}`)
  }
  if (
    status.staged.length + unstaged.length + status.untracked.length +
      status.conflicts.length ===
    0
  ) {
    lines.push('', 'コミットするものはありません。作業ツリーはクリーンです')
  }
  return lines
}

/** サブモジュールの状態の注記 (" (new commits, modified content)" など)。サブモジュールでなければ空。 */
function submoduleNote(repo: Repo, path: string): string {
  const nested = repo.submodules[path]
  if (nested === undefined) return ''
  const notes: string[] = []
  if (parseGitlink(repo.workdir[path]) !== parseGitlink(repo.index[path])) notes.push('new commits')
  if (hasTrackedChanges(nested)) notes.push('modified content')
  if (Object.keys(nested.workdir).some((file) => !(file in nested.index))) notes.push('untracked content')
  return notes.length === 0 ? '' : ` (${notes.join(', ')})`
}

export function status(repo: Repo): OperationResult {
  return { repo, output: statusLines(repo).join('\n') }
}

