/**
 * git rerere (reuse recorded resolution)。コンフリクトの解決を覚えておき、同じコンフリクトが起きたら自動で同じように直す。
 * rerere.enabled が true のときだけ働く。本物は各コンフリクト (hunk) ごとに覚えるが、ここではファイル全体の内容で覚える。
 */
import { fileDiff } from './diff'
import {
  GitError,
  configBool,
  recordResolutions,
  type OperationResult,
  type Repo,
} from './model'
import { conflictKey, withFile } from './tree'

/**
 * コンフリクトで止まったときに呼ぶ。内容のコンフリクトしたファイルを記録し (preimage)、
 * 同じコンフリクトの解決を覚えていれば、作業ディレクトリのファイルをその内容にする。
 */
export function rerereOnConflict(repo: Repo): { repo: Repo; lines: string[] } {
  if (!configBool(repo, 'rerere.enabled')) return { repo, lines: [] }
  const autoupdate = configBool(repo, 'rerere.autoupdate') ?? false
  const pending: Record<string, { key: string; preimage: string }> = {}
  const lines: string[] = []
  let workdir = repo.workdir
  let index = repo.index
  let conflicts = repo.conflicts
  for (const conflict of repo.conflicts) {
    if (conflict.kind !== 'both-modified' && conflict.kind !== 'both-added') continue
    const preimage = repo.workdir[conflict.path] ?? ''
    const key = conflictKey(preimage)
    if (key === null) continue
    pending[conflict.path] = { key, preimage }
    const resolution = repo.rerere.resolved[key]
    if (resolution === undefined) {
      lines.push(`Recorded preimage for '${conflict.path}'`)
      continue
    }
    workdir = withFile(workdir, conflict.path, resolution)
    if (autoupdate) {
      index = withFile(index, conflict.path, resolution)
      conflicts = conflicts.filter((other) => other.path !== conflict.path)
      lines.push(`Staged '${conflict.path}' using previous resolution.`)
    } else {
      lines.push(`Resolved '${conflict.path}' using previous resolution.`)
    }
  }
  return {
    repo: { ...repo, workdir, index, conflicts, rerere: { ...repo.rerere, pending } },
    lines,
  }
}

/** 操作を中止・スキップしたときなど、記録の途中のコンフリクトを忘れる (git rerere clear)。 */
export function rerereClear(repo: Repo): Repo {
  if (Object.keys(repo.rerere.pending).length === 0) return repo
  return { ...repo, rerere: { ...repo.rerere, pending: {} } }
}

/** git rerere [clear | forget <パス> | diff | status | remaining | gc] */
export function rerereCommand(repo: Repo, sub: string | undefined, paths: readonly string[]): OperationResult {
  const pending = repo.rerere.pending
  switch (sub) {
    case undefined: {
      // 作業ディレクトリで解決済みのファイルを記録する (コミットまで記録の対象には残す)
      const recorded = recordResolutions(repo, repo.workdir, false)
      return { repo: recorded.repo, output: recorded.lines.join('\n') }
    }
    case 'clear':
      return { repo: rerereClear(repo), output: '' }
    case 'gc':
      return { repo, output: '' }
    case 'status':
      return { repo, output: Object.keys(pending).sort().join('\n') }
    case 'remaining':
      return {
        repo,
        output: repo.conflicts
          .map((conflict) => conflict.path)
          .sort()
          .join('\n'),
      }
    case 'diff':
      return {
        repo,
        output: Object.keys(pending)
          .sort()
          .flatMap((path) => {
            const entry = pending[path] as { preimage: string }
            return fileDiff(path, entry.preimage, repo.workdir[path]).slice(1)
          })
          .join('\n'),
      }
    case 'forget': {
      if (paths.length === 0) throw new GitError('使い方: git rerere forget <パス>...')
      const resolved = { ...repo.rerere.resolved }
      const lines: string[] = []
      for (const path of paths) {
        const entry = pending[path]
        if (entry === undefined || resolved[entry.key] === undefined) {
          throw new GitError(`error: '${path}' について記録した解決はありません`)
        }
        delete resolved[entry.key]
        lines.push(`Updated preimage for '${path}'`, `Forgot resolution for '${path}'`)
      }
      return { repo: { ...repo, rerere: { ...repo.rerere, resolved } }, output: lines.join('\n') }
    }
    default:
      throw new GitError(`error: 未対応の rerere のサブコマンドです: ${sub}`)
  }
}
