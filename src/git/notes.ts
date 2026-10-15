/**
 * git notes。コミットを変えずにメモを付ける。本物は refs/notes/commits のコミットとして保存するが、
 * ここでは Repo.notes (コミット → メモ) に持つ。git log と git show の Notes: に表示する。
 */
import {
  EDITOR_WAITING,
  GitError,
  cleanupMessage,
  getCommit,
  openEditor,
  resolveRef,
  subject,
  type CommitId,
  type OperationResult,
  type Repo,
} from './model'

function withNote(repo: Repo, id: CommitId, text: string | undefined): Repo {
  const notes = { ...repo.notes }
  if (text === undefined) delete notes[id]
  else notes[id] = text
  return { ...repo, notes }
}

/** メモを書くエディタを開く (書いてあるメモがあれば、それを最初の内容にする)。 */
function openNoteEditor(repo: Repo, id: CommitId, initial: string): OperationResult {
  const text = [
    initial,
    '',
    '#',
    '# このコミットのメモを書いてください:',
    '#',
    `# ${id} ${subject(getCommit(repo, id).message)}`,
    '#',
    '# # で始まる行は無視されます。空にするとメモを削除します。',
    '',
  ].join('\n')
  return { repo: openEditor(repo, { file: 'NOTES_EDITMSG', text, after: { kind: 'note', target: id } }), output: EDITOR_WAITING }
}

/** エディタで書いたメモを保存する。空ならメモを消す。 */
export function finishNote(repo: Repo, id: CommitId, content: string): OperationResult {
  const message = cleanupMessage(content)
  if (message === '') {
    return {
      repo: withNote(repo, id, undefined),
      output: id in repo.notes ? `Removing note for object ${id}` : '',
    }
  }
  return { repo: withNote(repo, id, message), output: '' }
}

/** git notes add [-f] [-m <メッセージ>]... [<コミット>] */
export function notesAdd(repo: Repo, ref: string | undefined, messages: readonly string[], force = false): OperationResult {
  const id = resolveRef(repo, ref ?? 'HEAD')
  if (id in repo.notes && !force) {
    throw new GitError(
      `error: Cannot add notes. Found existing notes for object ${id}. Use '-f' to overwrite existing notes`,
    )
  }
  if (messages.length === 0) return openNoteEditor(repo, id, force ? (repo.notes[id] ?? '') : '')
  const output = id in repo.notes ? `Overwriting existing notes for object ${id}` : ''
  return { repo: withNote(repo, id, messages.join('\n\n')), output }
}

/** git notes append [-m <メッセージ>]... [<コミット>]: 書いてあるメモの後ろに足す。 */
export function notesAppend(repo: Repo, ref: string | undefined, messages: readonly string[]): OperationResult {
  const id = resolveRef(repo, ref ?? 'HEAD')
  const existing = repo.notes[id]
  if (messages.length === 0) return openNoteEditor(repo, id, existing === undefined ? '' : `${existing}\n\n`)
  const added = messages.join('\n\n')
  return { repo: withNote(repo, id, existing === undefined ? added : `${existing}\n\n${added}`), output: '' }
}

/** git notes edit [<コミット>] */
export function notesEdit(repo: Repo, ref: string | undefined): OperationResult {
  const id = resolveRef(repo, ref ?? 'HEAD')
  return openNoteEditor(repo, id, repo.notes[id] ?? '')
}

/** git notes show [<コミット>] */
export function notesShow(repo: Repo, ref: string | undefined): OperationResult {
  const id = resolveRef(repo, ref ?? 'HEAD')
  const note = repo.notes[id]
  if (note === undefined) throw new GitError(`error: no note found for object ${id}.`)
  return { repo, output: note }
}

/** git notes [list [<コミット>]]: メモが付いているコミットの一覧。 */
export function notesList(repo: Repo, ref: string | undefined): OperationResult {
  if (ref !== undefined) {
    const id = resolveRef(repo, ref)
    if (!(id in repo.notes)) throw new GitError(`error: no note found for object ${id}.`)
    return { repo, output: id }
  }
  return {
    repo,
    output: Object.keys(repo.notes)
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
      .join('\n'),
  }
}

/** git notes remove [<コミット>]... */
export function notesRemove(repo: Repo, refs: readonly string[], ignoreMissing = false): OperationResult {
  let current = repo
  const lines: string[] = []
  for (const ref of refs.length === 0 ? ['HEAD'] : refs) {
    const id = resolveRef(repo, ref)
    if (!(id in current.notes)) {
      if (ignoreMissing) continue
      throw new GitError(`error: Object ${id} has no note`)
    }
    lines.push(`Removing note for object ${id}`)
    current = withNote(current, id, undefined)
  }
  return { repo: current, output: lines.join('\n') }
}

/** git notes copy <元> <先> */
export function notesCopy(repo: Repo, from: string, to: string, force = false): OperationResult {
  const source = resolveRef(repo, from)
  const target = resolveRef(repo, to)
  const note = repo.notes[source]
  if (note === undefined) throw new GitError(`error: missing notes on source object ${source}. Cannot copy.`)
  if (target in repo.notes && !force) {
    throw new GitError(
      `error: Cannot copy notes. Found existing notes for object ${target}. Use '-f' to overwrite existing notes`,
    )
  }
  return { repo: withNote(repo, target, note), output: '' }
}
