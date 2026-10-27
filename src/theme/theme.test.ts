import { describe, expect, it } from 'vitest'
import { applyTheme, parseTheme } from './theme'

describe('parseTheme', () => {
  it('auto / light / dark はそのまま、それ以外は auto', () => {
    expect(parseTheme('light')).toBe('light')
    expect(parseTheme('dark')).toBe('dark')
    expect(parseTheme('auto')).toBe('auto')
    expect(parseTheme(null)).toBe('auto')
    expect(parseTheme('other')).toBe('auto')
  })
})

describe('applyTheme', () => {
  /** setAttribute / removeAttribute だけを持つ偽のルート要素。 */
  function fakeRoot() {
    const attributes = new Map<string, string>()
    return {
      attributes,
      setAttribute: (name: string, value: string) => void attributes.set(name, value),
      removeAttribute: (name: string) => void attributes.delete(name),
    }
  }

  it('light / dark は data-theme に入れ、auto は属性を外す', () => {
    const root = fakeRoot()
    applyTheme('dark', root)
    expect(root.attributes.get('data-theme')).toBe('dark')
    applyTheme('light', root)
    expect(root.attributes.get('data-theme')).toBe('light')
    applyTheme('auto', root)
    expect(root.attributes.has('data-theme')).toBe(false)
  })
})
