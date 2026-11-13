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
    expect(result.every((item) => item.description.includes('取り消す') || item.command.includes('取り消す'))).toBe(true)
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
