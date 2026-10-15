import { describe, expect, it } from 'vitest'
import { commitFile, run } from '../test/run'
import { executeCommand } from './commands'
import { headCommitId, type Repo } from './model'

const out = (repo: Repo, line: string) => executeCommand(repo, line).output

/** .git/hooks/<名前> にスクリプトを書いて、実行できるようにした Repo。 */
function withHook(name: string, lines: readonly string[], base: Repo = run([])): Repo {
  return run(
    [...lines.map((line, i) => `echo ${JSON.stringify(line)} ${i === 0 ? '>' : '>>'} .git/hooks/${name}`), `chmod +x .git/hooks/${name}`],
    base,
  )
}

describe('.git の中のファイル', () => {
  it('.git/hooks に書いたファイルは作業ディレクトリに入らず、ls .git/hooks と cat で見られる', () => {
    const repo = run(['echo "exit 0" > .git/hooks/pre-commit'])
    expect(repo.workdir['.git/hooks/pre-commit']).toBeUndefined()
    expect(out(repo, 'ls .git/hooks')).toBe('pre-commit')
    expect(out(repo, 'cat .git/hooks/pre-commit')).toBe('exit 0')
    expect(out(repo, 'git status')).toContain('作業ツリーはクリーンです')
    expect(executeCommand(repo, 'echo x > .git/config').ok).toBe(false)
  })
})

describe('フック', () => {
  it('pre-commit が失敗するとコミットしない。--no-verify で飛ばせる', () => {
    const repo = withHook('pre-commit', ['#!/bin/sh', 'echo "TODO を消してください" >&2', 'grep -q TODO a.txt && exit 1', 'exit 0'])
    // grep が一致しなければ (TODO がなければ) その行で失敗するので、TODO があるときだけ exit 1 まで進む
    const blocked = executeCommand(run(['echo "TODO" > a.txt', 'git add a.txt'], repo), 'git commit -m "a"')
    expect(blocked.ok).toBe(false)
    expect(blocked.output).toBe('TODO を消してください\n(pre-commit フックが失敗したため、コミットしませんでした)')
    const bypassed = run(['echo "TODO" > a.txt', 'git add a.txt', 'git commit --no-verify -m "a"'], repo)
    expect(bypassed.commits[headCommitId(bypassed)]?.message).toBe('a')
  })

  it('commit-msg は $1 のファイルでメッセージを確かめ、書き換えることもできる', () => {
    const repo = withHook('commit-msg', ['grep -qE "#[0-9]+" "$1" || exit 1', 'echo "Signed-off-by: BranchLab" >> "$1"'])
    const rejected = executeCommand(run(['echo "a" > a.txt', 'git add a.txt'], repo), 'git commit -m "番号なし"')
    expect(rejected.ok).toBe(false)
    expect(rejected.output).toContain('commit-msg フックが失敗した')
    const accepted = run(['echo "a" > a.txt', 'git add a.txt', 'git commit -m "#12 機能を追加"'], repo)
    expect(accepted.commits[headCommitId(accepted)]?.message).toBe('#12 機能を追加\nSigned-off-by: BranchLab')
    // エディタで書いたメッセージにも実行する
    const editing = executeCommand(run(['echo "b" > b.txt', 'git add b.txt'], repo), 'git commit')
    const noNumber = executeCommand(editing.repo, ':wq "番号なし"')
    expect(noNumber.ok).toBe(false)
    expect(noNumber.output).toBe('(commit-msg フックが失敗したため、コミットしませんでした)')
    expect(noNumber.repo.editor).toBeNull()
    // エディタでは # で始まる行はコメントになるので、番号は行の途中に書く (Git と同じ)
    const saved = run([':wq "エディタで書いた (#3)"'], editing.repo)
    expect(saved.commits[headCommitId(saved)]?.message).toBe('エディタで書いた (#3)\nSigned-off-by: BranchLab')
  })

  it('実行できるようにしていないフックは、警告を出して無視する', () => {
    const repo = run(['echo "exit 1" > .git/hooks/pre-commit', ...commitFile('a.txt', 'a')])
    expect(repo.commits[headCommitId(repo)]?.message).toBe('a')
    const result = executeCommand(run(['echo "b" > b.txt', 'git add b.txt'], repo), 'git commit -m b')
    expect(result.output.split('\n')[0]).toBe("hint: The '.git/hooks/pre-commit' hook was ignored because it's not set as executable.")
    const quiet = executeCommand(run(['git config advice.ignoredHook false', 'echo "c" > c.txt', 'git add c.txt'], repo), 'git commit -m c')
    expect(quiet.output).toBe('[main C2] c')
  })

  it('pre-push は $1 にリモート名、$2 に URL が入り、失敗すると push しない', () => {
    const repo = withHook('pre-push', ['echo "push 先: $1 $2"', 'exit 1'], run(commitFile('a.txt', 'a')))
    const result = executeCommand(repo, 'git push')
    expect(result.ok).toBe(false)
    expect(result.output).toBe(
      "push 先: origin https://example.com/branch-lab.git\nerror: failed to push some refs to 'https://example.com/branch-lab.git'",
    )
    expect(run(['git push --no-verify'], repo).remotes.origin?.branches['main']).toBe('C1')
  })

  it('pre-rebase が失敗すると rebase しない。post-checkout / post-merge / post-commit はあとで実行する', () => {
    const repo = withHook('pre-rebase', ['echo "rebase 禁止 ($1)"', 'exit 1'], run(['git switch -c topic', ...commitFile('t.txt', 't')]))
    expect(out(repo, 'git rebase main')).toBe('rebase 禁止 (main)\nThe pre-rebase hook refused to rebase.')
    const checkout = withHook('post-checkout', ['echo "checkout: $1 -> $2"'], repo)
    expect(out(checkout, 'git switch main')).toBe("ブランチ 'main' に切り替えました\ncheckout: C1 -> C0")
    const merged = withHook('post-merge', ['echo "マージしました"'], run(['git switch main'], repo))
    expect(out(merged, 'git merge topic')).toBe('Updating C0..C1\nFast-forward\nマージしました')
    const post = withHook('post-commit', ['git log --oneline -1'], repo)
    expect(out(post, 'git commit --allow-empty -m "空"')).toBe('[topic C2] 空\nC2 (HEAD -> topic) 空')
  })
})

describe('&& / || / ; と \\ のエスケープ', () => {
  it('シェルと同じく順に実行し、&& は成功したとき、|| は失敗したときだけ次を実行する', () => {
    const repo = run(['echo "a" > a.txt && git add a.txt && git commit -m "a"'])
    expect(repo.commits[headCommitId(repo)]?.message).toBe('a')
    expect(executeCommand(repo, 'cat nothing.txt || echo "なかった"').output).toBe(
      'cat: nothing.txt: そのようなファイルはありません\nなかった',
    )
    const failed = executeCommand(repo, 'cat nothing.txt && echo "ここは出ない"')
    expect(failed.ok).toBe(false)
    expect(failed.output).not.toContain('ここは出ない')
    expect(out(repo, 'echo "1"; echo "2"')).toBe('1\n2')
  })

  it('ダブルクォートの中の \\" と、引用符の中の && や ;', () => {
    expect(out(run([]), 'echo "a \\"b\\" c"')).toBe('a "b" c')
    expect(out(run([]), 'echo "x && y; z"')).toBe('x && y; z')
  })
})
