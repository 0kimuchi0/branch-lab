/**
 * 作業ディレクトリのファイルを扱う git のコマンド: clean / mv / check-ignore。
 */
import { describeIgnore, isIgnored } from './ignore'
import { GitError, configBool, isSubmodulePath, type OperationResult, type Repo } from './model'
import { withFile } from './tree'

export interface CleanOptions {
  readonly force?: boolean
  /** -n: 消すものを表示するだけ。 */
  readonly dryRun?: boolean
  /** -d: 追跡していないディレクトリも消す。 */
  readonly directories?: boolean
  /** -x: .gitignore で無視しているファイルも消す。 */
  readonly ignored?: boolean
  /** -X: .gitignore で無視しているファイルだけを消す。 */
  readonly onlyIgnored?: boolean
  readonly quiet?: boolean
}

function under(path: string, spec: string): boolean {
  const prefix = spec.replace(/\/+$/, '')
  return prefix === '.' || path === prefix || path.startsWith(`${prefix}/`)
}

/**
 * path を含む、追跡しているファイルが 1 つもない一番上のディレクトリ (なければ null)。
 * git clean は -d がなければ、こういうディレクトリの中には入らない。
 */
function untrackedDirectory(repo: Repo, path: string): string | null {
  const parts = path.split('/')
  for (let depth = 1; depth < parts.length; depth++) {
    const dir = parts.slice(0, depth).join('/')
    if (!Object.keys(repo.index).some((tracked) => tracked.startsWith(`${dir}/`))) return dir
  }
  return null
}

/** git clean [-n | -f] [-d] [-x | -X] [-q] [<パス>...]: 追跡していないファイルを消す。 */
export function clean(repo: Repo, paths: readonly string[], options: CleanOptions = {}): OperationResult {
  if (!options.force && !options.dryRun && configBool(repo, 'clean.requireforce') !== false) {
    throw new GitError('fatal: clean.requireForce is true and -f not given: refusing to clean')
  }
  const untracked = Object.keys(repo.workdir)
    .filter((path) => !(path in repo.index) && !isSubmodulePath(repo, path))
    .filter((path) => paths.length === 0 || paths.some((spec) => under(path, spec)))
  const removable = (path: string) => {
    const ignored = isIgnored(repo.workdir, repo.index, path)
    return options.onlyIgnored ? ignored : options.ignored || !ignored
  }
  // パスを指定しなければ、-d がないときは追跡していないディレクトリの中に入らない
  const recurse = options.directories || paths.length > 0
  const targets = untracked.filter((path) => removable(path) && (recurse || untrackedDirectory(repo, path) === null)).sort()

  // ディレクトリの中身がすべて消えるなら、ディレクトリを 1 行で表示する (本物と同じ)
  const entries: string[] = []
  const seen = new Set<string>()
  for (const path of targets) {
    const dir = options.directories ? untrackedDirectory(repo, path) : null
    const whole = dir !== null && Object.keys(repo.workdir).filter((file) => file.startsWith(`${dir}/`)).every((file) => targets.includes(file))
    const entry = whole ? `${dir}/` : path
    if (seen.has(entry)) continue
    seen.add(entry)
    entries.push(entry)
  }
  const verb = options.dryRun ? 'Would remove' : 'Removing'
  const output = options.quiet && !options.dryRun ? '' : entries.map((entry) => `${verb} ${entry}`).join('\n')
  if (options.dryRun) return { repo, output }
  let workdir = repo.workdir
  for (const path of targets) workdir = withFile(workdir, path, undefined)
  return { repo: { ...repo, workdir }, output }
}

export interface MoveOptions {
  readonly force?: boolean
  /** -k: 動かせないものは飛ばす。 */
  readonly skipErrors?: boolean
  readonly dryRun?: boolean
  readonly verbose?: boolean
}

function isDirectory(repo: Repo, path: string): boolean {
  return [...Object.keys(repo.workdir), ...Object.keys(repo.index)].some((file) => file.startsWith(`${path}/`))
}

/** git mv [-f] [-k] [-n] [-v] <元>... <先>: 追跡しているファイルの名前を変える・移す。 */
export function gitMove(repo: Repo, args: readonly string[], options: MoveOptions = {}): OperationResult {
  if (args.length < 2) throw new GitError('usage: git mv [<options>] <source>... <destination>')
  const sources = args.slice(0, -1).map((path) => path.replace(/\/+$/, ''))
  const destination = (args.at(-1) as string).replace(/\/+$/, '')
  const intoDirectory = isDirectory(repo, destination) || (args.at(-1) as string).endsWith('/')
  if (sources.length > 1 && !intoDirectory) throw new GitError(`fatal: destination '${destination}' is not a directory`)
  let index = repo.index
  let workdir = repo.workdir
  const lines: string[] = []
  for (const source of sources) {
    const target = intoDirectory ? `${destination}/${source.split('/').at(-1) as string}` : destination
    const fail = (reason: string): boolean => {
      if (options.skipErrors) return false
      throw new GitError(`fatal: ${reason}, source=${source}, destination=${target}`)
    }
    const files = Object.keys(repo.index).filter((path) => path === source || path.startsWith(`${source}/`))
    if (files.length === 0) {
      if (!(source in repo.workdir) && !isDirectory(repo, source)) fail('bad source')
      else fail('not under version control')
      continue
    }
    if (repo.conflicts.some((conflict) => files.includes(conflict.path))) {
      fail('conflicted')
      continue
    }
    if (target === source || target.startsWith(`${source}/`)) {
      fail('can not move directory into itself')
      continue
    }
    const renames = files.map((file) => [file, `${target}${file.slice(source.length)}`] as const)
    const exists = renames.some(([, to]) => to in repo.workdir || to in repo.index)
    if (exists && !options.force) {
      fail('destination exists')
      continue
    }
    if (options.dryRun || options.verbose) {
      if (options.dryRun) lines.push(`Checking rename of '${source}' to '${target}'`)
      lines.push(`Renaming ${source} to ${target}`)
    }
    for (const [from, to] of renames) {
      index = withFile(withFile(index, to, index[from]), from, undefined)
      workdir = withFile(withFile(workdir, to, workdir[from]), from, undefined)
    }
  }
  if (options.dryRun) return { repo, output: lines.join('\n') }
  return { repo: { ...repo, index, workdir }, output: lines.join('\n') }
}

/** git check-ignore [-v] <パス>...: .gitignore で無視しているパスを表示する (なければ失敗する)。 */
export function checkIgnore(repo: Repo, paths: readonly string[], verbose = false): OperationResult {
  if (paths.length === 0) throw new GitError('fatal: no path specified')
  const lines = paths.flatMap((path) => {
    if (path in repo.index) return []
    const line = describeIgnore(repo.workdir, path)
    return line === null ? [] : [verbose ? line : path]
  })
  if (lines.length === 0) throw new GitError('')
  return { repo, output: lines.join('\n') }
}
