// Laying a speech bubble out in terminal cells: CJK and kana take two.

import type { StageBubble } from '../types'

function cellWidth(cp: number): number {
  const isWide =
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    cp >= 0x1f300
  return isWide ? 2 : 1
}

export function textWidth(text: string): number {
  let width = 0
  for (const ch of text) {
    width += cellWidth(ch.codePointAt(0)!)
  }
  return width
}

export function wrap(text: string, max: number): string[] {
  const lines: string[] = []
  let line = ''
  let width = 0
  for (const ch of text) {
    const w = cellWidth(ch.codePointAt(0)!)
    if (width + w > max && line !== '') {
      lines.push(line)
      line = ''
      width = 0
    }
    line += ch
    width += w
  }
  if (line !== '') {
    lines.push(line)
  }
  return lines
}

export type BubbleLayout = { top: number; left: number; lines: string[] }

// Above the speaker's head, kept inside the stage; `head` is in pixels.
export function layout(bubble: StageBubble, columns: number): BubbleLayout {
  const lines = wrap(`${bubble.name}：${bubble.text}`, Math.max(8, Math.min(24, columns - 4))).slice(0, 3)
  const width = Math.max(...lines.map(textWidth)) + 2
  const height = lines.length + 2
  const top = Math.max(0, Math.floor(bubble.head / 2) - height + 1)
  const left = Math.min(Math.max(0, Math.round(bubble.x) - Math.floor(width / 2)), Math.max(0, columns - width))
  return { top, left, lines }
}
