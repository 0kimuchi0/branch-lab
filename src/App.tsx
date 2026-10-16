import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'
import { EditorPanel } from './components/EditorPanel'
import { HelpDialog } from './components/HelpDialog'
import { PromptPanel } from './components/PromptPanel'
import { PuzzlePanel } from './components/PuzzlePanel'
import { TutorialPanel } from './components/TutorialPanel'
import { ShareButton } from './components/ShareButton'
import { Terminal, type LogEntry } from './components/Terminal'
import { Workspace } from './components/Workspace'
import { editorSaveCommand, executeCommand } from './git/commands'
import { activeRepo } from './git/submodule'
import { currentDirectory } from './git/worktree'
import { createRepo, currentBranch, headCommitIdOrNull, type Repo } from './git/model'
import { PUZZLES, buildPuzzle, isSolved, type BuiltPuzzle } from './puzzles/puzzles'
import { LESSONS, isStepDone, lessonStart } from './tutorial/lessons'
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
const TUTORIAL_KEY = 'branchlab:tutorial'

function loadIds(key: string): Set<string> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    return new Set(Array.isArray(saved) ? saved.filter((id) => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

function saveIds(key: string, ids: ReadonlySet<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]))
  } catch {
    // 保存できない環境 (プライベートモードなど) では、その場限りの記録にする
  }
}

const DESCRIPTIONS: Readonly<Record<Mode, string>> = {
  free: 'コマンドを入力して、ファイルとコミットグラフがどう変わるかを確かめよう',
  tutorial: '説明を読みながら、Git の基本を 1 ステップずつ身につけよう',
  puzzle: '目標と同じ履歴になるように、コマンドを入力しよう',
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
  const [lessonIndex, setLessonIndex] = useState(restored?.mode === 'tutorial' ? restored.lessonIndex : 0)
  const [step, setStep] = useState(restored?.mode === 'tutorial' ? restored.step : 0)
  /** 今のステップに来たときのログの長さ (課題の判定に、そのあとのコマンドだけを使う)。 */
  const [stepStart, setStepStart] = useState(restored?.mode === 'tutorial' ? restored.log.length : 0)
  const [tutorial, setTutorial] = useState<Session>(() =>
    restored?.mode === 'tutorial'
      ? toSession(restored)
      : { repo: lessonStart(LESSONS[0] as (typeof LESSONS)[number]), log: [] },
  )
  const [solvedIds, setSolvedIds] = useState(() => loadIds(SOLVED_KEY))
  const [completedLessons, setCompletedLessons] = useState(() => loadIds(TUTORIAL_KEY))
  const [nextLogId, setNextLogId] = useState(restored?.log.length ?? 0)
  const [shareNotice, setShareNotice] = useState<ShareNotice>(initial.notice)
  const [helpOpen, setHelpOpen] = useState(false)
  const [draft, setDraft] = useState<{ text: string; id: number } | null>(null)

  const session = mode === 'free' ? free : mode === 'puzzle' ? puzzle : tutorial
  const setSession = mode === 'free' ? setFree : mode === 'puzzle' ? setPuzzle : setTutorial
  const built = puzzles[puzzleIndex] as (typeof puzzles)[number]
  const solved = mode === 'puzzle' && isSolved(built, puzzle.repo)
  const lesson = LESSONS[lessonIndex] as (typeof LESSONS)[number]
  const lastInStep = tutorial.log.length > stepStart ? tutorial.log.at(-1) : undefined
  const currentStep = lesson.steps[step]
  const stepDone =
    currentStep !== undefined &&
    isStepDone(currentStep, tutorial.repo, lastInStep ? { command: lastInStep.command, ok: lastInStep.ok } : null)

  const completeLesson = (id: string) => {
    if (completedLessons.has(id)) return
    const next = new Set(completedLessons).add(id)
    setCompletedLessons(next)
    saveIds(TUTORIAL_KEY, next)
  }

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
      saveIds(SOLVED_KEY, next)
    }
  }

  const reset = () => {
    if (mode === 'tutorial') {
      setTutorial({ repo: lessonStart(lesson), log: [] })
      setStep(0)
      setStepStart(0)
      return
    }
    setSession({ repo: mode === 'free' ? createRepo() : built.start, log: [] })
  }

  const selectLesson = (index: number) => {
    const target = LESSONS[index]
    if (!target) return
    setLessonIndex(index)
    setTutorial({ repo: lessonStart(target), log: [] })
    setStep(0)
    setStepStart(0)
  }

  const goStep = (index: number) => {
    if (index < 0 || index >= lesson.steps.length) return
    setStep(index)
    setStepStart(tutorial.log.length)
    if (index === lesson.steps.length - 1) completeLesson(lesson.id)
  }

  const insert = useCallback((text: string) => {
    setHelpOpen(false)
    setDraft((previous) => ({ text, id: (previous?.id ?? 0) + 1 }))
  }, [])
  const closeHelp = useCallback(() => setHelpOpen(false), [])

  // モードを変えたら、前のモードで入力欄に入れようとしていたコマンドは捨てる
  const changeMode = (next: Mode) => {
    setDraft(null)
    setMode(next)
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
    ...(mode === 'tutorial' ? { lessonId: lesson.id, step } : {}),
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
      } else if (loaded.mode === 'tutorial') {
        setLessonIndex(loaded.lessonIndex)
        setStep(loaded.step)
        setStepStart(loaded.log.length)
        setTutorial(toSession(loaded))
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
              onClick={() => changeMode('free')}
            >
              自由に試す
            </button>
            <button
              type="button"
              aria-pressed={mode === 'tutorial'}
              onClick={() => changeMode('tutorial')}
            >
              チュートリアル
            </button>
            <button
              type="button"
              aria-pressed={mode === 'puzzle'}
              onClick={() => changeMode('puzzle')}
            >
              お題
            </button>
          </nav>
        </div>
        <p>{DESCRIPTIONS[mode]}</p>
        <div className="header-row">
          <p className="status" aria-live="polite">
            {(Object.keys(session.repo.worktrees).length > 0 || session.repo.submodule !== null || session.repo.clone !== null) &&
              `${currentDirectory(session.repo)} — `}
            HEAD: {branch ?? '(detached)'} @ {headCommitIdOrNull(active) ?? '(まだコミットなし)'}
          </p>
          <span className="header-buttons">
            <button type="button" className="help-button" onClick={() => setHelpOpen(true)}>
              ヘルプ
            </button>
            <ShareButton getUrl={() => shareUrl(hash || encodeShare(shared))} />
          </span>
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
          {mode === 'tutorial' && (
            <TutorialPanel
              lessons={LESSONS}
              lessonIndex={lessonIndex}
              step={step}
              done={stepDone}
              completedIds={completedLessons}
              onSelectLesson={selectLesson}
              onStep={goStep}
              onInsert={insert}
              onFinish={() => changeMode('puzzle')}
            />
          )}
          {mode === 'puzzle' && (
            <PuzzlePanel
              puzzles={puzzles}
              index={puzzleIndex}
              solved={solved}
              solvedIds={solvedIds}
              onSelect={selectPuzzle}
            />
          )}
          {active.prompt && !active.editor && <PromptPanel prompt={active.prompt} onAnswer={run} />}
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
          promptOpen={active.prompt !== null}
          draft={draft}
          {...(mode === 'free' ? { emptyHint: 'はじめての方は、上の「チュートリアル」から始めましょう。コマンドを入力するか、下のボタンを押しても試せます。' } : {})}
        />
      </main>
      {helpOpen && (
        <HelpDialog
          onClose={closeHelp}
          onInsert={insert}
          onStartTutorial={() => {
            setHelpOpen(false)
            changeMode('tutorial')
          }}
        />
      )}
    </div>
  )
}
