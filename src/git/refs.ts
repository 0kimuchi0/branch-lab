/**
 * 参照を直接扱うコマンド: git update-ref / for-each-ref / show-ref。
 * 参照は refs/heads/・refs/tags/・refs/remotes/・refs/original/・refs/replace/ の下にあるものを扱う。
 */
import {
  GitError,
  allRefs,
  fullRefTarget,
  getCommit,
  logRefs,
  resolveRef,
  subject,
  validateRefName,
  type CommitId,
  type OperationResult,
  type Repo,
} from './model'
import { globToRegExp } from './replace'

/** HEAD なら、HEAD が指しているブランチの参照の名前 (detached なら HEAD のまま)。 */
function dereference(repo: Repo, name: string): string {
  if (name !== 'HEAD') return name
  return repo.head.type === 'branch' ? `refs/heads/${repo.head.name}` : 'HEAD'
}

/** 参照を書き換えた Repo (id が undefined なら消す)。reflog は書かない。 */
export function setRef(repo: Repo, name: string, id: CommitId | undefined): Repo {
  const put = <T,>(record: Readonly<Record<string, T>>, key: string, value: T | undefined): Record<string, T> => {
    const next = { ...record }
    if (value === undefined) delete next[key]
    else next[key] = value
    return next
  }
  if (name === 'HEAD') {
    if (id === undefined) throw new GitError('error: このアプリでは HEAD を消せません')
    return { ...repo, head: { type: 'detached', id } }
  }
  const rest = (prefix: string) => name.slice(prefix.length)
  if (name.startsWith('refs/heads/')) {
    if (id !== undefined) validateRefName(rest('refs/heads/'))
    const upstreams = id === undefined ? put(repo.upstreams, rest('refs/heads/'), undefined) : repo.upstreams
    return { ...repo, branches: put(repo.branches, rest('refs/heads/'), id), upstreams }
  }
  if (name.startsWith('refs/tags/')) {
    return { ...repo, tags: put(repo.tags, rest('refs/tags/'), id === undefined ? undefined : { target: id }) }
  }
  if (name.startsWith('refs/remotes/')) return { ...repo, remoteBranches: put(repo.remoteBranches, rest('refs/remotes/'), id) }
  if (name.startsWith('refs/replace/')) return { ...repo, replaces: put(repo.replaces, rest('refs/replace/'), id) }
  if (name.startsWith('refs/original/')) return { ...repo, originalRefs: put(repo.originalRefs, name, id) }
  throw new GitError(
    `fatal: このアプリで update-ref が扱えるのは HEAD と refs/heads/・refs/tags/・refs/remotes/・refs/original/・refs/replace/ の参照です: ${name}`,
  )
}

export interface UpdateRefOptions {
  /** -d: 参照を消す。 */
  readonly delete?: boolean
  /** 今の値がこれでなければ失敗する (<古い値>)。 */
  readonly oldValue?: string
  /** -m: reflog に書くメッセージ。 */
  readonly message?: string
}

/** git update-ref [-m <理由>] (-d <参照> [<古い値>] | <参照> <新しい値> [<古い値>]) */
export function updateRef(repo: Repo, rawName: string, newValue: string | undefined, options: UpdateRefOptions = {}): OperationResult {
  const name = dereference(repo, rawName)
  const current = name === 'HEAD' && repo.head.type === 'detached' ? repo.head.id : fullRefTarget(repo, name)
  if (options.oldValue !== undefined) {
    const expected = resolveRef(repo, options.oldValue)
    if (current !== expected) {
      throw new GitError(
        `fatal: update_ref failed for ref '${name}': cannot lock ref '${name}': ` +
          (current === undefined ? `unable to resolve reference '${name}'` : `is at ${current} but expected ${expected}`),
      )
    }
  }
  if (options.delete) {
    if (current === undefined) return { repo, output: '' }
    return { repo: logRefs(repo, setRef(repo, name, undefined), options.message ?? ''), output: '' }
  }
  if (newValue === undefined) throw new GitError('usage: git update-ref [-m <reason>] <refname> <new-oid> [<old-oid>]')
  const id = resolveRef(repo, newValue)
  getCommit(repo, id)
  return { repo: logRefs(repo, setRef(repo, name, id), options.message ?? ''), output: '' }
}

/** パターンに一致する参照か (for-each-ref: 完全一致・/ までの前方一致・glob)。 */
function matchesPattern(name: string, patterns: readonly string[]): boolean {
  if (patterns.length === 0) return true
  return patterns.some((pattern) => {
    if (/[*?[]/.test(pattern)) return globToRegExp(pattern).test(name)
    const prefix = pattern.replace(/\/+$/, '')
    return name === prefix || name.startsWith(`${prefix}/`)
  })
}

/** 参照の短い名前 (refs/heads/main → main、refs/original/refs/heads/main → original/refs/heads/main)。 */
function shortName(name: string): string {
  for (const prefix of ['refs/heads/', 'refs/tags/', 'refs/remotes/', 'refs/']) {
    if (name.startsWith(prefix)) return name.slice(prefix.length)
  }
  return name
}

/** git for-each-ref [--format=<書式>] [<パターン>...] */
export function forEachRef(repo: Repo, patterns: readonly string[], format?: string): OperationResult {
  const template = format ?? '%(objectname) %(objecttype)\t%(refname)'
  const lines = allRefs(repo)
    .filter(([name]) => matchesPattern(name, patterns))
    .map(([name, id]) =>
      template.replace(/%\(([a-z:]+)\)|%%/g, (_whole, atom: string | undefined) => {
        if (atom === undefined) return '%'
        switch (atom) {
          case 'refname':
            return name
          case 'refname:short':
            return shortName(name)
          case 'objectname':
          case 'objectname:short':
            return id
          case 'objecttype':
            return 'commit'
          case 'subject':
          case 'contents:subject':
            return repo.commits[id] ? subject(repo.commits[id].message) : ''
          default:
            throw new GitError(`fatal: unknown field name: ${atom}`)
        }
      }),
    )
  return { repo, output: lines.join('\n') }
}

/** git show-ref [--heads] [--tags] [--head] [<パターン>...] */
export function showRef(
  repo: Repo,
  patterns: readonly string[],
  options: { readonly heads?: boolean; readonly tags?: boolean; readonly head?: boolean } = {},
): OperationResult {
  const refs = allRefs(repo).filter(([name]) => {
    if (options.heads || options.tags) {
      if (!((options.heads && name.startsWith('refs/heads/')) || (options.tags && name.startsWith('refs/tags/')))) return false
    }
    // show-ref のパターンは、参照の名前の最後の部分 (/ で区切ったもの) と一致すればよい
    return patterns.length === 0 || patterns.some((pattern) => name === pattern || name.endsWith(`/${pattern}`))
  })
  const head = repo.head.type === 'branch' ? repo.branches[repo.head.name] : repo.head.id
  const lines = [
    ...(options.head && head !== undefined && patterns.length === 0 ? [`${head} HEAD`] : []),
    ...refs.map(([name, id]) => `${id} ${name}`),
  ]
  if (lines.length === 0) throw new GitError('')
  return { repo, output: lines.join('\n') }
}
