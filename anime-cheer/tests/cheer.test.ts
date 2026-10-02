import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On, ToolCallResult } from 'claude-code'

import { projectKey } from '../hooks/journal'

const PANE = {
  plugin: 'anime-cheer',
  component: 'Pane',
  requestId: 'anime-cheer',
  props: {
    title: '应援团',
    isFocused: false,
    bodyColumns: 64,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 18 },
    view: {},
  },
} as const

const START = { cwd: '/tmp', surface: 'terminal', isInteractive: true } as const
const RAN = { exitCode: 0, stdout: '14\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

// Secret-looking strings are put together here, so that this file holds none
// for a scanner (the mod's own included) to find.
const AWS_KEY = ['AKIA', 'IOSFODNN7EXAMPLQ'].join('')
const PASSWORD = ['pass', 'word = "hunter2hunter2"'].join('')

const TINY_PACK = JSON.stringify({
  id: 'mai',
  facing: 1,
  frames: [{ w: 2, h: 2, ax: 1, ay: 2, px: '/////wAA/wAAAP8A/////w==' }],
  anims: { idle: [0], walk: [0], dance: [0], cheer: [0], attack: [0], sleep: [0] },
})

// What lies outside the session, as a test sets it up: git's answers (by its
// arguments and the name of its working directory; undefined is a failure),
// files by their path beneath the session's directory, the directories right
// beneath it, and what a tool answers.
type Disk = {
  shell?: (argv: readonly string[], cwd: string | undefined) => string | undefined
  files?: Record<string, string>
  dirs?: readonly string[]
  tool?: () => ToolCallResult
}

// The engine beneath the plugin: a clock the test moves, a store it can look
// into, panes that open, clips that play, toasts, chat model calls and
// processes (each kept), a chat model with one reply.
function engine(on: On, place: 'pane' | 'roam' = 'pane', packs: Record<string, string> = {}, reply = '哼，还不错嘛', disk: Disk = {}) {
  const clock = mock.clock(on, { now: 1_000_000 })
  const store = new Map<string, unknown>([['prefs', { place }]])
  const played: string[] = []
  const toasts: string[] = []
  const asked: string[] = []
  const opened: string[] = []
  const runs: (readonly string[])[] = []
  // The engine hands a path over resolved against the session's directory.
  const fileAt = (path: string) => Object.entries(disk.files ?? {}).find(([name]) => path === name || path.endsWith(`/${name}`))?.[1]
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('session.cwd', () => ({ value: '/tmp' }))
  on('session.id', () => ({ value: 'session-1' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('ui.blit', () => ({ value: {} }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('fs.list', ($, e) => {
    const names = (e.path ?? '').endsWith('/packs') ? Object.keys(packs) : (disk.dirs ?? [])
    return { value: names.map(name => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('fs.exists', ($, e) => ({ value: fileAt(e.path) !== undefined }))
  on('fs.stat', ($, e) => {
    const text = fileAt(e.path)
    if (text === undefined) {
      throw new Error(`ENOENT: ${e.path}`)
    }
    return { value: { kind: 'file', size: text.length, mtimeMs: 0, isLink: false } }
  })
  on('fs.read', ($, e) => {
    const pack = Object.entries(packs).find(([name]) => e.path.endsWith(`packs/${name}/pack.json`))
    return { value: pack?.[1] ?? fileAt(e.path) ?? '{"tts": "/usr/bin/true"}' }
  })
  on('process.run', ($, e) => {
    runs.push(e.argv)
    if (e.argv[0] !== 'git') {
      return { value: RAN }
    }
    const out = disk.shell?.(e.argv, e.init?.cwd?.split('/').pop())
    return { value: out === undefined ? { ...RAN, exitCode: 128, stdout: '' } : { ...RAN, stdout: out } }
  })
  on('audio.play', ($, e) => {
    played.push(e.clip.asset ?? 'other')
    return { value: undefined }
  })
  on('model.complete', ($, e) => {
    asked.push(e.prompt)
    return { value: { isAnswered: true, text: reply, usage: USAGE } }
  })
  on('tool.call', () => disk.tool?.() ?? { result: {}, text: 'ran' })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  return { clock, played, toasts, asked, opened, store, runs }
}

const starred = (list: string | undefined) =>
  (list ?? '')
    .split('\n')
    .filter(line => line.startsWith('★'))
    .map(line => line.slice(2).split('（')[0]!)
const stars = (list: string | undefined) => starred(list).length

// The opening cast is drawn by lot: send it off and call these in, in this
// order, then give them time to walk on.
async function cast($: Engine, clock: MockClock, ...names: string[]) {
  for (const name of starred((await $.command.run(run('list'))).text)) {
    await $.command.run(run(`bye ${name}`))
  }
  await clock.advance(3000)
  for (const name of names) {
    await $.command.run(run(`call ${name}`))
  }
  await clock.advance(10_000)
}
const turn = (id: string, usage?: { input: number; output: number; cacheRead: number; cacheWrite: number }) => ({
  answer: '改好了：表单校验补上了，十二个测试全部通过，可以提交了。再看看还有没有别的要改？',
  durationMs: 4000,
  isAborted: false,
  turnId: id,
  reason: 'answer' as const,
  ...(usage === undefined
    ? {}
    : {
        usage: {
          input_tokens: usage.input,
          output_tokens: usage.output,
          cache_read_input_tokens: usage.cacheRead,
          cache_creation_input_tokens: usage.cacheWrite,
          model: 'm',
        },
      }),
})

const run = (args: string) => ({
  command: 'waifu',
  args,
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 160 },
}) as const

// Why a tool call did not run, however the engine words the refusal.
const reasonOf = (ran: ToolCallResult) => ran.deny ?? ran.text ?? ''

test('girls cheer while a turn runs, serve tea after it, then rest', async ($, on) => {
  const { clock, played } = engine(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Raster', key: 'stage' })).toBeDefined()

  await clock.advance(2000)
  expect(await ui.find({ type: 'Text', text: /：/ })).toBeDefined()
  await cast($, clock, '纱希', '凛')
  expect(await ui.find({ type: 'Text', text: /🌸 (纱希、凛|凛、纱希) ·/ })).toBeDefined()

  await $.turn.start({ text: 'go', turnId: 't1' })
  await clock.advance(150)
  expect(await ui.find({ type: 'Text', text: /应援中/ })).toBeDefined()

  await $.turn.complete({ answer: 'ok', durationMs: 4000, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(150)
  expect(await ui.find({ type: 'Text', text: /茶歇中 · 本轮 4s/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /纱希：/ })).toBeDefined()
  expect(played.some(asset => asset.startsWith('voices/saki/'))).toBe(true)

  await clock.advance(23_000)
  expect(await ui.find({ type: 'Text', text: /🌸 .* · \/waifu help/ })).toBeDefined()
  await ui.unmount()
})

test('/waifu lists, summons and chats', async ($, on) => {
  const { clock } = engine(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await cast($, clock, '纱希', '凛')
  const list = await $.command.run(run('list'))
  expect(list.text?.split('\n')).toHaveLength(11)
  expect(starred(list.text).sort()).toEqual(['凛', '纱希'].sort())
  expect(list.text).toContain('· 雪（三无少女）  yuki')

  // The newcomer takes the place of whoever has been there longest.
  expect((await $.command.run(run('call yuki'))).text).toBe('雪来啦～')
  expect(starred((await $.command.run(run('list'))).text).sort()).toEqual(['凛', '雪'].sort())

  expect((await $.command.run(run('rin 今天累死了'))).text).toBe('（凛听到了）')
  await clock.advance(1000)
  expect(await ui.find({ type: 'Text', text: /凛：哼，还不错嘛/ })).toBeDefined()

  expect((await $.command.run(run('mute'))).text).toBe('配音已关闭')
  await clock.advance(150)
  expect(await ui.find({ type: 'Text', text: /🔇/ })).toBeDefined()
  await ui.unmount()
})

test('commands are English words, and the Chinese ones still work', async ($, on) => {
  const { clock } = engine(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await cast($, clock, '纱希', '凛')

  const help = (await $.command.run(run('help'))).text ?? ''
  for (const verb of ['token', 'today', 'budget', 'recap', 'review', 'scan', 'guard', 'allow', 'notify', 'fortune', 'list', 'roam', 'mute', 'ai on|off']) {
    expect(help).toContain(`/waifu ${verb}`)
  }
  expect((await $.command.run(run('名单'))).text).toBe((await $.command.run(run('list'))).text)
  expect((await $.command.run(run('LIST'))).text).toBe((await $.command.run(run('list'))).text)
  expect((await $.command.run(run('叫 三无'))).text).toBe('雪来啦～')
  expect((await $.command.run(run('退下 雪'))).text).toBe('雪退下了')
  expect((await $.command.run(run('静音'))).text).toBe('配音已关闭')
  expect((await $.command.run(run('voice'))).text).toBe('配音全开！')
  expect((await $.command.run(run('less'))).text).toBe('只在关键时刻说话')
  expect((await $.command.run(run('ai off'))).text).toBe('AI 即兴聊天已关闭，只说预设台词')
  expect((await $.command.run(run('ai on'))).text).toBe('AI 即兴聊天已开启')
  expect((await $.command.run(run('shuffle'))).text).toBe('换了一批新面孔～')
  expect((await $.command.run(run('fortune'))).text).toMatch(/^🎋 今日运势：/)
  expect((await $.command.run(run('today'))).text).toContain('对话 0 轮')
  expect((await $.command.run(run('call nobody'))).text).toContain('/waifu list')
  await ui.unmount()
})

test('a short tea break once the model has finished thinking', async ($, on) => {
  const { clock } = engine(on)
  on('turn.step', async function* ($, e) {
    yield { kind: 'thinking', index: 0, text: 'hmm' }
    yield { kind: 'text', index: 1, text: 'ok' }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await $.turn.start({ text: 'go', turnId: 't1' })
  const kinds: string[] = []
  for await (const chunk of $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 })) {
    kinds.push(chunk.kind)
  }
  expect(kinds).toEqual(['thinking', 'text'])

  await clock.advance(150)
  expect(await ui.find({ type: 'Text', text: /茶歇中/ })).toBeDefined()
  await clock.advance(7000)
  expect(await ui.find({ type: 'Text', text: /应援中/ })).toBeDefined()
  await ui.unmount()
})

test('a subagent finishing does not end the dance', async ($, on) => {
  const { clock } = engine(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.turn.complete({
    answer: 'sub done',
    durationMs: 1000,
    isAborted: false,
    turnId: 't2',
    agentId: 'agent-1',
    reason: 'answer',
  })
  await clock.advance(150)
  expect(await ui.find({ type: 'Text', text: /应援中/ })).toBeDefined()
  await ui.unmount()
})

test('surfaces without a Raster still show what the girls say', async ($, on) => {
  const { clock } = engine(on)
  await $.session.start({ ...START, surface: 'desktop' })
  await clock.advance(2000)
  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /waifu/ })).toBeDefined()
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    await ui.unmount()
  }
})

const ROW = {
  plugin: 'anime-cheer',
  component: 'TurnDuration',
  requestId: 'row-1',
  props: { word: 'Baked', durationMs: 4000, onScreen: { first: 0, last: 1, of: 2 } },
  viewport: { columns: 100, rows: 44, isFullscreen: true },
} as const

test('in fullscreen the girls roam over the newest transcript row', async ($, on) => {
  const { clock } = engine(on, 'roam')
  on('ui.render', { component: 'TurnDuration' }, () => ({ type: 'Text', props: {}, children: ['Baked for 4s'] }))
  await $.session.start(START)
  const row = await $.ui.mount({ ...ROW, surface: 'terminal' })
  await clock.advance(2000)

  expect(await row.find({ type: 'Text', text: 'Baked for 4s' })).toBeDefined()
  // A few Rasters per girl: bands of at most three cell rows.
  const bands = await row.findAll({ type: 'Raster' })
  expect(bands.length).toBeGreaterThanOrEqual(3)
  expect(bands.every(band => /^[a-z]+-\d+$/.test(band.key ?? '') && Number(band.props.rows) <= 3)).toBe(true)
  expect(await row.find({ type: 'Text', text: /：/ })).toBeDefined()

  expect((await $.command.run(run(''))).text).toContain('藏起来')
  await clock.advance(300)
  expect(await row.findAll({ type: 'Raster' })).toHaveLength(0)
  await row.unmount()
})

test('/waifu pane moves the troupe from the transcript to the pane', async ($, on) => {
  const { clock } = engine(on, 'roam')
  on('ui.render', { component: 'TurnDuration' }, () => ({ type: 'Text', props: {}, children: ['Baked for 4s'] }))
  await $.session.start(START)
  const row = await $.ui.mount({ ...ROW, surface: 'terminal' })
  await clock.advance(300)
  expect((await row.findAll({ type: 'Raster' })).length).toBeGreaterThan(0)

  expect((await $.command.run(run('pane'))).text).toBe('应援团回到面板啦')
  await clock.advance(300)
  expect(await row.findAll({ type: 'Raster' })).toHaveLength(0)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Raster', key: 'stage' })).toBeDefined()
  await pane.unmount()
  await row.unmount()
})

test('with imported packs only their girls take the stage, speaking Japanese under Chinese subtitles', async ($, on) => {
  const { clock, played } = engine(on, 'pane', { tiny: TINY_PACK }, 'やったね｜成功啦')
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect((await $.command.run(run('list'))).text).toBe('★ 不知火舞（性感女忍者）  mai')
  expect((await $.command.run(run('call 凛'))).text).toContain('没有叫「凛」的人')

  expect((await $.command.run(run('mai 你好'))).text).toBe('（不知火舞听到了）')
  await clock.advance(1000)
  expect(await ui.find({ type: 'Text', text: /不知火舞：成功啦/ })).toBeDefined()
  expect(played.some(asset => asset === 'other' || asset.startsWith('voices/mai/'))).toBe(true)
  await ui.unmount()
})

test('/waifu token reads out the context, the quota windows and the tokens eaten', async ($, on) => {
  const { clock } = engine(on)
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 90_000, window: 200_000, percent: 45 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 37.5, resetsAt: new Date(1_000_000 + 2 * 3_600_000).toISOString() }],
      cost: { usd: 3.2 },
    },
  }))
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.turn.complete({
    answer: 'done',
    durationMs: 4000,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
    usage: { input_tokens: 2000, output_tokens: 3100, cache_read_input_tokens: 48_000, cache_creation_input_tokens: 2000, model: 'm' },
  })

  const report = (await $.command.run(run('token'))).text ?? ''
  expect(report).toContain('上下文：45%（9.0万 / 20万）')
  expect(report).toContain('5 小时窗口用了 38%')
  expect(report).toContain('上一轮：输入 5.2万 · 输出 3100')
  await clock.advance(300)
  expect(await ui.find({ type: 'Text', text: /上下文 45%/ })).toBeDefined()

  expect((await $.command.run(run('fortune'))).text).toMatch(/^🎋 今日运势：/)
  expect((await $.command.run(run('today'))).text).toContain('对话 1 轮')
  await ui.unmount()
})

test('the stage never holds more than two, asleep or not', async ($, on) => {
  const { clock } = engine(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  // Twelve idle minutes: they doze off, and the troupe rotates a few times.
  let most = 0
  for (let minute = 0; minute < 12; minute++) {
    await clock.advance(60_000)
    most = Math.max(most, stars((await $.command.run(run('list'))).text))
  }
  expect(most).toBeLessThanOrEqual(2)
  expect(most).toBeGreaterThan(0)

  // Calling someone in while two are there sends one of them off first.
  await $.command.run(run('call 御姐'))
  await $.command.run(run('call 猫娘'))
  expect(stars((await $.command.run(run('list'))).text)).toBeLessThanOrEqual(2)
  await ui.unmount()
})

test('hidden, the troupe keeps quiet: no voices, no chat model calls; the guard still stands', async ($, on) => {
  const { clock, played, asked, toasts } = engine(on, 'roam')
  on('ui.render', { component: 'TurnDuration' }, () => ({ type: 'Text', props: {}, children: ['Baked for 4s'] }))
  await $.session.start(START)
  const row = await $.ui.mount({ ...ROW, surface: 'terminal' })
  await clock.advance(2000)
  expect(played.length).toBeGreaterThan(0)

  expect((await $.command.run(run(''))).text).toContain('藏起来')
  const before = played.length
  await $.turn.start({ text: 'go', turnId: 't1' })
  await clock.advance(20_000)
  expect(reasonOf(await $.tool.call({ tool: 'Bash', command: 'git push --force' }))).toContain('强制推送')
  expect(toasts.some(text => text.includes('/waifu allow'))).toBe(true)
  await $.turn.complete({ ...turn('t1', { input: 1000, output: 1000, cacheRead: 0, cacheWrite: 0 }), durationMs: 20_000 })
  await clock.advance(30_000)
  expect(played.length).toBe(before)
  expect(asked).toHaveLength(0)

  // Talking to them brings them back.
  expect((await $.command.run(run('凛 出来吧'))).text).toBe('（凛听到了）')
  await clock.advance(1000)
  expect(asked).toHaveLength(1)
  expect(await row.find({ type: 'Text', text: /凛：/ })).toBeDefined()
  await row.unmount()
})

test('on the main screen roaming opens no pane: one hint, then silence', async ($, on) => {
  const { clock, played, toasts, opened } = engine(on, 'roam')
  on('ui.render', { component: 'TurnDuration' }, () => ({ type: 'Text', props: {}, children: ['Baked for 4s'] }))
  await $.session.start(START)
  const row = await $.ui.mount({
    ...ROW,
    props: { word: 'Baked', durationMs: 4000 },
    viewport: { columns: 100, rows: 44, isFullscreen: false },
    surface: 'terminal',
  })
  await clock.advance(5000)
  expect(toasts.filter(text => text.includes('全屏布局'))).toEqual(['对话区漫游需要全屏布局；/waifu pane 可以打开面板'])
  expect(opened).toHaveLength(0)
  expect(await row.findAll({ type: 'Raster' })).toHaveLength(0)

  const before = played.length
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.turn.complete(turn('t1'))
  await clock.advance(30_000)
  expect(played.length).toBe(before)
  expect(toasts.filter(text => text.includes('全屏布局'))).toHaveLength(1)
  await row.unmount()
})

test('a tool call row and its result row share an id, and one stage', async ($, on) => {
  const { clock } = engine(on, 'roam')
  on('ui.render', { component: 'ToolUse' }, () => ({ type: 'Text', props: {}, children: ['Bash(ls)'] }))
  on('ui.render', { component: 'ToolResult' }, () => ({ type: 'Text', props: {}, children: ['3 files'] }))
  await $.session.start(START)
  const view = { viewport: { columns: 100, rows: 44, isFullscreen: true }, surface: 'terminal' } as const
  const onScreen = { first: 0, last: 0, of: 1 }
  const call = await $.ui.mount({
    plugin: 'anime-cheer',
    component: 'ToolUse',
    requestId: 'tool-1',
    props: { tool_use_id: 'tool-1', tool: 'Bash', input: {}, isRunning: false, isErrored: false, isInterrupted: false, onScreen },
    ...view,
  })
  const result = await $.ui.mount({
    plugin: 'anime-cheer',
    component: 'ToolResult',
    requestId: 'tool-1',
    props: { tool_use_id: 'tool-1', tool: 'Bash', output: '3 files', isErrored: false, onScreen },
    ...view,
  })
  await clock.advance(2000)
  const drawn = [(await call.findAll({ type: 'Raster' })).length, (await result.findAll({ type: 'Raster' })).length]
  expect(drawn.filter(count => count > 0)).toHaveLength(1)
  await call.unmount()
  await result.unmount()
})

test("a working turn's figures are read out: the new tokens it took, not the cache it re-read", async ($, on) => {
  const { clock } = engine(on)
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: 90_000, window: 200_000, percent: 45 }, rateLimits: [], cost: { usd: 0.5 } },
  }))
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.command.run(run('ai off'))

  // A quick answer with no tool is no work to report on.
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.turn.complete(turn('t1', { input: 2000, output: 3000, cacheRead: 900_000, cacheWrite: 1000 }))
  await clock.advance(12_000)
  expect(await ui.find({ type: 'Text', text: /这一轮/ })).toBeUndefined()
  await clock.advance(15_000)

  await $.turn.start({ text: 'go', turnId: 't2' })
  await $.turn.complete({ ...turn('t2', { input: 20_000, output: 5000, cacheRead: 900_000, cacheWrite: 45_000 }), durationMs: 20_000 })
  await clock.advance(10_000)
  expect(await ui.find({ type: 'Text', text: /这一轮 7\.0万/ })).toBeDefined()
  expect((await $.command.run(run('today'))).text).toContain('最能吃的一轮：7.0万 token（不含缓存命中）')

  // Not after every turn: the next one within the gap keeps to the tea.
  await clock.advance(15_000)
  await $.turn.start({ text: 'go', turnId: 't3' })
  await $.turn.complete({ ...turn('t3', { input: 10_000, output: 2000, cacheRead: 900_000, cacheWrite: 0 }), durationMs: 20_000 })
  await clock.advance(10_000)
  expect(await ui.find({ type: 'Text', text: /这一轮 1\.2万/ })).toBeUndefined()

  await clock.advance(45_000)
  await $.turn.start({ text: 'go', turnId: 't4' })
  await $.turn.complete({ ...turn('t4', { input: 10_000, output: 2000, cacheRead: 900_000, cacheWrite: 0 }), durationMs: 20_000 })
  await clock.advance(10_000)
  expect(await ui.find({ type: 'Text', text: /这一轮 1\.2万/ })).toBeDefined()
  await ui.unmount()
})

test('a quota window first seen this session is the baseline; a later step is news', async ($, on) => {
  const { clock } = engine(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const resetsAt = new Date(1_000_000 + 2 * 3_600_000).toISOString()
  const context = { tokens: 20_000, window: 200_000, percent: 10 }

  await $.session.measure({ context, rateLimits: [{ kind: 'five_hour', percentUsed: 62, resetsAt }], changed: ['rateLimits'] })
  await clock.advance(1500)
  expect(await ui.find({ type: 'Text', text: /额度用了/ })).toBeUndefined()

  await $.session.measure({ context, rateLimits: [{ kind: 'five_hour', percentUsed: 85, resetsAt }], changed: ['rateLimits'] })
  await clock.advance(1500)
  expect(await ui.find({ type: 'Text', text: /5 小时额度用了 85%/ })).toBeDefined()
  await ui.unmount()
})

test('a girl sent off leaves, and no cast is kept for the next session', async ($, on) => {
  const { clock, store } = engine(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await cast($, clock, '纱希', '凛')

  expect((await $.command.run(run('bye 凛'))).text).toBe('凛退下了')
  await clock.advance(3000)
  expect(starred((await $.command.run(run('list'))).text)).toEqual(['纱希'])

  await $.command.run(run('mute'))
  expect(Object.keys(store.get('prefs') as object).sort()).toEqual(['ai', 'guard', 'notify', 'place', 'voice'])
  await ui.unmount()
})

test('the cast changes while Claude works, in silence, and never past two', async ($, on) => {
  const { clock, played } = engine(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(3000)
  await $.command.run(run('mute'))
  const seen = new Set(starred((await $.command.run(run('list'))).text))
  const before = played.length

  // Three rotations at the least in twelve and a half minutes of one turn.
  await $.turn.start({ text: 'go', turnId: 't1' })
  for (let quarter = 0; quarter < 50; quarter++) {
    await clock.advance(15_000)
    const now = starred((await $.command.run(run('list'))).text)
    expect(now.length).toBeGreaterThanOrEqual(1)
    expect(now.length).toBeLessThanOrEqual(2)
    now.forEach(name => seen.add(name))
  }
  expect(seen.size).toBeGreaterThanOrEqual(3)
  expect(played.length).toBe(before)
  await ui.unmount()
})

test('a dangerous command waits for the person: stopped, then let through once by a typed /waifu allow', async ($, on) => {
  const { clock, toasts } = engine(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(2000)
  const danger = { tool: 'Bash', command: 'cd ~ && rm -rf ~/Desktop' } as const

  expect((await $.command.run(run('allow'))).text).toBe('现在没有被拦下的命令。')
  expect(reasonOf(await $.tool.call(danger))).toContain('安全检查拦下了这条命令：递归删除 ~/Desktop')
  expect(toasts.filter(text => text.includes('/waifu allow'))).toHaveLength(1)
  await clock.advance(300)
  expect(await ui.find({ type: 'Text', text: /等等！/ })).toBeDefined()

  // Only the person's own Enter lets it through.
  expect((await $.command.run({ ...run('allow'), origin: { kind: 'sdk' } })).text).toContain('亲手输入')
  expect(reasonOf(await $.tool.call(danger))).toContain('拦下')

  expect((await $.command.run(run('allow'))).text).toContain('已放行一次')
  // Another command is not the one that was let through.
  expect(reasonOf(await $.tool.call({ tool: 'Bash', command: 'rm -rf ~' }))).toContain('拦下')
  expect((await $.command.run(run('allow'))).text).toContain('rm -rf ~')
  expect((await $.tool.call({ tool: 'Bash', command: 'rm -rf ~' })).text).toBe('ran')
  // Once only.
  expect(reasonOf(await $.tool.call({ tool: 'Bash', command: 'rm -rf ~' }))).toContain('拦下')

  // What is not dangerous is never held up.
  expect((await $.tool.call({ tool: 'Bash', command: 'rm -rf node_modules && git commit -m "rm -rf / in the docs"' })).text).toBe('ran')

  expect((await $.command.run(run('today'))).text).toContain('安全检查拦下 4 条命令')
  expect((await $.command.run(run('guard off'))).text).toContain('安全检查关着')
  expect((await $.tool.call(danger)).text).toBe('ran')
  expect((await $.command.run(run('guard on'))).text).toContain('安全检查开着')
  await ui.unmount()
})

const SECRET_DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -10,0 +11 @@',
  `+const k = "${AWS_KEY}"`,
  '',
].join('\n')
const CLEAN_DIFF = ['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1 +1 @@', '-const a = 1', '+const a = 2', ''].join('\n')

test('git commit waits when what it is about to record holds a secret', async ($, on) => {
  let staged = SECRET_DIFF
  const { clock, toasts } = engine(on, 'pane', {}, 'x', {
    shell: argv => (argv.includes('--cached') ? staged : argv.includes('ls-files') ? '.env\nnotes.md\n' : ''),
    files: { '.env': 'TOKEN=1\n', 'notes.md': 'hello\n' },
  })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(2000)

  expect(reasonOf(await $.tool.call({ tool: 'Bash', command: 'git commit -m "add config"' }))).toContain('要提交的内容里有AWS 访问密钥：src/a.ts:11')
  expect(toasts.some(text => text.includes('AWS 访问密钥'))).toBe(true)

  staged = CLEAN_DIFF
  expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m "add config"' })).text).toBe('ran')

  // `git add` in the same command: what it will have staged is looked at too.
  expect(reasonOf(await $.tool.call({ tool: 'Bash', command: 'git add -A && git commit -m "all of it"' }))).toContain('要提交的内容里有敏感文件：.env')
  expect((await $.tool.call({ tool: 'Bash', command: 'git add -u && git commit -m "tracked only"' })).text).toBe('ran')
  await ui.unmount()
})

test('a secret in a file Claude writes is pointed out', async ($, on) => {
  const { clock, toasts } = engine(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(2000)

  await $.tool.call({ tool: 'Write', file_path: '/work/app/config.ts', content: `export const key = "${AWS_KEY}"\n` })
  await clock.advance(300)
  expect(toasts).toContain('config.ts 里出现了AWS 访问密钥（AKIAIO…LQ），别提交上去')
  expect(await ui.find({ type: 'Text', text: /密钥/ })).toBeDefined()

  // A file that is meant to hold secrets is not news.
  await clock.advance(40_000)
  await $.tool.call({ tool: 'Write', file_path: '/work/app/.env', content: `AWS_KEY=${AWS_KEY}\n` })
  await $.tool.call({ tool: 'Edit', file_path: '/work/app/a.ts', old_string: 'a', new_string: 'const a = 1' })
  await clock.advance(300)
  expect(toasts.filter(text => text.includes('里出现了'))).toHaveLength(1)
  await ui.unmount()
})

test('a test run, a build and a push are called as they came out, and not at all when that cannot be told', async ($, on) => {
  let answer: ToolCallResult = { result: {}, text: '5 passed' }
  const { clock } = engine(on, 'pane', {}, 'x', { tool: () => answer })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(2000)
  const said = async (command: string, text: RegExp) => {
    await clock.advance(10_000)
    await $.tool.call({ tool: 'Bash', command })
    await clock.advance(300)
    return (await ui.find({ type: 'Text', text })) !== undefined
  }

  expect(await said('npm test', /测试全过了/)).toBe(true)
  answer = { isError: true, result: undefined, text: 'boom' }
  expect(await said('cd app && npm test', /测试挂了/)).toBe(true)
  expect(await said('npm run build', /构建失败了/)).toBe(true)

  // Piped into `tail`, the exit status is no longer the test run's: its output tells.
  answer = { result: {}, text: '(fail) adds up\n 3 pass\n 1 fail' }
  expect(await said('npm test 2>&1 | tail -5', /测试挂了/)).toBe(true)
  answer = { result: {}, text: ' 4 pass\n 0 fail' }
  expect(await said('npm test 2>&1 | tail -5', /测试全过了/)).toBe(true)
  answer = { result: {}, text: 'done' }
  expect(await said('npm test | tail -1', /测试全过了|测试挂了/)).toBe(false)

  answer = { result: {}, text: 'To github.com:me/x.git\n   abc..def  main -> main' }
  expect(await said('git add . && git commit -m x && git push', /推送完成/)).toBe(true)
  answer = { result: {}, text: 'ok' }
  expect(await said('npm run build', /构建|测试|推送/)).toBe(false)
  await ui.unmount()
})

test('/waifu scan reads the changes of the one repository beneath the session', async ($, on) => {
  const { clock } = engine(on, 'pane', {}, 'x', {
    shell: (argv, cwd) => {
      if (cwd !== 'cc-mod') {
        return undefined
      }
      return argv.includes('rev-parse') ? '.git\n' : argv.includes('ls-files') ? '.env\nnotes.md\nlogo.png\n' : argv.includes('HEAD') ? SECRET_DIFF : ''
    },
    dirs: ['cc-mod', 'x-article'],
    files: { 'cc-mod/.git': '', 'cc-mod/.env': 'TOKEN=1\n', 'cc-mod/notes.md': `${PASSWORD}\n`, 'cc-mod/logo.png': '' },
  })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(2000)

  const report = (await $.command.run(run('scan'))).text ?? ''
  expect(report.split('\n').slice(1)).toEqual([
    '- src/a.ts:11  AWS 访问密钥  AKIAIO…LQ',
    '- .env  敏感文件  .env',
    '- notes.md:1  写死的密码或密钥  passwo…2"',
    '仓库：cc-mod',
  ])
  expect(report).toContain('4 个改动的文件里有 3 处要看一下')
  await clock.advance(300)
  expect(await ui.find({ type: 'Text', text: /可疑/ })).toBeDefined()

  expect((await $.command.run(run('scan x-article'))).text).toBe('「x-article」不是 git 仓库。没法扫描。')
  await ui.unmount()
})

test('/waifu scan finds nothing in clean changes, and says where there is no repository', async ($, on) => {
  let isRepo = true
  const { clock } = engine(on, 'pane', {}, 'x', { shell: argv => (!isRepo ? undefined : argv.includes('rev-parse') ? '.git\n' : argv.includes('HEAD') ? CLEAN_DIFF : '') })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(2000)

  expect((await $.command.run(run('scan'))).text).toMatch(/的安全检查：看了 1 个改动的文件，没发现密钥或敏感文件。$/)
  await clock.advance(300)
  expect(await ui.find({ type: 'Text', text: /安全检查完毕/ })).toBeDefined()

  isRepo = false
  expect((await $.command.run(run('scan'))).text).toBe('这里不是 git 仓库。没法扫描。')
  expect((await $.command.run(run('review'))).text).toBe('这里不是 git 仓库。没法 review。')
  await ui.unmount()
})

test('/waifu review hands the changes to a model and reports what it found', async ($, on) => {
  const verdict = JSON.stringify({
    verdict: 'bad',
    summary: '有一处空指针',
    findings: [{ file: 'src/a.ts', line: 12, severity: 'high', issue: 'user 可能为空', fix: '先判断再取值' }],
  })
  let tracked = SECRET_DIFF
  const { clock, asked } = engine(on, 'pane', {}, `好的：\n${verdict}`, {
    shell: argv => (argv.includes('rev-parse') ? '.git\n' : argv.includes('ls-files') ? 'src/new.ts\n' : argv.includes('HEAD') ? tracked : ''),
    files: { 'src/new.ts': 'export const fresh = 1\n' },
  })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(2000)
  await $.command.run(run('ai off'))

  const report = (await $.command.run(run('review'))).text ?? ''
  expect(report.split('\n').slice(1, 4)).toEqual(['结论：有一处空指针', '1. [高] src/a.ts:12  user 可能为空', '   建议：先判断再取值'])
  expect(report).toMatch(/的代码 review（2 个文件，sonnet）/)
  // The model read the tracked change and the file git does not know yet.
  expect(asked).toHaveLength(1)
  expect(asked[0]).toContain(`+const k = "${AWS_KEY}"`)
  expect(asked[0]).toContain('+export const fresh = 1')
  await clock.advance(300)
  expect(await ui.find({ type: 'Text', text: /这里最好改/ })).toBeDefined()
  expect((await $.command.run(run('today'))).text).toContain('review 1 次')

  tracked = ''
  expect((await $.command.run(run('review docs'))).text).toMatch(/review（1 个文件/)
  await ui.unmount()
})

test('/waifu review has nothing to do in a clean working tree', async ($, on) => {
  const { clock, asked } = engine(on, 'pane', {}, 'x', { shell: argv => (argv.includes('rev-parse') ? '.git\n' : '') })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(2000)
  expect((await $.command.run(run('review'))).text).toBe('工作区没有改动，没什么可 review 的。')
  expect(asked).toHaveLength(0)
  await ui.unmount()
})

test('a finished task is kept and recalled by /waifu recap; small talk and commands are not', async ($, on) => {
  const { clock, store } = engine(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(2000)
  await $.command.run(run('ai off'))
  const key = projectKey('/tmp')
  expect((await $.command.run(run('recap'))).text).toMatch(/这个项目里还没有记下过任务。$/)

  await $.turn.start({ text: '帮我把登录页的表单校验补上', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: '/work/app/src/Login.tsx', old_string: 'a', new_string: 'b' })
  await $.turn.complete({ ...turn('t1', { input: 1000, output: 2000, cacheRead: 50_000, cacheWrite: 0 }), durationMs: 20_000 })
  expect(store.get(key)).toMatchObject([{ prompt: '帮我把登录页的表单校验补上', seconds: 20, tools: 1, tokens: 3000, files: ['src/Login.tsx'], isOk: true }])

  await clock.advance(30_000)
  await $.turn.start({ text: '你好', turnId: 't2' })
  await $.turn.complete(turn('t2'))
  await clock.advance(30_000)
  await $.turn.start({ text: '/waifu token', turnId: 't3' })
  await $.turn.complete({ ...turn('t3'), durationMs: 9000 })
  expect(store.get(key)).toHaveLength(1)

  await clock.advance(60_000)
  const recap = (await $.command.run(run('recap'))).text ?? ''
  expect(recap).toMatch(/的任务回顾（最近 1 条，共 1 条）/)
  expect(recap).toContain('- 2 分钟前：帮我把登录页的表单校验补上')
  expect(recap).toContain('20s · 1 次工具 · 3000 token · 改了 src/Login.tsx')
  expect(recap).toContain('结果：改好了：表单校验补上了')
  await ui.unmount()
})

test('a new session opens with what was done here last, once', async ($, on) => {
  const { clock, store } = engine(on)
  store.set(projectKey('/tmp'), [
    { at: 1_000_000 - 3 * 3_600_000, prompt: '帮我把登录页的表单校验补上', answer: '', seconds: 20, tools: 3, tokens: 1000, files: [], isOk: true },
  ])
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(9000)
  expect(await ui.find({ type: 'Text', text: /接着上次的来吧/ })).toBeDefined()
  expect(store.get('recapped')).toBe('session-1')
  expect((await $.command.run(run('recap'))).text).toContain('- 3 小时前：帮我把登录页的表单校验补上')
  await ui.unmount()
})

test('/waifu budget warns at half, and when the budget is spent', async ($, on) => {
  const { clock, store } = engine(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(2000)
  const context = { tokens: 20_000, window: 200_000, percent: 10 }

  expect((await $.command.run(run('budget'))).text).toContain('现在没有设预算')
  expect((await $.command.run(run('budget $5'))).text).toContain('预算设为 $5')
  expect(store.get('prefs')).toMatchObject({ budget: 5 })

  await $.session.measure({ context, rateLimits: [], cost: { usd: 2.6 }, changed: ['cost'] })
  await clock.advance(1500)
  expect(await ui.find({ type: 'Text', text: /预算用了 50%/ })).toBeDefined()

  await clock.advance(10_000)
  await $.session.measure({ context, rateLimits: [], cost: { usd: 5.2 }, changed: ['cost'] })
  await clock.advance(300)
  expect(await ui.find({ type: 'Text', text: /超预算了/ })).toBeDefined()

  // Said once: more spending past the budget is no more news.
  await clock.advance(20_000)
  await $.session.measure({ context, rateLimits: [], cost: { usd: 5.6 }, changed: ['cost'] })
  await clock.advance(300)
  expect(await ui.find({ type: 'Text', text: /超预算了/ })).toBeUndefined()

  expect((await $.command.run(run('budget'))).text).toContain('现在的预算是 $5，已花约 $5.60')
  expect((await $.command.run(run('budget off'))).text).toBe('预算提醒已取消。')
  await ui.unmount()
})

test('Claude waiting for the person is said out loud, and a long turn ends with a system notification', async ($, on) => {
  const { clock, runs } = engine(on)
  on('classic.Notification', () => ({}))
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(2000)
  const notices = () => runs.filter(argv => argv[0] === 'osascript').map(argv => argv[2] ?? '')

  await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })
  await clock.advance(300)
  expect(await ui.find({ type: 'Text', text: /该你出场了/ })).toBeDefined()

  await $.turn.start({ text: '跑一遍完整的回归测试', turnId: 't1' })
  await $.turn.complete({ ...turn('t1'), durationMs: 61_000 })
  expect(notices()).toHaveLength(1)
  expect(notices()[0]).toContain('干完了（61 秒）：跑一遍完整的回归测试')

  // A short turn needs no notification, and neither does anyone who turned them off.
  await $.turn.start({ text: 'go', turnId: 't2' })
  await $.turn.complete(turn('t2'))
  expect((await $.command.run(run('notify off'))).text).toContain('系统通知关着')
  await $.turn.start({ text: 'go', turnId: 't3' })
  await $.turn.complete({ ...turn('t3'), durationMs: 61_000 })
  expect(notices()).toHaveLength(1)
  await ui.unmount()
})
