import { useEffect, useState } from 'react'

interface ShareButtonProps {
  /** 押したときに共有する URL を返す。 */
  readonly getUrl: () => string
}

type CopyState = 'idle' | 'copied' | 'failed'

/** 現在の状態を再現できる URL をクリップボードにコピーするボタン。 */
export function ShareButton({ getUrl }: ShareButtonProps) {
  const [state, setState] = useState<CopyState>('idle')
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null)

  useEffect(() => {
    if (state === 'idle') return
    const timer = window.setTimeout(() => setState('idle'), 2000)
    return () => window.clearTimeout(timer)
  }, [state])

  const copy = async () => {
    const url = getUrl()
    try {
      await navigator.clipboard.writeText(url)
      setFallbackUrl(null)
      setState('copied')
    } catch {
      // クリップボードを使えない環境では、URL を表示して手でコピーしてもらう
      setFallbackUrl(url)
      setState('failed')
    }
  }

  return (
    <div className="share">
      <button type="button" className="share-button" onClick={() => void copy()}>
        {state === 'copied' ? 'コピーしました' : '共有リンクをコピー'}
      </button>
      {fallbackUrl && (
        <input
          className="share-url"
          type="text"
          readOnly
          value={fallbackUrl}
          aria-label="共有リンク"
          onFocus={(event) => event.target.select()}
          autoFocus
        />
      )}
    </div>
  )
}
