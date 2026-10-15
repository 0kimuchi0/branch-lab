import type { Lesson } from '../tutorial/lessons'
import { InlineText, Paragraphs } from './RichText'

interface TutorialPanelProps {
  readonly lessons: readonly Lesson[]
  readonly lessonIndex: number
  readonly step: number
  /** 今のステップの課題を達成したか (読むだけのステップは true)。 */
  readonly done: boolean
  readonly completedIds: ReadonlySet<string>
  readonly onSelectLesson: (index: number) => void
  readonly onStep: (step: number) => void
  /** コマンドをターミナルの入力欄に入れる。 */
  readonly onInsert: (command: string) => void
  /** 最後のレッスンを終えたあと、お題に進む。 */
  readonly onFinish: () => void
}

export function TutorialPanel({
  lessons,
  lessonIndex,
  step,
  done,
  completedIds,
  onSelectLesson,
  onStep,
  onInsert,
  onFinish,
}: TutorialPanelProps) {
  const lesson = lessons[lessonIndex] as Lesson
  const current = lesson.steps[step]
  if (current === undefined) return null
  const isLastStep = step === lesson.steps.length - 1
  const isLastLesson = lessonIndex === lessons.length - 1
  const hasTask = current.check !== undefined

  return (
    <section className={done && hasTask ? 'tutorial done' : 'tutorial'} aria-label="チュートリアル">
      <div className="puzzle-nav">
        <button type="button" onClick={() => onSelectLesson(lessonIndex - 1)} disabled={lessonIndex === 0}>
          ← 前のレッスン
        </button>
        <select value={lessonIndex} onChange={(event) => onSelectLesson(Number(event.target.value))} aria-label="レッスンを選ぶ">
          {lessons.map((item, index) => (
            <option key={item.id} value={index}>
              {`${completedIds.has(item.id) ? '✓' : '　'} ${index + 1}. ${item.title}`}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => onSelectLesson(lessonIndex + 1)} disabled={isLastLesson}>
          次のレッスン →
        </button>
        <span className="puzzle-progress">
          {completedIds.size} / {lessons.length} レッスン完了
        </span>
      </div>

      <p className="tutorial-lesson">
        レッスン {lessonIndex + 1}: {lesson.title}
      </p>
      <ol className="tutorial-steps" aria-label="ステップ">
        {lesson.steps.map((item, index) => (
          <li key={index} className={index === step ? 'current' : index < step ? 'passed' : undefined}>
            <button type="button" onClick={() => onStep(index)} aria-current={index === step ? 'step' : undefined} title={item.title}>
              {index + 1}
            </button>
          </li>
        ))}
      </ol>

      <h2>{current.title}</h2>
      <div className="tutorial-body">
        <Paragraphs text={current.body} />
      </div>

      {hasTask && (
        <div className="tutorial-task">
          <h3>やってみよう</h3>
          <p>
            <InlineText text={current.task ?? ''} />
          </p>
          {current.commands && current.commands.length > 0 && (
            <ul className="tutorial-commands">
              {current.commands.map((command, index) => (
                <li key={index}>
                  <code>{command}</code>
                  <button type="button" onClick={() => onInsert(command)}>
                    入力欄に入れる
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="puzzle-status" role="status" aria-live="polite">
        {hasTask && (done ? <strong>できました！</strong> : <span>コマンドを入力して Enter を押しましょう</span>)}
        <span className="tutorial-buttons">
          <button type="button" onClick={() => onStep(step - 1)} disabled={step === 0}>
            ← 戻る
          </button>
          {!isLastStep && (
            <button type="button" className={done ? 'primary' : undefined} onClick={() => onStep(step + 1)}>
              {done ? '次へ →' : 'とばして次へ'}
            </button>
          )}
          {isLastStep && !isLastLesson && (
            <button type="button" className="primary" onClick={() => onSelectLesson(lessonIndex + 1)}>
              次のレッスンへ →
            </button>
          )}
          {isLastStep && isLastLesson && (
            <button type="button" className="primary" onClick={onFinish}>
              お題に挑戦する →
            </button>
          )}
        </span>
      </div>
    </section>
  )
}
