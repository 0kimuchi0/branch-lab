/**
 * .gitignore。作業ディレクトリにある .gitignore (一番上と、各ディレクトリの中) のパターンで、
 * 追跡していないファイルを無視するかを決める (追跡しているファイルは無視されない)。
 * パターンの書き方は本物と同じ: # はコメント、! で打ち消し、末尾の / はディレクトリだけ、
 * 途中に / があれば .gitignore のある場所からのパス、なければどの階層の名前にも一致する。* ? [ ] と ** が使える。
 */
import type { Tree } from './tree'

interface IgnoreRule {
  /** .gitignore のパス。 */
  readonly source: string
  readonly line: number
  /** 書いたままのパターン (check-ignore -v で表示する)。 */
  readonly text: string
  readonly negate: boolean
  readonly dirOnly: boolean
  readonly regex: RegExp
  /** / を含むパターンは、.gitignore のある場所からのパス全体に一致させる。 */
  readonly anchored: boolean
}

function globToRegex(glob: string): string {
  let out = ''
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i] as string
    if (char === '*' && glob[i + 1] === '*') {
      // **/ はどの階層でも (0 個以上のディレクトリ)、/** は中のすべて
      if (glob[i + 2] === '/') {
        out += '(?:.*/)?'
        i += 2
      } else {
        out += '.*'
        i += 1
      }
    } else if (char === '*') out += '[^/]*'
    else if (char === '?') out += '[^/]'
    else if (char === '[') {
      const end = glob.indexOf(']', i + 1)
      if (end === -1) out += '\\['
      else {
        out += `[${glob.slice(i + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`
        i = end
      }
    } else if (char === '\\' && i + 1 < glob.length) out += `\\${glob[++i]}`
    else out += char.replace(/[.+^${}()|]/g, '\\$&')
  }
  return out
}

/** 1 つの .gitignore を読む。 */
function parseRules(source: string, text: string): IgnoreRule[] {
  const rules: IgnoreRule[] = []
  text.split('\n').forEach((raw, index) => {
    let pattern = raw.replace(/(?<!\\)\s+$/, '')
    if (pattern === '' || pattern.startsWith('#')) return
    const negate = pattern.startsWith('!')
    if (negate) pattern = pattern.slice(1)
    if (pattern.startsWith('\\#') || pattern.startsWith('\\!')) pattern = pattern.slice(1)
    const dirOnly = pattern.endsWith('/')
    if (dirOnly) pattern = pattern.replace(/\/+$/, '')
    const anchored = pattern.includes('/')
    pattern = pattern.replace(/^\//, '')
    if (pattern === '') return
    rules.push({ source, line: index + 1, text: raw.trim(), negate, dirOnly, anchored, regex: new RegExp(`^${globToRegex(pattern)}$`) })
  })
  return rules
}

/** path (と、それを含むディレクトリ) に関係する .gitignore のルール (浅い場所のものから順に)。 */
function rulesFor(workdir: Tree, path: string): Array<{ readonly base: string; readonly rules: IgnoreRule[] }> {
  const dirs = path.split('/').slice(0, -1)
  const bases = ['', ...dirs.map((_, index) => `${dirs.slice(0, index + 1).join('/')}/`)]
  return bases.flatMap((base) => {
    const file = `${base}.gitignore`
    const text = workdir[file]
    return text === undefined ? [] : [{ base, rules: parseRules(file, text) }]
  })
}

/** パス (ファイルかディレクトリ) に最後に一致したルール。一致しなければ null。 */
function lastMatch(workdir: Tree, path: string, isDir: boolean): IgnoreRule | null {
  let found: IgnoreRule | null = null
  for (const { base, rules } of rulesFor(workdir, isDir ? `${path}/x` : path)) {
    if (!path.startsWith(base)) continue
    const relative = path.slice(base.length)
    const name = relative.split('/').at(-1) as string
    for (const rule of rules) {
      if (rule.dirOnly && !isDir) continue
      if (rule.regex.test(rule.anchored ? relative : name)) found = rule
    }
  }
  return found
}

/**
 * パスを無視するときは、決めたルールを返す (check-ignore -v 用)。無視しないなら null。
 * 親のディレクトリが無視されていれば、中のファイルを ! で打ち消すことはできない (本物と同じ)。
 */
export function ignoringRule(workdir: Tree, path: string): IgnoreRule | null {
  const parts = path.split('/')
  for (let depth = 1; depth < parts.length; depth++) {
    const rule = lastMatch(workdir, parts.slice(0, depth).join('/'), true)
    if (rule !== null && !rule.negate) return rule
  }
  const rule = lastMatch(workdir, path, false)
  return rule !== null && !rule.negate ? rule : null
}

/** 追跡していないファイルで、.gitignore で無視するものか。 */
export function isIgnored(workdir: Tree, index: Tree, path: string): boolean {
  return !(path in index) && ignoringRule(workdir, path) !== null
}

/** git check-ignore [-v] の 1 行。 */
export function describeIgnore(workdir: Tree, path: string): string | null {
  const rule = ignoringRule(workdir, path)
  return rule === null ? null : `${rule.source}:${rule.line}:${rule.text}\t${path}`
}
