/**
 * git add -p / restore -p / reset -p / checkout -p。変更をハンクごとに見せて、y / n などの答えで一部だけを扱う。
 * 質問の状態は Repo.prompt に持ち、答えるまでは入力をすべてその答えとして読む (エディタと同じく、ログと共有 URL で再現できる)。
 */
import { CONTEXT, editScript, hunkLines, type Op } from './diff'
import {
  GitError,
  headTree,
  isSparseHidden,
  type OperationResult,
  type PatchFile,
  type PatchMode,
  type PatchPrompt,
  type Repo,
} from './model'
import { parseGitlink, splitLines, withFile } from './tree'

/** 変更のかたまり (連続した - と + の行) の、ops の中の範囲。 */
function blocksOf(ops: readonly Op[]): Array<[number, number]> {
  const blocks: Array<[number, number]> = []
  ops.forEach((op, index) => {
    if (op.type === ' ') return
    const last = blocks.at(-1)
    if (last && last[1] === index - 1) last[1] = index
    else blocks.push([index, index])
  })
  return blocks
}

function opsOf(file: Pick<PatchFile, 'from' | 'to'>): Op[] {
  return editScript(splitLines(file.from ?? ''), splitLines(file.to ?? ''))
}

/** ファイルの追加や削除 (ハンクに分けず、ファイル全体で 1 つとして尋ねる)。 */
function wholeFile(file: Pick<PatchFile, 'from' | 'to'>): 'addition' | 'deletion' | null {
  return file.from === undefined ? 'addition' : file.to === undefined ? 'deletion' : null
}

/** 文脈 (前後 3 行) が重なるブロックをまとめたハンク (git diff と同じまとめ方)。 */
function initialHunks(file: Pick<PatchFile, 'from' | 'to'>): number[][] {
  if (wholeFile(file) !== null) return [[0]]
  const hunks: number[][] = []
  let lastEnd = -Infinity
  blocksOf(opsOf(file)).forEach(([start, end], index) => {
    const current = hunks.at(-1)
    if (current && start - lastEnd <= CONTEXT * 2) current.push(index)
    else hunks.push([index])
    lastEnd = end
  })
  return hunks
}

/** 選んだブロックの変更だけを from に当てた内容。 */
function applyBlocks(file: Pick<PatchFile, 'from' | 'to'>, keep: (block: number) => boolean): string | undefined {
  const whole = wholeFile(file)
  if (whole !== null) return keep(0) ? file.to : file.from
  const ops = opsOf(file)
  const blocks = blocksOf(ops)
  const blockAt = new Map<number, number>()
  blocks.forEach(([start, end], index) => {
    for (let i = start; i <= end; i++) blockAt.set(i, index)
  })
  let text = ''
  ops.forEach((op, index) => {
    if (op.type === ' ') text += op.line
    else if (keep(blockAt.get(index) as number) === (op.type === '+')) text += op.line
  })
  return text
}

const VERBS: Readonly<Record<PatchMode, string>> = {
  stage: 'ステージする',
  unstage: 'ステージを取り消す',
  discard: '作業ディレクトリから捨てる',
}

function question(mode: PatchMode, file: PatchFile): string {
  const whole = wholeFile(file)
  if (mode === 'stage') return whole === 'deletion' ? 'このファイルの削除をステージしますか' : whole === 'addition' ? 'このファイルの追加をステージしますか' : 'このハンクをステージしますか'
  if (mode === 'unstage') return whole === 'deletion' ? '削除のステージを取り消しますか' : whole === 'addition' ? '追加のステージを取り消しますか' : 'このハンクのステージを取り消しますか'
  return whole === 'deletion' ? '削除を取り消して、ファイルを戻しますか' : 'このハンクを作業ディレクトリから捨てますか'
}

function canSplit(file: PatchFile, hunk: number): boolean {
  return (file.hunks[hunk]?.length ?? 0) > 1
}

function keys(prompt: PatchPrompt): string {
  const file = prompt.files[prompt.file] as PatchFile
  return `[y,n,q,a,d${canSplit(file, prompt.hunk) ? ',s' : ''},?]`
}

/** 今のハンクの表示 (ファイルの最初のハンクなら、ファイルの見出しも付ける)。 */
function showHunk(prompt: PatchPrompt, withHeader: boolean): string {
  const file = prompt.files[prompt.file] as PatchFile
  const lines: string[] = []
  if (withHeader) {
    lines.push(`diff --git a/${file.path} b/${file.path}`)
    if (file.from === undefined) lines.push('new file mode 100644')
    if (file.to === undefined) lines.push('deleted file mode 100644')
    lines.push(file.from === undefined ? '--- /dev/null' : `--- a/${file.path}`, file.to === undefined ? '+++ /dev/null' : `+++ b/${file.path}`)
  }
  const ops = opsOf(file)
  const blocks = blocksOf(ops)
  const ids = file.hunks[prompt.hunk] ?? []
  const first = blocks[ids[0] as number]
  const last = blocks[ids.at(-1) as number]
  if (first !== undefined && last !== undefined) {
    lines.push(...hunkLines(ops, Math.max(0, first[0] - CONTEXT), Math.min(ops.length - 1, last[1] + CONTEXT)))
  }
  lines.push(`(${prompt.hunk + 1}/${file.hunks.length}) ${question(prompt.mode, file)} ${keys(prompt)}? `)
  return lines.join('\n')
}

function helpText(prompt: PatchPrompt): string {
  const verb = VERBS[prompt.mode]
  const lines = [
    `y - このハンクを${verb}`,
    `n - このハンクを${verb.replace(/する$/, 'しない').replace(/取り消す$/, '取り消さない').replace(/捨てる$/, '捨てない')}`,
    'q - 終わる (このハンクと、残りのハンクはすべて n にする)',
    `a - このハンクと、このファイルの残りのハンクをすべて${verb}`,
    'd - このハンクと、このファイルの残りのハンクをすべて n にする',
  ]
  if (canSplit(prompt.files[prompt.file] as PatchFile, prompt.hunk)) lines.push('s - このハンクを小さなハンクに分ける')
  lines.push('? - このヘルプを表示する')
  return lines.join('\n')
}

/** 尋ねる対象のファイル。 */
function patchFiles(repo: Repo, mode: PatchMode, paths: readonly string[]): PatchFile[] {
  const from = mode === 'unstage' ? headTree(repo) : repo.index
  const to = mode === 'unstage' ? repo.index : repo.workdir
  const conflicted = new Set(repo.conflicts.map((conflict) => conflict.path))
  const matches = (path: string) =>
    paths.length === 0 || paths.some((spec) => spec === '.' || path === spec.replace(/\/+$/, '') || path.startsWith(`${spec.replace(/\/+$/, '')}/`))
  return [...new Set([...Object.keys(from), ...Object.keys(to)])]
    .filter((path) => from[path] !== to[path] && matches(path) && !conflicted.has(path) && !isSparseHidden(repo, path))
    // 追跡していないファイルと、サブモジュールは尋ねない (本物と同じ)
    .filter((path) => (mode === 'unstage' || path in repo.index) && parseGitlink(from[path]) === null && parseGitlink(to[path]) === null)
    .sort()
    .map((path) => {
      const file = { path, from: from[path], to: to[path] }
      return { ...file, hunks: initialHunks(file), answers: {} }
    })
}

/** git add -p などを始める。変更がなければ No changes. */
export function startPatch(repo: Repo, mode: PatchMode, command: string, paths: readonly string[]): OperationResult {
  if (repo.prompt !== null) throw new GitError('すでに別の質問に答えている途中です')
  const files = patchFiles(repo, mode, paths)
  if (files.length === 0) return { repo, output: 'No changes.' }
  const prompt: PatchPrompt = { mode, command, files, file: 0, hunk: 0 }
  return { repo: { ...repo, prompt }, output: showHunk(prompt, true) }
}

/** 答えをファイルに当てて、質問を終える。 */
function finish(repo: Repo, prompt: PatchPrompt): Repo {
  let index = repo.index
  let workdir = repo.workdir
  for (const file of prompt.files) {
    const yes = (block: number) => file.answers[block] === true
    // stage は「はい」の変更を、unstage と discard は「いいえ」の変更を残す
    const result = applyBlocks(file, prompt.mode === 'stage' ? yes : (block) => !yes(block))
    if (prompt.mode === 'discard') workdir = withFile(workdir, file.path, result)
    else index = withFile(index, file.path, result)
  }
  return { ...repo, index, workdir, prompt: null }
}

/** 次のハンクに進む (ファイルの最後なら次のファイル、すべて終われば当てて閉じる)。 */
function advance(repo: Repo, prompt: PatchPrompt, nextFile = false): OperationResult {
  const file = prompt.files[prompt.file] as PatchFile
  if (!nextFile && prompt.hunk + 1 < file.hunks.length) {
    const next = { ...prompt, hunk: prompt.hunk + 1 }
    return { repo: { ...repo, prompt: next }, output: showHunk(next, false) }
  }
  if (prompt.file + 1 < prompt.files.length) {
    const next = { ...prompt, file: prompt.file + 1, hunk: 0 }
    return { repo: { ...repo, prompt: next }, output: showHunk(next, true) }
  }
  return { repo: finish(repo, prompt), output: '' }
}

function answerHunks(prompt: PatchPrompt, fileIndex: number, hunks: readonly number[], value: boolean): PatchPrompt {
  const file = prompt.files[fileIndex] as PatchFile
  const answers = { ...file.answers }
  for (const hunk of hunks) for (const block of file.hunks[hunk] ?? []) answers[block] = value
  return { ...prompt, files: prompt.files.map((other, index) => (index === fileIndex ? { ...file, answers } : other)) }
}

/** 質問への答え (y / n / q / a / d / s / ?)。 */
export function answerPatch(repo: Repo, input: string): OperationResult {
  const prompt = repo.prompt
  if (prompt === null) throw new GitError('答える質問はありません')
  const file = prompt.files[prompt.file] as PatchFile
  const rest = Array.from({ length: file.hunks.length - prompt.hunk }, (_, i) => prompt.hunk + i)
  switch (input.trim()) {
    case 'y':
      return advance(repo, answerHunks(prompt, prompt.file, [prompt.hunk], true))
    case 'n':
      return advance(repo, answerHunks(prompt, prompt.file, [prompt.hunk], false))
    case 'a':
      return advance(repo, answerHunks(prompt, prompt.file, rest, true), true)
    case 'd':
      return advance(repo, answerHunks(prompt, prompt.file, rest, false), true)
    case 'q':
      return { repo: finish(repo, prompt), output: '' }
    case 's': {
      if (!canSplit(file, prompt.hunk)) {
        return { repo, output: `Sorry, cannot split this hunk\n${showHunk(prompt, false)}` }
      }
      const parts = (file.hunks[prompt.hunk] ?? []).map((block) => [block])
      const hunks = [...file.hunks.slice(0, prompt.hunk), ...parts, ...file.hunks.slice(prompt.hunk + 1)]
      const next = { ...prompt, files: prompt.files.map((other, index) => (index === prompt.file ? { ...file, hunks } : other)) }
      return { repo: { ...repo, prompt: next }, output: `Split into ${parts.length} hunks.\n${showHunk(next, false)}` }
    }
    default:
      return { repo, output: `${helpText(prompt)}\n${showHunk(prompt, false)}` }
  }
}
