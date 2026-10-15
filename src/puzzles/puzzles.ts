/** お題の一覧と、お題から初期状態・目標の Repo を作る関数。 */
import { editorSaveCommand, executeCommand } from '../git/commands'
import { MAIN_WORKTREE, createRepo, headTree, type Repo } from '../git/model'
import { parseGitlink } from '../git/tree'
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
    hint: 'ファイルを直して git add したら、git commit --amend で直前のコミットを作り直せます。メッセージを書くエディタが開くので、そのまま保存して閉じます (--no-edit を付けると開きません)。',
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
    hint: 'main にいる状態で git merge feature を実行します。マージコミットのメッセージを書くエディタが開くので、そのまま「保存して閉じる」を押せば完了です (--no-edit を付けるとエディタを開きません)。',
    setup: DIVERGED,
    solutions: [['git merge --no-edit feature']],
  },
  {
    id: 'conflict',
    title: 'コンフリクトを解消する',
    description:
      'main と feature の両方で README.md の同じ行を書き換えています。feature を main にマージし、コンフリクトを解消してマージを完了させましょう。',
    hint: 'git merge feature でコンフリクトしたら、echo "..." > README.md でファイルを書き直し、git add README.md してから git commit します。エディタにマージのメッセージが入っているので、そのまま保存して閉じます。',
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
    hint: 'git revert HEAD で直前のコミットを打ち消すコミットを作り (エディタが開いたら保存して閉じます)、git push で origin に送ります。',
    setup: [...change('a.txt', '機能 A', '機能 A'), ...change('b.txt', '問題のある変更', '問題のある変更'), 'git push'],
    solutions: [['git revert --no-edit HEAD', 'git push']],
    checkRemote: true,
  },
  {
    id: 'pull-push',
    title: '他の人の変更を取り込んで push',
    description:
      '自分がコミットしている間に、他の人が origin/main に push しました。他の人の変更を取り込んでから、自分のコミットを push しましょう (マージでもリベースでも構いません)。',
    hint: 'そのまま git push すると拒否されます。git pull --no-rebase (マージ) か git pull --rebase (リベース) で取り込んでから git push します。マージのときはエディタが開くので、保存して閉じます。',
    setup: ['teammate', ...change('app.txt', '自分の変更', '自分の変更')],
    solutions: [
      ['git pull --no-rebase --no-edit', 'git push'],
      ['git pull --rebase', 'git push'],
    ],
    checkRemote: true,
  },
  {
    id: 'squash',
    title: 'コミットをまとめる',
    description:
      '小さな修正のコミットが 3 つに分かれてしまいました。push する前に、git rebase -i で 1 つのコミットにまとめましょう。',
    hint: 'git rebase -i HEAD~3 で todo のエディタが開きます。2 行目と 3 行目の pick を fixup (または squash) に書き換えて保存します。',
    setup: [
      ...change('app.txt', '機能', '機能を追加'),
      ...change('app.txt', 'typo を修正', 'typo を修正'),
      ...change('app.txt', 'さらに修正', 'さらに修正'),
    ],
    solutions: [['git rebase -i HEAD~3', editorSaveCommand('pick C1\nfixup C2\nfixup C3\n')]],
    check: (repo) => headTree(repo)['app.txt']?.includes('さらに修正') ?? false,
  },
  {
    id: 'stash',
    title: '作業を退避して急ぎの修正',
    description:
      'README.md を書きかけのところで、急ぎの修正を頼まれました。書きかけの変更は含めずに fix.txt を追加するコミットを作り、そのあと書きかけの作業を作業ディレクトリに戻しましょう。',
    hint: 'git stash で書きかけの変更を退避し、修正をコミットしてから git stash pop で戻します。',
    setup: ['echo "書きかけの説明" >> README.md'],
    solutions: [
      ['git stash', 'echo "fix" > fix.txt', 'git add fix.txt', 'git commit -m "急ぎの修正"', 'git stash pop'],
    ],
    check: (repo) => {
      const head = headTree(repo)
      return (
        'fix.txt' in head &&
        !(head['README.md'] ?? '').includes('書きかけ') &&
        (repo.workdir['README.md'] ?? '').includes('書きかけ') &&
        repo.stash.length === 0
      )
    },
  },
  {
    id: 'tag',
    title: 'リリースにタグを付ける',
    description:
      '「機能 B」まで入れたものを v1.0 としてリリースしました。そのコミットに v1.0 というタグを付けて、origin にも push しましょう。',
    hint: 'git tag v1.0 <コミット ID> でタグを付け (-m "..." を付けると注釈付きタグになります)、git push origin v1.0 でタグを送ります。',
    setup: [
      ...change('app.txt', '機能 A', '機能 A'),
      ...change('app.txt', '機能 B', '機能 B'),
      ...change('app.txt', '機能 C', '機能 C'),
      'git push',
    ],
    solutions: [['git tag v1.0 C2', 'git push origin v1.0']],
    check: (repo) => repo.tags['v1.0']?.target === 'C2' && repo.remotes.origin?.tags['v1.0']?.target === 'C2',
  },
  {
    id: 'reflog',
    title: '消えたコミットを取り戻す',
    description:
      'git reset --hard HEAD~2 で、まだ必要だったコミットを 2 つ消してしまいました。reflog を見て、main をリセットする前の状態に戻しましょう。',
    hint: 'git reflog で HEAD の動きを確認します。リセットする前の位置は HEAD@{1} なので、git reset --hard HEAD@{1} で戻せます。',
    setup: [
      ...change('app.txt', '1', '作業 1'),
      ...change('app.txt', '2', '作業 2'),
      ...change('app.txt', '3', '作業 3'),
      'git reset --hard HEAD~2',
    ],
    solutions: [['git reset --hard HEAD@{1}']],
  },
  {
    id: 'bisect',
    title: 'バグを入れたコミットを探す',
    description:
      'app.txt に「バグ」という行が紛れ込んでいます。C1 の時点では問題ありませんでした。git bisect で原因のコミットを探し、そのコミットに bug というタグを付けて、bisect を終わらせましょう。',
    hint: 'git bisect start main C1 で始めると、真ん中のコミットに移動します。cat app.txt で「バグ」があれば git bisect bad、なければ git bisect good と答えていくと、原因のコミットがわかります。git tag bug <コミット> でタグを付けてから、git bisect reset で main に戻ります。',
    setup: Array.from({ length: 8 }, (_, i) => [
      `echo "機能 ${i + 1}" >> app.txt`,
      ...(i === 4 ? ['echo "バグ" >> app.txt'] : []),
      'git add app.txt',
      `git commit -m "機能 ${i + 1}"`,
    ]).flat(),
    solutions: [
      [
        'git bisect start main C1',
        'git bisect good',
        'git bisect bad',
        'git bisect bad',
        'git tag bug C5',
        'git bisect reset',
      ],
    ],
    checkHead: true,
    check: (repo) => repo.tags['bug']?.target === 'C5' && repo.bisect === null,
  },
  {
    id: 'rebase-merges',
    title: 'マージの形を保ったまま rebase する',
    description:
      'topic ブランチには、途中で feature をマージした履歴があります。このマージの形を崩さずに、topic を main の最新の上に付け替えましょう。',
    hint: 'ふつうの git rebase main はマージコミットを取り除いて一直線にしてしまいます。git rebase --rebase-merges main (-r) なら、マージも作り直してブランチの形を保ちます。',
    setup: [
      'git switch -c topic',
      ...change('topic.txt', 'topic 1', 'topic の作業 1'),
      'git switch -c feature',
      ...change('feature.txt', 'feature', 'feature の作業'),
      'git switch topic',
      ...change('topic.txt', 'topic 2', 'topic の作業 2'),
      'git merge --no-edit feature',
      'git branch -d feature',
      'git switch main',
      ...change('README.md', '更新', 'README を更新'),
      'git switch topic',
    ],
    solutions: [['git rebase -r main']],
  },
  {
    id: 'remotes',
    title: 'フォーク元の更新を取り込む',
    description:
      'あなたの origin は、元のプロジェクトをフォークしたものです。元のプロジェクトは upstream という名前でリモートに登録してあります (git remote -v で確認できます)。upstream に入った新しいコミットを main に取り込み、自分の origin にも push しましょう。',
    hint: 'git fetch upstream で upstream の新しいコミットを取得し、git merge upstream/main (または git pull upstream main) で取り込みます。最後に git push で origin に送ります。',
    setup: [
      ...change('app.txt', 'はじめの機能', 'はじめの機能'),
      'git push',
      'git remote add upstream https://example.com/original.git',
      'git push upstream main',
      'teammate upstream',
      'teammate upstream',
    ],
    solutions: [
      [
        'git fetch upstream',
        'git merge upstream/main',
        'git push',
      ],
    ],
    checkRemote: true,
  },
  {
    id: 'octopus',
    title: '3 つのブランチをまとめてマージ',
    description:
      'docs・test・lint の 3 つのブランチに、それぞれ別の作業があります。マージコミットを 3 回作るのではなく、1 つのマージコミットで main にまとめて取り込みましょう。',
    hint: 'git merge にブランチを複数並べると、octopus (タコ足) マージで 1 つのマージコミットにまとめます。git merge --no-edit docs test lint',
    setup: [
      'git switch -c docs',
      ...change('docs.md', '使い方', 'ドキュメントを追加'),
      'git switch -c test main',
      ...change('test.txt', 'テスト', 'テストを追加'),
      'git switch -c lint main',
      ...change('lint.txt', 'ルール', 'lint の設定を追加'),
      'git switch main',
      ...change('README.md', '更新', 'README を更新'),
    ],
    solutions: [['git merge --no-edit docs test lint']],
  },
  {
    id: 'rerere',
    title: '同じコンフリクトを二度解かない',
    description:
      'feature を main にマージするとコンフリクトします。rerere を有効にしてからマージし、README.md を「両方の変更」に直してコミットしましょう。解決が記録されるので、同じコンフリクトが起きても次からは自動で直ります。',
    hint: 'git config rerere.enabled true で有効にします。git merge feature でコンフリクトしたら echo "両方の変更" > README.md で直し、git add README.md して git commit します (エディタはそのまま保存して閉じます)。',
    setup: [
      'git switch -c feature',
      'echo "feature の変更" > README.md',
      'git commit -am "feature 側の変更"',
      'git switch main',
      'echo "main の変更" > README.md',
      'git commit -am "main 側の変更"',
    ],
    solutions: [
      [
        'git config rerere.enabled true',
        'git merge feature',
        'echo "両方の変更" > README.md',
        'git add README.md',
        'git commit --no-edit',
      ],
    ],
    check: (repo) => Object.values(repo.rerere.resolved).some((content) => content.includes('両方の変更')),
  },
  {
    id: 'worktree',
    title: '作業を止めずに急ぎの修正',
    description:
      'feature ブランチで作業している途中 (まだコミットしていない変更があります) に、main に急ぎの修正が必要になりました。stash を使わずに、git worktree で main 用の作業場所を別に作り、そこで fix.txt を追加してコミットしましょう。feature の作業中の変更はそのまま残します。',
    hint: 'git worktree add ../hotfix main で main をチェックアウトした worktree を作り、cd ../hotfix で移ります。そこで fix.txt を作ってコミットしたら、cd ../branch-lab で戻ります。',
    setup: [
      'git switch -c feature',
      ...change('feature.txt', '機能の途中まで', '機能を作り始める'),
      'echo "作業中の変更" >> feature.txt',
    ],
    solutions: [
      [
        'git worktree add ../hotfix main',
        'cd ../hotfix',
        'echo "修正" > fix.txt',
        'git add fix.txt',
        'git commit -m "急ぎの修正"',
        'cd ../branch-lab',
      ],
    ],
    check: (repo) => {
      const state = repo.worktree === MAIN_WORKTREE ? repo : repo.worktrees[MAIN_WORKTREE]
      const main = repo.branches['main']
      return (
        // stash ではなく worktree を使って解く
        Object.keys(repo.worktrees).length + Number(repo.worktree !== MAIN_WORKTREE) > 0 &&
        state !== undefined &&
        state.head.type === 'branch' &&
        state.head.name === 'feature' &&
        (state.workdir['feature.txt'] ?? '').includes('作業中の変更') &&
        main !== undefined &&
        'fix.txt' in (repo.commits[main]?.tree ?? {})
      )
    },
  },
  {
    id: 'submodule',
    title: 'サブモジュールを最新にする',
    description:
      'lib はサブモジュールとして取り込んだライブラリです。ライブラリの作者が新しいコミットを push しました。lib をその最新のコミットにして、親のリポジトリに「lib を更新」としてコミットしましょう。',
    hint: 'git submodule update --remote で lib を取得元の最新にします (cd lib して git pull でも同じです)。親から見ると lib が変わっているので、git add lib して git commit します。',
    setup: [
      'git submodule add https://example.com/lib.git',
      'git commit -m "lib を追加"',
      'cd lib',
      'teammate',
      'cd ..',
    ],
    solutions: [
      ['git submodule update --remote', 'git add lib', 'git commit -m "lib を更新"'],
      ['cd lib', 'git pull', 'cd ..', 'git add lib', 'git commit -m "lib を更新"'],
    ],
    check: (repo) => {
      const tip = repo.libraries['https://example.com/lib.git']?.remote.branches['main']
      return tip !== undefined && parseGitlink(headTree(repo)['lib']) === tip
    },
  },  {
    id: 'clone',
    title: 'チームメイトの立場で push する',
    description:
      'origin を ../teammate に clone して、チームメイトとして作業します。teammate で team.txt を追加して push し、元のリポジトリ (~/branch-lab) に戻って、その変更を pull で取り込みましょう。',
    hint: 'git clone https://example.com/branch-lab.git ../teammate で clone し、cd ../teammate で移ります。コミットして git push したら、cd ../branch-lab で戻って git pull します。',
    setup: [...change('app.txt', '機能 A', '機能 A'), 'git push'],
    solutions: [
      [
        'git clone https://example.com/branch-lab.git ../teammate',
        'cd ../teammate',
        'echo "チームメイトの変更" > team.txt',
        'git add team.txt',
        'git commit -m "チームメイトの変更"',
        'git push',
        'cd ../branch-lab',
        'git pull',
      ],
    ],
    checkRemote: true,
    check: (repo) => Object.keys(repo.clones).length > 0 && 'team.txt' in headTree(repo),
  },
  {
    id: 'notes',
    title: 'コミットを変えずにメモを付ける',
    description:
      '「機能 B」のコミットがレビュー済みであることを記録したいのですが、公開済みなのでコミットは書き換えられません。git notes で、そのコミットに「レビュー済み」というメモを付けましょう。',
    hint: 'git log --oneline でコミットの ID を確かめ、git notes add -m "レビュー済み" <コミット> でメモを付けます。git log に Notes: として表示されます。',
    setup: [...change('app.txt', '機能 A', '機能 A'), ...change('app.txt', '機能 B', '機能 B'), ...change('app.txt', '機能 C', '機能 C'), 'git push'],
    solutions: [['git notes add -m "レビュー済み" C2']],
    check: (repo) => (repo.notes['C2'] ?? '').includes('レビュー済み'),
  },
  {
    id: 'sparse-checkout',
    title: '必要なディレクトリだけを出す',
    description:
      'このリポジトリには docs・server・web のディレクトリがありますが、あなたが触るのは web だけです。sparse-checkout で、作業ディレクトリに web だけを出しましょう (ルートのファイルは残ります)。',
    hint: 'git sparse-checkout set web で、web ディレクトリだけを出します。ls で確かめられます。git sparse-checkout disable で元に戻せます。',
    setup: [
      'echo "使い方" > docs/guide.md',
      'echo "サーバー" > server/main.go',
      'echo "画面" > web/index.html',
      'git add .',
      'git commit -m "プロジェクトの構成"',
    ],
    solutions: [['git sparse-checkout set web']],
    check: (repo) => repo.sparse !== null && repo.sparse.length === 1 && repo.sparse[0] === 'web',
  },  {
    id: 'autosquash',
    title: 'あとから直しを混ぜ込む',
    description:
      '「ログイン画面を追加」のコミットで、login.html の見出しを書き忘れていました。その後に「README を更新」もコミットしています。直しを commit --fixup で作り、rebase --autosquash で元のコミットに混ぜ込んで、コミットを 2 つのままにしましょう。',
    hint: 'echo "<h1>ログイン</h1>" >> login.html で直して git add し、git commit --fixup=C1 で "fixup! ログイン画面を追加" のコミットを作ります。git rebase --autosquash C0 で、C1 の直後に fixup として並べ替えてまとめます。',
    setup: [...change('login.html', '<form></form>', 'ログイン画面を追加'), ...change('README.md', 'ログインの説明', 'README を更新')],
    solutions: [['echo "<h1>ログイン</h1>" >> login.html', 'git add login.html', 'git commit --fixup=C1', 'git rebase --autosquash C0']],
    check: (repo) => {
      const tip = repo.commits[repo.branches['main'] ?? '']
      const first = repo.commits[tip?.parents[0] ?? '']
      return first?.message === 'ログイン画面を追加' && (first.tree['login.html'] ?? '').includes('<h1>ログイン</h1>')
    },
  },
  {
    id: 'am',
    title: 'メールで届いたパッチを取り込む',
    description:
      'リポジトリに push できない協力者から、変更がパッチファイル (mail/0001-挨拶を追加.patch) で届きました。git am で、このパッチを main のコミットとして取り込みましょう。',
    hint: 'cat mail/0001-挨拶を追加.patch で中身を確かめられます。git am mail/0001-挨拶を追加.patch で、パッチのメッセージと変更のままコミットになります。',
    setup: [
      'git switch -c contributor',
      ...change('greeting.txt', 'こんにちは', '挨拶を追加'),
      'git format-patch -1 -o mail',
      'git switch main',
      'git branch -D contributor',
      ...change('README.md', '更新', 'README を更新'),
    ],
    solutions: [['git am mail/0001-挨拶を追加.patch']],
    check: (repo) => repo.commits[repo.branches['main'] ?? '']?.message === '挨拶を追加',
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
