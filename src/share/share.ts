/**
 * 現在の状態を URL で共有する。状態そのものではなく「モード・お題・入力したコマンドの列」を
 * URL のハッシュに入れ、開いた側で同じコマンドを実行し直して状態を再現する。
 * Repo はコマンドから決定的に作られるので、ログも含めて同じ画面になる。
 */
import { executeCommand } from '../git/commands'
import { createRepo, type Repo } from '../git/model'
import type { BuiltPuzzle } from '../puzzles/puzzles'

export type Mode = 'free' | 'puzzle'

export interface SharedState {
  readonly mode: Mode
  /** お題モードのときのお題の ID。 */
  readonly puzzleId?: string
  readonly commands: readonly string[]
}

export interface ReplayedEntry {
  readonly command: string
  readonly output: string
  readonly ok: boolean
}

const VERSION = 1
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
    const { v, m, p, c } = payload as Record<string, unknown>
    if (v !== VERSION || (m !== 'free' && m !== 'puzzle')) return null
    if (!Array.isArray(c) || c.length > MAX_COMMANDS) return null
    if (!c.every((command) => typeof command === 'string' && command.length <= MAX_COMMAND_LENGTH)) {
      return null
    }
    if (m === 'puzzle' && typeof p !== 'string') return null
    return m === 'puzzle'
      ? { mode: m, puzzleId: p as string, commands: c as string[] }
      : { mode: m, commands: c as string[] }
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
  readonly repo: Repo
  readonly log: ReplayedEntry[]
}

/** 共有された状態を復元する。お題が見つからなければ null。 */
export function restoreShare(
  state: SharedState,
  puzzles: readonly BuiltPuzzle[],
): RestoredState | null {
  if (state.mode === 'free') {
    return { mode: 'free', puzzleIndex: 0, ...replay(createRepo(), state.commands) }
  }
  const puzzleIndex = puzzles.findIndex((built) => built.puzzle.id === state.puzzleId)
  const built = puzzles[puzzleIndex]
  if (!built) return null
  return { mode: 'puzzle', puzzleIndex, ...replay(built.start, state.commands) }
}
