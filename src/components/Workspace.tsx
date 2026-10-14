import { useMemo, type ReactNode } from 'react'
import { getCommit, type Repo } from '../git/model'
import { changedPaths } from '../git/tree'
import { computeLayout, computeRemoteLayout } from '../graph/layout'
import { remoteNames, stagedFiles, workdirFiles, worktreeRows } from '../view/workspace'
import { FileArea } from './FileArea'
import { GraphView } from './GraphView'

interface AreaProps {
  readonly title: string
  readonly hint: string
  readonly className?: string
  readonly children: ReactNode
}

function Area({ title, hint, className, children }: AreaProps) {
  return (
    <section className={`area ${className ?? ''}`} aria-label={title}>
      <header className="area-header">
        <h2>{title}</h2>
        <span className="area-hint">{hint}</span>
      </header>
      {children}
    </section>
  )
}

/** 領域どうしの間に置く、データを移すコマンドの案内。 */
function Flow({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flow" aria-hidden="true">
      {children}
    </div>
  )
}

function OperationBanner({ repo }: { readonly repo: Repo }) {
  const op = repo.operation
  if (!op) return null
  const conflicts = repo.conflicts.map((conflict) => conflict.path)
  return (
    <div className="operation-banner" role="status">
      <strong>{op.type} の途中です</strong>
      {conflicts.length > 0
        ? ` — コンフリクト: ${conflicts.join(', ')}。ファイルを直して git add し、`
        : ' — コンフリクトは解消済みです。'}
      {op.type === 'merge' ? 'git commit で完了します' : `git ${op.type} --continue で続けます`}
      {`（中止: git ${op.type} --abort）`}
    </div>
  )
}

export function Workspace({ repo }: { readonly repo: Repo }) {
  const local = useMemo(() => computeLayout(repo), [repo])
  const remotes = useMemo(
    () =>
      remoteNames(repo).map((name) => ({
        name,
        url: repo.remotes[name]?.url ?? '',
        layout: computeRemoteLayout(repo, name),
      })),
    [repo],
  )
  const workdir = useMemo(() => workdirFiles(repo), [repo])
  const staged = useMemo(() => stagedFiles(repo), [repo])
  const worktrees = useMemo(() => worktreeRows(repo), [repo])
  const many = worktrees.length > 1

  return (
    <div className="workspace">
      <OperationBanner repo={repo} />
      <div className="file-areas">
        <Area title={many ? `作業ディレクトリ (${repo.worktree})` : '作業ディレクトリ'} hint="echo / rm で編集">
          <FileArea files={workdir} emptyText="ファイルはありません" />
        </Area>
        <Flow>
          <span>git add →</span>
          <span>← git restore</span>
        </Flow>
        <Area title="ステージ" hint="次のコミットの内容">
          <FileArea files={staged} emptyText="ファイルはありません" />
        </Area>
      </div>
      <Flow>
        <span>↓ git commit</span>
        <span>git restore --staged / reset ↑</span>
      </Flow>
      <Area title="ローカルリポジトリ" hint="手元のコミットの履歴" className="area-graph">
        <GraphView layout={local} label="ローカルリポジトリのコミットグラフ" />
      </Area>
      {remotes.length > 0 && (
        <Flow>
          <span>↓ git push</span>
          <span>git fetch / pull ↑</span>
        </Flow>
      )}
      {remotes.map(({ name, url, layout }) => (
        <Area key={name} title={`リモートリポジトリ (${name})`} hint={url} className="area-graph">
          <GraphView layout={layout} label={`リモートリポジトリ ${name} のコミットグラフ`} />
        </Area>
      ))}
      {many && (
        <Area title="worktree" hint="cd <パス> で移動 (コミットとブランチは共有)" className="area-stash">
          <ul className="stash-list">
            {worktrees.map((row) => (
              <li key={row.path}>
                <code>{row.path}</code> {row.checkedOut}
                {row.current && <span className="stash-files">← 今いる場所</span>}
              </li>
            ))}
          </ul>
        </Area>
      )}
      {repo.stash.length > 0 && (
        <Area title="スタッシュ" hint="git stash で退避した変更 (pop / apply で戻す)" className="area-stash">
          <ul className="stash-list">
            {repo.stash.map((entry, index) => {
              const files = changedPaths(getCommit(repo, entry.base).tree, { ...entry.workdir, ...entry.untracked })
              return (
                <li key={`${index}:${entry.message}`}>
                  <code>{`stash@{${index}}`}</code> {entry.message}
                  <span className="stash-files">{files.join(', ')}</span>
                </li>
              )
            })}
          </ul>
        </Area>
      )}
    </div>
  )
}
