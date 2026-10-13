/**
 * 履歴を組み替える操作 (merge・cherry-pick・revert・rebase) と、
 * コンフリクトで止まったときの --continue / --abort / --skip。
 */
import {
  GitError,
  REMOTE_NAME,
  addCommit,
  ancestors,
  carryChanges,
  commit,
  commitSummary,
  currentBranch,
  getCommit,
  hasTrackedChanges,
  headCommitId,
  headTree,
  isAncestor,
  mergeBase,
  requireNoConflicts,
  requireNoOperation,
  resolveRef,
  revertMessage,
  type CommitId,
  type Operation,
  type OperationResult,
  type Repo,
} from './model'
import { mergeTrees, treesEqual, withFile, type Conflict, type Tree } from './tree'

type SequenceType = 'cherry-pick' | 'revert' | 'rebase'
type SequenceOperation = Extract<Operation, { type: SequenceType }>

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

function mergeMessage(repo: Repo, ref: string): string {
  const current = currentBranch(repo)
  const into = current === null || current === 'main' ? '' : ` into ${current}`
  if (ref in repo.branches) return `Merge branch '${ref}'${into}`
  if (ref.startsWith(`${REMOTE_NAME}/`)) return `Merge remote-tracking branch '${ref}'${into}`
  return `Merge commit '${ref}'${into}`
}

export interface MergeOptions {
  readonly message?: string
  /** --no-ff: fast-forward できる場合もマージコミットを作る。 */
  readonly noFastForward?: boolean
  /** --ff-only: fast-forward できない場合は中止する。 */
  readonly fastForwardOnly?: boolean
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
      repo: { ...moved, index, workdir },
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
  const message = options.message?.trim() || mergeMessage(repo, ref)
  const carried = carryChanges(repo, result.tree, 'merge')

  if (result.conflicts.length > 0) {
    const stopped = applyConflicted(
      { ...repo, operation: { type: 'merge', theirs, message } },
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

  const { repo: next, commit: created } = addCommit(repo, {
    parents: [ours, theirs],
    message,
    tree: result.tree,
  })
  return {
    repo: { ...next, ...carried },
    output: `Merge made by the 'ort' strategy.\n${commitSummary(created, currentBranch(next))}`,
  }
}

// ---- cherry-pick / revert / rebase ----

interface PickResult {
  readonly repo: Repo
  readonly status: 'committed' | 'empty' | 'conflict'
  readonly lines: readonly string[]
}

/** 1 つのコミットの変更を HEAD に適用する (revert なら逆向きに)。 */
function applyOne(repo: Repo, type: SequenceType, id: CommitId, keepEmpty: boolean): PickResult {
  const picked = getCommit(repo, id)
  if (picked.parents.length > 1) {
    throw new GitError(
      `error: ${id} はマージコミットですが、-m オプションが指定されていません (このアプリでは未対応です)`,
    )
  }
  const parentTree =
    picked.parents[0] === undefined ? {} : getCommit(repo, picked.parents[0]).tree
  const [base, theirs] = type === 'revert' ? [picked.tree, parentTree] : [parentTree, picked.tree]
  const label =
    type === 'revert' ? `parent of ${id} (${picked.message})` : `${id} (${picked.message})`
  const ours = headTree(repo)
  const result = mergeTrees(base, ours, theirs, { ours: 'HEAD', theirs: label })
  const carried = carryChanges(repo, result.tree, type)

  if (result.conflicts.length > 0) {
    return {
      repo: applyConflicted(repo, carried, result.conflicts),
      status: 'conflict',
      lines: conflictLines(result.conflicts),
    }
  }
  // もともと空のコミットは keepEmpty なら複製し、変更が取り込み済みで空になったものは除く
  if (treesEqual(result.tree, ours) && !(keepEmpty && treesEqual(picked.tree, parentTree))) {
    return { repo, status: 'empty', lines: [] }
  }
  const { repo: next, commit: created } = addCommit(repo, {
    parents: [headCommitId(repo)],
    message: type === 'revert' ? revertMessage(picked) : picked.message,
    tree: result.tree,
    ...(type === 'revert' ? { reverts: id } : { source: picked.source ?? id }),
  })
  return {
    repo: { ...next, ...carried },
    status: 'committed',
    lines: [commitSummary(created, currentBranch(next))],
  }
}

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

/** todo のコミットを順に適用する。コンフリクトか (cherry-pick・revert で) 空になったら止まる。 */
function runSequence(repo: Repo, op: SequenceOperation, lines: string[]): OperationResult {
  let current = repo
  let todo = op.todo
  while (todo.length > 0) {
    const [id, ...rest] = todo as [CommitId, ...CommitId[]]
    const result = applyOne({ ...current, operation: null }, op.type, id, op.keepEmpty)
    lines.push(...result.lines)
    if (result.status === 'conflict') {
      lines.push(`error: ${id} (${getCommit(repo, id).message}) を適用できませんでした`)
      lines.push(STOP_HINTS[op.type])
      return {
        repo: { ...result.repo, operation: { ...op, current: id, todo: rest } },
        output: lines.join('\n'),
      }
    }
    if (result.status === 'empty') {
      if (op.type === 'rebase') {
        lines.push(`${id} の変更はすでに含まれているため、取り除きました`)
      } else {
        lines.push(
          `${id} の変更はすでに含まれているため、コミットが空になります。`,
          `git ${op.type} --skip で飛ばすか、git commit --allow-empty で空のコミットを作ってください`,
        )
        return {
          repo: { ...result.repo, operation: { ...op, current: id, todo: rest } },
          output: lines.join('\n'),
        }
      }
    }
    current = result.repo
    todo = rest
  }
  return finishSequence(current, op, lines)
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
  return {
    repo: {
      ...repo,
      operation: null,
      branches: { ...repo.branches, [op.branch]: tip },
      head: { type: 'branch', name: op.branch },
    },
    output: lines.join('\n'),
  }
}

function startPicks(
  repo: Repo,
  type: 'cherry-pick' | 'revert',
  refs: readonly string[],
  keepEmpty: boolean,
): OperationResult {
  requireNoOperation(repo)
  if (refs.length === 0) {
    throw new GitError(`使い方: git ${type} <コミット>...`)
  }
  const ids = refs.map((ref) => resolveRef(repo, ref))
  for (const id of ids) {
    if (getCommit(repo, id).parents.length > 1) {
      throw new GitError(
        `error: ${id} はマージコミットですが、-m オプションが指定されていません (このアプリでは未対応です)`,
      )
    }
  }
  return runSequence(
    repo,
    {
      type,
      current: null,
      todo: ids,
      origHead: headCommitId(repo),
      branch: currentBranch(repo),
      keepEmpty,
    },
    [],
  )
}

/** git cherry-pick: 指定したコミットの変更を、新しいコミットとして HEAD の上に複製する。 */
export function cherryPick(
  repo: Repo,
  refs: readonly string[],
  options: { readonly allowEmpty?: boolean } = {},
): OperationResult {
  return startPicks(repo, 'cherry-pick', refs, options.allowEmpty ?? false)
}

/** git revert: 指定したコミットの変更を打ち消す新しいコミットを作る。 */
export function revert(repo: Repo, refs: readonly string[]): OperationResult {
  return startPicks(repo, 'revert', refs, false)
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

/** git rebase <upstream>: 現在のブランチのコミットを upstream の先に付け替える。 */
export function rebase(repo: Repo, upstreamRef: string): OperationResult {
  requireNoOperation(repo)
  if (hasTrackedChanges(repo)) {
    throw new GitError(
      'error: リベースできません: コミットしていない変更があります。\n' +
        '変更をコミットするか restore で取り消してください。',
    )
  }
  const upstream = resolveRef(repo, upstreamRef)
  const head = headCommitId(repo)
  const branch = currentBranch(repo)

  if (isAncestor(repo, upstream, head)) {
    return { repo, output: `Current branch ${branch ?? 'HEAD'} is up to date.` }
  }
  if (isAncestor(repo, head, upstream)) {
    const tree = getCommit(repo, upstream).tree
    const { index, workdir } = carryChanges(repo, tree, 'rebase')
    const moved: Repo =
      branch === null
        ? { ...repo, head: { type: 'detached', id: upstream } }
        : { ...repo, branches: { ...repo.branches, [branch]: upstream } }
    return {
      repo: { ...moved, index, workdir },
      output: `Fast-forwarded ${branch ?? 'HEAD'} to ${upstreamRef}.`,
    }
  }

  const todo = commitsToReplay(repo, head, upstream)
  // rebase 中は HEAD を upstream に切り離し、最後にブランチを付け替える
  const { index, workdir } = carryChanges(repo, getCommit(repo, upstream).tree, 'rebase')
  const detached: Repo = { ...repo, head: { type: 'detached', id: upstream }, index, workdir }
  return runSequence(
    detached,
    { type: 'rebase', current: null, todo, origHead: head, branch, keepEmpty: true },
    [],
  )
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

  const lines: string[] = []
  let current = repo
  if (op.current !== null) {
    if (treesEqual(repo.index, headTree(repo))) {
      if (op.type !== 'rebase') {
        throw new GitError(
          `${op.current} の変更はすでに含まれているため、コミットが空になります。\n` +
            `git ${op.type} --skip で飛ばしてください`,
        )
      }
      lines.push(`${op.current} の変更が空になったため、取り除きました`)
    } else {
      const result = commit(repo)
      lines.push(result.output)
      current = result.repo
    }
  }
  return runSequence(current, { ...op, current: null }, lines)
}

export function skipOperation(repo: Repo, type: SequenceType): OperationResult {
  const op = requireOperation(repo, type) as SequenceOperation
  const tree = headTree(repo)
  const cleaned: Repo = { ...repo, index: tree, workdir: tree, conflicts: [] }
  return runSequence(cleaned, { ...op, current: null }, [
    op.current === null ? '' : `${op.current} を飛ばしました`,
  ].filter(Boolean))
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
  return {
    repo: { ...restored, operation: null, conflicts: [], index: tree, workdir: tree },
    output: `${type} を中止し、${op.origHead} に戻しました`,
  }
}
