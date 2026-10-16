# BranchLab

Git のコマンドを入力すると、コミットグラフがアニメーションで変化する学習用 Web アプリ。
React + TypeScript + Vite、テストは Vitest。UI の文言は日本語。

## コマンド

- `npm run dev`: 開発サーバー
- `npm test`: テスト (Vitest)
- `npm run lint`: oxlint
- `npm run build`: 型チェックと本番ビルド

変更後は `npm test` と `npm run build` が通ることを確認する。

## 構成と設計方針

- 挙動はできるだけ本物の Git に合わせる。合わせられない部分 (連番のコミット ID、画面上の簡易エディタ、
  模擬のリモートなど) は README の「本物の Git と違うところ」に書く。出力は日本語に訳すが、形は Git に寄せる。
- `src/git/tree.ts`: ファイルのスナップショット (`Tree`) と行単位の 3-way マージ。`src/git/diff.ts`: unified 形式の差分。
- `src/git/model.ts`: Git の内部モデル (コミットの DAG・ブランチ・HEAD・ステージ・作業ディレクトリ・リモート)。
  `Repo` は不変データで、すべての操作は新しい `Repo` を返す純粋関数。React には依存させない。
  Git の規則に反する操作は `GitError` を投げる。
- `src/git/history.ts`: merge (octopus・`-s`・`-X`) / cherry-pick / revert / rebase (-i, -r) と、コンフリクトで止まった操作の再開・中止。
- エディタ: Git がエディタを開いて待つ状態は `Repo.editor` (開いた内容と、閉じたあとに続ける処理) で表す。
  保存は `:wq <JSON の文字列>` のコマンド (`saveEditor`) なので、ログと共有 URL でも再現できる。
  エディタが開いている間、ほかのコマンドは実行できない。
- `src/git/log.ts`: log (範囲・絞り込み・書式・--graph の線)。`src/git/notes.ts`: notes (`Repo.notes`)。
  `src/git/sparse.ts`: sparse-checkout (`Repo.sparse`)。cone の外のファイルも workdir に持ち、`isSparseHidden` で見えなくする。
- `src/git/patch.ts`: format-patch / apply / am。パッチは作業ディレクトリのファイルとして読み書きし、
  am の途中の状態は `Operation` の `AmOperation`。`src/git/compare.ts`: cherry / range-diff (行番号を除いた差分で比べる)。
- フック: `.git` の中のファイルは `Repo.gitFiles` (作業ディレクトリには入れない)。`commands.ts` の `runHook` が
  フックの各行をコマンドとして実行し、`runCommit`・`runGit` (push / rebase / switch / merge など) から呼ぶ。
- `src/git/bundle.ts`: bundle。バンドルは作業ディレクトリのファイルで、clone・fetch・pull の元にできる。
  `git switch --orphan` のあとの「まだコミットのないブランチ」は、HEAD がまだないブランチを指す状態で表す (`headCommitIdOrNull`)。
- `src/git/inspect.ts`: diff / show / blame。`src/git/bisect.ts`: bisect (状態は `Repo.bisect`)。`src/git/stash.ts`: stash (コミットにはせず `Repo.stash` に持つ)。
  `src/git/tag.ts`: tag。
- reflog: HEAD やブランチを動かす処理は `logRefs(before, after, メッセージ)` で `Repo.reflogs` に記録する
  (コミットは `createCommit` が `PendingCommit.reflogAction` を使って記録する)。メッセージは本物の Git と同じ形にする。
- rebase -i の exec は、`history.ts` では todo に残したまま止まり、`commands.ts` の `runPendingExec` が実行して続ける。
- rebase --rebase-merges の todo は label / reset / merge の行で表し、label の位置は `SequenceOperation.labels` に持つ。
- `src/git/remote.ts`: remote / push / fetch / pull と、他の人の push を再現する teammate。
  リモートは `Repo.remotes` (名前 → コミット・ブランチ・タグ・URL)。リモート追跡ブランチ (`remoteBranches`) と
  upstream (`upstreams`) は `origin/main` のように、リモート名を含めた名前で持つ。
- `src/git/config.ts`: config (`Repo.config`)。`src/git/rerere.ts`: rerere (`Repo.rerere`)。
  コンフリクトで止まるときは `history.ts` の `applyConflicted` が rerere を呼び、解決はコミットするときに `createCommit` が記録する。
- `src/git/worktree.ts`: worktree と cd。今いる worktree の状態は `Repo` の head・index・workdir などにあり、
  ほかの worktree の状態は `Repo.worktrees` (`WorktreeState`) にしまう。`enterWorktree` で入れ替える。
- `src/git/submodule.ts`: submodule。サブモジュールは別の `Repo` (`Repo.submodules`、コミット ID の頭文字は `idPrefix`) で、
  親の tree には gitlink (`tree.ts` の `gitlink`) を入れる。`cd` で中にいる間 (`Repo.submodule`) は、
  `executeCommand` がサブモジュールでコマンドを実行し、`syncServersIn` / `syncServersOut` で取得元 (`Repo.libraries`) と、
  `syncSubmodules` で親の gitlink と同期する。画面に出すのは `activeRepo`。
  サブモジュールの中のサブモジュールも、clone やサブモジュールの中の worktree も入れ子の `Repo` で表し、`cd` の行き先は
  `worktree.ts` の `allLocations` でたどる (サブモジュールの元の場所は `Repo.home`、親から出るときに `resetSubmodules` で戻す)。
- `src/git/gc.ts`: gc / prune / fsck / reflog expire。残すコミットは `liveCommits` (参照・HEAD・stash・途中の操作・reflog)。
  コミットに時刻がないので、期限は now (all) のときだけ働く。
- `src/git/replace.ts`: replace (`Repo.replaces`)。`commands.ts` の `executeLocal` が、置き換えを反映した Repo
  (`withReplacements`) でコマンドを実行し、結果のコミットを元に戻す (`restoreOriginals`)。gc・push などの `RAW_COMMANDS` は元のまま。
- `src/git/filterBranch.ts`: filter-branch。フィルタは `commands.ts` の `runFilter` で実行し、`--msg-filter` などの標準入力は
  `stdinText` で cat・sed・grep に渡す。元の参照は `Repo.originalRefs` (`refs/original/...`)。`src/git/refs.ts`: update-ref / for-each-ref / show-ref。
- `src/git/hunks.ts`: add -p / restore -p / reset -p / checkout -p。質問の状態は `Repo.prompt` (`PatchPrompt`) で、
  開いている間は `executeOnce` が入力をすべて答えとして `answerPatch` に渡す (エディタと同じく、ログと共有 URL で再現できる)。
- `src/git/ignore.ts`: .gitignore (`isIgnored`)。status・add・stash・clean・画面のファイル一覧が使う。
  `src/git/clean.ts`: clean / mv / check-ignore。`src/git/describe.ts`: describe / shortlog / git grep。
- コミットの作者は `Commit.author` (`git config user.name`、なければ `DEFAULT_AUTHOR`)。コピー (`source` のあるコミット) と --amend は元の作者のまま (`createCommit`)。
- `src/git/clone.ts`: clone。clone したリポジトリは一番外側の `Repo.clones` に持ち、`cd` で中にいる間 (`Repo.clone`) は
  `executeCommand` がそのリポジトリで実行する。リモートとサブモジュールの取得元は URL ごとの模擬のサーバーとして扱い、
  `syncServersIn` / `syncServersOut` で中身とコミットの採番を共有する。
- `src/git/commands.ts`: 入力文字列の解析と実行。`GitError` は例外にせず `ok: false` で返す。
- `src/graph/layout.ts`: グラフの座標を計算する純粋関数。
  x は祖先からの深さ、y はブランチごとのレーン (main が最上段)。どこからもたどれないコミットは後ろのレーンに薄く置く。
- `src/view/workspace.ts`: 作業ディレクトリとステージに表示するファイル一覧を作る純粋関数。
- `src/puzzles/`: お題の定義 (`puzzles.ts`) と正解判定 (`match.ts`)。
  お題の目標は「初期状態に解答例を実行した結果」で作り、ID ではなく履歴の形と由来で比べる。
  お題を足したら、解答例で正解になり初期状態では正解にならないことを `puzzles.test.ts` が確かめる。
- `src/tutorial/lessons.ts`: チュートリアルのレッスン。各ステップは説明と、課題 (`commands`) と達成の判定 (`check`) を持つ。
  レッスンを足したら、各ステップが始めたときは未達成で例のコマンドで達成できることを `lessons.test.ts` が確かめる。
- `src/help/commands.ts`: コマンドのヘルプ (`COMMAND_HELP`)。ターミナルの `help` / `git help` / `-h` と、画面の `HelpDialog` の両方が使う。
  コマンドやオプションを足したら、ここも更新する (`commands.test.ts` が、例のコマンドが使えるオプションだけかを確かめる)。
- `src/share/share.ts`: URL 共有。ハッシュには状態ではなくモード・お題 ID (またはレッスン ID とステップ)・コマンド列を入れ、開いた側で再実行して復元する。
  形式を変えるときは `VERSION` を上げる。コマンドから `Repo` が決定的に作られることが前提なので、
  モデルに乱数や時刻を持ち込まない。
- `src/components/`: `GraphView` (SVG 描画とアニメーション)、`FileArea`、`Workspace` (4 領域と stash)、
  `EditorPanel`、`PromptPanel` (-p の質問)、`PuzzlePanel`、`TutorialPanel`、`HelpDialog`、`ShareButton`、`Terminal` (入力欄とログ)。
- `src/App.tsx`: モード (自由に試す / チュートリアル / お題)・`Repo`・実行ログの状態管理。
- テストでコマンドを順に実行するときは `src/test/run.ts` の `run` を使う。

新しい Git コマンドを足すときは、まず `model.ts` (または `history.ts` / `remote.ts`) に純粋関数とテストを追加し、
次に `commands.ts` に解析を追加する。UI の変更は最後に行う。

## TypeScript の制約

`erasableSyntaxOnly` と `verbatimModuleSyntax` が有効。
enum やコンストラクタの引数プロパティは使わず、型のインポートは `import type` (または `type` 修飾子) で書く。

## 公開

Vercel のプロジェクト `branch-lab` (チーム `0daiki0-projects`) が GitHub とつながっていて、
main に push すると https://branch-lab-dun.vercel.app にデプロイされる。PR ではプレビューが作られる。

## 今後の予定

- `commit -p` / `stash -p` と、`-p` の質問の `e` (ハンクを手で直す)
- `log -S` / `-G` (変更の中身でコミットを探す)
- `branch --merged` / `--contains` と `tag --contains`
