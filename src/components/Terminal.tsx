import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { parseEditorSave } from '../git/commands'

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
  if (!entry.ok || !showsDiff(entry.command)) {
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

const EXAMPLES = [
  'echo "hello" >> README.md',
  'git add .',
  'git commit -m "update"',
  'git commit --allow-empty -m "empty"',
  'git switch -c feature',
  'git switch main',
  'git merge feature',
  'git rebase main',
  'git rebase -i HEAD~2',
  'git status',
  'git diff',
] as const

export function Terminal({ log, onRun, onReset, resetLabel, editorOpen, draft, emptyHint }: TerminalProps) {
  const [value, setValue] = useState('')
  const [cursor, setCursor] = useState<number | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 「入力欄に入れる」で渡されたコマンドは、描画の途中で入力欄に反映する (渡されるたびに id が変わる)
  const [appliedDraft, setAppliedDraft] = useState<number | null>(null)
  if (draft && draft.id !== appliedDraft) {
    setAppliedDraft(draft.id)
    setValue(draft.text)
    setCursor(null)
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

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (value.trim() === '') return
    onRun(value)
    setValue('')
    setCursor(null)
  }

  // 上下キーで過去に入力したコマンドを呼び出す
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
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
            {emptyHint ?? 'コマンドを入力するか、下のボタンを押してみてください。'}
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

      <div className="examples">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            className="chip"
            onClick={() => onRun(example)}
            disabled={editorOpen}
          >
            {example}
          </button>
        ))}
      </div>

      <form className="terminal-form" onSubmit={submit}>
        <span className="prompt" aria-hidden="true">
          $
        </span>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            setCursor(null)
          }}
          onKeyDown={handleKeyDown}
          placeholder={editorOpen ? 'エディタを閉じるまで入力できません' : 'git commit -m "メッセージ"'}
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
