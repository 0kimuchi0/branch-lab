import { describe, expect, it } from 'vitest'
import { executeCommand } from '../git/commands'
import { createRepo, type Repo } from '../git/model'
import { run } from '../test/run'
import { LESSONS, isStepDone, type StepContext } from './lessons'

describe('LESSONS', () => {
  it('ID が重複していない', () => {
    expect(new Set(LESSONS.map((lesson) => lesson.id)).size).toBe(LESSONS.length)
  })

  for (const lesson of LESSONS) {
    it(`${lesson.title}: 各ステップは、始めたときは未達成で、例のコマンドで達成できる`, () => {
      let repo: Repo = run(lesson.setup, createRepo())
      for (const [index, step] of lesson.steps.entries()) {
        if (step.check === undefined) continue
        expect(isStepDone(step, repo, null), `${index + 1}. ${step.title} (始めたとき)`).toBe(false)
        let last: StepContext['last'] = null
        const commands = step.solution ?? step.commands ?? []
        for (const [i, command] of commands.entries()) {
          const result = executeCommand(repo, command)
          expect(result.ok, `${step.title}: ${command}\n${result.output}`).toBe(true)
          repo = result.repo
          last = { command, ok: result.ok }
          // 例のコマンドを最後まで実行する前に「できました」にならない
          if (i < commands.length - 1) expect(isStepDone(step, repo, last), `${index + 1}. ${step.title} (${command} のあと)`).toBe(false)
        }
        expect(isStepDone(step, repo, last), `${index + 1}. ${step.title}`).toBe(true)
      }
    })
  }
})
