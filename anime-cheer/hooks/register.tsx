import { atom, memberOf, read, update } from 'claude-code'
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
import { dutyLine, withDetail, type Duty } from './duty'
import {
  commitOf,
  isOpaqueFile,
  isSensitiveFile,
  mayStop,
  newFileDiff,
  outcomeOf,
  riskOf,
  scanDiff,
  scanReport,
  secretsIn,
  watchesOf,
  type Commit,
  type Finding,
} from './guard'
import { addTask, isTask, lastTaskLine, makeTask, projectKey, recapPrompt, recapReport, type Task } from './journal'
import { parseReview, REVIEW_SYSTEM, reviewPrompt, reviewReport, trimDiff } from './review'
import {
  briefLine,
  budgetLine,
  contextAlert,
  costLine,
  dayComment,
  dayReport,
  emptyDay,
  emptyUsage,
  fortune,
  freshOf,
  limitAlert,
  totalOf,
  turnBrief,
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
  pace,
  perform,
  resize,
  setMode,
  settle,
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
const REVIEW_MODEL = 'sonnet'
// The figures of a turn are read out at most this often.
const BRIEF_GAP_MS = 45_000

type Loudness = 'key' | 'event' | 'chatter' | 'silent'
type VoiceMode = 'on' | 'less' | 'off'
type Talk = StageBubble & { until: number }
type Pending = { at: number; id: string; text: Line; loudness: Loudness; move?: 'attack' | 'cheer' }
type Place = 'roam' | 'pane'
type OnScreen = { first: number; last: number; of: number }
type Site = {
  seq: number
  onScreen: OnScreen | null
  columns: number
  rows: number
  // The line that runs while Claude works: always the transcript's last row.
  isSpinner: boolean
  // When its render hook last ran. A row that reads `frame` is drawn every
  // tick, so a long pause means it has left the transcript.
  drawnAt: number
}
type LimitMark = { level: number; resetMs: number }

// A transcript row the stage can hang from, as its render hook sees it.
type SiteEvent = {
  component: string
  requestId: string
  viewport?: { columns: number; rows: number; isFullscreen?: boolean }
  props: { onScreen?: OnScreen | null }
}

const stage = atom({ plugin: 'anime-cheer', key: 'stage' } as const, { caption: '', bubbles: [] } as StageView)
// One mark per transcript row, written when the row becomes the stage's anchor
// and when it stops being it: those two rows draw again, no other does.
const anchorMark = atom({ plugin: 'anime-cheer', key: 'anchorMark' } as const, 0)
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
let limitMarks = new Map<string, LimitMark>()
let costLevel = 0
let lastCostUsd: number | undefined
let anchoredAt = 0
let lastStatus = ''
let isStepping = false
let hasPrompt = false
let lastOnStage = new Map<string, number>()
let turnDueUntil = 0
let hasStepFailed = false
let hasMainScreenHint = false
let lastVoxLaunch = 0
let isGuardOn = true
let isNotifyOn = true
let budgetUsd: number | undefined
let budgetMark = 0
let blocked: { script: string; why: string; at: number } | undefined
let allowed: { script: string; until: number } | undefined
let turnPrompt = ''
let turnFiles: string[] = []
let tasks: Task[] = []
let tasksKey = 'tasks:none'
let lastSecretTalk = 0
let lastResultTalk = 0
let lastNeedYou = 0
let lastBrief = 0
let isReviewing = false

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo)
const pick = <T,>(list: readonly T[]): T | undefined => list[Math.floor(Math.random() * list.length)]

const HELP = [
  '/waifu                 显示或隐藏应援团',
  '/waifu token           用量播报：上下文、额度、花费、token',
  '/waifu today           今天聊了几轮、干了多久、用了多少 token',
  '/waifu budget <usd>    设花费预算，用到 50%、80%、100% 时提醒（budget off 取消）',
  '/waifu recap           这个项目里最近做过的任务',
  '/waifu review [dir]    快速 review 工作区的改动（dir：仓库所在的目录）',
  '/waifu scan [dir]      扫描改动里的密钥和敏感文件',
  '/waifu guard on|off    安全检查：危险命令先拦下',
  '/waifu allow           放行刚被拦下的那条命令一次',
  '/waifu notify on|off   长任务结束时弹系统通知',
  '/waifu fortune         抽今日编码运势',
  '/waifu list | call <name> | bye <name> | shuffle   名单、叫人、退下、换一批',
  '/waifu roam | pane     在对话区里走动，或待在面板里',
  '/waifu mute | less | voice   配音全关、只留关键、全开',
  '/waifu ai on|off       AI 即兴聊天',
  '/waifu <name> <话>     和某一位聊天，例如 /waifu mai 今天好累',
].join('\n')

const LEVELS = [95, 80, 50]
const COST_STEPS = [1, 5, 10, 20, 50, 100]
const CAST_MAX = 2
// The terminal charges for every color pair a new Raster shows (a few
// thousand to start with, 160 more a second), and a stage hung from another
// row is all new Rasters. So an anchor that holds is kept, and left for a
// better one at most this often.
const ANCHOR_HOLD_MS = 10_000
const ANCHOR_STALE_MS = 1200
// After a prompt, how long a turn (and its working line) is waited for.
const TURN_WAIT_MS = 2500
// Cell rows per Raster of a girl: fewer Rasters admit fewer color pairs, at
// the price of a little more text hidden beside her.
const BAND_ROWS = 3
const SPINNER_LINE: OnScreen = { first: 0, last: 0, of: 1 }
const VOX_RELAUNCH_MS = 60_000
const SAME_WINDOW_MS = 30 * 60_000
const VOICE_WORDS = new Map<string, VoiceMode>([
  ['静音', 'off'],
  ['mute', 'off'],
  ['少说', 'less'],
  ['less', 'less'],
  ['声音', 'on'],
  ['voice', 'on'],
  ['unmute', 'on'],
])

function lineOf(girl: Girl, moment: Moment): Line | undefined {
  return pick(girl.lines[moment] ?? [])
}

function free(): Actor[] {
  return onStage(world).filter(actor => actor.act !== 'enter' && actor.act !== 'sleep')
}

function actorOf(id: string): Actor | undefined {
  return onStage(world).find(actor => actor.id === id)
}

// Whether anyone can see the troupe. Out of sight they keep quiet too: no
// bubbles, no voices, no chat model calls.
function isShown(): boolean {
  return place === 'roam' ? !isHidden && !isMainScreen : isOpen
}

// Work left running on purpose: a failure there is nobody's to handle.
function quiet(work: Promise<unknown>) {
  void work.catch(() => undefined)
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
  try {
    const opened = await $.ui.open({ id: PANE, title: '应援团', rows: 26, columns: 64 })
    isOpen = opened.isPlaced
  } catch {
    isOpen = false
  }
}

// The person asked for them: awake and back in view.
async function attend($: EngineInterface, now: number) {
  wake(world, now)
  if (place === 'roam') {
    isHidden = false
  } else if (!isOpen) {
    isDismissed = false
    await open($)
  }
}

// Where they live and how loud they are; who is on stage is drawn afresh
// every session.
async function savePrefs($: EngineInterface) {
  await $.store.set('prefs', { place, voice: voiceMode, ai: isChatty, guard: isGuardOn, notify: isNotifyOn, budget: budgetUsd })
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

const castSize = () => (Math.random() < 0.6 ? 2 : 1)

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
  const prefs = ((await $.store.get('prefs')) ?? {}) as {
    place?: Place
    voice?: VoiceMode
    ai?: boolean
    guard?: boolean
    notify?: boolean
    budget?: number
  }
  place = prefs.place ?? 'roam'
  voiceMode = prefs.voice ?? 'on'
  isChatty = prefs.ai ?? true
  isGuardOn = prefs.guard ?? true
  isNotifyOn = prefs.notify ?? true
  budgetUsd = typeof prefs.budget === 'number' && prefs.budget > 0 ? prefs.budget : undefined
  world = createWorld(world.w, world.h, now)
  world.isRoaming = place === 'roam'
  for (const id of shuffled().slice(0, castSize())) {
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
    // The engine is down: start it for the next line, not once per line.
    const now = await $.clock.now()
    if (vox.run !== undefined && now - lastVoxLaunch >= VOX_RELAUNCH_MS) {
      lastVoxLaunch = now
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
  if (actor === undefined || girl === undefined || line === undefined || subtitle(line) === '' || !isShown()) {
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
  try {
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
  } catch {
    // The model is not to be had (blocked, offline): the catalog speaks.
    return undefined
  }
}

async function comment($: EngineInterface, answer: string, notBefore: number) {
  const now = await $.clock.now()
  const actor = pick(free())
  const girl = actor === undefined ? undefined : GIRLS.get(actor.id)
  if (girl === undefined || actor === undefined || !isShown()) {
    return
  }
  lastAiComment = now
  const line = await improvise(
    $,
    girl,
    `AI 助手刚帮用户完成了一轮工作，它的回复开头是：「${answer.slice(0, 400)}」。请用你的口吻对用户说一句评价或鼓励。`,
  )
  if (line !== undefined) {
    pending.push({ at: Math.max((await $.clock.now()) + 500, notBefore), id: actor.id, text: line, loudness: 'key' })
  }
}

// A girl called in takes the place of whoever has been on the stage longest.
function bring(girl: Girl, now: number) {
  if (actorOf(girl.id) !== undefined) {
    return
  }
  const cast = onStage(world)
  for (const extra of cast.slice(0, Math.max(0, cast.length - (CAST_MAX - 1)))) {
    leave(world, extra.id)
  }
  enter(world, girl.id, now)
}

async function chatWith($: EngineInterface, girl: Girl, words: string) {
  const now = await $.clock.now()
  bring(girl, now)
  wake(world, now)
  const line = (isChatty ? await improvise($, girl, `用户对你说：「${words}」`) : undefined) ?? lineOf(girl, 'idle') ?? '……'
  if (isShown()) {
    pending.push({ at: (await $.clock.now()) + 300, id: girl.id, text: line, loudness: 'key' })
  } else {
    // Nowhere to draw her (the main screen, a pane that would not open).
    $.ui.toast(`${girl.name}：${subtitle(line)}`)
  }
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

// Every few minutes the cast changes, working or idle: one or two on the
// stage, sleepers and girls still walking in counted. Over Claude's work the
// change is silent; at rest they say goodbye and hello.
async function rotate($: EngineInterface, now: number) {
  nextRotateAt = now + rand(2 * 60_000, 4 * 60_000)
  const cast = onStage(world)
  for (const actor of cast) {
    lastOnStage.set(actor.id, now)
  }
  // Whoever has been away longest comes next: everyone gets her turn.
  const waiting = available().filter(girl => actorOf(girl.id) === undefined)
  const longest = Math.min(...waiting.map(girl => lastOnStage.get(girl.id) ?? 0))
  const incoming = pick(waiting.filter(girl => (lastOnStage.get(girl.id) ?? 0) === longest))
  if (incoming === undefined) {
    return
  }
  // Two on the stage: one makes way, and mostly another comes. One alone:
  // mostly she gets company, sometimes she is relieved.
  const isFull = cast.length >= CAST_MAX
  const outgoing = isFull || (cast.length === 1 && Math.random() < 0.3) ? pick(cast.filter(actor => actor.act !== 'enter')) : undefined
  if (isFull && (outgoing === undefined || Math.random() >= 0.6)) {
    if (outgoing !== undefined && cast.length > 1) {
      await sendOff($, outgoing, now)
    }
    return
  }
  const wait = outgoing === undefined ? 0 : await sendOff($, outgoing, now)
  pending.push({ at: now + wait, id: `enter:${incoming.id}`, text: '', loudness: 'silent' })
  if (world.mode !== 'work') {
    pending.push({ at: now + wait + 6000, id: incoming.id, text: lineOf(incoming, 'hello') ?? '', loudness: 'event' })
  }
}

// A girl leaves the stage: at once over Claude's work, after her goodbye at
// rest. Resolves how long until she has turned to go.
async function sendOff($: EngineInterface, actor: Actor, now: number): Promise<number> {
  if (world.mode === 'work') {
    leave(world, actor.id)
    return 0
  }
  if (actor.act === 'sleep') {
    actor.act = 'stand'
  }
  await say($, actor, lineOf(GIRLS.get(actor.id)!, 'bye'), 'event')
  pending.push({ at: now + 3000, id: `leave:${actor.id}`, text: '', loudness: 'silent' })
  return 3200
}

async function checkClock($: EngineInterface, now: number) {
  nextClockCheck = now + 20 * 60_000
  try {
    const out = await $.process.run(['date', '+%H %F'], { timeoutMs: 3000 })
    const [h = '', date = ''] = out.stdout.trim().split(' ')
    // No answer is noon, not midnight: nobody is told to go to bed over it.
    hour = out.exitCode === 0 && /^\d{1,2}$/.test(h) ? Number(h) : 12
    if (date !== '' && date !== today) {
      today = date
      const saved = (await $.store.get(`day:${date}`)) as Partial<Day> | undefined
      day = { ...emptyDay(date), ...(saved?.date === date ? saved : {}) }
      if (saved?.measure !== 'fresh') {
        // Kept by a version that counted cache hits into the biggest turn.
        day.biggestTurn = 0
        day.measure = 'fresh'
      }
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
    const at = LEVELS.find(mark => limit.percentUsed >= mark) ?? 0
    const parsed = limit.resetsAt === undefined ? 0 : Date.parse(limit.resetsAt)
    const resetMs = Number.isFinite(parsed) ? parsed : 0
    const before = limitMarks.get(limit.kind)
    // A window first seen this session is the baseline, not news; a new
    // window (its reset moved on) starts over.
    const isSameWindow = before !== undefined && Math.abs(resetMs - before.resetMs) < SAME_WINDOW_MS
    const base = before === undefined ? at : isSameWindow ? before.level : 0
    if (at > base) {
      alerts.push(limitAlert(limit, now))
    }
    limitMarks.set(limit.kind, { level: Math.max(at, base), resetMs })
  }
  if (cost !== undefined) {
    const reached = COST_STEPS.filter(usd => cost.usd >= usd).length
    if (lastCostUsd === undefined) {
      // The first reading: what a resumed session had already spent.
      costLevel = reached
    } else if (cost.usd > lastCostUsd) {
      day.costUsd += cost.usd - lastCostUsd
    }
    lastCostUsd = cost.usd
    if (reached > costLevel) {
      alerts.push(costLine(COST_STEPS[reached - 1]!))
      costLevel = reached
    }
  }
  let isOverBudget = false
  if (budgetUsd !== undefined && cost !== undefined) {
    const used = (cost.usd / budgetUsd) * 100
    const mark = [100, 80, 50].find(floor => used >= floor) ?? 0
    if (mark > budgetMark) {
      if (mark >= 100) {
        isOverBudget = true
      } else {
        alerts.push(budgetLine(mark, cost.usd, budgetUsd))
      }
    }
    budgetMark = Math.max(budgetMark, mark)
  }
  if (isQuiet || !isShown()) {
    return
  }
  if (isOverBudget && cost !== undefined) {
    quiet(onDuty($, 'budget', `已花 $${cost.usd.toFixed(2)}，预算 $${budgetUsd}`, 'attack', 'key'))
  }
  alerts.forEach((line, i) => {
    const actor = pick(free())
    if (actor !== undefined) {
      pending.push({ at: now + 500 + (i + (isOverBudget ? 1 : 0)) * 6000, id: actor.id, text: line, loudness: 'key' })
    } else {
      // Nobody free to say it (asleep, walking in): it is still worth knowing.
      $.ui.toast(subtitle(line))
    }
  })
}

// One frame of the stage, unless the last one is still under way.
async function step($: EngineInterface) {
  if (isStepping) {
    return
  }
  isStepping = true
  try {
    await advance($)
  } catch (error) {
    if (!hasStepFailed) {
      hasStepFailed = true
      $.ui.log(`anime-cheer: a frame failed: ${String(error)}`, { to: 'debug' })
    }
  } finally {
    isStepping = false
  }
}

// The world moves, people talk, the stage redraws.
async function advance($: EngineInterface) {
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
    } else if (one.id.startsWith('enter:')) {
      if (onStage(world).length < CAST_MAX) {
        enter(world, one.id.slice('enter:'.length), now)
      }
    } else if (subtitle(one.text) !== '') {
      const speaker = actorOf(one.id)
      if (one.move !== undefined && speaker !== undefined && isShown()) {
        perform(world, speaker.id, one.move, now, moveLength(speaker.id, one.move) * TICK_MS + 400)
      }
      await say($, speaker, one.text, one.loudness)
    }
  }
  talk = talk.filter(one => one.until > now)

  const isSeen = isShown()
  if (isSeen && world.mode === 'idle' && now >= nextChatAt && talk.length === 0) {
    await chatter($, now)
  }
  if (isSeen && world.mode === 'work' && now >= nextWorkTalkAt) {
    nextWorkTalkAt = now + rand(15_000, 30_000)
    const actor = pick(free())
    await say($, actor, actor === undefined ? undefined : lineOf(GIRLS.get(actor.id)!, 'work'), 'chatter')
  }
  if (isRunning && longNotices < 2 && now - startedAt > (longNotices === 0 ? 120_000 : 300_000)) {
    longNotices += 1
    const actor = pick(free())
    await say($, actor, actor === undefined ? undefined : lineOf(GIRLS.get(actor.id)!, 'long'), 'event')
  }
  if (world.mode !== 'tea' && now >= nextRotateAt) {
    await rotate($, now)
  }
  if (now >= nextClockCheck) {
    quiet(checkClock($, now))
  }

  if (place === 'pane' && isOpen) {
    const cells = encode(draw(world, now))
    if (cells !== lastCells) {
      lastCells = cells
      quiet($.ui.blit({ requestId: PANE, key: 'stage', cells }))
    }
  }
  if (place === 'roam') {
    await roam($)
  }
  await publish($, now)
}

// The row the stage would best hang from. Rows after the anchor are drawn
// over the stage, so the girls stand in front of everything only on the
// transcript's last row: the line that runs while Claude works, for as long
// as the turn lasts; at rest, the newest row on screen.
function newestRow(now: number): string {
  let best = ''
  let bestSeq = -1
  for (const [key, site] of sites) {
    if (site.isSpinner) {
      if (isRunning && now - site.drawnAt < ANCHOR_STALE_MS) {
        return key
      }
    } else if (site.onScreen !== null && site.seq > bestSeq) {
      best = key
      bestSeq = site.seq
    }
  }
  return best
}

// Whether the stage can stay where it hangs: its row is on screen from its
// first line, and still there (it reads `frame`, so it is drawn every tick).
function holds(site: Site | undefined, now: number): boolean {
  if (site === undefined || site.onScreen === null || site.onScreen.first > 0) {
    return false
  }
  if (site.isSpinner && !isRunning) {
    return false
  }
  return now - Math.max(site.drawnAt, anchoredAt) < ANCHOR_STALE_MS
}

// The row the stage hung from stops being its anchor, and draws without it.
async function dropAnchor($: EngineInterface) {
  const before = anchorShown
  anchorShown = ''
  if (before !== '') {
    await update($, memberOf(anchorMark, { requestId: before }), () => 0)
  }
}

async function roam($: EngineInterface) {
  if (isMainScreen) {
    // The main screen docks nothing, and a pane there is the person's to open.
    if (!hasMainScreenHint) {
      hasMainScreenHint = true
      $.ui.toast('对话区漫游需要全屏布局；/waifu pane 可以打开面板')
    }
    if (lastStatus !== '') {
      lastStatus = ''
      $.ui.status(undefined)
    }
    return
  }
  const now = await $.clock.now()
  if (hasPrompt) {
    hasPrompt = false
    turnDueUntil = now + TURN_WAIT_MS
  }
  const current = sites.get(anchorShown)
  const isHeld = !isHidden && holds(current, now)
  if (current !== undefined && !isHeld && now - Math.max(current.drawnAt, anchoredAt) >= ANCHOR_STALE_MS) {
    // It stopped drawing: gone from the transcript, and no anchor again.
    current.onScreen = null
  }
  const newest = isHidden ? '' : newestRow(now)
  // An anchor that holds is left only for a better one, and not too often.
  // While a turn runs or is about to, the better one is its working line
  // alone: the rows of a turn come and go beneath the girls' feet, and each
  // would be a move.
  const isBetter = newest !== anchorShown && (sites.get(newest)?.isSpinner === true || (!isRunning && now >= turnDueUntil))
  const id = isHeld && !(isBetter && now - anchoredAt >= ANCHOR_HOLD_MS) ? anchorShown : newest
  if (id !== anchorShown) {
    await dropAnchor($)
    anchorShown = id
    anchoredAt = now
    if (id !== '') {
      await update($, memberOf(anchorMark, { requestId: id }), () => now)
    }
  }
  const site = sites.get(id)
  if (site !== undefined) {
    const rows = Math.max(10, Math.min(30, site.rows - 14))
    const columns = Math.max(30, site.columns - 2)
    if (columns * 2 !== world.w || rows * 2 !== world.h) {
      resize(world, columns * 2, rows * 2)
    }
  }
  // The anchor draws the next frame; the working line shows it is still there.
  await update($, frame, n => (n + 1) % 1_000_000)
  const status = isHidden ? '' : caption(now)
  if (status !== lastStatus) {
    lastStatus = status
    $.ui.status(status === '' ? undefined : status)
  }
}

// A transcript row's drawing, with the stage laid over the rows above it
// when it is the stage's anchor.
async function decorate(
  $: EngineInterface,
  e: SiteEvent,
  drawn: RenderElement,
  ui: Elements['terminal'],
  isSpinner = false,
): Promise<RenderElement> {
  // A tool's call row and its result row share one requestId: the component
  // tells them apart.
  const key = `${e.component}:${e.requestId}`
  const now = await $.clock.now()
  let site = sites.get(key)
  if (site === undefined) {
    siteSeq += 1
    site = { seq: siteSeq, onScreen: null, columns: 80, rows: 40, isSpinner, drawnAt: now }
    sites.set(key, site)
    if (sites.size > 400) {
      const oldest = [...sites].sort((a, b) => a[1].seq - b[1].seq)[0]![0]
      sites.delete(oldest)
    }
  }
  site.onScreen = isSpinner ? SPINNER_LINE : (e.props.onScreen ?? null)
  site.drawnAt = now
  site.columns = e.viewport?.columns ?? site.columns
  site.rows = e.viewport?.rows ?? site.rows
  if (e.viewport?.isFullscreen === false) {
    isMainScreen = true
  }
  // Reading its own mark is what draws this row again when it becomes the
  // anchor or stops being it.
  await read($, memberOf(anchorMark, { requestId: key }))
  if (isSpinner) {
    // The working line never says when it leaves: drawn every tick, it shows
    // by `drawnAt` that it is still there.
    await read($, frame)
  }
  const onScreen = site.onScreen
  if (anchorShown !== key || onScreen === null) {
    return drawn
  }
  await read($, frame)
  const shownView = await read($, stage)
  const { Box, Text, Raster } = ui
  const rows = world.h / 2
  const top = onScreen.last - 2 - rows + 1
  return (
    <Box flexDirection="column">
      {drawn}
      {[...world.actors]
        .sort((x, y) => (x.id < y.id ? -1 : 1))
        .map(actor => [actor.id, drawActor(world, actor, now)] as const)
        .filter((placed): placed is readonly [string, Placed] => placed[1] !== undefined)
        .flatMap(([id, placed]) =>
          // A few Rasters per girl, band by band, the same ones every frame,
          // so the colors they admitted stay; an empty band is hidden.
          spans(placed.c, BAND_ROWS).map(span =>
            span.cells === undefined ? (
              <Box key={`at-${id}-${span.band}`} display="none">
                <Raster key={`${id}-${span.band}`} columns={1} rows={1} cells={BLANK_CELL} />
              </Box>
            ) : (
              <Box key={`at-${id}-${span.band}`} position="absolute" top={top + placed.row + span.row} left={placed.left + span.left}>
                <Raster key={`${id}-${span.band}`} columns={span.width} rows={span.height} cells={span.cells} />
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

// A passing remark on the tool Claude is using.
async function toolTalk($: EngineInterface, tool: string) {
  const now = await $.clock.now()
  if (now - lastToolTalk <= 12_000 || Math.random() >= 0.4) {
    return
  }
  lastToolTalk = now
  const kind = /Edit|Write/.test(tool)
    ? 'edit'
    : tool === 'Bash'
      ? 'bash'
      : /Read|Grep|Glob|LS/.test(tool)
        ? 'read'
        : /Web/.test(tool)
          ? 'web'
          : /Agent|Task/.test(tool)
            ? 'agent'
            : 'other'
  await say($, pick(free()), pick(TOOL_TALK[kind] ?? []), 'silent')
}

// A tool came back with an error: someone lets fly at the bug.
async function toolFailed($: EngineInterface) {
  const now = await $.clock.now()
  const actor = pick(free())
  if (now - lastErrorTalk <= 20_000 || actor === undefined || !isShown()) {
    return
  }
  lastErrorTalk = now
  perform(world, actor.id, 'attack', now, moveLength(actor.id, 'attack') * TICK_MS + 400)
  await say($, actor, lineOf(GIRLS.get(actor.id)!, 'error'), 'event')
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
    day.biggestTurn = Math.max(day.biggestTurn, freshOf(lastUsage))
  }
  quiet(saveDay($))
  // A turn that did something goes into the journal the recap reads.
  const isWork = isTask(turnPrompt, lastTurn.seconds, tools)
  if (isWork) {
    const eaten = e.usage === undefined || lastUsage === undefined ? 0 : freshOf(lastUsage)
    tasks = addTask(tasks, makeTask(now, turnPrompt, e.answer, lastTurn.seconds, tools, eaten, turnFiles, e.reason === 'answer'))
    quiet($.store.set(tasksKey, tasks))
  }
  if (e.durationMs >= 60_000 && e.reason !== 'aborted') {
    quiet(notify($, '应援团 · Claude Code', `干完了（${lastTurn.seconds} 秒）：${turnPrompt.replace(/\s+/g, ' ').slice(0, 40)}`))
  }
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
  // The turn's figures follow the tea and the shoulder rub; the chat model's
  // remark waits until they have been read out.
  let quietUntil = now
  if (isWork && server !== undefined && e.usage !== undefined && lastUsage !== undefined && e.reason === 'answer' && now - lastBrief >= BRIEF_GAP_MS) {
    lastBrief = now
    const at = now + (masseuse === undefined ? 7000 : 9000)
    quiet(reportTurn($, server.id, freshOf(lastUsage), at))
    quietUntil = at + 6000
  }
  if (isChatty && isShown() && e.reason === 'answer' && e.answer.length > 30 && now - lastAiComment > 90_000) {
    quiet(comment($, e.answer, quietUntil))
  }
}

// ── On duty: guarding commands, scanning, reviewing, recalling, reporting ──

// Someone on the stage takes a duty: her move, her line with the particulars.
// Resolves her name, or undefined when nobody is there to do it.
async function onDuty(
  $: EngineInterface,
  duty: Duty,
  detail: string | undefined,
  move: 'attack' | 'cheer' | undefined,
  loudness: Loudness,
  who?: string,
): Promise<string | undefined> {
  const actor = (who === undefined ? undefined : actorOf(who)) ?? pick(free()) ?? pick(onStage(world))
  if (actor === undefined || !isShown()) {
    return undefined
  }
  const now = await $.clock.now()
  if (actor.act === 'sleep') {
    wake(world, now)
  }
  if (move !== undefined) {
    perform(world, actor.id, move, now, moveLength(actor.id, move) * TICK_MS + 400)
  }
  const line = dutyLine(actor.id, duty)
  await say($, actor, detail === undefined ? line : withDetail(line, detail), loudness)
  return GIRLS.get(actor.id)?.name
}

async function gitText($: EngineInterface, argv: readonly string[], cwd?: string): Promise<string | undefined> {
  try {
    const ran = await $.process.run(['git', ...argv], { timeoutMs: 15_000, ...(cwd === undefined ? {} : { cwd }) })
    return ran.exitCode === 0 ? ran.stdout : undefined
  } catch {
    return undefined
  }
}

// The repository a command means: the directory named, the session's own, or
// the only one right beneath it. Without one, `hint` says why.
async function repoOf($: EngineInterface, dir: string): Promise<{ root?: string; hint?: string }> {
  if (dir !== '') {
    return (await gitText($, ['rev-parse', '--git-dir'], dir)) === undefined ? { hint: `「${dir}」不是 git 仓库。` } : { root: dir }
  }
  if ((await gitText($, ['rev-parse', '--git-dir'])) !== undefined) {
    return { root: '.' }
  }
  const below: string[] = []
  try {
    const entries = await $.fs.list()
    for (const entry of entries.filter(one => one.kind === 'dir' && !one.name.startsWith('.')).slice(0, 40)) {
      if (await $.fs.exists(`${entry.name}/.git`)) {
        below.push(entry.name)
      }
    }
  } catch {
    // A directory that does not list has no repositories to offer.
  }
  if (below.length === 1) {
    return { root: below[0] }
  }
  return { hint: below.length === 0 ? '这里不是 git 仓库。' : `这里不是 git 仓库，下面有 ${below.join('、')}：在命令后面写上目录名。` }
}

// Files git does not track yet, as the diffs that would add them; `unread`
// names the ones left out (not text, or too big).
async function newFiles($: EngineInterface, root: string, paths: readonly string[]): Promise<{ diff: string; unread: string[] }> {
  const listed = (await gitText($, ['ls-files', '--others', '--exclude-standard', ...(paths.length === 0 ? [] : ['--', ...paths])], root)) ?? ''
  const names = listed.split('\n').filter(name => name !== '')
  const parts: string[] = []
  const unread: string[] = names.slice(60)
  for (const file of names.slice(0, 60)) {
    try {
      const path = root === '.' ? file : `${root}/${file}`
      const stat = await $.fs.stat(path)
      const text = isOpaqueFile(file) || stat.kind !== 'file' || stat.size > 120_000 ? undefined : await $.fs.read(path)
      if (text === undefined || text.includes('\u0000')) {
        unread.push(file)
      } else {
        parts.push(newFileDiff(file, text))
      }
    } catch {
      unread.push(file)
    }
  }
  return { diff: parts.join(''), unread }
}

// What changed in a repository since its last commit, as one diff: tracked
// files, and the new ones as `newFiles` has them.
async function changes($: EngineInterface, root: string): Promise<{ diff: string; unread: string[] } | undefined> {
  let tracked = await gitText($, ['diff', 'HEAD', '--relative', '--no-color'], root)
  if (tracked === undefined) {
    // No commit yet: what is staged, and what is not.
    const staged = await gitText($, ['diff', '--cached', '--relative', '--no-color'], root)
    const loose = await gitText($, ['diff', '--relative', '--no-color'], root)
    if (staged === undefined && loose === undefined) {
      return undefined
    }
    tracked = `${staged ?? ''}${loose ?? ''}`
  }
  const fresh = await newFiles($, root, [])
  return { diff: tracked + fresh.diff, unread: fresh.unread }
}

// A secret in what `git commit` is about to record, in words; else undefined.
async function stagedSecret($: EngineInterface, commit: Commit): Promise<string | undefined> {
  const root = commit.dir ?? '.'
  const diffs = [await gitText($, ['diff', '--cached', '--unified=0', '--no-color'], root)]
  if (commit.isAll) {
    diffs.push(await gitText($, ['diff', '--unified=0', '--no-color'], root))
  }
  if (commit.adds.length > 0) {
    // What `git add` in the same command will have staged by then.
    diffs.push(await gitText($, ['diff', '--unified=0', '--no-color', '--', ...commit.adds], root))
    if (commit.withNew) {
      const fresh = await newFiles($, root, commit.adds)
      diffs.push(fresh.diff, ...fresh.unread.filter(isSensitiveFile).map(file => `+++ b/${file}`))
    }
  }
  const found = scanDiff(diffs.filter(one => one !== undefined).join('\n'))[0]
  return found === undefined ? undefined : `要提交的内容里有${found.kind}：${found.file}${found.line > 0 ? `:${found.line}` : ''}`
}

// Why a Bash command must wait for the person, as Claude is told it; undefined
// lets it run. One `/waifu allow` lets the very same command through once.
async function guardBash($: EngineInterface, script: string): Promise<string | undefined> {
  const now = await $.clock.now()
  if (allowed !== undefined && allowed.script === script && now < allowed.until) {
    allowed = undefined
    return undefined
  }
  const commit = commitOf(script)
  const why = riskOf(script)?.zh ?? (commit === undefined ? undefined : await stagedSecret($, commit))
  if (why === undefined) {
    return undefined
  }
  blocked = { script, why, at: now }
  day.blocked = (day.blocked ?? 0) + 1
  $.ui.toast(`安全检查拦下了一条命令：${why}。确认要执行就输入 /waifu allow`, { timeoutMs: 12_000 })
  quiet(onDuty($, 'guard', why, 'attack', 'key'))
  return (
    `anime-cheer 的安全检查拦下了这条命令：${why}。不要换一种写法绕过它。` +
    '请告诉用户：确认要执行的话，输入 /waifu allow，然后你再原样重试这条命令。'
  )
}

// A file Claude wrote: looked over for secrets.
async function noteEdit($: EngineInterface, path: string, text: string) {
  if (!isGuardOn || isSensitiveFile(path)) {
    return
  }
  const found = secretsIn(text)[0]
  const now = await $.clock.now()
  if (found === undefined || now - lastSecretTalk < 30_000) {
    return
  }
  lastSecretTalk = now
  const name = path.split('/').pop() ?? path
  $.ui.toast(`${name} 里出现了${found.kind}（${found.sample}），别提交上去`, { timeoutMs: 10_000 })
  await onDuty($, 'secret', `${name}：${found.kind}`, 'attack', 'key')
}

// A Bash command came back. A test run, a build or a push whose outcome can
// be told is said out loud; any other failure gets the usual attack.
async function afterBash($: EngineInterface, script: string, hasFailed: boolean, output: string) {
  const outcomes = watchesOf(script).map(watch => ({ kind: watch.kind, outcome: outcomeOf(watch, hasFailed, output) }))
  const bad = outcomes.find(one => one.outcome === 'fail')
  const good = [...outcomes].reverse().find(one => one.outcome === 'pass')
  const duty: Duty | undefined =
    bad !== undefined
      ? bad.kind === 'test'
        ? 'testFail'
        : bad.kind === 'build'
          ? 'buildFail'
          : undefined
      : good?.kind === 'push'
        ? 'pushDone'
        : good?.kind === 'test'
          ? 'testPass'
          : undefined
  if (duty === undefined) {
    if (hasFailed) {
      await toolFailed($)
    }
    return
  }
  const now = await $.clock.now()
  if (now - lastResultTalk >= 8000) {
    lastResultTalk = now
    await onDuty($, duty, undefined, bad === undefined ? 'cheer' : 'attack', 'key')
  }
}

// `/waifu scan`: secrets and sensitive files in what changed since the last
// commit, files not yet tracked included.
async function securityScan($: EngineInterface, dir: string): Promise<string> {
  const { root, hint } = await repoOf($, dir)
  const found = root === undefined ? undefined : await changes($, root)
  if (root === undefined || found === undefined) {
    return `${hint ?? '读不到这个仓库的改动。'}没法扫描。`
  }
  const findings: Finding[] = [
    ...scanDiff(found.diff),
    ...found.unread.filter(isSensitiveFile).map(file => ({ file, line: 0, kind: '敏感文件', sample: file.split('/').pop() ?? file })),
  ]
  const files = (found.diff.match(/^\+\+\+ /gm) ?? []).length + found.unread.length
  const isClean = findings.length === 0
  const name = await onDuty($, isClean ? 'scanClean' : 'scanFound', isClean ? undefined : `${findings.length} 处`, isClean ? 'cheer' : 'attack', 'key')
  return scanReport(name ?? '应援团', findings, files) + (root === '.' ? '' : `\n仓库：${root}`)
}

// `/waifu review`: a model reads the changes; a girl paces while it does,
// then gives the verdict.
async function codeReview($: EngineInterface, dir: string): Promise<string> {
  if (isReviewing) {
    return '上一次 review 还没结束，稍等。'
  }
  const { root, hint } = await repoOf($, dir)
  const found = root === undefined ? undefined : await changes($, root)
  if (root === undefined || found === undefined) {
    return `${hint ?? '读不到这个仓库的改动。'}没法 review。`
  }
  const { text, files, omitted } = trimDiff(found.diff)
  const skipped = [...omitted, ...found.unread]
  if (files === 0) {
    return skipped.length > 0 ? `改动都太大、不是文本或者是锁文件，没法 review：${skipped.slice(0, 8).join('、')}` : '工作区没有改动，没什么可 review 的。'
  }
  isReviewing = true
  const reviewer = isShown() ? (pick(free()) ?? pick(onStage(world))) : undefined
  try {
    if (reviewer !== undefined) {
      pace(world, reviewer.id, await $.clock.now(), 150_000)
      quiet(say($, reviewer, dutyLine(reviewer.id, 'reviewStart'), 'key'))
    }
    const prompt = reviewPrompt(text, skipped)
    let model = REVIEW_MODEL
    let reply = await $.model.complete({ model, system: REVIEW_SYSTEM, prompt, maxTokens: 2000, timeoutMs: 120_000 })
    if (!reply.isAnswered) {
      model = CHAT_MODEL
      reply = await $.model.complete({ model, system: REVIEW_SYSTEM, prompt, maxTokens: 2000, timeoutMs: 60_000 })
    }
    if (!reply.isAnswered) {
      return 'review 没跑成：模型没有回答。稍后再试，或者用 /code-review。'
    }
    const review = parseReview(reply.text)
    if (review === undefined) {
      return `🔍 模型的回答不是约定的格式，原文如下：\n${reply.text.slice(0, 1500)}`
    }
    day.reviews = (day.reviews ?? 0) + 1
    const isGood = review.verdict === 'ok'
    if (reviewer !== undefined) {
      settle(world, reviewer.id)
    }
    const name = await onDuty($, isGood ? 'reviewGood' : 'reviewBad', review.summary, isGood ? 'cheer' : 'attack', 'key', reviewer?.id)
    return reviewReport(name ?? '应援团', review, files, skipped, model) + (root === '.' ? '' : `\n仓库：${root}`)
  } catch {
    return 'review 没跑成：调用模型时出错了。稍后再试，或者用 /code-review。'
  } finally {
    if (reviewer !== undefined) {
      settle(world, reviewer.id)
    }
    isReviewing = false
  }
}

// `/waifu recap`: the tasks done here, with the chat model's gist of them
// when it is allowed to talk and there are enough to sum up.
async function recall($: EngineInterface, now: number): Promise<string> {
  const name = await onDuty($, 'recap', lastTaskLine(tasks, now), undefined, 'key')
  const report = recapReport(name ?? '应援团', tasks, now)
  if (!isChatty || tasks.length < 3) {
    return report
  }
  try {
    const reply = await $.model.complete({ model: CHAT_MODEL, prompt: recapPrompt(tasks, now), maxTokens: 300, timeoutMs: 15_000 })
    return reply.isAnswered && reply.text.trim() !== '' ? `${report}\n要点（${CHAT_MODEL} 总结）：\n${reply.text.trim().slice(0, 400)}` : report
  } catch {
    return report
  }
}

// The turn's figures, once the engine has measured it: a girl reads them out.
async function reportTurn($: EngineInterface, id: string, eaten: number, at: number) {
  let percent = meter.percent
  try {
    percent = (await $.session.usage()).context.percent ?? percent
  } catch {
    // The last reading will do.
  }
  pending.push({ at, id, text: turnBrief(eaten, percent), loudness: 'event', move: 'cheer' })
}

// A system notification, for when the terminal is not in front (macOS).
async function notify($: EngineInterface, title: string, body: string) {
  if (!isNotifyOn) {
    return
  }
  try {
    await $.process.run(['osascript', '-e', `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`], { timeoutMs: 5000 })
  } catch {
    // No osascript here: the voice and the bubble still say it.
  }
}

// Claude stopped to wait for the person (a permission, a question).
async function needsYou($: EngineInterface, kind: string) {
  const now = await $.clock.now()
  if (now - lastNeedYou < 30_000) {
    return
  }
  lastNeedYou = now
  const isIdle = /idle/.test(kind)
  await onDuty($, 'needYou', undefined, isIdle ? undefined : 'cheer', isIdle ? 'chatter' : 'key')
}

// `/waifu …`: commands are English words; the Chinese ones still work.
// `isTyped` is true when the person typed the command themselves.
async function command($: EngineInterface, args: string, isTyped: boolean): Promise<string> {
  const now = await $.clock.now()
  const words = args.trim()
  const [first = '', ...rest] = words.split(/\s+/)
  const verb = first.toLowerCase()
  const target = rest.join(' ')
  const isOff = ['off', '关', '0', 'no'].includes(target.toLowerCase())

  if (words === '' && place === 'roam') {
    isHidden = !isHidden
    return isHidden ? '应援团先藏起来啦，/waifu 再叫我们出来～' : '应援团回来啦！'
  }
  if (['roam', '漫游'].includes(verb)) {
    place = 'roam'
    isHidden = false
    isMainScreen = false
    world.isRoaming = true
    await $.ui.close({ id: PANE })
    await savePrefs($)
    return '应援团跑到对话区里玩啦（需要全屏布局）'
  }
  if (['pane', '面板'].includes(verb)) {
    place = 'pane'
    world.isRoaming = false
    await dropAnchor($)
    $.ui.status(undefined)
    lastStatus = ''
    isDismissed = false
    await open($)
    await savePrefs($)
    return '应援团回到面板啦'
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
      .map(girl => `${actorOf(girl.id) ? '★' : '·'} ${girl.name}（${girl.kind}）  ${girl.id}`)
      .join('\n')
  }
  if (['call', '叫', '召唤'].includes(verb)) {
    const girl = findGirl(target)
    if (girl === undefined || !canDraw(girl)) {
      return `没有叫「${target}」的人哦，/waifu list 看看`
    }
    await attend($, now)
    bring(girl, now)
    pending.push({ at: now + 5000, id: girl.id, text: lineOf(girl, 'hello') ?? '', loudness: 'event' })
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
    return '换了一批新面孔～'
  }
  if (['token', 'tokens', 'usage', '余量', '用量', '额度'].includes(verb)) {
    await attend($, now)
    const usage = await $.session.usage()
    await measured($, usage.context, usage.rateLimits, usage.cost, true)
    const actor = pick(free())
    if (actor !== undefined) {
      perform(world, actor.id, 'cheer', now, moveLength(actor.id, 'cheer') * TICK_MS + 400)
    }
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
  if (['today', '日报', '今日', '今天'].includes(verb)) {
    await attend($, now)
    const actor = pick(free())
    await say($, actor, dayComment(day), 'key')
    return dayReport((actor === undefined ? undefined : GIRLS.get(actor.id)?.name) ?? '应援团', day)
  }
  if (['budget', '预算'].includes(verb)) {
    const spent = meter.costUsd
    if (isOff) {
      budgetUsd = undefined
      budgetMark = 0
      await savePrefs($)
      return '预算提醒已取消。'
    }
    const usd = Number(target.replace(/^\$/, ''))
    if (!(usd > 0)) {
      return budgetUsd === undefined
        ? '用法：/waifu budget 5 设 5 美元的预算，/waifu budget off 取消。现在没有设预算。'
        : `现在的预算是 $${budgetUsd}` + (spent === undefined ? '。' : `，已花约 $${spent.toFixed(2)}。`) + '/waifu budget off 取消。'
    }
    budgetUsd = usd
    const used = ((spent ?? 0) / usd) * 100
    budgetMark = [100, 80, 50].find(floor => used >= floor) ?? 0
    await savePrefs($)
    return spent === undefined
      ? `预算设为 $${usd}。这个会话还没有花费数据；拿到之后，用到 50%、80%、100% 时提醒。`
      : `预算设为 $${usd}（已花约 $${spent.toFixed(2)}），用到 50%、80%、100% 时提醒。`
  }
  if (['recap', '回顾'].includes(verb)) {
    await attend($, now)
    return recall($, now)
  }
  if (['scan', '安检'].includes(verb)) {
    await attend($, now)
    return securityScan($, target)
  }
  if (verb === 'review') {
    await attend($, now)
    return codeReview($, target)
  }
  if (['guard', '守卫'].includes(verb)) {
    if (target !== '') {
      isGuardOn = !isOff
      await savePrefs($)
    }
    return isGuardOn
      ? `安全检查开着：危险命令会先拦下，等你输入 /waifu allow。今天拦下 ${day.blocked ?? 0} 条。/waifu guard off 关闭。`
      : '安全检查关着。/waifu guard on 打开。'
  }
  if (['allow', '放行'].includes(verb)) {
    if (!isTyped) {
      return '只有你亲手输入的 /waifu allow 才算数。'
    }
    if (blocked === undefined || now - blocked.at > 10 * 60_000) {
      return '现在没有被拦下的命令。'
    }
    allowed = { script: blocked.script, until: now + 5 * 60_000 }
    const what = blocked.script.replace(/\s+/g, ' ').slice(0, 80)
    blocked = undefined
    return `已放行一次（5 分钟内有效）：${what}\n让 Claude 原样重试这条命令就行。`
  }
  if (['notify', '通知'].includes(verb)) {
    if (target !== '') {
      isNotifyOn = !isOff
      await savePrefs($)
    }
    return isNotifyOn ? '长任务（超过一分钟）结束时会弹系统通知。/waifu notify off 关闭。' : '系统通知关着。/waifu notify on 打开。'
  }
  if (['fortune', '抽签', '运势', 'omikuji'].includes(verb)) {
    const { name, line } = fortune(Math.random())
    await attend($, now)
    const actor = pick(free())
    if (actor !== undefined) {
      const move = name.includes('吉') ? 'cheer' : 'attack'
      perform(world, actor.id, move, now, moveLength(actor.id, move) * TICK_MS + 400)
      await say($, actor, line, 'key')
    }
    return `🎋 今日运势：${name}`
  }
  const mode = VOICE_WORDS.get(verb)
  if (mode !== undefined) {
    voiceMode = mode
    await savePrefs($)
    return { off: '配音已关闭', less: '只在关键时刻说话', on: '配音全开！' }[mode]
  }
  if (verb === 'ai') {
    isChatty = !isOff
    await savePrefs($)
    return isChatty ? 'AI 即兴聊天已开启' : 'AI 即兴聊天已关闭，只说预设台词'
  }

  const named = words.match(/^(\S+?)[\s:：，,]+(.+)$/)
  const asked = named ? findGirl(named[1]!) : undefined
  const namedGirl = asked !== undefined && canDraw(asked) ? asked : undefined
  await attend($, now)
  // Someone on the stage answers before anyone is fetched from the wings.
  const girl = namedGirl ?? GIRLS.get((pick(free()) ?? pick(onStage(world)))?.id ?? '') ?? pick(available()) ?? pick(CAST)!
  const said = namedGirl !== undefined && named !== null ? named[2]! : words
  quiet(chatWith($, girl, said))
  return `（${girl.name}听到了）`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'waifu', description: '动漫应援团：流量汇报、安全检查、review、任务回顾、聊天（/waifu help）' })
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
    nextRotateAt = now + rand(2 * 60_000, 4 * 60_000)
    $.clock.every(TICK_MS, () => void step($))
    if (place === 'pane') {
      quiet(open($))
    } else {
      quiet($.ui.close({ id: PANE }))
    }
    const greeter = pick(onStage(world))
    if (greeter !== undefined) {
      pending.push({ at: now + 1500, id: greeter.id, text: lineOf(GIRLS.get(greeter.id)!, 'hello') ?? '', loudness: 'event' })
    }
    try {
      tasksKey = projectKey(await $.session.cwd())
      tasks = ((await $.store.get(tasksKey)) as Task[] | undefined) ?? []
      const sessionId = await $.session.id()
      const last = lastTaskLine(tasks, now)
      // Once per session: what was done here last time.
      if (greeter !== undefined && last !== undefined && (await $.store.get('recapped')) !== sessionId) {
        await $.store.set('recapped', sessionId)
        pending.push({ at: now + 8000, id: greeter.id, text: withDetail(dutyLine(greeter.id, 'recap'), last), loudness: 'event' })
      }
    } catch {
      tasks = []
    }

    return next(e)
  })

  on('command.run', { command: 'waifu' }, async ($, e) => ({ text: await command($, e.args, e.origin.kind === 'composer') }))

  on('classic.Notification', ($, e, next) => {
    quiet(needsYou($, e.notification_type))

    return next(e)
  })

  on('ui.close', ($, e, next) => {
    if (e.id === PANE) {
      isOpen = false
      isDismissed ||= e.origin.kind === 'person'
    }

    return next(e)
  })

  on('prompt.submit', ($, e, next) => {
    hasPrompt = true
    if (place === 'pane' && !isOpen && !isDismissed) {
      quiet(open($))
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
    turnPrompt = e.text
    turnFiles = []
    wake(world, now)
    setMode(world, 'work', now)
    const lead = pick(free())
    quiet(say($, lead, lead === undefined ? undefined : lineOf(GIRLS.get(lead.id)!, 'start'), 'event'))

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    tools += 1
    day.tools += 1
    // Only a command the guard may stop waits for anything ahead of the call:
    // the girls never hold another tool up.
    if (isGuardOn && e.tool === 'Bash' && mayStop(e.command)) {
      const reason = await guardBash($, e.command)
      if (reason !== undefined) {
        return { deny: reason }
      }
    }
    if (e.tool === 'Write' || e.tool === 'Edit') {
      turnFiles.push(e.file_path.split('/').slice(-2).join('/'))
      quiet(noteEdit($, e.file_path, e.tool === 'Write' ? e.content : e.new_string))
    }
    quiet(toolTalk($, e.tool))
    const ran = await next(e)
    if (ran.deny === undefined) {
      if (ran.isError === true) {
        day.errors += 1
      }
      if (e.tool === 'Bash') {
        quiet(afterBash($, e.command, ran.isError === true, ran.text ?? ''))
      } else if (ran.isError === true) {
        quiet(toolFailed($))
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
        quiet(thoughtDone($))
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

  on('ui.render', { component: 'Spinner' }, async ($, e, next) =>
    e.surface === 'terminal'
      ? decorate($, { component: e.component, requestId: e.requestId, viewport: e.viewport, props: {} }, await next(e), $.ui.resolve(e), true)
      : next(e),
  )

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const saved = await read($, stage)
    const shownView = { caption: saved.caption ?? '', bubbles: saved.bubbles ?? [] }
    isOpen = true
    if (place !== 'pane') {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>应援团在对话区里玩呢～ /waifu pane 可以叫回来</Text>
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
