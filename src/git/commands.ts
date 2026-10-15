import {
  abortOperation,
  cherryPick,
  continueOperation,
  mergeMany,
  parseStrategy,
  parseStrategyOption,
  rebase,
  rebase as rebaseOnto,
  rebaseInteractive,
  revert,
  saveEditor,
  skipOperation,
  type MergeStrategy,
} from './history'
import {
  GitError,
  chmod,
  cleanupMessage,
  configBool,
  headCommitIdOrNull,
  isSubmodulePath,
  getCommit,
  getRemote,
  resolveRef,
  subject,
  add,
  commit,
  createBranch,
  currentBranch,
  deleteBranch,
  orphanBranch,
  detachHead,
  gitRemove,
  hasTrackedChanges,
  headTree,
  listBranches,
  listFiles,
  previousBranch,
  readFile,
  reflog,
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
import { getConfig, listConfig, setConfig, unsetConfig } from './config'
import { gitClone } from './clone'
import { bundleCreate, bundleListHeads, bundleUnbundle, bundleVerify, fetchBundle } from './bundle'
import { cherry, rangeDiff } from './compare'
import { log } from './log'
import { amAbort, amContinue, amShowCurrentPatch, amSkip, gitAm, gitApply, gitFormatPatch } from './patch'
import { sparseAdd, sparseDisable, sparseInit, sparseList, sparseSet } from './sparse'
import { notesAdd, notesAppend, notesCopy, notesEdit, notesList, notesRemove, notesShow } from './notes'
import { rerereCommand } from './rerere'
import {
  activeRepo,
  removeSubmodule,
  submoduleAdd,
  submoduleDeinit,
  submoduleInit,
  submoduleStatus,
  submoduleUpdate,
  syncServersIn,
  syncServersOut,
  syncSubmodules,
} from './submodule'
import { changeDirectory, worktreeAdd, worktreeList, worktreePrune, worktreeRemove } from './worktree'
import { bisectLog, bisectMark, bisectReset, bisectRunning, bisectStart } from './bisect'
import { blame, gitDiff, show } from './inspect'
import { createTag, deleteTags, listTags } from './tag'
import {
  addRemote,
  fetch,
  listRemotes,
  pull,
  push,
  pushDelete,
  pushTags,
  removeRemote,
  renameRemote,
  setRemoteUrl,
  teammateCommit,
} from './remote'
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
  '  cd <パス> / pwd            worktree やサブモジュールの中に移動する・今いる場所を表示する',
  '',
  'Git のコマンド (先頭の git は省略できます。rm だけは git rm と区別します):',
  '  status / reflog [<ブランチ>]',
  '  log [--oneline] [--graph] [--all] [-n <数>] [--format=<書式>] [--first-parent] [--merges] [--grep=<語>]',
  '      [--reverse] [-p] [--stat] [<範囲 A..B / A...B>] [-- <パス>]',
  '  blame [-L <開始>,<終了>] <ファイル> [<コミット>]',
  '  diff [--staged] [<コミット> [<コミット>]] [--stat] [-- <ファイル>] / show [<コミット>]',
  '  add <ファイル>... / add .        restore [--staged] <ファイル>...',
  '  commit [-m "メッセージ"] [-a] [--allow-empty] [--amend] [--no-edit]',
  '  (-m を付けないとエディタが開きます。merge・revert・--continue なども同じです)',
  '  branch [<名前> [<起点>]] / branch -d <名前> / branch -m <新しい名前>',
  '  switch <名前> / switch - / switch -c <名前> / switch --detach <コミット>',
  '  checkout <名前|コミット> / checkout -b <名前>',
  '  merge [--no-ff] [--no-edit] [-s ours|octopus] [-X ours|theirs] <ブランチ>... (2 つ以上なら octopus)',
  '  rebase [-i] [-r] [-x <コマンド>] [-X ours|theirs] <ブランチ>',
  '  cherry-pick [-e] [-m <親>] [-X …] [--allow-empty] <コミット>... / revert [--no-edit] [-m <親>] [-X …] <コミット>...',
  '  reset [--soft | --mixed | --hard] [<コミット>]',
  '  tag [-a] [-m "…"] [-f] <タグ> [<コミット>] / tag -l [<パターン>] / tag -d <タグ>',
  '  bisect start [<悪い> [<良い>]] / bisect good / bad / skip / reset / log / run [!] <コマンド>',
  '  stash [push [-m "…"] [-u] [-k]] / stash list / show [-p] / apply / pop [--index] / drop / clear / branch',
  '  push [-u] [-f] [--tags] [<リモート> [<ブランチ|タグ>]] / push <リモート> --delete <名前>',
  '  fetch [<リモート> | --all] / pull [--rebase | --no-rebase] [<リモート> [<ブランチ>]]',
  '  config <キー> [<値>] / config --unset <キー> / config --list   (rerere.enabled・pull.rebase・merge.ff など)',
  '  rerere [status | diff | remaining | forget <パス> | clear]   (git config rerere.enabled true で有効)',
  '  notes add [-m "…"] [<コミット>] / append / edit / show / list / remove / copy',
  '  sparse-checkout init / set <ディレクトリ>... / add / list / disable   (作業ディレクトリに出すファイルを絞る)',
  '  clone [-b <ブランチ>] [--recurse-submodules] [--sparse] <URL> [<ディレクトリ>]   (リモートの URL から別のリポジトリを作る)',
  '  format-patch [-<数>] [-o <ディレクトリ>] [--stdout] [<起点> | <A>..<B>]   (コミットをパッチファイルにする)',
  '  apply [--check] [--index | --cached] [-R] <パッチ> / am [-3] <パッチ>... / am --continue / --skip / --abort',
  '  cherry [-v] [<上流> [<先端>]] / range-diff <A>...<B> | <基点> <A> <B> | <範囲1> <範囲2>   (パッチを比べる)',
  '  bundle create <ファイル> <リビジョン>... / bundle verify / list-heads / unbundle <ファイル>   (clone・fetch・pull の元にもできる)',
  '  submodule add <URL> [<パス>] / submodule [status] / init / update [--init] [--remote] / deinit / foreach <コマンド>',
  '  worktree add [-b <ブランチ>] [--detach] <パス> [<コミット>] / worktree list / worktree remove [-f] <パス>',
  '  remote [-v] / remote add <名前> <URL> / remove / rename / set-url / get-url',
  '  (merge / rebase / cherry-pick / revert は --continue・--abort が使えます)',
  '',
  '<コミット> の例: C1, main, v1.0, origin/main, HEAD~1, HEAD^2, HEAD@{1}, main@{2}',
  '',
  'このアプリ独自のコマンド:',
  '  teammate [<リモート>] [<ブランチ>]   他の人がリモートに push したことにする',
].join('\n')

interface Token {
  readonly value: string
  /** 引用符で囲まれていたか (囲まれた > はリダイレクトとみなさない)。 */
  readonly quoted: boolean
}

function lex(input: string): Token[] {
  // シェルと同じく、引用符の部分と引用符のない部分が続いていれば 1 つの単語にする (--format="%h %s" など)
  const tokens: Token[] = []
  let value = ''
  let quoted = false
  let inWord = false
  const flush = () => {
    if (inWord) tokens.push({ value, quoted })
    value = ''
    quoted = false
    inWord = false
  }
  for (let i = 0; i < input.length; i++) {
    const char = input[i] as string
    if (char === "'") {
      const end = input.indexOf(char, i + 1)
      const stop = end === -1 ? input.length : end
      value += input.slice(i + 1, stop)
      quoted = true
      inWord = true
      i = stop
    } else if (char === '"') {
      // ダブルクォートの中では、\" \\ \$ \` だけがエスケープになる (シェルと同じ)
      let j = i + 1
      while (j < input.length && input[j] !== '"') {
        if (input[j] === '\\' && j + 1 < input.length && '"\\$`'.includes(input[j + 1] as string)) j++
        value += input[j]
        j++
      }
      quoted = true
      inWord = true
      i = j
    } else if (char === '\\' && i + 1 < input.length) {
      value += input[i + 1]
      inWord = true
      i++
    } else if (char === '>') {
      flush()
      const operator = input[i + 1] === '>' ? '>>' : '>'
      tokens.push({ value: operator, quoted: false })
      i += operator.length - 1
    } else if (/\s/.test(char)) {
      flush()
    } else {
      value += char
      inWord = true
    }
  }
  flush()
  return tokens
}

export interface ChainPart {
  /** 直前のコマンドとのつなぎ方 (最初のコマンドは null)。 */
  readonly op: '&&' | '||' | ';' | null
  readonly text: string
}

/** シェルと同じく、引用符の外の &&・||・; でコマンドを分ける。 */
export function splitChain(input: string): ChainPart[] {
  const parts: ChainPart[] = []
  let op: ChainPart['op'] = null
  let start = 0
  let quote: string | null = null
  for (let i = 0; i < input.length; i++) {
    const char = input[i] as string
    if (quote !== null) {
      if (char === '\\' && quote === '"') i++
      else if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '\\') i++
    else {
      const two = input.slice(i, i + 2)
      const found = two === '&&' || two === '||' ? two : char === ';' ? ';' : null
      if (found === null) continue
      parts.push({ op, text: input.slice(start, i).trim() })
      op = found
      start = i + found.length
      i += found.length - 1
    }
  }
  parts.push({ op, text: input.slice(start).trim() })
  return parts
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

/** -s <ストラテジー> と -X <オプション> を読む。 */
function strategyOptions(parsed: ParsedArgs): { strategy?: MergeStrategy; favor?: 'ours' | 'theirs' } {
  const strategy = parsed.values.get('-s')
  const option = parsed.values.get('-X')
  return {
    ...(strategy === undefined ? {} : { strategy: parseStrategy(strategy) }),
    ...(option === undefined ? {} : { favor: parseStrategyOption(option) }),
  }
}

/** 作業ディレクトリ・ステージ・HEAD のどこかにあるファイル (またはディレクトリ) か。 */
function isKnownPath(repo: Repo, path: string): boolean {
  const trees = [repo.workdir, repo.index, headTree(repo)]
  const prefix = path.replace(/\/$/, '')
  return path === '.' || trees.some((tree) => Object.keys(tree).some((file) => file === prefix || file.startsWith(`${prefix}/`)))
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
    flags: ['-a', '--allow-empty', '--amend', '--no-edit', '--no-verify'],
    values: ['-m', '--fixup', '--squash'],
    aliases: { '--all': '-a', '--message': '-m', '-n': '--no-verify' },
  })
  atMost(parsed, 0, 'git commit [-a] [-m "メッセージ"] [--allow-empty] [--amend] [--no-edit] [--fixup=<コミット>] [--squash=<コミット>]')
  // -m を複数書くと、それぞれが段落になる
  const messages = parsed.allValues.get('-m')
  let message = messages?.map((part) => part.trim()).join('\n\n')
  if (message !== undefined && message.trim() === '') {
    throw new GitError('メッセージが空のため、コミットを中止しました')
  }
  // --fixup / --squash: rebase --autosquash でまとめる相手を件名に書いたコミットを作る
  const fixup = parsed.values.get('--fixup')
  const squash = parsed.values.get('--squash')
  let template: string | undefined
  if (fixup !== undefined || squash !== undefined) {
    if (fixup !== undefined && squash !== undefined) throw new GitError('fatal: --fixup と --squash は同時に指定できません')
    if (parsed.flags.has('--amend')) throw new GitError('fatal: --fixup / --squash と --amend は同時に指定できません')
    if (fixup !== undefined && /^(amend|reword):/.test(fixup)) {
      throw new GitError('--fixup=amend: と --fixup=reword: は、このアプリでは未対応です')
    }
    const target = getCommit(repo, resolveRef(repo, (fixup ?? squash) as string))
    const title = `${fixup !== undefined ? 'fixup' : 'squash'}! ${subject(target.message)}`
    if (fixup !== undefined) message = message === undefined ? title : `${title}\n\n${message}`
    else if (message !== undefined) message = `${title}\n\n${message}`
    else template = title
  }
  // フック: pre-commit (コミットする前)、commit-msg (メッセージを確かめる)、post-commit (コミットしたあと)
  const verify = !parsed.flags.has('--no-verify')
  let current = repo
  const lines: string[] = []
  if (verify) {
    const pre = runHook(current, 'pre-commit')
    lines.push(...pre.lines)
    if (!pre.ok) throw new GitError([...lines, '(pre-commit フックが失敗したため、コミットしませんでした)'].join('\n'))
    current = pre.repo
    if (message !== undefined) {
      const checked = runCommitMsgHook(current, message)
      lines.push(...checked.lines)
      current = checked.repo
      message = checked.message
    }
  }
  const result = commit(current, {
    ...(message === undefined ? {} : { message }),
    ...(template === undefined ? {} : { template }),
    all: parsed.flags.has('-a'),
    allowEmpty: parsed.flags.has('--allow-empty'),
    amend: parsed.flags.has('--amend'),
    noEdit: parsed.flags.has('--no-edit'),
  })
  const editor = result.repo.editor
  if (editor !== null) {
    // エディタを保存したときに commit-msg と post-commit を実行する
    const after = editor.after.kind === 'commit' && verify ? { ...editor.after, verify: true } : editor.after
    return { repo: { ...result.repo, editor: { ...editor, after } }, output: [...lines, result.output].join('\n') }
  }
  const post = verify ? runHook(result.repo, 'post-commit') : { repo: result.repo, lines: [] }
  return { repo: post.repo, output: [...lines, result.output, ...post.lines].filter(Boolean).join('\n') }
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
    atMost(parsed, 1, 'git branch -u <リモート>/<ブランチ> [<ブランチ>]')
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
    values: ['-c', '-C', '--orphan'],
    aliases: { '--create': '-c', '-d': '--detach' },
  })
  const orphan = parsed.values.get('--orphan')
  if (orphan !== undefined) {
    atMost(parsed, 0, 'git switch --orphan <新しいブランチ>')
    return orphanBranch(repo, orphan)
  }
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
  // git switch - は、直前にいたブランチに戻る
  const target = parsed.positional[0] === '-' ? previousBranch(repo) : parsed.positional[0]
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
  const parsed = parseArgs(args, { flags: ['--detach'], values: ['-b', '-B', '--orphan'] })
  const orphan = parsed.values.get('--orphan')
  if (orphan !== undefined) {
    atMost(parsed, 1, 'git checkout --orphan <新しいブランチ> [<起点>]')
    const startPoint = parsed.positional[0]
    return orphanBranch(repo, orphan, { keep: true, ...(startPoint === undefined ? {} : { startPoint }) })
  }
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
  const target = parsed.positional[0] === '-' ? previousBranch(repo) : parsed.positional[0]
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

  // HEAD@{n} や HEAD~n の形は、解決できなくてもファイルではなくコミットの指定として扱う
  const looksLikeRef = target !== undefined && /@\{|[~^]/.test(target)
  if (parsed.paths !== null || (target !== undefined && !looksLikeRef && tryResolveRef(repo, target) === null)) {
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

/** bisect run で、1 回の判定に使う上限 (コマンドが判定を進めない場合に止めるため)。 */
const BISECT_RUN_LIMIT = 64

/**
 * git bisect run <コマンド>: コマンドを実行して、成功なら good、失敗なら bad と判定することを繰り返す。
 * 先頭に ! を付けると判定を逆にする (例: bisect run ! cat bug.txt)。
 */
function bisectRun(repo: Repo, command: string): OperationResult {
  if (!bisectRunning(repo)) {
    throw new GitError('bisect run を使うには、先に良いコミットと悪いコミットを 1 つずつ指定してください')
  }
  const inverted = command.startsWith('!')
  const body = inverted ? command.slice(1).trim() : command
  if (body === '') usage('git bisect run [!] <コマンド>')
  let current = repo
  const lines: string[] = []
  for (let i = 0; i < BISECT_RUN_LIMIT && bisectRunning(current); i++) {
    lines.push(`running ${command}`)
    const ran = executeOnce(current, body)
    if (ran.output) lines.push(ran.output)
    const good = ran.ok !== inverted
    const step = bisectMark(ran.ok ? ran.repo : current, good ? 'good' : 'bad')
    lines.push(step.output)
    current = step.repo
  }
  if (current.bisect?.found) lines.push('bisect found first bad commit')
  return { repo: current, output: lines.join('\n') }
}

function runBisect(repo: Repo, args: readonly string[], raw: string): OperationResult {
  const [sub, ...rest] = args
  switch (sub) {
    case 'start':
      return bisectStart(repo, rest[0], rest.slice(1))
    case 'bad':
    case 'new':
      return bisectMark(repo, 'bad', rest)
    case 'good':
    case 'old':
      return bisectMark(repo, 'good', rest)
    case 'skip':
      return bisectMark(repo, 'skip', rest)
    case 'reset':
      if (rest.length > 1) usage('git bisect reset [<コミット>]')
      return bisectReset(repo, rest[0])
    case 'log':
      return bisectLog(repo)
    case 'run': {
      // コマンドは書いたまま (引用符や > を含めて) 実行する
      const command = raw.replace(/^\s*(git\s+)?bisect\s+run\s*/, '')
      return bisectRun(repo, command)
    }
    default:
      throw new GitError('使い方: git bisect start / good / bad / skip / reset / log / run')
  }
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

/** [<リモート> [<ブランチ>]] の形の引数を読む。リモートが存在するかを確かめる。 */
function parseRemoteArgs(
  repo: Repo,
  positional: readonly string[],
  text: string,
): { readonly remote?: string; readonly branch?: string } {
  const [remote, branch, ...rest] = positional
  if (rest.length > 0) usage(text)
  if (remote === undefined) return {}
  if (!(remote in repo.remotes)) {
    throw new GitError(
      `fatal: '${remote}' はリモートリポジトリではありません\n` + 'リモートの一覧は git remote -v で確認できます',
    )
  }
  return { remote, ...(branch === undefined ? {} : { branch }) }
}

function runPush(repo: Repo, args: readonly string[]): OperationResult {
  const parsed = parseArgs(args, {
    flags: ['-u', '-f', '--tags', '-d'],
    aliases: { '--set-upstream': '-u', '--force': '-f', '--delete': '-d' },
  })
  const text = 'git push [-u] [-f] [--tags] [<リモート> [<ブランチ|タグ>]] / git push <リモート> --delete <名前>'
  const { remote, branch } = parseRemoteArgs(repo, parsed.positional, text)
  const force = parsed.flags.has('-f')
  if (parsed.flags.has('-d')) {
    if (branch === undefined || remote === undefined) usage(text)
    return pushDelete(repo, branch, remote)
  }
  if (parsed.flags.has('--tags')) {
    if (branch !== undefined) usage(text)
    return pushTags(repo, Object.keys(repo.tags).sort(), { force, ...(remote === undefined ? {} : { remote }) })
  }
  return push(repo, {
    ...(remote === undefined ? {} : { remote }),
    ...(branch === undefined ? {} : { branch }),
    force,
    setUpstream: parsed.flags.has('-u'),
  })
}

/** 引数がリモートの名前ではなく、バンドルのファイルなら true。 */
function isBundleFile(repo: Repo, path: string | undefined): path is string {
  if (path === undefined || path in repo.remotes) return false
  try {
    return readFile(repo, path).output.startsWith('# v2 git bundle')
  } catch {
    return false
  }
}

function runFetch(repo: Repo, args: readonly string[]): OperationResult {
  const parsed = parseArgs(args, { flags: ['--all'] })
  const [first, ...refspecs] = parsed.positional
  if (isBundleFile(repo, first)) return fetchBundle(repo, first, refspecs)
  const text = 'git fetch [<リモート>] / git fetch --all'
  const { remote, branch } = parseRemoteArgs(repo, parsed.positional, text)
  if (branch !== undefined || (parsed.flags.has('--all') && remote !== undefined)) usage(text)
  const result = fetch(repo, { ...(remote === undefined ? {} : { remote }), all: parsed.flags.has('--all') })
  return result.output === '' ? { ...result, output: '(新しいコミットはありません)' } : result
}

function runPull(repo: Repo, args: readonly string[]): OperationResult {
  const parsed = parseArgs(args, {
    flags: ['--rebase', '--no-rebase', '--ff-only', '--no-edit'],
    values: ['-s', '-X'],
    aliases: { '-r': '--rebase', '--strategy': '-s', '--strategy-option': '-X' },
  })
  const text = 'git pull [--rebase | --no-rebase] [<リモート> [<ブランチ>]]'
  const [first, ...rest] = parsed.positional
  if (isBundleFile(repo, first)) {
    // バンドルから: FETCH_HEAD に取り込んで、それを merge (--rebase なら rebase) する
    const fetched = fetchBundle(repo, first, rest.slice(0, 1))
    const integrated = parsed.flags.has('--rebase')
      ? rebaseOnto(fetched.repo, 'FETCH_HEAD')
      : mergeMany(fetched.repo, ['FETCH_HEAD'], {
          noEdit: parsed.flags.has('--no-edit'),
          fastForwardOnly: parsed.flags.has('--ff-only'),
          reflogAction: 'pull',
        })
    return { repo: integrated.repo, output: [fetched.output, integrated.output].join('\n') }
  }
  const { remote, branch } = parseRemoteArgs(repo, parsed.positional, text)
  if (parsed.flags.has('--rebase') && parsed.flags.has('--no-rebase')) {
    throw new GitError('fatal: --rebase と --no-rebase は同時に指定できません')
  }
  // オプションがなければ pull.rebase / pull.ff の設定を使う
  const rebaseConfig = configBool(repo, 'pull.rebase')
  const rebase =
    parsed.flags.has('--rebase') ? true
    : parsed.flags.has('--no-rebase') ? false
    : rebaseConfig
  return pull(repo, {
    ...(remote === undefined ? {} : { remote }),
    ...(branch === undefined ? {} : { branch }),
    ...(rebase === undefined ? {} : { rebase }),
    fastForwardOnly: parsed.flags.has('--ff-only') || (rebase === undefined && repo.config['pull.ff'] === 'only'),
    noEdit: parsed.flags.has('--no-edit'),
    ...strategyOptions(parsed),
  })
}

function runSubmodule(repo: Repo, args: readonly string[], raw: string): OperationResult {
  const [sub = 'status', ...rest] = args[0]?.startsWith('-') ? ['status', ...args] : args
  switch (sub) {
    case 'add': {
      const parsed = parseArgs(rest, { flags: [], values: ['-b'], aliases: { '--branch': '-b' } })
      const [url, path, ...extra] = parsed.positional
      if (url === undefined || extra.length > 0) usage('git submodule add [-b <ブランチ>] <URL> [<パス>]')
      return submoduleAdd(repo, url, path, parsed.values.get('-b'))
    }
    case 'status':
      return submoduleStatus(repo, parseArgs(rest, { flags: ['--recursive'] }).positional)
    case 'init':
      return submoduleInit(repo, parseArgs(rest, { flags: [] }).positional)
    case 'update': {
      const parsed = parseArgs(rest, { flags: ['--init', '--remote', '--recursive', '--checkout'] })
      return submoduleUpdate(repo, parsed.positional, {
        init: parsed.flags.has('--init'),
        remote: parsed.flags.has('--remote'),
      })
    }
    case 'deinit': {
      const parsed = parseArgs(rest, { flags: ['-f', '--all'], aliases: { '--force': '-f' } })
      return submoduleDeinit(repo, parsed.positional, { force: parsed.flags.has('-f'), all: parsed.flags.has('--all') })
    }
    case 'foreach':
      return submoduleForeach(repo, raw)
    default:
      throw new GitError(`error: 未対応の submodule のサブコマンドです: ${sub}`)
  }
}

/** git submodule foreach <コマンド>: チェックアウトしている各サブモジュールの中でコマンドを実行する。 */
function submoduleForeach(repo: Repo, raw: string): OperationResult {
  let command = raw.slice(raw.indexOf('foreach') + 'foreach'.length).trim()
  if (/^(["']).*\1$/s.test(command)) command = command.slice(1, -1)
  if (command === '') usage('git submodule foreach <コマンド>')
  let current = repo
  const lines: string[] = []
  for (const path of Object.keys(repo.submodules).sort()) {
    lines.push(`Entering '${path}'`)
    const nested = syncServersIn(current, current.submodules[path] as Repo)
    const ran = executeLocal(nested, command)
    if (ran.output) lines.push(ran.output)
    if (!ran.ok) throw new GitError([...lines, `fatal: run_command returned non-zero status for ${path}`].join('\n'))
    current = syncServersOut({ ...current, submodules: { ...current.submodules, [path]: ran.repo } }, ran.repo)
  }
  return { repo: current, output: lines.join('\n') }
}

function runNotes(repo: Repo, args: readonly string[]): OperationResult {
  const [sub = 'list', ...rest] = args[0]?.startsWith('-') ? ['list', ...args] : args
  const parsed = parseArgs(rest, {
    flags: ['-f', '--ignore-missing'],
    values: ['-m'],
    aliases: { '--force': '-f', '--message': '-m' },
  })
  const messages = parsed.allValues.get('-m') ?? []
  const [first, second, ...extra] = parsed.positional
  const one = (text: string) => {
    if (second !== undefined) usage(text)
    return first
  }
  switch (sub) {
    case 'add':
      return notesAdd(repo, one('git notes add [-f] [-m <メッセージ>] [<コミット>]'), messages, parsed.flags.has('-f'))
    case 'append':
      return notesAppend(repo, one('git notes append [-m <メッセージ>] [<コミット>]'), messages)
    case 'edit':
      return notesEdit(repo, one('git notes edit [<コミット>]'))
    case 'show':
      return notesShow(repo, one('git notes show [<コミット>]'))
    case 'list':
      return notesList(repo, one('git notes list [<コミット>]'))
    case 'remove':
      return notesRemove(repo, parsed.positional, parsed.flags.has('--ignore-missing'))
    case 'copy':
      if (first === undefined || second === undefined || extra.length > 0) usage('git notes copy [-f] <元> <先>')
      return notesCopy(repo, first, second, parsed.flags.has('-f'))
    default:
      throw new GitError(`error: 未対応の notes のサブコマンドです: ${sub}`)
  }
}

function runLog(repo: Repo, args: readonly string[]): OperationResult {
  // -3 は -n 3 と同じ。--pretty だけなら medium
  const expanded = args.flatMap((arg) => (/^-\d+$/.test(arg) ? ['-n', arg.slice(1)] : arg === '--pretty' ? ['--pretty=medium'] : [arg]))
  const parsed = parseArgs(expanded, {
    flags: [
      '--oneline', '--all', '--branches', '--tags', '--remotes', '--graph', '--reverse', '--first-parent',
      '--merges', '--no-merges', '--decorate', '--no-decorate', '-p', '--stat', '--name-only', '--invert-grep',
      '--topo-order', '--date-order', '--abbrev-commit', '--no-notes', '--notes',
    ],
    values: ['-n', '--format', '--pretty', '--grep'],
    aliases: { '--max-count': '-n', '--patch': '-p', '-u': '-p' },
  })
  const count = parsed.values.get('-n')
  if (count !== undefined && !/^\d+$/.test(count)) throw new GitError(`fatal: '${count}' は数ではありません`)
  // コミットとして読めず、ファイルとしてあるものはパスとして扱う
  const split = parsed.positional.findIndex(
    (arg) => !arg.includes('..') && !arg.startsWith('^') && !tryResolveRef(repo, arg) && isKnownPath(repo, arg),
  )
  const revisions = split === -1 ? parsed.positional : parsed.positional.slice(0, split)
  const paths = [...(split === -1 ? [] : parsed.positional.slice(split)), ...(parsed.paths ?? [])]
  const format = parsed.flags.has('--oneline') ? 'oneline' : (parsed.values.get('--format') ?? parsed.values.get('--pretty'))
  const grep = parsed.values.get('--grep')
  return log(repo, {
    revisions,
    all: parsed.flags.has('--all'),
    branches: parsed.flags.has('--branches'),
    tags: parsed.flags.has('--tags'),
    remotes: parsed.flags.has('--remotes'),
    ...(count === undefined ? {} : { maxCount: Number(count) }),
    ...(format === undefined ? {} : { format }),
    graph: parsed.flags.has('--graph'),
    reverse: parsed.flags.has('--reverse'),
    firstParent: parsed.flags.has('--first-parent'),
    ...(parsed.flags.has('--merges') ? { merges: true } : parsed.flags.has('--no-merges') ? { merges: false } : {}),
    ...(grep === undefined ? {} : { grep }),
    invertGrep: parsed.flags.has('--invert-grep'),
    paths,
    patch: parsed.flags.has('-p'),
    stat: parsed.flags.has('--stat'),
    nameOnly: parsed.flags.has('--name-only'),
    decorate: !parsed.flags.has('--no-decorate'),
    notes: !parsed.flags.has('--no-notes'),
  })
}

function runWorktree(repo: Repo, args: readonly string[]): OperationResult {
  if (repo.home !== undefined) throw new GitError('clone したリポジトリやサブモジュールの中での git worktree は、このアプリでは未対応です')
  const [sub, ...rest] = args
  switch (sub) {
    case 'add': {
      const parsed = parseArgs(rest, { flags: ['--detach'], values: ['-b', '-B'], aliases: { '-d': '--detach' } })
      const text = 'git worktree add [-b <新しいブランチ>] [--detach] <パス> [<コミット>]'
      const [path, commitish, ...extra] = parsed.positional
      if (path === undefined || extra.length > 0) usage(text)
      const newBranch = parsed.values.get('-b') ?? parsed.values.get('-B')
      return worktreeAdd(repo, path, commitish, {
        ...(newBranch === undefined ? {} : { newBranch }),
        detach: parsed.flags.has('--detach'),
      })
    }
    case 'list': {
      parseArgs(rest, { flags: [] })
      return worktreeList(repo)
    }
    case 'remove': {
      const parsed = parseArgs(rest, { flags: ['-f'], aliases: { '--force': '-f' } })
      return worktreeRemove(repo, requireOne(parsed.positional, 'git worktree remove [-f] <パス>'), parsed.flags.has('-f'))
    }
    case 'prune':
      return worktreePrune(repo)
    default:
      throw new GitError(`使い方: git worktree add / list / remove / prune${sub === undefined ? '' : ` (未対応のサブコマンド: ${sub})`}`)
  }
}

function runConfig(repo: Repo, args: readonly string[]): OperationResult {
  const parsed = parseArgs(args, {
    flags: ['--global', '--local', '--system', '-l', '--unset'],
    aliases: { '--list': '-l' },
  })
  const [key, value, ...rest] = parsed.positional
  const text = 'git config <キー> [<値>] / git config --unset <キー> / git config --list'
  if (rest.length > 0) usage(text)
  if (parsed.flags.has('-l')) {
    if (key !== undefined) usage(text)
    return listConfig(repo)
  }
  if (key === undefined) usage(text)
  if (parsed.flags.has('--unset')) {
    if (value !== undefined) usage(text)
    return unsetConfig(repo, key)
  }
  return value === undefined ? getConfig(repo, key) : setConfig(repo, key, value)
}

function runRemote(repo: Repo, args: readonly string[]): OperationResult {
  const parsed = parseArgs(args, { flags: ['-v'], aliases: { '--verbose': '-v' } })
  const [sub, ...rest] = parsed.positional
  const exactly = (count: number, text: string): string[] => {
    if (rest.length !== count) usage(text)
    return rest
  }
  switch (sub) {
    case undefined:
      return listRemotes(repo, parsed.flags.has('-v'))
    case 'add': {
      const [name, url] = exactly(2, 'git remote add <名前> <URL>') as [string, string]
      return addRemote(repo, name, url)
    }
    case 'remove':
    case 'rm': {
      const [name] = exactly(1, 'git remote remove <名前>') as [string]
      return removeRemote(repo, name)
    }
    case 'rename': {
      const [from, to] = exactly(2, 'git remote rename <古い名前> <新しい名前>') as [string, string]
      return renameRemote(repo, from, to)
    }
    case 'set-url': {
      const [name, url] = exactly(2, 'git remote set-url <名前> <URL>') as [string, string]
      return setRemoteUrl(repo, name, url)
    }
    case 'get-url': {
      const [name] = exactly(1, 'git remote get-url <名前>') as [string]
      return { repo, output: getRemote(repo, name).url }
    }
    default:
      throw new GitError(`error: 未対応の remote のサブコマンドです: ${sub}`)
  }
}

/** teammate [<リモート>] [<ブランチ>]: 1 つだけ書いたときは、リモート名ならそのリモートの main とみなす。 */
function runTeammate(repo: Repo, args: readonly string[]): OperationResult {
  const [first, second, ...rest] = args
  if (rest.length > 0) usage('teammate [<リモート>] [<ブランチ>]')
  if (second !== undefined) return teammateCommit(repo, second, first)
  if (first !== undefined && first in repo.remotes) return teammateCommit(repo, undefined, first)
  return teammateCommit(repo, first)
}

const RECURSE_COMMANDS = new Set(['switch', 'checkout', 'pull', 'reset'])

/**
 * --recurse-submodules (または submodule.recurse の設定) が付いた switch / checkout / pull / reset は、
 * 終わったあとでサブモジュールを記録したコミットにする (git submodule update と同じ)。
 */
const PRE_HOOKS: Readonly<Record<string, string>> = { push: 'pre-push', rebase: 'pre-rebase' }
const POST_HOOKS: Readonly<Record<string, string>> = {
  switch: 'post-checkout',
  checkout: 'post-checkout',
  merge: 'post-merge',
  pull: 'post-merge',
}

/**
 * フックを実行しながらコマンドを実行する。push / rebase は前に pre-push / pre-rebase を実行し、
 * 失敗したら中止する (--no-verify で飛ばせる)。switch / checkout / merge / pull は、HEAD が動いたら
 * あとで post-checkout / post-merge を実行する (結果は変えない)。
 */
function runGit(repo: Repo, name: string, args: readonly string[], raw: string): OperationResult {
  const pre = PRE_HOOKS[name]
  const post = POST_HOOKS[name]
  if (pre === undefined && post === undefined) return runGitWithSubmodules(repo, name, args, raw)
  const verify = !args.includes('--no-verify')
  const rest = args.filter((arg) => arg !== '--no-verify')
  let current = repo
  const lines: string[] = []
  const control = rest.some((arg) => CONTROL_FLAGS.includes(arg))
  if (pre !== undefined && verify && !control && current.gitFiles[`hooks/${pre}`] !== undefined) {
    const positional = rest.filter((arg) => !arg.startsWith('-'))
    let hookArgs: string[]
    if (name === 'push') {
      const branch = currentBranch(current)
      const upstream = branch === null ? undefined : current.upstreams[branch]
      const remoteName =
        positional[0] !== undefined && positional[0] in current.remotes
          ? positional[0]
          : (upstream?.split('/')[0] ?? 'origin')
      hookArgs = [remoteName, current.remotes[remoteName]?.url ?? remoteName]
    } else {
      hookArgs = positional
    }
    const hook = runHook(current, pre, hookArgs)
    lines.push(...hook.lines)
    if (!hook.ok) {
      const reason =
        name === 'push'
          ? `error: failed to push some refs to '${hookArgs[1]}'`
          : 'The pre-rebase hook refused to rebase.'
      throw new GitError([...lines, reason].join('\n'))
    }
    current = hook.repo
  }
  const before = headCommitIdOrNull(current)
  const result = runGitWithSubmodules(current, name, rest, raw)
  lines.push(result.output)
  const after = headCommitIdOrNull(result.repo)
  const moved = after !== before && result.repo.operation === null && result.repo.editor === null
  if (post === undefined || !verify || !moved) return { repo: result.repo, output: lines.filter(Boolean).join('\n') }
  const hook = runHook(result.repo, post, post === 'post-checkout' ? [before ?? '0', after ?? '0', '1'] : ['0'])
  return { repo: hook.repo, output: [...lines, ...hook.lines].filter(Boolean).join('\n') }
}

function runGitWithSubmodules(repo: Repo, name: string, args: readonly string[], raw: string): OperationResult {
  if (!RECURSE_COMMANDS.has(name)) return runGitCommand(repo, name, args, raw)
  const flag = args.includes('--recurse-submodules') ? true : args.includes('--no-recurse-submodules') ? false : undefined
  const rest = args.filter((arg) => arg !== '--recurse-submodules' && arg !== '--no-recurse-submodules')
  const result = runGitCommand(repo, name, rest, raw)
  const recurse = flag ?? configBool(repo, 'submodule.recurse') ?? false
  if (!recurse || result.repo.operation !== null || result.repo.editor !== null) return result
  if (Object.keys(result.repo.submodules).length === 0) return result
  const updated = submoduleUpdate(result.repo, [], {})
  return { repo: updated.repo, output: [result.output, updated.output].filter(Boolean).join('\n') }
}

function runGitCommand(repo: Repo, name: string, args: readonly string[], raw: string): OperationResult {
  switch (name) {
    case 'status':
      parseArgs(args, { flags: [] })
      return status(repo)
    case 'log':
      return runLog(repo, args)
    case 'notes':
      return runNotes(repo, args)
    case 'bundle': {
      const [sub, file, ...rest] = args
      if (file === undefined) usage('git bundle create <ファイル> <リビジョン>... / verify / list-heads / unbundle <ファイル>')
      switch (sub) {
        case 'create':
          return bundleCreate(repo, file, rest)
        case 'verify':
          return bundleVerify(repo, file)
        case 'list-heads':
          return bundleListHeads(repo, file)
        case 'unbundle':
          return bundleUnbundle(repo, file)
        default:
          throw new GitError(`error: 未対応の bundle のサブコマンドです: ${sub}`)
      }
    }
    case 'cherry': {
      const parsed = parseArgs(args, { flags: ['-v'], aliases: { '--verbose': '-v' } })
      const [upstream, head, limit, ...extra] = parsed.positional
      if (extra.length > 0) usage('git cherry [-v] [<上流> [<先端> [<境界>]]]')
      // 上流を省略すると、今のブランチの upstream
      const branch = repo.head.type === 'branch' ? repo.head.name : null
      const tracked = branch === null ? undefined : repo.upstreams[branch]
      const base = upstream ?? tracked
      if (base === undefined) throw new GitError('fatal: Could not find a tracked remote branch, please specify <upstream> manually.')
      return cherry(repo, base, head, limit, parsed.flags.has('-v'))
    }
    case 'range-diff':
      return rangeDiff(repo, parseArgs(args, { flags: ['--no-color'] }).positional)
    case 'format-patch': {
      const expanded = args.flatMap((arg) => (/^-\d+$/.test(arg) ? ['--count', arg.slice(1)] : [arg]))
      const parsed = parseArgs(expanded, {
        flags: ['--stdout', '-n', '-N'],
        values: ['-o', '--count', '--start-number'],
        aliases: { '--output-directory': '-o', '--numbered': '-n', '--no-numbered': '-N' },
      })
      atMost(parsed, 1, 'git format-patch [-<数>] [-o <ディレクトリ>] [--stdout] [<起点> | <A>..<B>]')
      const count = parsed.values.get('--count')
      const outputDirectory = parsed.values.get('-o')
      const start = parsed.values.get('--start-number')
      return gitFormatPatch(repo, parsed.positional[0], {
        ...(count === undefined ? {} : { count: Number(count) }),
        ...(outputDirectory === undefined ? {} : { outputDirectory }),
        ...(start === undefined ? {} : { startNumber: Number(start) }),
        ...(parsed.flags.has('-n') ? { numbered: true } : parsed.flags.has('-N') ? { numbered: false } : {}),
        stdout: parsed.flags.has('--stdout'),
      })
    }
    case 'apply': {
      const parsed = parseArgs(args, { flags: ['--check', '--index', '--cached', '-R'], aliases: { '--reverse': '-R' } })
      return gitApply(repo, [...parsed.positional, ...(parsed.paths ?? [])], {
        check: parsed.flags.has('--check'),
        index: parsed.flags.has('--index'),
        cached: parsed.flags.has('--cached'),
        reverse: parsed.flags.has('-R'),
      })
    }
    case 'am': {
      const parsed = parseArgs(args, {
        flags: ['-3', '--continue', '--skip', '--abort', '--quit', '--show-current-patch'],
        aliases: { '--3way': '-3', '--resolved': '--continue', '-r': '--continue' },
      })
      if (parsed.flags.has('--continue')) return amContinue(repo)
      if (parsed.flags.has('--skip')) return amSkip(repo)
      if (parsed.flags.has('--abort')) return amAbort(repo)
      if (parsed.flags.has('--show-current-patch')) return amShowCurrentPatch(repo)
      if (parsed.flags.has('--quit')) {
        if (repo.operation?.type !== 'am') throw new GitError('fatal: Resolve operation not in progress, we are not resuming.')
        return { repo: { ...repo, operation: null }, output: '' }
      }
      return gitAm(repo, [...parsed.positional, ...(parsed.paths ?? [])], { threeWay: parsed.flags.has('-3') })
    }
    case 'sparse-checkout': {
      const [sub, ...rest] = args
      const parsed = parseArgs(rest, { flags: ['--cone', '--no-cone'] })
      if (parsed.flags.has('--no-cone')) throw new GitError('cone モードでない sparse-checkout は、このアプリでは未対応です')
      switch (sub) {
        case 'init':
          return sparseInit(repo)
        case 'set':
          return sparseSet(repo, parsed.positional)
        case 'add':
          return sparseAdd(repo, parsed.positional)
        case 'list':
          return sparseList(repo)
        case 'disable':
          return sparseDisable(repo)
        case 'reapply':
          return { repo, output: '' }
        default:
          usage('git sparse-checkout init / set <ディレクトリ>... / add <ディレクトリ>... / list / disable')
      }
    }
    case 'diff': {
      const parsed = parseArgs(args, {
        flags: ['--staged', '--name-only', '--stat'],
        aliases: { '--cached': '--staged' },
      })
      // -- がなくても、コミットとして読めずファイルとしてあるものは、Git と同じくパスとして扱う
      const split = parsed.positional.findIndex(
        (arg) => !arg.includes('..') && !tryResolveRef(repo, arg) && isKnownPath(repo, arg),
      )
      const commits = split === -1 ? parsed.positional : parsed.positional.slice(0, split)
      const paths = [...(split === -1 ? [] : parsed.positional.slice(split)), ...(parsed.paths ?? [])]
      return gitDiff(repo, {
        staged: parsed.flags.has('--staged'),
        commits,
        ...(paths.length > 0 || parsed.paths ? { paths } : {}),
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
    case 'blame': {
      const expanded = args.flatMap((arg) => (/^-L\d/.test(arg) ? ['-L', arg.slice(2)] : [arg]))
      const parsed = parseArgs(expanded, { values: ['-L'] })
      const files = [...parsed.positional, ...(parsed.paths ?? [])]
      // git blame <ファイル> [<コミット>] と git blame <コミット> -- <ファイル> のどちらの順でも書ける
      const [path, rev] =
        parsed.paths !== null && parsed.positional.length <= 1
          ? [parsed.paths[0], parsed.positional[0]]
          : [files[0], files[1]]
      if (path === undefined || files.length > 2) usage('git blame [-L <開始>,<終了>] <ファイル> [<コミット>]')
      const rangeText = parsed.values.get('-L')
      const match = rangeText === undefined ? null : /^(\d+),(\d+)$/.exec(rangeText)
      if (rangeText !== undefined && !match) usage('git blame -L <開始>,<終了> <ファイル>')
      return blame(repo, path, {
        ...(rev === undefined ? {} : { rev }),
        ...(match ? { range: [Number(match[1]), Number(match[2])] as const } : {}),
      })
    }
    case 'add': {
      const parsed = parseArgs(args, { flags: ['-A'], aliases: { '--all': '-A' } })
      const specs = [...parsed.positional, ...(parsed.paths ?? [])]
      return add(repo, parsed.flags.has('-A') ? [...specs, '.'] : specs)
    }
    case 'rm': {
      const parsed = parseArgs(args, { flags: ['--cached', '-f', '-r'], aliases: { '--force': '-f' } })
      const paths = [...parsed.positional, ...(parsed.paths ?? [])].map((path) => path.replace(/\/$/, ''))
      // サブモジュールは gitlink と .gitmodules の記述ごと消す
      const submodules = paths.filter((path) => isSubmodulePath(repo, path))
      let current = repo
      const lines: string[] = []
      for (const path of submodules) {
        const removed = removeSubmodule(current, path, parsed.flags.has('--cached'))
        current = removed.repo
        lines.push(removed.output)
      }
      const files = paths.filter((path) => !submodules.includes(path))
      if (files.length > 0 || submodules.length === 0) {
        const removed = gitRemove(current, files, {
          cached: parsed.flags.has('--cached'),
          force: parsed.flags.has('-f'),
        })
        current = removed.repo
        if (removed.output) lines.push(removed.output)
      }
      return { repo: current, output: lines.join('\n') }
    }
    case 'submodule':
      return runSubmodule(repo, args, raw)
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
        flags: ['--ff', '--no-ff', '--ff-only', '--no-edit', '--allow-unrelated-histories', ...CONTROL_FLAGS.slice(0, 2)],
        values: ['-m', '-s', '-X'],
        aliases: { '--strategy': '-s', '--strategy-option': '-X' },
      })
      const control = sequencerControl(repo, 'merge', parsed)
      if (control) return control
      if (parsed.positional.length === 0) usage('git merge [-s <ストラテジー>] [-X <オプション>] <ブランチ>...')
      const message = parsed.values.get('-m')
      // --ff / --no-ff / --ff-only がなければ merge.ff の設定 (false なら --no-ff、only なら --ff-only) を使う
      const ffConfig = parsed.flags.has('--ff') ? undefined : repo.config['merge.ff']
      return mergeMany(repo, parsed.positional, {
        ...(message === undefined ? {} : { message }),
        ...strategyOptions(parsed),
        noEdit: parsed.flags.has('--no-edit'),
        allowUnrelated: parsed.flags.has('--allow-unrelated-histories'),
        noFastForward: parsed.flags.has('--no-ff') || ffConfig === 'false',
        fastForwardOnly: parsed.flags.has('--ff-only') || ffConfig === 'only',
      })
    }
    case 'rebase': {
      const parsed = parseArgs(args, {
        flags: [...CONTROL_FLAGS, '-i', '-r', '--autosquash', '--no-autosquash'],
        values: ['-x', '-X'],
        aliases: { '--interactive': '-i', '--exec': '-x', '--rebase-merges': '-r', '--strategy-option': '-X' },
      })
      const control = sequencerControl(repo, 'rebase', parsed)
      if (control) return control
      if (parsed.positional.length !== 1) usage('git rebase [-i] [-r] [-x <コマンド>] <ブランチ>')
      const upstream = parsed.positional[0] as string
      const exec = parsed.values.get('-x')
      const options = {
        ...(exec === undefined ? {} : { exec }),
        ...strategyOptions(parsed),
        rebaseMerges: parsed.flags.has('-r'),
        // rebase.autoSquash の設定は、本物と同じく -i のときだけ既定になる
        autosquash:
          parsed.flags.has('--autosquash') ||
          (!parsed.flags.has('--no-autosquash') && parsed.flags.has('-i') && configBool(repo, 'rebase.autosquash') === true),
      }
      return parsed.flags.has('-i')
        ? rebaseInteractive(repo, upstream, options)
        : rebase(repo, upstream, options)
    }
    case 'cherry-pick': {
      const parsed = parseArgs(args, {
        flags: [...CONTROL_FLAGS, '--allow-empty', '-e'],
        values: ['-m', '-X'],
        aliases: { '--edit': '-e', '--mainline': '-m', '--strategy-option': '-X' },
      })
      const mainline = parseMainline(parsed)
      return (
        sequencerControl(repo, 'cherry-pick', parsed) ??
        cherryPick(repo, parsed.positional, {
          allowEmpty: parsed.flags.has('--allow-empty'),
          edit: parsed.flags.has('-e'),
          ...strategyOptions(parsed),
          ...(mainline === undefined ? {} : { mainline }),
        })
      )
    }
    case 'revert': {
      const parsed = parseArgs(args, {
        flags: [...CONTROL_FLAGS, '--no-edit'],
        values: ['-m', '-X'],
        aliases: { '--mainline': '-m', '--strategy-option': '-X' },
      })
      const mainline = parseMainline(parsed)
      return (
        sequencerControl(repo, 'revert', parsed) ??
        revert(repo, parsed.positional, {
          noEdit: parsed.flags.has('--no-edit'),
          ...strategyOptions(parsed),
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
    case 'bisect':
      return runBisect(repo, args, raw)
    case 'config':
      return runConfig(repo, args)
    case 'worktree':
      return runWorktree(repo, args)
    case 'rerere': {
      const [sub, ...paths] = args
      return rerereCommand(repo, sub, paths)
    }
    case 'reflog': {
      const parsed = parseArgs(args, { flags: [] })
      const [first, second, ...rest] = parsed.positional
      const ref = first === 'show' ? second : first
      if (rest.length > 0 || (first !== 'show' && second !== undefined)) usage('git reflog [show] [<ブランチ>]')
      return reflog(repo, ref)
    }
    case 'push':
      return runPush(repo, args)
    case 'fetch':
      return runFetch(repo, args)
    case 'remote':
      return runRemote(repo, args)
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
  const target = (rest[0] as Token).value
  // >&2 / >&1 は画面に出す (フックからのメッセージ)
  if (target === '&2' || target === '&1') return { repo, output: text.replace(/\n$/, '') }
  return writeFile(repo, target, text, tokens[redirect]?.value === '>>')
}

function requireOne(args: readonly string[], text: string): string {
  if (args.length !== 1) usage(text)
  return args[0] as string
}

const SHELL_COMMANDS = new Set(['echo', 'touch', 'cat', 'ls', 'rm', 'pwd', 'chmod', 'grep', 'exit'])

/** フックの中から実行するフック (git commit を実行する pre-commit など) が、際限なく続かないようにする。 */
let hookDepth = 0

interface HookResult {
  readonly repo: Repo
  readonly lines: readonly string[]
  readonly ok: boolean
}

/**
 * .git/hooks/<名前> のフックを実行する。フックはこのアプリのコマンドを 1 行に 1 つずつ書いたもので、
 * $1・$2 … に引数が入る。失敗したコマンドか exit 0 以外で止まり、失敗とする (シェルの set -e と同じ)。
 * 実行できるようにしていない (chmod +x していない) フックは、Git と同じく警告を出して無視する。
 */
export function runHook(repo: Repo, name: string, args: readonly string[] = []): HookResult {
  const file = repo.gitFiles[`hooks/${name}`]
  if (file === undefined || hookDepth > 3) return { repo, lines: [], ok: true }
  if (!file.executable) {
    const quiet = repo.config['advice.ignoredhook'] === 'false'
    return {
      repo,
      lines: quiet
        ? []
        : [
            `hint: The '.git/hooks/${name}' hook was ignored because it's not set as executable.`,
            'hint: You can disable this warning with `git config advice.ignoredHook false`.',
          ],
      ok: true,
    }
  }
  let current = repo
  const lines: string[] = []
  // sh と同じく、終了ステータスは最後に実行したコマンドのもの。set -e なら失敗したところで止まる
  let status = true
  let errexit = false
  hookDepth++
  try {
    for (const raw of file.content.split('\n')) {
      const line = raw.trim().replace(/\$(\d)/g, (_, n: string) => args[Number(n) - 1] ?? '')
      if (line === '' || line.startsWith('#')) continue
      if (/^set\s+-e\b/.test(line)) {
        errexit = true
        continue
      }
      const parts = splitChain(line)
      for (const [index, part] of parts.entries()) {
        if ((part.op === '&&' && !status) || (part.op === '||' && status)) continue
        const exit = /^exit(?:\s+(\d+))?$/.exec(part.text)
        if (exit) return { repo: current, lines, ok: (exit[1] ?? (status ? '0' : '1')) === '0' }
        if (part.text === '') continue
        const ran = executeLocal(current, part.text)
        if (ran.output) lines.push(ran.output)
        status = ran.ok
        if (ran.ok) current = ran.repo
        // && や || の左側の失敗では止まらない (set -e と同じ)
        const nextOp = parts[index + 1]?.op
        if (!status && errexit && nextOp !== '&&' && nextOp !== '||') return { repo: current, lines, ok: false }
      }
    }
  } finally {
    hookDepth--
  }
  return { repo: current, lines, ok: status }
}

/** commit-msg フック: .git/COMMIT_EDITMSG にメッセージを書いて渡し、フックが書き換えた内容を返す。 */
/**
 * -m のメッセージは、Git と同じく空白だけを整える (# で始まる行は残す)。
 * エディタで書いたメッセージは cleanupMessage で # の行も取り除く。
 */
function cleanupWhitespace(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '')
    .replace(/\n{3,}/g, '\n\n')
}

function runCommitMsgHook(
  repo: Repo,
  message: string,
  mode: 'whitespace' | 'strip' = 'whitespace',
): { repo: Repo; message: string; lines: readonly string[] } {
  if (repo.gitFiles['hooks/commit-msg'] === undefined) return { repo, message, lines: [] }
  const written = writeFile(repo, '.git/COMMIT_EDITMSG', `${message}\n`, false).repo
  const hook = runHook(written, 'commit-msg', ['.git/COMMIT_EDITMSG'])
  if (!hook.ok) throw new GitError([...hook.lines, '(commit-msg フックが失敗したため、コミットしませんでした)'].join('\n'))
  const content = hook.repo.gitFiles['COMMIT_EDITMSG']?.content ?? message
  const edited = mode === 'strip' ? cleanupMessage(content) : cleanupWhitespace(content)
  if (edited === '') throw new GitError([...hook.lines, 'Aborting commit due to empty commit message.'].join('\n'))
  return { repo: hook.repo, message: edited, lines: hook.lines }
}

/** grep [-q] [-v] [-i] [-c] [-E | -F] <パターン> <ファイル>...: 一致する行がなければ失敗する。 */
function runGrep(repo: Repo, args: readonly string[]): OperationResult {
  // -qE は -q -E と同じ
  const expanded = args.flatMap((arg) => (/^-[a-zA-Z]{2,}$/.test(arg) ? [...arg.slice(1)].map((c) => `-${c}`) : [arg]))
  const parsed = parseArgs(expanded, { flags: ['-q', '-v', '-i', '-c', '-E', '-F', '-n'] })
  const [pattern, ...files] = parsed.positional
  if (pattern === undefined || files.length === 0) usage('grep [-q] [-v] [-i] [-c] [-E] <パターン> <ファイル>...')
  let regex: RegExp
  try {
    regex = new RegExp(parsed.flags.has('-F') ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : pattern, parsed.flags.has('-i') ? 'i' : '')
  } catch {
    throw new GitError(`grep: 正規表現として読めません: ${pattern}`)
  }
  const out: string[] = []
  let found = 0
  for (const file of files) {
    const content = readFile(repo, file).output
    const matched = content
      .split('\n')
      .map((text, index) => ({ text, index }))
      .filter(({ text }) => regex.test(text) !== parsed.flags.has('-v'))
    found += matched.length
    if (parsed.flags.has('-c')) out.push(files.length > 1 ? `${file}:${matched.length}` : String(matched.length))
    else {
      for (const { text, index } of matched) {
        const where = `${files.length > 1 ? `${file}:` : ''}${parsed.flags.has('-n') ? `${index + 1}:` : ''}`
        out.push(`${where}${text}`)
      }
    }
  }
  if (found === 0 && !parsed.flags.has('-c')) throw new GitError(parsed.flags.has('-q') ? '' : out.join('\n'))
  return { repo, output: parsed.flags.has('-q') ? '' : out.join('\n') }
}

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
    case 'ls': {
      const dirs = args.filter((arg) => !arg.startsWith('-'))
      if (dirs.length > 1) usage('ls [<ディレクトリ>]')
      return listFiles(repo, dirs[0])
    }
    case 'chmod': {
      const [mode, ...paths] = args
      if (mode === undefined || paths.length === 0) usage('chmod +x <ファイル>...')
      return paths.reduce<OperationResult>((result, path) => chmod(result.repo, mode, path), { repo, output: '' })
    }
    case 'grep':
      return runGrep(repo, args)
    case 'exit':
      throw new GitError('exit は .git/hooks のフックの中でだけ使えます')
    case 'pwd':
      return { repo, output: repo.worktree }
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
    const after = repo.editor?.after
    if (after?.kind !== 'commit' || !after.verify) return { ...saveEditor(repo, parsed.text ?? undefined), ok: true }
    // git commit で開いたエディタ: 保存したメッセージで commit-msg フックを実行してからコミットし、post-commit を実行する
    const text = parsed.text ?? repo.editor?.text ?? ''
    const cleaned = cleanupMessage(text)
    // フックの中のコマンドは、エディタを閉じた状態で実行する
    const closed: Repo = { ...repo, editor: null }
    let checked: { repo: Repo; message: string; lines: readonly string[] }
    try {
      checked = cleaned === '' ? { repo: closed, message: text, lines: [] } : runCommitMsgHook(closed, cleaned, 'strip')
    } catch (error) {
      // フックが失敗したら、Git と同じくエディタを閉じてコミットをやめる
      if (error instanceof GitError) return { repo: closed, output: error.message, ok: false }
      throw error
    }
    const saved = saveEditor({ ...checked.repo, editor: repo.editor }, checked.message)
    const committed = headCommitIdOrNull(saved.repo) !== headCommitIdOrNull(repo)
    const post = committed ? runHook(saved.repo, 'post-commit') : { repo: saved.repo, lines: [], ok: true }
    return { repo: post.repo, output: [...checked.lines, saved.output, ...post.lines].filter(Boolean).join('\n'), ok: true }
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
/**
 * 1 行のコマンドを実行する。repo は一番外側のリポジトリ。
 * cd でサブモジュールの中にいるなら、コマンドはそのサブモジュールで実行し、結果を親に戻す。
 */
export function executeCommand(repo: Repo, input: string): CommandResult {
  // a && b / a || b / a; b は、シェルと同じく順に実行する (エディタの保存の :wq は分けない)
  const parts = input.startsWith(EDITOR_SAVE) ? [] : splitChain(input)
  if (parts.length > 1) {
    let current = repo
    let ok = true
    const outputs: string[] = []
    for (const part of parts) {
      if ((part.op === '&&' && !ok) || (part.op === '||' && ok) || part.text === '') continue
      const ran = executeCommand(current, part.text)
      if (ran.output) outputs.push(ran.output)
      ok = ran.ok
      current = ran.repo
    }
    return { repo: current, output: outputs.join('\n'), ok }
  }
  const tokens = lex(input)
  if (tokens[0]?.value === 'cd' && !tokens[0].quoted) return runCd(repo, tokens.slice(1))
  // git clone は今いる場所に新しいリポジトリを作るので、一番外側のリポジトリで扱う
  const words = tokens.map((token) => token.value)
  const cloneArgs = words[0] === 'clone' ? words.slice(1) : words[0] === 'git' && words[1] === 'clone' ? words.slice(2) : null
  if (cloneArgs !== null && !activeRepo(repo).editor) return runClone(repo, cloneArgs)
  // clone したリポジトリの中にいれば、そのリポジトリで実行する (その中のサブモジュールも同じように扱う)
  const clone = repo.clone === null ? undefined : repo.clones[repo.clone]
  if (repo.clone !== null && clone !== undefined) {
    const result = executeCommand(syncServersIn(repo, clone), input)
    const stored: Repo = { ...repo, clones: { ...repo.clones, [repo.clone]: result.repo } }
    return { ...result, repo: syncServersOut(stored, result.repo) }
  }
  const path = repo.submodule
  const nested = path === null ? undefined : repo.submodules[path]
  if (path === null || nested === undefined) {
    const result = executeLocal(repo, input)
    return { ...result, repo: syncSubmodules(result.repo) }
  }
  const result = executeLocal(syncServersIn(repo, nested), input)
  const stored: Repo = { ...repo, submodules: { ...repo.submodules, [path]: result.repo } }
  return { ...result, repo: syncSubmodules(syncServersOut(stored, result.repo)) }
}

function executeLocal(repo: Repo, input: string): CommandResult {
  const result = executeOnce(repo, input)
  return result.ok ? runPendingExec(result) : result
}

function runClone(root: Repo, args: readonly string[]): CommandResult {
  try {
    const parsed = parseArgs(args, {
      flags: ['--recurse-submodules', '--sparse', '--no-checkout'],
      values: ['-b', '--depth'],
      aliases: { '--branch': '-b', '--recursive': '--recurse-submodules' },
    })
    if (parsed.values.has('--depth')) throw new GitError('浅い clone (--depth) は、このアプリでは未対応です')
    if (parsed.flags.has('--no-checkout')) throw new GitError('--no-checkout は、このアプリでは未対応です')
    const [url, directory, ...extra] = parsed.positional
    if (url === undefined || extra.length > 0) usage('git clone [-b <ブランチ>] [--recurse-submodules] [--sparse] <URL> [<ディレクトリ>]')
    const branch = parsed.values.get('-b')
    return {
      ...gitClone(root, url, directory, {
        ...(branch === undefined ? {} : { branch }),
        recurseSubmodules: parsed.flags.has('--recurse-submodules'),
        sparse: parsed.flags.has('--sparse'),
      }),
      ok: true,
    }
  } catch (error) {
    if (error instanceof GitError) return { repo: root, output: error.message, ok: false }
    throw error
  }
}

function runCd(root: Repo, args: readonly Token[]): CommandResult {
  const editor = activeRepo(root).editor
  if (editor) {
    return { repo: root, output: `エディタで ${editor.file} を開いています。先に「保存して閉じる」を押してください`, ok: false }
  }
  try {
    if (args.length > 1) usage('cd <ディレクトリ>')
    return { ...changeDirectory(root, args[0]?.value), ok: true }
  } catch (error) {
    if (error instanceof GitError) return { repo: root, output: error.message, ok: false }
    throw error
  }
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

function runRedirected(repo: Repo, input: string, tokens: readonly Token[], redirect: number): CommandResult {
  const target = tokens.slice(redirect + 1)
  if (target.length !== 1) return { repo, output: '使い方: <コマンド> > <ファイル>', ok: false }
  const command = input.slice(0, input.lastIndexOf(tokens[redirect]?.value === '>>' ? '>>' : '>')).trim()
  const ran = executeOnce(repo, command)
  if (!ran.ok) return ran
  try {
    const text = ran.output === '' ? '' : `${ran.output}\n`
    const written = writeFile(ran.repo, (target[0] as Token).value, text, tokens[redirect]?.value === '>>')
    return { repo: written.repo, output: '', ok: true }
  } catch (error) {
    if (error instanceof GitError) return { repo, output: error.message, ok: false }
    throw error
  }
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
  // echo 以外のコマンドの > / >> は、出力をファイルに書く (git log > log.txt など)
  const redirect = tokens.findIndex((token) => !token.quoted && (token.value === '>' || token.value === '>>'))
  if (redirect > 0 && tokens[0]?.value !== 'echo') return runRedirected(repo, input, tokens, redirect)
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
    else if (!isGit && name === 'teammate') result = runTeammate(repo, args)
    else if (name === 'help') result = { repo, output: HELP_TEXT }
    else result = runGit(repo, name, args, input)
    return { ...result, ok: true }
  } catch (error) {
    if (error instanceof GitError) {
      return { repo, output: error.message, ok: false }
    }
    throw error
  }
}
