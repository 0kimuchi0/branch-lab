import { describe, expect, it } from 'vitest'
import { commitFile, run } from '../test/run'
import { executeCommand } from './commands'
import { headCommitId, type Repo } from './model'
import { applyPatch, parseDiff } from './patch'

const out = (repo: Repo, line: string) => executeCommand(repo, line).output

/** topic で 2 つコミットした Repo (main は C0 のまま)。 */
function topic(): Repo {
  return run([
    'git switch -c topic',
    ...commitFile('a.txt', 'a', 'a を追加'),
    'echo "二行目" >> README.md',
    'git commit -am "README を直す" -m "本文です"',
  ])
}

describe('git format-patch', () => {
  it('コミットを 0001-件名.patch のファイルにする', () => {
    const result = executeCommand(topic(), 'git format-patch main')
    expect(result.output).toBe('0001-a-を追加.patch\n0002-README-を直す.patch')
    const patch = result.repo.workdir['0002-README-を直す.patch'] ?? ''
    expect(patch.split('\n').slice(0, 6)).toEqual([
      'From C2 Mon Sep 17 00:00:00 2001',
      'Subject: [PATCH 2/2] README を直す',
      '',
      '本文です',
      '',
      '---',
    ])
    expect(patch).toContain('diff --git a/README.md b/README.md')
    expect(out(topic(), 'git format-patch -1 --stdout').startsWith('From C2 Mon Sep 17 00:00:00 2001\nSubject: [PATCH] README を直す')).toBe(true)
    expect(out(topic(), 'git format-patch -1 -o patches')).toBe('patches/0001-README-を直す.patch')
  })
})

describe('git apply', () => {
  it('差分を作業ディレクトリに当てる (--index ならステージにも、-R で逆向き)', () => {
    const repo = run(['echo "x" >> README.md', 'git diff > change.patch', 'git restore README.md'])
    expect(repo.workdir['README.md']).toBe('# BranchLab\n')
    const applied = run(['git apply change.patch'], repo)
    expect(applied.workdir['README.md']).toBe('# BranchLab\nx\n')
    expect(applied.index['README.md']).toBe('# BranchLab\n')
    expect(run(['git apply --index change.patch'], repo).index['README.md']).toBe('# BranchLab\nx\n')
    expect(run(['git apply -R change.patch'], applied).workdir['README.md']).toBe('# BranchLab\n')
    const failed = executeCommand(applied, 'git apply change.patch')
    expect(failed.ok).toBe(false)
    expect(failed.output).toBe('error: patch failed: README.md:1\nerror: README.md: patch does not apply')
    expect(executeCommand(repo, 'git apply --check change.patch').repo.workdir['README.md']).toBe('# BranchLab\n')
  })

  it('行がずれていても、文脈が合う場所に当てる', () => {
    const files = parseDiff(['diff --git a/f b/f', '--- a/f', '+++ b/f', '@@ -2,2 +2,3 @@', ' a', '+x', ' b'].join('\n'))
    const result = applyPatch({ f: 'z\nz\nz\na\nb\nc\n' }, files)
    expect(result).toEqual({ tree: { f: 'z\nz\nz\na\nx\nb\nc\n' } })
    // 1 行目からのハンクは、ファイルの先頭でなければ当てない (Git と同じ)
    const head = parseDiff(['diff --git a/f b/f', '--- a/f', '+++ b/f', '@@ -1,2 +1,3 @@', ' a', '+x', ' b'].join('\n'))
    expect('errors' in applyPatch({ f: 'z\na\nb\n' }, head)).toBe(true)
  })
})

describe('git am', () => {
  it('パッチをコミットとして取り込み、元のコミットを由来として持つ', () => {
    const repo = run(['git format-patch main', 'git switch main'], topic())
    const result = executeCommand(repo, 'git am 0001-a-を追加.patch 0002-README-を直す.patch')
    expect(result.output).toBe('Applying: a を追加\nApplying: README を直す')
    const tip = result.repo.commits[headCommitId(result.repo)]
    expect(tip?.message).toBe('README を直す\n\n本文です')
    expect(tip?.source).toBe('C2')
    expect(tip?.tree).toEqual(repo.commits['C2']?.tree)
    expect(result.repo.reflogs['HEAD']?.[0]?.message).toBe('am: README を直す')
  })

  it('--stdout > で 1 つにまとめたファイルからも取り込める', () => {
    const repo = run(['git format-patch main --stdout > all.patch', 'git switch main', 'git am all.patch'], topic())
    expect(Object.keys(repo.commits[headCommitId(repo)]?.tree ?? {}).sort()).toEqual(['README.md', 'a.txt'])
  })

  it('当てられなければ止まり、直して --continue、または --skip / --abort', () => {
    const repo = run(['git format-patch -1', 'git switch main', 'echo "別の変更" > README.md', 'git commit -am "README を変える"'], topic())
    const stopped = executeCommand(repo, 'git am 0001-README-を直す.patch')
    expect(stopped.output.split('\n').slice(0, 4)).toEqual([
      'Applying: README を直す',
      'error: patch failed: README.md:1',
      'error: README.md: patch does not apply',
      'Patch failed at 0001 README を直す',
    ])
    expect(stopped.repo.operation?.type).toBe('am')
    expect(out(stopped.repo, 'git status')).toContain('git am --continue')
    expect(executeCommand(stopped.repo, 'git am --continue').ok).toBe(false)
    const resolved = executeCommand(run(['echo "直した" > README.md', 'git add README.md'], stopped.repo), 'git am --continue')
    expect(resolved.output).toBe('Applying: README を直す')
    expect(resolved.repo.operation).toBeNull()
    expect(resolved.repo.commits[headCommitId(resolved.repo)]?.message).toBe('README を直す\n\n本文です')
    const skipped = run(['git am --skip'], stopped.repo)
    expect(skipped.operation).toBeNull()
    expect(headCommitId(skipped)).toBe(headCommitId(repo))
    expect(run(['git am --abort'], stopped.repo).operation).toBeNull()
  })

  it('-3 なら、元のコミットから 3-way マージで当てる (コンフリクトしたら止まる)', () => {
    const repo = run(['git format-patch -1', 'git switch main', 'echo "別の変更" > README.md', 'git commit -am "README を変える"'], topic())
    const merged = executeCommand(repo, 'git am -3 0001-README-を直す.patch')
    expect(merged.output).toContain('Falling back to patching base and 3-way merge...')
    expect(merged.repo.conflicts.map((conflict) => conflict.path)).toEqual(['README.md'])
    const done = run(['echo "両方" > README.md', 'git add README.md', 'git am --continue'], merged.repo)
    expect(done.operation).toBeNull()
  })
})
