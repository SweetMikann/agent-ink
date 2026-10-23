import type { ReactNode } from 'react'
import { InvisibleInk } from './InvisibleInk'

/* 消息里用 ||…|| 包起来的字（全角 ｜｜ 也认）会藏进墨水；竖线本身不显示，竖线外的字照常露着。 */
const INK_SECRET = /[|｜][|｜]([\s\S]+?)[|｜][|｜]/g

export function splitSecrets(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0, k = 0, m: RegExpExecArray | null
  INK_SECRET.lastIndex = 0
  while ((m = INK_SECRET.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(<span className="ink-secret" key={`s${k += 1}`}>{m[1]}</span>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** 直接渲染一条纯文字消息：没有 ||…|| 就原样返回，有就套上隐形墨水。 */
export function InkMessage({ text, dustColor }: { text: string; dustColor?: string }) {
  INK_SECRET.lastIndex = 0
  if (!INK_SECRET.test(text)) return <>{text}</>
  return <InvisibleInk dustColor={dustColor}>{splitSecrets(text)}</InvisibleInk>
}
