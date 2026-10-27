/**
 * 初学者向けのチュートリアル。レッスンごとに初期状態 (setup) があり、ステップを 1 つずつ進める。
 * 課題のあるステップは、コマンドを実行するたびに check で達成したかを調べる。
 * 文中の `…` はコードとして表示する。
 */
import { executeCommand } from '../git/commands'
import { createRepo, headTree, isAncestor, type Repo } from '../git/model'
import { activeRepo } from '../git/submodule'

export interface StepContext {
  /** 今いるリポジトリ (サブモジュールなどの中にいれば、その中)。 */
  readonly repo: Repo
  /** 最後に実行したコマンド (このステップに来てからまだなければ null)。 */
  readonly last: { readonly command: string; readonly ok: boolean } | null
}

export interface TutorialStep {
  readonly title: string
  /** 説明。段落は空行で区切る。 */
  readonly body: string
  /** やってみること (なければ読むだけのステップ)。 */
  readonly task?: string
  /** 画面に出す、入力するコマンドの例。 */
  readonly commands?: readonly string[]
  /** テストで課題を解くコマンド (省略すると commands)。:wq はエディタを保存して閉じる。 */
  readonly solution?: readonly string[]
  readonly check?: (context: StepContext) => boolean
}

export interface Lesson {
  readonly id: string
  readonly title: string
  /** レッスンの一覧に出す説明。 */
  readonly summary: string
  readonly setup: readonly string[]
  readonly steps: readonly TutorialStep[]
}

/** 最後のコマンドが成功していて、パターンに一致するか。 */
function ran(context: StepContext, pattern: RegExp): boolean {
  return context.last !== null && context.last.ok && pattern.test(context.last.command)
}

function branchTip(repo: Repo, name: string): string | undefined {
  return repo.branches[name]
}

function commitFile(file: string, text: string, message: string): string[] {
  return [`echo "${text}" > ${file}`, `git add ${file}`, `git commit -m "${message}"`]
}

export const LESSONS: readonly Lesson[] = [
  {
    id: 'first-commit',
    title: 'はじめてのコミット',
    summary: '画面の見方と、ファイルを作ってコミットするまでの流れ',
    setup: [],
    steps: [
      {
        title: 'ようこそ',
        body:
          'Git は、ファイルの変更の履歴を記録するツールです。「いつ・何を・なぜ変えたか」を残しておけば、前の状態に戻したり、複数人で同じファイルを安全に編集したりできます。\n\nこのチュートリアルでは、右のターミナルにコマンドを入力しながら、左の画面がどう変わるかを見ていきます。左の画面は、上から「作業ディレクトリ」(手元のファイル)・「ステージ」(次のコミットの下書き)・「ローカルリポジトリ」(コミットの履歴のグラフ)・「リモートリポジトリ」(共有する場所) です。',
      },
      {
        title: '今の状態を見る',
        body: '`git status` は、今の状態を教えてくれるコマンドです。どのブランチにいるか、変更したファイルがあるかがわかります。迷ったら、いつでも `git status` を実行しましょう。',
        task: '`git status` を実行してみましょう。',
        commands: ['git status'],
        check: (context) => ran(context, /^(git\s+)?status\b/),
      },
      {
        title: 'ファイルを作る',
        body:
          'このアプリでは、`echo "内容" > ファイル名` でファイルを作ります。作ったファイルは「作業ディレクトリ」に現れます。\n\nこの時点では、Git はまだこのファイルを記録していません (「追跡していないファイル」)。',
        task: 'index.html を作ってみましょう。',
        commands: ['echo "<h1>Hello</h1>" > index.html'],
        check: ({ repo }) => 'index.html' in repo.workdir,
      },
      {
        title: 'ステージに入れる',
        body:
          'コミットする前に、記録したい変更を「ステージ」に入れます。これを「ステージする」と言い、`git add` を使います。\n\nステージは「次のコミットの下書き」です。変更したファイルのうち、コミットに入れたいものだけを選べます。',
        task: 'index.html をステージしましょう。',
        commands: ['git add index.html'],
        check: ({ repo }) => 'index.html' in repo.index,
      },
      {
        title: 'コミットする',
        body:
          '`git commit` は、ステージの内容を 1 つの「コミット」として履歴に記録します。`-m` で、何をしたかがわかるメッセージを付けます。\n\nコミットすると、グラフに新しい丸 (コミット) が増え、`main` ブランチがそこに進みます。',
        task: 'メッセージを付けてコミットしましょう。',
        commands: ['git commit -m "トップページを追加"'],
        check: ({ repo }) => 'index.html' in headTree(repo),
      },
      {
        title: '履歴を見る',
        body: '`git log` で、コミットの履歴を新しい順に表示できます。`--oneline` を付けると、1 つのコミットを 1 行で表示します。C1 のような記号がコミットの ID です (本物の Git では長いハッシュ値です)。',
        task: '履歴を表示してみましょう。',
        commands: ['git log --oneline'],
        check: (context) => ran(context, /^(git\s+)?log\b/),
      },
      {
        title: 'まとめ',
        body:
          'Git の基本は「ファイルを編集する → `git add` でステージする → `git commit` で記録する」の繰り返しです。\n\n次のレッスンでは、何を変えたかを確かめながらコミットする方法を学びます。',
      },
    ],
  },
  {
    id: 'changes',
    title: '変更を確かめる',
    summary: 'git diff で変更を確かめてコミットし、間違えた変更を元に戻す',
    setup: commitFile('index.html', '<h1>Hello</h1>', 'トップページを追加'),
    steps: [
      {
        title: '変更を確かめながら進める',
        body: 'コミットする前に「何を変えたか」を確かめる習慣をつけると、間違ったものをコミットせずに済みます。そのためのコマンドが `git diff` です。',
      },
      {
        title: 'ファイルを変える',
        body: '`>>` は、ファイルの最後に 1 行追記します。変更したファイルは、作業ディレクトリでは「変更あり」と表示されます。',
        task: 'index.html に 1 行追記しましょう。',
        commands: ['echo "<p>ようこそ</p>" >> index.html'],
        check: ({ repo }) => repo.workdir['index.html'] !== repo.index['index.html'],
      },
      {
        title: '差分を見る',
        body: '`git diff` は、まだステージしていない変更を表示します。`+` で始まる行が追加した行、`-` で始まる行が消した行です。',
        task: '`git diff` で変更を確かめましょう。',
        commands: ['git diff'],
        check: (context) => ran(context, /^(git\s+)?diff\s*$/),
      },
      {
        title: 'ステージした変更を見る',
        body: 'ステージしたあとの変更は、`git diff` には出なくなります。ステージした変更 (次のコミットに入る変更) は `git diff --staged` で見ます。',
        task: 'index.html をステージして、`git diff --staged` で確かめましょう。',
        commands: ['git add index.html', 'git diff --staged'],
        check: (context) => context.repo.index['index.html']?.includes('ようこそ') === true && ran(context, /^(git\s+)?diff\s+--(staged|cached)\b/),
      },
      {
        title: 'コミットする',
        body: '確かめたら、コミットしましょう。',
        task: 'コミットしましょう。',
        commands: ['git commit -m "ようこその文を追加"'],
        check: ({ repo }) => headTree(repo)['index.html']?.includes('ようこそ') === true,
      },
      {
        title: '間違えた変更を元に戻す',
        body:
          '書き間違えた変更を捨てたいときは、`git restore <ファイル>` を使います。作業ディレクトリのファイルが、ステージの内容に戻ります。\n\n捨てた変更は取り戻せないので、使う前に `git diff` で確かめましょう。',
        task: 'index.html に間違った行を追記してから、`git restore` で元に戻しましょう。',
        commands: ['echo "まちがい" >> index.html', 'git restore index.html'],
        check: (context) => ran(context, /^(git\s+)?restore\b/) && context.repo.workdir['index.html'] === headTree(context.repo)['index.html'],
      },
      {
        title: 'まとめ',
        body:
          '`git diff` はまだステージしていない変更を、`git diff --staged` は次のコミットに入る変更を表示します。変更を捨てるなら `git restore`、ステージから外すだけなら `git restore --staged` です。',
      },
    ],
  },
  {
    id: 'branch',
    title: 'ブランチで作業を分ける',
    summary: 'ブランチを作って切り替え、main を変えずに新しい作業をする',
    setup: commitFile('index.html', '<h1>Hello</h1>', 'トップページを追加'),
    steps: [
      {
        title: 'ブランチとは',
        body:
          'ブランチは、コミットに付けた「名前の付いた付箋」です。新しいコミットをすると、今いるブランチの付箋がそのコミットに進みます。今いるブランチは `HEAD` が指しています (グラフの「HEAD → main」)。\n\n新しい機能はブランチを分けて作ると、main をいつも動く状態のまま保てます。',
      },
      {
        title: 'ブランチを作って切り替える',
        body: '`git switch -c <名前>` で、新しいブランチを作って切り替えます。グラフでは、同じコミットに feature の付箋が増え、HEAD が feature に移ります。',
        task: 'feature ブランチを作って切り替えましょう。',
        commands: ['git switch -c feature'],
        check: ({ repo }) => repo.head.type === 'branch' && repo.head.name === 'feature',
      },
      {
        title: 'ブランチでコミットする',
        body: 'feature ブランチでコミットすると、feature だけが進み、main は元の位置に残ります。',
        task: 'contact.html を作ってコミットしましょう。',
        commands: ['echo "お問い合わせ" > contact.html', 'git add contact.html', 'git commit -m "お問い合わせページを追加"'],
        check: ({ repo }) => {
          const tip = branchTip(repo, 'feature')
          return tip !== undefined && 'contact.html' in (repo.commits[tip]?.tree ?? {})
        },
      },
      {
        title: 'main に戻る',
        body: '`git switch main` で main に戻ります。作業ディレクトリも main の内容になるので、contact.html が見えなくなります (消えたのではなく、feature ブランチに記録されています)。',
        task: 'main に切り替えましょう。',
        commands: ['git switch main'],
        check: ({ repo }) => repo.head.type === 'branch' && repo.head.name === 'main',
      },
      {
        title: 'すべてのブランチの履歴を見る',
        body: '`git log --oneline --graph --all` で、すべてのブランチの履歴を線付きで表示できます。`git branch` ならブランチの一覧です。',
        task: 'ブランチの一覧か、すべての履歴を表示しましょう。',
        commands: ['git log --oneline --graph --all'],
        check: (context) => ran(context, /^(git\s+)?(log\b.*--all|branch\s*$)/),
      },
      {
        title: 'まとめ',
        body: '`git switch -c` でブランチを作って切り替え、`git switch` で行き来します。次のレッスンでは、feature の変更を main に取り込む「マージ」を学びます。',
      },
    ],
  },
  {
    id: 'merge',
    title: 'ブランチをマージする',
    summary: 'fast-forward とマージコミット、エディタの使い方',
    setup: [
      ...commitFile('index.html', '<h1>Hello</h1>', 'トップページを追加'),
      'git switch -c feature',
      ...commitFile('contact.html', 'お問い合わせ', 'お問い合わせページを追加'),
      'git switch main',
    ],
    steps: [
      {
        title: 'マージとは',
        body:
          '`git merge <ブランチ>` は、指定したブランチの変更を今のブランチに取り込みます。\n\n今の main は feature の祖先 (feature は main の先に進んでいるだけ) なので、main の付箋を feature の位置まで進めるだけで済みます。これを fast-forward と言います。',
      },
      {
        title: 'fast-forward マージ',
        body: 'main にいる状態で、feature をマージしましょう。新しいコミットは作られず、main が feature と同じコミットに進みます。',
        task: 'feature を main にマージしましょう。',
        commands: ['git merge feature'],
        check: ({ repo }) => branchTip(repo, 'main') === branchTip(repo, 'feature') && repo.head.type === 'branch' && repo.head.name === 'main',
      },
      {
        title: '両方が進んだ場合',
        body:
          '次は、main と別のブランチの両方にコミットがある場合です。このときは、2 つの親を持つ「マージコミット」を作って合流させます。\n\nまず docs ブランチを作ってコミットし、main に戻って main でもコミットしましょう。',
        task: 'docs と main の両方にコミットしましょう。',
        commands: [
          'git switch -c docs',
          'echo "使い方" > guide.txt',
          'git add guide.txt',
          'git commit -m "使い方を追加"',
          'git switch main',
          'echo "<footer>©</footer>" >> index.html',
          'git commit -am "フッターを追加"',
        ],
        check: ({ repo }) => {
          const main = branchTip(repo, 'main')
          const docs = branchTip(repo, 'docs')
          if (main === undefined || docs === undefined) return false
          // docs でコミットしただけでは未達成。main に戻って main でもコミットし、両方が進んだら達成
          const diverged = !isAncestor(repo, main, docs) && !isAncestor(repo, docs, main)
          const onMain = repo.head.type === 'branch' && repo.head.name === 'main'
          return diverged && onMain && 'guide.txt' in (repo.commits[docs]?.tree ?? {}) && !('guide.txt' in (repo.commits[main]?.tree ?? {}))
        },
      },
      {
        title: 'マージコミットを作る',
        body:
          'docs をマージすると、マージコミットのメッセージを書くエディタが開きます。既定のメッセージ (Merge branch \'docs\') のままでよければ、エディタの「保存して閉じる」を押します。エディタが開いている間は、ほかのコマンドは実行できません。\n\n(`git merge --no-edit docs` なら、エディタを開かずに既定のメッセージを使います。)',
        task: 'docs を main にマージして、エディタを保存して閉じましょう。',
        commands: ['git merge docs'],
        solution: ['git merge docs', ':wq'],
        check: ({ repo }) => {
          const main = branchTip(repo, 'main')
          return repo.editor === null && main !== undefined && (repo.commits[main]?.parents.length ?? 0) === 2
        },
      },
      {
        title: 'まとめ',
        body: '相手が先に進んでいるだけなら fast-forward、両方が進んでいればマージコミットで合流します。グラフで、マージコミットに 2 本の線が入っていることを確かめましょう。',
      },
    ],
  },
  {
    id: 'conflict',
    title: 'コンフリクトを解消する',
    summary: '同じ行を両方で変えたときの、コンフリクトの直し方',
    setup: [
      'git switch -c feature',
      'echo "# BranchLab (feature の説明)" > README.md',
      'git commit -am "README を feature 向けに変更"',
      'git switch main',
      'echo "# BranchLab (main の説明)" > README.md',
      'git commit -am "README を main 向けに変更"',
    ],
    steps: [
      {
        title: 'コンフリクトとは',
        body: 'main と feature の両方で、README.md の同じ行を違う内容に変えました。このままマージすると、Git はどちらを残せばよいか決められません。これを「コンフリクト (衝突)」と言います。',
      },
      {
        title: 'マージして止まる',
        body: 'マージすると、コンフリクトで止まります。`git status` を見ると、「両方とも変更」のファイルがあることがわかります。',
        task: 'feature をマージしましょう。',
        commands: ['git merge feature'],
        check: ({ repo }) => repo.operation?.type === 'merge' && repo.conflicts.length > 0,
      },
      {
        title: 'コンフリクトを見る',
        body: 'コンフリクトしたファイルには、`<<<<<<<` から `=======` までが今のブランチ (main) の内容、`=======` から `>>>>>>>` までが相手 (feature) の内容として、両方が書かれています。',
        task: 'README.md の中身を見てみましょう。',
        commands: ['cat README.md'],
        check: (context) => ran(context, /^cat\s+README\.md/),
      },
      {
        title: 'ファイルを直す',
        body: '残したい内容にファイルを書き直します。マーカー (`<<<<<<<` など) も消して、正しい内容だけにします。',
        task: 'README.md を、両方をまとめた内容に書き直しましょう。',
        commands: ['echo "# BranchLab (main と feature の説明)" > README.md'],
        check: ({ repo }) => repo.workdir['README.md'] !== undefined && !repo.workdir['README.md'].includes('<<<<<<<'),
      },
      {
        title: '解決したことを伝える',
        body: '直したファイルを `git add` すると、Git に「このファイルのコンフリクトは解決した」と伝えられます。',
        task: 'README.md をステージしましょう。',
        commands: ['git add README.md'],
        check: ({ repo }) => repo.conflicts.length === 0 && repo.index['README.md']?.includes('<<<<<<<') === false,
      },
      {
        title: 'マージを完了する',
        body: 'すべて解決したら、`git commit` でマージコミットを作ってマージを完了します。`--no-edit` を付けると、既定のメッセージを使います。',
        task: 'マージを完了しましょう。',
        commands: ['git commit --no-edit'],
        check: ({ repo }) => {
          const main = branchTip(repo, 'main')
          return repo.operation === null && repo.editor === null && (repo.commits[main ?? '']?.parents.length ?? 0) === 2
        },
      },
      {
        title: 'まとめ',
        body: 'コンフリクトしたら「ファイルを直す → `git add` → `git commit`」です。途中でやめたいときは `git merge --abort` で、マージする前に戻せます。',
      },
    ],
  },
  {
    id: 'remote',
    title: 'リモートと共同作業する',
    summary: 'push で送り、fetch と pull で他の人の変更を取り込む',
    setup: commitFile('index.html', '<h1>Hello</h1>', 'トップページを追加'),
    steps: [
      {
        title: 'リモートとは',
        body:
          'リモートは、チームで共有するリポジトリ (GitHub など) です。最初から `origin` という名前のリモートがあります。画面の一番下が origin の中身です。\n\nグラフの `origin/main` は「最後に確かめたときの、origin の main の位置」を表す、手元の記録 (リモート追跡ブランチ) です。',
      },
      {
        title: 'push で送る',
        body: '`git push` は、手元のコミットをリモートに送ります。送ると、リモートの main と、手元の `origin/main` が進みます。',
        task: 'main を origin に push しましょう。',
        commands: ['git push'],
        check: ({ repo }) => repo.remotes['origin']?.branches['main'] === branchTip(repo, 'main'),
      },
      {
        title: '他の人が push する',
        body: '`teammate` はこのアプリ独自のコマンドで、チームメイトが origin にコミットを push したことにします。リモートの main は進みますが、手元の `origin/main` はまだ古いままです。',
        task: '`teammate` を実行しましょう。',
        commands: ['teammate'],
        check: ({ repo }) => repo.remotes['origin']?.branches['main'] !== repo.remoteBranches['origin/main'],
      },
      {
        title: 'fetch で取ってくる',
        body: '`git fetch` は、リモートの新しいコミットを取ってきて `origin/main` を進めます。手元の main や作業ディレクトリは変わらないので、安全に「何が起きたか」を確かめられます。',
        task: 'fetch しましょう。',
        commands: ['git fetch'],
        check: ({ repo }) => repo.remotes['origin']?.branches['main'] === repo.remoteBranches['origin/main'],
      },
      {
        title: '取り込む',
        body: '取ってきた変更を main に取り込むには、`git merge origin/main` を実行します。`git pull` は「fetch してからマージ」を 1 回で行うコマンドで、ふだんはこちらを使います。',
        task: 'origin の変更を main に取り込みましょう。',
        commands: ['git pull'],
        check: ({ repo }) => branchTip(repo, 'main') === repo.remotes['origin']?.branches['main'],
      },
      {
        title: 'まとめ',
        body:
          '`git push` で送り、`git pull` (= `git fetch` + マージ) で取り込みます。リモートに手元にないコミットがあると push は拒否されるので、先に pull してから push しましょう。',
      },
    ],
  },
  {
    id: 'undo',
    title: '取り消してやり直す',
    summary: 'reset でコミットを取り消し、reflog で戻し、revert で打ち消す',
    setup: [
      ...commitFile('a.txt', 'A', 'A を追加'),
      ...commitFile('b.txt', 'B', 'B を追加'),
      ...commitFile('c.txt', 'C', 'C を追加'),
    ],
    steps: [
      {
        title: '取り消す方法は 2 つ',
        body: 'Git でコミットを取り消すには、ブランチを前のコミットに戻す `git reset` と、変更を打ち消すコミットを新しく作る `git revert` があります。まだ push していないなら reset、push したあとなら revert を使います。',
      },
      {
        title: 'reset で戻す',
        body:
          '`git reset --hard HEAD~1` は、ブランチを 1 つ前のコミット (`HEAD~1`) に戻し、ステージと作業ディレクトリもその内容にします。\n\n外れたコミット (C3) は、グラフに薄く残ります。どのブランチからもたどれなくなったコミットです。',
        task: '直前のコミットを取り消しましょう。',
        commands: ['git reset --hard HEAD~1'],
        check: ({ repo }) => branchTip(repo, 'main') === 'C2',
      },
      {
        title: 'reflog で探す',
        body: '`git reflog` は、HEAD が動いた記録です。reset で外したコミットも、ここから見つけられます。`HEAD@{1}` は「HEAD の 1 つ前の位置」です。',
        task: '`git reflog` を実行しましょう。',
        commands: ['git reflog'],
        check: (context) => ran(context, /^(git\s+)?reflog\s*$/),
      },
      {
        title: 'reset を取り消す',
        body: '`git reset --hard HEAD@{1}` で、reset する前の位置に戻せます。間違えて reset しても、reflog があればたいてい戻せます。',
        task: 'C3 に戻しましょう。',
        commands: ['git reset --hard HEAD@{1}'],
        check: ({ repo }) => branchTip(repo, 'main') === 'C3',
      },
      {
        title: 'revert で打ち消す',
        body: '`git revert` は、指定したコミットの変更を逆にした新しいコミットを作ります。履歴を消さないので、すでに push して他の人が使っているコミットも安全に取り消せます。',
        task: '今のコミット (C を追加) を打ち消しましょう。',
        commands: ['git revert --no-edit HEAD'],
        check: ({ repo }) => {
          const main = branchTip(repo, 'main')
          return main !== undefined && repo.commits[main]?.reverts !== undefined && !('c.txt' in headTree(repo))
        },
      },
      {
        title: 'まとめ',
        body: '手元だけの取り消しは `git reset`、共有したコミットの取り消しは `git revert` です。困ったら `git reflog` で前の位置を探しましょう。',
      },
    ],
  },
  {
    id: 'stash',
    title: '作業を一時的に退避する',
    summary: 'stash で作業途中の変更をしまい、あとで戻す',
    setup: [...commitFile('app.txt', '機能 A', '機能 A'), 'echo "作業中の機能 B" >> app.txt'],
    steps: [
      {
        title: '作業の途中で割り込みが入ったら',
        body: 'app.txt を編集している途中で、急ぎの修正を頼まれました。作りかけの変更はまだコミットしたくありません。こんなときは `git stash` で変更を一時的に退避します。',
      },
      {
        title: '退避する',
        body: '`git stash` は、コミットしていない変更をしまって、作業ディレクトリをきれいな状態に戻します。しまった変更は画面の「stash」に表示されます。',
        task: '変更を退避しましょう。',
        commands: ['git stash'],
        check: ({ repo }) => repo.stash.length > 0 && repo.workdir['app.txt'] === headTree(repo)['app.txt'],
      },
      {
        title: '急ぎの修正をする',
        body: 'きれいな状態になったので、急ぎの修正をコミットできます。',
        task: 'fix.txt を作ってコミットしましょう。',
        commands: ['echo "修正" > fix.txt', 'git add fix.txt', 'git commit -m "急ぎの修正"'],
        check: ({ repo }) => 'fix.txt' in headTree(repo),
      },
      {
        title: '戻す',
        body: '`git stash pop` で、退避した変更を作業ディレクトリに戻します。戻した変更は stash の一覧から消えます。',
        task: '退避した変更を戻しましょう。',
        commands: ['git stash pop'],
        check: ({ repo }) => repo.stash.length === 0 && repo.workdir['app.txt']?.includes('機能 B') === true,
      },
      {
        title: 'まとめ',
        body:
          '`git stash` でしまい、`git stash pop` で戻します。`git stash list` で一覧を見られます。\n\nこれでチュートリアルは終わりです。「お題」で、ここまでのコマンドを使った問題に挑戦してみましょう。困ったら、画面上の「ヘルプ」か、ターミナルの `help <コマンド>` で説明を見られます。',
      },
    ],
  },
]

/** 課題のあるステップを達成したか (読むだけのステップはいつも true)。 */
export function isStepDone(step: TutorialStep, root: Repo, last: StepContext['last']): boolean {
  if (step.check === undefined) return true
  return step.check({ repo: activeRepo(root), last })
}

/** レッスンの初期状態 (setup を実行した Repo)。 */
export function lessonStart(lesson: Lesson): Repo {
  return lesson.setup.reduce((repo, line) => {
    const result = executeCommand(repo, line)
    if (!result.ok) throw new Error(`レッスンのコマンド "${line}" が失敗しました:\n${result.output}`)
    return result.repo
  }, createRepo())
}
