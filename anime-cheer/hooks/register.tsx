import { atom, read, update } from 'claude-code'
import type {
  Elements,
  EngineInterface,
  Register,
  RenderElement,
  SessionContextUsage,
  SessionCost,
  SessionRateLimit,
  TurnCompleteInput,
  TurnUsage,
} from 'claude-code'

import type { StageBubble, StageView } from '../types'
import { addPack, BLANK_CELL, canDraw, encode, heightOf, spans } from './art'
import { layout, textWidth } from './bubble'
import {
  ateLine,
  briefLine,
  contextAlert,
  costLine,
  dayComment,
  dayReport,
  emptyDay,
  emptyUsage,
  fortune,
  limitAlert,
  totalOf,
  usageReport,
  zhCount,
  type Day,
  type Limit,
  type Usage,
} from './report'
import {
  BANTER,
  CAST,
  clipPath,
  findGirl,
  GIRLS,
  spoken,
  subtitle,
  TOOL_TALK,
  voiceFor,
  type Girl,
  type Line,
  type Moment,
  type VoiceEngine,
} from './cast'
import {
  createWorld,
  draw,
  drawActor,
  enter,
  leave,
  moveLength,
  onStage,
  perform,
  resize,
  setMode,
  tick,
  wake,
  type Actor,
  type Placed,
} from './world'

const PANE = 'anime-cheer'
const TICK_MS = 150
const TEA_AFTER_TURN_MS = 22_000
const TEA_AFTER_ABORT_MS = 8_000
const TEA_AFTER_THINKING_MS = 6_000
const THINKING_TEA_GAP_MS = 45_000
const CHAT_MODEL = 'haiku'

type Loudness = 'key' | 'event' | 'chatter' | 'silent'
type VoiceMode = 'on' | 'less' | 'off'
type Talk = StageBubble & { until: number }
type Pending = { at: number; id: string; text: Line; loudness: Loudness }
type Place = 'roam' | 'pane'
type OnScreen = { first: number; last: number; of: number }
type Site = { seq: number; onScreen: OnScreen | null; columns: number; rows: number }

// A transcript row the stage can hang from, as its render hook sees it.
type SiteEvent = {
  requestId: string
  viewport?: { columns: number; rows: number; isFullscreen?: boolean }
  props: { onScreen?: OnScreen | null }
}

const stage = atom({ plugin: 'anime-cheer', key: 'stage' } as const, { caption: '', bubbles: [] } as StageView)
const anchor = atom({ plugin: 'anime-cheer', key: 'anchor' } as const, '')
const frame = atom({ plugin: 'anime-cheer', key: 'frame' } as const, 0)

let world = createWorld(48, 26, 0)
let isOpen = false
let isDismissed = false
let isRunning = false
let startedAt = 0
let tools = 0
let teaUntil = 0
let lastTurn = { seconds: 0, tools: 0 }
let lastThinkingTea = 0
let voiceMode: VoiceMode = 'on'
let isChatty = true
let isSpeaking = false
let tts: string | undefined
let voiceEngine: VoiceEngine = 'edge'
let vox: { run?: string; url?: string; speakers?: Record<string, number> } = {}
let talk: Talk[] = []
let pending: Pending[] = []
let shown = ''
let lastCells = ''
let nextChatAt = 0
let nextWorkTalkAt = 0
let nextRotateAt = 0
let nextClockCheck = 0
let lastToolTalk = 0
let lastErrorTalk = 0
let lastNightTalk = 0
let lastAiComment = 0
let longNotices = 0
let hour = 12
let liveClip = 0
let place: Place = 'roam'
let isHidden = false
let isMainScreen = false
let sites = new Map<string, Site>()
let siteSeq = 0
let anchorShown = ''
let today = ''
let day: Day = emptyDay('')
let sessionUsage: Usage = emptyUsage()
let turnsDone = 0
let lastUsage: Usage | undefined
let meter: { percent?: number; tokens?: number; window: number; limits: Limit[]; costUsd?: number } = { window: 0, limits: [] }
let contextLevel = 0
let limitLevels = new Map<string, number>()
let costLevel = 0
let lastCostUsd: number | undefined
let anchoredAt = 0
let lastStatus = ''

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo)
const pick = <T,>(list: readonly T[]): T | undefined => list[Math.floor(Math.random() * list.length)]

const HELP = [
  '/waifu            显示或隐藏应援团',
  '/waifu 漫游 | 面板  在对话区里自由走动，或待在侧边面板',
  '/waifu <话>        和随机一位聊天；“凛 你好”指定某人',
  '/waifu 名单        看看都有谁',
  '/waifu 叫 <名字>   召唤一位上台；/waifu 退下 <名字>',
  '/waifu 换人        换一批人',
  '/waifu 静音 | 少说 | 声音   配音全关、只留关键、全开',
  '/waifu ai 关 | ai 开        AI 即兴聊天开关',
  '/waifu token       让她播报上下文、额度和 token 消耗',
  '/waifu 日报        今天聊了几轮、干了多久、吃了多少 token',
  '/waifu 抽签        抽一签今天的编码运势',
].join('\n')

const LEVELS = [95, 80, 50]
const COST_STEPS = [1, 5, 10, 20, 50, 100]
const BIG_TURN = 150_000

function lineOf(girl: Girl, moment: Moment): Line | undefined {
  return pick(girl.lines[moment] ?? [])
}

function free(): Actor[] {
  return onStage(world).filter(actor => actor.act !== 'enter' && actor.act !== 'sleep')
}

function actorOf(id: string): Actor | undefined {
  return onStage(world).find(actor => actor.id === id)
}

function isLoud(loudness: Loudness): boolean {
  if (loudness === 'silent' || voiceMode === 'off') {
    return false
  }
  if (voiceMode === 'less') {
    return loudness === 'key'
  }
  return loudness !== 'chatter' || Math.random() < 0.6
}

function caption(now: number): string {
  const names = onStage(world)
    .map(actor => GIRLS.get(actor.id)?.name)
    .join('、')
  const mute = voiceMode === 'off' ? ' · 🔇' : ''
  if (world.mode === 'work') {
    return `♪ 应援中 · ${Math.round((now - startedAt) / 1000)}s · ${tools} 次工具 · ${names}${mute}`
  }
  const context = meter.percent === undefined ? '' : ` · 上下文 ${meter.percent}%`
  if (world.mode === 'tea') {
    const eaten = lastUsage === undefined ? '' : ` · ${zhCount(totalOf(lastUsage))} token`
    return `🍵 茶歇中 · 本轮 ${lastTurn.seconds}s · ${lastTurn.tools} 次工具${eaten}${context}${mute}`
  }
  return `🌸 ${names}${context} · /waifu help${mute}`
}

async function publish($: EngineInterface, now: number) {
  const next: StageView = {
    caption: caption(now),
    bubbles: talk.map(({ until, ...bubble }) => bubble),
  }
  const key = JSON.stringify(next)
  if (key !== shown) {
    shown = key
    await update($, stage, () => next)
  }
}

async function open($: EngineInterface) {
  const opened = await $.ui.open({ id: PANE, title: '应援团', rows: 26, columns: 64 })
  isOpen = opened.isPlaced
}

async function savePrefs($: EngineInterface) {
  await $.store.set('prefs', {
    place,
    voice: voiceMode,
    ai: isChatty,
    cast: onStage(world).map(actor => actor.id),
  })
}

// The girls who can take the stage: imported packs, or the stand-ins.
function available(): Girl[] {
  return CAST.filter(girl => canDraw(girl))
}

function shuffled(): string[] {
  return available()
    .map(girl => ({ id: girl.id, order: Math.random() }))
    .sort((a, b) => a.order - b.order)
    .map(({ id }) => id)
}

const castSize = () => (Math.random() < 0.5 ? 1 : 2)

async function loadPacks($: EngineInterface) {
  let entries: { name: string; kind: string }[] = []
  try {
    entries = await $.fs.list(`${$.plugin.root}/packs`)
  } catch {
    return
  }
  for (const entry of entries.filter(one => one.kind === 'dir')) {
    try {
      addPack(await $.fs.read(`${$.plugin.root}/packs/${entry.name}/pack.json`))
    } catch {
      // A pack that does not read is left out.
    }
  }
}

async function loadPrefs($: EngineInterface, now: number) {
  const prefs = ((await $.store.get('prefs')) ?? {}) as { place?: Place; voice?: VoiceMode; ai?: boolean; cast?: string[] }
  place = prefs.place ?? 'roam'
  voiceMode = prefs.voice ?? 'on'
  isChatty = prefs.ai ?? true
  const saved = (prefs.cast ?? []).filter(id => canDraw(GIRLS.get(id))).slice(0, 2)
  const cast = saved.length > 0 ? saved : shuffled().slice(0, castSize())
  world = createWorld(world.w, world.h, now)
  world.isRoaming = place === 'roam'
  for (const id of cast) {
    enter(world, id, now, true)
  }
}

async function findTts($: EngineInterface) {
  try {
    const engine = JSON.parse(await $.fs.read(`${$.plugin.root}/voices/engine.json`)) as {
      tts?: string
      engine?: VoiceEngine
      voicevox?: { run?: string; url?: string; speakers?: Record<string, number> }
    }
    tts = engine.tts
    voiceEngine = engine.engine ?? 'edge'
    vox = engine.voicevox ?? {}
  } catch {
    tts = undefined
  }
}

async function voxLive($: EngineInterface, girl: Girl, text: string, file: string): Promise<boolean> {
  const url = vox.url ?? 'http://127.0.0.1:50021'
  const id = girl.vox === undefined ? undefined : vox.speakers?.[`${girl.vox.speaker}|${girl.vox.style}`]
  if (id === undefined) {
    return false
  }
  const up = await $.process.run(['curl', '-s', '-m', '2', `${url}/version`], { timeoutMs: 4000 })
  if (up.exitCode !== 0) {
    if (vox.run !== undefined) {
      await $.process.run(['/bin/sh', '-c', 'nohup "$1" --host 127.0.0.1 --port 50021 >/tmp/anime-cheer-voicevox.log 2>&1 &', 'sh', vox.run])
    }
    return false
  }
  const made = await $.process.run(
    [
      '/bin/sh',
      '-c',
      'rm -f "$3"; curl -sf -X POST "$1" | curl -sf -X POST -H "Content-Type: application/json" --data-binary @- "$2" -o "$3" && test -s "$3"',
      'sh',
      `${url}/audio_query?speaker=${id}&text=${encodeURIComponent(text)}`,
      `${url}/synthesis?speaker=${id}`,
      file,
    ],
    { timeoutMs: 30_000 },
  )
  return made.exitCode === 0
}

// Speech that is not in the catalog: synthesized now, then played.
async function speakLive($: EngineInterface, girl: Girl, line: Line) {
  const text = spoken(line)
  liveClip = (liveClip + 1) % 4
  try {
    if (voiceEngine === 'voicevox' && girl.vox !== undefined) {
      const file = `/tmp/anime-cheer-live-${liveClip}.wav`
      if (await voxLive($, girl, text, file)) {
        await $.process.run(['afplay', file], { timeoutMs: 30_000 })
        return
      }
    }
    if (tts === undefined) {
      return
    }
    const voice = voiceFor(girl, text)
    const file = `/tmp/anime-cheer-live-${liveClip}.mp3`
    await $.process.run(['rm', '-f', file], { timeoutMs: 3000 })
    const made = await $.process.run(
      [tts, '--voice', voice.name, `--rate=${voice.rate}`, `--pitch=${voice.pitch}`, '--text', text, '--write-media', file],
      { timeoutMs: 20_000 },
    )
    if (made.exitCode === 0) {
      await $.process.run(['afplay', file], { timeoutMs: 30_000 })
    }
  } catch {
    // No voice this time; the bubble still shows.
  }
}

async function playVoice($: EngineInterface, girl: Girl, line: Line) {
  if (isSpeaking) {
    return
  }
  isSpeaking = true
  try {
    await $.audio.play({ asset: clipPath(girl, line, voiceEngine) })
  } catch {
    await speakLive($, girl, line)
  } finally {
    isSpeaking = false
  }
}

async function say($: EngineInterface, actor: Actor | undefined, line: Line | undefined, loudness: Loudness) {
  const girl = actor === undefined ? undefined : GIRLS.get(actor.id)
  if (actor === undefined || girl === undefined || line === undefined || subtitle(line) === '') {
    return
  }
  const now = await $.clock.now()
  const text = subtitle(line)
  const ms = Math.min(9000, 2500 + Math.max(text.length, spoken(line).length) * 200)
  actor.talkUntil = now + ms
  talk = [
    ...talk.filter(one => one.key !== actor.id),
    { key: actor.id, name: girl.name, color: girl.color, text, x: actor.x / 2, head: actor.y - heightOf(girl), until: now + ms },
  ]
  await publish($, now)
  if (isLoud(loudness)) {
    void playVoice($, girl, line)
  }
}

// One line from the chat model in a girl's own voice: Japanese with its
// Chinese for the troupe, Chinese for the stand-ins; undefined when off.
async function improvise($: EngineInterface, girl: Girl, prompt: string): Promise<Line | undefined> {
  const isJapanese = girl.pack !== undefined
  const reply = await $.model.complete({
    model: CHAT_MODEL,
    system:
      `你在一个程序员的终端里扮演动漫角色${girl.name}（${girl.kind}）：${girl.persona}。` +
      (isJapanese
        ? '用日语说一句口语化的台词（不超过30个字），再给出中文翻译，只输出“日语｜中文”这一行。'
        : '只回一句口语化的话，不超过30个字。') +
      '不加引号、不用表情符号、不提自己是AI，内容健康友善。',
    prompt,
    maxTokens: 160,
    timeoutMs: 15_000,
  })
  if (!reply.isAnswered) {
    return undefined
  }
  const clean = (text: string) => text.replace(/^["“「『]|["”」』]$/g, '').replace(/\s+/g, ' ').trim()
  if (isJapanese) {
    const [ja = '', zh = ''] = reply.text.split(/[｜|]/).map(clean)
    return ja === '' || zh === '' ? undefined : { ja: ja.slice(0, 60), zh: zh.slice(0, 48) }
  }
  const text = clean(reply.text)
  return text === '' ? undefined : text.slice(0, 48)
}

async function comment($: EngineInterface, answer: string) {
  const now = await $.clock.now()
  const actor = pick(free())
  const girl = actor === undefined ? undefined : GIRLS.get(actor.id)
  if (girl === undefined || actor === undefined) {
    return
  }
  lastAiComment = now
  const line = await improvise(
    $,
    girl,
    `AI 助手刚帮用户完成了一轮工作，它的回复开头是：「${answer.slice(0, 400)}」。请用你的口吻对用户说一句评价或鼓励。`,
  )
  if (line !== undefined) {
    pending.push({ at: (await $.clock.now()) + 500, id: actor.id, text: line, loudness: 'key' })
  }
}

async function chatWith($: EngineInterface, girl: Girl, words: string) {
  const now = await $.clock.now()
  if (actorOf(girl.id) === undefined) {
    for (const extra of free().slice(1)) {
      leave(world, extra.id)
    }
    enter(world, girl.id, now)
  }
  wake(world, now)
  const line = isChatty ? await improvise($, girl, `用户对你说：「${words}」`) : undefined
  pending.push({ at: (await $.clock.now()) + 300, id: girl.id, text: line ?? lineOf(girl, 'idle') ?? '……', loudness: 'key' })
}

async function chatter($: EngineInterface, now: number) {
  const cast = free()
  nextChatAt = now + rand(35_000, 80_000)
  if (cast.length === 0) {
    return
  }
  const here = new Set(cast.map(actor => actor.id))
  const pairs = BANTER.filter(([a, , b]) => here.has(a) && here.has(b))
  const roll = Math.random()
  if (roll < 0.3 && pairs.length > 0) {
    const [a, first, b, second] = pick(pairs)!
    await say($, actorOf(a), first, 'chatter')
    pending.push({ at: now + 4000, id: b, text: second, loudness: 'chatter' })
    return
  }
  const actor = pick(cast)!
  const girl = GIRLS.get(actor.id)!
  const isNight = hour >= 0 && hour < 5
  if (isNight && now - lastNightTalk > 30 * 60_000) {
    lastNightTalk = now
    await say($, actor, lineOf(girl, 'night'), 'event')
    return
  }
  await say($, actor, lineOf(girl, roll < 0.5 ? 'tip' : 'idle'), 'chatter')
}

// Now and then one girl leaves and another comes; one or two at a time.
async function rotate($: EngineInterface, now: number) {
  nextRotateAt = now + rand(4 * 60_000, 8 * 60_000)
  const cast = free()
  const incoming = pick(available().filter(girl => actorOf(girl.id) === undefined))
  const outgoing = pick(cast)
  const shouldLeave = outgoing !== undefined && (cast.length >= 2 || incoming !== undefined) && (cast.length >= 2 || Math.random() < 0.5)
  if (shouldLeave) {
    await say($, outgoing, lineOf(GIRLS.get(outgoing.id)!, 'bye'), 'event')
    pending.push({ at: now + 3000, id: `leave:${outgoing.id}`, text: '', loudness: 'silent' })
  }
  const after = cast.length - (shouldLeave ? 1 : 0)
  if (incoming !== undefined && (after === 0 || (after === 1 && Math.random() < 0.6))) {
    enter(world, incoming.id, now)
    pending.push({ at: now + 6000, id: incoming.id, text: lineOf(incoming, 'hello') ?? '', loudness: 'event' })
  }
}

async function checkClock($: EngineInterface, now: number) {
  nextClockCheck = now + 20 * 60_000
  try {
    const out = await $.process.run(['date', '+%H %F'], { timeoutMs: 3000 })
    const [h = '12', date = ''] = out.stdout.trim().split(' ')
    hour = Number(h)
    if (date !== '' && date !== today) {
      today = date
      const saved = (await $.store.get(`day:${date}`)) as Day | undefined
      day = { ...emptyDay(date), ...(saved?.date === date ? saved : {}) }
    }
  } catch {
    hour = 12
  }
}

async function saveDay($: EngineInterface) {
  if (today !== '') {
    await $.store.set(`day:${today}`, day)
  }
}

function addUsage(usage: TurnUsage): Usage {
  const turn: Usage = {
    input: usage.input_tokens,
    output: usage.output_tokens,
    cacheRead: usage.cache_read_input_tokens,
    cacheWrite: usage.cache_creation_input_tokens,
  }
  for (const total of [sessionUsage, day]) {
    total.input += turn.input
    total.output += turn.output
    total.cacheRead += turn.cacheRead
    total.cacheWrite += turn.cacheWrite
  }
  return turn
}

// New figures for the context, the rate-limit windows and the cost: crossing
// a step is read out once (unless `isQuiet`, which only takes the readings).
async function measured(
  $: EngineInterface,
  context: SessionContextUsage,
  limits: readonly SessionRateLimit[],
  cost: SessionCost | undefined,
  isQuiet: boolean,
) {
  const now = await $.clock.now()
  meter = { percent: context.percent, tokens: context.tokens, window: context.window, limits: [...limits], costUsd: cost?.usd }
  const alerts: Line[] = []
  const percent = context.percent ?? 0
  const level = LEVELS.find(mark => percent >= mark) ?? 0
  if (level > contextLevel) {
    alerts.push(contextAlert(level, percent))
  }
  contextLevel = percent < 40 ? 0 : Math.max(contextLevel, level)
  for (const limit of limits) {
    const key = `${limit.kind}|${(limit.resetsAt ?? '').slice(0, 13)}`
    const at = LEVELS.find(mark => limit.percentUsed >= mark) ?? 0
    if (at > (limitLevels.get(key) ?? 0)) {
      alerts.push(limitAlert(limit, now))
      limitLevels.set(key, at)
    }
  }
  if (cost !== undefined) {
    if (lastCostUsd !== undefined && cost.usd > lastCostUsd) {
      day.costUsd += cost.usd - lastCostUsd
    }
    lastCostUsd = cost.usd
    const reached = COST_STEPS.filter(usd => cost.usd >= usd).length
    if (reached > costLevel) {
      alerts.push(costLine(COST_STEPS[reached - 1]!))
      costLevel = reached
    }
  }
  if (isQuiet) {
    return
  }
  alerts.forEach((line, i) => {
    const actor = pick(free())
    if (actor !== undefined) {
      pending.push({ at: now + 500 + i * 6000, id: actor.id, text: line, loudness: 'key' })
    }
  })
}

// One frame of the stage: the world moves, people talk, the stage redraws.
async function step($: EngineInterface) {
  const now = await $.clock.now()
  if (world.mode === 'tea' && now >= teaUntil) {
    setMode(world, isRunning ? 'work' : 'idle', now)
  }
  tick(world, now)

  const due = pending.filter(one => one.at <= now)
  pending = pending.filter(one => one.at > now)
  for (const one of due) {
    if (one.id.startsWith('leave:')) {
      leave(world, one.id.slice('leave:'.length))
    } else if (subtitle(one.text) !== '') {
      await say($, actorOf(one.id), one.text, one.loudness)
    }
  }
  talk = talk.filter(one => one.until > now)

  if (world.mode === 'idle' && now >= nextChatAt && talk.length === 0) {
    await chatter($, now)
  }
  if (world.mode === 'work' && now >= nextWorkTalkAt) {
    nextWorkTalkAt = now + rand(15_000, 30_000)
    const actor = pick(free())
    await say($, actor, actor === undefined ? undefined : lineOf(GIRLS.get(actor.id)!, 'work'), 'chatter')
  }
  if (isRunning && longNotices < 2 && now - startedAt > (longNotices === 0 ? 120_000 : 300_000)) {
    longNotices += 1
    const actor = pick(free())
    await say($, actor, actor === undefined ? undefined : lineOf(GIRLS.get(actor.id)!, 'long'), 'event')
  }
  if (world.mode === 'idle' && now >= nextRotateAt) {
    await rotate($, now)
  }
  if (now >= nextClockCheck) {
    void checkClock($, now)
  }

  if (place === 'pane' && isOpen) {
    const cells = encode(draw(world, now))
    if (cells !== lastCells) {
      lastCells = cells
      void $.ui.blit({ requestId: PANE, key: 'stage', cells })
    }
  }
  if (place === 'roam') {
    await roam($)
  }
  await publish($, now)
}

// The newest transcript row on screen: the stage hangs above its last row.
function bottomRow(): string {
  let best = ''
  let bestSeq = -1
  for (const [id, site] of sites) {
    if (site.onScreen !== null && site.seq > bestSeq) {
      best = id
      bestSeq = site.seq
    }
  }
  return best
}

async function roam($: EngineInterface) {
  if (isMainScreen) {
    place = 'pane'
    world.isRoaming = false
    await update($, anchor, () => '')
    anchorShown = ''
    $.ui.status(undefined)
    $.ui.toast('不是全屏布局，应援团搬进面板啦')
    await open($)
    return
  }
  // A new anchor draws the girls anew, which costs the terminal fresh colors:
  // move at most every few seconds, unless the current one left the screen.
  const now = await $.clock.now()
  const newest = isHidden ? '' : bottomRow()
  const current = sites.get(anchorShown)
  const isGone = current === undefined || current.onScreen === null
  const id = newest !== anchorShown && (isHidden || isGone || now - anchoredAt >= 3000) ? newest : anchorShown
  if (id !== anchorShown) {
    anchorShown = id
    anchoredAt = now
    await update($, anchor, () => id)
  }
  const site = sites.get(id)
  if (site !== undefined) {
    const rows = Math.max(10, Math.min(30, site.rows - 14))
    const columns = Math.max(30, site.columns - 2)
    if (columns * 2 !== world.w || rows * 2 !== world.h) {
      resize(world, columns * 2, rows * 2)
    }
    await update($, frame, n => (n + 1) % 1_000_000)
  }
  const status = isHidden ? '' : caption(now)
  if (status !== lastStatus) {
    lastStatus = status
    $.ui.status(status === '' ? undefined : status)
  }
}

// A transcript row's drawing, with the stage laid over the rows above it
// when it is the newest row on screen.
async function decorate($: EngineInterface, e: SiteEvent, drawn: RenderElement, ui: Elements['terminal']): Promise<RenderElement> {
  let site = sites.get(e.requestId)
  if (site === undefined) {
    siteSeq += 1
    site = { seq: siteSeq, onScreen: null, columns: 80, rows: 40 }
    sites.set(e.requestId, site)
    if (sites.size > 400) {
      const oldest = [...sites].sort((a, b) => a[1].seq - b[1].seq)[0]![0]
      sites.delete(oldest)
    }
  }
  site.onScreen = e.props.onScreen ?? null
  site.columns = e.viewport?.columns ?? site.columns
  site.rows = e.viewport?.rows ?? site.rows
  if (e.viewport?.isFullscreen === false) {
    isMainScreen = true
  }
  const onScreen = e.props.onScreen
  if ((await read($, anchor)) !== e.requestId || onScreen === undefined || onScreen === null) {
    return drawn
  }
  await read($, frame)
  const shownView = await read($, stage)
  const { Box, Text, Raster } = ui
  const rows = world.h / 2
  const top = onScreen.last - 2 - rows + 1
  const now = await $.clock.now()
  return (
    <Box flexDirection="column">
      {drawn}
      {[...world.actors]
        .sort((x, y) => (x.id < y.id ? -1 : 1))
        .map(actor => [actor.id, drawActor(world, actor, now)] as const)
        .filter((placed): placed is readonly [string, Placed] => placed[1] !== undefined)
        .flatMap(([id, placed]) =>
          // One Raster per row of her box, the same one every frame, so the
          // colors it admitted stay; a row with nothing in it is hidden.
          spans(placed.c).map(span =>
            span.cells === undefined ? (
              <Box display="none">
                <Raster key={`${id}-${span.row}`} columns={1} rows={1} cells={BLANK_CELL} />
              </Box>
            ) : (
              <Box position="absolute" top={top + placed.row + span.row} left={placed.left + span.left}>
                <Raster key={`${id}-${span.row}`} columns={span.width} rows={1} cells={span.cells} />
              </Box>
            ),
          ),
        )}
      {(shownView.bubbles ?? []).map(bubble => {
        const at = layout(bubble, world.w / 2)
        const width = Math.max(...at.lines.map(textWidth))
        return (
          <Box
            position="absolute"
            top={top + at.top}
            left={at.left}
            flexDirection="column"
            borderStyle="round"
            borderColor={bubble.color}
          >
            {at.lines.map(line => (
              <Text color={bubble.color}>{line + ' '.repeat(width - textWidth(line))}</Text>
            ))}
          </Box>
        )
      })}
    </Box>
  )
}

async function thoughtDone($: EngineInterface) {
  const now = await $.clock.now()
  if (!isRunning || now - lastThinkingTea < THINKING_TEA_GAP_MS) {
    return
  }
  lastThinkingTea = now
  teaUntil = now + TEA_AFTER_THINKING_MS
  const { server } = setMode(world, 'tea', now)
  await say($, server, server === undefined ? undefined : lineOf(GIRLS.get(server.id)!, 'think'), 'event')
}

async function finished($: EngineInterface, e: TurnCompleteInput) {
  const now = await $.clock.now()
  isRunning = false
  lastTurn = { seconds: Math.round(e.durationMs / 1000), tools }
  turnsDone += 1
  day.turns += 1
  day.workMs += e.durationMs
  if (e.usage !== undefined) {
    lastUsage = addUsage(e.usage)
    const eaten = totalOf(lastUsage)
    day.biggestTurn = Math.max(day.biggestTurn, eaten)
    const glutton = pick(free())
    if (eaten >= BIG_TURN && glutton !== undefined && e.reason === 'answer') {
      pending.push({ at: now + 12_000, id: glutton.id, text: ateLine(eaten), loudness: 'event' })
    }
  }
  void saveDay($)
  if (e.reason === 'aborted') {
    teaUntil = now + TEA_AFTER_ABORT_MS
    setMode(world, 'tea', now)
    const actor = pick(free())
    await say($, actor, actor === undefined ? undefined : lineOf(GIRLS.get(actor.id)!, 'abort'), 'event')
    return
  }
  teaUntil = now + TEA_AFTER_TURN_MS
  const { server, masseuse } = setMode(world, 'tea', now)
  const serverGirl = server === undefined ? undefined : GIRLS.get(server.id)
  const moment: Moment = e.reason === 'answer' ? 'tea' : 'error'
  await say($, server, serverGirl === undefined ? undefined : lineOf(serverGirl, moment), 'key')
  if (masseuse !== undefined) {
    pending.push({ at: now + 4000, id: masseuse.id, text: lineOf(GIRLS.get(masseuse.id)!, 'massage') ?? '', loudness: 'event' })
  }
  const fan = free().find(actor => actor !== server && actor !== masseuse)
  if (fan !== undefined) {
    pending.push({ at: now + 8000, id: fan.id, text: lineOf(GIRLS.get(fan.id)!, 'done') ?? '', loudness: 'chatter' })
  }
  if (isChatty && e.reason === 'answer' && e.answer.length > 30 && now - lastAiComment > 90_000) {
    void comment($, e.answer)
  }
}

async function command($: EngineInterface, args: string): Promise<string> {
  const now = await $.clock.now()
  const words = args.trim()
  const [verb = '', ...rest] = words.split(/\s+/)
  const target = rest.join(' ')

  if (words === '' && place === 'roam') {
    isHidden = !isHidden
    return isHidden ? '应援团先藏起来啦，/waifu 再叫我们出来～' : '应援团回来啦！'
  }
  if (['漫游', 'roam'].includes(verb)) {
    place = 'roam'
    isHidden = false
    isMainScreen = false
    world.isRoaming = true
    await $.ui.close({ id: PANE })
    await savePrefs($)
    return '应援团跑到对话区里玩啦（需要全屏布局）'
  }
  if (['面板', 'pane'].includes(verb)) {
    place = 'pane'
    world.isRoaming = false
    await update($, anchor, () => '')
    anchorShown = ''
    $.ui.status(undefined)
    lastStatus = ''
    isDismissed = false
    await open($)
    await savePrefs($)
    return '应援团回到侧边面板啦'
  }
  if (words === '') {
    if (isOpen) {
      isDismissed = true
      await $.ui.close({ id: PANE })
      return '应援团先退下啦，/waifu 再叫我们出来～'
    }
    isDismissed = false
    await open($)
    return isOpen ? '应援团已就位！/waifu help 看玩法' : '终端太窄了，放不下舞台…'
  }
  if (['help', '帮助', '玩法'].includes(verb)) {
    return HELP
  }
  if (['list', '名单', '都有谁'].includes(verb)) {
    return available()
      .map(girl => `${actorOf(girl.id) ? '★' : '·'} ${girl.name}（${girl.kind}）`)
      .join('\n')
  }
  if (['call', '叫', '召唤'].includes(verb)) {
    const girl = findGirl(target)
    if (girl === undefined || !canDraw(girl)) {
      return `没有叫「${target}」的人哦，/waifu 名单 看看`
    }
    for (const extra of free().filter(actor => actor.id !== girl.id).slice(1)) {
      leave(world, extra.id)
    }
    enter(world, girl.id, now)
    pending.push({ at: now + 5000, id: girl.id, text: lineOf(girl, 'hello') ?? '', loudness: 'event' })
    await savePrefs($)
    return `${girl.name}来啦～`
  }
  if (['bye', '退下', '再见'].includes(verb)) {
    const girl = findGirl(target)
    const actor = girl === undefined ? undefined : actorOf(girl.id)
    if (girl === undefined || actor === undefined) {
      return `「${target}」不在台上哦`
    }
    await say($, actor, lineOf(girl, 'bye'), 'event')
    pending.push({ at: now + 2500, id: `leave:${girl.id}`, text: '', loudness: 'silent' })
    await savePrefs($)
    return `${girl.name}退下了`
  }
  if (['shuffle', '换人', '换一批'].includes(verb)) {
    for (const actor of onStage(world)) {
      leave(world, actor.id)
    }
    shuffled()
      .slice(0, castSize())
      .forEach((id, i) => {
        enter(world, id, now)
        if (i === 0) {
          pending.push({ at: now + 5000, id, text: lineOf(GIRLS.get(id)!, 'hello') ?? '', loudness: 'event' })
        }
      })
    await savePrefs($)
    return '换了一批新面孔～'
  }
  if (['token', 'tokens', 'usage', '余量', '用量', '额度'].includes(verb.toLowerCase())) {
    const usage = await $.session.usage()
    await measured($, usage.context, usage.rateLimits, usage.cost, true)
    const actor = pick(free())
    await say($, actor, briefLine(meter.percent, meter.limits), 'key')
    return usageReport({
      name: (actor === undefined ? undefined : GIRLS.get(actor.id)?.name) ?? '应援团',
      percent: meter.percent,
      tokens: meter.tokens,
      window: meter.window,
      limits: meter.limits,
      costUsd: meter.costUsd,
      session: sessionUsage,
      turns: turnsDone,
      last: lastUsage,
      now,
    })
  }
  if (['日报', '今日', '今天', 'today'].includes(verb.toLowerCase())) {
    const actor = pick(free())
    await say($, actor, dayComment(day), 'key')
    return dayReport((actor === undefined ? undefined : GIRLS.get(actor.id)?.name) ?? '应援团', day)
  }
  if (['抽签', '运势', 'fortune', 'omikuji'].includes(verb.toLowerCase())) {
    const { name, line } = fortune(Math.random())
    const actor = pick(free())
    if (actor !== undefined) {
      const move = name.includes('吉') ? 'cheer' : 'attack'
      perform(world, actor.id, move, now, moveLength(actor.id, move) * TICK_MS + 400)
      await say($, actor, line, 'key')
    }
    return `🎋 今日运势：${name}`
  }
  const voices: Record<string, VoiceMode> = { 静音: 'off', mute: 'off', 少说: 'less', less: 'less', 声音: 'on', voice: 'on', unmute: 'on' }
  if (voices[verb] !== undefined) {
    voiceMode = voices[verb]!
    await savePrefs($)
    return { off: '配音已关闭', less: '只在关键时刻说话', on: '配音全开！' }[voiceMode]
  }
  if (verb.toLowerCase() === 'ai') {
    isChatty = !['关', 'off', '0'].includes(target)
    await savePrefs($)
    return isChatty ? 'AI 即兴聊天已开启' : 'AI 即兴聊天已关闭，只说预设台词'
  }

  const named = words.match(/^(\S+?)[\s:：，,]+(.+)$/)
  const asked = named ? findGirl(named[1]!) : undefined
  const namedGirl = asked !== undefined && canDraw(asked) ? asked : undefined
  const girl = namedGirl ?? GIRLS.get(pick(free())?.id ?? '') ?? pick(available()) ?? pick(CAST)!
  const said = namedGirl !== undefined && named !== null ? named[2]! : words
  void chatWith($, girl, said)
  return `（${girl.name}听到了）`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'waifu', description: '动漫应援团：开关舞台、聊天、召唤角色（/waifu help）' })
    const now = await $.clock.now()
    await loadPacks($)
    await loadPrefs($, now)
    await findTts($)
    await checkClock($, now)
    try {
      const usage = await $.session.usage()
      await measured($, usage.context, usage.rateLimits, usage.cost, true)
    } catch {
      // The readings arrive with the next session.measure instead.
    }
    nextChatAt = now + 40_000
    nextRotateAt = now + rand(4 * 60_000, 8 * 60_000)
    $.clock.every(TICK_MS, () => void step($))
    if (place === 'pane') {
      void open($)
    } else {
      void $.ui.close({ id: PANE })
    }
    const greeter = pick(onStage(world))
    if (greeter !== undefined) {
      pending.push({ at: now + 1500, id: greeter.id, text: lineOf(GIRLS.get(greeter.id)!, 'hello') ?? '', loudness: 'event' })
    }

    return next(e)
  })

  on('command.run', { command: 'waifu' }, async ($, e) => ({ text: await command($, e.args) }))

  on('ui.close', ($, e, next) => {
    if (e.id === PANE) {
      isOpen = false
      isDismissed ||= e.origin.kind === 'person'
    }

    return next(e)
  })

  on('prompt.submit', ($, e, next) => {
    if (place === 'pane' && !isOpen && !isDismissed) {
      void open($)
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const now = await $.clock.now()
    isRunning = true
    startedAt = now
    tools = 0
    longNotices = 0
    teaUntil = 0
    nextWorkTalkAt = now + rand(12_000, 20_000)
    wake(world, now)
    setMode(world, 'work', now)
    const lead = pick(free())
    void say($, lead, lead === undefined ? undefined : lineOf(GIRLS.get(lead.id)!, 'start'), 'event')

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    tools += 1
    day.tools += 1
    const now = await $.clock.now()
    if (now - lastToolTalk > 12_000 && Math.random() < 0.4) {
      lastToolTalk = now
      const kind = /Edit|Write/.test(e.tool)
        ? 'edit'
        : e.tool === 'Bash'
          ? 'bash'
          : /Read|Grep|Glob|LS/.test(e.tool)
            ? 'read'
            : /Web/.test(e.tool)
              ? 'web'
              : /Agent|Task/.test(e.tool)
                ? 'agent'
                : 'other'
      void say($, pick(free()), pick(TOOL_TALK[kind] ?? []), 'silent')
    }
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError === true) {
      day.errors += 1
    }
    if (ran.deny === undefined && ran.isError === true && now - lastErrorTalk > 20_000) {
      lastErrorTalk = now
      const actor = pick(free())
      if (actor !== undefined) {
        perform(world, actor.id, 'attack', now, moveLength(actor.id, 'attack') * TICK_MS + 400)
        await say($, actor, lineOf(GIRLS.get(actor.id)!, 'error'), 'event')
      }
    }

    return ran
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) {
      return yield* next(e)
    }
    let isThinking = false
    for await (const chunk of next(e)) {
      if (chunk.kind === 'thinking') {
        isThinking = true
      } else if (isThinking && chunk.kind !== 'engine') {
        isThinking = false
        void thoughtDone($)
      }
      yield chunk
    }
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await finished($, e)
    } else if (e.usage !== undefined) {
      addUsage(e.usage)
    }

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await measured($, e.context, e.rateLimits, e.cost, false)

    return next(e)
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) =>
    e.surface === 'terminal' ? decorate($, e, await next(e), $.ui.resolve(e)) : next(e),
  )
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) =>
    e.surface === 'terminal' ? decorate($, e, await next(e), $.ui.resolve(e)) : next(e),
  )
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) =>
    e.surface === 'terminal' ? decorate($, e, await next(e), $.ui.resolve(e)) : next(e),
  )
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) =>
    e.surface === 'terminal' ? decorate($, e, await next(e), $.ui.resolve(e)) : next(e),
  )
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) =>
    e.surface === 'terminal' ? decorate($, e, await next(e), $.ui.resolve(e)) : next(e),
  )
  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) =>
    e.surface === 'terminal' ? decorate($, e, await next(e), $.ui.resolve(e)) : next(e),
  )
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) =>
    e.surface === 'terminal' ? decorate($, e, await next(e), $.ui.resolve(e)) : next(e),
  )
  on('ui.render', { component: 'InfoNotice' }, async ($, e, next) =>
    e.surface === 'terminal' ? decorate($, e, await next(e), $.ui.resolve(e)) : next(e),
  )

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const saved = await read($, stage)
    const shownView = { caption: saved.caption ?? '', bubbles: saved.bubbles ?? [] }
    isOpen = true
    if (place !== 'pane') {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>应援团在对话区里玩呢～ /waifu 面板 可以叫回来</Text>
    }
    const columns = Math.max(24, Math.min(110, e.props.bodyColumns))
    const rows = Math.max(9, Math.min(80, e.props.scroll.bodyRows - 1))
    if (columns * 2 !== world.w || rows * 2 !== world.h) {
      resize(world, columns * 2, rows * 2)
    }

    if (e.surface !== 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          {shownView.bubbles.map(bubble => (
            <Text color={bubble.color}>
              {bubble.name}：{bubble.text}
            </Text>
          ))}
          <Text dimColor>{shownView.caption}</Text>
        </Box>
      )
    }

    const { Box, Text, Raster } = $.ui.resolve(e)
    lastCells = encode(draw(world, await $.clock.now()))
    return (
      <Box flexDirection="column">
        <Box width={columns} height={rows}>
          <Raster key="stage" columns={columns} rows={rows} cells={lastCells} />
          {shownView.bubbles.map(bubble => {
            const at = layout(bubble, columns)
            return (
              <Box
                position="absolute"
                top={at.top}
                left={at.left}
                flexDirection="column"
                borderStyle="round"
                borderColor={bubble.color}
              >
                {at.lines.map(line => (
                  <Text color={bubble.color}>{line}</Text>
                ))}
              </Box>
            )
          })}
        </Box>
        <Text dimColor wrap="truncate">
          {shownView.caption}
        </Text>
      </Box>
    )
  })
}
