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

- 挙動はできるだけ本物の Git に合わせる。合わせられない部分 (連番のコミット ID、エディタがないこと、
  模擬のリモート) は README の「本物の Git と違うところ」に書く。出力は日本語に訳すが、形は Git に寄せる。
- `src/git/tree.ts`: ファイルのスナップショット (`Tree`) と行単位の 3-way マージ。
- `src/git/model.ts`: Git の内部モデル (コミットの DAG・ブランチ・HEAD・ステージ・作業ディレクトリ・リモート)。
  `Repo` は不変データで、すべての操作は新しい `Repo` を返す純粋関数。React には依存させない。
  Git の規則に反する操作は `GitError` を投げる。
- `src/git/history.ts`: merge / cherry-pick / revert / rebase と、コンフリクトで止まった操作の再開・中止。
- `src/git/remote.ts`: push / fetch / pull と、他の人の push を再現する teammate。
- `src/git/commands.ts`: 入力文字列の解析と実行。`GitError` は例外にせず `ok: false` で返す。
- `src/graph/layout.ts`: グラフの座標を計算する純粋関数。
  x は祖先からの深さ、y はブランチごとのレーン (main が最上段)。どこからもたどれないコミットは後ろのレーンに薄く置く。
- `src/view/workspace.ts`: 作業ディレクトリとステージに表示するファイル一覧を作る純粋関数。
- `src/puzzles/`: お題の定義 (`puzzles.ts`) と正解判定 (`match.ts`)。
  お題の目標は「初期状態に解答例を実行した結果」で作り、ID ではなく履歴の形と由来で比べる。
  お題を足したら、解答例で正解になり初期状態では正解にならないことを `puzzles.test.ts` が確かめる。
- `src/components/`: `GraphView` (SVG 描画とアニメーション)、`FileArea`、`Workspace` (4 領域)、
  `PuzzlePanel`、`Terminal` (入力欄とログ)。
- `src/App.tsx`: モード (自由に試す / お題)・`Repo`・実行ログの状態管理。
- テストでコマンドを順に実行するときは `src/test/run.ts` の `run` を使う。

新しい Git コマンドを足すときは、まず `model.ts` (または `history.ts` / `remote.ts`) に純粋関数とテストを追加し、
次に `commands.ts` に解析を追加する。UI の変更は最後に行う。

## TypeScript の制約

`erasableSyntaxOnly` と `verbatimModuleSyntax` が有効。
enum やコンストラクタの引数プロパティは使わず、型のインポートは `import type` (または `type` 修飾子) で書く。

## 今後の予定

1. 現在の状態を URL で共有
2. Vercel または GitHub Pages で公開
