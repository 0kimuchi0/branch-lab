import { useState } from 'react'
import './App.css'
import { Terminal, type LogEntry } from './components/Terminal'
import { Workspace } from './components/Workspace'
import { executeCommand } from './git/commands'
import { createRepo, currentBranch, headCommitId } from './git/model'

export default function App() {
  const [repo, setRepo] = useState(createRepo)
  const [log, setLog] = useState<readonly LogEntry[]>([])
  const [nextLogId, setNextLogId] = useState(0)

  const run = (command: string) => {
    const result = executeCommand(repo, command)
    setRepo(result.repo)
    setLog((entries) => [
      ...entries,
      { id: nextLogId, command: command.trim(), output: result.output, ok: result.ok },
    ])
    setNextLogId((id) => id + 1)
  }

  const reset = () => {
    setRepo(createRepo())
    setLog([])
  }

  const branch = currentBranch(repo)

  return (
    <div className="app">
      <header className="app-header">
        <h1>BranchLab</h1>
        <p>コマンドを入力して、ファイルとコミットグラフがどう変わるかを確かめよう</p>
        <p className="status" aria-live="polite">
          HEAD: {branch ?? '(detached)'} @ {headCommitId(repo)}
        </p>
      </header>
      <main className="app-main">
        <Workspace repo={repo} />
        <Terminal log={log} onRun={run} onReset={reset} />
      </main>
    </div>
  )
}
