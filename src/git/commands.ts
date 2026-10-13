import {
  abortOperation,
  cherryPick,
  continueOperation,
  merge,
  rebase,
  rebaseInteractive,
  revert,
  saveEditor,
  skipOperation,
} from './history'
import {
  GitError,
  REMOTE_NAME,
  add,
  commit,
  createBranch,
  deleteBranch,
  detachHead,
  gitRemove,
  hasTrackedChanges,
  listBranches,
  listFiles,
  log,
  readFile,
  removeFile,
  renameBranch,
  reset,
  resetPaths,
  restore,
  setUpstream,
  status,
  switchBranch,
  touchFile,
  tryResolveRef,
  writeFile,
  type OperationResult,
  type Repo,
  type ResetMode,
} from './model'
import { gitDiff, show } from './inspect'
import { createTag, deleteTags, listTags } from './tag'
import { fetch, pull, push, pushDelete, pushTags, teammateCommit } from './remote'
import {
  stashApply,
  stashBranch,
  stashClear,
  stashDrop,
  stashList,
  stashPop,
  stashPush,
  stashShow,
} from './stash'

export interface CommandResult {
  readonly repo: Repo
  readonly output: string
  readonly ok: boolean
}

export const HELP_TEXT = [
  'ファイルの操作 (シェルのコマンド):',
  '  echo "内容" > ファイル     ファイルを上書きする (>> なら追記)',
  '  touch / cat / ls / rm      作成・表示・一覧・削除',
  '',
  'Git のコマンド (先頭の git は省略できます。rm だけは git rm と区別します):',
  '  status / log [--oneline] [--all]',
  '  diff [--staged] [<コミット> [<コミット>]] [--stat] [-- <ファイル>] / show [<コミット>]',
  '  add <ファイル>... / add .        restore [--staged] <ファイル>...',
  '  commit [-m "メッセージ"] [-a] [--allow-empty] [--amend] [--no-edit]',
  '  (-m を付けないとエディタが開きます。merge・revert・--continue なども同じです)',
  '  branch [<名前> [<起点>]] / branch -d <名前> / branch -m <新しい名前>',
  '  switch <名前> / switch -c <名前> / switch --detach <コミット>',
  '  checkout <名前|コミット> / checkout -b <名前>',
  '  merge <ブランチ> [--no-ff] [--no-edit] / rebase [-i] [-x <コマンド>] <ブランチ>',
  '  cherry-pick [-e] [-m <親>] [--allow-empty] <コミット>... / revert [--no-edit] [-m <親>] <コミット>...',
  '  reset [--soft | --mixed | --hard] [<コミット>]',
  '  tag [-a] [-m "…"] [-f] <タグ> [<コミット>] / tag -l [<パターン>] / tag -d <タグ>',
  '  stash [push [-m "…"] [-u] [-k]] / stash list / show [-p] / apply / pop [--index] / drop / clear / branch',
  '  push [-u] [-f] [--tags] [origin <ブランチ|タグ>] / push origin --delete <名前>',
  '  fetch / pull [--rebase | --no-rebase]',
  '  (merge / rebase / cherry-pick / revert は --continue・--abort が使えます)',
  '',
  '<コミット> の例: C1, main, origin/main, HEAD~1, HEAD^2',
  '',
  'このアプリ独自のコマンド:',
  '  teammate [<ブランチ>]   他の人が origin に push したことにする',
].join('\n')

interface Token {
  readonly value: string
  /** 引用符で囲まれていたか (囲まれた > はリダイレクトとみなさない)。 */
  readonly quoted: boolean
}

function lex(input: string): Token[] {
  const tokens: Token[] = []
  const pattern = /"([^"]*)"|'([^']*)'|(>>|>)|([^\s"'>]+)/g
  for (const match of input.matchAll(pattern)) {
    const quoted = match[1] ?? match[2]
    tokens.push(
      quoted === undefined
        ? { value: match[3] ?? match[4] ?? '', quoted: false }
        : { value: quoted, quoted: true },
    )
  }
  return tokens
}

/** 引用符で囲まれた文字列を 1 つのトークンとして扱う分割。 */
export function tokenize(input: string): string[] {
  return lex(input).map((token) => token.value)
}

interface ParsedArgs {
  readonly flags: ReadonlySet<string>
  /** 値をとるオプションの最後の値。 */
  readonly values: ReadonlyMap<string, string>
  /** 値をとるオプションのすべての値 (git commit -m を複数書いた場合など)。 */
  readonly allValues: ReadonlyMap<string, readonly string[]>
  readonly positional: readonly string[]
  /** -- より後ろの引数 (なければ null)。 */
  readonly paths: readonly string[] | null
}

/**
 * オプションを解析する。flags は値をとらないオプション、values は値をとるオプション。
 * 名前が違うだけで同じ意味のオプションは aliases で正規化する。
 */
function parseArgs(
  args: readonly string[],
  spec: {
    readonly flags?: readonly string[]
    readonly values?: readonly string[]
    readonly aliases?: Readonly<Record<string, string>>
  },
): ParsedArgs {
  const flags = new Set<string>()
  const values = new Map<string, string>()
  const allValues = new Map<string, string[]>()
  const positional: string[] = []
  let paths: string[] | null = null
  const normalize = (name: string) => spec.aliases?.[name] ?? name

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string
    if (paths !== null) {
      paths.push(arg)
      continue
    }
    if (arg === '--') {
      paths = []
      continue
    }
    if (!arg.startsWith('-') || arg === '-') {
      positional.push(arg)
      continue
    }
    const [rawName = '', inline] = arg.split(/=(.*)/s)
    const name = normalize(rawName)
    if (spec.values?.includes(name)) {
      const value = inline ?? args[++i]
      if (value === undefined) throw new GitError(`error: ${rawName} には値が必要です`)
      values.set(name, value)
      allValues.set(name, [...(allValues.get(name) ?? []), value])
    } else if (spec.flags?.includes(name) && inline === undefined) {
      flags.add(name)
    } else {
      throw new GitError(`error: 未対応のオプションです: ${arg}`)
    }
  }
  return { flags, values, allValues, positional, paths }
}

function usage(text: string): never {
  throw new GitError(`使い方: ${text}`)
}

function atMost(parsed: ParsedArgs, count: number, text: string): void {
  if (parsed.positional.length > count) usage(text)
}

/** --continue / --abort / --skip のどれかが指定されていれば、その操作を実行する。 */
function sequencerControl(
  repo: Repo,
  type: 'merge' | 'cherry-pick' | 'revert' | 'rebase',
  parsed: ParsedArgs,
): OperationResult | null {
  if (parsed.flags.has('--continue')) return continueOperation(repo, type)
  if (parsed.flags.has('--abort')) return abortOperation(repo, type)
  if (parsed.flags.has('--skip')) {
    if (type === 'merge') throw new GitError('error: 未対応のオプションです: --skip')
    return skipOperation(repo, type)
  }
  return null
}

const CONTROL_FLAGS = ['--continue', '--abort', '--skip']

/** -m <親の番号> を読む。 */
function parseMainline(parsed: ParsedArgs): number | undefined {
  const value = parsed.values.get('-m')
  if (value === undefined) return undefined
  if (!/^[1-9]\d*$/.test(value)) throw new GitError(`error: -m には親の番号 (1 以上の整数) を指定してください: ${value}`)
  return Number(value)
}

function runCommit(repo: Repo, args: readonly string[]): OperationResult {
  // -am "msg" は -a -m "msg" と同じ
  const expanded = args.flatMap((arg) => (/^-[a-z]{2,}$/.test(arg) ? [...arg.slice(1)].map((c) => `-${c}`) : [arg]))
  const parsed = parseArgs(expanded, {
    flags: ['-a', '--allow-empty', '--amend', '--no-edit'],
    values: ['-m'],
    aliases: { '--all': '-a', '--message': '-m' },
  })
  atMost(parsed, 0, 'git commit [-a] [-m "メッセージ"] [--allow-empty] [--amend] [--no-edit]')
  // -m を複数書くと、それぞれが段落になる
  const messages = parsed.allValues.get('-m')
  const message = messages?.map((part) => part.trim()).join('\n\n')
  if (message !== undefined && message.trim() === '') {
    throw new GitError('メッセージが空のため、コミットを中止しました')
  }
  return commit(repo, {
    ...(message === undefined ? {} : { message }),
    all: parsed.flags.has('-a'),
    allowEmpty: parsed.flags.has('--allow-empty'),
    amend: parsed.flags.has('--amend'),
    noEdit: parsed.flags.has('--no-edit'),
  })
}

function runBranch(repo: Repo, args: readonly string[]): OperationResult {
  const parsed = parseArgs(args, {
    flags: ['-d', '-D', '-m', '-a', '-r', '--list'],
    values: ['-u'],
    aliases: { '--delete': '-d', '--move': '-m', '--all': '-a', '--remotes': '-r', '--set-upstream-to': '-u' },
  })
  const [first, second] = parsed.positional
  const upstream = parsed.values.get('-u')
  if (upstream !== undefined) {
    atMost(parsed, 1, 'git branch -u origin/<ブランチ> [<ブランチ>]')
    return setUpstream(repo, upstream, first)
  }
  if (parsed.flags.has('-d') || parsed.flags.has('-D')) {
    if (parsed.positional.length === 0) usage('git branch -d <ブランチ>...')
    let current = repo
    const lines: string[] = []
    for (const name of parsed.positional) {
      const result = deleteBranch(current, name, parsed.flags.has('-D'))
      current = result.repo
      lines.push(result.output)
    }
    return { repo: current, output: lines.join('\n') }
  }
  if (parsed.flags.has('-m')) {
    atMost(parsed, 2, 'git branch -m [<古い名前>] <新しい名前>')
    if (first === undefined) usage('git branch -m [<古い名前>] <新しい名前>')
    if (second === undefined) {
      const current = repo.head.type === 'branch' ? repo.head.name : null
      if (current === null) throw new GitError('fatal: detached HEAD ではブランチ名を変更できません')
      return renameBranch(repo, current, first)
    }
    return renameBranch(repo, first, second)
  }
  if (first === undefined || parsed.flags.has('--list')) {
    return { repo, output: listBranches(repo, { remotes: parsed.flags.has('-a') || parsed.flags.has('-r') }) }
  }
  atMost(parsed, 2, 'git branch <名前> [<起点>]')
  return createBranch(repo, first, second)
}

function runSwitch(repo: Repo, args: readonly string[]): OperationResult {
  const parsed = parseArgs(args, {
    flags: ['--detach'],
    values: ['-c', '-C'],
    aliases: { '--create': '-c', '-d': '--detach' },
  })
  const created = parsed.values.get('-c') ?? parsed.values.get('-C')
  if (created !== undefined) {
    atMost(parsed, 1, 'git switch -c <名前> [<起点>]')
    const startPoint = parsed.positional[0]
    return switchBranch(repo, created, {
      create: true,
      ...(startPoint === undefined ? {} : { startPoint }),
    })
  }
  atMost(parsed, 1, 'git switch <ブランチ>')
  const target = parsed.positional[0]
  if (parsed.flags.has('--detach')) return detachHead(repo, target ?? 'HEAD')
  if (target === undefined) usage('git switch <ブランチ>')
  if (!(target in repo.branches) && !(target in repo.remoteBranches) && tryResolveRef(repo, target)) {
    throw new GitError(
      `fatal: ブランチを指定してください。コミット '${target}' に移動するには git switch --detach ${target} を使います`,
    )
  }
  return switchBranch(repo, target)
}

function runCheckout(repo: Repo, args: readonly string[]): OperationResult {
  const parsed = parseArgs(args, { flags: ['--detach'], values: ['-b', '-B'] })
  if (parsed.paths !== null) {
    if (parsed.positional.length > 0) {
      return restore(repo, parsed.paths, { source: parsed.positional[0] as string })
    }
    return restore(repo, parsed.paths)
  }
  const created = parsed.values.get('-b') ?? parsed.values.get('-B')
  if (created !== undefined) {
    atMost(parsed, 1, 'git checkout -b <名前> [<起点>]')
    const startPoint = parsed.positional[0]
    return switchBranch(repo, created, {
      create: true,
      ...(startPoint === undefined ? {} : { startPoint }),
    })
  }
  atMost(parsed, 1, 'git checkout <ブランチ|コミット>')
  const target = parsed.positional[0]
  if (target === undefined) usage('git checkout <ブランチ|コミット>')
  if (!parsed.flags.has('--detach') && (target in repo.branches || target in repo.remoteBranches)) {
    return switchBranch(repo, target)
  }
  if (tryResolveRef(repo, target) !== null) return detachHead(repo, target)
  if (target in repo.index || target in repo.workdir) return restore(repo, [target])
  throw new GitError(`error: pathspec '${target}' はどのファイルやブランチにも一致しません`)
}

function runReset(repo: Repo, args: readonly string[]): OperationResult {
  const parsed = parseArgs(args, { flags: ['--soft', '--mixed', '--hard'] })
  const modes = (['soft', 'mixed', 'hard'] as const).filter((mode) => parsed.flags.has(`--${mode}`))
  if (modes.length > 1) throw new GitError('fatal: reset のモードは 1 つだけ指定できます')
  const mode: ResetMode | undefined = modes[0]
  const [target, ...rest] = parsed.positional

  if (parsed.paths !== null || (target !== undefined && tryResolveRef(repo, target) === null)) {
    if (mode !== undefined) {
      throw new GitError(`fatal: --${mode} はファイルを指定した reset では使えません`)
    }
    if (parsed.paths !== null) {
      if (parsed.positional.length > 0) usage('git reset [--] <ファイル>...')
      return resetPaths(repo, parsed.paths)
    }
    return resetPaths(repo, parsed.positional)
  }
  if (rest.length > 0) usage('git reset [--soft | --mixed | --hard] [<コミット>]')
  return reset(repo, target, mode)
}

function runRestore(repo: Repo, args: readonly string[]): OperationResult {
  const parsed = parseArgs(args, {
    flags: ['--staged', '--worktree'],
    values: ['--source'],
    aliases: { '-S': '--staged', '-W': '--worktree', '-s': '--source' },
  })
  const paths = [...parsed.positional, ...(parsed.paths ?? [])]
  const source = parsed.values.get('--source')
  const staged = parsed.flags.has('--staged')
  if (staged && parsed.flags.has('--worktree')) {
    const first = restore(repo, paths, { staged: true, ...(source === undefined ? {} : { source }) })
    return restore(first.repo, paths, { source: source ?? 'HEAD' })
  }
  return restore(repo, paths, { staged, ...(source === undefined ? {} : { source }) })
}

function runTag(repo: Repo, args: readonly string[]): OperationResult {
  const parsed = parseArgs(args, {
    flags: ['-a', '-d', '-f', '-l'],
    values: ['-m'],
    aliases: { '--annotate': '-a', '--delete': '-d', '--force': '-f', '--list': '-l', '--message': '-m' },
  })
  if (parsed.flags.has('-d')) return deleteTags(repo, parsed.positional)
  const [name, target, ...rest] = parsed.positional
  if (name === undefined || parsed.flags.has('-l')) {
    atMost(parsed, 1, 'git tag -l [<パターン>]')
    return listTags(repo, name)
  }
  if (rest.length > 0) usage('git tag [-a] [-m "メッセージ"] [-f] <タグ> [<コミット>]')
  const message = parsed.values.get('-m')
  return createTag(repo, name, {
    ...(target === undefined ? {} : { target }),
    ...(message === undefined ? {} : { message }),
    annotate: parsed.flags.has('-a'),
    force: parsed.flags.has('-f'),
  })
}

function runStash(repo: Repo, args: readonly string[]): OperationResult {
  const [sub = 'push', ...rest] = args[0]?.startsWith('-') ? ['push', ...args] : args
  switch (sub) {
    case 'push':
    case 'save': {
      const parsed = parseArgs(rest, {
        flags: ['-u', '-k'],
        values: ['-m'],
        aliases: { '--include-untracked': '-u', '--keep-index': '-k', '--message': '-m' },
      })
      if (parsed.paths !== null || (sub === 'push' && parsed.positional.length > 0)) {
        throw new GitError('ファイルを指定した git stash push はこのアプリでは未対応です')
      }
      const message = parsed.values.get('-m') ?? (sub === 'save' ? parsed.positional.join(' ') : undefined)
      return stashPush(repo, {
        ...(message ? { message } : {}),
        includeUntracked: parsed.flags.has('-u'),
        keepIndex: parsed.flags.has('-k'),
      })
    }
    case 'list':
      parseArgs(rest, { flags: [] })
      return stashList(repo)
    case 'show': {
      const parsed = parseArgs(rest, { flags: ['-p', '--stat'], aliases: { '--patch': '-p' } })
      atMost(parsed, 1, 'git stash show [-p] [stash@{n}]')
      return stashShow(repo, parsed.positional[0], { patch: parsed.flags.has('-p') })
    }
    case 'apply':
    case 'pop': {
      const parsed = parseArgs(rest, { flags: ['--index'] })
      atMost(parsed, 1, `git stash ${sub} [--index] [stash@{n}]`)
      const options = { index: parsed.flags.has('--index') }
      return sub === 'pop'
        ? stashPop(repo, parsed.positional[0], options)
        : stashApply(repo, parsed.positional[0], options)
    }
    case 'drop': {
      const parsed = parseArgs(rest, { flags: [] })
      atMost(parsed, 1, 'git stash drop [stash@{n}]')
      return stashDrop(repo, parsed.positional[0])
    }
    case 'clear':
      parseArgs(rest, { flags: [] })
      return stashClear(repo)
    case 'branch': {
      const parsed = parseArgs(rest, { flags: [] })
      const [name, ref] = parsed.positional
      if (name === undefined || parsed.positional.length > 2) usage('git stash branch <ブランチ> [stash@{n}]')
      return stashBranch(repo, name, ref)
    }
    default:
      throw new GitError(`error: 未対応の stash のサブコマンドです: ${sub}`)
  }
}

function parseRemoteArgs(positional: readonly string[], text: string): string | undefined {
  const [remote, branch, ...rest] = positional
  if (rest.length > 0) usage(text)
  if (remote !== undefined && remote !== REMOTE_NAME) {
    throw new GitError(`fatal: '${remote}' というリモートはありません (使えるのは ${REMOTE_NAME} だけです)`)
  }
  return branch
}

function runPush(repo: Repo, args: readonly string[]): OperationResult {
  const parsed = parseArgs(args, {
    flags: ['-u', '-f', '--tags', '-d'],
    aliases: { '--set-upstream': '-u', '--force': '-f', '--delete': '-d' },
  })
  const text = 'git push [-u] [-f] [--tags] [origin [<ブランチ|タグ>]] / git push origin --delete <名前>'
  const branch = parseRemoteArgs(parsed.positional, text)
  if (parsed.flags.has('-d')) {
    if (branch === undefined) usage(text)
    return pushDelete(repo, branch)
  }
  if (parsed.flags.has('--tags')) {
    if (branch !== undefined) usage(text)
    return pushTags(repo, Object.keys(repo.tags).sort(), { force: parsed.flags.has('-f') })
  }
  return push(repo, {
    ...(branch === undefined ? {} : { branch }),
    explicit: branch !== undefined,
    force: parsed.flags.has('-f'),
    setUpstream: parsed.flags.has('-u'),
  })
}

function runPull(repo: Repo, args: readonly string[]): OperationResult {
  const parsed = parseArgs(args, {
    flags: ['--rebase', '--no-rebase', '--ff-only', '--no-edit'],
    aliases: { '-r': '--rebase' },
  })
  const branch = parseRemoteArgs(parsed.positional, 'git pull [--rebase | --no-rebase] [origin]')
  if (branch !== undefined) {
    throw new GitError('このアプリの pull では、ブランチを指定せずに upstream から取り込みます')
  }
  if (parsed.flags.has('--rebase') && parsed.flags.has('--no-rebase')) {
    throw new GitError('fatal: --rebase と --no-rebase は同時に指定できません')
  }
  return pull(repo, {
    ...(parsed.flags.has('--rebase') ? { rebase: true } : {}),
    ...(parsed.flags.has('--no-rebase') ? { rebase: false } : {}),
    fastForwardOnly: parsed.flags.has('--ff-only'),
    noEdit: parsed.flags.has('--no-edit'),
  })
}

function runGit(repo: Repo, name: string, args: readonly string[]): OperationResult {
  switch (name) {
    case 'status':
      parseArgs(args, { flags: [] })
      return status(repo)
    case 'log': {
      const parsed = parseArgs(args, { flags: ['--oneline', '--all', '--graph'] })
      atMost(parsed, 1, 'git log [--oneline] [--all] [<コミット>]')
      const start = parsed.positional[0]
      return log(repo, {
        oneline: parsed.flags.has('--oneline'),
        all: parsed.flags.has('--all'),
        ...(start === undefined ? {} : { start }),
      })
    }
    case 'diff': {
      const parsed = parseArgs(args, {
        flags: ['--staged', '--name-only', '--stat'],
        aliases: { '--cached': '--staged' },
      })
      return gitDiff(repo, {
        staged: parsed.flags.has('--staged'),
        commits: parsed.positional,
        ...(parsed.paths ? { paths: parsed.paths } : {}),
        nameOnly: parsed.flags.has('--name-only'),
        stat: parsed.flags.has('--stat'),
      })
    }
    case 'show': {
      const parsed = parseArgs(args, { flags: ['--name-only', '--stat'] })
      atMost(parsed, 1, 'git show [<コミット>]')
      return show(repo, parsed.positional[0], {
        ...(parsed.paths ? { paths: parsed.paths } : {}),
        nameOnly: parsed.flags.has('--name-only'),
        stat: parsed.flags.has('--stat'),
      })
    }
    case 'add': {
      const parsed = parseArgs(args, { flags: ['-A'], aliases: { '--all': '-A' } })
      const specs = [...parsed.positional, ...(parsed.paths ?? [])]
      return add(repo, parsed.flags.has('-A') ? [...specs, '.'] : specs)
    }
    case 'rm': {
      const parsed = parseArgs(args, { flags: ['--cached', '-f', '-r'], aliases: { '--force': '-f' } })
      return gitRemove(repo, [...parsed.positional, ...(parsed.paths ?? [])], {
        cached: parsed.flags.has('--cached'),
        force: parsed.flags.has('-f'),
      })
    }
    case 'restore':
      return runRestore(repo, args)
    case 'commit':
      return runCommit(repo, args)
    case 'branch':
      return runBranch(repo, args)
    case 'switch':
      return runSwitch(repo, args)
    case 'checkout':
      return runCheckout(repo, args)
    case 'merge': {
      const parsed = parseArgs(args, {
        flags: ['--no-ff', '--ff-only', '--no-edit', ...CONTROL_FLAGS.slice(0, 2)],
        values: ['-m'],
      })
      const control = sequencerControl(repo, 'merge', parsed)
      if (control) return control
      if (parsed.positional.length !== 1) usage('git merge <ブランチ>')
      const message = parsed.values.get('-m')
      return merge(repo, parsed.positional[0] as string, {
        ...(message === undefined ? {} : { message }),
        noEdit: parsed.flags.has('--no-edit'),
        noFastForward: parsed.flags.has('--no-ff'),
        fastForwardOnly: parsed.flags.has('--ff-only'),
      })
    }
    case 'rebase': {
      const parsed = parseArgs(args, {
        flags: [...CONTROL_FLAGS, '-i'],
        values: ['-x'],
        aliases: { '--interactive': '-i', '--exec': '-x' },
      })
      const control = sequencerControl(repo, 'rebase', parsed)
      if (control) return control
      if (parsed.positional.length !== 1) usage('git rebase [-i] [-x <コマンド>] <ブランチ>')
      const upstream = parsed.positional[0] as string
      const exec = parsed.values.get('-x')
      const options = exec === undefined ? {} : { exec }
      return parsed.flags.has('-i')
        ? rebaseInteractive(repo, upstream, options)
        : rebase(repo, upstream, options)
    }
    case 'cherry-pick': {
      const parsed = parseArgs(args, {
        flags: [...CONTROL_FLAGS, '--allow-empty', '-e'],
        values: ['-m'],
        aliases: { '--edit': '-e', '--mainline': '-m' },
      })
      const mainline = parseMainline(parsed)
      return (
        sequencerControl(repo, 'cherry-pick', parsed) ??
        cherryPick(repo, parsed.positional, {
          allowEmpty: parsed.flags.has('--allow-empty'),
          edit: parsed.flags.has('-e'),
          ...(mainline === undefined ? {} : { mainline }),
        })
      )
    }
    case 'revert': {
      const parsed = parseArgs(args, {
        flags: [...CONTROL_FLAGS, '--no-edit'],
        values: ['-m'],
        aliases: { '--mainline': '-m' },
      })
      const mainline = parseMainline(parsed)
      return (
        sequencerControl(repo, 'revert', parsed) ??
        revert(repo, parsed.positional, {
          noEdit: parsed.flags.has('--no-edit'),
          ...(mainline === undefined ? {} : { mainline }),
        })
      )
    }
    case 'reset':
      return runReset(repo, args)
    case 'stash':
      return runStash(repo, args)
    case 'tag':
      return runTag(repo, args)
    case 'push':
      return runPush(repo, args)
    case 'fetch': {
      const parsed = parseArgs(args, { flags: [] })
      if (parseRemoteArgs(parsed.positional, 'git fetch [origin]') !== undefined) {
        usage('git fetch [origin]')
      }
      const result = fetch(repo)
      return result.output === '' ? { ...result, output: '(新しいコミットはありません)' } : result
    }
    case 'pull':
      return runPull(repo, args)
    default:
      throw new GitError(`git: '${name}' は git のコマンドではありません (help で一覧を表示します)`)
  }
}

function runEcho(repo: Repo, tokens: readonly Token[]): OperationResult {
  const redirect = tokens.findIndex((token) => !token.quoted && (token.value === '>' || token.value === '>>'))
  const words = (redirect === -1 ? tokens : tokens.slice(0, redirect)).map((token) => token.value)
  const text = `${words.join(' ')}\n`
  if (redirect === -1) return { repo, output: text.replace(/\n$/, '') }
  const rest = tokens.slice(redirect + 1)
  if (rest.length !== 1) usage('echo "内容" > ファイル')
  return writeFile(repo, (rest[0] as Token).value, text, tokens[redirect]?.value === '>>')
}

function requireOne(args: readonly string[], text: string): string {
  if (args.length !== 1) usage(text)
  return args[0] as string
}

const SHELL_COMMANDS = new Set(['echo', 'touch', 'cat', 'ls', 'rm'])

function runShell(repo: Repo, name: string, tokens: readonly Token[]): OperationResult {
  const args = tokens.map((token) => token.value)
  switch (name) {
    case 'echo':
      return runEcho(repo, tokens)
    case 'touch': {
      if (args.length === 0) usage('touch <ファイル>...')
      return args.reduce<OperationResult>((result, path) => touchFile(result.repo, path), { repo, output: '' })
    }
    case 'cat':
      return readFile(repo, requireOne(args, 'cat <ファイル>'))
    case 'ls':
      return listFiles(repo)
    default: {
      const paths = args.filter((arg) => arg !== '-f')
      if (paths.length === 0) usage('rm <ファイル>...')
      return paths.reduce<OperationResult>((result, path) => removeFile(result.repo, path), { repo, output: '' })
    }
  }
}

/** エディタを保存して閉じる操作を表すコマンド。ログと共有 URL にはこの形で残る。 */
export const EDITOR_SAVE = ':wq'

/**
 * エディタを保存して閉じるコマンドを作る。text を省略すると開いたときの内容のまま閉じる。
 * '#' で始まる行は Git が読み飛ばすので、ログと共有 URL を短くするために取り除いて記録する。
 */
export function editorSaveCommand(text?: string): string {
  if (text === undefined) return EDITOR_SAVE
  const kept = text
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('\n')
    .replace(/\s+$/, '')
  return `${EDITOR_SAVE} ${JSON.stringify(kept)}`
}

/** エディタを保存したコマンドなら、保存した内容 (開いたときのままなら null) を返す。 */
export function parseEditorSave(command: string): { text: string | null } | null {
  if (command === EDITOR_SAVE) return { text: null }
  if (!command.startsWith(`${EDITOR_SAVE} `)) return null
  try {
    const text: unknown = JSON.parse(command.slice(EDITOR_SAVE.length + 1))
    return typeof text === 'string' ? { text } : null
  } catch {
    return null
  }
}

function runEditorSave(repo: Repo, input: string): CommandResult {
  const parsed = parseEditorSave(input.trim())
  if (!parsed) return { repo, output: `使い方: ${EDITOR_SAVE} "保存する内容"`, ok: false }
  try {
    return { ...saveEditor(repo, parsed.text ?? undefined), ok: true }
  } catch (error) {
    if (error instanceof GitError) return { repo, output: error.message, ok: false }
    throw error
  }
}

/**
 * 入力された 1 行のコマンドを実行する。
 * git のコマンドは先頭の "git" を省略できる (rm だけはシェルの rm として扱う)。
 * Git の規則に反する操作は例外にせず、ok: false と説明文で返す。
 */
export function executeCommand(repo: Repo, input: string): CommandResult {
  const result = executeOnce(repo, input)
  return result.ok ? runPendingExec(result) : result
}

/**
 * rebase の todo の先頭が exec なら、そのコマンドを実行して rebase を続ける。
 * コマンドが失敗したり、コミットしていない変更を残したりしたら、Git と同じくそこで止まる。
 */
function runPendingExec(result: CommandResult): CommandResult {
  let repo = result.repo
  const lines = result.output === '' ? [] : [result.output]
  for (;;) {
    const op = repo.operation
    const next = op?.type === 'rebase' && op.current === null && !repo.editor ? op.todo[0] : undefined
    if (op?.type !== 'rebase' || next?.action !== 'exec') break
    const before: Repo = { ...repo, operation: { ...op, todo: op.todo.slice(1) } }
    lines.push(`Executing: ${next.command}`)
    // exec の中のコマンドは、ここから入れ子にならないように 1 回だけ実行する
    const ran = executeOnce(before, next.command)
    if (ran.output) lines.push(ran.output)
    const after: Repo = ran.ok ? ran.repo : before
    if (!ran.ok) {
      lines.push(
        `warning: コマンドの実行に失敗しました: ${next.command}`,
        '問題を直してから git rebase --continue を実行してください。',
      )
      repo = after
      break
    }
    if (after.operation?.type !== 'rebase' || after.editor) {
      // exec の中で rebase を終わらせた、またはエディタを開いた場合は、そのまま返す
      repo = after
      break
    }
    if (hasTrackedChanges(after)) {
      lines.push(
        `error: コマンドは成功しましたが、ステージか作業ディレクトリに変更を残しました: ${next.command}`,
        'コミットするか stash してから git rebase --continue を実行してください。',
      )
      repo = after
      break
    }
    try {
      const continued = continueOperation(after, 'rebase')
      if (continued.output) lines.push(continued.output)
      repo = continued.repo
    } catch (error) {
      if (!(error instanceof GitError)) throw error
      lines.push(error.message)
      repo = after
      break
    }
  }
  return { repo, output: lines.join('\n'), ok: true }
}

function executeOnce(repo: Repo, input: string): CommandResult {
  if (input.startsWith(EDITOR_SAVE)) return runEditorSave(repo, input)
  if (repo.editor && input.trim() !== '') {
    return {
      repo,
      output: `エディタで ${repo.editor.file} を開いています。先に「保存して閉じる」を押してください`,
      ok: false,
    }
  }
  const tokens = lex(input)
  const isGit = tokens[0]?.value === 'git' && !tokens[0].quoted
  if (isGit) tokens.shift()

  const [first, ...rest] = tokens
  if (first === undefined) {
    return isGit
      ? { repo, output: HELP_TEXT, ok: true }
      : { repo, output: '', ok: true }
  }
  const name = first.value
  const args = rest.map((token) => token.value)

  try {
    let result: OperationResult
    if (!isGit && SHELL_COMMANDS.has(name)) result = runShell(repo, name, rest)
    else if (!isGit && name === 'teammate') {
      if (args.length > 1) usage('teammate [<ブランチ>]')
      result = teammateCommit(repo, args[0])
    } else if (name === 'help') result = { repo, output: HELP_TEXT }
    else result = runGit(repo, name, args)
    return { ...result, ok: true }
  } catch (error) {
    if (error instanceof GitError) {
      return { repo, output: error.message, ok: false }
    }
    throw error
  }
}
