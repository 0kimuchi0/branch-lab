import { describe, expect, it } from 'vitest'
import { commitFile, run } from '../test/run'
import { editorSaveCommand, executeCommand, parseEditorSave } from './commands'
import { cleanupMessage, currentBranch, reachableCommits, type Repo } from './model'

/** エディタの内容の、コメントと空行を除いた行。 */
function editorLines(repo: Repo): string[] {
  return (repo.editor?.text ?? '').split('\n').filter((line) => line !== '' && !line.startsWith('#'))
}

describe('cleanupMessage', () => {
  it('コメント行・行末の空白・前後と連続する空行を取り除く', () => {
    expect(cleanupMessage('\n\n件名  \n\n\n本文\n# コメント\n\n')).toBe('件名\n\n本文')
    expect(cleanupMessage('# コメントだけ\n')).toBe('')
  })
})

describe('エディタ', () => {
  it('-m なしの commit はエディタを開き、保存した内容でコミットする', () => {
    const opened = executeCommand(run(['echo x >> README.md', 'git add .']), 'git commit')
    expect(opened.output).toContain('エディタが閉じられるのを待っています')
    expect(opened.repo.editor?.file).toBe('COMMIT_EDITMSG')
    expect(opened.repo.editor?.text).toContain('# ブランチ main')
    expect(opened.repo.branches['main']).toBe('C0')

    const saved = run([editorSaveCommand('README を更新\n\n詳しい説明\n# コメント\n')], opened.repo)
    expect(saved.editor).toBeNull()
    expect(saved.commits['C1']?.message).toBe('README を更新\n\n詳しい説明')
  })

  it('空のメッセージで保存するとコミットを中止する', () => {
    const opened = run(['echo x >> README.md', 'git add .', 'git commit'])
    const result = executeCommand(opened, ':wq')
    expect(result.output).toContain('コミットを中止しました')
    expect(result.repo.editor).toBeNull()
    expect(result.repo.branches['main']).toBe('C0')
  })

  it('エディタが開いている間は、ほかのコマンドを実行できない', () => {
    const opened = run(['echo x >> README.md', 'git add .', 'git commit'])
    const result = executeCommand(opened, 'git status')
    expect(result.ok).toBe(false)
    expect(result.repo).toBe(opened)
    expect(executeCommand(run([]), ':wq').ok).toBe(false)
  })

  it('merge は既定のメッセージ入りでエディタを開き、そのまま閉じればそのメッセージになる', () => {
    const repo = run([
      'git switch -c feature', ...commitFile('f.txt', 'f'), 'git switch main', ...commitFile('m.txt', 'm'),
      'git merge feature', ':wq',
    ])
    expect(repo.commits['C3']).toMatchObject({ parents: ['C2', 'C1'], message: "Merge branch 'feature'" })
  })

  it('revert は既定でエディタを開き、--no-edit なら開かない', () => {
    const base = run(commitFile('a.txt', 'a'))
    expect(executeCommand(base, 'git revert HEAD').repo.editor?.file).toBe('COMMIT_EDITMSG')
    expect(executeCommand(base, 'git revert --no-edit HEAD').repo.editor).toBeNull()
  })

  it('--amend は元のメッセージでエディタを開く', () => {
    const repo = run([...commitFile('a.txt', 'a', '元のメッセージ'), 'git commit --amend'])
    expect(editorLines(repo)[0]).toBe('元のメッセージ')
  })

  it('保存したコマンドは、内容ごとログと共有 URL に残せる形になる', () => {
    expect(parseEditorSave(editorSaveCommand('a "b"\nc'))).toEqual({ text: 'a "b"\nc' })
    // Git が読み飛ばすコメント行は記録しない
    expect(parseEditorSave(editorSaveCommand('pick C1\n# コメント\n\n'))).toEqual({ text: 'pick C1' })
    expect(parseEditorSave(':wq')).toEqual({ text: null })
    expect(parseEditorSave('git status')).toBeNull()
  })
})

/** main に a.txt を 1 行ずつ追記する C1〜C3 を積んだ Repo。 */
function threeCommits(): Repo {
  return run([
    ...commitFile('a.txt', 'one', '1 つ目'),
    ...commitFile('b.txt', 'two', '2 つ目'),
    ...commitFile('c.txt', 'three', '3 つ目'),
  ])
}

function rebaseI(repo: Repo, todo: string, ...after: string[]): Repo {
  return run(['git rebase -i HEAD~3', editorSaveCommand(todo), ...after], repo)
}

describe('rebase -i', () => {
  it('todo には古い順に pick が並び、そのまま閉じれば何も変わらない', () => {
    const opened = run(['git rebase -i HEAD~3'], threeCommits())
    expect(opened.editor?.file).toBe('git-rebase-todo')
    expect(editorLines(opened)).toEqual(['pick C1 1 つ目', 'pick C2 2 つ目', 'pick C3 3 つ目'])
    const done = run([':wq'], opened)
    expect(done.branches['main']).toBe('C3')
    expect(currentBranch(done)).toBe('main')
    expect(Object.keys(done.commits)).toHaveLength(4)
  })

  it('並べ替えと drop で履歴を組み替える', () => {
    const repo = rebaseI(threeCommits(), 'pick C3\npick C1\n')
    expect(repo.commits['C4']).toMatchObject({ parents: ['C0'], message: '3 つ目', source: 'C3' })
    expect(repo.commits['C5']).toMatchObject({ parents: ['C4'], message: '1 つ目', source: 'C1' })
    expect(repo.branches['main']).toBe('C5')
    expect(repo.workdir['b.txt']).toBeUndefined()
  })

  it('親が変わらない pick は作り直さず、後ろの reword だけ新しいコミットになる', () => {
    const opened = rebaseI(threeCommits(), 'pick C1\npick C2\nreword C3\n')
    expect(opened.editor?.file).toBe('COMMIT_EDITMSG')
    expect(editorLines(opened)[0]).toBe('3 つ目')
    const done = run([editorSaveCommand('3 つ目 (書き直し)')], opened)
    expect(done.commits['C4']).toMatchObject({ parents: ['C2'], message: '3 つ目 (書き直し)' })
    expect(done.branches['main']).toBe('C4')
    expect(reachableCommits(done).has('C3')).toBe(false)
  })

  it('squash はメッセージをまとめてエディタを開き、fixup は直前のメッセージを残す', () => {
    const squashed = rebaseI(threeCommits(), 'pick C1\nsquash C2\nfixup C3\n')
    expect(squashed.editor?.text).toContain('# これは 3 個のコミットの組み合わせです。')
    expect(editorLines(squashed)).toEqual(['1 つ目', '2 つ目'])
    const done = run([':wq'], squashed)
    const tip = done.commits[done.branches['main'] as string]
    expect(tip).toMatchObject({ parents: ['C0'], message: '1 つ目\n\n2 つ目' })
    expect(tip?.tree).toMatchObject({ 'a.txt': 'one\n', 'b.txt': 'two\n', 'c.txt': 'three\n' })

    const fixed = rebaseI(threeCommits(), 'pick C1\nfixup C2\nfixup C3\n')
    expect(fixed.editor).toBeNull()
    expect(fixed.commits[fixed.branches['main'] as string]?.message).toBe('1 つ目')
  })

  it('edit で止まり、--amend で直して --continue で続ける', () => {
    const stopped = rebaseI(threeCommits(), 'pick C1\nedit C2\npick C3\n')
    expect(stopped.head).toEqual({ type: 'detached', id: 'C2' })
    expect(stopped.operation).toMatchObject({ type: 'rebase', current: null })
    const done = run(['echo more >> b.txt', 'git commit -a --amend --no-edit', 'git rebase --continue'], stopped)
    expect(currentBranch(done)).toBe('main')
    expect(done.commits['C4']).toMatchObject({ parents: ['C1'], message: '2 つ目' })
    expect(done.commits['C5']).toMatchObject({ parents: ['C4'], message: '3 つ目', source: 'C3' })
    expect(done.workdir['b.txt']).toBe('two\nmore\n')
  })

  it('todo を空にすると中止し、書き方が間違っていればエディタを開いたままにする', () => {
    const before = threeCommits()
    const emptied = rebaseI(before, '# 何もしない\n')
    expect(emptied.branches).toEqual(before.branches)
    expect(emptied.operation).toBeNull()

    const opened = run(['git rebase -i HEAD~3'], before)
    for (const bad of ['oops C1', 'pick', 'squash C1', 'pick nope']) {
      const result = executeCommand(opened, editorSaveCommand(bad))
      expect(result.ok, bad).toBe(false)
      expect(result.repo.editor).not.toBeNull()
    }
  })

  it('--abort で始める前に戻る', () => {
    const before = threeCommits()
    const repo = rebaseI(before, 'pick C1\nedit C2\npick C3\n', 'git rebase --abort')
    expect(repo.branches['main']).toBe('C3')
    expect(currentBranch(repo)).toBe('main')
  })
})
