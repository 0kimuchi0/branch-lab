/**
 * コマンドのヘルプ。ターミナルの help <コマンド> / git help <コマンド> / git <コマンド> -h と、
 * 画面のヘルプ (HelpDialog) の両方がこのデータを使う。文中の `…` はコードとして表示する。
 */

export type HelpCategory =
  | 'file'
  | 'basic'
  | 'inspect'
  | 'branch'
  | 'undo'
  | 'rewrite'
  | 'remote'
  | 'save'
  | 'workspace'
  | 'patch'
  | 'maintenance'
  | 'app'

export const CATEGORY_LABELS: Readonly<Record<HelpCategory, string>> = {
  file: 'ファイルの操作 (シェルのコマンド)',
  basic: '記録する (基本)',
  inspect: '状態と履歴を見る',
  branch: 'ブランチとマージ',
  undo: '取り消す・戻す',
  rewrite: '履歴を書き換える',
  remote: 'リモートとの共同作業',
  save: '作業の退避と調査',
  workspace: '作業場所を増やす・分ける',
  patch: 'パッチとファイルでのやりとり',
  maintenance: 'リポジトリの管理',
  app: 'このアプリの操作',
}

export interface CommandHelp {
  /** コマンドの名前 (git のコマンドは git を除いた名前)。 */
  readonly name: string
  /** git のコマンドか (false ならシェルやこのアプリのコマンド)。 */
  readonly git: boolean
  readonly category: HelpCategory
  /** 一覧に出す 1 行の説明。 */
  readonly summary: string
  readonly usage: readonly string[]
  /** 詳しい説明。段落は空行で区切る。 */
  readonly description: string
  /** よく使うオプション: [オプション, 説明]。 */
  readonly options?: ReadonlyArray<readonly [string, string]>
  /** 例: [コマンド, 説明]。 */
  readonly examples: ReadonlyArray<readonly [string, string]>
  readonly related?: readonly string[]
}

export const COMMAND_HELP: readonly CommandHelp[] = [
  // ---- ファイルの操作 ----
  {
    name: 'echo',
    git: false,
    category: 'file',
    summary: 'ファイルに書く (> で上書き、>> で追記)',
    usage: ['echo "内容" > <ファイル>', 'echo "内容" >> <ファイル>', 'echo "内容"'],
    description:
      'このアプリでファイルを作ったり書き換えたりするときの基本のコマンドです。`>` はファイルを上書きし、`>>` は最後の行に追記します。ファイルがなければ作ります。\n\n`dir/a.txt` のようにパスを書くと、ディレクトリの中にファイルを作ります。`> ファイル` を付けなければ、内容を画面に出すだけです。',
    examples: [
      ['echo "<h1>Hello</h1>" > index.html', 'index.html を作る (あれば上書きする)'],
      ['echo "2 行目" >> index.html', 'index.html に 1 行追記する'],
      ['echo "a" > src/app.txt', 'src ディレクトリの中に app.txt を作る'],
    ],
    related: ['cat', 'add'],
  },
  {
    name: 'cat',
    git: false,
    category: 'file',
    summary: 'ファイルの中身を表示する',
    usage: ['cat <ファイル>...'],
    description: '作業ディレクトリにあるファイルの中身を表示します。コンフリクトしたファイルなら、`<<<<<<<` などのコンフリクトマーカーも見えます。',
    examples: [['cat README.md', 'README.md の中身を表示する']],
    related: ['echo', 'ls'],
  },
  {
    name: 'ls',
    git: false,
    category: 'file',
    summary: 'ファイルの一覧を表示する',
    usage: ['ls [<ディレクトリ>]'],
    description: '作業ディレクトリのファイルの一覧を表示します。ディレクトリを指定すると、その中だけを表示します。`ls .git/hooks` でフックの一覧も見られます。',
    examples: [['ls', 'ファイルの一覧を表示する']],
  },
  {
    name: 'touch',
    git: false,
    category: 'file',
    summary: '空のファイルを作る',
    usage: ['touch <ファイル>...'],
    description: '空のファイルを作ります。すでにあるファイルは変えません。',
    examples: [['touch .gitignore', '空の .gitignore を作る']],
  },
  {
    name: 'rm',
    git: false,
    category: 'file',
    summary: '作業ディレクトリからファイルを消す',
    usage: ['rm [-f] [-r] <ファイル>...'],
    description:
      '作業ディレクトリからだけファイルを消します (ステージやコミットは変わりません)。消したことを次のコミットに入れるには、`git add` するか、最初から `git rm` を使います。\n\n先頭に `git` を付けた `git rm` は別のコマンドです。',
    options: [
      ['-r', 'ディレクトリを中のファイルごと消す'],
      ['-f', 'ファイルがなくても失敗にしない'],
    ],
    examples: [
      ['rm memo.txt', 'memo.txt を消す'],
      ['rm -rf build', 'build ディレクトリを丸ごと消す'],
    ],
    related: ['git-rm', 'restore'],
  },
  {
    name: 'mv',
    git: false,
    category: 'file',
    summary: 'ファイルを移す・名前を変える',
    usage: ['mv <元> <先>'],
    description: 'ファイル (またはディレクトリの中のファイルすべて) を移します。先が既存のディレクトリ (または `/` で終わる) なら、その中に移します。Git から見ると、元のファイルの削除と新しいファイルの追加です。',
    examples: [
      ['mv a.txt b.txt', 'a.txt の名前を b.txt に変える'],
      ['mv a.txt docs/', 'a.txt を docs ディレクトリに移す'],
    ],
  },
  {
    name: 'mkdir',
    git: false,
    category: 'file',
    summary: 'ディレクトリを作る (何もしない)',
    usage: ['mkdir [-p] <ディレクトリ>...'],
    description: 'このアプリでは、ディレクトリはファイルを作ると自然にできるので、何もしません (Git も空のディレクトリは記録しません)。',
    examples: [['mkdir -p docs', '何もしない (docs/a.txt を echo で作ればディレクトリもできる)']],
  },
  {
    name: 'grep',
    git: false,
    category: 'file',
    summary: '一致する行を探す',
    usage: ['grep [-q] [-v] [-i] [-c] [-n] [-E | -F] <パターン> <ファイル>...'],
    description: 'パターン (正規表現) に一致する行を表示します。一致する行がなければ失敗するので、フックの中で条件を調べるのに使えます。',
    options: [
      ['-q', '何も表示せず、成否だけを返す'],
      ['-v', '一致しない行を探す'],
      ['-i', '大文字と小文字を区別しない'],
      ['-c', '一致した行の数を表示する'],
      ['-n', '行番号も表示する'],
      ['-F', 'パターンを正規表現ではなく文字列として扱う'],
    ],
    examples: [['grep -n Hello README.md', 'README.md の Hello を含む行を行番号付きで表示する']],
  },
  {
    name: 'sed',
    git: false,
    category: 'file',
    summary: '行ごとに書き換える',
    usage: ["sed [-n] [-E] [-i] [-e <スクリプト>]... '<スクリプト>' [<ファイル>...]"],
    description:
      'ファイル (指定しなければ標準入力) を 1 行ずつ書き換えて表示します。`-i` ならファイルを書き換えます。使えるスクリプトは `s/前/後/g` (置換)・`/パターン/d` (一致する行を消す)・`<行番号>d`・`p` です。\n\n`git filter-branch --msg-filter` でコミットメッセージを書き換えるときにも使います。',
    options: [
      ['-i', 'ファイルを直接書き換える'],
      ['-E', '拡張正規表現を使う ( ( ) + ? | をそのまま使える)'],
      ['-e <スクリプト>', 'スクリプトを複数指定する'],
      ['-n', '自動で表示しない (p で表示した行だけを出す)'],
    ],
    examples: [
      ["sed 's/Hello/Hi/g' README.md", 'Hello を Hi に置き換えた結果を表示する'],
      ["sed -i '/TODO/d' notes.txt", 'notes.txt から TODO を含む行を消す'],
    ],
  },
  {
    name: 'chmod',
    git: false,
    category: 'file',
    summary: 'フックを実行できるようにする',
    usage: ['chmod +x <ファイル>...', 'chmod -x <ファイル>...'],
    description: '`.git/hooks` に置いたフックを実行できるようにします (`+x`)。実行できるようにしていないフックは、本物の Git と同じく警告を出して無視されます。',
    examples: [['chmod +x .git/hooks/pre-commit', 'pre-commit フックを有効にする']],
    related: ['commit'],
  },
  {
    name: 'cd',
    git: false,
    category: 'file',
    summary: 'worktree・サブモジュール・clone したリポジトリに移動する',
    usage: ['cd <パス>', 'cd'],
    description:
      '別の場所に移ります。移れるのは worktree (`git worktree add` で作ったもの)、サブモジュールの中、`git clone` で作ったリポジトリです。パスを省くと、最初の場所 (`~/branch-lab`) に戻ります。\n\n今いる場所は `pwd` で確かめられます。',
    examples: [
      ['cd ../hotfix', '~/hotfix の worktree に移る'],
      ['cd lib', 'サブモジュール lib の中に入る'],
      ['cd', '~/branch-lab に戻る'],
    ],
    related: ['pwd', 'worktree', 'submodule', 'clone'],
  },
  {
    name: 'pwd',
    git: false,
    category: 'file',
    summary: '今いる場所を表示する',
    usage: ['pwd'],
    description: '今いる場所のパスを表示します (最初は `~/branch-lab`)。',
    examples: [['pwd', '今いる場所を表示する']],
    related: ['cd'],
  },

  // ---- 記録する ----
  {
    name: 'add',
    git: true,
    category: 'basic',
    summary: '変更をステージする (次のコミットに入れる)',
    usage: ['git add <ファイル>...', 'git add .', 'git add -A'],
    description:
      '作業ディレクトリの変更を「ステージ」に入れます。ステージは次のコミットの下書きで、`git commit` はステージの内容をそのまま記録します。\n\n新しいファイル・変更したファイル・消したファイルのどれも、`git add` でステージできます。`.` は今のディレクトリの下のすべてです。',
    options: [['-A', 'すべての変更 (削除も含む) をステージする']],
    examples: [
      ['git add index.html', 'index.html の変更をステージする'],
      ['git add .', 'すべての変更をステージする'],
    ],
    related: ['commit', 'status', 'restore'],
  },
  {
    name: 'commit',
    git: true,
    category: 'basic',
    summary: 'ステージの内容を記録する',
    usage: [
      'git commit -m "メッセージ"',
      'git commit [-a] [--allow-empty] [--amend] [--no-edit] [--no-verify]',
      'git commit --fixup=<コミット> / --squash=<コミット>',
    ],
    description:
      'ステージの内容を、新しいコミットとして履歴に記録します。コミットには、何をしたかがわかるメッセージを付けます。\n\n`-m` を付けないと、メッセージを書くエディタが開きます。`#` で始まる行は無視され、空のまま保存するとコミットを中止します。\n\n`--amend` は、直前のコミットを作り直します (ファイルの直し忘れやメッセージの修正に使います)。',
    options: [
      ['-m "メッセージ"', 'メッセージを指定する (複数書くと段落になる)'],
      ['-a', '追跡しているファイルの変更を自動でステージしてからコミットする'],
      ['--amend', '直前のコミットを作り直す'],
      ['--no-edit', '--amend などでエディタを開かず、今のメッセージを使う'],
      ['--allow-empty', '変更がなくてもコミットする'],
      ['--fixup=<コミット>', 'rebase --autosquash でまとめる fixup! のコミットを作る'],
      ['--no-verify', 'pre-commit と commit-msg のフックを飛ばす'],
    ],
    examples: [
      ['git commit -m "トップページを追加"', 'ステージの内容をコミットする'],
      ['git commit -am "誤字を修正"', '変更をステージしてコミットする'],
      ['git commit --amend --no-edit', '直前のコミットに今のステージの内容を混ぜる'],
    ],
    related: ['add', 'log', 'status'],
  },
  {
    name: 'git-rm',
    git: true,
    category: 'basic',
    summary: 'ファイルを消して、そのことをステージする',
    usage: ['git rm [--cached] [-f] [-r] [--ignore-unmatch] [-q] <ファイル>...'],
    description:
      'ファイルをステージと作業ディレクトリから消します。次のコミットで、そのファイルが消えます。`--cached` なら作業ディレクトリには残し、Git の管理からだけ外します。\n\n(ターミナルでは `git rm` と入力します。`git` を付けない `rm` はシェルのコマンドです。)',
    options: [
      ['--cached', 'ステージからだけ消す (ファイルは残す)'],
      ['-r', 'ディレクトリの中も消す'],
      ['-f', 'コミットしていない変更があっても消す'],
      ['--ignore-unmatch', '一致するファイルがなくても失敗にしない'],
    ],
    examples: [
      ['git rm old.txt', 'old.txt を消して、消したことをステージする'],
      ['git rm --cached secret.txt', 'secret.txt を Git の管理から外す (ファイルは残る)'],
    ],
    related: ['rm', 'add'],
  },
  {
    name: 'restore',
    git: true,
    category: 'basic',
    summary: 'ファイルを元に戻す・ステージから外す',
    usage: ['git restore <ファイル>...', 'git restore --staged <ファイル>...', 'git restore --source=<コミット> <ファイル>...'],
    description:
      '`git restore <ファイル>` は、作業ディレクトリの変更を捨てて、ステージの内容に戻します (元に戻せないので注意してください)。\n\n`--staged` を付けると、ステージした変更を取り消します (作業ディレクトリの変更は残ります)。',
    options: [
      ['--staged', 'ステージを HEAD の内容に戻す (git add の取り消し)'],
      ['--worktree', '作業ディレクトリを戻す (--staged と一緒に使うと両方)'],
      ['--source=<コミット>', '指定したコミットの内容に戻す'],
    ],
    examples: [
      ['git restore index.html', 'index.html の変更を捨てる'],
      ['git restore --staged index.html', 'index.html をステージから外す'],
    ],
    related: ['add', 'reset', 'checkout'],
  },

  // ---- 状態と履歴を見る ----
  {
    name: 'status',
    git: true,
    category: 'inspect',
    summary: '今の状態を表示する',
    usage: ['git status'],
    description:
      '今いるブランチ、ステージした変更 (コミット予定の変更)、ステージしていない変更、追跡していないファイル、途中で止まっている操作 (マージなど) を表示します。\n\n迷ったら、まず `git status` を実行しましょう。次に何をすればよいかのヒントも出ます。',
    examples: [['git status', '今の状態を表示する']],
    related: ['diff', 'log'],
  },
  {
    name: 'log',
    git: true,
    category: 'inspect',
    summary: 'コミットの履歴を表示する',
    usage: [
      'git log [--oneline] [--graph] [--all] [-n <数>] [<範囲>] [-- <パス>]',
      'git log [--format=<書式>] [-p] [--stat] [--first-parent] [--merges] [--grep=<語>]',
    ],
    description:
      'HEAD から親をたどって、コミットを新しい順に表示します。`--oneline` で 1 行ずつ、`--graph` で枝分かれの線も表示します。\n\n範囲は `A..B` (B にあって A にないコミット)・`A...B` (どちらか一方にだけあるコミット) のように指定します。',
    options: [
      ['--oneline', '1 コミット 1 行で表示する'],
      ['--graph', '枝分かれとマージの線を表示する'],
      ['--all', 'すべてのブランチ・タグなどの履歴を表示する'],
      ['-n <数> / -<数>', '表示する数を絞る'],
      ['-p / --stat', '各コミットの差分 / 変更したファイルの一覧を表示する'],
      ['--format=<書式>', '%h (ID)・%s (件名)・%d (ブランチ名など) で表示の形を決める'],
      ['--grep=<語>', 'メッセージで絞り込む'],
      ['-- <パス>', 'そのファイルを変えたコミットだけを表示する'],
    ],
    examples: [
      ['git log --oneline', '履歴を 1 行ずつ表示する'],
      ['git log --oneline --graph --all', 'すべてのブランチの履歴を線付きで表示する'],
      ['git log -p -1', '最新のコミットの差分を表示する'],
    ],
    related: ['show', 'reflog', 'diff'],
  },
  {
    name: 'show',
    git: true,
    category: 'inspect',
    summary: 'コミットの内容と差分を表示する',
    usage: ['git show [<コミット>]', 'git show --stat [<コミット>]'],
    description: 'コミットのメッセージと、そのコミットで変わった差分を表示します。コミットを省くと HEAD (今のコミット) です。',
    options: [
      ['--stat', '差分の代わりに、変更したファイルの一覧を表示する'],
      ['--name-only', '変更したファイルの名前だけを表示する'],
    ],
    examples: [
      ['git show', '今のコミットを表示する'],
      ['git show HEAD~1', '1 つ前のコミットを表示する'],
    ],
    related: ['log', 'diff'],
  },
  {
    name: 'diff',
    git: true,
    category: 'inspect',
    summary: '差分を表示する',
    usage: ['git diff [--staged] [--stat] [--name-only] [-- <ファイル>]', 'git diff <コミット> [<コミット>]', 'git diff <A>..<B>'],
    description:
      '引数がなければ、ステージと作業ディレクトリの差分 (まだ git add していない変更) を表示します。`--staged` なら、HEAD とステージの差分 (次のコミットに入る変更) です。\n\n`+` の行が追加、`-` の行が削除です。',
    options: [
      ['--staged', 'ステージした変更を表示する (--cached も同じ)'],
      ['--stat', '変更したファイルと行数だけを表示する'],
      ['<コミット> <コミット>', '2 つのコミットの差分を表示する'],
    ],
    examples: [
      ['git diff', 'まだステージしていない変更を表示する'],
      ['git diff --staged', '次のコミットに入る変更を表示する'],
      ['git diff main feature', 'main と feature の差分を表示する'],
    ],
    related: ['status', 'show', 'add'],
  },
  {
    name: 'blame',
    git: true,
    category: 'inspect',
    summary: '各行を最後に変えたコミットを表示する',
    usage: ['git blame [-L <開始>,<終了>] <ファイル> [<コミット>]'],
    description: 'ファイルの各行について、その行を最後に変えたコミットを表示します。「この行はいつ、なぜ変わったのか」を調べるのに使います。',
    options: [['-L <開始>,<終了>', '行の範囲を絞る']],
    examples: [['git blame README.md', 'README.md の各行を最後に変えたコミットを表示する']],
    related: ['log', 'show'],
  },
  {
    name: 'reflog',
    git: true,
    category: 'inspect',
    summary: 'HEAD やブランチが動いた履歴を表示する',
    usage: [
      'git reflog [show] [<ブランチ>]',
      'git reflog expire [--expire=<日時>] [--expire-unreachable=<日時>] [--all | <参照>...]',
      'git reflog delete <参照>@{<n>}',
    ],
    description:
      'HEAD (やブランチ) がどのコミットからどのコミットへ動いたかの記録です。reset や rebase で見えなくなったコミットも、reflog から見つけて戻せます。\n\n`HEAD@{1}` は「HEAD の 1 つ前の位置」を表します。`expire` と `delete` は記録を消します (このアプリでは時刻がないので、`--expire=now` のときだけ消えます)。',
    examples: [
      ['git reflog', 'HEAD が動いた履歴を表示する'],
      ['git reset --hard HEAD@{1}', '直前の位置に戻す (reset の取り消し)'],
    ],
    related: ['reset', 'log', 'gc'],
  },
  {
    name: 'notes',
    git: true,
    category: 'inspect',
    summary: 'コミットを変えずにメモを付ける',
    usage: [
      'git notes add [-f] [-m "メモ"] [<コミット>]',
      'git notes append / edit / show / list / remove / copy / prune',
    ],
    description: 'コミットそのもの (ID) を変えずに、あとからメモを付けます。メモは `git log` と `git show` に `Notes:` として表示されます。',
    examples: [
      ['git notes add -m "レビュー済み"', '今のコミットにメモを付ける'],
      ['git notes show', '今のコミットのメモを表示する'],
    ],
    related: ['log', 'show'],
  },
  {
    name: 'cherry',
    git: true,
    category: 'inspect',
    summary: '上流に同じ変更が入ったかを調べる',
    usage: ['git cherry [-v] [<上流> [<先端>]]'],
    description: '先端 (既定は HEAD) にあって上流にないコミットを表示し、同じ変更がすでに上流に入っていれば `-`、まだなら `+` を付けます。',
    examples: [['git cherry -v main', 'main にまだ入っていないコミットを件名付きで表示する']],
    related: ['range-diff', 'cherry-pick'],
  },
  {
    name: 'range-diff',
    git: true,
    category: 'inspect',
    summary: '2 つのコミットの並びを比べる',
    usage: ['git range-diff <A>...<B>', 'git range-diff <基点> <A> <B>', 'git range-diff <範囲1> <範囲2>'],
    description: 'rebase の前と後のように、2 つのコミットの並びを対応づけて、どのコミットがどう変わったかを表示します。',
    examples: [['git range-diff main...feature', 'main と feature のコミットを対応づけて比べる']],
    related: ['rebase', 'cherry'],
  },

  // ---- ブランチとマージ ----
  {
    name: 'branch',
    git: true,
    category: 'branch',
    summary: 'ブランチの一覧・作成・削除',
    usage: [
      'git branch [-a | -r]',
      'git branch <名前> [<起点>]',
      'git branch -d <名前> / -D <名前>',
      'git branch -m [<元の名前>] <新しい名前>',
      'git branch -u <上流>',
    ],
    description:
      'ブランチは、コミットを指す名前の付いた付箋です。新しいコミットをすると、今いるブランチがそのコミットに進みます。\n\n`git branch <名前>` はブランチを作るだけで、切り替えません (作って切り替えるなら `git switch -c`)。',
    options: [
      ['-d <名前>', 'マージ済みのブランチを消す (-D なら強制的に消す)'],
      ['-m <新しい名前>', 'ブランチの名前を変える'],
      ['-a / -r', 'リモート追跡ブランチも / だけを表示する'],
      ['-u <上流>', '今のブランチの上流 (upstream) を設定する'],
    ],
    examples: [
      ['git branch', 'ブランチの一覧を表示する'],
      ['git branch feature', 'feature ブランチを作る'],
      ['git branch -d feature', 'feature ブランチを消す'],
    ],
    related: ['switch', 'merge', 'checkout'],
  },
  {
    name: 'switch',
    git: true,
    category: 'branch',
    summary: 'ブランチを切り替える',
    usage: [
      'git switch <ブランチ>',
      'git switch -c <新しいブランチ> [<起点>]',
      'git switch --detach <コミット>',
      'git switch --orphan <新しいブランチ>',
      'git switch -',
    ],
    description:
      'HEAD を別のブランチに移し、作業ディレクトリをそのブランチの内容にします。コミットしていない変更が切り替え先と衝突するときは、切り替えを拒否します (先に commit か stash します)。\n\n`-` は直前にいたブランチです。リモートにだけあるブランチ名を指定すると、追跡するブランチを作ります。',
    options: [
      ['-c <名前>', 'ブランチを作って切り替える'],
      ['--detach', 'ブランチではなくコミットに直接移る (detached HEAD)'],
      ['--orphan <名前>', '履歴のない新しいブランチに移る'],
    ],
    examples: [
      ['git switch -c feature', 'feature ブランチを作って切り替える'],
      ['git switch main', 'main に戻る'],
      ['git switch -', '直前のブランチに戻る'],
    ],
    related: ['branch', 'checkout', 'stash'],
  },
  {
    name: 'checkout',
    git: true,
    category: 'branch',
    summary: 'ブランチの切り替えとファイルの復元 (昔からのコマンド)',
    usage: ['git checkout <ブランチ | コミット>', 'git checkout -b <新しいブランチ> [<起点>]', 'git checkout [<コミット>] -- <ファイル>...'],
    description: '`switch` (ブランチの切り替え) と `restore` (ファイルの復元) を兼ねる、昔からのコマンドです。今は `switch` と `restore` を使うのがおすすめです。',
    options: [
      ['-b <名前>', 'ブランチを作って切り替える (switch -c と同じ)'],
      ['-- <ファイル>', 'ファイルを元に戻す (restore と同じ)'],
    ],
    examples: [
      ['git checkout -b feature', 'feature ブランチを作って切り替える'],
      ['git checkout -- index.html', 'index.html の変更を捨てる'],
    ],
    related: ['switch', 'restore'],
  },
  {
    name: 'merge',
    git: true,
    category: 'branch',
    summary: 'ブランチを今のブランチに取り込む',
    usage: [
      'git merge [--no-ff | --ff-only] [--no-edit] <ブランチ>...',
      'git merge [-s ours | octopus] [-X ours | theirs] <ブランチ>',
      'git merge --continue / --abort',
    ],
    description:
      '指定したブランチの変更を、今のブランチに取り込みます。今のブランチが相手の祖先なら、ブランチを前に進めるだけです (fast-forward)。両方が進んでいれば、2 つの親を持つ「マージコミット」を作ります (メッセージを書くエディタが開きます)。\n\n同じ箇所を両方で変えていると、コンフリクトで止まります。ファイルを直して `git add` し、`git commit` で完了します (`git merge --abort` で取りやめます)。',
    options: [
      ['--no-ff', 'fast-forward できてもマージコミットを作る'],
      ['--ff-only', 'fast-forward できるときだけマージする'],
      ['--no-edit', 'エディタを開かずに既定のメッセージを使う'],
      ['-X ours / theirs', 'コンフリクトする箇所を自分 / 相手の側で解決する'],
      ['--abort', 'コンフリクトしたマージを取りやめる'],
    ],
    examples: [
      ['git merge feature', 'feature を今のブランチにマージする'],
      ['git merge --no-ff --no-edit feature', '必ずマージコミットを作ってマージする'],
      ['git merge --abort', 'コンフリクトしたマージを取りやめる'],
    ],
    related: ['rebase', 'branch', 'pull'],
  },
  {
    name: 'rebase',
    git: true,
    category: 'branch',
    summary: 'コミットを別の土台の上に付け替える',
    usage: [
      'git rebase <ブランチ>',
      'git rebase -i [--autosquash] <コミット>',
      'git rebase -r [-x <コマンド>] [-X ours | theirs] <ブランチ>',
      'git rebase --continue / --skip / --abort',
    ],
    description:
      '今のブランチにだけあるコミットを、指定したブランチの先端の上に 1 つずつ作り直して並べ直します。マージコミットを作らずに、まっすぐな履歴にできます。\n\n`-i` では todo を書いたエディタが開き、各行の `pick` を `reword`・`edit`・`squash`・`fixup`・`drop` に書き換えたり、並べ替えたりして履歴を整理できます。\n\nコミットを作り直すので ID が変わります。すでに push して他の人が使っているコミットを rebase するのは避けましょう。',
    options: [
      ['-i', 'todo を編集して、コミットをまとめる・並べ替える・直す'],
      ['--autosquash', 'fixup! / squash! のコミットを対象のコミットの直後に並べる'],
      ['-r', 'マージの形を保ったまま付け替える'],
      ['-x <コマンド>', '各コミットのあとでコマンドを実行する'],
      ['--continue / --abort', 'コンフリクトを直して続ける / 取りやめる'],
    ],
    examples: [
      ['git rebase main', '今のブランチを main の先端の上に付け替える'],
      ['git rebase -i HEAD~3', '直近 3 つのコミットを整理する'],
      ['git rebase --abort', 'rebase を取りやめて元に戻す'],
    ],
    related: ['merge', 'cherry-pick', 'reflog'],
  },
  {
    name: 'cherry-pick',
    git: true,
    category: 'branch',
    summary: 'コミットの変更を今のブランチに複製する',
    usage: ['git cherry-pick [-e] [-m <親>] [-X ours | theirs] [--allow-empty] <コミット>...', 'git cherry-pick --continue / --skip / --abort'],
    description: '指定したコミットと同じ変更を、今のブランチに新しいコミットとして作ります。別のブランチの修正を 1 つだけ取り込みたいときに使います。',
    options: [
      ['-e', 'メッセージをエディタで編集する'],
      ['-m <親>', 'マージコミットを、指定した親との差分で複製する'],
    ],
    examples: [
      ['git cherry-pick C3', 'C3 の変更を今のブランチに複製する'],
      ['git cherry-pick feature', 'feature の先端のコミットを複製する'],
    ],
    related: ['rebase', 'revert'],
  },
  {
    name: 'tag',
    git: true,
    category: 'branch',
    summary: 'コミットに名前 (タグ) を付ける',
    usage: ['git tag [-a] [-m "…"] [-f] <タグ> [<コミット>]', 'git tag [-l [<パターン>]]', 'git tag -d <タグ>'],
    description: 'リリースのように、あとで参照したいコミットに名前を付けます。ブランチと違って、タグはコミットをしても動きません。`-a` (または `-m`) を付けると、メッセージ付きの注釈付きタグになります。タグは `git push --tags` で送ります。',
    options: [
      ['-a -m "…"', '注釈付きタグを作る'],
      ['-d <タグ>', 'タグを消す'],
      ['-l [<パターン>]', 'タグの一覧を表示する'],
    ],
    examples: [
      ['git tag v1.0', '今のコミットに v1.0 を付ける'],
      ['git tag -a v1.0 -m "最初のリリース"', '注釈付きタグを付ける'],
    ],
    related: ['push', 'log'],
  },

  // ---- 取り消す・戻す ----
  {
    name: 'reset',
    git: true,
    category: 'undo',
    summary: 'ブランチを別のコミットに動かす / ステージを戻す',
    usage: ['git reset [--soft | --mixed | --hard] [<コミット>]', 'git reset <ファイル>...'],
    description:
      '今のブランチの先端を、指定したコミットに動かします。`--soft` はステージと作業ディレクトリをそのままに、`--mixed` (既定) はステージも戻し、`--hard` は作業ディレクトリまで戻します。\n\n`--hard` はコミットしていない変更を消すので注意してください。外れたコミットは reflog から戻せます。',
    options: [
      ['--soft', 'ブランチだけを動かす (変更はステージに残る)'],
      ['--mixed', 'ブランチとステージを戻す (変更は作業ディレクトリに残る)'],
      ['--hard', 'ブランチ・ステージ・作業ディレクトリをすべて戻す'],
    ],
    examples: [
      ['git reset --soft HEAD~1', '直前のコミットを取り消して、変更をステージに戻す'],
      ['git reset --hard HEAD~1', '直前のコミットを変更ごと取り消す'],
      ['git reset index.html', 'index.html をステージから外す'],
    ],
    related: ['revert', 'reflog', 'restore'],
  },
  {
    name: 'revert',
    git: true,
    category: 'undo',
    summary: 'コミットを打ち消すコミットを作る',
    usage: ['git revert [--no-edit] [-m <親>] [-X ours | theirs] <コミット>...', 'git revert --continue / --skip / --abort'],
    description: '指定したコミットの変更を逆にした、新しいコミットを作ります。履歴を消さずに取り消すので、すでに push したコミットの取り消しに向いています。',
    options: [
      ['--no-edit', 'エディタを開かずに既定のメッセージを使う'],
      ['-m <親>', 'マージコミットを、指定した親を基準に打ち消す'],
    ],
    examples: [['git revert --no-edit HEAD', '今のコミットを打ち消すコミットを作る']],
    related: ['reset', 'cherry-pick'],
  },

  // ---- 履歴を書き換える ----
  {
    name: 'filter-branch',
    git: true,
    category: 'rewrite',
    summary: '履歴のすべてのコミットを作り直す',
    usage: [
      'git filter-branch [--tree-filter | --index-filter | --msg-filter | --parent-filter <コマンド>]',
      '    [--subdirectory-filter <ディレクトリ>] [--prune-empty] [--tag-name-filter cat] [-f] [-- <範囲> | --all]',
    ],
    description:
      '範囲のコミットを古いものから順に、フィルタ (このアプリのコマンド) を通して作り直します。間違ってコミットした秘密のファイルを、すべてのコミットから取り除くときなどに使います。\n\n書き換える前のブランチは `refs/original/` に残るので、2 回目からは `-f` が必要です。本物の Git では、代わりに git filter-repo を使うことが勧められています。',
    options: [
      ['--index-filter <コマンド>', '各コミットのステージでコマンドを実行する (速い)'],
      ['--tree-filter <コマンド>', '各コミットの作業ディレクトリでコマンドを実行する'],
      ['--msg-filter <コマンド>', 'メッセージを標準入力から読み、出力を新しいメッセージにする'],
      ['--subdirectory-filter <ディレクトリ>', 'そのディレクトリを一番上にした履歴にする'],
      ['--prune-empty', '変更がなくなったコミットを取り除く'],
      ['-f', 'refs/original/ の前のバックアップを上書きする'],
    ],
    examples: [
      ["git filter-branch --index-filter 'git rm --cached --ignore-unmatch secret.txt' --prune-empty", 'すべてのコミットから secret.txt を取り除く'],
      ["git filter-branch -f --msg-filter 'sed \"s/^/[app] /\"'", 'すべてのメッセージの頭に [app] を付ける'],
    ],
    related: ['replace', 'rebase', 'gc'],
  },
  {
    name: 'replace',
    git: true,
    category: 'rewrite',
    summary: 'コミットを書き換えずに、別の内容で見せる',
    usage: [
      'git replace [-f] <コミット> <置き換え先>',
      'git replace [-f] --graft <コミット> [<親>...]',
      'git replace -d <コミット>...',
      'git replace [-l [<パターン>]] [--format=short | medium | long]',
    ],
    description:
      'コミットの ID はそのままに、ほとんどのコマンドが別のコミットの内容 (や親) でそれを読むようにします。`--graft` は親だけを付け替えます (古い履歴をつなげて見せるときに使います)。\n\n`git --no-replace-objects <コマンド>` なら、置き換えを使わずに元のまま実行します。置き換えを本当の履歴にするには `git filter-branch` を使います。',
    options: [
      ['--graft <コミット> [<親>...]', '親だけを変えたコミットで置き換える'],
      ['-d <コミット>', '置き換えをやめる'],
      ['-l', '置き換えの一覧を表示する'],
    ],
    examples: [
      ['git replace --graft HEAD HEAD~2', '今のコミットの親が 2 つ前のコミットに見えるようにする'],
      ['git replace -l --format=medium', '置き換えの一覧を表示する'],
    ],
    related: ['filter-branch', 'log'],
  },

  // ---- リモート ----
  {
    name: 'clone',
    git: true,
    category: 'remote',
    summary: 'リモートからリポジトリを複製する',
    usage: ['git clone [-b <ブランチ>] [--recurse-submodules] [--sparse] <URL> [<ディレクトリ>]'],
    description:
      'リモートのリポジトリを、別の場所にまるごと複製します。このアプリでは `git clone https://example.com/branch-lab.git ../teammate` で origin を `~/teammate` に複製し、`cd ../teammate` で移ってチームメイトの立場で作業できます。',
    options: [
      ['-b <ブランチ>', 'チェックアウトするブランチを指定する'],
      ['--recurse-submodules', 'サブモジュールも (中のサブモジュールまで) 取ってくる'],
    ],
    examples: [['git clone https://example.com/branch-lab.git ../teammate', 'origin を ~/teammate に複製する']],
    related: ['cd', 'push', 'pull'],
  },
  {
    name: 'remote',
    git: true,
    category: 'remote',
    summary: 'リモートの一覧・追加・削除',
    usage: ['git remote [-v]', 'git remote add <名前> <URL>', 'git remote remove / rename / set-url / get-url'],
    description: 'リモート (共有するリポジトリ) の名前と URL を管理します。最初から `origin` があります。',
    options: [['-v', 'URL も表示する']],
    examples: [
      ['git remote -v', 'リモートの一覧を URL 付きで表示する'],
      ['git remote add upstream https://example.com/upstream.git', 'upstream というリモートを追加する'],
    ],
    related: ['push', 'fetch'],
  },
  {
    name: 'push',
    git: true,
    category: 'remote',
    summary: 'コミットをリモートに送る',
    usage: ['git push [-u] [-f] [--tags] [<リモート> [<ブランチ | タグ>]]', 'git push <リモート> --delete <名前>'],
    description:
      '手元のブランチのコミットをリモートに送り、リモートのブランチを進めます。リモートに手元にないコミットがあると拒否されます (先に `git pull` で取り込みます)。\n\n`-u` を付けると、そのリモートのブランチを上流 (upstream) として覚え、次から `git push` だけで送れます。',
    options: [
      ['-u', '上流を設定する'],
      ['-f', 'リモートの履歴を上書きする (他の人のコミットを消すおそれがあります)'],
      ['--tags', 'タグも送る'],
      ['--delete <名前>', 'リモートのブランチやタグを消す'],
      ['--no-verify', 'pre-push フックを飛ばす'],
    ],
    examples: [
      ['git push', '今のブランチを上流に送る'],
      ['git push -u origin feature', 'feature を origin に送り、上流に設定する'],
    ],
    related: ['pull', 'fetch', 'teammate'],
  },
  {
    name: 'fetch',
    git: true,
    category: 'remote',
    summary: 'リモートの新しいコミットを取ってくる',
    usage: ['git fetch [<リモート> | --all]'],
    description:
      'リモートの新しいコミットとブランチの位置を取ってきて、`origin/main` のようなリモート追跡ブランチを更新します。手元のブランチや作業ディレクトリは変えないので、安全に「リモートで何が起きたか」を確かめられます。',
    options: [['--all', 'すべてのリモートから取ってくる']],
    examples: [
      ['git fetch', 'origin の新しいコミットを取ってくる'],
      ['git log --oneline main..origin/main', '取ってきたコミットのうち、まだ取り込んでいないものを表示する'],
    ],
    related: ['pull', 'merge'],
  },
  {
    name: 'pull',
    git: true,
    category: 'remote',
    summary: 'リモートの変更を取ってきて取り込む',
    usage: ['git pull [--rebase | --no-rebase | --ff-only] [--no-edit] [<リモート> [<ブランチ>]]'],
    description:
      '`git fetch` のあとで、上流のブランチを今のブランチに取り込みます (既定はマージ、`--rebase` なら rebase)。両方にコミットがあれば、マージコミットを作るか、コンフリクトで止まります。',
    options: [
      ['--rebase', 'マージの代わりに rebase で取り込む'],
      ['--ff-only', 'fast-forward できるときだけ取り込む'],
      ['--no-edit', 'マージコミットのエディタを開かない'],
    ],
    examples: [
      ['git pull', '上流の変更を取り込む'],
      ['git pull --rebase', '上流の変更の上に自分のコミットを付け替える'],
    ],
    related: ['fetch', 'merge', 'rebase', 'push'],
  },

  // ---- 作業の退避と調査 ----
  {
    name: 'stash',
    git: true,
    category: 'save',
    summary: 'コミットしていない変更を一時的に退避する',
    usage: [
      'git stash [push [-m "…"] [-u] [-k]]',
      'git stash list / show [-p] [<stash>]',
      'git stash apply / pop [--index] [<stash>]',
      'git stash drop [<stash>] / clear / branch <名前>',
    ],
    description:
      '作業途中の変更を退避して、作業ディレクトリをきれいな状態に戻します。急ぎの修正のためにブランチを切り替えたいときに使い、終わったら `git stash pop` で戻します。',
    options: [
      ['-u', '追跡していないファイルも退避する'],
      ['-m "…"', '退避に説明を付ける'],
      ['pop', '退避した変更を戻して、退避の記録を消す'],
      ['apply', '退避した変更を戻す (記録は残す)'],
    ],
    examples: [
      ['git stash', '変更を退避する'],
      ['git stash list', '退避の一覧を表示する'],
      ['git stash pop', '最後に退避した変更を戻す'],
    ],
    related: ['switch', 'worktree'],
  },
  {
    name: 'bisect',
    git: true,
    category: 'save',
    summary: '二分探索でバグを入れたコミットを探す',
    usage: [
      'git bisect start [<悪い> [<良い>...]]',
      'git bisect good / bad / skip [<コミット>]',
      'git bisect run [!] <コマンド>',
      'git bisect reset / log',
    ],
    description:
      '「ここでは動いていた (good)」と「ここでは壊れている (bad)」のコミットを教えると、その間のコミットを半分ずつチェックアウトしていき、バグを入れた最初のコミットを見つけます。\n\n`bisect run` には、成功なら good、失敗なら bad になるコマンドを渡します (`!` を付けると逆)。',
    examples: [
      ['git bisect start HEAD C1', 'HEAD が悪く C1 が良いとして探し始める'],
      ['git bisect run grep -q OK app.txt', 'app.txt に OK があれば良いとして自動で探す'],
      ['git bisect reset', '探すのをやめて元のブランチに戻る'],
    ],
    related: ['log', 'blame'],
  },

  // ---- 作業場所を増やす・分ける ----
  {
    name: 'worktree',
    git: true,
    category: 'workspace',
    summary: '作業ディレクトリをもう 1 つ作る',
    usage: [
      'git worktree add [-b <新しいブランチ>] [--detach] <パス> [<コミット>]',
      'git worktree list',
      'git worktree remove [-f] <パス>',
      'git worktree prune',
    ],
    description:
      '同じリポジトリの別のブランチを、別のディレクトリに同時にチェックアウトします。作業中の変更をそのままに、`cd` で移って急ぎの修正ができます。コミット・ブランチ・stash は共有され、HEAD・ステージ・作業ディレクトリは worktree ごとに別々です。',
    examples: [
      ['git worktree add ../hotfix main', 'main を ~/hotfix にチェックアウトする'],
      ['git worktree list', 'worktree の一覧を表示する'],
    ],
    related: ['cd', 'stash'],
  },
  {
    name: 'submodule',
    git: true,
    category: 'workspace',
    summary: '別のリポジトリを中に取り込む',
    usage: [
      'git submodule add [-b <ブランチ>] <URL> [<パス>]',
      'git submodule [status] [--recursive]',
      'git submodule update [--init] [--remote] [--recursive]',
      'git submodule init / deinit [-f] (<パス>... | --all)',
      'git submodule foreach [--recursive] <コマンド>',
    ],
    description:
      'ライブラリのような別のリポジトリを、ディレクトリとして取り込みます。親のリポジトリは、サブモジュールの「どのコミットを使うか」だけを記録します。\n\n`cd lib` で中に入って作業し、親に戻ると `lib (new commits)` と見えるので、`git add lib` してコミットします。',
    options: [
      ['update --init', 'まだ取ってきていないサブモジュールを取ってくる'],
      ['update --remote', '取得元のブランチの最新にする'],
      ['--recursive', 'サブモジュールの中のサブモジュールにも行う'],
    ],
    examples: [
      ['git submodule add https://example.com/lib.git', 'lib をサブモジュールとして取り込む'],
      ['git submodule update --init --recursive', 'すべてのサブモジュールを取ってくる'],
    ],
    related: ['cd', 'clone'],
  },
  {
    name: 'sparse-checkout',
    git: true,
    category: 'workspace',
    summary: '作業ディレクトリに出すディレクトリを絞る',
    usage: ['git sparse-checkout init', 'git sparse-checkout set <ディレクトリ>...', 'git sparse-checkout add / list / disable / reapply'],
    description: '大きなリポジトリで、必要なディレクトリのファイルだけを作業ディレクトリに出します (cone モード)。一番上のファイルはいつも出ます。',
    examples: [
      ['git sparse-checkout set docs', 'docs ディレクトリだけを出す'],
      ['git sparse-checkout disable', 'すべてのファイルを出す'],
    ],
    related: ['clone'],
  },

  // ---- パッチとファイルでのやりとり ----
  {
    name: 'format-patch',
    git: true,
    category: 'patch',
    summary: 'コミットをパッチファイルにする',
    usage: ['git format-patch [-<数>] [-o <ディレクトリ>] [--stdout] [<起点> | <A>..<B>]'],
    description: 'コミットを 1 つずつ、メールで送れる形のパッチファイル (`0001-件名.patch`) にします。受け取った側は `git am` でコミットとして取り込めます。',
    options: [
      ['-<数>', '最新から数えたコミットの数'],
      ['-o <ディレクトリ>', '書き出す場所'],
      ['--stdout', 'ファイルにせず画面に出す'],
    ],
    examples: [['git format-patch -1', '最新のコミットをパッチファイルにする']],
    related: ['am', 'apply'],
  },
  {
    name: 'am',
    git: true,
    category: 'patch',
    summary: 'パッチをコミットとして取り込む',
    usage: ['git am [-3] <パッチ>...', 'git am --continue / --skip / --abort / --show-current-patch'],
    description: '`git format-patch` で作ったパッチを、メッセージ付きのコミットとして取り込みます。当てられないときは止まるので、直して `git am --continue` で続けます。',
    options: [['-3', '当てられなければ 3-way マージにする']],
    examples: [['git am 0001-fix.patch', '0001-fix.patch をコミットとして取り込む (ファイル名は ls で確かめる)']],
    related: ['format-patch', 'apply'],
  },
  {
    name: 'apply',
    git: true,
    category: 'patch',
    summary: 'パッチを作業ディレクトリに当てる',
    usage: ['git apply [--check] [--index | --cached] [-R] <パッチ>'],
    description: 'パッチの変更を作業ディレクトリ (やステージ) に当てます。コミットはしません。',
    options: [
      ['--check', '当てられるかを確かめるだけ'],
      ['--index', 'ステージにも当てる'],
      ['-R', '逆向きに当てる (取り消す)'],
    ],
    examples: [['git apply --check fix.patch', 'fix.patch を当てられるか確かめる']],
    related: ['am', 'format-patch'],
  },
  {
    name: 'bundle',
    git: true,
    category: 'patch',
    summary: 'コミットと参照を 1 つのファイルにまとめる',
    usage: ['git bundle create <ファイル> <リビジョン>...', 'git bundle verify / list-heads / unbundle <ファイル>'],
    description: 'ネットワークを使わずにリポジトリを渡すため、コミットとブランチを 1 つのファイルにまとめます。そのファイルから `clone`・`fetch`・`pull` できます。',
    examples: [
      ['git bundle create repo.bundle main', 'main をファイルにまとめる'],
      ['git clone repo.bundle ../offline', 'そのファイルから clone する'],
    ],
    related: ['clone', 'fetch'],
  },

  // ---- リポジトリの管理 ----
  {
    name: 'config',
    git: true,
    category: 'maintenance',
    summary: '設定を読み書きする',
    usage: ['git config <キー> [<値>]', 'git config --unset <キー>', 'git config --list'],
    description: '設定を読み書きします。このアプリで働く設定は `rerere.enabled`・`pull.rebase`・`pull.ff`・`merge.ff`・`rebase.autoSquash`・`submodule.recurse`・`gc.pruneExpire` などです。',
    examples: [
      ['git config pull.rebase true', 'pull を rebase で行うようにする'],
      ['git config --list', '設定の一覧を表示する'],
    ],
  },
  {
    name: 'rerere',
    git: true,
    category: 'maintenance',
    summary: 'コンフリクトの解決を覚えて再利用する',
    usage: ['git rerere [status | diff | remaining | forget <パス> | clear]'],
    description: '`git config rerere.enabled true` で有効にすると、コンフリクトをどう解決したかを覚え、同じコンフリクトが出たときに自動で同じように解決します。',
    examples: [['git config rerere.enabled true', 'rerere を有効にする']],
    related: ['merge', 'rebase', 'config'],
  },
  {
    name: 'gc',
    git: true,
    category: 'maintenance',
    summary: 'どこからもたどれないコミットを削除する',
    usage: ['git gc [--prune=<日時>] [--no-prune] [--aggressive] [--auto]'],
    description:
      'リポジトリを整理し、どのブランチ・タグ・reflog からもたどれないコミットを削除します。reset で外したコミットは reflog に残っているので、すぐには消えません。\n\nこのアプリのコミットには時刻がないので、`--prune=now` のときだけ削除します (既定の 2 週間では消えません)。',
    examples: [
      ['git reflog expire --expire=now --all', 'reflog を消す'],
      ['git gc --prune=now', 'たどれないコミットを今すぐ削除する'],
    ],
    related: ['prune', 'fsck', 'reflog'],
  },
  {
    name: 'prune',
    git: true,
    category: 'maintenance',
    summary: 'たどれないコミットを削除する',
    usage: ['git prune [-n] [-v] [--expire <日時>]'],
    description: '参照と reflog からたどれないコミットを削除します。`-n` なら、消すものを表示するだけです。ふだんは `git gc` が呼びます。',
    examples: [['git prune -n', '消えるコミットを表示する']],
    related: ['gc', 'fsck'],
  },
  {
    name: 'fsck',
    git: true,
    category: 'maintenance',
    summary: 'たどれないコミットや壊れたリンクを調べる',
    usage: ['git fsck [--unreachable] [--no-reflogs] [--no-dangling] [--root] [--lost-found]'],
    description: 'リポジトリを調べ、どこからもたどれない履歴の先端を `dangling commit` として表示します。消したつもりのコミットを探すのにも使えます。',
    options: [
      ['--unreachable', 'たどれないコミットをすべて表示する'],
      ['--no-reflogs', 'reflog だけから参照されているコミットも、たどれないものとして扱う'],
    ],
    examples: [['git fsck --no-reflogs', 'reflog にしか残っていないコミットを表示する']],
    related: ['gc', 'reflog'],
  },
  {
    name: 'update-ref',
    git: true,
    category: 'maintenance',
    summary: '参照を直接書き換える',
    usage: ['git update-ref [-m "理由"] <参照> <コミット> [<古い値>]', 'git update-ref -d <参照> [<古い値>]'],
    description: '`refs/heads/main` や `refs/original/refs/heads/main` のような参照を、直接書き換えたり消したりします。filter-branch のバックアップを消すときなどに使います。',
    examples: [['git update-ref -d refs/original/refs/heads/main', 'filter-branch のバックアップを消す']],
    related: ['for-each-ref', 'show-ref', 'filter-branch'],
  },
  {
    name: 'for-each-ref',
    git: true,
    category: 'maintenance',
    summary: '参照の一覧を表示する',
    usage: ['git for-each-ref [--format=<書式>] [<パターン>...]'],
    description: 'ブランチ・タグ・リモート追跡ブランチ・`refs/original/`・`refs/replace/` など、すべての参照を表示します。書式には `%(refname)`・`%(refname:short)`・`%(objectname)`・`%(subject)` が使えます。',
    examples: [['git for-each-ref refs/heads', 'ブランチの一覧を表示する']],
    related: ['show-ref', 'update-ref'],
  },
  {
    name: 'show-ref',
    git: true,
    category: 'maintenance',
    summary: '参照とコミットの一覧を表示する',
    usage: ['git show-ref [--heads] [--tags] [--head] [<パターン>...]'],
    description: '参照と、それが指すコミットの一覧を表示します。',
    examples: [['git show-ref --heads', 'ブランチの一覧を表示する']],
    related: ['for-each-ref'],
  },

  // ---- このアプリの操作 ----
  {
    name: 'help',
    git: false,
    category: 'app',
    summary: 'コマンドの一覧と説明を表示する',
    usage: ['help', 'help <コマンド>', 'git help <コマンド>', 'git <コマンド> -h'],
    description: '引数がなければコマンドの一覧を、コマンドを指定すればその説明・使い方・例を表示します。画面の「ヘルプ」ボタンからも、同じ説明を探せます。',
    examples: [
      ['help commit', 'commit の説明を表示する'],
      ['git merge -h', 'merge の説明を表示する'],
    ],
  },
  {
    name: 'teammate',
    git: false,
    category: 'app',
    summary: '他の人がリモートに push したことにする',
    usage: ['teammate [<リモート>] [<ブランチ>]'],
    description: 'チームメイトがリモート (既定は origin の main) にコミットを push したことにします。`git fetch` や `git pull` を試したり、push が拒否される状況を作ったりするのに使います。',
    examples: [
      ['teammate', 'origin の main に、他の人のコミットを 1 つ増やす'],
      ['teammate origin feature', 'origin の feature に増やす'],
    ],
    related: ['fetch', 'pull', 'push'],
  },
]

/** 名前でヘルプを探す (git rm は git-rm、先頭の git は無視する)。 */
export function findHelp(rawName: string): CommandHelp | undefined {
  const words = rawName.trim().split(/\s+/)
  const name = words[0] === 'git' && words.length > 1 ? (words[1] === 'rm' ? 'git-rm' : words[1]) : words[0]
  return COMMAND_HELP.find((entry) => entry.name === name)
}

/** 画面とターミナルに出す、コマンドの表示名 (git commit・echo など)。 */
export function displayName(entry: CommandHelp): string {
  return entry.git ? `git ${entry.name === 'git-rm' ? 'rm' : entry.name}` : entry.name
}

/** 等幅フォントでの表示幅 (日本語などの全角文字は 2)。 */
export function textWidth(text: string): number {
  let width = 0
  for (const char of text) width += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(char) ? 2 : 1
  return width
}

function pad(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - textWidth(text)))
}

/** ターミナルに出す、1 つのコマンドの詳しいヘルプ。 */
export function formatHelp(entry: CommandHelp): string {
  const plain = (text: string) => text.replace(/`([^`]+)`/g, '$1')
  const lines = [`${displayName(entry)} — ${entry.summary}`, '', '使い方:', ...entry.usage.map((line) => `  ${line}`), '']
  lines.push(...entry.description.split('\n\n').map(plain).flatMap((paragraph) => [paragraph, '']))
  if (entry.options && entry.options.length > 0) {
    const width = Math.max(...entry.options.map(([option]) => textWidth(option)))
    lines.push('オプション:', ...entry.options.map(([option, text]) => `  ${pad(option, width)}  ${text}`), '')
  }
  lines.push('例:', ...entry.examples.flatMap(([command, text]) => [`  $ ${command}`, `      ${text}`]))
  if (entry.related && entry.related.length > 0) {
    const names = entry.related.map((name) => COMMAND_HELP.find((other) => other.name === name)).filter((other) => other !== undefined)
    lines.push('', `関連: ${names.map(displayName).join(', ')}`)
  }
  return lines.join('\n')
}

/** help (引数なし) で出す、分類ごとのコマンドの一覧。 */
export function formatHelpIndex(): string {
  const lines: string[] = []
  for (const [category, label] of Object.entries(CATEGORY_LABELS) as Array<[HelpCategory, string]>) {
    const entries = COMMAND_HELP.filter((entry) => entry.category === category)
    if (entries.length === 0) continue
    const width = Math.max(...entries.map((entry) => textWidth(displayName(entry))))
    lines.push(`${label}:`, ...entries.map((entry) => `  ${pad(displayName(entry), width)}  ${entry.summary}`), '')
  }
  lines.push(
    'help <コマンド> (または git help <コマンド>・git <コマンド> -h) で、使い方と例を表示します。',
    '先頭の git は省略できます (rm だけはシェルの rm と git rm を区別します)。',
    '<コミット> の例: C1, main, v1.0, origin/main, HEAD~1, HEAD^2, HEAD@{1}',
  )
  return lines.join('\n')
}
