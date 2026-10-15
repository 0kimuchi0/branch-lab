import { Fragment } from 'react'

/** `…` の部分をコードとして表示する 1 段落。 */
export function InlineText({ text }: { readonly text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/).map((part, index) =>
        part.startsWith('`') && part.endsWith('`') && part.length > 1 ? (
          <code key={index}>{part.slice(1, -1)}</code>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  )
}

/** 空行で区切った段落を <p> にする。 */
export function Paragraphs({ text }: { readonly text: string }) {
  return (
    <>
      {text.split('\n\n').map((paragraph, index) => (
        <p key={index}>
          <InlineText text={paragraph} />
        </p>
      ))}
    </>
  )
}
