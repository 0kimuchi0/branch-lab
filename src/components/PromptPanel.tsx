import type { PatchPrompt } from '../git/model'

interface PromptPanelProps {
  readonly prompt: PatchPrompt
  /** 答えをコマンドとして実行する (y / n など)。 */
  readonly onAnswer: (answer: string) => void
}

const MODE_TEXT: Readonly<Record<PatchPrompt['mode'], string>> = {
  stage: 'ステージする',
  unstage: 'ステージを取り消す',
  discard: '作業ディレクトリから捨てる',
}

/** git add -p などの質問。ターミナルに答えを入力するか、ボタンで答える。 */
export function PromptPanel({ prompt, onAnswer }: PromptPanelProps) {
  const file = prompt.files[prompt.file]
  if (file === undefined) return null
  const verb = MODE_TEXT[prompt.mode]
  const answers: ReadonlyArray<readonly [string, string]> = [
    ['y', `はい (${verb})`],
    ['n', 'いいえ'],
    ['a', 'このファイルの残りはすべて「はい」'],
    ['d', 'このファイルの残りはすべて「いいえ」'],
    ...((file.hunks[prompt.hunk]?.length ?? 0) > 1 ? [['s', '小さなハンクに分ける'] as const] : []),
    ['q', '終わる'],
    ['?', 'ヘルプ'],
  ]
  return (
    <section className="editor patch-prompt" aria-label={`${prompt.command} の質問`}>
      <header className="editor-header">
        <h2>
          <code>{prompt.command}</code> の質問
        </h2>
        <span className="area-hint">
          {file.path} ({prompt.file + 1}/{prompt.files.length} ファイル目、ハンク {prompt.hunk + 1}/{file.hunks.length})
        </span>
      </header>
      <p className="editor-hint">
        ターミナルに表示した変更 (ハンク) を{verb}かを、1 つずつ答えます。ターミナルに y や n を入力するか、ボタンを押してください。
      </p>
      <div className="editor-actions">
        {answers.map(([key, label]) => (
          <button key={key} type="button" className={key === 'y' ? 'primary' : undefined} onClick={() => onAnswer(key)}>
            <code>{key}</code> {label}
          </button>
        ))}
      </div>
    </section>
  )
}
