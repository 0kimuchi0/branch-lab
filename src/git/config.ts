/**
 * git config。設定はリポジトリに 1 つだけ持つ (--global と --local は区別しない)。
 * このアプリで意味のある設定: rerere.enabled・rerere.autoupdate・pull.rebase・pull.ff・merge.ff。
 */
import { GitError, type OperationResult, type Repo } from './model'

/** Git と同じく、セクションと変数名は大文字・小文字を区別しない (サブセクションは区別する)。 */
export function normalizeConfigKey(key: string): string {
  const parts = key.split('.')
  if (parts.length < 2 || parts.some((part) => part === '')) {
    throw new GitError(`error: key does not contain a section: ${key}`)
  }
  const section = (parts[0] as string).toLowerCase()
  const name = (parts.at(-1) as string).toLowerCase()
  if (!/^[a-z][a-z0-9-]*$/.test(section) || !/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new GitError(`error: invalid key: ${key}`)
  }
  return [section, ...parts.slice(1, -1), name].join('.')
}

export function getConfig(repo: Repo, key: string): OperationResult {
  const value = repo.config[normalizeConfigKey(key)]
  // 未設定なら何も表示せずに失敗する (終了コード 1)
  if (value === undefined) throw new GitError('')
  return { repo, output: value }
}

export function setConfig(repo: Repo, key: string, value: string): OperationResult {
  return { repo: { ...repo, config: { ...repo.config, [normalizeConfigKey(key)]: value } }, output: '' }
}

export function unsetConfig(repo: Repo, key: string): OperationResult {
  const name = normalizeConfigKey(key)
  if (!(name in repo.config)) throw new GitError('')
  const config = { ...repo.config }
  delete config[name]
  return { repo: { ...repo, config }, output: '' }
}

export function listConfig(repo: Repo): OperationResult {
  return {
    repo,
    output: Object.entries(repo.config)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n'),
  }
}
