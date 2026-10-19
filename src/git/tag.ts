/** git tag。コミットに名前を付ける (軽量タグと、メッセージ付きの注釈付きタグ)。 */
import {
  EDITOR_WAITING,
  GitError,
  cleanupMessage,
  getCommit,
  openEditor,
  requireNoEditor,
  resolveRef,
  validateRefName,
  type CommitId,
  type OperationResult,
  type Repo,
  type Tag,
} from './model'

export interface TagOptions {
  /** タグを付けるコミット (既定は HEAD)。 */
  readonly target?: string
  /** -a: 注釈付きタグにする。message がなければエディタを開く。 */
  readonly annotate?: boolean
  /** -m: 注釈付きタグのメッセージ (-a を付けなくても注釈付きになる)。 */
  readonly message?: string
  /** -f: 同じ名前のタグがあれば付け替える。 */
  readonly force?: boolean
}

function requireNewTag(repo: Repo, name: string, force: boolean): Tag | undefined {
  validateRefName(name)
  const existing = repo.tags[name]
  if (existing && !force) throw new GitError(`fatal: タグ '${name}' はすでに存在します`)
  return existing
}

/** タグを保存する。付け替えたときは Git と同じく元のコミットを表示する。 */
export function storeTag(repo: Repo, name: string, tag: Tag): OperationResult {
  const previous = repo.tags[name]
  return {
    repo: { ...repo, tags: { ...repo.tags, [name]: tag } },
    output: previous && previous.target !== tag.target ? `Updated tag '${name}' (was ${previous.target})` : '',
  }
}

export function createTag(repo: Repo, name: string, options: TagOptions = {}): OperationResult {
  requireNoEditor(repo)
  const force = options.force ?? false
  requireNewTag(repo, name, force)
  const target: CommitId = resolveRef(repo, options.target ?? 'HEAD')
  const message = options.message?.trim()
  if (message) return storeTag(repo, name, { target, message })
  if (!options.annotate) return storeTag(repo, name, { target })
  const text = [
    '',
    '#',
    `# タグ ${name} のメッセージを入力してください。`,
    "# '#' で始まる行は無視されます。",
    '',
  ].join('\n')
  return {
    repo: openEditor(repo, { file: 'TAG_EDITMSG', text, after: { kind: 'tag', name, target, force } }),
    output: EDITOR_WAITING,
  }
}

/** エディタで書いたメッセージで、注釈付きタグを作る。 */
export function finishTag(repo: Repo, name: string, target: CommitId, text: string): OperationResult {
  const message = cleanupMessage(text)
  if (message === '') {
    throw new GitError('fatal: タグのメッセージがありません (no tag message?)')
  }
  return storeTag(repo, name, { target, message })
}

export function deleteTags(repo: Repo, names: readonly string[]): OperationResult {
  requireNoEditor(repo)
  if (names.length === 0) throw new GitError('使い方: git tag -d <タグ>...')
  let tags = { ...repo.tags }
  const lines: string[] = []
  for (const name of names) {
    const tag = tags[name]
    if (!tag) throw new GitError(`error: タグ '${name}' は見つかりません`)
    delete tags[name]
    lines.push(`Deleted tag '${name}' (was ${tag.target})`)
  }
  return { repo: { ...repo, tags }, output: lines.join('\n') }
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`)
}

export interface ListTagsOptions {
  /** --contains / --merged などの絞り込み (タグの指すコミットで判定する)。 */
  readonly filter?: (id: CommitId) => boolean
  /** -n<数>: 注釈 (軽量タグならコミットメッセージ) を何行出すか。 */
  readonly lines?: number
}

/** git tag -l [<パターン>...] [-n<数>]: タグの一覧を名前順に表示する。 */
export function listTags(repo: Repo, patterns: readonly string[] = [], options: ListTagsOptions = {}): OperationResult {
  const matchers = patterns.map((pattern) => globToRegExp(pattern))
  const names = Object.keys(repo.tags)
    .filter((name) => matchers.length === 0 || matchers.some((matcher) => matcher.test(name)))
    .filter((name) => !options.filter || options.filter((repo.tags[name] as Tag).target))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  if (options.lines === undefined) return { repo, output: names.join('\n') }
  const count = options.lines
  const output = names.map((name) => {
    const tag = repo.tags[name] as Tag
    const text = (tag.message ?? getCommit(repo, tag.target).message).split('\n').filter((line) => line !== '')
    const shown = count === 0 ? [] : text.slice(0, count)
    const [head = '', ...more] = shown
    return [`${name.padEnd(15)} ${head}`.replace(/\s+$/, ''), ...more.map((line) => `    ${line}`)].join('\n')
  })
  return { repo, output: output.join('\n') }
}

/** git show <注釈付きタグ> の先頭に出す、タグの情報。 */
export function tagHeader(repo: Repo, ref: string): string[] {
  const tag = repo.tags[ref]
  if (!tag?.message) return []
  return [`tag ${ref}`, '', tag.message, '']
}
