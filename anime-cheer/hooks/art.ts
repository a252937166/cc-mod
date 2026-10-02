// Drawing the stage: girls in poses, the desk where "you" sit, and the bits
// that float about. Two pixels per terminal cell (▀ ▄), so a stage of
// `columns × rows` cells is a `columns × rows*2` grid of colors.

import { CAST, type Girl } from './cast'

export const SPRITE_W = 12
export const SPRITE_H = 16

const NONE = -1
const DEFAULT = 0x01000000

const BASE: Readonly<Record<string, number>> = {
  S: 0xffe3d0,
  s: 0xf0bfa4,
  E: 0x3b2a4a,
  B: 0xff9db4,
  M: 0xe58a96,
  W: 0xffffff,
  K: 0x2a2833,
  G: 0x9e9eb8,
  Y: 0xffd54f,
  C: 0xffffff,
  R: 0xff4f7b,
  F: 0x5d4037,
}
const MOUTH_OPEN = 0x8e2443
const TEA = 0x9ccc65
const STEAM = 0xe6e6ee
const HEART = 0xff5c8a
const NOTE_COLORS = [0xffe066, 0x8ee8ff, 0xff8ac6, 0xb9f6ca]
const Z_COLOR = 0xb3c7ff

export class Canvas {
  readonly px: Int32Array

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.px = new Int32Array(w * h).fill(NONE)
  }

  dot(x: number, y: number, c: number) {
    const X = Math.round(x)
    const Y = Math.round(y)
    if (X >= 0 && Y >= 0 && X < this.w && Y < this.h) {
      this.px[Y * this.w + X] = c
    }
  }

  map(rows: readonly string[], x: number, y: number, colors: Readonly<Record<string, number>>) {
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const c = colors[row[i]!]
        if (c !== undefined) {
          this.dot(x + i, y + j, c)
        }
      }
    })
  }
}

export type Arms = 'down' | 'up' | 'out' | 'wave' | 'cup' | 'hidden'
export type Legs = 'stand' | 'liftL' | 'liftR'

export type Pose = {
  arms: Arms
  legs: Legs
  eyesShut: boolean
  mouthOpen: boolean
  bob: number
  flip: boolean
}

type Look = {
  colors: Int32Array
  letters: string[]
  sleeve: number
  hand: number
  skin: number
}

function lookOf(girl: Girl): Look {
  const palette: Record<string, number> = { ...BASE, ...(girl.palette ?? {}) }
  const skin = palette.S!
  palette.Q ??= skin
  palette.L ??= skin
  palette.P ??= palette.A ?? skin
  const colors = new Int32Array(SPRITE_W * SPRITE_H).fill(NONE)
  const letters: string[] = []
  ;(girl.sprite ?? []).forEach((row, y) => {
    for (let x = 0; x < SPRITE_W; x++) {
      const letter = row[x] ?? '.'
      letters.push(letter)
      const c = palette[letter]
      if (c !== undefined) {
        colors[y * SPRITE_W + x] = c
      }
    }
  })
  return { colors, letters, sleeve: palette.P!, hand: palette.Q!, skin }
}

const LOOKS = new Map(CAST.filter(girl => girl.sprite !== undefined).map(girl => [girl.id, lookOf(girl)]))

export type PackFrame = { w: number; h: number; ax: number; ay: number; px: Int32Array }

// An imported sprite sheet: its frames, which of them make each animation,
// and which way the drawings face (1 right, -1 left).
export type Pack = {
  id: string
  facing: 1 | -1
  frames: PackFrame[]
  anims: Readonly<Record<string, readonly number[]>>
  height: number
  isFloating: boolean
}

const PACKS = new Map<string, Pack>()

export function addPack(json: string): Pack {
  const raw = JSON.parse(json) as {
    id: string
    facing?: number
    float?: boolean
    frames: { w: number; h: number; ax: number; ay: number; px: string }[]
    anims?: Record<string, number[]>
  }
  const frames = raw.frames.map(frame => ({
    ...frame,
    px: new Int32Array(unbase64(frame.px).buffer, 0, frame.w * frame.h),
  }))
  const anims = raw.anims ?? {}
  const idle = anims.idle ?? frames.map((_, i) => i)
  const pack: Pack = {
    id: raw.id,
    facing: raw.facing === -1 ? -1 : 1,
    frames,
    anims,
    height: Math.max(1, ...idle.map(i => frames[i]?.ay ?? 0)),
    isFloating: raw.float === true,
  }
  PACKS.set(pack.id, pack)
  BOXES.clear()
  return pack
}

export function packOf(girl: Girl | undefined): Pack | undefined {
  return girl?.pack === undefined ? undefined : PACKS.get(girl.pack)
}

// Imported packs only; the hand-drawn girls stand in while none is loaded.
export function canDraw(girl: Girl | undefined): boolean {
  if (girl === undefined) {
    return false
  }
  return girl.pack === undefined ? PACKS.size === 0 && girl.sprite !== undefined : PACKS.has(girl.pack)
}

// `reach` is half her width standing: how far apart girls keep. `stride` is
// half her width walking: how far past the edge she is out of sight.
export type Box = { w: number; h: number; cx: number; reach: number; stride: number }

const BOXES = new Map<string, Box>()

// The fixed box a girl is drawn in on the stage: wide enough for every frame
// of hers either way round, tall enough for a bob above her. Only what is
// drawn in it covers the text beneath, so a roomy box costs nothing.
export function boxOf(girl: Girl): Box {
  const known = BOXES.get(girl.id)
  if (known !== undefined) {
    return known
  }
  const pack = packOf(girl)
  const plain = SPRITE_W / 2 + 1
  let box: Box = { w: SPRITE_W + 2, h: SPRITE_H + 4, cx: plain, reach: plain, stride: plain }
  if (pack !== undefined) {
    const framesOf = (anim: string) => (pack.anims[anim] ?? []).map(i => pack.frames[i]!)
    const halfOf = (frames: PackFrame[]) => Math.max(1, ...frames.map(frame => Math.max(frame.ax, frame.w - 1 - frame.ax)))
    const frames = Object.values(pack.anims).flatMap(list => list.map(i => pack.frames[i]!))
    const half = halfOf(frames)
    const tall = Math.max(...frames.map(frame => frame.ay)) + 4
    const reach = halfOf(framesOf('idle'))
    box = { w: half * 2 + 1, h: tall + (tall % 2), cx: half, reach, stride: Math.max(reach, halfOf(framesOf('walk'))) }
  }
  BOXES.set(girl.id, box)
  return box
}

export function heightOf(girl: Girl | undefined): number {
  return packOf(girl)?.height ?? SPRITE_H
}

export function animLength(pack: Pack, anim: string): number {
  return (pack.anims[anim] ?? pack.anims.idle ?? [0]).length
}

// One frame of a pack's animation, feet at (x, feet); `faceLeft` turns her.
export function drawPack(c: Canvas, pack: Pack, anim: string, step: number, x: number, feet: number, faceLeft: boolean) {
  const list = pack.anims[anim] ?? pack.anims.idle ?? [0]
  const frame = pack.frames[list[Math.abs(step) % list.length] ?? 0]
  if (frame === undefined) {
    return
  }
  const mirror = faceLeft ? pack.facing === 1 : pack.facing === -1
  const left = Math.round(x) - (mirror ? frame.w - 1 - frame.ax : frame.ax)
  const top = Math.round(feet) - frame.ay + 1
  for (let y = 0; y < frame.h; y++) {
    for (let fx = 0; fx < frame.w; fx++) {
      const color = frame.px[y * frame.w + fx]!
      if (color !== NONE) {
        c.dot(left + (mirror ? frame.w - 1 - fx : fx), top + y, color)
      }
    }
  }
}

// A girl standing with her feet at (x, feet): x is her middle column.
export function drawGirl(c: Canvas, girl: Girl, x: number, feet: number, pose: Pose) {
  const look = LOOKS.get(girl.id)
  if (look === undefined) {
    return
  }
  const left = Math.round(x) - SPRITE_W / 2
  const top = Math.round(feet) - (SPRITE_H - 1) - pose.bob
  const put = (sx: number, sy: number, color: number) =>
    c.dot(left + (pose.flip ? SPRITE_W - 1 - sx : sx), top + sy, color)

  for (let sy = 0; sy < SPRITE_H; sy++) {
    for (let sx = 0; sx < SPRITE_W; sx++) {
      const i = sy * SPRITE_W + sx
      const letter = look.letters[i]
      let color = look.colors[i]!
      if (color === NONE) {
        continue
      }
      if ((letter === 'P' || letter === 'Q') && pose.arms !== 'down' && pose.arms !== 'cup') {
        if (pose.arms !== 'wave' || sx > SPRITE_W / 2) {
          continue
        }
      }
      if (sy >= 13 && pose.legs !== 'stand') {
        continue
      }
      if (letter === 'I' && pose.eyesShut) {
        color = look.skin
      }
      if (letter === 'M' && pose.mouthOpen) {
        color = MOUTH_OPEN
      }
      put(sx, sy, color)
    }
  }

  if (pose.legs !== 'stand') {
    const shin = look.colors[13 * SPRITE_W + 4]!
    const sock = look.colors[14 * SPRITE_W + 4]!
    const shoe = look.colors[15 * SPRITE_W + 4]!
    for (const side of ['L', 'R'] as const) {
      const lx = side === 'L' ? 4 : 7
      const out = side === 'L' ? -1 : 1
      const isUp = pose.legs === (side === 'L' ? 'liftL' : 'liftR')
      put(lx, 13, shin)
      if (isUp) {
        put(lx, 14, shoe)
        put(lx + out, 14, shoe)
      } else {
        put(lx, 14, sock)
        put(lx, 15, shoe)
        put(lx + out, 15, shoe)
      }
    }
  }

  const { sleeve, hand } = look
  if (pose.arms === 'up' || pose.arms === 'wave') {
    if (pose.arms === 'up') {
      put(1, 7, sleeve)
      put(0, 6, hand)
      put(0, 5, hand)
    }
    put(10, 7, sleeve)
    put(11, 6, hand)
    put(11, 5, hand)
  }
  if (pose.arms === 'out') {
    put(1, 9, sleeve)
    put(0, 9, hand)
    put(10, 9, sleeve)
    put(11, 9, hand)
  }
  if (pose.arms === 'cup') {
    put(10, 9, TEA)
    put(11, 9, BASE.W!)
    put(10, 10, BASE.W!)
    put(11, 10, BASE.W!)
  }
}

// Pixels are half as wide as tall on the stage: small pictures draw doubled.
const wide = (rows: readonly string[]) => rows.map(row => row.replace(/./g, ch => ch + ch))

export function drawCup(c: Canvas, x: number, y: number, frame: number) {
  c.map(wide(['WG', 'WW']), x, y - 1, { W: BASE.W!, G: TEA })
  c.map(wide(['S']), x + 2 * Math.round(Math.sin(frame * 0.8)), y - 3, { S: STEAM })
  c.map(wide(['S']), x + 2 + 2 * Math.round(Math.sin(frame * 0.8 + 2)), y - 4, { S: STEAM })
}

export function drawHeart(c: Canvas, x: number, y: number) {
  c.map(wide(['X.X', 'XXX', '.X.']), x, y, { X: HEART })
}

export function drawNote(c: Canvas, x: number, y: number, frame: number) {
  c.map(wide(['.XX', '.X.', 'XX.']), x, y, { X: NOTE_COLORS[frame % NOTE_COLORS.length]! })
}

export function drawZ(c: Canvas, x: number, y: number) {
  c.map(wide(['XXX', '.X.', 'XXX']), x, y, { X: Z_COLOR })
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const DECODE = new Int16Array(128).fill(0)
for (let i = 0; i < ALPHABET.length; i++) {
  DECODE[ALPHABET.charCodeAt(i)] = i
}

function unbase64(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let at = 0
  let bits = 0
  let value = 0
  for (let i = 0; i < clean.length; i++) {
    value = ((value << 6) | DECODE[clean.charCodeAt(i)]!) & 0xffffff
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[at++] = (value >> bits) & 0xff
    }
  }
  return out
}

function base64(bytes: Uint8Array): string {
  const out: string[] = []
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0
    const d = i + 2 < bytes.length ? bytes[i + 2]! : 0
    const n = (a << 16) | (b << 8) | d
    out.push(
      ALPHABET[(n >> 18) & 63]!,
      ALPHABET[(n >> 12) & 63]!,
      i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63]! : '=',
      i + 2 < bytes.length ? ALPHABET[n & 63]! : '=',
    )
  }
  return out.join('')
}

// Which quarters of a cell a glyph fills, by bit (top-left 8, top-right 4,
// bottom-left 2, bottom-right 1): the 16 quadrant block elements.
const QUADRANTS = [
  0x20, 0x2597, 0x2596, 0x2584, 0x259d, 0x2590, 0x259e, 0x259f, 0x2598, 0x259a, 0x258c, 0x2599, 0x2580, 0x259c, 0x259b, 0x2588,
]

const distance = (a: number, b: number) =>
  (((a >> 16) & 255) - ((b >> 16) & 255)) ** 2 + (((a >> 8) & 255) - ((b >> 8) & 255)) ** 2 + ((a & 255) - (b & 255)) ** 2

// The glyph, foreground and background that show four pixels best with two
// colors; the background may be the terminal's own, the foreground may not.
//
// The terminal admits each new (foreground, background) pair of a Raster at
// a price, so two colors are always written in one order (the lower one in
// front, the glyph turned inside out to match): half as many pairs.
function quadrant(sub: readonly number[]): [number, number, number] {
  const seen = [...new Set(sub)]
  if (seen.length === 1 && seen[0] === NONE) {
    return [0x20, DEFAULT, DEFAULT]
  }
  let best = { mask: 0, fg: DEFAULT, bg: NONE }
  let bestError = Infinity
  for (const fg of seen) {
    if (fg === NONE) {
      continue
    }
    for (const bg of seen.length === 1 ? [NONE] : seen) {
      if (bg === fg) {
        continue
      }
      let mask = 0
      let error = 0
      sub.forEach((pixel, i) => {
        const bit = 8 >> i
        if (pixel === fg) {
          mask |= bit
        } else if (pixel === bg) {
          return
        } else if (pixel === NONE) {
          error += 1e6
        } else if (bg === NONE || distance(pixel, fg) <= distance(pixel, bg)) {
          mask |= bit
          error += distance(pixel, fg)
        } else {
          error += distance(pixel, bg)
        }
      })
      if (error < bestError) {
        bestError = error
        best = { mask, fg, bg }
      }
    }
  }
  if (best.mask === 15 || best.bg === NONE) {
    return [QUADRANTS[best.mask]!, best.fg, DEFAULT]
  }
  return best.fg < best.bg ? [QUADRANTS[best.mask]!, best.fg, best.bg] : [QUADRANTS[15 - best.mask]!, best.bg, best.fg]
}

function quadrantAt(c: Canvas, row: number, column: number): [number, number, number] {
  const top = row * 2 * c.w + column * 2
  const bottom = top + c.w
  return quadrant([c.px[top]!, c.px[top + 1]!, c.px[bottom]!, c.px[bottom + 1]!])
}

function encodeRect(c: Canvas, column0: number, row0: number, columns: number, rows: number): string {
  const view = new DataView(new ArrayBuffer(columns * rows * 12))
  let at = 0
  for (let row = row0; row < row0 + rows; row++) {
    for (let column = column0; column < column0 + columns; column++) {
      const [glyph, fg, bg] = quadrantAt(c, row, column)
      view.setUint32(at, glyph, true)
      view.setUint32(at + 4, fg, true)
      view.setUint32(at + 8, bg, true)
      at += 12
    }
  }
  return base64(new Uint8Array(view.buffer))
}

// The canvas as a Raster's `cells`: one cell per 2x2 block of pixels.
export function encode(c: Canvas): string {
  return encodeRect(c, 0, 0, Math.floor(c.w / 2), Math.floor(c.h / 2))
}

// One empty cell: a space on the terminal's own colors.
export const BLANK_CELL = base64(new Uint8Array(Uint32Array.of(0x20, DEFAULT, DEFAULT).buffer))

// `row` is the first cell row drawn; `band` numbers the bands from the top.
export type Span =
  | { band: number; row: number; left: number; width: number; height: number; cells: string }
  | { band: number; row: number; cells: undefined }

// The canvas cut into bands of `size` cell rows, each trimmed to what is
// drawn in it, so the text beneath shows around the drawing; a band with
// nothing drawn has no cells. One row per band hides the least text; a few
// rows per band are fewer Rasters, and so fewer color pairs to admit.
export function spans(c: Canvas, size = 1): Span[] {
  const columns = Math.floor(c.w / 2)
  const rows = Math.floor(c.h / 2)
  const isDrawn = (row: number, column: number) => {
    const top = row * 2 * c.w + column * 2
    const bottom = top + c.w
    return c.px[top] !== NONE || c.px[top + 1] !== NONE || c.px[bottom] !== NONE || c.px[bottom + 1] !== NONE
  }
  const out: Span[] = []
  for (let band = 0; band * size < rows; band++) {
    let left = columns
    let right = -1
    let top = rows
    let bottom = -1
    for (let row = band * size; row < Math.min(rows, (band + 1) * size); row++) {
      for (let column = 0; column < columns; column++) {
        if (isDrawn(row, column)) {
          left = Math.min(left, column)
          right = Math.max(right, column)
          top = Math.min(top, row)
          bottom = Math.max(bottom, row)
        }
      }
    }
    out.push(
      right < 0
        ? { band, row: band * size, cells: undefined }
        : { band, row: top, left, width: right - left + 1, height: bottom - top + 1, cells: encodeRect(c, left, top, right - left + 1, bottom - top + 1) },
    )
  }
  return out
}
