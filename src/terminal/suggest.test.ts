import { describe, expect, it } from 'vitest'
import { STARTER_COMMANDS, allSuggestions, starterSuggestions, suggest } from './suggest'

const commands = (input: string) => suggest(input).map((item) => item.command)

describe('suggest', () => {
  it('空の入力では候補を出さない', () => {
    expect(suggest('')).toEqual([])
    expect(suggest('   ')).toEqual([])
  })

  it('入力で始まるコマンドを先に出す', () => {
    const result = commands('git sw')
    expect(result.length).toBeGreaterThan(0)
    expect(result.every((command) => command.startsWith('git sw'))).toBe(true)
    expect(result[0]).toBe('git switch -c feature')
  })

  it('先頭の git を省いても、コマンドの単語の途中からでも見つかる', () => {
    expect(commands('reb')[0]).toBe('git rebase main')
    expect(commands('--amend').some((command) => command.includes('--amend'))).toBe(true)
  })

  it('説明の日本語でも探せる', () => {
    const result = suggest('取り消す')
    expect(result.length).toBeGreaterThan(0)
    // 説明にそのまま含むものが先に来る
    expect(result[0]?.description).toContain('取り消す')
  })

  describe('言葉の揺れ', () => {
    // 見つかるか (画面に出す 8 件より広く見る)
    const has = (input: string, command: string) => suggest(input, 50).some((item) => item.command === command)

    it('送りがなや活用が違っても見つかる (取り消す・取り消し・取消・取り消したい)', () => {
      for (const word of ['取り消す', '取り消し', '取消', '取り消したい']) expect(has(word, 'git reset --soft HEAD~1'), word).toBe(true)
    })

    it('同じ意味の言葉や英語でも見つかる', () => {
      for (const word of ['元に戻す', 'もどす', 'やり直したい', 'undo']) expect(has(word, 'git restore index.html'), word).toBe(true)
      expect(has('削除', 'git branch -d feature')).toBe(true)
      expect(has('さくじょ', 'rm memo.txt')).toBe(true)
      expect(has('アップロード', 'git push')).toBe(true)
      expect(has('一時保存', 'git stash')).toBe(true)
    })

    it('カタカナとひらがな、全角と半角を区別しない', () => {
      expect(has('ぶらんち', 'git branch feature')).toBe(true)
      expect(has('ﾌﾞﾗﾝﾁ', 'git branch feature')).toBe(true)
      expect(commands('ＧＩＴ ＳＴ')[0]).toBe('git status')
    })

    it('説明の中の活用した形 (作って・消して) にも合う', () => {
      expect(commands('ぶらんち 作る')).toContain('git switch -c feature')
      expect(commands('切り替える')).not.toContain('git add .')
    })

    it('漢字 1 文字の言葉は、違う言葉と取り違えない (戻る は 戻す ではない)', () => {
      expect(has('戻る', 'git switch main')).toBe(true)
      expect(has('戻る', 'git restore index.html')).toBe(false)
      expect(has('戻したい', 'git restore index.html')).toBe(true)
      expect(has('取り消す', 'git commit --amend --no-edit')).toBe(false)
    })

    it('日本語で探すときは、英語の言い換えでファイル名に合ってしまわない', () => {
      expect(has('履歴', 'git check-ignore -v debug.log')).toBe(false)
      expect(has('保存', 'chmod +x .git/hooks/pre-commit')).toBe(false)
    })

    it('空白で区切った言葉は、すべて合うものだけを出す', () => {
      expect(commands('マージ やめる')).toEqual(['git merge --abort'])
      expect(commands('ブランチ 作る').slice(0, 3)).toEqual(['git branch feature', 'git switch -c feature', 'git checkout -b feature'])
    })
  })

  it('最大の件数を守り、入力と同じコマンドしか合わないときは出さない', () => {
    expect(suggest('git', 5)).toHaveLength(5)
    expect(suggest('git diff --staged')).toEqual([])
  })

  it('候補は同じコマンドを 2 度含まず、最初に試す例にはヘルプの説明が付く', () => {
    const all = allSuggestions()
    expect(new Set(all.map((item) => item.command)).size).toBe(all.length)
    expect(starterSuggestions().map((item) => item.command)).toEqual(STARTER_COMMANDS)
    expect(all.find((item) => item.command === 'git add .')?.description).not.toBe('')
  })
})
