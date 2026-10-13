import { executeCommand } from '../git/commands'
import { createRepo, type Repo } from '../git/model'

/** コマンドを順に実行する。途中で失敗したら、そのコマンドと出力を含めて例外にする。 */
export function run(lines: readonly string[], repo: Repo = createRepo()): Repo {
  return lines.reduce((current, line) => {
    const result = executeCommand(current, line)
    if (!result.ok) throw new Error(`"${line}" が失敗しました:\n${result.output}`)
    return result.repo
  }, repo)
}

/** ファイルを 1 つ書き換えてコミットするコマンド列。 */
export function commitFile(file: string, text: string, message = text): string[] {
  return [`echo "${text}" >> ${file}`, `git add ${file}`, `git commit -m "${message}"`]
}
