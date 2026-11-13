/**
 * 入力欄のコマンドの候補 (サジェスト)。最初に試す例と、ヘルプの例 (説明つき) から探す。
 * React には依存させず、入力文字列から候補の並びを決める純粋関数にする。
 *
 * 説明の言葉で探すときは、言葉の揺れに強くする:
 * - 全角と半角・カタカナとひらがな・大文字と小文字を区別しない
 * - 送りがなや活用の違いは、漢字の骨組みで比べる (取り消す・取り消し・取消 → 取消)
 * - 同じ意味の言葉 (戻す・取り消す・やり直す など) でも見つける
 */
import { COMMAND_HELP, findHelp } from '../help/commands'

export interface Suggestion {
  readonly command: string
  /** 何をするコマンドかの短い説明 (なければ空)。 */
  readonly description: string
  /** そのコマンドのヘルプの 1 行の説明 (探すときにだけ使う)。 */
  readonly summary: string
}

/** 入力欄が空のときに ↓ で出す、最初に試す例。 */
export const STARTER_COMMANDS: readonly string[] = [
  'echo "hello" >> README.md',
  'git add .',
  'git commit -m "update"',
  'git commit --allow-empty -m "empty"',
  'git switch -c feature',
  'git switch main',
  'git merge feature',
  'git rebase main',
  'git rebase -i HEAD~2',
  'git status',
  'git diff',
]

/**
 * 同じ意味で使われる言葉のまとまり。どれか 1 つで探すと、ほかの言葉を含む説明も見つかる。
 * ヘルプの説明に出てくる言い方と、ふだんの言い方・英語をそろえる。
 */
const SYNONYMS: ReadonlyArray<readonly string[]> = [
  ['取り消す', '戻す', '元に戻す', 'やり直す', '打ち消す', '捨てる', '取りやめる', 'undo', 'もどす', 'とりけす'],
  ['消す', '削除', '取り除く', '外す', 'delete', 'remove', 'けす', 'さくじょ'],
  ['作る', '作成', '追加', '新規', '増やす', 'create', 'new', 'つくる', 'さくせい', 'ついか'],
  ['表示', '見る', '確認', '一覧', '確かめる', 'show', 'list', 'view', 'みる', 'ひょうじ'],
  ['切り替える', '移る', '移動', 'switch', 'move', 'きりかえる'],
  ['取り込む', 'マージ', '合流', '統合', 'まとめる', 'merge'],
  ['送る', 'アップロード', '公開', 'push', 'おくる'],
  ['取ってくる', 'ダウンロード', '取得', '最新', 'fetch', 'pull', 'download'],
  ['退避', '一時保存', 'しまう', '隠す', 'stash', 'たいひ'],
  ['記録', '保存', 'save', 'きろく', 'ほぞん'],
  ['探す', '検索', '調べる', 'search', 'find', 'さがす', 'けんさく'],
  ['比べる', '比較', '差分', '違い', 'diff', 'くらべる'],
  ['名前を変える', 'リネーム', '名前変更', 'rename'],
  ['複製', 'コピー', 'copy', 'clone'],
  ['履歴', 'ログ', 'history', 'log', 'りれき'],
  ['付け替える', '土台', 'rebase'],
  ['ステージ', 'インデックス', 'stage'],
]

/** 全角と半角・大文字と小文字・カタカナとひらがなをそろえ、空白をつめる。 */
export function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
    .replace(/\s+/g, '')
}

/**
 * 漢字の骨組み: ひらがな (送りがな・助詞) を除いたもの。
 * 漢字が 1 文字だけの言葉は、別の言葉と取り違えやすい (戻す と 戻る、直す と 直前) ので、骨組みを作らない (空)。
 */
function skeleton(text: string): string {
  const base = text.normalize('NFKC').toLowerCase().replace(/\s+/g, '')
  if ((base.match(/\p{Script=Han}/gu) ?? []).length < 2) return ''
  return base.replace(/\p{Script=Hiragana}/gu, '')
}

/** 言葉 word が、文 text に含まれるか (そのまま、漢字の骨組みで、または活用した形で)。 */
function contains(text: string, word: string): boolean {
  if (normalize(text).includes(normalize(word))) return true
  const key = skeleton(word)
  if (key.length > 0) return skeleton(text).includes(key)
  return inflectedIn(text, word)
}

/** 音便で語尾が っ・ん・い に変わる行 (作る → 作って、読む → 読んで、書く → 書いて)。 */
const EUPHONIC: Readonly<Record<string, readonly number[]>> = {
  っ: [0, 5, 12],
  ん: [7, 9, 11],
  い: [1, 2],
}

/** 文 text に、動詞 word (漢字 + 送りがな) の活用した形があるか (作る → 作って、消す → 消して)。 */
function inflectedIn(text: string, word: string): boolean {
  const base = stem(word)
  const first = row(normalize(word)[base.length])
  if (base === '' || first < 0 || !/\p{Script=Han}/u.test(base)) return false
  const body = normalize(text)
  for (let at = body.indexOf(base); at >= 0; at = body.indexOf(base, at + 1)) {
    const next = body[at + base.length]
    if (next === undefined) continue
    if (row(next) === first || (EUPHONIC[next]?.includes(first) ?? false)) return true
  }
  return false
}

/** 英数字だけの言葉か (説明は日本語なので、日本語で探すときは英語の同じ意味の言葉に広げない)。 */
function isAscii(word: string): boolean {
  return /^[\x20-\x7e]+$/.test(word)
}

/** 語幹: 終わりのひらがな (送りがな・活用) を除いたもの (やり直す → やり直)。漢字を含まなければそのまま。 */
function stem(word: string): string {
  const base = normalize(word)
  return /\p{Script=Han}/u.test(base) ? base.replace(/\p{Script=Hiragana}+$/u, '') : base
}

/** ひらがなの行 (す・し・せ は同じ さ行)。動詞の活用で変わるのは、同じ行の中の文字。 */
const ROWS = ['あいうえお', 'かきくけこ', 'がぎぐげご', 'さしすせそ', 'ざじずぜぞ', 'たちつてと', 'だぢづでど', 'なにぬねの', 'はひふへほ', 'ばびぶべぼ', 'ぱぴぷぺぽ', 'まみむめも', 'らりるれろ', 'わをん']

function row(char: string | undefined): number {
  return char === undefined ? -1 : ROWS.findIndex((letters) => letters.includes(char))
}

/**
 * 言葉 word が、言葉 member の活用した形か (取り消したい → 取り消す、戻したい → 戻す)。
 * 語幹が合い、語幹のすぐあとのひらがなが同じ行のときだけ同じとみなす (戻る は 戻す の活用ではない)。
 */
function inflects(word: string, member: string): boolean {
  const base = stem(member)
  const ending = normalize(member).slice(base.length)
  const text = normalize(word)
  if (base === '' || ending === '' || !/\p{Script=Han}/u.test(base) || !text.startsWith(base)) return false
  const first = row(ending[0])
  return first >= 0 && first === row(text[base.length])
}

/** 言葉と同じ意味の言葉のまとまり (表記の揺れ・漢字の骨組み・活用のどれかで合うもの) に入っている言葉。 */
function synonymsOf(word: string): string[] {
  const key = skeleton(word)
  const matches = (member: string) =>
    normalize(member) === normalize(word) || (key.length > 0 && skeleton(member) === key) || inflects(word, member)
  return SYNONYMS.filter((group) => group.some(matches)).flatMap((group) => [...group])
}

/**
 * 言葉 1 つが候補の説明に合うか。合い方の強さ (小さいほど強い) を返し、合わなければ -1。
 * 0: 例の説明にそのまま含む  1: 例の説明に、骨組みか同じ意味の言葉で含む  2: ヘルプの 1 行の説明に含む
 */
function wordScore(item: Suggestion, word: string): number {
  if (normalize(item.description).includes(normalize(word))) return 0
  // 日本語で探すときは日本語の言い換えだけに広げる (英語の言葉は debug.log の log のように、ファイル名にも合ってしまう)
  const alternatives = [word, ...synonymsOf(word).filter((alt) => isAscii(word) || !isAscii(alt))]
  if (alternatives.some((alt) => contains(item.description, alt))) return 1
  if (alternatives.some((alt) => contains(item.summary, alt))) return 2
  return -1
}

/** 候補の全体。最初に試す例を先に、そのあとにヘルプの例を並べる (同じコマンドは 1 つにまとめる)。 */
export function allSuggestions(): Suggestion[] {
  const fromHelp = COMMAND_HELP.flatMap((entry) =>
    entry.examples.map(([command, description]) => ({ command, description, summary: entry.summary })),
  )
  const described = new Map(fromHelp.map((item) => [item.command, item.description]))
  const starters = STARTER_COMMANDS.map((command) => ({
    command,
    description: described.get(command) ?? '',
    summary: findHelp(command.split(/\s+/).slice(0, 2).join(' '))?.summary ?? '',
  }))
  const seen = new Set<string>()
  const result: Suggestion[] = []
  for (const item of [...starters, ...fromHelp]) {
    if (seen.has(item.command)) continue
    seen.add(item.command)
    result.push(item)
  }
  return result
}

const ALL = allSuggestions()

/**
 * 入力に合う候補を、合い方の強い順に最大 limit 件返す。
 * 0. 入力で始まる  1. 先頭の git を省いた入力で始まる (reb → git rebase)  2. コマンドの途中の単語から始まる
 * 3〜5. 説明で探す (空白で区切った言葉がすべて合うもの。例の説明にそのまま > 言葉の揺れや同じ意味の言葉 > ヘルプの 1 行の説明)
 * 入力と同じコマンドしか合わないときは、候補を出さない。
 */
export function suggest(input: string, limit = 8, candidates: readonly Suggestion[] = ALL): Suggestion[] {
  const query = input.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
  if (query === '') return []
  const words = query.split(' ')
  const rank = (item: Suggestion): number => {
    const command = item.command.toLowerCase()
    if (command.startsWith(query)) return 0
    if (command.startsWith(`git ${query}`)) return 1
    if (command.split(/\s+/).some((_, i, parts) => parts.slice(i).join(' ').startsWith(query))) return 2
    const scores = words.map((word) => wordScore(item, word))
    if (scores.some((score) => score < 0)) return -1
    return 3 + Math.max(...scores)
  }
  const matched = candidates
    .map((item, index) => ({ item, index, score: rank(item) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, limit)
    .map(({ item }) => item)
  if (matched.length === 1 && matched[0]?.command.toLowerCase() === query) return []
  return matched
}

/** 入力欄が空のときに出す候補 (最初に試す例)。 */
export function starterSuggestions(candidates: readonly Suggestion[] = ALL): Suggestion[] {
  return candidates.filter((item) => STARTER_COMMANDS.includes(item.command))
}
