/**
 * パッチでのやりとり。git format-patch (コミットを mbox 形式のパッチファイルにする)、
 * git apply (パッチを作業ディレクトリに当てる)、git am (パッチをコミットとして取り込む)。
 * パッチは作業ディレクトリのファイルとして読み書きする。
 */
import { diffTrees } from './diff'
import {
  GitError,
  ancestors,
  carryChanges,
  createCommit,
  currentBranch,
  getCommit,
  headCommitId,
  headTree,
  isSparseHidden,
  logRefs,
  requireNoConflicts,
  requireNoOperation,
  resolveRef,
  subject,
  writeFile,
  type AmOperation,
  type AmPatch,
  type Commit,
  type CommitId,
  type FilePatch,
  type Hunk,
  type OperationResult,
  type Repo,
} from './model'
import { displayContent, gitlink, mergeTrees, splitLines, withFile, type Conflict, type Tree } from './tree'

// ---- format-patch ----

/** git と同じ、mbox の区切りの行に使う固定の日付。 */
const MBOX_DATE = 'Mon Sep 17 00:00:00 2001'

/** パッチのファイル名に使う件名 (使えない文字は - にして、52 文字まで)。 */
function slug(text: string): string {
  return text
    .replace(/[^\p{L}\p{N}._]+/gu, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 52)
    .replace(/[-.]+$/, '')
}

/** 1 つのコミットのパッチ (mbox 形式)。 */
export function formatPatch(repo: Repo, id: CommitId, number: number, total: number, numbered: boolean): string {
  const commit = getCommit(repo, id)
  const parentTree = commit.parents[0] === undefined ? {} : getCommit(repo, commit.parents[0]).tree
  const [title = '', ...rest] = commit.message.split('\n')
  const body = rest.join('\n').replace(/^\n+/, '')
  const prefix = numbered ? `[PATCH ${number}/${total}]` : '[PATCH]'
  return [
    `From ${id} ${MBOX_DATE}`,
    `Subject: ${prefix} ${title}`,
    '',
    ...(body === '' ? [] : [body, '']),
    '---',
    diffTrees(parentTree, commit.tree, { stat: true }),
    '',
    diffTrees(parentTree, commit.tree),
    '-- ',
    'BranchLab',
    '',
  ].join('\n')
}

export interface FormatPatchOptions {
  /** -<n>: HEAD から n 個のコミット。 */
  readonly count?: number
  readonly outputDirectory?: string
  readonly stdout?: boolean
  readonly numbered?: boolean
  readonly startNumber?: number
}

/** パッチにするコミット (古い順)。マージコミットは Git と同じく含めない。 */
function patchCommits(repo: Repo, revision: string | undefined, count: number | undefined): CommitId[] {
  let ids: CommitId[]
  if (count !== undefined) {
    ids = []
    let id: CommitId | undefined = resolveRef(repo, revision ?? 'HEAD')
    while (id !== undefined && ids.length < count) {
      ids.push(id)
      id = getCommit(repo, id).parents[0]
    }
    ids.reverse()
  } else {
    if (revision === undefined) throw new GitError('使い方: git format-patch <起点> / -<数> / <A>..<B>')
    const [from, to] = revision.includes('..') ? revision.split('..') : [revision, 'HEAD']
    const exclude = ancestors(repo.commits, resolveRef(repo, from || 'HEAD'))
    ids = [...ancestors(repo.commits, resolveRef(repo, to || 'HEAD'))].filter((id) => !exclude.has(id))
    ids.sort((a, b) => Number(/\d+$/.exec(a)?.[0]) - Number(/\d+$/.exec(b)?.[0]))
  }
  return ids.filter((id) => getCommit(repo, id).parents.length <= 1)
}

/** git format-patch: コミットをパッチファイル (0001-件名.patch) にして作業ディレクトリに書く。 */
export function gitFormatPatch(repo: Repo, revision: string | undefined, options: FormatPatchOptions = {}): OperationResult {
  const ids = patchCommits(repo, revision, options.count)
  const numbered = options.numbered ?? ids.length > 1
  const start = options.startNumber ?? 1
  const patches = ids.map((id, index) => formatPatch(repo, id, start + index, start + ids.length - 1, numbered))
  if (options.stdout) return { repo, output: patches.join('\n').replace(/\n+$/, '') }
  let current = repo
  const names: string[] = []
  ids.forEach((id, index) => {
    const number = String(start + index).padStart(4, '0')
    const title = slug(subject(getCommit(repo, id).message))
    const name = `${options.outputDirectory ? `${options.outputDirectory.replace(/\/+$/, '')}/` : ''}${number}-${title}.patch`
    current = writeFile(current, name, patches[index] as string, false).repo
    names.push(name)
  })
  return { repo: current, output: names.join('\n') }
}

// ---- パッチの読み取り ----

const MBOX_FROM = /^From (\S+) Mon Sep 17 00:00:00 2001$/

/** unified 形式の差分 (diff --git から) を読む。 */
export function parseDiff(text: string): FilePatch[] {
  const files: FilePatch[] = []
  let file: { path: string; newFile: boolean; deleted: boolean; gitlink: boolean; hunks: Hunk[] } | null = null
  let hunk: { oldStart: number; oldCount: number; newStart: number; newCount: number; lines: Hunk['lines'][number][] } | null = null
  const finish = () => {
    if (file) files.push({ ...file })
  }
  for (const line of text.split('\n')) {
    const header = /^diff --git a\/(.+) b\/(.+)$/.exec(line)
    if (header) {
      finish()
      file = { path: header[2] as string, newFile: false, deleted: false, gitlink: false, hunks: [] }
      hunk = null
      continue
    }
    if (!file) continue
    // 署名の区切り (-- ) と次のパッチの始まりで、差分は終わり
    if (line === '-- ' || MBOX_FROM.test(line)) {
      hunk = null
      continue
    }
    if (line.startsWith('new file mode')) {
      file.newFile = true
      file.gitlink = line.endsWith(' 160000')
    } else if (line.startsWith('deleted file mode')) file.deleted = true
    else if (/^index \S+ 160000$/.test(line)) file.gitlink = true
    else if (line.startsWith('--- ') || line.startsWith('+++ ')) continue
    else if (line.startsWith('@@')) {
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
      if (!match) continue
      hunk = {
        oldStart: Number(match[1]),
        oldCount: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3]),
        newCount: match[4] === undefined ? 1 : Number(match[4]),
        lines: [],
      }
      file.hunks.push(hunk)
    } else if (hunk && line.startsWith('\\')) {
      const last = hunk.lines.at(-1)
      if (last) hunk.lines[hunk.lines.length - 1] = { ...last, newline: false }
    } else if (hunk && /^[ +-]/.test(line)) {
      hunk.lines.push({ type: line[0] as ' ' | '+' | '-', text: line.slice(1), newline: true })
    }
  }
  finish()
  return files
}

/** mbox 形式 (format-patch の出力) のファイルを、1 通ずつのパッチに分ける。 */
export function parsePatches(text: string, name: string): AmPatch[] {
  const chunks: string[][] = []
  for (const line of text.split('\n')) {
    if (MBOX_FROM.test(line) || chunks.length === 0) chunks.push([])
    chunks[chunks.length - 1]?.push(line)
  }
  return chunks
    .filter((lines) => lines.some((line) => line.startsWith('diff --git') || line.startsWith('Subject:')))
    .map((lines) => {
      const source = MBOX_FROM.exec(lines[0] ?? '')?.[1]
      const subjectLine = lines.find((line) => line.startsWith('Subject: '))
      const title = (subjectLine ?? 'Subject: ').slice('Subject: '.length).replace(/^\[PATCH[^\]]*\]\s*/, '')
      const bodyStart = subjectLine === undefined ? lines.length : lines.indexOf(subjectLine) + 1
      const separator = lines.findIndex((line, index) => index >= bodyStart && (line === '---' || line.startsWith('diff --git')))
      const body = lines
        .slice(bodyStart, separator === -1 ? lines.length : separator)
        .join('\n')
        .trim()
      const message = body === '' ? title : `${title}\n\n${body}`
      const raw = lines.join('\n')
      return { name, ...(source === undefined ? {} : { source }), message, raw, files: parseDiff(raw) }
    })
}

// ---- パッチを当てる ----

function hunkText(lines: Hunk['lines'], side: 'old' | 'new'): string[] {
  return lines
    .filter((line) => line.type === ' ' || line.type === (side === 'old' ? '-' : '+'))
    .map((line) => `${line.text}${line.newline ? '\n' : ''}`)
}

/** -R: パッチを逆向きにする。 */
export function reversePatch(files: readonly FilePatch[]): FilePatch[] {
  return files.map((file) => ({
    ...file,
    newFile: file.deleted,
    deleted: file.newFile,
    hunks: file.hunks.map((hunk) => ({
      oldStart: hunk.newStart,
      oldCount: hunk.newCount,
      newStart: hunk.oldStart,
      newCount: hunk.oldCount,
      lines: hunk.lines.map((line) => ({ ...line, type: line.type === '+' ? '-' : line.type === '-' ? '+' : ' ' })),
    })),
  }))
}

/**
 * 1 つのファイルにパッチを当てる。文脈の行が合わなければ、近くの位置を探す (git apply と同じく行のずれは許す)。
 * 当てられなければ、合わなかったハンクの行番号を返す。
 */
function applyFile(old: string | undefined, file: FilePatch): { text: string | undefined } | { failedAt: number } {
  if (file.newFile && old !== undefined) return { failedAt: 0 }
  if (!file.newFile && old === undefined) return { failedAt: 0 }
  const source = splitLines(old === undefined ? '' : displayContent(old))
  const out: string[] = []
  let cursor = 0
  for (const hunk of file.hunks) {
    const expected = hunkText(hunk.lines, 'old')
    const preferred = Math.max(cursor, hunk.oldCount === 0 ? hunk.oldStart : hunk.oldStart - 1)
    // Git と同じく、1 行目からのハンクはファイルの先頭に、後ろに文脈のないハンクはファイルの末尾に合わせる
    const atBeginning = hunk.oldStart <= 1
    const trailing = hunk.lines.length - 1 - hunk.lines.findLastIndex((line) => line.type !== ' ')
    const atEnd = trailing === 0 && hunk.lines.some((line) => line.type === ' ')
    let found = -1
    for (let distance = 0; found === -1 && distance <= source.length; distance++) {
      for (const position of [preferred - distance, preferred + distance]) {
        if (position < cursor || position + expected.length > source.length) continue
        if (atBeginning && position !== 0) continue
        if (atEnd && position + expected.length !== source.length) continue
        if (expected.every((line, i) => source[position + i] === line)) {
          found = position
          break
        }
      }
    }
    if (found === -1) return { failedAt: hunk.oldStart }
    out.push(...source.slice(cursor, found), ...hunkText(hunk.lines, 'new'))
    cursor = found + expected.length
  }
  out.push(...source.slice(cursor))
  if (file.deleted) return out.length === 0 ? { text: undefined } : { failedAt: 0 }
  const text = out.join('')
  // サブモジュール (gitlink) の差分は "Subproject commit <ID>" の 1 行として当てる
  const sub = /^Subproject commit (\S+)\n$/.exec(text)
  const wasGitlink = old !== undefined && displayContent(old) !== old
  return { text: sub && (wasGitlink || file.gitlink) ? gitlink(sub[1] as string) : text }
}

/** tree にパッチを当てる。当てられなければ、Git と同じ形のエラーの行を返す。 */
export function applyPatch(tree: Tree, files: readonly FilePatch[]): { tree: Tree } | { errors: string[] } {
  let result = tree
  for (const file of files) {
    const applied = applyFile(result[file.path], file)
    if ('failedAt' in applied) {
      if (file.newFile && result[file.path] !== undefined) return { errors: [`error: ${file.path}: already exists in working directory`] }
      if (!file.newFile && result[file.path] === undefined) return { errors: [`error: ${file.path}: No such file or directory`] }
      return { errors: [`error: patch failed: ${file.path}:${applied.failedAt}`, `error: ${file.path}: patch does not apply`] }
    }
    result = withFile(result, file.path, applied.text)
  }
  return { tree: result }
}

function readPatchFile(repo: Repo, path: string): string {
  const content = isSparseHidden(repo, path) ? undefined : repo.workdir[path]
  if (content === undefined) throw new GitError(`error: can't open patch '${path}': No such file or directory`)
  return content
}

export interface ApplyOptions {
  readonly check?: boolean
  /** --index: 作業ディレクトリとステージの両方に当てる。 */
  readonly index?: boolean
  /** --cached: ステージだけに当てる。 */
  readonly cached?: boolean
  readonly reverse?: boolean
}

/** git apply <パッチ>...: パッチを作業ディレクトリ (--index ならステージも) に当てる。コミットはしない。 */
export function gitApply(repo: Repo, paths: readonly string[], options: ApplyOptions = {}): OperationResult {
  if (paths.length === 0) throw new GitError('使い方: git apply [--check] [--index | --cached] [-R] <パッチ>...')
  let workdir = repo.workdir
  let index = repo.index
  for (const path of paths) {
    const parsed = parseDiff(readPatchFile(repo, path))
    if (parsed.length === 0) throw new GitError(`error: No valid patches in input (allow with "--allow-empty")`)
    const files = options.reverse ? reversePatch(parsed) : parsed
    if (!options.cached) {
      const applied = applyPatch(workdir, files)
      if ('errors' in applied) throw new GitError(applied.errors.join('\n'))
      workdir = applied.tree
    }
    if (options.index || options.cached) {
      const applied = applyPatch(index, files)
      if ('errors' in applied) throw new GitError(applied.errors.join('\n'))
      index = applied.tree
    }
  }
  if (options.check) return { repo, output: '' }
  return { repo: { ...repo, workdir, index }, output: '' }
}

// ---- am ----

const AM_HINTS = [
  "hint: Use 'git am --show-current-patch=diff' to see the failed patch",
  'hint: 問題を解決したら git am --continue を実行してください。',
  'hint: このパッチを飛ばすには git am --skip、取り込みをやめて元に戻すには git am --abort を実行します。',
]

/** パッチの元のコミット (format-patch の From 行) がこのリポジトリにあれば、その由来。 */
function sourceOf(repo: Repo, patch: AmPatch): CommitId | undefined {
  const original = patch.source === undefined ? undefined : repo.commits[patch.source]
  return original === undefined ? undefined : (original.source ?? original.id)
}

function commitPatch(repo: Repo, patch: AmPatch, tree: Tree, action: string): { repo: Repo; output: string } {
  const source = sourceOf(repo, patch)
  return createCommit(
    repo,
    { parents: [headCommitId(repo)], tree, ...(source === undefined ? {} : { source }), reflogAction: action },
    patch.message,
  )
}

/** am の残りのパッチを順に当てる。当てられなければ止まる。 */
function runAm(repo: Repo, op: AmOperation, lines: string[]): OperationResult {
  let current: Repo = { ...repo, operation: null }
  let state = op
  while (state.todo.length > 0) {
    const [patch, ...rest] = state.todo as [AmPatch, ...AmPatch[]]
    lines.push(`Applying: ${subject(patch.message)}`)
    const applied = applyPatch(headTree(current), patch.files)
    let tree: Tree | null = 'tree' in applied ? applied.tree : null
    let conflicts: readonly Conflict[] = []
    if (tree === null && state.threeWay) {
      // -3: パッチの元のコミットから基準を作り、3-way マージで当てる
      const original: Commit | undefined = patch.source === undefined ? undefined : current.commits[patch.source]
      if (original !== undefined) {
        lines.push('Using index info to reconstruct a base tree...', 'Falling back to patching base and 3-way merge...')
        const base = original.parents[0] === undefined ? {} : getCommit(current, original.parents[0]).tree
        const merged = mergeTrees(base, headTree(current), original.tree, { ours: 'HEAD', theirs: subject(patch.message) })
        tree = merged.tree
        conflicts = merged.conflicts
      }
    }
    const stopped: AmOperation = { ...state, todo: rest, current: patch }
    if (tree === null) {
      lines.push(...('errors' in applied ? applied.errors : []), `Patch failed at ${String(state.done + 1).padStart(4, '0')} ${subject(patch.message)}`, ...AM_HINTS)
      return { repo: { ...current, operation: stopped }, output: lines.join('\n') }
    }
    const carried = carryChanges(current, tree, 'am')
    if (conflicts.length > 0) {
      const head = headTree(current)
      let index = carried.index
      for (const conflict of conflicts) index = withFile(index, conflict.path, head[conflict.path])
      lines.push(
        ...conflicts.map((conflict) => `CONFLICT (content): ${conflict.path} でマージのコンフリクトが発生しました`),
        `error: Failed to merge in the changes.`,
        `Patch failed at ${String(state.done + 1).padStart(4, '0')} ${subject(patch.message)}`,
        ...AM_HINTS,
      )
      return { repo: { ...current, ...carried, index, conflicts, operation: stopped }, output: lines.join('\n') }
    }
    current = commitPatch({ ...current, ...carried }, patch, tree, 'am').repo
    state = { ...state, todo: rest, current: null, done: state.done + 1 }
  }
  return { repo: { ...current, operation: null }, output: lines.join('\n') }
}

/** git am [-3] <パッチ>...: パッチをコミットとして取り込む。 */
export function gitAm(repo: Repo, paths: readonly string[], options: { readonly threeWay?: boolean } = {}): OperationResult {
  requireNoOperation(repo)
  if (paths.length === 0) throw new GitError('使い方: git am [-3] <パッチ>...')
  const patches = paths.flatMap((path) => parsePatches(readPatchFile(repo, path), path))
  if (patches.length === 0) throw new GitError('Patch format detection failed.')
  if (Object.keys({ ...repo.index, ...headTree(repo) }).some((path) => repo.index[path] !== headTree(repo)[path])) {
    throw new GitError(`error: Dirty index: cannot apply patches (dirty: ${Object.keys(repo.index).filter((path) => repo.index[path] !== headTree(repo)[path]).join(' ')})`)
  }
  return runAm(repo, {
    type: 'am',
    todo: patches,
    current: null,
    origHead: headCommitId(repo),
    branch: currentBranch(repo),
    done: 0,
    threeWay: options.threeWay ?? false,
  }, [])
}

function requireAm(repo: Repo): AmOperation {
  const op = repo.operation
  if (op?.type !== 'am') throw new GitError('fatal: Resolve operation not in progress, we are not resuming.')
  return op
}

/** git am --continue: 直してステージした内容で、止まったパッチをコミットして続ける。 */
export function amContinue(repo: Repo): OperationResult {
  const op = requireAm(repo)
  requireNoConflicts(repo)
  const patch = op.current
  if (patch === null) return runAm(repo, op, [])
  const head = headTree(repo)
  if (Object.keys({ ...head, ...repo.index }).every((path) => head[path] === repo.index[path])) {
    throw new GitError(
      `Applying: ${subject(patch.message)}\n` +
        "No changes - did you forget to use 'git add'?\n" +
        'ステージしたものがないなら、同じ変更がすでに入っているのかもしれません。git am --skip で飛ばせます。',
    )
  }
  const committed = commitPatch({ ...repo, operation: null }, patch, repo.index, 'am')
  return runAm(committed.repo, { ...op, current: null, done: op.done + 1 }, [`Applying: ${subject(patch.message)}`])
}

/** git am --skip: 止まったパッチを飛ばして続ける。 */
export function amSkip(repo: Repo): OperationResult {
  const op = requireAm(repo)
  const tree = headTree(repo)
  return runAm(
    { ...repo, index: tree, workdir: { ...untrackedFiles(repo), ...tree }, conflicts: [] },
    { ...op, current: null, done: op.done + 1 },
    [],
  )
}

/** 追跡していないファイル (パッチのファイルなど)。--skip / --abort でも残す。 */
function untrackedFiles(repo: Repo): Tree {
  const head = headTree(repo)
  return Object.fromEntries(Object.entries(repo.workdir).filter(([path]) => !(path in repo.index) && !(path in head)))
}

/** git am --abort: 取り込みをやめて、始める前の状態に戻す。 */
export function amAbort(repo: Repo): OperationResult {
  const op = requireAm(repo)
  const tree = getCommit(repo, op.origHead).tree
  const restored: Repo =
    op.branch === null
      ? { ...repo, head: { type: 'detached', id: op.origHead } }
      : { ...repo, head: { type: 'branch', name: op.branch }, branches: { ...repo.branches, [op.branch]: op.origHead } }
  return {
    repo: logRefs(
      repo,
      { ...restored, operation: null, conflicts: [], index: tree, workdir: { ...untrackedFiles(repo), ...tree } },
      'am --abort',
      { forceHead: true },
    ),
    output: '',
  }
}

/** git am --show-current-patch */
export function amShowCurrentPatch(repo: Repo): OperationResult {
  const op = requireAm(repo)
  if (op.current === null) throw new GitError('error: 表示するパッチはありません')
  return { repo, output: op.current.raw.replace(/\n+$/, '') }
}
