import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { parseEditorSave } from '../git/commands'
import { starterSuggestions, suggest, type Suggestion } from '../terminal/suggest'

export interface LogEntry {
  readonly id: number
  readonly command: string
  readonly output: string
  readonly ok: boolean
}

interface TerminalProps {
  readonly log: readonly LogEntry[]
  readonly onRun: (command: string) => void
  readonly onReset: () => void
  readonly resetLabel: string
  /** エディタが開いている間は入力できない (Git がエディタを待っているため)。 */
  readonly editorOpen: boolean
  /** git add -p などの質問に答えている間 (入力は答えになる)。 */
  readonly promptOpen?: boolean
  /** 入力欄に入れるコマンド (チュートリアルやヘルプの「入力欄に入れる」)。id が変わるたびに入れる。 */
  readonly draft?: { readonly text: string; readonly id: number } | null
  /** ログが空のときに出す案内。 */
  readonly emptyHint?: string
}

/** 差分を出すコマンドかどうか (出力の +/- 行に色を付ける)。 */
function showsDiff(command: string): boolean {
  return /^(git\s+)?(diff|show|stash\s+show)\b/.test(command)
}

function diffLineClass(line: string): string | undefined {
  if (line.startsWith('diff --git') || line.startsWith('commit ')) return 'diff-header'
  if (line.startsWith('+++') || line.startsWith('---')) return 'diff-file'
  if (line.startsWith('@@')) return 'diff-hunk'
  if (line.startsWith('+')) return 'diff-add'
  if (line.startsWith('-')) return 'diff-del'
  return undefined
}

function Output({ entry }: { readonly entry: LogEntry }) {
  const className = entry.ok ? 'log-output' : 'log-output log-error'
  // git add -p などの答えにも差分 (@@ のハンク) が出るので、色を付ける
  const hasHunk = /^@@ /m.test(entry.output)
  if (!entry.ok || (!showsDiff(entry.command) && !hasHunk)) {
    return <pre className={className}>{entry.output}</pre>
  }
  return (
    <pre className={className}>
      {entry.output.split('\n').map((line, index) => (
        <span key={index} className={diffLineClass(line)}>
          {line}
          {'\n'}
        </span>
      ))}
    </pre>
  )
}

/** ログのコマンド行。エディタの保存は、保存した内容を折りたたんで表示する。 */
function CommandLine({ command }: { readonly command: string }) {
  const saved = parseEditorSave(command)
  if (!saved) {
    return (
      <div className="log-command">
        <span className="prompt">$</span> {command}
      </div>
    )
  }
  if (saved.text === null) {
    return <div className="log-command log-editor">(エディタを変更せずに閉じました)</div>
  }
  return (
    <details className="log-command log-editor">
      <summary>(エディタで編集して保存しました)</summary>
      <pre>{saved.text}</pre>
    </details>
  )
}

export function Terminal({ log, onRun, onReset, resetLabel, editorOpen, promptOpen = false, draft, emptyHint }: TerminalProps) {
  const [value, setValue] = useState('')
  const [cursor, setCursor] = useState<number | null>(null)
  // 候補の一覧: 入力に合う候補 (入力が空なら、↓ を押したときだけ最初に試す例)。選んでいる位置と、Esc で閉じたか
  const [starters, setStarters] = useState(false)
  const [active, setActive] = useState(-1)
  const [dismissed, setDismissed] = useState(false)
  const [focused, setFocused] = useState(false)
  const listId = useId()
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 「入力欄に入れる」で渡されたコマンドは、描画の途中で入力欄に反映する (渡されるたびに id が変わる)
  const [appliedDraft, setAppliedDraft] = useState<number | null>(null)
  if (draft && draft.id !== appliedDraft) {
    setAppliedDraft(draft.id)
    setValue(draft.text)
    setCursor(null)
    // 入れたコマンドはそのまま実行できるので、候補は出さない
    setDismissed(true)
  }
  const draftId = draft?.id
  useEffect(() => {
    if (draftId !== undefined) inputRef.current?.focus()
  }, [draftId])

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log])

  // エディタの保存はコマンドの履歴 (↑↓) に入れない
  const history = log.map((entry) => entry.command).filter((command) => parseEditorSave(command) === null)

  // 履歴を呼び出している間と、質問に答えている間は候補を出さない
  const suggestions: Suggestion[] =
    !focused || editorOpen || promptOpen || dismissed || cursor !== null ? []
    : value.trim() === '' ? (starters ? starterSuggestions() : [])
    : suggest(value)
  const open = suggestions.length > 0

  const closeSuggestions = () => {
    setStarters(false)
    setActive(-1)
  }

  const changeValue = (text: string) => {
    setValue(text)
    setCursor(null)
    setDismissed(false)
    setActive(-1)
  }

  /** 候補を入力欄に入れる (すぐには実行しない。直してから Enter で実行できる)。 */
  const accept = (item: Suggestion) => {
    setValue(item.command)
    setCursor(null)
    setDismissed(true)
    closeSuggestions()
    inputRef.current?.focus()
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (value.trim() === '') return
    onRun(value)
    setValue('')
    setCursor(null)
    setDismissed(false)
    closeSuggestions()
  }

  // 候補が出ているときは、上下キーで候補を選び、Enter / Tab で入力欄に入れ、Esc で閉じる。
  // 候補が出ていないときは、上下キーで過去に入力したコマンドを呼び出す (空の入力欄で ↓ なら、最初に試す例を出す)
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : -1
        // -1 (どれも選ばない) と各候補を順に回る
        const size = suggestions.length + 1
        setActive(((active + 1 + step + size) % size) - 1)
        return
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && active >= 0)) {
        const item = suggestions[active >= 0 ? active : 0]
        if (item) {
          event.preventDefault()
          accept(item)
        }
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setDismissed(true)
        closeSuggestions()
        return
      }
    }
    if (event.key === 'ArrowDown' && cursor === null && value.trim() === '' && !editorOpen && !promptOpen) {
      event.preventDefault()
      setStarters(true)
      setDismissed(false)
      setActive(0)
      return
    }
    if (event.key === 'ArrowUp' && history.length > 0) {
      event.preventDefault()
      const next = cursor === null ? history.length - 1 : Math.max(0, cursor - 1)
      setCursor(next)
      setValue(history[next] ?? '')
    } else if (event.key === 'ArrowDown' && cursor !== null) {
      event.preventDefault()
      const next = cursor + 1
      if (next >= history.length) {
        setCursor(null)
        setValue('')
      } else {
        setCursor(next)
        setValue(history[next] ?? '')
      }
    }
  }

  return (
    <section className="terminal" aria-label="コマンド入力">
      <div className="terminal-log" ref={logRef} aria-live="polite">
        {log.length === 0 && (
          <p className="terminal-hint">
            {emptyHint ?? 'コマンドを入力してみてください。入力すると候補が出ます。'}
            <br />
            <code>help</code> で使えるコマンドを、<code>help &lt;コマンド&gt;</code> でその説明を表示します。
          </p>
        )}
        {log.map((entry) => (
          <div key={entry.id} className="log-entry">
            <CommandLine command={entry.command} />
            {entry.output && <Output entry={entry} />}
          </div>
        ))}
      </div>

      <form className="terminal-form" onSubmit={submit}>
        {open && (
          <ul className="suggestions" id={listId} role="listbox" aria-label="コマンドの候補">
            {suggestions.map((item, index) => (
              <li
                key={item.command}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                className={index === active ? 'active' : undefined}
                // 入力欄からフォーカスを移さずに選ぶ
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => accept(item)}
              >
                <code>{item.command}</code>
                {item.description && <span>{item.description}</span>}
              </li>
            ))}
          </ul>
        )}
        <span className="prompt" aria-hidden="true">
          $
        </span>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(event) => changeValue(event.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            closeSuggestions()
          }}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          {...(open && active >= 0 ? { 'aria-activedescendant': `${listId}-${active}` } : {})}
          placeholder={
            editorOpen ? 'エディタを閉じるまで入力できません'
            : promptOpen ? '質問に答える (y / n / q / a / d / s / ?)'
            : '入力すると候補が出ます (空の欄で ↓ を押すと例)'
          }
          disabled={editorOpen}
          aria-label="Git コマンド"
          autoFocus
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <button type="submit" className="primary" disabled={editorOpen}>
          実行
        </button>
        <button type="button" onClick={onReset}>
          {resetLabel}
        </button>
      </form>
    </section>
  )
}
