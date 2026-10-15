import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { EditorPanel } from './components/EditorPanel'
import { PuzzlePanel } from './components/PuzzlePanel'
import { ShareButton } from './components/ShareButton'
import { Terminal, type LogEntry } from './components/Terminal'
import { Workspace } from './components/Workspace'
import { editorSaveCommand, executeCommand } from './git/commands'
import { activeRepo } from './git/submodule'
import { currentDirectory } from './git/worktree'
import { createRepo, currentBranch, headCommitIdOrNull, type Repo } from './git/model'
import { PUZZLES, buildPuzzle, isSolved, type BuiltPuzzle } from './puzzles/puzzles'
import {
  decodeShare,
  encodeShare,
  restoreShare,
  type Mode,
  type RestoredState,
  type SharedState,
} from './share/share'

interface Session {
  readonly repo: Repo
  readonly log: readonly LogEntry[]
}

type ShareNotice = 'loaded' | 'invalid' | null

/** URL のハッシュに共有された状態があれば復元する。 */
function restoreFromHash(
  hash: string,
  puzzles: readonly BuiltPuzzle[],
): { restored: RestoredState | null; notice: ShareNotice } {
  if (hash === '' || hash === '#') return { restored: null, notice: null }
  const shared = decodeShare(hash)
  const restored = shared && restoreShare(shared, puzzles)
  return restored ? { restored, notice: 'loaded' } : { restored: null, notice: 'invalid' }
}

function toSession(restored: RestoredState): Session {
  return { repo: restored.repo, log: restored.log.map((entry, id) => ({ ...entry, id })) }
}

function currentHash(): string {
  return typeof window === 'undefined' ? '' : window.location.hash
}

function shareUrl(hash: string): string {
  const { origin, pathname, search } = window.location
  return `${origin}${pathname}${search}${hash}`
}

const SOLVED_KEY = 'branchlab:solved'

function loadSolved(): Set<string> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(SOLVED_KEY) ?? '[]')
    return new Set(Array.isArray(saved) ? saved.filter((id) => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

function saveSolved(ids: ReadonlySet<string>): void {
  try {
    localStorage.setItem(SOLVED_KEY, JSON.stringify([...ids]))
  } catch {
    // 保存できない環境 (プライベートモードなど) では、その場限りの記録にする
  }
}

export default function App() {
  const puzzles = useMemo(() => PUZZLES.map(buildPuzzle), [])
  const [initial] = useState(() => restoreFromHash(currentHash(), puzzles))
  const restored = initial.restored
  const [mode, setMode] = useState<Mode>(restored?.mode ?? 'free')
  const [free, setFree] = useState<Session>(() =>
    restored?.mode === 'free' ? toSession(restored) : { repo: createRepo(), log: [] },
  )
  const [puzzleIndex, setPuzzleIndex] = useState(restored?.mode === 'puzzle' ? restored.puzzleIndex : 0)
  const [puzzle, setPuzzle] = useState<Session>(() =>
    restored?.mode === 'puzzle'
      ? toSession(restored)
      : { repo: (puzzles[0] as BuiltPuzzle).start, log: [] },
  )
  const [solvedIds, setSolvedIds] = useState(loadSolved)
  const [nextLogId, setNextLogId] = useState(restored?.log.length ?? 0)
  const [shareNotice, setShareNotice] = useState<ShareNotice>(initial.notice)

  const session = mode === 'free' ? free : puzzle
  const setSession = mode === 'free' ? setFree : setPuzzle
  const built = puzzles[puzzleIndex] as (typeof puzzles)[number]
  const solved = mode === 'puzzle' && isSolved(built, puzzle.repo)

  const run = (command: string) => {
    const result = executeCommand(session.repo, command)
    setSession({
      repo: result.repo,
      log: [
        ...session.log,
        { id: nextLogId, command: command.trim(), output: result.output, ok: result.ok },
      ],
    })
    setNextLogId((id) => id + 1)
    if (mode === 'puzzle' && !solvedIds.has(built.puzzle.id) && isSolved(built, result.repo)) {
      const next = new Set(solvedIds).add(built.puzzle.id)
      setSolvedIds(next)
      saveSolved(next)
    }
  }

  const reset = () => {
    setSession({ repo: mode === 'free' ? createRepo() : built.start, log: [] })
  }

  const selectPuzzle = (index: number) => {
    const target = puzzles[index]
    if (!target) return
    setPuzzleIndex(index)
    setPuzzle({ repo: target.start, log: [] })
  }

  const shared: SharedState = {
    mode,
    ...(mode === 'puzzle' ? { puzzleId: built.puzzle.id } : {}),
    commands: session.log.map((entry) => entry.command),
  }
  const hash = mode === 'free' && shared.commands.length === 0 ? '' : encodeShare(shared)

  // 操作するたびに URL を更新して、そのままコピーやリロードできるようにする
  useEffect(() => {
    const { pathname, search } = window.location
    if (window.location.hash === hash) return
    window.history.replaceState(null, '', `${pathname}${search}${hash}`)
  }, [hash])

  // 開いているタブに共有リンクを貼り付けたときも読み込む
  useEffect(() => {
    const onHashChange = () => {
      const next = restoreFromHash(window.location.hash, puzzles)
      setShareNotice(next.notice)
      if (!next.restored) return
      const loaded = next.restored
      setMode(loaded.mode)
      if (loaded.mode === 'free') {
        setFree(toSession(loaded))
      } else {
        setPuzzleIndex(loaded.puzzleIndex)
        setPuzzle(toSession(loaded))
      }
      setNextLogId(loaded.log.length)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [puzzles])

  // サブモジュールの中にいれば、画面にはそのサブモジュールを出す
  const active = activeRepo(session.repo)
  const branch = currentBranch(active)

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title">
          <h1>BranchLab</h1>
          <nav className="mode-tabs" aria-label="モード">
            <button
              type="button"
              aria-pressed={mode === 'free'}
              onClick={() => setMode('free')}
            >
              自由に試す
            </button>
            <button
              type="button"
              aria-pressed={mode === 'puzzle'}
              onClick={() => setMode('puzzle')}
            >
              お題
            </button>
          </nav>
        </div>
        <p>
          {mode === 'free'
            ? 'コマンドを入力して、ファイルとコミットグラフがどう変わるかを確かめよう'
            : '目標と同じ履歴になるように、コマンドを入力しよう'}
        </p>
        <div className="header-row">
          <p className="status" aria-live="polite">
            {(Object.keys(session.repo.worktrees).length > 0 || session.repo.submodule !== null || session.repo.clone !== null) &&
              `${currentDirectory(session.repo)} — `}
            HEAD: {branch ?? '(detached)'} @ {headCommitIdOrNull(active) ?? '(まだコミットなし)'}
          </p>
          <ShareButton getUrl={() => shareUrl(hash || encodeShare(shared))} />
        </div>
        {shareNotice && (
          <p className={`share-notice share-notice-${shareNotice}`} role="status">
            {shareNotice === 'loaded'
              ? '共有された状態を、コマンドを実行し直して再現しました。'
              : '共有リンクを読み込めませんでした。リンクが途中で切れていないか確認してください。'}
            <button type="button" onClick={() => setShareNotice(null)} aria-label="閉じる">
              ×
            </button>
          </p>
        )}
      </header>
      <main className="app-main">
        <div className="app-content">
          {mode === 'puzzle' && (
            <PuzzlePanel
              puzzles={puzzles}
              index={puzzleIndex}
              solved={solved}
              solvedIds={solvedIds}
              onSelect={selectPuzzle}
            />
          )}
          {active.editor && (
            <EditorPanel
              key={`${nextLogId}:${active.editor.text}`}
              editor={active.editor}
              onSave={(text) => run(editorSaveCommand(text === active.editor?.text ? undefined : text))}
            />
          )}
          <Workspace repo={active} />
        </div>
        <Terminal
          key={mode}
          log={session.log}
          onRun={run}
          onReset={reset}
          resetLabel={mode === 'free' ? 'リセット' : 'やり直す'}
          editorOpen={active.editor !== null}
        />
      </main>
    </div>
  )
}
