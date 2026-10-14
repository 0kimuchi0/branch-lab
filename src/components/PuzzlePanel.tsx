import { Fragment, useMemo } from 'react'
import { computeLayout, computeRemoteLayout } from '../graph/layout'
import { parseEditorSave } from '../git/commands'
import type { BuiltPuzzle } from '../puzzles/puzzles'
import { remoteNames } from '../view/workspace'
import { GraphView } from './GraphView'

/** 解答例の 1 行。エディタの保存は、書く内容がわかる形にする。 */
function solutionLine(command: string): string {
  const saved = parseEditorSave(command)
  if (!saved) return command
  if (saved.text === null) return '(エディタをそのまま保存して閉じる)'
  const body = saved.text.trimEnd().split('\n').map((line) => `    ${line}`).join('\n')
  return `(エディタを次の内容にして保存して閉じる)\n${body}`
}

interface PuzzlePanelProps {
  readonly puzzles: readonly BuiltPuzzle[]
  readonly index: number
  readonly solved: boolean
  readonly solvedIds: ReadonlySet<string>
  readonly onSelect: (index: number) => void
}

export function PuzzlePanel({ puzzles, index, solved, solvedIds, onSelect }: PuzzlePanelProps) {
  const built = puzzles[index] as BuiltPuzzle
  const { puzzle } = built
  const goal = built.goals[0] ?? built.start
  const local = useMemo(() => computeLayout(goal), [goal])
  const remotes = useMemo(
    () => remoteNames(goal).map((name) => ({ name, layout: computeRemoteLayout(goal, name) })),
    [goal],
  )
  const isLast = index === puzzles.length - 1

  return (
    <section className={solved ? 'puzzle solved' : 'puzzle'} aria-label="お題">
      <div className="puzzle-nav">
        <button type="button" onClick={() => onSelect(index - 1)} disabled={index === 0}>
          ← 前へ
        </button>
        <select
          value={index}
          onChange={(event) => onSelect(Number(event.target.value))}
          aria-label="お題を選ぶ"
        >
          {puzzles.map((item, i) => (
            <option key={item.puzzle.id} value={i}>
              {`${solvedIds.has(item.puzzle.id) ? '✓' : '　'} ${i + 1}. ${item.puzzle.title}`}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => onSelect(index + 1)} disabled={isLast}>
          次へ →
        </button>
        <span className="puzzle-progress">
          {solvedIds.size} / {puzzles.length} 問クリア
        </span>
      </div>

      <h2>
        {index + 1}. {puzzle.title}
      </h2>
      <p className="puzzle-description">{puzzle.description}</p>

      <div className="puzzle-help">
        <details>
          <summary>ヒント</summary>
          <p>{puzzle.hint}</p>
        </details>
        <details>
          <summary>解答例</summary>
          <pre>{(puzzle.solutions[0] ?? []).map(solutionLine).join('\n')}</pre>
        </details>
      </div>

      <div className="puzzle-goal">
        <h3>目標の履歴{puzzle.checkRemote ? ' (ローカル)' : ''}</h3>
        <GraphView layout={local} label="目標のローカルリポジトリのコミットグラフ" />
        {puzzle.checkRemote && (
          remotes.map(({ name, layout }) => (
            <Fragment key={name}>
              <h3>目標の履歴 (リモート {name})</h3>
              <GraphView layout={layout} label={`目標のリモートリポジトリ ${name} のコミットグラフ`} />
            </Fragment>
          ))
        )}
        <p className="puzzle-note">
          コミット ID やメッセージは違っていても、履歴の形と各コミットの由来が同じなら正解です。
        </p>
      </div>

      <div className="puzzle-status" role="status" aria-live="polite">
        {solved ? (
          <>
            <strong>正解です！</strong>
            {!isLast && (
              <button type="button" className="primary" onClick={() => onSelect(index + 1)}>
                次のお題へ
              </button>
            )}
          </>
        ) : (
          '目標と同じ履歴を作ってみましょう'
        )}
      </div>
    </section>
  )
}
