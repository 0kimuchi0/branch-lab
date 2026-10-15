import { describe, expect, it } from 'vitest'
import { commitFile, run } from '../test/run'
import { executeCommand } from './commands'
import type { Repo } from './model'

const out = (repo: Repo, line: string) => executeCommand(repo, line).output

/** feature (C1, C2) を main (C3) にマージした (C4) Repo。 */
function merged(): Repo {
  return run([
    'git switch -c feature', ...commitFile('f.txt', 'f'), ...commitFile('f.txt', 'f2'),
    'git switch main', ...commitFile('m.txt', 'm'), 'git merge --no-edit feature',
  ])
}

describe('git log --graph', () => {
  it('分岐とマージを Git と同じ形の線で描く (マージした側の枝が先)', () => {
    expect(out(merged(), 'git log --graph --oneline')).toBe(
      [
        "*   C4 (HEAD -> main) Merge branch 'feature'",
        '|\\',
        '| * C2 (feature) f2',
        '| * C1 f',
        '* | C3 m',
        '|/',
        '* C0 (origin/main) Initial commit',
      ].join('\n'),
    )
  })

  it('--all で、マージしていない枝も描く (離れた列は 1 列ずつ寄せる)', () => {
    const repo = run(['git switch -c topic C1', ...commitFile('t.txt', 't'), 'git switch main'], merged())
    expect(out(repo, 'git log --graph --oneline --all')).toBe(
      [
        '* C5 (topic) t',
        "| *   C4 (HEAD -> main) Merge branch 'feature'",
        '| |\\',
        '| | * C2 (feature) f2',
        '| |/',
        '|/|',
        '* | C1 f',
        '| * C3 m',
        '|/',
        '* C0 (origin/main) Initial commit',
      ].join('\n'),
    )
  })

  it('octopus は *-. で描く。詳しい表示では各行の左にも線を付ける', () => {
    const repo = run([
      'git switch -c a', ...commitFile('a.txt', 'a'),
      'git switch -c b main', ...commitFile('b.txt', 'b'),
      'git switch main', ...commitFile('m.txt', 'm'),
      'git merge --no-edit a b',
    ])
    const lines = out(repo, 'git log --graph -1').split('\n')
    expect(lines.slice(0, 4)).toEqual(['*-.   commit C4 (HEAD -> main)', '|\\ \\  Merge: C3 C1 C2', '| | |', "| | |     Merge branches 'a' and 'b'"])
  })
})

describe('git log の絞り込みと書式', () => {
  it('-n / -N と --reverse、--format の書式', () => {
    const repo = merged()
    expect(out(repo, 'git log --oneline -2')).toBe("C4 (HEAD -> main) Merge branch 'feature'\nC3 m")
    expect(out(repo, 'git log --oneline -n 2 --reverse')).toBe("C3 m\nC4 (HEAD -> main) Merge branch 'feature'")
    expect(out(repo, 'git log --format="%h %s%d" -1 feature')).toBe('C2 f2 (feature)')
    expect(out(repo, "git log --pretty=format:'%h <%p>' -1")).toBe('C4 <C3 C2>')
    expect(executeCommand(repo, 'git log --graph --reverse').ok).toBe(false)
  })

  it('範囲 (A..B / A...B / ^A) と --first-parent / --merges / --no-merges', () => {
    const repo = merged()
    expect(out(repo, 'git log --oneline main..feature')).toBe('')
    expect(out(repo, 'git log --oneline feature..main')).toBe("C4 (HEAD -> main) Merge branch 'feature'\nC3 m")
    expect(out(repo, 'git log --oneline main ^C3')).toBe("C4 (HEAD -> main) Merge branch 'feature'\nC2 (feature) f2\nC1 f")
    expect(out(repo, 'git log --oneline C3...feature')).toBe('C3 m\nC2 (feature) f2\nC1 f')
    expect(out(repo, 'git log --oneline --first-parent')).toBe(
      "C4 (HEAD -> main) Merge branch 'feature'\nC3 m\nC0 (origin/main) Initial commit",
    )
    expect(out(repo, 'git log --oneline --merges')).toBe("C4 (HEAD -> main) Merge branch 'feature'")
    expect(out(repo, 'git log --oneline --no-merges -1')).toBe('C3 m')
  })

  it('--grep と、パスを変えたコミットだけ', () => {
    const repo = merged()
    expect(out(repo, 'git log --oneline --grep=f2')).toBe('C2 (feature) f2')
    expect(out(repo, 'git log --oneline --grep=f --invert-grep')).toBe('C3 m\nC0 (origin/main) Initial commit')
    expect(out(repo, 'git log --oneline f.txt')).toBe('C2 (feature) f2\nC1 f')
    expect(out(repo, 'git log --oneline -- m.txt')).toBe('C3 m')
  })

  it('-p と --stat で変更を付ける', () => {
    const repo = merged()
    expect(out(repo, 'git log --oneline --stat -1 C3')).toBe('C3 m\n m.txt | 1 +\n 1 file changed, 1 insertion(+)')
    expect(out(repo, 'git log -p -1 C3')).toContain('+++ b/m.txt\n@@ -0,0 +1 @@\n+m')
  })
})

describe('git notes', () => {
  it('メモを付けて、log と show に表示する', () => {
    const repo = run(['git notes add -m "レビュー済み"'], merged())
    expect(out(repo, 'git notes show')).toBe('レビュー済み')
    expect(out(repo, 'git log -1')).toContain('\n\nNotes:\n    レビュー済み')
    expect(out(repo, 'git show')).toContain('Notes:\n    レビュー済み')
    expect(out(repo, 'git log -1 --no-notes')).not.toContain('Notes:')
    expect(out(repo, 'git log -1 --format=%N')).toBe('レビュー済み')
    expect(out(repo, 'git notes add -m x')).toBe(
      "error: Cannot add notes. Found existing notes for object C4. Use '-f' to overwrite existing notes",
    )
    const appended = run(['git notes append -m "追記"'], repo)
    expect(appended.notes['C4']).toBe('レビュー済み\n\n追記')
    expect(out(appended, 'git notes')).toBe('C4')
    const removed = executeCommand(appended, 'git notes remove')
    expect(removed.output).toBe('Removing note for object C4')
    expect(executeCommand(removed.repo, 'git notes show').output).toBe('error: no note found for object C4.')
  })

  it('-m がなければエディタで書き、空にすると消す', () => {
    const opened = executeCommand(merged(), 'git notes add C1')
    expect(opened.repo.editor?.file).toBe('NOTES_EDITMSG')
    const saved = run([`:wq ${JSON.stringify('一行目\n\n二行目\n# コメント')}`], opened.repo)
    expect(saved.notes['C1']).toBe('一行目\n\n二行目')
    const cleared = run(['git notes edit C1', ':wq ""'], saved)
    expect(cleared.notes['C1']).toBeUndefined()
  })
})
