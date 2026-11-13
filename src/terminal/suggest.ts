/**
 * 入力欄のコマンドの候補 (サジェスト)。最初に試す例と、ヘルプの例 (説明つき) から探す。
 * React には依存させず、入力文字列から候補の並びを決める純粋関数にする。
 */
import { COMMAND_HELP } from '../help/commands'

export interface Suggestion {
  readonly command: string
  /** 何をするコマンドかの短い説明 (なければ空)。 */
  readonly description: string
}

/** 入力欄が空のときに ↓ で出す、最初に試す例。 */
export const STARTER_COMMANDS: readonly string[] = [
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
]

/** 候補の全体。最初に試す例を先に、そのあとにヘルプの例を並べる (同じコマンドは 1 つにまとめる)。 */
export function allSuggestions(): Suggestion[] {
  const fromHelp = COMMAND_HELP.flatMap((entry) => entry.examples.map(([command, description]) => ({ command, description })))
  const described = new Map(fromHelp.map((item) => [item.command, item.description]))
  const seen = new Set<string>()
  const result: Suggestion[] = []
  for (const item of [...STARTER_COMMANDS.map((command) => ({ command, description: described.get(command) ?? '' })), ...fromHelp]) {
    if (seen.has(item.command)) continue
    seen.add(item.command)
    result.push(item)
  }
  return result
}

const ALL = allSuggestions()

/**
 * 入力に合う候補を、合い方の強い順に最大 limit 件返す。
 * 1. 入力で始まる  2. 先頭の git を省いた入力で始まる (reb → git rebase)
 * 3. コマンドの単語の始まりに含む  4. 説明に含む (取り消す → git restore など)
 * 入力と同じコマンドしか合わないときは、候補を出さない。
 */
export function suggest(input: string, limit = 8, candidates: readonly Suggestion[] = ALL): Suggestion[] {
  const query = input.trim().toLowerCase().replace(/\s+/g, ' ')
  if (query === '') return []
  const rank = (item: Suggestion): number => {
    const command = item.command.toLowerCase()
    if (command.startsWith(query)) return 0
    if (command.startsWith(`git ${query}`)) return 1
    if (command.split(/\s+/).some((_, i, words) => words.slice(i).join(' ').startsWith(query))) return 2
    if (item.description.toLowerCase().includes(query)) return 3
    return -1
  }
  const matched = candidates
    .map((item, index) => ({ item, index, score: rank(item) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, limit)
    .map(({ item }) => item)
  if (matched.length === 1 && matched[0]?.command.toLowerCase() === query) return []
  return matched
}

/** 入力欄が空のときに出す候補 (最初に試す例)。 */
export function starterSuggestions(candidates: readonly Suggestion[] = ALL): Suggestion[] {
  return candidates.filter((item) => STARTER_COMMANDS.includes(item.command))
}
