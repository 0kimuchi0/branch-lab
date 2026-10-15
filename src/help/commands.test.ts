import { describe, expect, it } from 'vitest'
import { executeCommand } from '../git/commands'
import { createRepo } from '../git/model'
import { commitFile, run } from '../test/run'
import { COMMAND_HELP, findHelp, formatHelp } from './commands'

/** ターミナルで実行できるコマンド (シェルのコマンドと git のコマンド)。 */
const SHELL = ['echo', 'cat', 'ls', 'touch', 'rm', 'mv', 'mkdir', 'grep', 'sed', 'chmod', 'cd', 'pwd', 'help', 'teammate']
const GIT = [
  'status', 'log', 'show', 'diff', 'blame', 'reflog', 'notes', 'cherry', 'range-diff', 'add', 'commit', 'rm', 'restore',
  'branch', 'switch', 'checkout', 'merge', 'rebase', 'cherry-pick', 'tag', 'reset', 'revert', 'filter-branch', 'replace',
  'clone', 'remote', 'push', 'fetch', 'pull', 'stash', 'bisect', 'worktree', 'submodule', 'sparse-checkout', 'format-patch',
  'am', 'apply', 'bundle', 'config', 'rerere', 'gc', 'prune', 'fsck', 'update-ref', 'for-each-ref', 'show-ref',
  'clean', 'mv', 'grep', 'describe', 'shortlog', 'check-ignore',
]

describe('コマンドのヘルプ', () => {
  it('すべてのコマンドにヘルプがある', () => {
    for (const name of SHELL) expect(findHelp(name)?.git, name).toBe(false)
    for (const name of GIT) expect(findHelp(`git ${name}`)?.git, name).toBe(true)
    expect(findHelp('git rm')?.name).toBe('git-rm')
    expect(findHelp('rm')?.name).toBe('rm')
    expect(findHelp('git mv')?.name).toBe('git-mv')
    expect(findHelp('git grep')?.name).toBe('git-grep')
    expect(findHelp('grep')?.name).toBe('grep')
  })

  it('関連のコマンドはすべてある', () => {
    for (const entry of COMMAND_HELP) {
      for (const name of entry.related ?? []) expect(COMMAND_HELP.some((other) => other.name === name), `${entry.name} → ${name}`).toBe(true)
    }
  })

  it('help <コマンド>・git help <コマンド>・<コマンド> -h で同じ説明を表示する', () => {
    const text = formatHelp(findHelp('commit') as (typeof COMMAND_HELP)[number])
    expect(text.split('\n')[0]).toBe('git commit — ステージの内容を記録する')
    for (const command of ['help commit', 'git help commit', 'git commit -h', 'commit --help', 'help git commit']) {
      expect(executeCommand(createRepo(), command).output, command).toBe(text)
    }
    expect(executeCommand(createRepo(), 'git rm -h').output).toContain('git rm — ')
    expect(executeCommand(createRepo(), 'rm -h').output).toContain('rm — 作業ディレクトリから')
    const unknown = executeCommand(createRepo(), 'help nothing')
    expect(unknown.ok).toBe(false)
    expect(unknown.output).toContain("'nothing' のヘルプはありません")
  })

  it('例のコマンドは、このアプリで使えるオプションだけを使っている', () => {
    const base = run([
      ...commitFile('index.html', 'Hello', 'トップページを追加'),
      'git switch -c feature',
      ...commitFile('contact.html', 'お問い合わせ', 'お問い合わせ'),
      'git switch main',
      ...commitFile('README.md', 'Hello', 'README'),
    ])
    for (const entry of COMMAND_HELP) {
      for (const [command] of entry.examples) {
        const result = executeCommand(base, command)
        expect(result.output, `${entry.name}: ${command}`).not.toMatch(/未対応のオプション|は git のコマンドではありません|^使い方|^usage|には値が必要です/)
      }
    }
  })
})
