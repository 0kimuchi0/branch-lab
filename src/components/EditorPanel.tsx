import { useState } from 'react'
import type { Editor } from '../git/model'

interface EditorPanelProps {
  readonly editor: Editor
  /** 内容を保存して閉じる。text が undefined なら変更せずに閉じる。 */
  readonly onSave: (text?: string) => void
}

const HINTS: Readonly<Record<Editor['file'], string>> = {
  COMMIT_EDITMSG: '1 行目に件名、空行をはさんで本文を書きます。# で始まる行は無視され、空にするとコミットを中止します。',
  MERGE_MSG: 'マージコミットのメッセージです。そのまま閉じれば既定のメッセージになります。',
  'git-rebase-todo':
    '各行の pick を reword / edit / squash / fixup / drop に書き換えたり、行を並べ替えたりできます。上から順に実行されます。',
}

/** Git が開いたエディタ。保存して閉じると、Git が続きを実行する。 */
export function EditorPanel({ editor, onSave }: EditorPanelProps) {
  const [text, setText] = useState(editor.text)

  return (
    <section className="editor" aria-label={`エディタ: ${editor.file}`}>
      <header className="editor-header">
        <h2>
          エディタ <code>.git/{editor.file}</code>
        </h2>
        <span className="area-hint">Git がエディタを閉じるのを待っています</span>
      </header>
      <p className="editor-hint">{HINTS[editor.file]}</p>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            onSave(text)
          }
        }}
        rows={Math.min(18, Math.max(6, text.split('\n').length + 1))}
        spellCheck={false}
        aria-label="エディタの内容"
        autoFocus
      />
      <div className="editor-actions">
        <button type="button" className="primary" onClick={() => onSave(text)}>
          保存して閉じる
        </button>
        <button type="button" onClick={() => onSave()}>
          変更せずに閉じる
        </button>
        <span className="area-hint">Ctrl + Enter でも保存できます</span>
      </div>
    </section>
  )
}
