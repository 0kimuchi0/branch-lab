/**
 * 履歴を組み替える操作 (merge・cherry-pick・revert・rebase・rebase -i) と、
 * コンフリクトで止まったときの --continue / --abort / --skip、エディタを閉じたあとの続き。
 */
import { finishHunkEdit } from './hunks'
import {
  EDITOR_WAITING,
  GitError,
  keepUntracked,
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
  joinNames,
  logRefs,
  mergeBase,
  mergeItemMessage,
  mergeTarget,
  messageTemplate,
  openEditor,
  requireNoConflicts,
  requireNoOperation,
  resolveRef,
  revertMessage,
  subject,
  type Commit,
  type CommitId,
  type AmOperation,
  type Editor,
  type MergeItem,
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
import { rerereClear, rerereOnConflict } from './rerere'
import { finishNote } from './notes'
import { finishTag } from './tag'
import { mergeTrees, treesEqual, withFile, type Conflict, type Tree } from './tree'

/**
 * コンフリクトで止まった状態にする。作業ディレクトリにはマーカー付きの内容を、
 * ステージのコンフリクトしたファイルには HEAD 側の内容を置く。
 * lines は、コンフリクトの一覧と rerere の出力 (rerere.enabled のとき)。
 */
function applyConflicted(
  repo: Repo,
  carried: { readonly index: Tree; readonly workdir: Tree },
  conflicts: readonly Conflict[],
): { repo: Repo; lines: string[] } {
  const head = headTree(repo)
  let index = carried.index
  for (const conflict of conflicts) index = withFile(index, conflict.path, head[conflict.path])
  const recorded = rerereOnConflict({ ...repo, index, workdir: carried.workdir, conflicts })
  return { repo: recorded.repo, lines: [...conflictLines(conflicts), ...recorded.lines] }
}

function conflictLines(conflicts: readonly Conflict[]): string[] {
  return conflicts.map((conflict) =>
    conflict.kind === 'deleted-by-us' || conflict.kind === 'deleted-by-them'
      ? `CONFLICT (modify/delete): ${conflict.path} は片方で削除され、もう片方で変更されています`
      : `CONFLICT (content): ${conflict.path} でマージのコンフリクトが発生しました`,
  )
}

// ---- merge ----

/**
 * マージコミットの既定のメッセージ。Git と同じく、ブランチ・タグ・リモート追跡ブランチ・コミットに分けて並べる
 * (例: Merge branches 'a' and 'b', tag 'v1' and commit 'C3' into topic)。
 */
export function mergeMessage(repo: Repo, refs: string | readonly string[]): string {
  const list = typeof refs === 'string' ? [refs] : refs
  // FETCH_HEAD は、fetch したときの説明 (branch 'main' of <URL>) を使う (Git と同じ)
  if (list.length === 1 && list[0] === 'FETCH_HEAD' && repo.fetchHead !== null) {
    const current = currentBranch(repo)
    return `Merge ${repo.fetchHead.description}${current === null || current === 'main' ? '' : ` into ${current}`}`
  }
  const groups: Array<[string, string, string[]]> = [
    ['branch', 'branches', []],
    ['tag', 'tags', []],
    ['remote-tracking branch', 'remote-tracking branches', []],
    ['commit', 'commits', []],
  ]
  for (const ref of list) {
    const kind =
      ref in repo.branches ? 0
      : ref in repo.tags ? 1
      : ref in repo.remoteBranches ? 2
      : 3
    ;(groups[kind] as [string, string, string[]])[2].push(`'${ref}'`)
  }
  const parts = groups
    .filter(([, , names]) => names.length > 0)
    .map(([one, many, names]) => `${names.length > 1 ? many : one} ${joinNames(names)}`)
  const current = currentBranch(repo)
  const into = current === null || current === 'main' ? '' : ` into ${current}`
  return `Merge ${joinNames(parts)}${into}`
}

export type MergeStrategy = 'ort' | 'ours' | 'octopus'

/** -s で指定したストラテジーの名前を、このアプリで扱う名前にする (recursive・resolve は ort と同じに扱う)。 */
export function parseStrategy(name: string): MergeStrategy {
  if (name === 'ort' || name === 'recursive' || name === 'resolve') return 'ort'
  if (name === 'ours' || name === 'octopus') return name
  if (name === 'subtree') throw new GitError('subtree ストラテジーはこのアプリでは未対応です')
  throw new GitError(
    `Could not find merge strategy '${name}'.\nAvailable strategies are: octopus ours recursive resolve subtree.`,
  )
}

/** -X で指定したオプション。このアプリでは ours と theirs に対応する。 */
export function parseStrategyOption(name: string): 'ours' | 'theirs' {
  if (name === 'ours' || name === 'theirs') return name
  throw new GitError(`error: 未対応のストラテジーのオプションです: -X ${name} (ours か theirs が使えます)`)
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
  /** -s: マージのストラテジー。 */
  readonly strategy?: MergeStrategy
  /** -X ours / -X theirs */
  readonly favor?: 'ours' | 'theirs'
  /** --allow-unrelated-histories: 共通の祖先のない履歴どうしのマージを許す。 */
  readonly allowUnrelated?: boolean
}

/** id と、すでにマージしたコミットたちとの共通の祖先のうち、いちばん新しいもの。 */
function bestMergeBase(repo: Repo, id: CommitId, merged: readonly CommitId[]): CommitId | null {
  const candidates = merged.map((other) => mergeBase(repo, id, other)).filter((base): base is CommitId => base !== null)
  return candidates.find((base) => candidates.every((other) => other === base || !isAncestor(repo, base, other))) ?? null
}

/**
 * first の tree に heads を順にマージする (octopus)。コンフリクトが出たところで止める。
 * 2 つ目以降の基準 (merge base) は、それまでにマージしたコミットとの共通の祖先にする。
 */
function mergeHeadTrees(
  repo: Repo,
  first: CommitId,
  tree: Tree,
  heads: ReadonlyArray<{ readonly id: CommitId; readonly label: string }>,
  favor: 'ours' | 'theirs' | undefined,
): { readonly tree: Tree; readonly conflicts: readonly Conflict[]; readonly failed: string | null } {
  let current = tree
  const merged = [first]
  for (const head of heads) {
    const baseId = bestMergeBase(repo, head.id, merged)
    const result = mergeTrees(baseId === null ? {} : getCommit(repo, baseId).tree, current, getCommit(repo, head.id).tree, {
      ours: 'HEAD',
      theirs: head.label,
      ...(favor ? { favor } : {}),
    })
    if (result.conflicts.length > 0) return { tree: result.tree, conflicts: result.conflicts, failed: head.label }
    current = result.tree
    merged.push(head.id)
  }
  return { tree: current, conflicts: [], failed: null }
}

/** マージコミットを作る (-m / --no-edit ならそのまま、そうでなければエディタを開く)。 */
function finishMerge(
  merged: Repo,
  pending: PendingCommit,
  defaultMessage: string,
  options: MergeOptions,
  lines: readonly string[],
): OperationResult {
  const message = options.message?.trim()
  if (message || options.noEdit) {
    const created = createCommit(merged, pending, message || defaultMessage)
    return { repo: created.repo, output: [...lines, created.output].join('\n') }
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
  return { repo: openEditor(merged, editor), output: [...lines.slice(0, -1), EDITOR_WAITING].join('\n') }
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

  // -s ours は相手の変更を一切取り込まず、履歴だけをマージする
  const strategy = options.strategy === 'ours' ? 'ours' : 'ort'
  const baseId = mergeBase(repo, ours, theirs)
  if (baseId === null && !options.allowUnrelated) throw new GitError('fatal: refusing to merge unrelated histories')
  const baseTree = baseId === null ? {} : getCommit(repo, baseId).tree
  const result =
    strategy === 'ours'
      ? { tree: headTree(repo), conflicts: [] }
      : mergeTrees(baseTree, headTree(repo), getCommit(repo, theirs).tree, {
          ours: 'HEAD',
          theirs: ref,
          ...(options.favor ? { favor: options.favor } : {}),
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
      repo: stopped.repo,
      output: [
        ...stopped.lines,
        '自動マージに失敗しました。コンフリクトを解消してから結果をコミットしてください。',
        '(ファイルを編集して git add し、git commit を実行します。中止するには git merge --abort)',
      ].join('\n'),
    }
  }

  const pending: PendingCommit = {
    parents: [ours, theirs],
    tree: result.tree,
    reflogMessage: `${options.reflogAction ?? `merge ${ref}`}: Merge made by the '${strategy}' strategy.`,
  }
  return finishMerge({ ...repo, ...carried }, pending, defaultMessage, options, [
    `Merge made by the '${strategy}' strategy.`,
  ])
}

/**
 * git merge <ブランチ>...: 2 つ以上を指定すると octopus でまとめてマージする。
 * Git と同じく、コンフリクトが出る octopus は中止し、何も変えない。
 */
export function mergeMany(repo: Repo, refs: readonly string[], options: MergeOptions = {}): OperationResult {
  if (refs.length === 0) throw new GitError('使い方: git merge <ブランチ>...')
  if (refs.length === 1) return merge(repo, refs[0] as string, options)
  requireNoOperation(repo)
  if (options.strategy === 'ort') {
    throw new GitError('fatal: ort (recursive) ストラテジーは 2 つ以上のブランチを一度にマージできません (octopus か ours を使ってください)')
  }
  const ours = headCommitId(repo)
  const lines: string[] = []
  const heads: Array<{ readonly ref: string; readonly id: CommitId }> = []
  for (const ref of refs) {
    const id = resolveRef(repo, ref)
    if (isAncestor(repo, id, ours) || heads.some((head) => isAncestor(repo, id, head.id))) {
      lines.push(`Already up to date with ${ref}`)
      continue
    }
    heads.push({ ref, id })
  }
  // ほかのブランチの祖先になっているものは親にしない (Git の reduce_heads)
  const reduced = heads.filter((head) => !heads.some((other) => other !== head && isAncestor(repo, head.id, other.id)))
  if (reduced.length === 0) return { repo, output: [...lines, 'Already up to date.'].join('\n') }
  if (reduced.length === 1) {
    const single = merge(repo, (reduced[0] as { ref: string }).ref, options)
    return { ...single, output: [...lines, single.output].join('\n') }
  }
  if (options.fastForwardOnly) {
    throw new GitError('fatal: fast-forward できないため、マージを中止しました')
  }

  const strategy = options.strategy === 'ours' ? 'ours' : 'octopus'
  // HEAD がどれかの祖先なら、fast-forward してそこからマージする (HEAD は親にしない)
  const keepHead = strategy === 'ours' || options.noFastForward || !reduced.some((head) => isAncestor(repo, ours, head.id))
  const first = keepHead ? ours : (reduced[0] as { id: CommitId }).id
  if (!keepHead) lines.push(`Fast-forwarding to: ${(reduced[0] as { ref: string }).ref}`)
  const rest = keepHead ? reduced : reduced.slice(1)
  let tree: Tree = keepHead ? headTree(repo) : getCommit(repo, first).tree
  if (strategy === 'octopus') {
    for (const head of rest) lines.push(`Trying simple merge with ${head.ref}`)
    const result = mergeHeadTrees(
      repo,
      first,
      tree,
      rest.map((head) => ({ id: head.id, label: head.ref })),
      options.favor,
    )
    if (result.failed !== null) {
      throw new GitError(
        [
          ...lines.slice(0, lines.length - rest.length + rest.findIndex((head) => head.ref === result.failed) + 1),
          'Simple merge did not work, trying automatic merge.',
          ...conflictLines(result.conflicts),
          'Automated merge did not work.',
          'Should not be doing an octopus.',
          'Merge with strategy octopus failed.',
        ].join('\n'),
      )
    }
    tree = result.tree
  }
  const carried = carryChanges(repo, tree, 'merge')
  const names = reduced.map((head) => head.ref)
  const pending: PendingCommit = {
    parents: [...(keepHead ? [ours] : []), ...reduced.map((head) => head.id)],
    tree,
    reflogMessage: `${options.reflogAction ?? `merge ${names.join(' ')}`}: Merge made by the '${strategy}' strategy.`,
  }
  return finishMerge({ ...repo, ...carried }, pending, options.defaultMessage ?? mergeMessage(repo, names), options, [
    ...lines,
    `Merge made by the '${strategy}' strategy.`,
  ])
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
  const rest: SequenceOperation = { ...op, todo: op.todo.slice(1), current: null }
  if (todoItem.action === 'label') {
    const labels = { ...op.labels, [todoItem.name]: headCommitId(repo) }
    return { status: 'continue', repo, op: { ...rest, labels }, lines: [] }
  }
  if (todoItem.action === 'reset') {
    const target = mergeTarget(repo, op, todoItem.target)
    const moved: Repo = logRefs(
      repo,
      { ...repo, head: { type: 'detached', id: target }, ...carryChanges(repo, getCommit(repo, target).tree, 'rebase') },
      `rebase (reset): '${todoItem.target}'`,
      { forceHead: true },
    )
    return { status: 'continue', repo: moved, op: rest, lines: [] }
  }
  if (todoItem.action === 'merge') return applyMerge(repo, rest, todoItem)
  const item = todoItem
  const picked = getCommit(repo, item.id)
  checkMainline(picked, op.mainline)
  const headId = headCommitId(repo)

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
  const result = mergeTrees(base, ours, theirs, { ours: 'HEAD', theirs: label, ...(op.favor ? { favor: op.favor } : {}) })
  const carried = carryChanges(repo, result.tree, op.type)
  const stoppedOp: SequenceOperation = { ...rest, current: item }

  if (result.conflicts.length > 0) {
    const stopped = applyConflicted(repo, carried, result.conflicts)
    return {
      status: 'stop',
      repo: { ...stopped.repo, operation: stoppedOp },
      lines: [
        ...stopped.lines,
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

/** マージコミットを作る前の情報 (親・tree・由来)。 */
function mergePending(repo: Repo, op: SequenceOperation, item: MergeItem, tree: Tree, action: string): PendingCommit {
  const original = item.id === null ? null : getCommit(repo, item.id)
  return {
    parents: [headCommitId(repo), ...item.labels.map((label) => mergeTarget(repo, op, label))],
    tree,
    ...(original ? { source: original.source ?? original.id } : {}),
    reflogAction: action,
  }
}

/** rebase --rebase-merges の merge の行: label の位置のコミットを HEAD にマージする (2 つ以上なら octopus)。 */
function applyMerge(repo: Repo, rest: SequenceOperation, item: MergeItem): Step {
  const ours = headCommitId(repo)
  const theirs = item.labels.map((label) => ({ id: mergeTarget(repo, rest, label), label }))
  const original = item.id === null ? null : getCommit(repo, item.id)
  const message = mergeItemMessage(repo, item)

  // 親が変わっていないマージコミットは、作り直さずにそのまま使う
  const parents = [ours, ...theirs.map((head) => head.id)]
  if (
    original &&
    !item.edit &&
    original.parents.length === parents.length &&
    original.parents.every((parent, index) => parent === parents[index])
  ) {
    const moved: Repo = logRefs(
      repo,
      { ...repo, head: { type: 'detached', id: original.id }, ...carryChanges(repo, original.tree, 'rebase') },
      `rebase (merge): ${subject(message)}`,
    )
    return { status: 'continue', repo: moved, op: rest, lines: [] }
  }

  const result = mergeHeadTrees(repo, ours, headTree(repo), theirs, rest.favor)
  const carried = carryChanges(repo, result.tree, 'rebase')
  const stoppedOp: SequenceOperation = { ...rest, current: item }
  if (result.conflicts.length > 0) {
    const stopped = applyConflicted(repo, carried, result.conflicts)
    return {
      status: 'stop',
      repo: { ...stopped.repo, operation: stoppedOp },
      lines: [
        ...stopped.lines,
        `error: ${item.labels.join(' ')} をマージできませんでした${original ? ` (${original.id} ${subject(original.message)})` : ''}`,
        STOP_HINTS.rebase,
      ],
    }
  }
  const merged: Repo = { ...repo, ...carried }
  const pending = mergePending(merged, rest, item, result.tree, 'rebase (merge)')
  if (item.edit || original === null) {
    return waitForEditor(merged, stoppedOp, {
      file: 'MERGE_MSG',
      text: messageTemplate(merged, message),
      after: { kind: 'sequence', commit: pending, operation: rest },
    })
  }
  const created = createCommit(merged, pending, message)
  return { status: 'continue', repo: created.repo, op: rest, lines: [created.output] }
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
  options: {
    readonly keepEmpty: boolean
    readonly edit: boolean
    readonly mainline: number | null
    readonly favor: 'ours' | 'theirs' | undefined
  },
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
      ...(options.favor ? { favor: options.favor } : {}),
    },
    [],
  )
}

/** git cherry-pick: 指定したコミットの変更を、新しいコミットとして HEAD の上に複製する。 */
export function cherryPick(
  repo: Repo,
  refs: readonly string[],
  options: {
    readonly allowEmpty?: boolean
    readonly edit?: boolean
    readonly mainline?: number
    readonly favor?: 'ours' | 'theirs'
  } = {},
): OperationResult {
  return startPicks(repo, 'cherry-pick', refs, {
    keepEmpty: options.allowEmpty ?? false,
    edit: options.edit ?? false,
    mainline: options.mainline ?? null,
    favor: options.favor,
  })
}

/** git revert: 指定したコミットの変更を打ち消す新しいコミットを作る。既定ではエディタでメッセージを編集する。 */
export function revert(
  repo: Repo,
  refs: readonly string[],
  options: { readonly noEdit?: boolean; readonly mainline?: number; readonly favor?: 'ours' | 'theirs' } = {},
): OperationResult {
  return startPicks(repo, 'revert', refs, {
    keepEmpty: false,
    edit: !options.noEdit,
    mainline: options.mainline ?? null,
    favor: options.favor,
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

/** label に使える名前にする (Git と同じく、使えない文字は - に置き換える)。 */
function labelName(text: string): string {
  return text.replace(/[^\w./-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'branch'
}

/**
 * git rebase --rebase-merges の todo。マージコミットも含めて、ブランチの形のまま作り直す。
 * 横のブランチを先に作って label を付け、最後に本流を作りながら merge する (Git の並べ方に合わせる)。
 */
function rebaseMergesTodo(repo: Repo, head: CommitId, upstream: CommitId): string[] {
  const exclude = ancestors(repo.commits, upstream)
  const order: CommitId[] = []
  const visited = new Set<CommitId>()
  const visit = (id: CommitId) => {
    if (visited.has(id) || exclude.has(id)) return
    visited.add(id)
    const [first, ...others] = getCommit(repo, id).parents
    for (const parent of others) visit(parent)
    if (first !== undefined) visit(first)
    order.push(id)
  }
  visit(head)

  // どこに label が要るか (横のブランチの先端と、reset で戻る先) を先に調べる
  const inSet = new Set(order)
  const baseOf = (id: CommitId): CommitId | 'onto' => {
    const first = getCommit(repo, id).parents[0]
    return first !== undefined && inSet.has(first) ? first : 'onto'
  }
  const needsLabel = new Map<CommitId, string>()
  const used = new Set(['onto'])
  const unique = (name: string) => {
    let candidate = name
    for (let n = 2; used.has(candidate); n++) candidate = `${name}-${n}`
    used.add(candidate)
    return candidate
  }
  let current: CommitId | 'onto' = 'onto'
  const resets = new Set<CommitId>()
  order.forEach((id, index) => {
    const base = baseOf(id)
    if (index === 0 || base !== current) resets.add(id)
    const commit = getCommit(repo, id)
    for (const parent of commit.parents.slice(1)) {
      if (inSet.has(parent) && !needsLabel.has(parent)) {
        const named = /^Merge (?:remote-tracking )?branch '([^']+)'/.exec(commit.message)?.[1]
        const branch = Object.keys(repo.branches).find((name) => repo.branches[name] === parent)
        needsLabel.set(parent, unique(labelName(named ?? branch ?? 'branch')))
      }
    }
    current = id
  })
  for (const id of resets) {
    const base = baseOf(id)
    if (base !== 'onto' && !needsLabel.has(base)) needsLabel.set(base, unique('branch-point'))
  }

  const lines = ['label onto']
  order.forEach((id) => {
    const commit = getCommit(repo, id)
    if (resets.has(id)) {
      // このブロックの最後が横のブランチの先端なら、その名前を見出しにする
      let last = order.indexOf(id)
      while (last + 1 < order.length && !resets.has(order[last + 1] as CommitId)) last++
      const end = order[last] as CommitId
      const tip = needsLabel.get(end)
      lines.push('', ...(tip !== undefined && end !== head ? [`# Branch: ${tip}`] : []))
      const base = baseOf(id)
      lines.push(
        base === 'onto' ? 'reset onto' : `reset ${needsLabel.get(base)} # ${subject(getCommit(repo, base).message)}`,
      )
    }
    if (commit.parents.length > 1) {
      const others = commit.parents.slice(1).map((parent) => needsLabel.get(parent) ?? parent)
      lines.push(`merge -C ${id} ${others.join(' ')} # ${subject(commit.message)}`)
    } else {
      lines.push(`pick ${id} ${subject(commit.message)}`)
    }
    const label = needsLabel.get(id)
    if (label !== undefined) lines.push(`label ${label}`)
  })
  return lines
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
  favor?: 'ours' | 'theirs',
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
      ...(favor ? { favor } : {}),
    },
    [],
  )
}

export interface RebaseOptions {
  /** -x / --exec: 各コミットを適用したあとに実行するコマンド。 */
  readonly exec?: string
  /** -r / --rebase-merges: マージコミットも作り直して、ブランチの形を保つ。 */
  readonly rebaseMerges?: boolean
  /** -X ours / -X theirs (rebase では ours が付け替え先、theirs が付け替えるコミット)。 */
  readonly favor?: 'ours' | 'theirs'
  /** --autosquash: fixup! / squash! で始まるコミットを、対象のコミットの直後に fixup / squash として並べる。 */
  readonly autosquash?: boolean
  /** --onto <コミット>: <upstream>..HEAD のコミットを、upstream ではなくこのコミットの上に付け替える。 */
  readonly onto?: string
}

/** --onto で、付け替えるコミットがすでに onto のすぐ上に並んでいるか。 */
function alreadyOnto(repo: Repo, head: CommitId, upstream: CommitId, onto: CommitId): boolean {
  const commits = commitsToReplay(repo, head, upstream)
  if (commits.length === 0) return head === onto
  return commits.every((id, index) => getCommit(repo, id).parents.length === 1 && getCommit(repo, id).parents[0] === (index === 0 ? onto : commits[index - 1]))
}

const AUTOSQUASH_PREFIX = /^(fixup|squash|amend)! /

/**
 * --autosquash の並べ替え。件名が "fixup! <件名>" のコミットを、その件名 (または ID) のコミットの直後に
 * fixup として移し、"squash! " なら squash にする。対象は todo でそれより前にあるコミットだけ。
 */
export function autosquashLines(repo: Repo, lines: readonly string[]): string[] {
  const picks = lines.map((line) => /^pick (\S+) /.exec(line)?.[1] ?? null)
  const subjects = picks.map((id) => (id === null ? '' : subject(getCommit(repo, id).message)))
  const followers = new Map<number, number[]>()
  const moved = new Set<number>()
  picks.forEach((id, index) => {
    const own = subjects[index] ?? ''
    if (id === null || !AUTOSQUASH_PREFIX.test(own)) return
    let target = own
    while (AUTOSQUASH_PREFIX.test(target)) target = target.replace(AUTOSQUASH_PREFIX, '')
    const candidates = picks.slice(0, index).map((other, i) => ({ other, i })).filter(({ other, i }) => other !== null && !moved.has(i))
    const found =
      candidates.find(({ i }) => subjects[i] === target) ??
      candidates.find(({ other }) => other === target) ??
      candidates.find(({ i }) => (subjects[i] ?? '').startsWith(target))
    if (!found) return
    moved.add(index)
    followers.set(found.i, [...(followers.get(found.i) ?? []), index])
  })
  const out: string[] = []
  // fixup! fixup! のように、移したコミットにさらに付くものも続けて並べる
  const emitFollowers = (index: number) => {
    for (const follower of followers.get(index) ?? []) {
      const action = (subjects[follower] ?? '').startsWith('squash! ') ? 'squash' : 'fixup'
      out.push((lines[follower] as string).replace(/^pick /, `${action} `))
      emitFollowers(follower)
    }
  }
  lines.forEach((line, index) => {
    if (moved.has(index)) return
    out.push(line)
    emitFollowers(index)
  })
  return out
}

/** rebase で実行する todo の行 (-i ではエディタに出す内容)。 */
function rebaseTodoLines(repo: Repo, head: CommitId, onto: CommitId, options: RebaseOptions): string[] {
  if (options.rebaseMerges) {
    const lines = rebaseMergesTodo(repo, head, onto)
    if (options.exec === undefined) return lines
    return lines.flatMap((line) => (/^(pick|merge) /.test(line) ? [line, `exec ${options.exec}`] : [line]))
  }
  const picks = commitsToReplay(repo, head, onto).map((id) => `pick ${id} ${subject(getCommit(repo, id).message)}`)
  const ordered = options.autosquash ? autosquashLines(repo, picks) : picks
  // exec は、fixup / squash でまとめるコミットの最後のあとに入れる
  return ordered.flatMap((line, index) => {
    const next = ordered[index + 1]
    const grouped = next !== undefined && /^(fixup|squash) /.test(next)
    return [line, ...(options.exec === undefined || grouped ? [] : [`exec ${options.exec}`])]
  })
}

/** git rebase <upstream>: 現在のブランチのコミットを upstream の先に付け替える。 */
export function rebase(repo: Repo, upstreamRef: string, options: RebaseOptions = {}): OperationResult {
  requireNoOperation(repo)
  requireCleanForRebase(repo)
  const upstream = resolveRef(repo, upstreamRef)
  const head = headCommitId(repo)
  const branch = currentBranch(repo)

  if (options.onto !== undefined) {
    // --onto: upstream..HEAD のコミットを onto の上に付け替える
    const onto = resolveRef(repo, options.onto)
    if (options.exec === undefined && !options.autosquash && alreadyOnto(repo, head, upstream, onto)) {
      return { repo, output: `Current branch ${branch ?? 'HEAD'} is up to date.` }
    }
    const items = parseTodo(repo, rebaseTodoLines(repo, head, upstream, options).join('\n'))
    return startRebase(repo, onto, head, branch, items, options.favor)
  }

  const reorders =
    options.autosquash === true &&
    commitsToReplay(repo, head, upstream).some((id) => AUTOSQUASH_PREFIX.test(subject(getCommit(repo, id).message)))
  if (isAncestor(repo, upstream, head) && options.exec === undefined && !reorders) {
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
  const items = parseTodo(repo, rebaseTodoLines(repo, head, upstream, options).join('\n'))
  return startRebase(repo, upstream, head, branch, items, options.favor)
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
  '# l, label <名前> = 今の HEAD に名前を付ける',
  '# t, reset <名前> = HEAD を名前の位置に戻す',
  '# m, merge [-C <コミット> | -c <コミット>] <名前> [# <件名>]',
  '#         名前の位置をマージする。-C なら元のコミットのメッセージを使い、',
  '#         -c なら、それをエディタで編集する。どちらもなければエディタを開く',
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
  const upstream = resolveRef(repo, upstreamRef)
  const onto = options.onto === undefined ? upstream : resolveRef(repo, options.onto)
  const head = headCommitId(repo)
  const commits = commitsToReplay(repo, head, upstream)
  const todo = rebaseTodoLines(repo, head, upstream, options)
  const lines = todo.length === 0 ? ['noop'] : todo
  const count = todo.filter((line) => line !== '' && !line.startsWith('#')).length
  const editor: Editor = {
    file: 'git-rebase-todo',
    text: [
      ...lines,
      '',
      `# ${upstream}..${head} を ${onto} の上にリベースします (${count} 個のコマンド)`,
      '#',
      ...TODO_HELP,
      '',
    ].join('\n'),
    after: {
      kind: 'todo',
      onto,
      origHead: head,
      branch: currentBranch(repo),
      commits,
      ...(options.favor ? { favor: options.favor } : {}),
    },
  }
  return { repo: openEditor(repo, editor), output: EDITOR_WAITING }
}

const TODO_ACTIONS: Readonly<
  Record<string, TodoAction | 'drop' | 'exec' | 'break' | 'label' | 'reset' | 'merge'>
> = {
  l: 'label',
  label: 'label',
  t: 'reset',
  reset: 'reset',
  m: 'merge',
  merge: 'merge',
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
  const labels = new Set<string>()
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
    // label・reset・merge の名前は、それより前の label で付けたものか、コミットを指す名前
    const target = (name: string | undefined): string => {
      if (name === undefined || name.startsWith('#')) {
        throw new GitError(`error: ${index + 1} 行目に名前がありません: ${line}`)
      }
      if (!labels.has(name)) {
        try {
          resolveRef(repo, name)
        } catch {
          throw new GitError(`error: ${index + 1} 行目の '${name}' が見つかりません (先に label で名前を付けてください)`)
        }
      }
      return name
    }
    if (action === 'label') {
      if (ref === undefined) throw new GitError(`error: ${index + 1} 行目に名前がありません: ${line}`)
      labels.add(ref)
      items.push({ action, name: ref })
      return
    }
    if (action === 'reset') {
      items.push({ action, target: target(ref) })
      return
    }
    if (action === 'merge') {
      const words = line.replace(/\s#.*$/, '').split(/\s+/).slice(1)
      const option = words[0] === '-C' || words[0] === '-c' ? words[0] : null
      const original = option === null ? null : words[1]
      const names = words.slice(option === null ? 0 : 2)
      if (original === undefined) throw new GitError(`error: ${index + 1} 行目に ${option} のコミットがありません`)
      if (names.length === 0) target(undefined)
      items.push({
        action,
        id: original === null ? null : resolveRef(repo, original),
        labels: names.map((name) => target(name)),
        edit: option !== '-C',
      })
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
  if (after.kind === 'note') return finishNote({ ...repo, editor: null }, after.target, content)
  if (after.kind === 'hunk') return finishHunkEdit({ ...repo, editor: null }, content)

  if (after.kind === 'todo') {
    const items = parseTodo(repo, content)
    if (items.length === 0) {
      return { repo: { ...repo, editor: null }, output: 'Nothing to do (todo が空のため、rebase を中止しました)' }
    }
    return startRebase(repo, after.onto, after.origHead, after.branch, items, after.favor)
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

/** merge・cherry-pick・revert・rebase (am は patch.ts で扱う)。 */
type HistoryOperationType = 'merge' | SequenceType

function requireOperation(repo: Repo, type: HistoryOperationType): Exclude<Operation, AmOperation> {
  const op = repo.operation
  if (op?.type !== type) {
    throw new GitError(`error: 進行中の ${type} はありません`)
  }
  return op as Exclude<Operation, AmOperation>
}

export function continueOperation(repo: Repo, type: HistoryOperationType): OperationResult {
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
  if (item.action === 'merge') {
    const pending = mergePending(repo, op, item, repo.index, 'rebase (continue)')
    const editor: Editor = {
      file: 'MERGE_MSG',
      text: messageTemplate(repo, mergeItemMessage(repo, item)),
      after: { kind: 'sequence', commit: pending, operation: rest },
    }
    return { repo: openEditor(repo, editor), output: EDITOR_WAITING }
  }
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
  const cleaned: Repo = { ...rerereClear(repo), index: tree, workdir: tree, conflicts: [] }
  return runSequence(
    cleaned,
    { ...op, current: null, squash: null },
    op.current === null ? [] : [`${op.current.action === 'merge' ? `merge ${op.current.labels.join(' ')}` : op.current.id} を飛ばしました`],
  )
}

export function abortOperation(repo: Repo, type: HistoryOperationType): OperationResult {
  const op = requireOperation(repo, type)
  if (op.type === 'merge') {
    const tree = headTree(repo)
    return {
      repo: { ...rerereClear(repo), operation: null, conflicts: [], index: tree, workdir: keepUntracked(repo, tree) },
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
      { ...rerereClear(restored), operation: null, conflicts: [], index: tree, workdir: keepUntracked(repo, tree) },
      `${type} (abort): returning to ${where}`,
      { forceHead: true },
    ),
    output: `${type} を中止し、${op.origHead} に戻しました`,
  }
}
