// Usage reports the girls read out: numbers put into Chinese for the bubble
// and Japanese for the voice, and the text a /waifu report prints.

import type { Line } from './cast'

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number }

export type Day = Usage & {
  date: string
  turns: number
  workMs: number
  tools: number
  errors: number
  costUsd: number
  // The most new tokens one turn took in (`freshOf`), cache hits aside.
  biggestTurn: number
  measure: 'fresh'
  // Commands the guard stopped and reviews run today.
  blocked?: number
  reviews?: number
}

export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

export const emptyDay = (date: string): Day => ({
  ...emptyUsage(),
  date,
  turns: 0,
  workMs: 0,
  tools: 0,
  errors: 0,
  costUsd: 0,
  biggestTurn: 0,
  measure: 'fresh',
})

export const totalOf = (usage: Usage) => usage.input + usage.output + usage.cacheRead + usage.cacheWrite

// What a turn took in anew: cache hits are re-read context, not new work, and
// a long session re-reads its whole context on every request.
export const freshOf = (usage: Usage) => usage.input + usage.cacheWrite + usage.output

// 12345 → 1.2万; 123456789 → 1.2亿.
export function zhCount(n: number): string {
  if (n >= 1e8) {
    return `${(n / 1e8).toFixed(1)}亿`
  }
  if (n >= 1e4) {
    return `${(n / 1e4).toFixed(n >= 1e5 ? 0 : 1)}万`
  }
  return String(Math.round(n))
}

// Read aloud: 約12万, 約1億.
export function jaCount(n: number): string {
  if (n >= 1e8) {
    return `約${Math.round(n / 1e8)}億`
  }
  if (n >= 1e4) {
    return `約${Math.round(n / 1e4)}万`
  }
  return String(Math.round(n))
}

export function zhDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  const hours = Math.floor(minutes / 60)
  if (hours >= 24) {
    return `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`
  }
  return hours > 0 ? `${hours} 小时 ${minutes % 60} 分` : `${minutes} 分钟`
}

function jaDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  const hours = Math.floor(minutes / 60)
  if (hours >= 24) {
    return `${Math.floor(hours / 24)}日と${hours % 24}時間`
  }
  return hours > 0 ? `${hours}時間${minutes % 60}分` : `${minutes}分`
}

const WINDOWS: Record<string, [string, string]> = {
  five_hour: ['5 小时', '5時間'],
  seven_day: ['7 天', '1週間'],
}

const windowName = (kind: string): [string, string] => WINDOWS[kind] ?? [kind, kind]

const untilReset = (limit: Limit, now: number) =>
  limit.resetsAt === undefined ? undefined : Math.max(0, Date.parse(limit.resetsAt) - now)

export function contextLine(percent: number, tokens: number | undefined, window: number): Line {
  const used = tokens === undefined ? '' : `（${zhCount(tokens)} / ${zhCount(window)}）`
  return { ja: `コンテキストは${percent}パーセントよ`, zh: `上下文用了 ${percent}%${used}` }
}

export function briefLine(percent: number | undefined, limits: readonly Limit[]): Line {
  const five = limits.find(limit => limit.kind === 'five_hour') ?? limits[0]
  const ctx = percent === undefined ? undefined : `上下文 ${percent}%`
  const quota = five === undefined ? undefined : `${windowName(five.kind)[0]}额度用了 ${Math.round(five.percentUsed)}%`
  return {
    ja:
      (percent === undefined ? '' : `コンテキスト${percent}パーセント、`) +
      (five === undefined ? '残りはたっぷりよ' : `${windowName(five.kind)[1]}の枠は${Math.round(five.percentUsed)}パーセント使ったわ`),
    zh: [ctx, quota].filter(Boolean).join('，') || '额度还多着呢',
  }
}

export function ateLine(tokens: number): Line {
  return { ja: `今のターンで${jaCount(tokens)}トークン食べちゃった！`, zh: `这一轮吃掉了 ${zhCount(tokens)} token！` }
}

export function contextAlert(level: number, percent: number): Line {
  if (level >= 95) {
    return { ja: 'もう限界！今すぐコンパクトして！', zh: `上下文 ${percent}%，快满了！马上 /compact！` }
  }
  if (level >= 80) {
    return { ja: 'コンテキストが八割よ、そろそろコンパクトしましょ', zh: `上下文 ${percent}% 了，该 /compact 了` }
  }
  return { ja: 'コンテキスト、半分まで来たわ', zh: `上下文已经用了一半（${percent}%）` }
}

export function limitAlert(limit: Limit, now: number): Line {
  const [zh, ja] = windowName(limit.kind)
  const left = untilReset(limit, now)
  const percent = Math.round(limit.percentUsed)
  return {
    ja: `${ja}の枠、${percent}パーセント使ったわ` + (left === undefined ? '' : `。リセットまで${jaDuration(left)}よ`),
    zh: `${zh}额度用了 ${percent}%` + (left === undefined ? '' : `，${zhDuration(left)}后重置`),
  }
}

export function costLine(usd: number): Line {
  return { ja: `このセッションで、もう${usd}ドル使ったわよ！`, zh: `这次会话已经花了 $${usd}！` }
}

export function dayComment(day: Day): Line {
  if (day.turns >= 20) {
    return { ja: '今日は頑張りすぎよ、ちゃんと休んでね', zh: `今天聊了 ${day.turns} 轮，太拼了，记得休息` }
  }
  if (day.turns >= 5) {
    return { ja: '今日もお疲れさま！', zh: `今天 ${day.turns} 轮，辛苦啦！` }
  }
  return { ja: '今日はのんびりね', zh: `今天才 ${day.turns} 轮，挺悠闲嘛` }
}

const FORTUNES: readonly (readonly [string, string, string])[] = [
  ['大吉', '大吉！今日はバグゼロの予感！', '大吉！今天预感零 bug！'],
  ['中吉', '中吉。テストは一発で通るかも', '中吉。测试可能一次就过'],
  ['小吉', '小吉。リファクタリング日和ね', '小吉。适合重构的一天'],
  ['吉', '吉。コミットはこまめにね', '吉。记得勤提交'],
  ['末吉', '末吉。ドキュメントを読むと運が開けるわ', '末吉。多读文档会转运'],
  ['凶', '凶…今日は本番デプロイ禁止！', '凶…今天禁止上线！'],
  ['大凶', '大凶！？金曜のデプロイは絶対ダメ！', '大凶！？千万别周五上线！'],
]

export function fortune(roll: number): { name: string; line: Line } {
  const [name, ja, zh] = FORTUNES[Math.floor(roll * FORTUNES.length) % FORTUNES.length]!
  return { name, line: { ja, zh } }
}

export type Snapshot = {
  name: string
  percent?: number
  tokens?: number
  window: number
  limits: readonly Limit[]
  costUsd?: number
  session: Usage
  turns: number
  last?: Usage
  now: number
}

// The text `/waifu token` prints.
export function usageReport(s: Snapshot): string {
  const lines = [`📊 ${s.name}的用量播报`]
  if (s.percent !== undefined) {
    lines.push(`上下文：${s.percent}%` + (s.tokens === undefined ? '' : `（${zhCount(s.tokens)} / ${zhCount(s.window)}）`))
  }
  lines.push(
    `本次会话：${s.turns} 轮 · 输入 ${zhCount(s.session.input + s.session.cacheRead + s.session.cacheWrite)}` +
      `（缓存命中 ${zhCount(s.session.cacheRead)}）· 输出 ${zhCount(s.session.output)}` +
      (s.costUsd === undefined ? '' : ` · 约 $${s.costUsd.toFixed(2)}`),
  )
  for (const limit of s.limits) {
    const left = untilReset(limit, s.now)
    lines.push(
      `额度：${windowName(limit.kind)[0]}窗口用了 ${Math.round(limit.percentUsed)}%` +
        (left === undefined ? '' : `（${zhDuration(left)}后重置）`),
    )
  }
  if (s.limits.length === 0) {
    lines.push('额度：没有拿到额度窗口（按量计费或网关模式）')
  }
  if (s.last !== undefined) {
    lines.push(`上一轮：输入 ${zhCount(s.last.input + s.last.cacheRead + s.last.cacheWrite)} · 输出 ${zhCount(s.last.output)}`)
  }
  return lines.join('\n')
}

// The text `/waifu today` prints.
export function dayReport(name: string, day: Day): string {
  return [
    `📅 ${name}的今日日报（${day.date}）`,
    `对话 ${day.turns} 轮 · 干活 ${zhDuration(day.workMs)} · 工具 ${day.tools} 次（报错 ${day.errors} 次）`,
    `token：输入 ${zhCount(day.input + day.cacheRead + day.cacheWrite)}（缓存命中 ${zhCount(day.cacheRead)}）· 输出 ${zhCount(day.output)}`,
    `花费：约 $${day.costUsd.toFixed(2)} · 最能吃的一轮：${zhCount(day.biggestTurn)} token（不含缓存命中）`,
    `值班：安全检查拦下 ${day.blocked ?? 0} 条命令 · review ${day.reviews ?? 0} 次`,
  ].join('\n')
}

// What a girl reads out when a turn ends: the new tokens it took and how full
// the context is.
export function turnBrief(tokens: number, percent: number | undefined): Line {
  return {
    ja: `今回は${jaCount(tokens)}トークン` + (percent === undefined ? 'よ' : `、コンテキストは${percent}パーセントよ`),
    zh: `这一轮 ${zhCount(tokens)} token` + (percent === undefined ? '' : `，上下文 ${percent}%`),
  }
}

export function budgetLine(mark: number, usd: number, budget: number): Line {
  return { ja: `予算の${mark}パーセントを使ったわ`, zh: `预算用了 ${mark}%（$${usd.toFixed(2)} / $${budget}）` }
}
