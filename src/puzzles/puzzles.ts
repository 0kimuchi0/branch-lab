/** お題の一覧と、お題から初期状態・目標の Repo を作る関数。 */
import { executeCommand } from '../git/commands'
import { createRepo, headTree, type Repo } from '../git/model'
import { matchesGoal } from './match'

export interface Puzzle {
  readonly id: string
  readonly title: string
  /** 何をすれば正解か。 */
  readonly description: string
  readonly hint: string
  /** 初期状態を作るコマンド。 */
  readonly setup: readonly string[]
  /** 正解の手順。どれか 1 つの結果と同じ履歴になれば正解。最初のものを解答例として表示する。 */
  readonly solutions: ReadonlyArray<readonly string[]>
  readonly checkHead?: boolean
  readonly checkRemote?: boolean
  /** 履歴の比較に加えて満たすべき条件。 */
  readonly check?: (repo: Repo) => boolean
}

/** ファイルに 1 行追記してコミットするコマンド列。 */
function change(file: string, line: string, message: string): string[] {
  return [`echo "${line}" >> ${file}`, `git add ${file}`, `git commit -m "${message}"`]
}

const DIVERGED = [
  'git switch -c feature',
  ...change('login.html', 'ログイン画面', 'ログイン画面を追加'),
  'git switch main',
  ...change('README.md', '使い方を追記', 'README を更新'),
]

export const PUZZLES: readonly Puzzle[] = [
  {
    id: 'first-commit',
    title: 'はじめてのコミット',
    description:
      'index.html を作ってコミットしましょう。ファイルを作る → ステージする → コミットする、の 3 段階です。',
    hint: 'echo "<h1>Hello</h1>" > index.html でファイルを作り、git add index.html でステージ、git commit -m "メッセージ" でコミットします。',
    setup: [],
    solutions: [['echo "<h1>Hello</h1>" > index.html', 'git add index.html', 'git commit -m "index.html を追加"']],
    check: (repo) => 'index.html' in headTree(repo),
  },
  {
    id: 'amend',
    title: '直前のコミットを直す',
    description:
      '直前のコミットで index.html の Hello を Helo と書き間違えました。新しいコミットを増やさずに、直前のコミットを修正しましょう。',
    hint: 'ファイルを直して git add したら、git commit --amend で直前のコミットを作り直せます。',
    setup: change('index.html', '<h1>Helo</h1>', '見出しを追加'),
    solutions: [['echo "<h1>Hello</h1>" > index.html', 'git add index.html', 'git commit --amend -m "見出しを追加"']],
    check: (repo) => headTree(repo)['index.html']?.includes('Hello') ?? false,
  },
  {
    id: 'branch',
    title: 'ブランチを分ける',
    description:
      'feature ブランチを作って 1 つコミットし、main にも 1 つコミットして、履歴を 2 つに分岐させましょう。',
    hint: 'git switch -c feature でブランチを作って移動します。グラフだけ試すなら git commit --allow-empty -m "..." で変更のないコミットも作れます。',
    setup: [],
    solutions: [['git switch -c feature', 'git commit --allow-empty -m "feature の作業"', 'git switch main', 'git commit --allow-empty -m "main の作業"']],
  },
  {
    id: 'merge',
    title: 'マージする',
    description: 'feature ブランチの変更を main に取り込み、マージコミットを作りましょう。',
    hint: 'main にいる状態で git merge --no-edit feature を実行します。',
    setup: DIVERGED,
    solutions: [['git merge --no-edit feature']],
  },
  {
    id: 'conflict',
    title: 'コンフリクトを解消する',
    description:
      'main と feature の両方で README.md の同じ行を書き換えています。feature を main にマージし、コンフリクトを解消してマージを完了させましょう。',
    hint: 'git merge --no-edit feature でコンフリクトしたら、echo "..." > README.md でファイルを書き直し、git add README.md してから git commit します。',
    setup: [
      'git switch -c feature',
      'echo "# BranchLab (feature 版)" > README.md',
      'git commit -am "タイトルを変更 (feature)"',
      'git switch main',
      'echo "# BranchLab (main 版)" > README.md',
      'git commit -am "タイトルを変更 (main)"',
    ],
    solutions: [['git merge --no-edit feature', 'echo "# BranchLab" > README.md', 'git add README.md', 'git commit --no-edit']],
  },
  {
    id: 'rebase',
    title: 'リベースで一直線に',
    description:
      'feature ブランチのコミットを、main の最新コミットの後ろに付け替えて、履歴を一直線にしましょう。main は動かしません。',
    hint: 'feature に移動して git rebase main を実行します。付け替える前のコミットは薄く残ります。',
    setup: DIVERGED,
    solutions: [['git switch feature', 'git rebase main']],
  },
  {
    id: 'cherry-pick',
    title: '必要なコミットだけ取り込む',
    description:
      'feature ブランチの 3 つのコミットのうち「バグを修正」だけを main に取り込みましょう。デバッグ用のコミットは取り込みません。',
    hint: 'main にいる状態で、git cherry-pick <コミット ID> を実行します。ID はグラフで確認できます。',
    setup: [
      'git switch -c feature',
      ...change('debug.txt', 'console.log', 'デバッグ用のログを追加'),
      ...change('app.txt', 'バグを修正', 'バグを修正'),
      ...change('debug.txt', 'console.log 2', 'デバッグ用のログを追加 2'),
      'git switch main',
    ],
    solutions: [['git cherry-pick C2']],
  },
  {
    id: 'reset',
    title: '手元のコミットを取り消す',
    description:
      'まだ push していない最後の 2 つのコミットは間違いでした。main を「機能 A」のコミットまで戻しましょう。',
    hint: 'git reset --hard HEAD~2 でブランチを 2 つ前に戻せます (--soft や --mixed なら変更はファイルに残ります)。',
    setup: [
      ...change('a.txt', '機能 A', '機能 A'),
      ...change('a.txt', '間違い 1', '間違い 1'),
      ...change('a.txt', '間違い 2', '間違い 2'),
    ],
    solutions: [['git reset --hard HEAD~2']],
  },
  {
    id: 'revert',
    title: '公開済みのコミットを打ち消す',
    description:
      '「問題のある変更」はすでに push 済みです。履歴は書き換えずに、その変更を打ち消すコミットを作って push しましょう。',
    hint: 'git revert --no-edit HEAD で直前のコミットを打ち消すコミットを作り、git push で origin に送ります。',
    setup: [...change('a.txt', '機能 A', '機能 A'), ...change('b.txt', '問題のある変更', '問題のある変更'), 'git push'],
    solutions: [['git revert --no-edit HEAD', 'git push']],
    checkRemote: true,
  },
  {
    id: 'pull-push',
    title: '他の人の変更を取り込んで push',
    description:
      '自分がコミットしている間に、他の人が origin/main に push しました。他の人の変更を取り込んでから、自分のコミットを push しましょう (マージでもリベースでも構いません)。',
    hint: 'そのまま git push すると拒否されます。git pull --no-rebase (マージ) か git pull --rebase (リベース) で取り込んでから git push します。',
    setup: ['teammate', ...change('app.txt', '自分の変更', '自分の変更')],
    solutions: [
      ['git pull --no-rebase --no-edit', 'git push'],
      ['git pull --rebase', 'git push'],
    ],
    checkRemote: true,
  },
]

function runAll(repo: Repo, lines: readonly string[]): Repo {
  return lines.reduce((current, line) => {
    const result = executeCommand(current, line)
    if (!result.ok) throw new Error(`お題のコマンド "${line}" が失敗しました:\n${result.output}`)
    return result.repo
  }, repo)
}

export interface BuiltPuzzle {
  readonly puzzle: Puzzle
  readonly start: Repo
  readonly goals: readonly Repo[]
}

export function buildPuzzle(puzzle: Puzzle): BuiltPuzzle {
  const start = runAll(createRepo(), puzzle.setup)
  return {
    puzzle,
    start,
    goals: puzzle.solutions.map((solution) => runAll(start, solution)),
  }
}

export function isSolved(built: BuiltPuzzle, repo: Repo): boolean {
  const { puzzle } = built
  if (puzzle.check && !puzzle.check(repo)) return false
  return built.goals.some((goal) =>
    matchesGoal(repo, goal, {
      setupNextId: built.start.nextId,
      checkHead: puzzle.checkHead ?? false,
      checkRemote: puzzle.checkRemote ?? false,
    }),
  )
}
