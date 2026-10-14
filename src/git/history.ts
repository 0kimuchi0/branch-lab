/**
 * 履歴を組み替える操作 (merge・cherry-pick・revert・rebase・rebase -i) と、
 * コンフリクトで止まったときの --continue / --abort / --skip、エディタを閉じたあとの続き。
 */
import {
  EDITOR_WAITING,
  GitError,
  REMOTE_NAME,
  ancestors,
  carryChanges,
  cleanupMessage,
  commit,
  createCommit,
  currentBranch,
  getCommit,
  hasTrackedChanges,
  headCommitId,
  headTree,
  isAncestor,
  logRefs,
  mergeBase,
  messageTemplate,
  openEditor,
  requireNoConflicts,
  requireNoOperation,
  resolveRef,
  revertMessage,
  subject,
  type Commit,
  type CommitId,
  type Editor,
  type Operation,
  type OperationResult,
  type PendingCommit,
  type Repo,
  type SequenceOperation,
  type SequenceType,
  type SquashPart,
  type PickItem,
  type TodoAction,
  type TodoItem,
} from './model'
import { finishTag } from './tag'
import { mergeTrees, treesEqual, withFile, type Conflict, type Tree } from './tree'

/**
 * コンフリクトで止まった状態にする。作業ディレクトリにはマーカー付きの内容を、
 * ステージのコンフリクトしたファイルには HEAD 側の内容を置く。
 */
function applyConflicted(
  repo: Repo,
  carried: { readonly index: Tree; readonly workdir: Tree },
  conflicts: readonly Conflict[],
): Repo {
  const head = headTree(repo)
  let index = carried.index
  for (const conflict of conflicts) index = withFile(index, conflict.path, head[conflict.path])
  return { ...repo, index, workdir: carried.workdir, conflicts }
}

function conflictLines(conflicts: readonly Conflict[]): string[] {
  return conflicts.map((conflict) =>
    conflict.kind === 'deleted-by-us' || conflict.kind === 'deleted-by-them'
      ? `CONFLICT (modify/delete): ${conflict.path} は片方で削除され、もう片方で変更されています`
      : `CONFLICT (content): ${conflict.path} でマージのコンフリクトが発生しました`,
  )
}

// ---- merge ----

export function mergeMessage(repo: Repo, ref: string): string {
  const current = currentBranch(repo)
  const into = current === null || current === 'main' ? '' : ` into ${current}`
  if (ref in repo.branches) return `Merge branch '${ref}'${into}`
  if (ref.startsWith(`${REMOTE_NAME}/`)) return `Merge remote-tracking branch '${ref}'${into}`
  return `Merge commit '${ref}'${into}`
}

export interface MergeOptions {
  /** -m で指定したメッセージ。 */
  readonly message?: string
  /** --no-edit: エディタを開かずに既定のメッセージを使う。 */
  readonly noEdit?: boolean
  /** -m がないときの既定のメッセージ (git pull が使う)。 */
  readonly defaultMessage?: string
  /** --no-ff: fast-forward できる場合もマージコミットを作る。 */
  readonly noFastForward?: boolean
  /** --ff-only: fast-forward できない場合は中止する。 */
  readonly fastForwardOnly?: boolean
  /** reflog に書く操作の名前 (既定は "merge <ref>"、git pull なら "pull")。 */
  readonly reflogAction?: string
}

export function merge(repo: Repo, ref: string, options: MergeOptions = {}): OperationResult {
  requireNoOperation(repo)
  const theirs = resolveRef(repo, ref)
  const ours = headCommitId(repo)

  if (isAncestor(repo, theirs, ours)) {
    return { repo, output: 'Already up to date.' }
  }

  if (isAncestor(repo, ours, theirs) && !options.noFastForward) {
    const tree = getCommit(repo, theirs).tree
    const { index, workdir } = carryChanges(repo, tree, 'merge')
    const moved: Repo =
      repo.head.type === 'branch'
        ? { ...repo, branches: { ...repo.branches, [repo.head.name]: theirs } }
        : { ...repo, head: { type: 'detached', id: theirs } }
    return {
      repo: logRefs(repo, { ...moved, index, workdir }, `${options.reflogAction ?? `merge ${ref}`}: Fast-forward`),
      output: `Updating ${ours}..${theirs}\nFast-forward`,
    }
  }

  if (options.fastForwardOnly) {
    throw new GitError('fatal: fast-forward できないため、マージを中止しました')
  }

  const baseId = mergeBase(repo, ours, theirs)
  const baseTree = baseId === null ? {} : getCommit(repo, baseId).tree
  const result = mergeTrees(baseTree, headTree(repo), getCommit(repo, theirs).tree, {
    ours: 'HEAD',
    theirs: ref,
  })
  const defaultMessage = options.defaultMessage ?? mergeMessage(repo, ref)
  const carried = carryChanges(repo, result.tree, 'merge')

  if (result.conflicts.length > 0) {
    const stopped = applyConflicted(
      {
        ...repo,
        operation: { type: 'merge', theirs, message: options.message?.trim() || defaultMessage },
      },
      carried,
      result.conflicts,
    )
    return {
      repo: stopped,
      output: [
        ...conflictLines(result.conflicts),
        '自動マージに失敗しました。コンフリクトを解消してから結果をコミットしてください。',
        '(ファイルを編集して git add し、git commit を実行します。中止するには git merge --abort)',
      ].join('\n'),
    }
  }

  const merged: Repo = { ...repo, ...carried }
  const pending: PendingCommit = {
    parents: [ours, theirs],
    tree: result.tree,
    reflogMessage: `${options.reflogAction ?? `merge ${ref}`}: Merge made by the 'ort' strategy.`,
  }
  const message = options.message?.trim()
  if (message || options.noEdit) {
    const created = createCommit(merged, pending, message || defaultMessage)
    return { repo: created.repo, output: `Merge made by the 'ort' strategy.\n${created.output}` }
  }
  const editor: Editor = {
    file: 'MERGE_MSG',
    text: messageTemplate(
      merged,
      defaultMessage,
      'マージする理由を説明してください (特に、更新された上流をトピックブランチにマージする場合)。',
    ),
    after: { kind: 'commit', commit: pending, operation: null },
  }
  return { repo: openEditor(merged, editor), output: EDITOR_WAITING }
}

// ---- cherry-pick / revert / rebase ----

const STOP_HINTS: Readonly<Record<SequenceType, string>> = {
  'cherry-pick':
    'コンフリクトを解消して git add し、git cherry-pick --continue で続けてください。\n' +
    '(飛ばすには git cherry-pick --skip、中止するには git cherry-pick --abort)',
  revert:
    'コンフリクトを解消して git add し、git revert --continue で続けてください。\n' +
    '(飛ばすには git revert --skip、中止するには git revert --abort)',
  rebase:
    'コンフリクトを解消して git add し、git rebase --continue で続けてください。\n' +
    '(飛ばすには git rebase --skip、中止して元に戻すには git rebase --abort)',
}

const EDIT_STOP = [
  'git commit --amend でコミットを修正できます。',
  '修正が終わったら git rebase --continue を実行してください。',
]

function mergeCommitError(id: CommitId): GitError {
  return new GitError(
    `error: コミット ${id} はマージコミットですが、-m オプションが指定されていません。\n` +
      '(-m 1 なら 1 番目の親、-m 2 なら 2 番目の親を基準に変更を取り出します)',
  )
}

/** 変更を取り出すときに基準にする親。マージコミットは -m で親を選ぶ必要がある。 */
function checkMainline(picked: Commit, mainline: number | null): void {
  if (mainline === null) {
    if (picked.parents.length > 1) throw mergeCommitError(picked.id)
    return
  }
  if (mainline < 1 || mainline > Math.max(1, picked.parents.length)) {
    throw new GitError(`error: コミット ${picked.id} には ${mainline} 番目の親がありません`)
  }
}

function parentTreeOf(repo: Repo, picked: Commit, mainline: number | null): Tree {
  const parent = picked.parents[(mainline ?? 1) - 1]
  return parent === undefined ? {} : getCommit(repo, parent).tree
}

/** squash のエディタに出す、まとめるコミットのメッセージ。 */
function squashTemplate(parts: readonly SquashPart[]): string {
  const lines = [`# これは ${parts.length} 個のコミットの組み合わせです。`]
  parts.forEach((part, index) => {
    if (part.skip) {
      lines.push(
        `# ${index + 1} 番目のコミットのメッセージはスキップされます:`,
        '#',
        ...part.message.split('\n').map((line) => `# ${line}`),
        '',
      )
    } else {
      lines.push(`# ${index + 1} 番目のコミットのメッセージ:`, '', part.message, '')
    }
  })
  return lines.join('\n')
}

type Step =
  | {
      readonly status: 'continue'
      readonly repo: Repo
      readonly op: SequenceOperation
      readonly lines: readonly string[]
    }
  | { readonly status: 'stop'; readonly repo: Repo; readonly lines: readonly string[] }

function waitForEditor(repo: Repo, stoppedOp: SequenceOperation, editor: Editor): Step {
  return {
    status: 'stop',
    repo: openEditor({ ...repo, operation: stoppedOp }, editor),
    lines: [EDITOR_WAITING],
  }
}

/**
 * 適用した結果の tree で、todo の 1 項目を確定させる。op.todo はこの項目より後ろの残り。
 * pick はそのままコミットし、reword・squash の最後・--continue のあと・revert (既定) ではエディタを開く。
 */
function completeItem(
  repo: Repo,
  op: SequenceOperation,
  item: PickItem,
  tree: Tree,
  fromContinue: boolean,
): Step {
  const picked = getCommit(repo, item.id)
  const head = getCommit(repo, headCommitId(repo))
  const stoppedOp: SequenceOperation = { ...op, current: item }

  if (item.action === 'squash' || item.action === 'fixup') {
    const parts: SquashPart[] = [
      ...(op.squash ?? [{ message: head.message, skip: false }]),
      { message: picked.message, skip: item.action === 'fixup' },
    ]
    // まとめた結果は、直前のコミットを置き換える
    const pending: PendingCommit = { parents: head.parents, tree, reflogAction: `rebase (${item.action})` }
    const next = op.todo[0]
    if (next?.action === 'squash' || next?.action === 'fixup') {
      const kept = parts.filter((part) => !part.skip).map((part) => part.message)
      const created = createCommit(repo, pending, kept.join('\n\n'))
      return { status: 'continue', repo: created.repo, op: { ...op, current: null, squash: parts }, lines: [] }
    }
    const nextOp: SequenceOperation = { ...op, current: null, squash: null }
    if (parts.every((part, index) => index === 0 || part.skip)) {
      const created = createCommit(repo, pending, parts[0]?.message ?? head.message)
      return { status: 'continue', repo: created.repo, op: nextOp, lines: [] }
    }
    return waitForEditor(repo, stoppedOp, {
      file: 'COMMIT_EDITMSG',
      text: `${squashTemplate(parts)}\n${messageTemplate({ ...repo, index: tree }, '').trimStart()}`,
      after: { kind: 'sequence', commit: pending, operation: nextOp },
    })
  }

  const pending: PendingCommit = {
    parents: [head.id],
    tree,
    ...(op.type === 'revert' ? { reverts: picked.id } : { source: picked.source ?? picked.id }),
    reflogAction: op.type === 'rebase' ? `rebase (${item.action})` : op.type,
  }
  const message = op.type === 'revert' ? revertMessage(picked, op.mainline) : picked.message
  const nextOp: SequenceOperation = { ...op, current: null }

  if (item.action === 'reword' || fromContinue || op.edit) {
    return waitForEditor(repo, stoppedOp, {
      file: 'COMMIT_EDITMSG',
      text: messageTemplate({ ...repo, index: tree }, message),
      after: { kind: 'sequence', commit: pending, operation: nextOp, stop: item.action === 'edit' },
    })
  }

  const created = createCommit(repo, pending, message)
  if (item.action === 'edit') {
    return {
      status: 'stop',
      repo: { ...created.repo, operation: nextOp },
      lines: [created.output, `${picked.id} (${subject(picked.message)}) で停止しました`, ...EDIT_STOP],
    }
  }
  return { status: 'continue', repo: created.repo, op: nextOp, lines: [created.output] }
}

/** todo の先頭の項目を HEAD に適用する (revert なら逆向きに)。 */
function applyItem(repo: Repo, op: SequenceOperation, todoItem: TodoItem): Step {
  if (todoItem.action === 'exec') {
    // exec はコマンドを実行する層 (commands.ts) が実行して続ける。ここでは todo に残したまま止まる
    return { status: 'stop', repo: { ...repo, operation: op }, lines: [] }
  }
  if (todoItem.action === 'break') {
    const head = getCommit(repo, headCommitId(repo))
    return {
      status: 'stop',
      repo: { ...repo, operation: { ...op, todo: op.todo.slice(1), current: null } },
      lines: [`${head.id} (${subject(head.message)}) で停止しました (break)`, '続けるには git rebase --continue を実行してください。'],
    }
  }
  const item = todoItem
  const picked = getCommit(repo, item.id)
  checkMainline(picked, op.mainline)
  const headId = headCommitId(repo)
  const rest: SequenceOperation = { ...op, todo: op.todo.slice(1), current: null }

  // rebase で親が変わらないコミットは、作り直さずにそのまま使う (Git と同じ fast-forward)
  if (
    op.type === 'rebase' &&
    (item.action === 'pick' || item.action === 'edit') &&
    picked.parents[0] === headId
  ) {
    // 追跡していないファイルは、ほかの経路と同じく残す
    const moved: Repo = logRefs(
      repo,
      { ...repo, head: { type: 'detached', id: picked.id }, ...carryChanges(repo, picked.tree, 'rebase') },
      `rebase (${item.action}): ${subject(picked.message)}`,
    )
    if (item.action === 'edit') {
      return {
        status: 'stop',
        repo: { ...moved, operation: rest },
        lines: [`${picked.id} (${subject(picked.message)}) で停止しました`, ...EDIT_STOP],
      }
    }
    return { status: 'continue', repo: moved, op: rest, lines: [] }
  }

  const parentTree = parentTreeOf(repo, picked, op.mainline)
  const [base, theirs] = op.type === 'revert' ? [picked.tree, parentTree] : [parentTree, picked.tree]
  const label =
    op.type === 'revert'
      ? `parent of ${item.id} (${subject(picked.message)})`
      : `${item.id} (${subject(picked.message)})`
  const ours = headTree(repo)
  const result = mergeTrees(base, ours, theirs, { ours: 'HEAD', theirs: label })
  const carried = carryChanges(repo, result.tree, op.type)
  const stoppedOp: SequenceOperation = { ...rest, current: item }

  if (result.conflicts.length > 0) {
    return {
      status: 'stop',
      repo: { ...applyConflicted(repo, carried, result.conflicts), operation: stoppedOp },
      lines: [
        ...conflictLines(result.conflicts),
        `error: ${item.id} (${subject(picked.message)}) を適用できませんでした`,
        STOP_HINTS[op.type],
      ],
    }
  }

  const squashing = item.action === 'squash' || item.action === 'fixup'
  const originallyEmpty = treesEqual(picked.tree, parentTree)
  if (treesEqual(result.tree, ours) && !squashing && !(op.keepEmpty && originallyEmpty)) {
    if (op.type === 'rebase') {
      return {
        status: 'continue',
        repo,
        op: rest,
        lines: [`${item.id} の変更はすでに含まれているため、取り除きました`],
      }
    }
    return {
      status: 'stop',
      repo: { ...repo, operation: stoppedOp },
      lines: [
        `${item.id} の変更はすでに含まれているため、コミットが空になります。`,
        `git ${op.type} --skip で飛ばすか、git commit --allow-empty で空のコミットを作ってください`,
      ],
    }
  }
  return completeItem({ ...repo, ...carried }, rest, item, result.tree, false)
}

/** todo の項目を順に適用する。コンフリクト・エディタ・edit で止まる。 */
function runSequence(repo: Repo, op: SequenceOperation, lines: string[]): OperationResult {
  let current: Repo = { ...repo, operation: null }
  let state = op
  while (state.todo.length > 0) {
    const step = applyItem(current, state, state.todo[0] as TodoItem)
    lines.push(...step.lines)
    if (step.status === 'stop') return { repo: step.repo, output: lines.join('\n') }
    current = step.repo
    state = step.op
  }
  return finishSequence(current, state, lines)
}

function finishSequence(repo: Repo, op: SequenceOperation, lines: string[]): OperationResult {
  if (op.type !== 'rebase') {
    return { repo: { ...repo, operation: null }, output: lines.join('\n') }
  }
  const tip = headCommitId(repo)
  if (op.branch === null) {
    lines.push('Successfully rebased (detached HEAD)')
    return { repo: { ...repo, operation: null }, output: lines.join('\n') }
  }
  lines.push(`Successfully rebased and updated refs/heads/${op.branch}.`)
  // reflog: まずブランチを付け替え、次に HEAD をブランチに戻す (Git と同じく 2 行に分けて記録する)
  const moved = logRefs(
    repo,
    { ...repo, operation: null, branches: { ...repo.branches, [op.branch]: tip } },
    `rebase (finish): refs/heads/${op.branch} onto ${tip}`,
  )
  return {
    repo: logRefs(moved, { ...moved, head: { type: 'branch', name: op.branch } }, `rebase (finish): returning to refs/heads/${op.branch}`, {
      forceHead: true,
    }),
    output: lines.join('\n'),
  }
}

function startPicks(
  repo: Repo,
  type: 'cherry-pick' | 'revert',
  refs: readonly string[],
  options: { readonly keepEmpty: boolean; readonly edit: boolean; readonly mainline: number | null },
): OperationResult {
  requireNoOperation(repo)
  if (refs.length === 0) {
    throw new GitError(`使い方: git ${type} <コミット>...`)
  }
  const ids = refs.map((ref) => resolveRef(repo, ref))
  for (const id of ids) checkMainline(getCommit(repo, id), options.mainline)
  return runSequence(
    repo,
    {
      type,
      current: null,
      todo: ids.map((id): PickItem => ({ action: 'pick', id })),
      origHead: headCommitId(repo),
      branch: currentBranch(repo),
      keepEmpty: options.keepEmpty,
      edit: options.edit,
      squash: null,
      mainline: options.mainline,
    },
    [],
  )
}

/** git cherry-pick: 指定したコミットの変更を、新しいコミットとして HEAD の上に複製する。 */
export function cherryPick(
  repo: Repo,
  refs: readonly string[],
  options: { readonly allowEmpty?: boolean; readonly edit?: boolean; readonly mainline?: number } = {},
): OperationResult {
  return startPicks(repo, 'cherry-pick', refs, {
    keepEmpty: options.allowEmpty ?? false,
    edit: options.edit ?? false,
    mainline: options.mainline ?? null,
  })
}

/** git revert: 指定したコミットの変更を打ち消す新しいコミットを作る。既定ではエディタでメッセージを編集する。 */
export function revert(
  repo: Repo,
  refs: readonly string[],
  options: { readonly noEdit?: boolean; readonly mainline?: number } = {},
): OperationResult {
  return startPicks(repo, 'revert', refs, {
    keepEmpty: false,
    edit: !options.noEdit,
    mainline: options.mainline ?? null,
  })
}

/** HEAD にあって upstream にないコミットを、古いものから順に並べる (マージコミットは除く)。 */
function commitsToReplay(repo: Repo, head: CommitId, upstream: CommitId): CommitId[] {
  const exclude = ancestors(repo.commits, upstream)
  const order: CommitId[] = []
  const visited = new Set<CommitId>()
  const visit = (id: CommitId) => {
    if (visited.has(id) || exclude.has(id)) return
    visited.add(id)
    for (const parent of getCommit(repo, id).parents) visit(parent)
    order.push(id)
  }
  visit(head)
  return order.filter((id) => getCommit(repo, id).parents.length <= 1)
}

function requireCleanForRebase(repo: Repo): void {
  if (hasTrackedChanges(repo)) {
    throw new GitError(
      'error: リベースできません: コミットしていない変更があります。\n' +
        '変更をコミットするか restore で取り消してください。',
    )
  }
}

/** rebase を始める。HEAD を onto に切り離し、最後にブランチを付け替える。 */
function startRebase(
  repo: Repo,
  onto: CommitId,
  origHead: CommitId,
  branch: string | null,
  items: readonly TodoItem[],
): OperationResult {
  const tree = getCommit(repo, onto).tree
  const { index, workdir } = carryChanges({ ...repo, editor: null }, tree, 'rebase')
  const detached: Repo = logRefs(
    repo,
    { ...repo, head: { type: 'detached', id: onto }, index, workdir, editor: null },
    `rebase (start): checkout ${onto}`,
    { forceHead: true },
  )
  return runSequence(
    detached,
    {
      type: 'rebase',
      current: null,
      todo: items,
      origHead,
      branch,
      keepEmpty: true,
      edit: false,
      squash: null,
      mainline: null,
    },
    [],
  )
}

/** 各コミットの後ろに exec の行を入れる (git rebase -x)。 */
function withExec(items: readonly TodoItem[], command: string | undefined): TodoItem[] {
  if (command === undefined) return [...items]
  return items.flatMap((item): TodoItem[] => [item, { action: 'exec', command }])
}

export interface RebaseOptions {
  /** -x / --exec: 各コミットを適用したあとに実行するコマンド。 */
  readonly exec?: string
}

/** git rebase <upstream>: 現在のブランチのコミットを upstream の先に付け替える。 */
export function rebase(repo: Repo, upstreamRef: string, options: RebaseOptions = {}): OperationResult {
  requireNoOperation(repo)
  requireCleanForRebase(repo)
  const upstream = resolveRef(repo, upstreamRef)
  const head = headCommitId(repo)
  const branch = currentBranch(repo)

  if (isAncestor(repo, upstream, head) && options.exec === undefined) {
    return { repo, output: `Current branch ${branch ?? 'HEAD'} is up to date.` }
  }
  if (isAncestor(repo, head, upstream) && head !== upstream) {
    const tree = getCommit(repo, upstream).tree
    const { index, workdir } = carryChanges(repo, tree, 'rebase')
    const moved: Repo =
      branch === null
        ? { ...repo, head: { type: 'detached', id: upstream } }
        : { ...repo, branches: { ...repo.branches, [branch]: upstream } }
    return {
      repo: logRefs(repo, { ...moved, index, workdir }, `rebase (finish): ${branch === null ? 'HEAD' : `refs/heads/${branch}`} onto ${upstream}`),
      output: `Fast-forwarded ${branch ?? 'HEAD'} to ${upstreamRef}.`,
    }
  }
  const items = commitsToReplay(repo, head, upstream).map((id): TodoItem => ({ action: 'pick', id }))
  return startRebase(repo, upstream, head, branch, withExec(items, options.exec))
}

const TODO_HELP = [
  '# コマンド:',
  '# p, pick <コミット> = コミットをそのまま使う',
  '# r, reword <コミット> = コミットを使うが、メッセージを編集する',
  '# e, edit <コミット> = コミットを使うが、修正のために止まる',
  '# s, squash <コミット> = コミットを使うが、直前のコミットにまとめる',
  '# f, fixup <コミット> = squash と同じだが、このコミットのメッセージは捨てる',
  '# d, drop <コミット> = コミットを取り除く',
  '# x, exec <コマンド> = コマンドを実行する (失敗したらそこで止まる)',
  '# b, break = ここで止まる (git rebase --continue で続ける)',
  '#',
  '# 行は並べ替えられます。上から順に実行されます。',
  '# 行を消すと、そのコミットは失われます。',
  '# すべての行を消すと、rebase は中止されます。',
]

/** git rebase -i <upstream>: todo をエディタで編集してから rebase する。 */
export function rebaseInteractive(
  repo: Repo,
  upstreamRef: string,
  options: RebaseOptions = {},
): OperationResult {
  requireNoOperation(repo)
  requireCleanForRebase(repo)
  const onto = resolveRef(repo, upstreamRef)
  const head = headCommitId(repo)
  const commits = commitsToReplay(repo, head, onto)
  const lines =
    commits.length === 0
      ? ['noop']
      : commits.flatMap((id) => [
          `pick ${id} ${subject(getCommit(repo, id).message)}`,
          ...(options.exec === undefined ? [] : [`exec ${options.exec}`]),
        ])
  const editor: Editor = {
    file: 'git-rebase-todo',
    text: [
      ...lines,
      '',
      `# ${onto}..${head} を ${onto} の上にリベースします (${commits.length} 個のコマンド)`,
      '#',
      ...TODO_HELP,
      '',
    ].join('\n'),
    after: { kind: 'todo', onto, origHead: head, branch: currentBranch(repo), commits },
  }
  return { repo: openEditor(repo, editor), output: EDITOR_WAITING }
}

const TODO_ACTIONS: Readonly<Record<string, TodoAction | 'drop' | 'exec' | 'break'>> = {
  x: 'exec',
  exec: 'exec',
  b: 'break',
  break: 'break',
  p: 'pick',
  pick: 'pick',
  r: 'reword',
  reword: 'reword',
  e: 'edit',
  edit: 'edit',
  s: 'squash',
  squash: 'squash',
  f: 'fixup',
  fixup: 'fixup',
  d: 'drop',
  drop: 'drop',
}

/** 編集した todo を読む。書き方が正しくなければ GitError。 */
export function parseTodo(repo: Repo, text: string): TodoItem[] {
  const items: TodoItem[] = []
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim()
    if (line === '' || line.startsWith('#') || line === 'noop') return
    const [word = '', ref] = line.split(/\s+/)
    const action = TODO_ACTIONS[word]
    if (action === undefined) {
      throw new GitError(`error: ${index + 1} 行目のコマンド '${word}' はわかりません: ${line}`)
    }
    if (action === 'break') {
      items.push({ action })
      return
    }
    if (action === 'exec') {
      const command = line.slice(word.length).trim()
      if (command === '') throw new GitError(`error: ${index + 1} 行目に実行するコマンドがありません`)
      items.push({ action, command })
      return
    }
    if (ref === undefined) {
      throw new GitError(`error: ${index + 1} 行目にコミットがありません: ${line}`)
    }
    const id = resolveRef(repo, ref)
    if (getCommit(repo, id).parents.length > 1) throw mergeCommitError(id)
    if (action === 'drop') return
    if ((action === 'squash' || action === 'fixup') && items.length === 0) {
      throw new GitError(`error: 直前のコミットがないので '${action}' できません`)
    }
    items.push({ action, id })
  })
  return items
}

// ---- エディタを閉じたあと ----

/**
 * エディタを保存して閉じる。text は保存した内容 (省略すると開いたときのまま)。
 * 待っていた処理 (コミットの作成、rebase の続きなど) を実行する。
 */
export function saveEditor(repo: Repo, text?: string): OperationResult {
  const editor = repo.editor
  if (!editor) throw new GitError('エディタは開いていません')
  const content = text ?? editor.text
  const after = editor.after

  if (after.kind === 'tag') {
    return finishTag({ ...repo, editor: null }, after.name, after.target, content)
  }

  if (after.kind === 'todo') {
    const items = parseTodo(repo, content)
    if (items.length === 0) {
      return { repo: { ...repo, editor: null }, output: 'Nothing to do (todo が空のため、rebase を中止しました)' }
    }
    return startRebase(repo, after.onto, after.origHead, after.branch, items)
  }

  const message = cleanupMessage(content)
  const closed: Repo = { ...repo, editor: null }
  if (message === '') {
    // コミットは作らずに止まる。シーケンスの途中なら --continue でやり直せる
    return {
      repo: closed,
      output: 'メッセージが空のため、コミットを中止しました (Aborting commit due to empty commit message.)',
    }
  }
  const created = createCommit(closed, after.commit, message)
  if (after.kind === 'commit') {
    return { repo: { ...created.repo, operation: after.operation }, output: created.output }
  }
  if (after.stop) {
    return {
      repo: { ...created.repo, operation: after.operation },
      output: [created.output, ...EDIT_STOP].join('\n'),
    }
  }
  return runSequence(created.repo, after.operation, [created.output])
}

// ---- --continue / --abort / --skip ----

function requireOperation(repo: Repo, type: Operation['type']): Operation {
  const op = repo.operation
  if (op?.type !== type) {
    throw new GitError(`error: 進行中の ${type} はありません`)
  }
  return op
}

export function continueOperation(repo: Repo, type: Operation['type']): OperationResult {
  const op = requireOperation(repo, type)
  requireNoConflicts(repo)
  if (op.type === 'merge') return commit(repo)
  if (op.current === null) {
    if (hasTrackedChanges(repo)) {
      throw new GitError(
        'error: コミットしていない変更があります。git commit --amend でコミットに含めるか、restore で取り消してください',
      )
    }
    return runSequence(repo, op, [])
  }

  const item = op.current
  const rest: SequenceOperation = { ...op, current: null }
  const squashing = item.action === 'squash' || item.action === 'fixup'
  if (treesEqual(repo.index, headTree(repo)) && !squashing) {
    if (op.type !== 'rebase') {
      throw new GitError(
        `${item.id} の変更はすでに含まれているため、コミットが空になります。\n` +
          `git ${op.type} --skip で飛ばしてください`,
      )
    }
    return runSequence(repo, rest, [`${item.id} の変更が空になったため、取り除きました`])
  }
  const step = completeItem({ ...repo, operation: null }, rest, item, repo.index, true)
  if (step.status === 'stop') return { repo: step.repo, output: step.lines.join('\n') }
  return runSequence(step.repo, step.op, [...step.lines])
}

export function skipOperation(repo: Repo, type: SequenceType): OperationResult {
  const op = requireOperation(repo, type) as SequenceOperation
  const tree = headTree(repo)
  const cleaned: Repo = { ...repo, index: tree, workdir: tree, conflicts: [] }
  return runSequence(
    cleaned,
    { ...op, current: null, squash: null },
    op.current === null ? [] : [`${op.current.id} を飛ばしました`],
  )
}

export function abortOperation(repo: Repo, type: Operation['type']): OperationResult {
  const op = requireOperation(repo, type)
  if (op.type === 'merge') {
    const tree = headTree(repo)
    return {
      repo: { ...repo, operation: null, conflicts: [], index: tree, workdir: tree },
      output: 'マージを中止しました',
    }
  }
  const tree = getCommit(repo, op.origHead).tree
  const restored: Repo =
    op.branch === null
      ? { ...repo, head: { type: 'detached', id: op.origHead } }
      : {
          ...repo,
          head: { type: 'branch', name: op.branch },
          branches: { ...repo.branches, [op.branch]: op.origHead },
        }
  const where = op.branch === null ? op.origHead : `refs/heads/${op.branch}`
  return {
    repo: logRefs(
      repo,
      { ...restored, operation: null, conflicts: [], index: tree, workdir: tree },
      `${type} (abort): returning to ${where}`,
      { forceHead: true },
    ),
    output: `${type} を中止し、${op.origHead} に戻しました`,
  }
}
