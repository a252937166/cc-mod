import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

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

// The engine beneath the plugin: a clock the test moves, panes that open,
// clips that play (and are counted), a chat model with one reply.
const TINY_PACK = JSON.stringify({
  id: 'mai',
  facing: 1,
  frames: [{ w: 2, h: 2, ax: 1, ay: 2, px: '/////wAA/wAAAP8A/////w==' }],
  anims: { idle: [0], walk: [0], dance: [0], cheer: [0], attack: [0], sleep: [0] },
})

function engine(on: On, place: 'pane' | 'roam' = 'pane', packs: Record<string, string> = {}, reply = '哼，还不错嘛') {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on, { prefs: { place, cast: ['saki', 'rin', 'reika', 'kaa'] } })
  const played: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.blit', () => ({ value: {} }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('fs.list', () => ({ value: Object.keys(packs).map(name => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })) }))
  on('fs.read', ($, e) => {
    const pack = Object.entries(packs).find(([name]) => e.path.endsWith(`packs/${name}/pack.json`))
    return { value: pack?.[1] ?? '{"tts": "/usr/bin/true"}' }
  })
  on('process.run', () => ({ value: RAN }))
  on('audio.play', ($, e) => {
    played.push(e.clip.asset ?? 'other')
    return { value: undefined }
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: reply, usage: USAGE } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  return { clock, played }
}

const run = (args: string) => ({
  command: 'waifu',
  args,
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 160 },
}) as const

test('girls cheer while a turn runs, serve tea after it, then rest', async ($, on) => {
  const { clock, played } = engine(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Raster', key: 'stage' })).toBeDefined()

  await clock.advance(2000)
  expect(await ui.find({ type: 'Text', text: /🌸 纱希、凛 ·/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /：/ })).toBeDefined()

  await $.turn.start({ text: 'go', turnId: 't1' })
  await clock.advance(150)
  expect(await ui.find({ type: 'Text', text: /应援中/ })).toBeDefined()

  await $.turn.complete({ answer: 'ok', durationMs: 4000, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(150)
  expect(await ui.find({ type: 'Text', text: /茶歇中 · 本轮 4s/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /纱希：/ })).toBeDefined()
  expect(played.some(asset => asset.startsWith('voices/saki/'))).toBe(true)

  await clock.advance(23_000)
  expect(await ui.find({ type: 'Text', text: /\/waifu 聊天/ })).toBeDefined()
  await ui.unmount()
})

test('/waifu lists, summons and chats', async ($, on) => {
  const { clock } = engine(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  const list = await $.command.run(run('名单'))
  expect(list.text?.split('\n')).toHaveLength(11)
  expect(list.text).toContain('★ 凛')
  expect(list.text).toContain('· 雪')

  expect((await $.command.run(run('叫 三无'))).text).toBe('雪来啦～')
  expect((await $.command.run(run('名单'))).text).toContain('★ 雪')

  expect((await $.command.run(run('凛 今天累死了'))).text).toBe('（凛听到了）')
  await clock.advance(1000)
  expect(await ui.find({ type: 'Text', text: /凛：哼，还不错嘛/ })).toBeDefined()

  expect((await $.command.run(run('静音'))).text).toBe('配音已关闭')
  await clock.advance(150)
  expect(await ui.find({ type: 'Text', text: /🔇/ })).toBeDefined()
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
  const strips = await row.findAll({ type: 'Raster' })
  expect(strips.length).toBeGreaterThan(10)
  expect(strips.every(strip => /^(saki|rin)-\d+$/.test(strip.key ?? '') && strip.props.rows === 1)).toBe(true)
  expect(await row.find({ type: 'Text', text: /：/ })).toBeDefined()

  expect((await $.command.run(run(''))).text).toContain('藏起来')
  await clock.advance(300)
  expect(await row.findAll({ type: 'Raster' })).toHaveLength(0)
  await row.unmount()
})

test('/waifu 面板 moves the troupe from the transcript to the pane', async ($, on) => {
  const { clock } = engine(on, 'roam')
  on('ui.render', { component: 'TurnDuration' }, () => ({ type: 'Text', props: {}, children: ['Baked for 4s'] }))
  await $.session.start(START)
  const row = await $.ui.mount({ ...ROW, surface: 'terminal' })
  await clock.advance(300)
  expect((await row.findAll({ type: 'Raster' })).length).toBeGreaterThan(0)

  expect((await $.command.run(run('面板'))).text).toBe('应援团回到侧边面板啦')
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

  expect((await $.command.run(run('名单'))).text).toBe('★ 不知火舞（性感女忍者）')
  expect((await $.command.run(run('叫 凛'))).text).toContain('没有叫「凛」的人')

  expect((await $.command.run(run('舞 你好'))).text).toBe('（不知火舞听到了）')
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

  expect((await $.command.run(run('抽签'))).text).toMatch(/^🎋 今日运势：/)
  expect((await $.command.run(run('日报'))).text).toContain('对话 1 轮')
  await ui.unmount()
})
