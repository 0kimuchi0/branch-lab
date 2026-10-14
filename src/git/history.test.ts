import { describe, expect, it } from 'vitest'
import { commitFile, run } from '../test/run'
import { executeCommand } from './commands'
import { currentBranch, headCommitId, reachableCommits, workspaceStatus, type Repo } from './model'

/** feature (C1: f.txt) と main (C2: m.txt) に分岐した Repo。 */
function diverged(): Repo {
  return run(['git switch -c feature', ...commitFile('f.txt', 'f'), 'git switch main', ...commitFile('m.txt', 'm')])
}

/** README.md の同じ行を feature (C1) と main (C2) で別々に変えた Repo。 */
function conflicting(): Repo {
  return run([
    'git switch -c feature',
    'echo "feature" > README.md',
    'git commit -am "feature 側"',
    'git switch main',
    'echo "main" > README.md',
    'git commit -am "main 側"',
  ])
}

function fail(repo: Repo, line: string): string {
  const result = executeCommand(repo, line)
  expect(result.ok, result.output).toBe(false)
  expect(result.repo).toBe(repo)
  return result.output
}

describe('merge', () => {
  it('fast-forward できる場合はブランチを進めるだけでコミットを作らない', () => {
    const repo = run(['git switch -c feature', ...commitFile('f.txt', 'f'), 'git switch main', 'git merge --no-edit feature'])
    expect(repo.branches['main']).toBe('C1')
    expect(Object.keys(repo.commits)).toHaveLength(2)
    expect(repo.workdir['f.txt']).toBe('f\n')
  })

  it('--no-ff なら fast-forward できてもマージコミットを作る', () => {
    const repo = run(['git switch -c feature', ...commitFile('f.txt', 'f'), 'git switch main', 'git merge --no-edit --no-ff feature'])
    expect(repo.commits['C2']?.parents).toEqual(['C0', 'C1'])
  })

  it('分岐している場合は両方の変更を含むマージコミットを作る', () => {
    const repo = run(['git merge --no-edit feature'], diverged())
    const mergeCommit = repo.commits['C3']
    expect(mergeCommit?.parents).toEqual(['C2', 'C1'])
    expect(mergeCommit?.message).toBe("Merge branch 'feature'")
    expect(repo.workdir).toMatchObject({ 'f.txt': 'f\n', 'm.txt': 'm\n' })
  })

  it('main 以外へのマージはメッセージに into が付く', () => {
    const repo = run(['git switch feature', 'git merge --no-edit main'], diverged())
    expect(repo.commits['C3']?.message).toBe("Merge branch 'main' into feature")
  })

  it('同じファイルでも別の行の変更は自動でマージできる', () => {
    const repo = run([
      'echo "1" > n.txt', 'echo "2" >> n.txt', 'echo "3" >> n.txt', 'git add .', 'git commit -m base',
      'git switch -c feature', 'echo "1!" > n.txt', 'echo "2" >> n.txt', 'echo "3" >> n.txt', 'git commit -am f',
      'git switch main', 'echo "1" > n.txt', 'echo "2" >> n.txt', 'echo "3!" >> n.txt', 'git commit -am m',
      'git merge --no-edit feature',
    ])
    expect(repo.workdir['n.txt']).toBe('1!\n2\n3!\n')
    expect(repo.operation).toBeNull()
  })

  it('すでに取り込み済みなら何も変更しない', () => {
    const repo = run(['git switch -c feature', 'git commit --allow-empty -m x'])
    const result = executeCommand(repo, 'git merge --no-edit main')
    expect(result.repo).toBe(repo)
    expect(result.output).toBe('Already up to date.')
  })

  it('コンフリクトしたら止まり、解消して commit すると完了する', () => {
    const result = executeCommand(conflicting(), 'git merge --no-edit feature')
    expect(result.ok).toBe(true)
    expect(result.output).toContain('CONFLICT (content): README.md')
    const stopped = result.repo
    expect(stopped.operation?.type).toBe('merge')
    expect(stopped.workdir['README.md']).toBe(
      '<<<<<<< HEAD\nmain\n=======\nfeature\n>>>>>>> feature\n',
    )
    expect(fail(stopped, 'git commit')).toContain('マージされていないファイル')

    const done = run(['echo "both" > README.md', 'git add README.md', 'git commit --no-edit'], stopped)
    expect(done.operation).toBeNull()
    expect(done.commits['C3']).toMatchObject({ parents: ['C2', 'C1'], message: "Merge branch 'feature'" })
    expect(done.commits['C3']?.tree['README.md']).toBe('both\n')
  })

  it('merge --abort でマージ前の状態に戻る', () => {
    const before = conflicting()
    const repo = run(['git merge --no-edit feature', 'git merge --abort'], before)
    expect(repo.operation).toBeNull()
    expect(repo.workdir).toEqual(before.workdir)
    expect(repo.branches).toEqual(before.branches)
  })

  it('マージ中は他の操作をできない', () => {
    const stopped = run(['git merge --no-edit feature'], conflicting())
    expect(fail(stopped, 'git switch feature')).toContain('merge の途中です')
  })

  it('マージで上書きされる変更があると中止する', () => {
    const repo = run(['echo "x" > f.txt'], diverged())
    expect(fail(repo, 'git merge --no-edit feature')).toContain('追跡されていないファイル')
  })
})

describe('cherry-pick', () => {
  it('指定したコミットの変更だけを、新しいコミットとして複製する', () => {
    const repo = run(['git switch -c feature', ...commitFile('a.txt', 'a'), ...commitFile('b.txt', 'b'), 'git switch main', 'git cherry-pick C2'])
    expect(repo.commits['C3']).toMatchObject({ parents: ['C0'], message: 'b', source: 'C2' })
    expect(repo.workdir).toEqual({ 'README.md': '# BranchLab\n', 'b.txt': 'b\n' })
  })

  it('複数のコミットを順に複製し、コピーのコピーは最初のコミットを指す', () => {
    const repo = run(['git switch -c feature', ...commitFile('a.txt', 'a'), ...commitFile('b.txt', 'b'), 'git switch main', 'git cherry-pick C1 C2', 'git switch -c other C0', 'git cherry-pick C3'])
    expect(repo.commits['C4']?.parents).toEqual(['C3'])
    expect(repo.commits['C5']?.source).toBe('C1')
  })

  it('コンフリクトしたら止まり、--continue で続ける', () => {
    const stopped = executeCommand(conflicting(), 'git cherry-pick C1')
    expect(stopped.output).toContain('git cherry-pick --continue')
    expect(stopped.repo.operation).toMatchObject({ type: 'cherry-pick', current: { action: 'pick', id: 'C1' } })
    const done = run(['echo "both" > README.md', 'git add .', 'git cherry-pick --continue', ':wq'], stopped.repo)
    expect(done.operation).toBeNull()
    expect(done.commits['C3']).toMatchObject({ parents: ['C2'], message: 'feature 側', source: 'C1' })
  })

  it('--abort で開始前に戻り、--skip で飛ばせる', () => {
    const stopped = run(['git cherry-pick C1'], conflicting())
    const aborted = run(['git cherry-pick --abort'], stopped)
    expect(aborted.operation).toBeNull()
    expect(aborted.workdir['README.md']).toBe('main\n')
    const skipped = run(['git cherry-pick --skip'], stopped)
    expect(skipped.operation).toBeNull()
    expect(headCommitId(skipped)).toBe('C2')
  })

  it('変更がすでに含まれていれば空になるので止まる', () => {
    const repo = run(['git merge --no-edit feature'], diverged())
    const result = executeCommand(repo, 'git cherry-pick C1')
    expect(result.output).toContain('空になります')
    expect(result.repo.operation?.type).toBe('cherry-pick')
  })

  it('もともと空のコミットは --allow-empty のときだけ複製する', () => {
    const repo = run(['git switch -c feature', 'git commit --allow-empty -m e', 'git switch main'])
    expect(executeCommand(repo, 'git cherry-pick C1').repo.operation?.type).toBe('cherry-pick')
    expect(run(['git cherry-pick --allow-empty C1'], repo).commits['C2']?.source).toBe('C1')
  })

  it('マージコミットは cherry-pick できない', () => {
    const repo = run(['git merge --no-edit feature', 'git switch -c other C0'], diverged())
    expect(fail(repo, 'git cherry-pick C3')).toContain('マージコミット')
  })
})

describe('revert', () => {
  it('指定したコミットの変更を打ち消すコミットを作る', () => {
    const repo = run([...commitFile('a.txt', 'a'), ...commitFile('b.txt', 'b'), 'git revert --no-edit C1'])
    expect(repo.commits['C3']).toMatchObject({
      parents: ['C2'],
      message: 'Revert "a"\n\nThis reverts commit C1.',
      reverts: 'C1',
    })
    expect(repo.workdir).toEqual({ 'README.md': '# BranchLab\n', 'b.txt': 'b\n' })
  })

  it('後のコミットが同じ箇所を変えていればコンフリクトする', () => {
    const repo = run([...commitFile('a.txt', 'a'), ...commitFile('a.txt', 'b')])
    const result = executeCommand(repo, 'git revert --no-edit C1')
    expect(result.output).toContain('CONFLICT')
    expect(result.repo.operation?.type).toBe('revert')
  })
})

describe('マージコミットの cherry-pick / revert (-m)', () => {
  /** feature (C1: f.txt) を main (C2: m.txt) にマージした C3 を持つ Repo。 */
  const merged = () => run(['git merge --no-edit feature'], diverged())

  it('-m 1 は 1 番目の親 (main 側) からの変更、つまり feature で入った変更を複製する', () => {
    const repo = run(['git switch -c other C0', 'git cherry-pick -m 1 C3'], merged())
    expect(repo.commits['C4']).toMatchObject({ parents: ['C0'], message: "Merge branch 'feature'", source: 'C3' })
    expect(repo.workdir).toEqual({ 'README.md': '# BranchLab\n', 'f.txt': 'f\n' })
  })

  it('-m 2 は 2 番目の親 (feature 側) からの変更を複製する', () => {
    const repo = run(['git switch -c other C0', 'git cherry-pick -m 2 C3'], merged())
    expect(repo.workdir).toEqual({ 'README.md': '# BranchLab\n', 'm.txt': 'm\n' })
  })

  it('revert -m 1 はマージで取り込んだ変更を打ち消し、メッセージに基準の親を書く', () => {
    const repo = run(['git revert --no-edit -m 1 C3'], merged())
    expect(repo.commits['C4']).toMatchObject({
      parents: ['C3'],
      reverts: 'C3',
      message: "Revert \"Merge branch 'feature'\"\n\nThis reverts commit C3, reversing\nchanges made to C2.",
    })
    expect(repo.workdir['f.txt']).toBeUndefined()
    expect(repo.workdir['m.txt']).toBe('m\n')
  })

  it('-m なしのマージコミット、存在しない親の番号はエラーになる', () => {
    const repo = merged()
    expect(fail(repo, 'git revert --no-edit C3')).toContain('-m オプションが指定されていません')
    expect(fail(repo, 'git revert --no-edit -m 3 C3')).toContain('3 番目の親がありません')
    expect(fail(repo, 'git revert --no-edit -m x C3')).toContain('親の番号')
  })

  it('マージでないコミットにも -m 1 は指定できる', () => {
    const repo = run(['git switch -c other C0', 'git cherry-pick -m 1 C1'], diverged())
    expect(repo.commits['C3']?.source).toBe('C1')
  })
})

describe('rebase', () => {
  it('現在のブランチのコミットを upstream の先に付け替える', () => {
    const repo = run(['git switch feature', 'git rebase main'], diverged())
    expect(currentBranch(repo)).toBe('feature')
    expect(repo.branches['feature']).toBe('C3')
    expect(repo.commits['C3']).toMatchObject({ parents: ['C2'], message: 'f', source: 'C1' })
    expect(repo.workdir).toMatchObject({ 'f.txt': 'f\n', 'm.txt': 'm\n' })
    expect(reachableCommits(repo).has('C1')).toBe(false)
  })

  it('複数のコミットを古い順に付け替える', () => {
    const repo = run(['git switch -c feature', ...commitFile('a.txt', 'a'), ...commitFile('b.txt', 'b'), 'git switch main', ...commitFile('m.txt', 'm'), 'git switch feature', 'git rebase main'])
    expect(repo.commits['C4']).toMatchObject({ parents: ['C3'], source: 'C1' })
    expect(repo.commits['C5']).toMatchObject({ parents: ['C4'], source: 'C2' })
  })

  it('upstream に含まれていれば何もせず、祖先なら fast-forward する', () => {
    const repo = diverged()
    expect(executeCommand(repo, 'git rebase C0').output).toContain('is up to date')
    const ff = run(['git switch -c behind C0', 'git rebase main'], repo)
    expect(ff.branches['behind']).toBe('C2')
  })

  it('もともと空のコミットは残す', () => {
    const repo = run(['git switch -c feature', 'git commit --allow-empty -m e', 'git switch main', ...commitFile('m.txt', 'm'), 'git switch feature', 'git rebase main'])
    expect(repo.commits['C3']).toMatchObject({ parents: ['C2'], message: 'e', source: 'C1' })
  })

  it('すでに取り込まれている変更は取り除く', () => {
    const repo = run(['git cherry-pick C1', 'git switch feature', 'git rebase main'], diverged())
    expect(repo.branches['feature']).toBe('C3')
  })

  it('コンフリクトしたら HEAD を切り離したまま止まり、--continue で完了する', () => {
    const stopped = run(['git switch feature', 'git rebase main'], conflicting())
    expect(stopped.head).toEqual({ type: 'detached', id: 'C2' })
    expect(stopped.branches['feature']).toBe('C1')
    expect(workspaceStatus(stopped).conflicts).toEqual([{ path: 'README.md', kind: 'both-modified' }])

    const done = run(['echo "both" > README.md', 'git add README.md', 'git rebase --continue', ':wq'], stopped)
    expect(done.head).toEqual({ type: 'branch', name: 'feature' })
    expect(done.branches['feature']).toBe('C3')
    expect(done.commits['C3']).toMatchObject({ parents: ['C2'], message: 'feature 側' })
  })

  it('--abort で元のブランチと内容に戻る', () => {
    const repo = run(['git switch feature', 'git rebase main', 'git rebase --abort'], conflicting())
    expect(repo.head).toEqual({ type: 'branch', name: 'feature' })
    expect(repo.branches['feature']).toBe('C1')
    expect(repo.workdir['README.md']).toBe('feature\n')
  })

  it('コミットしていない変更があると rebase できない', () => {
    const repo = run(['git switch feature', 'echo "x" >> f.txt'], diverged())
    expect(fail(repo, 'git rebase main')).toContain('コミットしていない変更')
  })
})

describe('rebase --rebase-merges', () => {
  /** topic に feature をマージした履歴 (C1 a → C2 f [feature] / C3 b → C4 マージ) と、main の C5。 */
  function withMerge(): Repo {
    return run([
      'git switch -c topic',
      ...commitFile('a.txt', 'a'),
      'git switch -c feature',
      ...commitFile('f.txt', 'f'),
      'git switch topic',
      ...commitFile('b.txt', 'b'),
      'git merge --no-edit feature',
      'git switch main',
      ...commitFile('m.txt', 'm'),
      'git switch topic',
    ])
  }

  it('-i の todo は、横のブランチを先に作って label を付け、merge で合流する', () => {
    const opened = executeCommand(withMerge(), 'git rebase -i -r main')
    const text = opened.repo.editor?.text ?? ''
    expect(text.split('\n# C5..')[0]).toBe(
      [
        'label onto',
        '',
        '# Branch: feature',
        'reset onto',
        'pick C1 a',
        'label branch-point',
        'pick C2 f',
        'label feature',
        '',
        'reset branch-point # a',
        'pick C3 b',
        "merge -C C4 feature # Merge branch 'feature' into topic",
        '',
      ].join('\n'),
    )
  })

  it('マージコミットも作り直し、ブランチの形を保つ', () => {
    const repo = run(['git rebase -r main'], withMerge())
    const tip = repo.commits[repo.branches['topic'] as string]
    expect(tip?.parents).toHaveLength(2)
    expect(tip?.message).toBe("Merge branch 'feature' into topic")
    expect(tip?.source).toBe('C4')
    expect(Object.keys(tip?.tree ?? {}).sort()).toEqual(['README.md', 'a.txt', 'b.txt', 'f.txt', 'm.txt'])
    const [first, second] = tip?.parents ?? []
    expect(repo.commits[first as string]?.source).toBe('C3')
    expect(repo.commits[second as string]?.source).toBe('C2')
    // 2 つの親は、作り直した a (C1 の複製) から分かれている
    const a = repo.commits[first as string]?.parents[0]
    expect(repo.commits[a as string]?.source).toBe('C1')
    expect(repo.commits[second as string]?.parents[0]).toBe(a)
    expect(repo.commits[a as string]?.parents[0]).toBe('C5')
    expect(repo.operation).toBeNull()
    expect(currentBranch(repo)).toBe('topic')
  })

  it('-r がなければ、マージコミットは取り除いて一直線にする', () => {
    const repo = run(['git rebase main'], withMerge())
    const tip = repo.commits[repo.branches['topic'] as string]
    expect(tip?.parents).toHaveLength(1)
  })

  it('親が変わらないコミットとマージは、作り直さずにそのまま使う', () => {
    const before = withMerge()
    const repo = run(['git rebase -i -r C0', ':wq'], before)
    expect(repo.branches['topic']).toBe('C4')
    expect(repo.nextId).toBe(before.nextId)
  })

  it('マージでコンフリクトしたら止まり、解消して --continue でマージコミットを作る', () => {
    const repo = run([
      'git switch -c topic',
      'git switch -c feature',
      'echo "feature" > README.md',
      'git commit -am "feature 側"',
      'git switch topic',
      'echo "topic" > README.md',
      'git commit -am "topic 側"',
    ])
    const merged = executeCommand(repo, 'git merge --no-edit feature')
    expect(merged.ok).toBe(true)
    const resolved = run(['echo "both" > README.md', 'git commit -am "マージ" ', 'git switch main', ...commitFile('m.txt', 'm'), 'git switch topic'], merged.repo)
    const stopped = executeCommand(resolved, 'git rebase -r main')
    expect(stopped.output).toContain('error: feature をマージできませんでした')
    expect(stopped.repo.operation?.type).toBe('rebase')
    expect(executeCommand(stopped.repo, 'git status').output).toContain('merge feature を適用中')
    const done = run(['echo "both" > README.md', 'git add README.md', 'git rebase --continue', ':wq'], stopped.repo)
    const tip = done.commits[done.branches['topic'] as string]
    expect(tip?.parents).toHaveLength(2)
    expect(tip?.message).toBe('マージ')
    expect(tip?.tree['README.md']).toBe('both\n')
    expect(done.operation).toBeNull()
  })

  it('todo の label / reset / merge を書き換えられる (名前は先に label で付ける)', () => {
    const repo = run([
      'git switch -c topic',
      ...commitFile('a.txt', 'a'),
      'git switch main',
      ...commitFile('m.txt', 'm'),
      'git switch topic',
    ])
    const opened = executeCommand(repo, 'git rebase -i -r main')
    const bad = executeCommand(opened.repo, `:wq ${JSON.stringify('reset nowhere\npick C1 a\n')}`)
    expect(bad.ok).toBe(false)
    expect(bad.output).toContain("'nowhere' が見つかりません")
    // a を作ったあと onto に戻り、a をマージする形に組み替える
    const todo = 'label onto\npick C1 a\nlabel side\nreset onto\nmerge side # side をマージ\n'
    const editing = executeCommand(opened.repo, `:wq ${JSON.stringify(todo)}`)
    expect(editing.repo.editor?.file).toBe('MERGE_MSG')
    const done = run([':wq'], editing.repo)
    const tip = done.commits[done.branches['topic'] as string]
    expect(tip?.message).toBe("Merge branch 'side'")
    expect(tip?.parents[0]).toBe('C2')
    expect(Object.keys(tip?.tree ?? {}).sort()).toEqual(['README.md', 'a.txt', 'm.txt'])
  })
})
