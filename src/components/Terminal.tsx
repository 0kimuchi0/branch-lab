import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'

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
}

const EXAMPLES = [
  'echo "hello" >> README.md',
  'git add .',
  'git commit -m "update"',
  'git commit --allow-empty',
  'git switch -c feature',
  'git switch main',
  'git merge feature',
  'git rebase main',
  'git status',
] as const

export function Terminal({ log, onRun, onReset, resetLabel }: TerminalProps) {
  const [value, setValue] = useState('')
  const [cursor, setCursor] = useState<number | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log])

  const history = log.map((entry) => entry.command)

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
            コマンドを入力するか、下のボタンを押してみてください。
            <br />
            <code>help</code> で使えるコマンドを表示します。
          </p>
        )}
        {log.map((entry) => (
          <div key={entry.id} className="log-entry">
            <div className="log-command">
              <span className="prompt">$</span> {entry.command}
            </div>
            {entry.output && (
              <pre className={entry.ok ? 'log-output' : 'log-output log-error'}>
                {entry.output}
              </pre>
            )}
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
          type="text"
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            setCursor(null)
          }}
          onKeyDown={handleKeyDown}
          placeholder='git commit -m "メッセージ"'
          aria-label="Git コマンド"
          autoFocus
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <button type="submit" className="primary">
          実行
        </button>
        <button type="button" onClick={onReset}>
          {resetLabel}
        </button>
      </form>
    </section>
  )
}
