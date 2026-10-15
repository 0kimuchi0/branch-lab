/**
 * git bundle。コミットと参照を 1 つのファイルにまとめ、ネットワークなしでリポジトリを受け渡す。
 * ファイルは本物と同じく、見出し (# v2 git bundle・前提のコミット・参照) のあとに中身を書く。
 * 本物の中身は pack (バイナリ) だが、ここではコミットの JSON を書く。
 */
import {
  GitError,
  ancestors,
  currentBranch,
  getCommit,
  headCommitIdOrNull,
  isAncestor,
  logRefs,
  readFile,
  resolveRef,
  subject,
  writeFile,
  type Commit,
  type CommitId,
  type OperationResult,
  type Repo,
  type Tag,
} from './model'

const SIGNATURE = '# v2 git bundle'

export interface Bundle {
  readonly prerequisites: ReadonlyArray<{ readonly id: CommitId; readonly subject: string }>
  readonly refs: ReadonlyArray<{ readonly id: CommitId; readonly name: string }>
  readonly commits: Readonly<Record<CommitId, Commit>>
  readonly tags: Readonly<Record<string, Tag>>
}

/** 参照の完全な名前 (main → refs/heads/main)。参照でなければ null。 */
function fullRefName(repo: Repo, name: string): string | null {
  if (name === 'HEAD') return 'HEAD'
  if (name in repo.tags) return `refs/tags/${name}`
  if (name in repo.branches) return `refs/heads/${name}`
  if (name in repo.remoteBranches) return `refs/remotes/${name}`
  return null
}

/** git bundle create <ファイル> <リビジョン>...: 指定した参照と、そこからたどれるコミットをファイルにまとめる。 */
export function bundleCreate(repo: Repo, file: string, args: readonly string[]): OperationResult {
  const include: CommitId[] = []
  const exclude: CommitId[] = []
  const refs: Array<{ id: CommitId; name: string }> = []
  const addRef = (name: string, id: CommitId) => {
    if (!refs.some((ref) => ref.name === name)) refs.push({ id, name })
  }
  for (const arg of args) {
    if (arg === '--all' || arg === '--branches') {
      for (const [name, id] of Object.entries(repo.branches)) {
        include.push(id)
        addRef(`refs/heads/${name}`, id)
      }
    }
    if (arg === '--all' || arg === '--tags') {
      for (const [name, tag] of Object.entries(repo.tags)) {
        include.push(tag.target)
        addRef(`refs/tags/${name}`, tag.target)
      }
    }
    if (arg === '--all' || arg === '--remotes') {
      for (const [name, id] of Object.entries(repo.remoteBranches)) {
        include.push(id)
        addRef(`refs/remotes/${name}`, id)
      }
    }
    if (arg === '--all') {
      const head = headCommitIdOrNull(repo)
      if (head !== null) addRef('HEAD', head)
    }
    if (arg.startsWith('--')) continue
    if (arg.startsWith('^')) {
      exclude.push(resolveRef(repo, arg.slice(1)))
    } else if (arg.includes('..')) {
      const [from = '', to = ''] = arg.split('..')
      exclude.push(resolveRef(repo, from || 'HEAD'))
      const id = resolveRef(repo, to || 'HEAD')
      include.push(id)
      const name = fullRefName(repo, to || 'HEAD')
      if (name !== null) addRef(name, id)
    } else {
      const id = resolveRef(repo, arg)
      include.push(id)
      const name = fullRefName(repo, arg)
      if (name !== null) addRef(name, id)
    }
  }
  const excluded = new Set<CommitId>()
  for (const id of exclude) for (const ancestor of ancestors(repo.commits, id)) excluded.add(ancestor)
  const commits: Record<CommitId, Commit> = {}
  for (const id of include) {
    for (const ancestor of ancestors(repo.commits, id)) {
      if (!excluded.has(ancestor)) commits[ancestor] = getCommit(repo, ancestor)
    }
  }
  if (refs.length === 0 || Object.keys(commits).length === 0) throw new GitError('fatal: Refusing to create empty bundle.')
  // 前提のコミット: 含めたコミットの親のうち、含めなかったもの (受け取る側にすでにある必要がある)
  const prerequisites = [
    ...new Set(Object.values(commits).flatMap((commit) => commit.parents.filter((parent) => !(parent in commits)))),
  ].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  const tags = Object.fromEntries(Object.entries(repo.tags).filter(([, tag]) => tag.target in commits))
  const content = [
    SIGNATURE,
    ...prerequisites.map((id) => `-${id} ${subject(getCommit(repo, id).message)}`),
    ...refs.map((ref) => `${ref.id} ${ref.name}`),
    '',
    `PACK ${JSON.stringify({ commits: Object.values(commits), tags })}`,
    '',
  ].join('\n')
  return writeFile(repo, file, content, false)
}

/** バンドルのファイルを読む。 */
export function parseBundle(text: string, file: string): Bundle {
  const lines = text.split('\n')
  if (lines[0] !== SIGNATURE) throw new GitError(`error: '${file}' does not look like a v2 or v3 bundle file`)
  const prerequisites: Array<{ id: CommitId; subject: string }> = []
  const refs: Array<{ id: CommitId; name: string }> = []
  let pack: { commits: Commit[]; tags: Record<string, Tag> } = { commits: [], tags: {} }
  for (const line of lines.slice(1)) {
    if (line.startsWith('PACK ')) {
      try {
        pack = JSON.parse(line.slice('PACK '.length)) as typeof pack
      } catch {
        throw new GitError(`error: '${file}' の中身が壊れています`)
      }
    } else if (line.startsWith('-')) {
      const [id = '', ...rest] = line.slice(1).split(' ')
      prerequisites.push({ id, subject: rest.join(' ') })
    } else if (line !== '') {
      const [id = '', name = ''] = line.split(' ')
      refs.push({ id, name })
    }
  }
  return { prerequisites, refs, commits: Object.fromEntries(pack.commits.map((commit) => [commit.id, commit])), tags: pack.tags }
}

export function readBundle(repo: Repo, file: string): Bundle {
  let text: string
  try {
    text = readFile(repo, file).output
  } catch {
    throw new GitError(`error: could not open '${file}'`)
  }
  return parseBundle(text, file)
}

/** 前提のコミットがリポジトリにあるか確かめる。 */
function requirePrerequisites(repo: Repo, bundle: Bundle): void {
  const missing = bundle.prerequisites.filter((prerequisite) => !(prerequisite.id in repo.commits))
  if (missing.length > 0) {
    throw new GitError(
      ['error: Repository lacks these prerequisite commits:', ...missing.map((item) => `error: ${item.id} ${item.subject}`)].join('\n'),
    )
  }
}

/** git bundle verify <ファイル> */
export function bundleVerify(repo: Repo, file: string): OperationResult {
  const bundle = readBundle(repo, file)
  requirePrerequisites(repo, bundle)
  const count = (n: number, one: string, many: string) => (n === 1 ? one : many.replace('N', String(n)))
  return {
    repo,
    output: [
      count(bundle.refs.length, 'The bundle contains this ref:', 'The bundle contains these N refs:'),
      ...bundle.refs.map((ref) => `${ref.id} ${ref.name}`),
      ...(bundle.prerequisites.length === 0
        ? ['The bundle records a complete history.']
        : [
            count(bundle.prerequisites.length, 'The bundle requires this ref:', 'The bundle requires these N refs:'),
            ...bundle.prerequisites.map((item) => item.id),
          ]),
      `${file} is okay`,
    ].join('\n'),
  }
}

/** git bundle list-heads <ファイル> */
export function bundleListHeads(repo: Repo, file: string): OperationResult {
  const bundle = readBundle(repo, file)
  return { repo, output: bundle.refs.map((ref) => `${ref.id} ${ref.name}`).join('\n') }
}

/** バンドルのコミットとタグをリポジトリに取り込む。 */
export function importBundle(repo: Repo, bundle: Bundle): Repo {
  requirePrerequisites(repo, bundle)
  return {
    ...repo,
    commits: { ...repo.commits, ...bundle.commits },
    tags: { ...bundle.tags, ...repo.tags },
  }
}

/** バンドルの参照を名前で探す (main → refs/heads/main など)。 */
function findBundleRef(bundle: Bundle, name: string): { id: CommitId; name: string } | undefined {
  return bundle.refs.find(
    (ref) => ref.name === name || ref.name === `refs/heads/${name}` || ref.name === `refs/tags/${name}` || ref.name === `refs/remotes/${name}`,
  )
}

/** git bundle unbundle <ファイル>: コミットを取り込み、参照を表示する (参照は作らない)。 */
export function bundleUnbundle(repo: Repo, file: string): OperationResult {
  const bundle = readBundle(repo, file)
  return { repo: importBundle(repo, bundle), output: bundle.refs.map((ref) => `${ref.id} ${ref.name}`).join('\n') }
}

/**
 * git fetch <バンドル> [<元>[:<先>]]...: バンドルから取り込む。先を書けばそのブランチを更新し
 * (fast-forward でなければ、先頭に + がない限り拒否)、書かなければ FETCH_HEAD に入れる。
 */
export function fetchBundle(repo: Repo, file: string, refspecs: readonly string[]): OperationResult {
  const bundle = readBundle(repo, file)
  let current = importBundle(repo, bundle)
  const lines = [`From ${file}`]
  const specs = refspecs.length > 0 ? refspecs : [bundle.refs.find((ref) => ref.name === 'HEAD') ? 'HEAD' : (bundle.refs[0]?.name ?? '')]
  let fetchHead: Repo['fetchHead'] = null
  for (const raw of specs) {
    const force = raw.startsWith('+')
    const [source = '', destination] = (force ? raw.slice(1) : raw).split(':')
    const ref = findBundleRef(bundle, source)
    if (ref === undefined) throw new GitError(`fatal: couldn't find remote ref ${source}`)
    const short = ref.name.replace(/^refs\/(heads|tags|remotes)\//, '')
    if (destination === undefined || destination === '') {
      fetchHead ??= { id: ref.id, description: `branch '${short}' of ${file}` }
      lines.push(` * branch            ${short} -> FETCH_HEAD`)
      continue
    }
    if (destination === currentBranch(current)) {
      throw new GitError(`fatal: refusing to fetch into branch 'refs/heads/${destination}' checked out at '${current.worktree}'`)
    }
    const before = current.branches[destination]
    if (before === ref.id) continue
    if (before !== undefined && !force && !isAncestor(current, before, ref.id)) {
      lines.push(` ! [rejected]        ${short} -> ${destination}  (non-fast-forward)`)
      continue
    }
    const updated: Repo = { ...current, branches: { ...current.branches, [destination]: ref.id } }
    current = logRefs(current, updated, `fetch ${file} ${raw}: ${before === undefined ? 'storing head' : 'fast-forward'}`)
    lines.push(before === undefined ? ` * [new branch]      ${short} -> ${destination}` : `   ${before}..${ref.id}  ${short} -> ${destination}`)
  }
  return { repo: fetchHead === null ? current : { ...current, fetchHead }, output: lines.join('\n') }
}
