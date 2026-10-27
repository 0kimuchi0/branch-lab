import { useState } from 'react'
import { THEMES, applyTheme, loadTheme, saveTheme, type Theme } from '../theme/theme'

const LABELS: Readonly<Record<Theme, string>> = {
  auto: '自動',
  light: 'ライト',
  dark: 'ダーク',
}

/** ヘッダーのテーマの切り替え (自動 / ライト / ダーク)。選んだテーマは保存し、次に開いたときも使う。 */
export function ThemeToggle() {
  // index.html のスクリプトが描画前に同じ値を反映しているので、ボタンの選択と見た目はずれない
  const [theme, setTheme] = useState<Theme>(loadTheme)

  const select = (next: Theme) => {
    setTheme(next)
    applyTheme(next, document.documentElement)
    saveTheme(next)
  }

  return (
    <div className="theme-toggle" role="group" aria-label="テーマ">
      {THEMES.map((item) => (
        <button key={item} type="button" aria-pressed={theme === item} onClick={() => select(item)}>
          {LABELS[item]}
        </button>
      ))}
    </div>
  )
}
