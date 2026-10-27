/**
 * 画面のテーマ (自動 / ライト / ダーク)。React と DOM には依存させず、要素と保存先は外から渡す。
 * テーマは見る人の好みなので、URL 共有には含めない。
 */

export type Theme = 'auto' | 'light' | 'dark'

export const THEMES: readonly Theme[] = ['auto', 'light', 'dark']

export const THEME_KEY = 'branch-lab:theme'

/** 保存されていた値をテーマにする。想定外の値や null は自動。 */
export function parseTheme(value: string | null): Theme {
  return value === 'light' || value === 'dark' || value === 'auto' ? value : 'auto'
}

export interface ThemeRoot {
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
}

/** ルート要素の data-theme 属性を設定する。自動なら属性を外し、OS の設定 (prefers-color-scheme) に従わせる。 */
export function applyTheme(theme: Theme, root: ThemeRoot): void {
  if (theme === 'auto') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}

/** 保存したテーマを読む。localStorage が使えない環境 (プライベートブラウズなど) では自動。 */
export function loadTheme(): Theme {
  try {
    return parseTheme(localStorage.getItem(THEME_KEY))
  } catch {
    return 'auto'
  }
}

/** テーマを保存する。保存できない環境では、その場限りにする。 */
export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // 保存できなくても、今の画面のテーマは変わっているので何もしない
  }
}
