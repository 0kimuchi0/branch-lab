/**
 * branch / tag の一覧の絞り込み: --merged / --no-merged / --contains / --no-contains / --points-at。
 */
import { isAncestor, resolveRef, type CommitId, type Repo } from './model'

export interface RefFilter {
  /** --merged <コミット>: どれかのコミットからたどれる参照だけ。 */
  readonly merged?: readonly string[]
  /** --no-merged <コミット>: どのコミットからもたどれない参照だけ。 */
  readonly noMerged?: readonly string[]
  /** --contains <コミット>: どれかのコミットを含む参照だけ。 */
  readonly contains?: readonly string[]
  /** --no-contains <コミット>: どのコミットも含まない参照だけ。 */
  readonly noContains?: readonly string[]
  /** --points-at <コミット>: そのコミットを指す参照だけ。 */
  readonly pointsAt?: readonly string[]
}

/** 絞り込みの判定。コミットとして読めないものがあれば、ここで GitError になる。 */
export function refMatcher(repo: Repo, filter: RefFilter): (id: CommitId) => boolean {
  const resolve = (revs: readonly string[] | undefined) => (revs ?? []).map((rev) => resolveRef(repo, rev))
  const merged = resolve(filter.merged)
  const noMerged = resolve(filter.noMerged)
  const contains = resolve(filter.contains)
  const noContains = resolve(filter.noContains)
  const pointsAt = resolve(filter.pointsAt)
  return (id) =>
    (merged.length === 0 || merged.some((into) => isAncestor(repo, id, into))) &&
    !noMerged.some((into) => isAncestor(repo, id, into)) &&
    (contains.length === 0 || contains.some((commit) => isAncestor(repo, commit, id))) &&
    !noContains.some((commit) => isAncestor(repo, commit, id)) &&
    (pointsAt.length === 0 || pointsAt.includes(id))
}

export function hasFilter(filter: RefFilter): boolean {
  return Object.values(filter).some((revs: readonly string[] | undefined) => revs !== undefined && revs.length > 0)
}
