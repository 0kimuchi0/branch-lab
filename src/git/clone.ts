/**
 * git clone。clone したリポジトリは ~/teammate のような場所に別のリポジトリとして持ち (Repo.clones)、
 * cd で中に入って使う。取得元は、一番外側のリポジトリのリモート (origin など) か、サブモジュールの取得元と同じ URL のもの。
 */
import {
  GitError,
  MAIN_WORKTREE,
  readFile,
  type Repo,
  type OperationResult,
} from './model'

function readFileOrNull(repo: Repo, path: string): string | null {
  try {
    return readFile(repo, path).output
  } catch {
    return null
  }
}
import { parseBundle } from './bundle'
import { activeRepo, cloneRemote, submoduleUpdate, syncServersOut } from './submodule'
import { allLocations, currentDirectory, resolvePath } from './worktree'

export interface CloneOptions {
  readonly branch?: string
  readonly recurseSubmodules?: boolean
  readonly sparse?: boolean
}

function nameFromUrl(url: string): string {
  const name = url.replace(/\/+$/, '').split(/[/:]/).at(-1)?.replace(/\.git$/, '') ?? ''
  if (name === '') throw new GitError(`fatal: '${url}' からディレクトリ名を決められません。clone 先も指定してください`)
  return name
}

/** git clone [--branch <ブランチ>] [--recurse-submodules] [--sparse] <URL> [<ディレクトリ>] (root は一番外側のリポジトリ) */
export function gitClone(root: Repo, url: string, directory: string | undefined, options: CloneOptions = {}): OperationResult {
  let remote = Object.values(root.remotes).find((other) => other.url === url)
  const library = root.libraries[url]
  // 今いる場所のバンドルのファイルからも clone できる
  if (!remote && !library) {
    const here = activeRepo(root)
    const file = readFileOrNull(here, url)
    if (file !== null && file.startsWith('# v2 git bundle')) {
      const bundle = parseBundle(file, url)
      if (bundle.prerequisites.length > 0) {
        throw new GitError(`fatal: ${url} は前提のコミット (${bundle.prerequisites.map((item) => item.id).join(', ')}) が必要なので、clone できません`)
      }
      const branches = Object.fromEntries(
        bundle.refs.filter((ref) => ref.name.startsWith('refs/heads/')).map((ref) => [ref.name.slice('refs/heads/'.length), ref.id]),
      )
      remote = { name: 'origin', url: resolvePath(currentDirectory(root), url), commits: bundle.commits, branches, tags: bundle.tags }
    }
  }
  if (!remote && !library) {
    throw new GitError(
      `fatal: repository '${url}' not found\n` +
        '(このアプリで clone できるのは、リモート (git remote -v) とサブモジュールの URL と、バンドルのファイルです)',
    )
  }
  const name = directory ?? nameFromUrl(url)
  const path = resolvePath(currentDirectory(root), name)
  const taken = allLocations(root).map((location) => location.path)
  if (taken.some((other) => other === path || path.startsWith(`${other}/`) || other.startsWith(`${path}/`))) {
    throw new GitError(
      taken.includes(path)
        ? `fatal: destination path '${name}' already exists and is not an empty directory.`
        : `fatal: このアプリでは、clone 先は worktree や clone したリポジトリの外 (${MAIN_WORKTREE} と同じ階層など) にしてください`,
    )
  }
  let cloned: Repo
  if (remote) {
    cloned = cloneRemote(remote, { worktree: path, nextId: root.nextId, ...(options.branch ? { branch: options.branch } : {}) })
  } else {
    const source = library as NonNullable<typeof library>
    cloned = cloneRemote(source.remote, {
      worktree: path,
      prefix: source.prefix,
      nextId: source.nextId,
      ...(options.branch ? { branch: options.branch } : {}),
    })
  }
  cloned = { ...cloned, libraries: root.libraries, ...(options.sparse ? { sparse: [] } : {}) }
  const lines = [`Cloning into '${name}'...`]
  if (options.recurseSubmodules) {
    const updated = submoduleUpdate(cloned, [], { init: true, recursive: true })
    cloned = updated.repo
    if (updated.output) lines.push(updated.output)
  }
  const stored: Repo = { ...root, clones: { ...root.clones, [path]: cloned } }
  return { repo: syncServersOut(stored, cloned), output: lines.join('\n') }
}
