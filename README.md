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

画面上部のタブで 3 つのモードを切り替えられます。

- **自由に試す**: clone 直後のリポジトリで、好きなコマンドを試せます。
- **チュートリアル**: はじめての人向けに、説明を読みながら 1 ステップずつコマンドを試すレッスンです。
  「はじめてのコミット」「変更を確かめる」「ブランチで作業を分ける」「ブランチをマージする」「コンフリクトを解消する」
  「リモートと共同作業する」「取り消してやり直す」「作業を一時的に退避する」の 8 レッスン。
  課題のコマンドを実行すると「できました！」と表示され、次のステップに進めます (「入力欄に入れる」でコマンドを入力欄に入れられます)。
  終えたレッスンはブラウザに記録されます。
- **お題**: 「マージする」「コンフリクトを解消する」「コミットをまとめる」「作業を退避して急ぎの修正」「バグを入れたコミットを探す」「サブモジュールを最新にする」「チームメイトの立場で push する」「メールで届いたパッチを取り込む」「コミットのルールをフックで守る」「履歴から秘密のファイルを消す」「消したコミットを本当に消す」「一部だけステージする」「付け替え先を変える」など 37 問。
  目標のグラフと同じ履歴を作れたら正解です。コミット ID やメッセージが違っても、
  履歴の形と各コミットの由来 (コピーや revert を含む) が同じなら正解になります。
  クリアした記録はブラウザに保存されます。

### コマンドのヘルプ

画面上部の「ヘルプ」で、コマンドの一覧と、それぞれの使い方・よく使うオプション・例を見られます。
コマンド名や「取り消す」のような、やりたいことで探せます。例の「入力欄に入れる」で、そのコマンドをターミナルに入れます。

ターミナルでも、`help` でコマンドの一覧を、`help <コマンド>`・`git help <コマンド>`・`git <コマンド> -h` で同じ説明を表示します。

### URL で共有する

画面上部の「共有リンクをコピー」を押すと、今の状態を再現できる URL をコピーします。
アドレスバーの URL も操作のたびに更新されるので、そのままコピーしたりリロードしたりしても同じ状態に戻ります。

URL のハッシュ (`#s=...`) には状態そのものではなく、モード・お題 (チュートリアルならレッスンとステップ)・入力したコマンドの列が入っています。
開いた側で同じコマンドを実行し直すので、グラフだけでなくターミナルのログも同じになります。
コマンドは 500 個まで、1 つあたり 1000 文字まで受け付けます。

## 対応コマンド

できるだけ本物の Git と同じ挙動・同じ規則にしています (例: ステージが空なら `commit` は失敗する、
`pull` で履歴が分岐していれば `--rebase` か `--no-rebase` の指定が必要、upstream がないと `push` できない)。

### ファイルの操作 (シェルのコマンド)

| コマンド | 内容 |
| --- | --- |
| `echo "内容" > ファイル` / `>>` | ファイルを上書き / 追記する |
| `touch` / `cat` / `ls` / `rm [-r] [-f]` / `mv <元> <先>` / `mkdir` | ファイルの作成・表示・一覧・削除・移動 (`rm` は作業ディレクトリからだけ消す) |
| `grep [-q] [-v] [-i] [-c] [-E] <パターン> <ファイル>...` | 一致する行を表示する (なければ失敗する。フックで使う) |
| `sed [-n] [-E] [-i] [-e <スクリプト>] <ファイル>...` | 行ごとに書き換える (`s/前/後/g`・`/パターン/d`・`<行>d`・`p`) |
| `true` / `false` | 成功する / 失敗するだけ (フックやフィルタで使う) |
| `chmod +x <ファイル>` | `.git/hooks` のフックを実行できるようにする |
| `cd <パス>` / `pwd` | worktree・clone したリポジトリ・サブモジュールの中に移動する・今いる場所を表示する |

### Git のコマンド

| コマンド | 内容 |
| --- | --- |
| `status [--ignored]` | 状態を表示する (`.gitignore` で無視しているファイルは `--ignored` のときだけ出す) |
| `log [--oneline] [--graph] [--all] [-n <数>] [--format=<書式>] [<範囲>] [-- <パス>]` | 履歴を表示する (下の「log の表示」も参照) |
| `shortlog [-s] [-n] [<範囲>]` | 作者ごとにコミットの件名をまとめる |
| `describe [--tags] [--all] [--always] [--long] [--abbrev=0] [--dirty] [<コミット>...]` | 近いタグからの位置で名前を付ける (`v1.0-2-gC5`) |
| `grep [-i] [-n] [-c] [-l] [-v] [-w] [-F] [--cached] (-e <パターン> \| <パターン>) [<コミット>] [-- <パス>]` | 追跡しているファイルから探す (`git grep`) |
| `notes add [-f] [-m "…"] [<コミット>]` / `append` / `edit` / `show` / `list` / `remove` / `copy` | コミットを変えずにメモを付ける (`log` と `show` に表示される) |
| `reflog [show] [<ブランチ>]` | HEAD (やブランチ) が動いた履歴を表示する |
| `reflog expire [--expire=<日時>] [--expire-unreachable=<日時>] [--all \| <参照>...]` / `reflog delete <参照>@{<n>}` | reflog のエントリを消す |
| `gc [--prune=<日時>] [--no-prune] [--aggressive] [--auto]` / `prune [-n] [-v] [--expire <日時>]` | どこからもたどれないコミットを削除する (下の「gc / fsck / prune」も参照) |
| `fsck [--unreachable] [--no-reflogs] [--no-dangling] [--root] [--lost-found]` | 壊れたリンクと、たどれないコミット (dangling / unreachable) を調べる |
| `diff [--staged] [<コミット> [<コミット>]] [--stat] [--name-only] [-- <ファイル>]` | 差分を表示する (`A..B` も可) |
| `show [<コミット>]` | コミットの内容と差分を表示する |
| `blame [-L <開始>,<終了>] <ファイル> [<コミット>]` | 各行を最後に変えたコミットを表示する |
| `add <ファイル>...` / `add .` / `add -A` / `add -f <ファイル>` | 変更をステージする (`.gitignore` で無視しているファイルは `-f` のときだけ) |
| `add -p` / `commit -p` / `stash -p` / `restore -p [--staged]` / `reset -p` / `checkout -p` `[<ファイル>...]` | 変更をハンクごとに見せて、ステージする・捨てる・ステージを取り消すかを 1 つずつ尋ねる (下の「-p の質問」も参照) |
| `restore [--staged] [--source=<コミット>] <ファイル>` | 作業ディレクトリ (または ステージ) を戻す |
| `rm [--cached] [-f] [-r] [--ignore-unmatch] [-q] <ファイル>` | ステージと作業ディレクトリから消す |
| `mv [-f] [-k] [-n] [-v] <元>... <先>` | 追跡しているファイルの名前を変える・移して、そのことをステージする (`git mv`) |
| `clean (-n \| -f) [-d] [-x \| -X] [<パス>...]` | 追跡していないファイルを消す (`-d` でディレクトリも、`-x` で無視しているファイルも) |
| `check-ignore [-v] <パス>...` | `.gitignore` で無視しているかと、決めたパターンを表示する |
| `commit [-m "…"] [-a] [--allow-empty] [--amend] [--no-edit]` | ステージの内容でコミットする (`-m` がなければエディタが開く) |
| `commit --fixup=<コミット>` / `--squash=<コミット>` | `rebase --autosquash` でまとめるための `fixup!` / `squash!` のコミットを作る |
| `branch [<名前> [<起点>]]` / `-d` / `-D` / `-m` / `-u` | ブランチの一覧・作成・削除・名前の変更・upstream の設定 |
| `branch [-a \| -r] [-v \| -vv] [--merged \| --no-merged \| --contains \| --no-contains [<コミット>]] [--points-at <コミット>] [--list <パターン>...]` | ブランチの一覧を、マージ済みか・コミットを含むかで絞り込む (コミットを省くと HEAD) |
| `switch --orphan <名前>` / `checkout --orphan <名前>` | 履歴のない新しいブランチに移る (最初のコミットが root commit になる) |
| `switch <名前>` / `-c <名前> [<起点>]` / `--detach <コミット>` / `switch -` | ブランチを切り替える (リモートにだけあるブランチは追跡ブランチを作る、`-` は直前のブランチ) |
| `checkout <名前\|コミット>` / `-b <名前>` / `-- <ファイル>` | switch と restore を兼ねる昔からのコマンド |
| `merge [--no-ff] [--ff-only] [--no-edit] [-s <ストラテジー>] [-X ours\|theirs] <ブランチ>...` | fast-forward またはマージコミットでマージする (2 つ以上なら octopus、`-s ours` は履歴だけをマージ) |
| `rebase [-i] [-r] [-x <コマンド>] [-X ours\|theirs] [--autosquash] [--onto <新しい土台>] [<上流> [<ブランチ>]]` | 現在のブランチのコミットを付け替える (`-i` は todo をエディタで編集する、`-r` / `--rebase-merges` はマージの形を保つ、`--autosquash` は `fixup!` / `squash!` のコミットをまとめる、`--onto` は `<上流>..HEAD` を新しい土台の上に付け替える。`<上流>` を省くと upstream) |
| `cherry-pick [-e] [-m <親>] [-X …] [--allow-empty] <コミット>...` | コミットの変更を複製する (`-m` でマージコミットも) |
| `revert [--no-edit] [-m <親>] [-X …] <コミット>...` | コミットの変更を打ち消すコミットを作る |
| `tag [-a] [-m "…"] [-f] <タグ> [<コミット>]` / `tag -l [<パターン>...] [-n[<数>]]` / `tag -d <タグ>` | タグを付ける・一覧を見る (`-n` で注釈も)・消す |
| `tag [--contains \| --no-contains \| --merged \| --no-merged [<コミット>]] [--points-at <コミット>]` | タグの一覧を、コミットを含むか・たどれるかで絞り込む |
| `reset [--soft \| --mixed \| --hard] [<コミット>]` / `reset <ファイル>` | ブランチを移動する / ステージを戻す |
| `stash [push] [-m "…"] [-u \| -a] [-k]` / `stash -p` / `stash list` / `stash show [-p]` | 変更を退避する・一覧を見る (`-a` は無視しているファイルも) |
| `stash apply [--index]` / `stash pop [--index]` / `stash drop` / `stash clear` / `stash branch <名前>` | 退避した変更を戻す・消す |
| `bisect start [<bad> [<good>...]]` / `good` / `bad` / `skip` / `reset` / `log` / `run <コマンド>` | 二分探索でバグを入れたコミットを探す (`new` / `old` も可) |
| `config <キー> [<値>]` / `config --unset <キー>` / `config --list` | 設定を読み書きする (`rerere.enabled`・`rerere.autoUpdate`・`pull.rebase`・`pull.ff`・`merge.ff` が働く) |
| `rerere` / `rerere status` / `diff` / `remaining` / `forget <パス>` / `clear` | コンフリクトの解決を記録し、同じコンフリクトで再利用する (`rerere.enabled` のとき) |
| `bundle create <ファイル> <リビジョン>...` / `bundle verify` / `list-heads` / `unbundle <ファイル>` | コミットと参照を 1 つのファイルにまとめる (そのファイルから clone・fetch・pull できる) |
| `format-patch [-<数>] [-o <ディレクトリ>] [--stdout] [<起点> \| <A>..<B>]` | コミットをパッチファイル (`0001-件名.patch`) にする |
| `apply [--check] [--index \| --cached] [-R] <パッチ>` | パッチを作業ディレクトリ (やステージ) に当てる |
| `am [-3] <パッチ>...` / `am --continue` / `--skip` / `--abort` / `--show-current-patch` | パッチをコミットとして取り込む |
| `cherry [-v] [<上流> [<先端>]]` | 上流に同じ変更が入ったコミットに `-`、まだのコミットに `+` を付ける |
| `range-diff <A>...<B>` / `<基点> <A> <B>` / `<範囲1> <範囲2>` | 2 つのコミットの並び (rebase の前後など) を対応づけて違いを見る |
| `clone [-b <ブランチ>] [--recurse-submodules] [--sparse] <URL> [<ディレクトリ>]` | リモートの URL から別のリポジトリを作る (`cd` で中に入る) |
| `sparse-checkout init` / `set <ディレクトリ>...` / `add` / `list` / `disable` | 作業ディレクトリに出すディレクトリを絞る (cone モード) |
| `worktree add [-b <ブランチ>] [--detach] <パス> [<コミット>]` / `worktree list` / `worktree remove [-f] <パス>` | 作業ディレクトリをもう 1 つ作る (`cd` で移る) |
| `submodule add [-b <ブランチ>] <URL> [<パス>]` / `submodule [status]` / `init` / `update [--init] [--remote]` / `deinit` / `foreach <コマンド>` | サブモジュールを取り込む・記録したコミットにする (`cd` で中に入る。`status`・`update`・`foreach` は `--recursive` でサブモジュールの中のサブモジュールにも行う) |
| `remote [-v]` / `remote add <名前> <URL>` / `remove` / `rename` / `set-url` / `get-url` | リモートの一覧・追加・削除・名前の変更 |
| `push [-u] [-f \| --force-with-lease[=<ブランチ>[:<コミット>]]] [--tags] [<リモート> [<ブランチ\|タグ>]]` / `push <リモート> --delete <名前>` | リモートに送る・リモートの参照を消す (`--force-with-lease` は、リモートが最後に fetch したときのままなら上書きする) |
| `fetch [<リモート> \| --all]` / `pull [--rebase \| --no-rebase \| --ff-only] [--no-edit] [<リモート> [<ブランチ>]]` | リモートから取り込む (タグも取り込む) |
| `replace [-f] <コミット> <置き換え先>` / `replace [-f] --graft <コミット> [<親>...]` / `replace -d <コミット>...` / `replace [-l [<パターン>]] [--format=…]` | コミットを書き換えずに、別のコミットの内容 (や親) で見せる (`git --no-replace-objects <コマンド>` なら元のまま) |
| `filter-branch [--tree-filter \| --index-filter \| --msg-filter \| --parent-filter <コマンド>] [--subdirectory-filter <ディレクトリ>] [--prune-empty] [--tag-name-filter cat] [-f] [-- <範囲> \| --all]` | 履歴のすべてのコミットをフィルタで作り直す (下の「filter-branch」も参照) |
| `update-ref [-m "…"] [-d] <参照> [<コミット> [<古い値>]]` / `for-each-ref [--format=…] [<パターン>...]` / `show-ref [--heads] [--tags]` | 参照 (`refs/heads/`・`refs/original/`・`refs/replace/` など) を直接扱う |

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

シェルと同じく、`&&` (成功したら次を実行)・`||` (失敗したら次を実行)・`;` でコマンドを続けて書けます。
ダブルクォートの中では `\"` などのエスケープが使えます。

`echo` 以外のコマンドでも、`> ファイル` / `>> ファイル` で出力をファイルに書けます (例: `git format-patch -2 --stdout > all.patch`)。

先頭の `git` は省略できます (ただし `rm` はシェルの `rm`、`git rm` は Git の `rm` として区別します)。

`log` は次のオプションに対応しています。`--graph` は本物と同じく topo-order で並べ、`*`・`|\`・`|/`・octopus の `*-.` で線を描きます。

- 範囲: `A..B`・`A...B`・`^A`、`--all`・`--branches`・`--tags`・`--remotes`
- 絞り込み: `-n <数>` / `-<数>`、`--first-parent`、`--merges` / `--no-merges`、`--grep=<パターン>` (`--invert-grep`)、`--author=<パターン>`、`-i`、
  `-S<文字列>` (`--pickaxe-regex`) / `-G<正規表現>` (変更の中身で探す。`-p` では一致したファイルの差分だけを出し、`--pickaxe-all` ならすべて)、`-- <パス>`
- 表示: `--oneline`、`--pretty=oneline|short|medium|full`、`--format=<書式>` (`%h` `%H` `%s` `%an` `%b` `%B` `%d` `%D` `%p` `%P` `%N` `%n`)、
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

### フック

`.git/hooks/<名前>` にこのアプリのコマンドを 1 行ずつ書き、`chmod +x` で実行できるようにすると、Git と同じ場面で実行されます。
実行できるようにしていないフックは、本物と同じく警告を出して無視します。

```
echo 'grep -qE "#[0-9]+" "$1" || exit 1' > .git/hooks/commit-msg
chmod +x .git/hooks/commit-msg
```

| フック | 実行する場面 | 引数 |
| --- | --- | --- |
| `pre-commit` | `git commit` の前 (失敗したらコミットしない) | なし |
| `commit-msg` | メッセージを決めたあと (失敗したらコミットしない。ファイルを書き換えるとメッセージが変わる) | `$1` = `.git/COMMIT_EDITMSG` |
| `post-commit` | コミットしたあと | なし |
| `pre-push` | `git push` の前 (失敗したら push しない) | `$1` = リモート名、`$2` = URL |
| `pre-rebase` | `git rebase` の前 (失敗したら rebase しない) | `$1` = 上流 |
| `post-checkout` | `switch` / `checkout` で HEAD が動いたあと | `$1` = 前の HEAD、`$2` = 新しい HEAD、`$3` = 1 |
| `post-merge` | `merge` / `pull` で HEAD が動いたあと | `$1` = 0 |

`commit` / `push` / `rebase` は `--no-verify` でフックを飛ばせます。フックは sh と同じく、最後のコマンドの結果で成否が決まり、
`exit <数>` と `set -e` が使えます。

コミットの作者は `git config user.name` で決まります (設定していなければ「あなた」、`teammate` のコミットは「チームメイト」)。
本物と同じく、`cherry-pick`・`rebase`・`commit --amend` で作り直したコミットは元の作者のままです。

### -p の質問

`git add -p` などは、変更をハンク (まとまり) ごとに表示して尋ねます。答えは本物と同じ文字で、ターミナルに入力するか、画面のボタンで答えます
(答え終わるまで、ほかのコマンドは答えとして読みます)。

| 答え | 意味 |
| --- | --- |
| `y` / `n` | このハンクをする / しない |
| `a` / `d` | このハンクと、このファイルの残りのハンクをすべてする / しない |
| `s` | このハンクを小さなハンクに分ける (近くにある変更どうしをまとめたハンクのとき) |
| `e` | このハンクをエディタで手で直す (`add -p` と `commit -p` のとき)。`-` の行を残すなら先頭を空白に、`+` の行を足さないならその行を消す |
| `q` | 終わる (残りのハンクはすべて「しない」) |
| `?` | ヘルプを表示する |

`add -p` は y のハンクをステージし、`restore -p` は y のハンクを作業ディレクトリから捨て、`restore -p --staged` と `reset -p` は y のハンクのステージを取り消します。
`commit -p` は y のハンクをステージしてからコミットし、`stash -p` は y のハンクだけを退避して、ほかの変更は作業ディレクトリに残します。
追跡していないファイルは尋ねません。

### .gitignore

作業ディレクトリの `.gitignore` (一番上と、各ディレクトリの中) で、追跡していないファイルを無視します。書き方は本物と同じで、
`#` はコメント、`!` で打ち消し、末尾の `/` はディレクトリだけ、途中に `/` があれば .gitignore の場所からのパス、`*`・`?`・`[ ]`・`**` が使えます。
無視したファイルは `status`・`add .`・`stash -u`・`clean` (`-x` がなければ)・`git grep` の対象になりません。追跡しているファイルは無視されません。

### gc / fsck / prune

`gc`・`prune`・`fsck` は、ブランチ・タグ・リモート追跡ブランチ・`refs/original/`・`refs/replace/`・各 worktree の HEAD・stash・
途中の操作と、reflog の指すコミットからたどれるコミットを残します (`git notes` のメモは、コミットを残す理由になりません)。

- reset や rebase で外したコミットは reflog に残るので、`git gc` では消えません。本当に消すには
  `git reflog expire --expire=now --all` で reflog を消してから `git gc --prune=now` を実行します。
- このアプリのコミットには時刻がないので、期限 (`--prune=<日時>`・`--expire=<日時>`・`gc.pruneExpire` など) は
  `now` (と `all`) のときだけ働きます。既定の 2 週間や 90 日では、何も消えません。
- `fsck` は、たどれない履歴の先端を `dangling commit`、`--unreachable` ならたどれないコミットすべてを表示します。

### filter-branch

フィルタはシェルスクリプトではなく、このアプリのコマンドです (`&&`・`||`・`;` と、`$GIT_COMMIT` が使えます)。
書き換えたブランチの元の位置は `refs/original/refs/heads/<ブランチ>` に残るので、2 回目からは `-f` が必要です
(`git update-ref -d refs/original/refs/heads/main` で消せます)。

| フィルタ | 実行する場所 | 結果 |
| --- | --- | --- |
| `--tree-filter` | そのコミットの内容を出した作業ディレクトリ | 作業ディレクトリのファイルすべて (`rm -f secret.txt` など) |
| `--index-filter` | そのコミットの内容のステージ | ステージ (`git rm --cached --ignore-unmatch secret.txt` など) |
| `--msg-filter` | 標準入力にメッセージ | 出力が新しいメッセージ (`sed "s/^/[app] /"` など) |
| `--parent-filter` | 標準入力に `-p <親> -p <親>` | 出力の `-p` の親 |
| `--tag-name-filter` | 標準入力にタグの名前 | 出力の名前でタグを付け直す (`cat` なら同じ名前) |

内容が変わらないコミットは同じ ID のままです (本物でもハッシュが変わりません)。`git replace` の置き換えは反映して読むので、
`replace --graft` で付け替えた親は `filter-branch` で本当の履歴にできます。

### このアプリ独自のコマンド

| コマンド | 内容 |
| --- | --- |
| `teammate [<リモート>] [<ブランチ>]` | 他の人がリモート (既定は origin の main) にコミットを push したことにする |
| `help [<コマンド>]` / `git help <コマンド>` / `git <コマンド> -h` | コマンドの一覧 / そのコマンドの使い方と例を表示する |

### 本物の Git と違うところ

- コミット ID はハッシュではなく `C1`, `C2`, … の連番です。
- エディタは画面上の簡易エディタです。保存は `:wq "内容"` というコマンドとしてログと共有 URL に残ります。
- リモートはブラウザの中で模擬しています。URL には接続せず、`remote add` で追加したリモートは空のリポジトリから始まります
  (`remote remove` するとそのリモートの中身も消えます)。
- サブモジュールの取得元も模擬で、初めて使う URL なら README.md だけのリポジトリになります。
- `clone` できるのは、リモートとサブモジュールの URL だけです。clone 先は worktree の外 (`~/teammate` など) にします。
- ファイルシステムは模擬で、`cd` で移動できるのは worktree・clone したリポジトリ・サブモジュールだけです。パスは `~/branch-lab` のような形です。
- コミットに日時とメールアドレスはありません (`Author:` には名前だけを出し、`--format` の `%ad` や `%ae` などは使えません)。
  `describe` の `-g` の後ろは、ハッシュの代わりにコミット ID です (`v1.0-2-gC5`)。`--graph` の線は、
  よくある形では本物と同じですが、複雑に交差する場合は本物と少し違うことがあります。
- `notes` は本物ではコミット (refs/notes/commits) として保存されますが、ここでは別に持ち、push もしません。
  `notes list` はメモの付いたコミットの ID だけを表示します。
- `sparse-checkout` は cone モードだけです。
- フックはシェルスクリプトではなく、このアプリのコマンドを 1 行ずつ書いたものです (`&&`・`||`・`;`・`exit`・`set -e`・`$1` などは使えます)。
  `.git` の中で書けるのは `hooks/` のファイルだけです。`prepare-commit-msg` など、上の表にないフックは実行しません。
- `bundle` の中身は、本物の pack (バイナリ) ではなく、コミットの JSON です。
- `format-patch` のパッチには作者 (`From:`) と日時 (`Date:`) の行がなく、ファイル名には日本語の件名もそのまま使います。
  `am` はパッチの元のコミットがこのリポジトリにあれば、それを由来として記録し、`-3` ではそのコミットを使って 3-way マージします。
- `commit --fixup=amend:` / `--fixup=reword:` は未対応です。`range-diff` のコミットの対応づけは、
  同じパッチ・同じ由来・同じ件名の順で行います (本物は差分の大きさから対応を決めます)。
- `config` は 1 つだけで、`--global` と `--local` を区別しません。
- `rerere` は、本物はコンフリクトの箇所 (hunk) ごとに解決を覚えますが、ここではファイル全体の内容で覚えます。
- `blame` には作者と日時がなく、コミット ID と件名を表示します。
- `-p` の質問の `j` / `k` / `g` / `/` (移動と検索) と、`clean -i` は未対応です。`e` は `add -p` と `commit -p` のときだけ使えます。質問の文は日本語です。
- `commit -p` は、選んだ変更を本当のステージに入れます (本物は一時的なステージを使うので、コミットを中止するとステージは元のままです)。
- `.gitignore` は作業ディレクトリのものだけで、`.git/info/exclude` と `core.excludesFile` は読みません。`bisect run` のコマンドはこのアプリのコマンドで、成功なら good、失敗なら bad です
  (先頭に `!` を付けると逆になります)。
- `stash` は本物ではコミットとして保存されますが、ここでは別に持ち、グラフには描きません。
- `diff` には blob の `index` 行がなく、コンフリクト中のファイルは結合差分の代わりに `* Unmerged path` と表示します。
- `subtree` ストラテジー、ファイルを指定した `stash push`、タグへの署名などは未対応です。
- reflog は HEAD とローカルブランチだけです。
- オブジェクトはコミットだけで、ファイル (blob) や tree のオブジェクトはありません。そのため `fsck` は `dangling blob` を表示せず、
  `gc` はパックを作りません。期限は上の「gc / fsck / prune」のとおり `now` のときだけ働きます。
- `replace` で置き換えられるのはコミットだけで、`--edit` と `--convert-graft-file` は未対応です。
- `filter-branch` の `--env-filter` (コミットに作成者と日時がないため)・`--commit-filter`・`--setup`・`--state-branch` は未対応です。
  `-- --all` は `refs/original/` と `refs/replace/` を書き換えの対象にしません。
- `for-each-ref` の `%(objecttype)` は、注釈付きタグでも `commit` です。

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
    refFilter.ts   branch / tag の --merged / --contains
    remote.ts      remote / push / fetch / pull と teammate
    config.ts      config
    rerere.ts      rerere
    worktree.ts    worktree と cd
    submodule.ts   submodule と、入れ子のリポジトリ (clone・サブモジュール) と模擬のサーバーの同期
    clone.ts       clone
    log.ts         log (範囲・絞り込み・書式・--graph)
    notes.ts       notes
    sparse.ts      sparse-checkout
    patch.ts       format-patch / apply / am
    compare.ts     cherry / range-diff
    bundle.ts      bundle
    gc.ts          gc / prune / fsck と reflog expire / delete、notes prune
    replace.ts     replace と、置き換えを反映して読むための Repo の変換
    refs.ts        update-ref / for-each-ref / show-ref
    filterBranch.ts filter-branch
    hunks.ts       add -p / commit -p / stash -p / restore -p / reset -p / checkout -p の質問 (Repo.prompt)
    ignore.ts      .gitignore
    clean.ts       clean / mv / check-ignore
    describe.ts    describe / shortlog / git grep
    commands.ts    入力文字列の解析と実行。規則違反は例外にせず結果として返す
  graph/
    layout.ts      コミットグラフの座標を計算する純粋関数 (ローカル・リモートの両方)
  view/
    workspace.ts   作業ディレクトリとステージに表示するファイル一覧を作る純粋関数
  puzzles/
    puzzles.ts     お題の一覧と、初期状態・目標の作成
    match.ts       履歴の形と由来で目標と比べる正解判定
  tutorial/
    lessons.ts     チュートリアルのレッスン (説明・課題・達成の判定)
  help/
    commands.ts    コマンドのヘルプ (ターミナルの help と画面のヘルプの両方で使う)
  share/
    share.ts       共有 URL の作成・読み込みと、コマンドの再実行による復元
  components/      GraphView, FileArea, Workspace (4 領域と stash), EditorPanel, PromptPanel, PuzzlePanel,
                   TutorialPanel, HelpDialog, ShareButton, Terminal
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

- `rebase --update-refs` / `--autostash` (`pull --autostash` も)
- `merge.conflictStyle = diff3` / `zdiff3` と `checkout --conflict=diff3`
- `log -L` (行の範囲の履歴) と `diff --word-diff`
