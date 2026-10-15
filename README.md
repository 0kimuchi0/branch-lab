# BranchLab

Git のコマンドを入力すると、ファイルとコミットグラフがアニメーションで変化する学習用の Web アプリです。
「ブランチを切る」「マージする」といった操作で、作業ディレクトリ・ステージ・ローカル・リモートの
4 つの領域がどう変わるかを、実際に手を動かして確認できます。

公開版: https://branch-lab-dun.vercel.app

## 使い方

```bash
npm install
npm run dev      # 開発サーバーを起動
npm test         # テストを実行
npm run build    # 型チェックと本番ビルド
```

画面上部のタブで 2 つのモードを切り替えられます。

- **自由に試す**: clone 直後のリポジトリで、好きなコマンドを試せます。
- **お題**: 「マージする」「コンフリクトを解消する」「コミットをまとめる」「作業を退避して急ぎの修正」「バグを入れたコミットを探す」「サブモジュールを最新にする」「チームメイトの立場で push する」など 24 問。
  目標のグラフと同じ履歴を作れたら正解です。コミット ID やメッセージが違っても、
  履歴の形と各コミットの由来 (コピーや revert を含む) が同じなら正解になります。
  クリアした記録はブラウザに保存されます。

### URL で共有する

画面上部の「共有リンクをコピー」を押すと、今の状態を再現できる URL をコピーします。
アドレスバーの URL も操作のたびに更新されるので、そのままコピーしたりリロードしたりしても同じ状態に戻ります。

URL のハッシュ (`#s=...`) には状態そのものではなく、モード・お題・入力したコマンドの列が入っています。
開いた側で同じコマンドを実行し直すので、グラフだけでなくターミナルのログも同じになります。
コマンドは 500 個まで、1 つあたり 1000 文字まで受け付けます。

## 対応コマンド

できるだけ本物の Git と同じ挙動・同じ規則にしています (例: ステージが空なら `commit` は失敗する、
`pull` で履歴が分岐していれば `--rebase` か `--no-rebase` の指定が必要、upstream がないと `push` できない)。

### ファイルの操作 (シェルのコマンド)

| コマンド | 内容 |
| --- | --- |
| `echo "内容" > ファイル` / `>>` | ファイルを上書き / 追記する |
| `touch` / `cat` / `ls` / `rm` | ファイルの作成・表示・一覧・削除 (`rm` は作業ディレクトリからだけ消す) |
| `cd <パス>` / `pwd` | worktree・clone したリポジトリ・サブモジュールの中に移動する・今いる場所を表示する |

### Git のコマンド

| コマンド | 内容 |
| --- | --- |
| `status` | 状態を表示する |
| `log [--oneline] [--graph] [--all] [-n <数>] [--format=<書式>] [<範囲>] [-- <パス>]` | 履歴を表示する (下の「log の表示」も参照) |
| `notes add [-f] [-m "…"] [<コミット>]` / `append` / `edit` / `show` / `list` / `remove` / `copy` | コミットを変えずにメモを付ける (`log` と `show` に表示される) |
| `reflog [show] [<ブランチ>]` | HEAD (やブランチ) が動いた履歴を表示する |
| `diff [--staged] [<コミット> [<コミット>]] [--stat] [--name-only] [-- <ファイル>]` | 差分を表示する (`A..B` も可) |
| `show [<コミット>]` | コミットの内容と差分を表示する |
| `blame [-L <開始>,<終了>] <ファイル> [<コミット>]` | 各行を最後に変えたコミットを表示する |
| `add <ファイル>...` / `add .` / `add -A` | 変更をステージする |
| `restore [--staged] [--source=<コミット>] <ファイル>` | 作業ディレクトリ (または ステージ) を戻す |
| `rm [--cached] [-f] <ファイル>` | ステージと作業ディレクトリから消す |
| `commit [-m "…"] [-a] [--allow-empty] [--amend] [--no-edit]` | ステージの内容でコミットする (`-m` がなければエディタが開く) |
| `branch [<名前> [<起点>]]` / `-d` / `-D` / `-m` / `-u` | ブランチの一覧・作成・削除・名前の変更・upstream の設定 |
| `switch <名前>` / `-c <名前> [<起点>]` / `--detach <コミット>` / `switch -` | ブランチを切り替える (リモートにだけあるブランチは追跡ブランチを作る、`-` は直前のブランチ) |
| `checkout <名前\|コミット>` / `-b <名前>` / `-- <ファイル>` | switch と restore を兼ねる昔からのコマンド |
| `merge [--no-ff] [--ff-only] [--no-edit] [-s <ストラテジー>] [-X ours\|theirs] <ブランチ>...` | fast-forward またはマージコミットでマージする (2 つ以上なら octopus、`-s ours` は履歴だけをマージ) |
| `rebase [-i] [-r] [-x <コマンド>] [-X ours\|theirs] <ブランチ>` | 現在のブランチのコミットを付け替える (`-i` は todo をエディタで編集する、`-r` / `--rebase-merges` はマージの形を保つ) |
| `cherry-pick [-e] [-m <親>] [-X …] [--allow-empty] <コミット>...` | コミットの変更を複製する (`-m` でマージコミットも) |
| `revert [--no-edit] [-m <親>] [-X …] <コミット>...` | コミットの変更を打ち消すコミットを作る |
| `tag [-a] [-m "…"] [-f] <タグ> [<コミット>]` / `tag -l [<パターン>]` / `tag -d <タグ>` | タグを付ける・一覧を見る・消す |
| `reset [--soft \| --mixed \| --hard] [<コミット>]` / `reset <ファイル>` | ブランチを移動する / ステージを戻す |
| `stash [push] [-m "…"] [-u] [-k]` / `stash list` / `stash show [-p]` | 変更を退避する・一覧を見る |
| `stash apply [--index]` / `stash pop [--index]` / `stash drop` / `stash clear` / `stash branch <名前>` | 退避した変更を戻す・消す |
| `bisect start [<bad> [<good>...]]` / `good` / `bad` / `skip` / `reset` / `log` / `run <コマンド>` | 二分探索でバグを入れたコミットを探す (`new` / `old` も可) |
| `config <キー> [<値>]` / `config --unset <キー>` / `config --list` | 設定を読み書きする (`rerere.enabled`・`rerere.autoUpdate`・`pull.rebase`・`pull.ff`・`merge.ff` が働く) |
| `rerere` / `rerere status` / `diff` / `remaining` / `forget <パス>` / `clear` | コンフリクトの解決を記録し、同じコンフリクトで再利用する (`rerere.enabled` のとき) |
| `clone [-b <ブランチ>] [--recurse-submodules] [--sparse] <URL> [<ディレクトリ>]` | リモートの URL から別のリポジトリを作る (`cd` で中に入る) |
| `sparse-checkout init` / `set <ディレクトリ>...` / `add` / `list` / `disable` | 作業ディレクトリに出すディレクトリを絞る (cone モード) |
| `worktree add [-b <ブランチ>] [--detach] <パス> [<コミット>]` / `worktree list` / `worktree remove [-f] <パス>` | 作業ディレクトリをもう 1 つ作る (`cd` で移る) |
| `submodule add [-b <ブランチ>] <URL> [<パス>]` / `submodule [status]` / `init` / `update [--init] [--remote]` / `deinit` / `foreach <コマンド>` | サブモジュールを取り込む・記録したコミットにする (`cd` で中に入る) |
| `remote [-v]` / `remote add <名前> <URL>` / `remove` / `rename` / `set-url` / `get-url` | リモートの一覧・追加・削除・名前の変更 |
| `push [-u] [-f] [--tags] [<リモート> [<ブランチ\|タグ>]]` / `push <リモート> --delete <名前>` | リモートに送る・リモートの参照を消す |
| `fetch [<リモート> \| --all]` / `pull [--rebase \| --no-rebase \| --ff-only] [--no-edit] [<リモート> [<ブランチ>]]` | リモートから取り込む (タグも取り込む) |

### エディタ

本物の Git と同じく、`-m` を付けない `commit`、マージコミットを作る `merge` / `pull`、`revert`、`--amend`、
`--continue` ではエディタが開きます (`--no-edit` で開かずに既定のメッセージを使えます)。
`#` で始まる行は無視され、メッセージを空にするとコミットを中止します。
エディタが開いている間は、保存して閉じるまでほかのコマンドは実行できません。

`git rebase -i <コミット>` では todo のエディタが開きます。各行の `pick` を `reword` (メッセージを編集)・
`edit` (修正のために止まる)・`squash` / `fixup` (直前のコミットにまとめる)・`drop` (取り除く) に書き換えたり、
行を並べ替えたりできます。`edit` で止まったら `git commit --amend` で直して `git rebase --continue` で続けます。
`exec <コマンド>` の行はそのコマンド (シェル風のコマンドも git のコマンドも) を実行し、失敗したらそこで止まります。
`break` の行ではそこで止まります。`git rebase -x <コマンド>` は各コミットの後ろに `exec` を入れます。
`git rebase -r` (`--rebase-merges`) の todo には、`label <名前>` (今の HEAD に名前を付ける)・`reset <名前>`
(その位置に戻る)・`merge -C <元のマージ> <名前>` (名前の位置をマージする) の行が入り、マージの形のまま作り直します。

`merge` / `rebase` / `cherry-pick` / `revert` がコンフリクトで止まったら、ファイルを直して `git add` し、
`--continue` で続けます (`--abort` で中止、`--skip` で飛ばせます。merge は `git commit` で完了します)。
マージは行単位の 3-way マージで、本物と同じコンフリクトマーカーが入ります。

`<コミット>` には `C1` のようなコミット ID、ブランチ名、タグ名、`origin/main` のようなリモート追跡ブランチ、`HEAD` が使えます。
末尾に `~n` (第 1 親を n 回たどる) や `^n` (n 番目の親) を付けられます (例: `HEAD~2`, `main^`, `HEAD^2`)。
`HEAD@{n}` / `main@{n}` / `@{n}` は reflog の n 個前、`@{-1}` は直前にいたブランチです
(例: `git reset --hard HEAD@{1}` で直前の reset を取り消せます)。

先頭の `git` は省略できます (ただし `rm` はシェルの `rm`、`git rm` は Git の `rm` として区別します)。

`log` は次のオプションに対応しています。`--graph` は本物と同じく topo-order で並べ、`*`・`|\`・`|/`・octopus の `*-.` で線を描きます。

- 範囲: `A..B`・`A...B`・`^A`、`--all`・`--branches`・`--tags`・`--remotes`
- 絞り込み: `-n <数>` / `-<数>`、`--first-parent`、`--merges` / `--no-merges`、`--grep=<パターン>` (`--invert-grep`)、`-- <パス>`
- 表示: `--oneline`、`--pretty=oneline|short|medium|full`、`--format=<書式>` (`%h` `%H` `%s` `%b` `%B` `%d` `%D` `%p` `%P` `%N` `%n`)、
  `-p`・`--stat`・`--name-only`、`--reverse`、`--no-decorate`、`--no-notes`

`git clone https://example.com/branch-lab.git ../teammate` は、origin を `~/teammate` に clone します。
`cd ../teammate` で移ってコミットして push すると、元のリポジトリ (`cd ../branch-lab`) から fetch / pull できます。
`--recurse-submodules` を付けるとサブモジュールも取得し、`switch` / `checkout` / `pull` / `reset` に付ける
(または `git config submodule.recurse true`) と、終わったあとでサブモジュールを記録したコミットにします。

マージのストラテジーは `ort` (既定。`recursive`・`resolve` も同じ扱い)・`ours`・`octopus` です。
`-X ours` / `-X theirs` は、両方が変えた箇所をコンフリクトにせずにその側で解決します
(rebase では ours が付け替え先、theirs が付け替えるコミットの側です)。
octopus マージでコンフリクトが出た場合は、本物と同じく中止して何も変えません。

`git worktree add ../hotfix` は hotfix ブランチを作って `~/hotfix` に worktree を作ります。
`cd ../hotfix` で移ると、HEAD・ステージ・作業ディレクトリ・途中の操作は worktree ごとに別々で、
コミット・ブランチ・stash・設定は共有されます。ほかの worktree でチェックアウトしているブランチには切り替えられません。

`git submodule add https://example.com/lib.git` は、その URL の模擬のリポジトリを `lib` に clone します。
`cd lib` で中に入るとサブモジュールのリポジトリでコマンドが動き (コミット ID は `L1` のように頭文字が変わります)、
`cd ..` で戻ると親からは `lib (new commits)` と見えるので、`git add lib` してコミットします。

### このアプリ独自のコマンド

| コマンド | 内容 |
| --- | --- |
| `teammate [<リモート>] [<ブランチ>]` | 他の人がリモート (既定は origin の main) にコミットを push したことにする |
| `help` | コマンド一覧を表示する |

### 本物の Git と違うところ

- コミット ID はハッシュではなく `C1`, `C2`, … の連番です。
- エディタは画面上の簡易エディタです。保存は `:wq "内容"` というコマンドとしてログと共有 URL に残ります。
- リモートはブラウザの中で模擬しています。URL には接続せず、`remote add` で追加したリモートは空のリポジトリから始まります
  (`remote remove` するとそのリモートの中身も消えます)。
- サブモジュールの取得元も模擬で、初めて使う URL なら README.md だけのリポジトリになります。
  サブモジュールの中のサブモジュール、サブモジュールや clone したリポジトリの中の worktree は未対応です。
- `clone` できるのは、リモートとサブモジュールの URL だけです。clone 先は worktree の外 (`~/teammate` など) にします。
- ファイルシステムは模擬で、`cd` で移動できるのは worktree・clone したリポジトリ・サブモジュールだけです。パスは `~/branch-lab` のような形です。
- `log` に作者と日時はありません (`--format` の `%an` や `%ad` などは使えません)。`--graph` の線は、
  よくある形では本物と同じですが、複雑に交差する場合は本物と少し違うことがあります。
- `notes` は本物ではコミット (refs/notes/commits) として保存されますが、ここでは別に持ち、push もしません。
  `notes list` はメモの付いたコミットの ID だけを表示します。
- `sparse-checkout` は cone モードだけです。
- `config` は 1 つだけで、`--global` と `--local` を区別しません。
- `rerere` は、本物はコンフリクトの箇所 (hunk) ごとに解決を覚えますが、ここではファイル全体の内容で覚えます。
- `blame` には作者と日時がなく、コミット ID と件名を表示します。`bisect run` のコマンドはこのアプリのコマンドで、成功なら good、失敗なら bad です
  (先頭に `!` を付けると逆になります)。
- `stash` は本物ではコミットとして保存されますが、ここでは別に持ち、グラフには描きません。
- `diff` には blob の `index` 行がなく、コンフリクト中のファイルは結合差分の代わりに `* Unmerged path` と表示します。
- `subtree` ストラテジー、ファイルを指定した `stash push`、タグへの署名などは未対応です。
- reflog は HEAD とローカルブランチだけで、期限切れの削除 (`reflog expire`) はありません。

## 設計

UI と Git の仕組みを分離しています。

```
src/
  git/
    tree.ts        ファイルのスナップショットと、行単位の 3-way マージ (diff3)
    diff.ts        unified 形式の差分
    model.ts       Git の内部モデル (コミット・ブランチ・HEAD・ステージ・作業ディレクトリ・リモート・エディタ)
    history.ts     merge (octopus・ストラテジー) / cherry-pick / revert / rebase (-i, -r) と --continue / --abort / --skip、エディタを閉じたあとの続き
    inspect.ts     diff / show / blame
    bisect.ts      bisect
    stash.ts       stash
    tag.ts         tag
    remote.ts      remote / push / fetch / pull と teammate
    config.ts      config
    rerere.ts      rerere
    worktree.ts    worktree と cd
    submodule.ts   submodule と、入れ子のリポジトリ (clone・サブモジュール) と模擬のサーバーの同期
    clone.ts       clone
    log.ts         log (範囲・絞り込み・書式・--graph)
    notes.ts       notes
    sparse.ts      sparse-checkout
    commands.ts    入力文字列の解析と実行。規則違反は例外にせず結果として返す
  graph/
    layout.ts      コミットグラフの座標を計算する純粋関数 (ローカル・リモートの両方)
  view/
    workspace.ts   作業ディレクトリとステージに表示するファイル一覧を作る純粋関数
  puzzles/
    puzzles.ts     お題の一覧と、初期状態・目標の作成
    match.ts       履歴の形と由来で目標と比べる正解判定
  share/
    share.ts       共有 URL の作成・読み込みと、コマンドの再実行による復元
  components/      GraphView, FileArea, Workspace (4 領域と stash), EditorPanel, PuzzlePanel, ShareButton, Terminal
  App.tsx          モード・Repo・実行ログの状態管理
```

- `Repo` は不変データで、すべての操作が新しい `Repo` を返します。そのためテストしやすく、
  お題の目標も「初期状態に解答例のコマンドを実行した結果」として作れます。
- レイアウトや表示用の一覧も純粋関数なので、描画せずにテストできます。

## 公開

Vercel のプロジェクト `branch-lab` が GitHub のリポジトリとつながっていて、main に push すると本番
(https://branch-lab-dun.vercel.app) に、プルリクエストではプレビューにデプロイされます。
Vite として自動で認識されるので、設定ファイルはありません (ビルドは `npm run build`、出力先は `dist`)。
共有リンクは URL のハッシュを使うため、サーバー側のリダイレクト設定も不要です。

## 今後の拡張案

- `commit --fixup` と `rebase --autosquash`
- `format-patch` / `am` (パッチでのやりとり)
- `range-diff`、`cherry`
