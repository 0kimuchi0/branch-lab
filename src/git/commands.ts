import {
  GitError,
  commit,
  createBranch,
  merge,
  reset,
  switchBranch,
  type Repo,
  type ResetMode,
} from './model'

export interface CommandResult {
  readonly repo: Repo
  readonly output: string
  readonly ok: boolean
}

export const HELP_TEXT = [
  '使えるコマンド:',
  '  commit [-m "メッセージ"]',
  '  branch <名前>',
  '  switch <名前>',
  '  switch -c <名前>',
  '  merge <名前>',
  '  reset [--soft | --mixed | --hard] [<コミット>]',
  '    <コミット> の例: C1, main, HEAD~1, HEAD^',
].join('\n')

/** 引用符で囲まれた文字列を 1 つのトークンとして扱う分割。 */
export function tokenize(input: string): string[] {
  const tokens: string[] = []
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g
  for (const match of input.matchAll(pattern)) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? '')
  }
  return tokens
}

function requireArg(args: string[], usage: string): string {
  const value = args[0]
  if (!value) throw new GitError(`使い方: ${usage}`)
  return value
}

function parseCommitMessage(args: string[]): string | undefined {
  if (args.length === 0) return undefined
  if (args[0] !== '-m') throw new GitError('使い方: commit [-m "メッセージ"]')
  const message = args[1]
  if (!message) throw new GitError('-m にはメッセージが必要です')
  return message
}

const RESET_USAGE = '使い方: reset [--soft | --mixed | --hard] [<コミット>]'

function parseReset(args: string[]): { target?: string; mode?: ResetMode } {
  let mode: ResetMode | undefined
  const targets: string[] = []
  for (const arg of args) {
    if (arg === '--soft' || arg === '--mixed' || arg === '--hard') {
      if (mode !== undefined) throw new GitError('reset のモードは 1 つだけ指定できます')
      mode = arg === '--soft' ? 'soft' : arg === '--mixed' ? 'mixed' : 'hard'
    } else if (arg.startsWith('-')) {
      throw new GitError(`未対応のオプションです: ${arg}\n${RESET_USAGE}`)
    } else {
      targets.push(arg)
    }
  }
  if (targets.length > 1) throw new GitError(RESET_USAGE)
  return { target: targets[0], mode }
}

/**
 * 入力された 1 行のコマンドを実行する。先頭の "git" は省略可能。
 * Git の規則に反する操作は例外にせず、ok: false と説明文で返す。
 */
export function executeCommand(repo: Repo, input: string): CommandResult {
  const tokens = tokenize(input)
  if (tokens[0] === 'git') tokens.shift()

  const [name, ...args] = tokens
  if (name === undefined) {
    return { repo, output: '', ok: true }
  }

  try {
    switch (name) {
      case 'commit': {
        return { ...commit(repo, parseCommitMessage(args)), ok: true }
      }
      case 'branch': {
        return {
          ...createBranch(repo, requireArg(args, 'branch <名前>')),
          ok: true,
        }
      }
      case 'switch': {
        if (args[0] === '-c') {
          return {
            ...switchBranch(repo, requireArg(args.slice(1), 'switch -c <名前>'), true),
            ok: true,
          }
        }
        return {
          ...switchBranch(repo, requireArg(args, 'switch <名前>')),
          ok: true,
        }
      }
      case 'merge': {
        return { ...merge(repo, requireArg(args, 'merge <名前>')), ok: true }
      }
      case 'reset': {
        const { target, mode } = parseReset(args)
        return { ...reset(repo, target, mode), ok: true }
      }
      case 'help': {
        return { repo, output: HELP_TEXT, ok: true }
      }
      default: {
        return {
          repo,
          output: `未対応のコマンドです: ${name}\n${HELP_TEXT}`,
          ok: false,
        }
      }
    }
  } catch (error) {
    if (error instanceof GitError) {
      return { repo, output: error.message, ok: false }
    }
    throw error
  }
}
