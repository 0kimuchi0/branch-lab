/**
 * 現在の状態を URL で共有する。状態そのものではなく「モード・お題 (やレッスンとステップ)・入力したコマンドの列」を
 * URL のハッシュに入れ、開いた側で同じコマンドを実行し直して状態を再現する。
 * Repo はコマンドから決定的に作られるので、ログも含めて同じ画面になる。
 */
import { executeCommand } from '../git/commands'
import { createRepo, type Repo } from '../git/model'
import type { BuiltPuzzle } from '../puzzles/puzzles'
import { LESSONS, stepStartRepo } from '../tutorial/lessons'

export type Mode = 'free' | 'puzzle' | 'tutorial'

export interface SharedState {
  readonly mode: Mode
  /** お題モードのときのお題の ID。 */
  readonly puzzleId?: string
  /** チュートリアルのときのレッスンの ID と、今のステップ (0 始まり)。 */
  readonly lessonId?: string
  readonly step?: number
  /** チュートリアルのとき、コマンドの列をどのステップの始めの状態から実行するか (省略すると 0 = レッスンの始め)。 */
  readonly base?: number
  readonly commands: readonly string[]
}

export interface ReplayedEntry {
  readonly command: string
  readonly output: string
  readonly ok: boolean
}

/** 2 でチュートリアルを足し、3 でチュートリアルの基準のステップ (b) を足した。前の形式のリンクもそのまま読める。 */
const VERSION = 3
const HASH_KEY = 's'
/** 開いた側で重い処理にならないよう、受け付ける量に上限を設ける。 */
export const MAX_COMMANDS = 500
export const MAX_COMMAND_LENGTH = 1000

function toBase64Url(text: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(encoded: string): string {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

/** URL のハッシュ (先頭の # を含む) を作る。 */
export function encodeShare(state: SharedState): string {
  const payload = {
    v: VERSION,
    m: state.mode,
    ...(state.mode === 'puzzle' && state.puzzleId !== undefined ? { p: state.puzzleId } : {}),
    ...(state.mode === 'tutorial' && state.lessonId !== undefined ? { l: state.lessonId, i: state.step ?? 0 } : {}),
    ...(state.mode === 'tutorial' && state.base ? { b: state.base } : {}),
    c: state.commands,
  }
  return `#${HASH_KEY}=${toBase64Url(JSON.stringify(payload))}`
}

/** URL のハッシュを読む。共有の形式でない、または壊れていれば null。 */
export function decodeShare(hash: string): SharedState | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const encoded = params.get(HASH_KEY)
  if (!encoded) return null
  try {
    const payload: unknown = JSON.parse(fromBase64Url(encoded))
    if (typeof payload !== 'object' || payload === null) return null
    const { v, m, p, l, i, b, c } = payload as Record<string, unknown>
    if (v !== 1 && v !== 2 && v !== VERSION) return null
    if (m !== 'free' && m !== 'puzzle' && !(m === 'tutorial' && v !== 1)) return null
    if (!Array.isArray(c) || c.length > MAX_COMMANDS) return null
    if (!c.every((command) => typeof command === 'string' && command.length <= MAX_COMMAND_LENGTH)) {
      return null
    }
    if (m === 'puzzle' && typeof p !== 'string') return null
    if (m === 'tutorial' && (typeof l !== 'string' || typeof i !== 'number' || !Number.isInteger(i) || i < 0)) return null
    if (m === 'puzzle') return { mode: m, puzzleId: p as string, commands: c as string[] }
    if (m === 'tutorial' && b !== undefined && (typeof b !== 'number' || !Number.isInteger(b) || b < 0)) return null
    if (m === 'tutorial') {
      return { mode: m, lessonId: l as string, step: i as number, ...(b ? { base: b as number } : {}), commands: c as string[] }
    }
    return { mode: m, commands: c as string[] }
  } catch {
    return null
  }
}

/** start からコマンドを順に実行し直して、最後の Repo とログを返す。 */
export function replay(
  start: Repo,
  commands: readonly string[],
): { repo: Repo; log: ReplayedEntry[] } {
  let repo = start
  const log: ReplayedEntry[] = []
  for (const command of commands) {
    const result = executeCommand(repo, command)
    repo = result.repo
    log.push({ command: command.trim(), output: result.output, ok: result.ok })
  }
  return { repo, log }
}

export interface RestoredState {
  readonly mode: Mode
  /** お題モードのとき、puzzles の中の位置。 */
  readonly puzzleIndex: number
  /** チュートリアルのとき、LESSONS の中の位置と、今のステップ。 */
  readonly lessonIndex: number
  readonly step: number
  /** チュートリアルのとき、ログがどのステップの始めの状態から始まっているか。 */
  readonly base: number
  readonly repo: Repo
  readonly log: ReplayedEntry[]
}

/** 共有された状態を復元する。お題が見つからなければ null。 */
export function restoreShare(
  state: SharedState,
  puzzles: readonly BuiltPuzzle[],
): RestoredState | null {
  if (state.mode === 'free') {
    return { mode: 'free', puzzleIndex: 0, lessonIndex: 0, step: 0, base: 0, ...replay(createRepo(), state.commands) }
  }
  if (state.mode === 'tutorial') {
    const lessonIndex = LESSONS.findIndex((lesson) => lesson.id === state.lessonId)
    const lesson = LESSONS[lessonIndex]
    if (!lesson) return null
    const step = Math.min(state.step ?? 0, lesson.steps.length - 1)
    const base = Math.min(state.base ?? 0, step)
    return { mode: 'tutorial', puzzleIndex: 0, lessonIndex, step, base, ...replay(stepStartRepo(lesson, base), state.commands) }
  }
  const puzzleIndex = puzzles.findIndex((built) => built.puzzle.id === state.puzzleId)
  const built = puzzles[puzzleIndex]
  if (!built) return null
  return { mode: 'puzzle', puzzleIndex, lessonIndex: 0, step: 0, base: 0, ...replay(built.start, state.commands) }
}
