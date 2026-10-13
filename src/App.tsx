import { useMemo, useState } from 'react'
import './App.css'
import { PuzzlePanel } from './components/PuzzlePanel'
import { Terminal, type LogEntry } from './components/Terminal'
import { Workspace } from './components/Workspace'
import { executeCommand } from './git/commands'
import { createRepo, currentBranch, headCommitId, type Repo } from './git/model'
import { PUZZLES, buildPuzzle, isSolved } from './puzzles/puzzles'

type Mode = 'free' | 'puzzle'

interface Session {
  readonly repo: Repo
  readonly log: readonly LogEntry[]
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
  const [mode, setMode] = useState<Mode>('free')
  const [free, setFree] = useState<Session>(() => ({ repo: createRepo(), log: [] }))
  const [puzzleIndex, setPuzzleIndex] = useState(0)
  const [puzzle, setPuzzle] = useState<Session>(() => ({
    repo: (puzzles[0] as (typeof puzzles)[number]).start,
    log: [],
  }))
  const [solvedIds, setSolvedIds] = useState(loadSolved)
  const [nextLogId, setNextLogId] = useState(0)

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

  const branch = currentBranch(session.repo)

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
        <p className="status" aria-live="polite">
          HEAD: {branch ?? '(detached)'} @ {headCommitId(session.repo)}
        </p>
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
          <Workspace repo={session.repo} />
        </div>
        <Terminal
          key={mode}
          log={session.log}
          onRun={run}
          onReset={reset}
          resetLabel={mode === 'free' ? 'リセット' : 'やり直す'}
        />
      </main>
    </div>
  )
}
