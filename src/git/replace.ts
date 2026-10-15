/**
 * git replace。refs/replace/<コミット> に置き換え先を記録すると (Repo.replaces)、ほとんどのコマンドは
 * 元のコミットの ID のまま、置き換え先の内容 (メッセージ・ファイル・親) でそのコミットを読む。
 * gc・prune・fsck・push・fetch など、本物の Git でも置き換えを使わないコマンドは元の内容のまま扱う。
 */
import {
  GitError,
  getCommit,
  resolveRef,
  storeCommit,
  type Commit,
  type CommitId,
  type OperationResult,
  type Repo,
} from './model'

/** 置き換えをたどる深さの上限 (本物の Git と同じ 5)。 */
const MAX_DEPTH = 5

/** id を置き換えたコミット (置き換え先がさらに置き換えられていれば、その先までたどる)。 */
function replacementOf(repo: Repo, id: CommitId): CommitId {
  let current = id
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const next = repo.replaces[current]
    if (next === undefined) return current
    current = next
  }
  throw new GitError(`fatal: replace depth too high for object ${id}`)
}

/** 置き換えを反映した Repo (置き換えたコミットは、元の ID のまま置き換え先の内容になる)。 */
export function withReplacements(repo: Repo): Repo {
  const replaced = Object.keys(repo.replaces).filter((id) => id in repo.commits)
  if (replaced.length === 0) return repo
  const commits: Record<CommitId, Commit> = { ...repo.commits }
  for (const id of replaced) {
    const replacement = repo.commits[replacementOf(repo, id)]
    if (replacement) commits[id] = { ...replacement, id }
  }
  return { ...repo, commits }
}

/** withReplacements で実行した結果のコミットを、元の内容に戻す (新しく作ったコミットはそのまま)。 */
export function restoreOriginals(raw: Repo, result: Repo): Repo {
  const replaced = Object.keys(raw.replaces).filter((id) => raw.commits[id] !== undefined && result.commits[id] !== raw.commits[id])
  if (replaced.length === 0) return result
  const commits: Record<CommitId, Commit> = { ...result.commits }
  for (const id of replaced) commits[id] = raw.commits[id] as Commit
  return { ...result, commits }
}

function requireFree(repo: Repo, id: CommitId, force: boolean): void {
  if (id in repo.replaces && !force) throw new GitError(`error: replace ref 'refs/replace/${id}' already exists`)
}

/** git replace [-f] <コミット> <置き換え先> */
export function replaceAdd(repo: Repo, objectRef: string, replacementRef: string, force = false): OperationResult {
  const id = resolveRef(repo, objectRef)
  const replacement = resolveRef(repo, replacementRef)
  if (id === replacement) throw new GitError(`error: new object is the same as the old one: '${id}'`)
  requireFree(repo, id, force)
  return { repo: { ...repo, replaces: { ...repo.replaces, [id]: replacement } }, output: '' }
}

/** git replace [-f] --graft <コミット> [<親>...]: 親だけを変えたコミットを作って置き換える。 */
export function replaceGraft(repo: Repo, commitRef: string, parentRefs: readonly string[], force = false): OperationResult {
  const id = resolveRef(repo, commitRef)
  const parents = parentRefs.map((ref) => resolveRef(repo, ref))
  requireFree(repo, id, force)
  const original = getCommit(repo, id)
  if (parents.length === original.parents.length && parents.every((parent, index) => parent === original.parents[index])) {
    return { repo, output: `warning: graft for '${id}' unnecessary` }
  }
  const stored = storeCommit(repo, { ...original, parents })
  return { repo: { ...stored.repo, replaces: { ...stored.repo.replaces, [id]: stored.id } }, output: '' }
}

/** git replace -d <コミット>... */
export function replaceDelete(repo: Repo, refs: readonly string[]): OperationResult {
  if (refs.length === 0) throw new GitError('usage: git replace -d <object>...')
  const replaces = { ...repo.replaces }
  const lines: string[] = []
  for (const ref of refs) {
    const id = ref in replaces ? ref : resolveRef(repo, ref)
    if (!(id in replaces)) throw new GitError([...lines, `error: replace ref '${ref}' not found`].join('\n'))
    delete replaces[id]
    lines.push(`Deleted replace ref '${id}'`)
  }
  return { repo: { ...repo, replaces }, output: lines.join('\n') }
}

/** fnmatch と同じ * と ? のパターン。 */
export function globToRegExp(pattern: string): RegExp {
  const body = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${body}$`)
}

/** git replace [-l [<パターン>]] [--format=short|medium|long] */
export function replaceList(repo: Repo, pattern?: string, format = 'short'): OperationResult {
  if (!['short', 'medium', 'long'].includes(format)) {
    throw new GitError(`fatal: invalid replace format '${format}'\nvalid formats are 'short', 'medium' and 'long'`)
  }
  const regex = pattern === undefined ? null : globToRegExp(pattern)
  const ids = Object.keys(repo.replaces)
    .filter((id) => regex === null || regex.test(id))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  const lines = ids.map((id) => {
    const target = repo.replaces[id] as CommitId
    if (format === 'short') return id
    if (format === 'medium') return `${id} -> ${target}`
    return `${id} (commit) -> ${target} (commit)`
  })
  return { repo, output: lines.join('\n') }
}
