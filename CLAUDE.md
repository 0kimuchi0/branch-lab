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
- `src/git/history.ts`: merge / cherry-pick / revert / rebase (-i) と、コンフリクトで止まった操作の再開・中止。
- エディタ: Git がエディタを開いて待つ状態は `Repo.editor` (開いた内容と、閉じたあとに続ける処理) で表す。
  保存は `:wq <JSON の文字列>` のコマンド (`saveEditor`) なので、ログと共有 URL でも再現できる。
  エディタが開いている間、ほかのコマンドは実行できない。
- `src/git/inspect.ts`: diff / show。`src/git/stash.ts`: stash (コミットにはせず `Repo.stash` に持つ)。
  `src/git/tag.ts`: tag。
- reflog: HEAD やブランチを動かす処理は `logRefs(before, after, メッセージ)` で `Repo.reflogs` に記録する
  (コミットは `createCommit` が `PendingCommit.reflogAction` を使って記録する)。メッセージは本物の Git と同じ形にする。
- rebase -i の exec は、`history.ts` では todo に残したまま止まり、`commands.ts` の `runPendingExec` が実行して続ける。
- `src/git/remote.ts`: push / fetch / pull と、他の人の push を再現する teammate。
- `src/git/commands.ts`: 入力文字列の解析と実行。`GitError` は例外にせず `ok: false` で返す。
- `src/graph/layout.ts`: グラフの座標を計算する純粋関数。
  x は祖先からの深さ、y はブランチごとのレーン (main が最上段)。どこからもたどれないコミットは後ろのレーンに薄く置く。
- `src/view/workspace.ts`: 作業ディレクトリとステージに表示するファイル一覧を作る純粋関数。
- `src/puzzles/`: お題の定義 (`puzzles.ts`) と正解判定 (`match.ts`)。
  お題の目標は「初期状態に解答例を実行した結果」で作り、ID ではなく履歴の形と由来で比べる。
  お題を足したら、解答例で正解になり初期状態では正解にならないことを `puzzles.test.ts` が確かめる。
- `src/share/share.ts`: URL 共有。ハッシュには状態ではなくモード・お題 ID・コマンド列を入れ、開いた側で再実行して復元する。
  形式を変えるときは `VERSION` を上げる。コマンドから `Repo` が決定的に作られることが前提なので、
  モデルに乱数や時刻を持ち込まない。
- `src/components/`: `GraphView` (SVG 描画とアニメーション)、`FileArea`、`Workspace` (4 領域と stash)、
  `EditorPanel`、`PuzzlePanel`、`ShareButton`、`Terminal` (入力欄とログ)。
- `src/App.tsx`: モード (自由に試す / お題)・`Repo`・実行ログの状態管理。
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

- `rebase --rebase-merges`、`bisect`、`blame`
- 複数のリモート (`remote add`)
