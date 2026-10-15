import { useEffect, useMemo, useRef, useState } from 'react'
import { CATEGORY_LABELS, COMMAND_HELP, displayName, type CommandHelp, type HelpCategory } from '../help/commands'
import { InlineText, Paragraphs } from './RichText'

interface HelpDialogProps {
  readonly onClose: () => void
  /** コマンドをターミナルの入力欄に入れる (ダイアログは閉じる)。 */
  readonly onInsert: (command: string) => void
  /** チュートリアルを始める。 */
  readonly onStartTutorial: () => void
}

/** はじめに見るとよいコマンド。 */
const BASICS = ['status', 'add', 'commit', 'log', 'diff', 'switch', 'merge', 'push', 'pull', 'restore', 'reset', 'stash']

function matches(entry: CommandHelp, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  // 分類の名前 (取り消す・戻す など) や例の説明でも探せるようにする
  const text = [
    displayName(entry),
    CATEGORY_LABELS[entry.category],
    entry.summary,
    entry.description,
    ...entry.usage,
    ...(entry.options ?? []).flat(),
    ...entry.examples.flat(),
  ]
    .join('\n')
    .toLowerCase()
  return words.every((word) => text.includes(word))
}

function Detail({ entry, onSelect, onInsert }: { readonly entry: CommandHelp; readonly onSelect: (name: string) => void; readonly onInsert: (command: string) => void }) {
  return (
    <article className="help-detail" aria-label={`${displayName(entry)} の説明`}>
      <h3>
        <code>{displayName(entry)}</code> <span>{entry.summary}</span>
      </h3>
      <h4>使い方</h4>
      <pre>{entry.usage.join('\n')}</pre>
      <Paragraphs text={entry.description} />
      {entry.options && entry.options.length > 0 && (
        <>
          <h4>よく使うオプション</h4>
          <dl className="help-options">
            {entry.options.map(([option, text]) => (
              <div key={option}>
                <dt>
                  <code>{option}</code>
                </dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
      <h4>例</h4>
      <ul className="help-examples">
        {entry.examples.map(([command, text]) => (
          <li key={command}>
            <code>{command}</code>
            <span>{text}</span>
            <button type="button" onClick={() => onInsert(command)}>
              入力欄に入れる
            </button>
          </li>
        ))}
      </ul>
      {entry.related && entry.related.length > 0 && (
        <p className="help-related">
          関連:
          {entry.related.map((name) => {
            const other = COMMAND_HELP.find((item) => item.name === name)
            return other ? (
              <button key={name} type="button" className="link" onClick={() => onSelect(name)}>
                {displayName(other)}
              </button>
            ) : null
          })}
        </p>
      )}
    </article>
  )
}

export function HelpDialog({ onClose, onInsert, onStartTutorial }: HelpDialogProps) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const detailRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    searchRef.current?.focus()
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const found = useMemo(() => COMMAND_HELP.filter((entry) => matches(entry, query)), [query])
  const entry = COMMAND_HELP.find((item) => item.name === selected)
  const select = (name: string) => {
    setSelected(name)
    detailRef.current?.scrollTo({ top: 0 })
  }

  return (
    <div className="help-backdrop" onClick={onClose}>
      <div className="help-dialog" role="dialog" aria-modal="true" aria-label="コマンドのヘルプ" onClick={(event) => event.stopPropagation()}>
        <header className="help-header">
          <h2>コマンドのヘルプ</h2>
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="コマンドや、やりたいことで探す (例: 取り消す)"
            aria-label="ヘルプを検索"
          />
          <button type="button" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </header>
        <div className="help-body">
          <nav className="help-list" aria-label="コマンドの一覧">
            {(Object.entries(CATEGORY_LABELS) as Array<[HelpCategory, string]>).map(([category, label]) => {
              const entries = found.filter((item) => item.category === category)
              if (entries.length === 0) return null
              return (
                <section key={category}>
                  <h3>{label}</h3>
                  <ul>
                    {entries.map((item) => (
                      <li key={item.name}>
                        <button type="button" aria-current={item.name === selected ? 'true' : undefined} onClick={() => select(item.name)}>
                          <code>{displayName(item)}</code>
                          <span>{item.summary}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
            {found.length === 0 && <p className="help-empty">見つかりませんでした</p>}
          </nav>
          <div className="help-main" ref={detailRef}>
            {entry ? (
              <Detail entry={entry} onSelect={select} onInsert={onInsert} />
            ) : (
              <article className="help-intro">
                <h3>はじめての方へ</h3>
                <p>
                  <InlineText text="ファイルを作ったり変えたりしたら、`git add` でステージし、`git commit` で記録します。今の状態は `git status` でいつでも確かめられます。" />
                </p>
                <p>順を追って学ぶなら、チュートリアルから始めましょう。</p>
                <button type="button" className="primary" onClick={onStartTutorial}>
                  チュートリアルを始める
                </button>
                <h4>まず覚えたいコマンド</h4>
                <ul className="help-basics">
                  {BASICS.map((name) => {
                    const item = COMMAND_HELP.find((other) => other.name === name)
                    return item ? (
                      <li key={name}>
                        <button type="button" className="link" onClick={() => select(name)}>
                          <code>{displayName(item)}</code>
                        </button>
                        {item.summary}
                      </li>
                    ) : null
                  })}
                </ul>
                <p>
                  <InlineText text="ターミナルでも `help` で一覧を、`help <コマンド>` や `git <コマンド> -h` で説明を表示できます。" />
                </p>
              </article>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
