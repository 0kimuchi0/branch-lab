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

- `src/git/model.ts`: Git の内部モデル (コミットの DAG・ブランチ・HEAD)。
  `Repo` は不変データで、すべての操作は新しい `Repo` を返す純粋関数。React には依存させない。
- `src/git/commands.ts`: 入力文字列の解析と実行。Git の規則に反する操作は例外にせず `ok: false` で返す。
- `src/graph/layout.ts`: `Repo` からグラフの座標を計算する純粋関数。
  x は祖先からの深さ、y はブランチごとのレーン (main が最上段)。
- `src/components/`: `GraphView` (SVG 描画とアニメーション)、`Terminal` (入力欄とログ)。
- `src/App.tsx`: `Repo` と実行ログの状態管理。

新しい Git コマンドを足すときは、まず `model.ts` に純粋関数とテストを追加し、
次に `commands.ts` に解析を追加する。UI の変更は最後に行う。

## TypeScript の制約

`erasableSyntaxOnly` と `verbatimModuleSyntax` が有効。
enum やコンストラクタの引数プロパティは使わず、型のインポートは `import type` (または `type` 修飾子) で書く。

## 今後の予定

1. `reset` / `rebase` / `cherry-pick` / `revert`
2. 作業ディレクトリ・ステージ・ローカル・リモートの 4 領域表示
3. お題モード (指定された履歴を作れたら正解)
4. 現在の状態を URL で共有
5. Vercel または GitHub Pages で公開
