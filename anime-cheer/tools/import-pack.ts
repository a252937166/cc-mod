// Turns a sprite sheet (or one image per animation) into packs/<id>/pack.json,
// the frames the stage draws a girl from. Frames are found by the transparent
// gaps between them; each sheet row keeps a shared ground line.
//
//   bun tools/import-pack.ts <id> <image>... [--scale 0.8] [--anims '{"idle":[0,1]}'] [--list]
//     [--cells 00ff00 --key ff00ff] [--grid 128x128] [--facing left] [--float] [--colors 20] [--sample mode]
//
// --wide: twice as many pixels across as down, for the stage's quadrant
// cells (2x2 per cell, each pixel half a cell wide and half a cell tall).
// --sample mode: each shrunk pixel takes the color most of its block has,
// which keeps pixel art crisp; the default averages the block (smoother).
//
// --colors: the frames kept share at most this many colors (default 20): the
// terminal admits few new color pairs a second, so a small palette draws whole.
//
// --grid: every image is cut into cells of this size, read row by row; the
// ground is where the first image's figures stand (its lowest drawn row in a
// cell), so a figure drawn mid-cell stands on the stage; frames number on
// across the images given.
//
// --list prints every frame found (index, size, row) and imports nothing.
// --cells: the sheet boxes each frame in its own cell on a background of this
// color; --key: the color inside the cells that is see-through.

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

type Frame = { w: number; h: number; ax: number; ay: number; px: string }

const args = process.argv.slice(2)
const flag = (name: string) => {
  const at = args.indexOf(name)
  return at < 0 ? undefined : args.splice(at, 2)[1]
}
const isList = args.includes('--list') && args.splice(args.indexOf('--list'), 1).length > 0
const scale = Number(flag('--scale') ?? '1')
const cellColor = flag('--cells')
const facing = flag('--facing') === 'left' ? -1 : 1
const grid = flag('--grid')?.split('x').map(Number) as [number, number] | undefined
const isFloat = args.includes('--float') && args.splice(args.indexOf('--float'), 1).length > 0
const colorCount = Number(flag('--colors') ?? '20')
const isMode = flag('--sample') === 'mode'
const isWide = args.includes('--wide') && args.splice(args.indexOf('--wide'), 1).length > 0
const keyColors = (flag('--key') ?? '').split(',').filter(Boolean).map(hex => parseInt(hex, 16))
const anims = JSON.parse(flag('--anims') ?? '{}') as Record<string, number[]>
const [id, ...images] = args
if (id === undefined || images.length === 0) {
  console.error('usage: bun tools/import-pack.ts <id> <image>... [--scale 0.8] [--anims json] [--list]')
  process.exit(1)
}

function load(file: string) {
  const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], {
    encoding: 'utf8',
  })
    .trim()
    .split(',')
    .map(Number) as [number, number]
  const rgba = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 30 })
  return { w, h, count: Math.floor(rgba.length / (w * h * 4)), rgba }
}

function spans(n: number, has: (i: number) => boolean, gap: number): [number, number][] {
  const out: [number, number][] = []
  let start = -1
  let last = -1
  for (let i = 0; i < n; i++) {
    if (has(i)) {
      if (start < 0 || i - last > gap) {
        if (start >= 0) out.push([start, last + 1])
        start = i
      }
      last = i
    }
  }
  if (start >= 0) out.push([start, last + 1])
  return out
}

const frames: Frame[] = []
let gridGround: number | undefined

function add(rgba: Uint8Array, stride: number, x0: number, y0: number, w: number, h: number, ground: number, row: number | string) {
  const tw = Math.max(1, Math.round(w * scale * (isWide ? 2 : 1)))
  const th = Math.max(1, Math.round(h * scale))
  const px = new Int32Array(tw * th).fill(-1)
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      if (isMode) {
        const votes = new Map<number, number>()
        let n = 0
        for (let sy = Math.floor((ty * h) / th); sy < Math.max(Math.floor(((ty + 1) * h) / th), Math.floor((ty * h) / th) + 1); sy++) {
          for (let sx = Math.floor((tx * w) / tw); sx < Math.max(Math.floor(((tx + 1) * w) / tw), Math.floor((tx * w) / tw) + 1); sx++) {
            const o = ((y0 + sy) * stride + x0 + sx) * 4
            const c = rgba[o + 3]! >= 128 ? (rgba[o]! << 16) | (rgba[o + 1]! << 8) | rgba[o + 2]! : -1
            votes.set(c, (votes.get(c) ?? 0) + 1)
            n += 1
          }
        }
        const clear = votes.get(-1) ?? 0
        votes.delete(-1)
        const top = [...votes].sort((p, q) => q[1] - p[1])[0]
        if (top !== undefined && clear < n * 0.6) {
          px[ty * tw + tx] = top[0]
        }
        continue
      }
      let r = 0, g = 0, b = 0, a = 0, n = 0
      for (let sy = Math.floor((ty * h) / th); sy < Math.max(Math.floor(((ty + 1) * h) / th), Math.floor((ty * h) / th) + 1); sy++) {
        for (let sx = Math.floor((tx * w) / tw); sx < Math.max(Math.floor(((tx + 1) * w) / tw), Math.floor((tx * w) / tw) + 1); sx++) {
          const o = ((y0 + sy) * stride + x0 + sx) * 4
          const alpha = rgba[o + 3]! / 255
          r += rgba[o]! * alpha
          g += rgba[o + 1]! * alpha
          b += rgba[o + 2]! * alpha
          a += alpha
          n += 1
        }
      }
      if (a / n >= 0.5) {
        px[ty * tw + tx] = (Math.round(r / a) << 16) | (Math.round(g / a) << 8) | Math.round(b / a)
      }
    }
  }
  // Feet: the middle of what is drawn in the bottom rows.
  let sum = 0
  let count = 0
  for (let ty = Math.max(0, th - 4); ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      if (px[ty * tw + tx] !== -1) {
        sum += tx
        count += 1
      }
    }
  }
  const ax = count > 0 ? Math.round(sum / count) : Math.floor(tw / 2)
  const ay = Math.round((ground - y0) * scale)
  frames.push({ w: tw, h: th, ax, ay, px: Buffer.from(px.buffer).toString('base64') })
  console.log(`${frames.length - 1}\trow ${row}\t${tw}x${th}\tat ${x0},${y0}`)
}

// Clears the cell and key colors, so what is left is the drawing.
function keyOut(rgba: Uint8Array) {
  const cleared = new Set([...keyColors, ...(cellColor === undefined ? [] : [parseInt(cellColor, 16)])])
  for (let o = 0; o < rgba.length; o += 4) {
    if (cleared.has((rgba[o]! << 16) | (rgba[o + 1]! << 8) | rgba[o + 2]!)) {
      rgba[o + 3] = 0
    }
  }
}

// Frames boxed in cells: each run of non-background pixels is one cell.
function fromCells(rgba: Uint8Array, w: number, h: number) {
  const sep = parseInt(cellColor!, 16)
  const isCell = (i: number) => ((rgba[i * 4]! << 16) | (rgba[i * 4 + 1]! << 8) | rgba[i * 4 + 2]!) !== sep
  const seen = new Uint8Array(w * h)
  const cells: { x0: number; y0: number; x1: number; y1: number }[] = []
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || !isCell(start)) continue
    const stack = [start]
    seen[start] = 1
    let x0 = w, y0 = h, x1 = 0, y1 = 0
    while (stack.length > 0) {
      const i = stack.pop()!
      const x = i % w
      const y = Math.floor(i / w)
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1)
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && !seen[j] && isCell(j)) {
          seen[j] = 1
          stack.push(j)
        }
      }
    }
    cells.push({ x0, y0, x1, y1 })
  }
  cells.sort((a, b) => (Math.abs(a.y0 - b.y0) < 6 ? a.x0 - b.x0 : a.y0 - b.y0))
  keyOut(rgba)
  for (const cell of cells) {
    let x0 = cell.x1, y0 = cell.y1, x1 = cell.x0, y1 = cell.y0
    for (let y = cell.y0; y < cell.y1; y++) {
      for (let x = cell.x0; x < cell.x1; x++) {
        if (rgba[(y * w + x) * 4 + 3]! >= 128) {
          x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1)
        }
      }
    }
    if ((x1 - x0) * (y1 - y0) >= 40) {
      add(rgba, w, x0, y0, x1 - x0, y1 - y0, y1, `cell ${cell.x0},${cell.y0}`)
    }
  }
}

// k-means over every pixel of the frames, then each pixel to its nearest center.
function quantize(list: Frame[], k: number) {
  const views = list.map(frame => new Int32Array(Buffer.from(frame.px, 'base64').buffer.slice(0)))
  const counts = new Map<number, number>()
  for (const view of views) for (const c of view) if (c !== -1) counts.set(c, (counts.get(c) ?? 0) + 1)
  const colors = [...counts].sort((a, b) => b[1] - a[1])
  const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255] as const
  // Start from colors far apart: each next start is the one furthest from the chosen.
  const centers: [number, number, number][] = [[...rgb(colors[0]![0])]]
  while (centers.length < Math.min(k, colors.length)) {
    let best = colors[0]![0]
    let bestScore = -1
    for (const [c, n] of colors.slice(0, 4000)) {
      const [r, g, b] = rgb(c)
      const d = Math.min(...centers.map(([cr, cg, cb]) => (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2))
      const score = d * Math.sqrt(n)
      if (score > bestScore) {
        bestScore = score
        best = c
      }
    }
    centers.push([...rgb(best)])
  }
  const nearest = (c: number) => {
    const [r, g, b] = rgb(c)
    let at = 0
    let min = Infinity
    centers.forEach(([cr, cg, cb], i) => {
      const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2
      if (d < min) {
        min = d
        at = i
      }
    })
    return at
  }
  for (let round = 0; round < 12; round++) {
    const sums = centers.map(() => [0, 0, 0, 0])
    for (const [c, n] of colors) {
      const [r, g, b] = rgb(c)
      const s = sums[nearest(c)]!
      s[0] += r * n; s[1] += g * n; s[2] += b * n; s[3] += n
    }
    sums.forEach((s, i) => {
      if (s[3]! > 0) centers[i] = [Math.round(s[0]! / s[3]!), Math.round(s[1]! / s[3]!), Math.round(s[2]! / s[3]!)]
    })
  }
  const map = new Map(colors.map(([c]) => {
    const [r, g, b] = centers[nearest(c)]!
    return [c, (r << 16) | (g << 8) | b]
  }))
  list.forEach((frame, i) => {
    const view = views[i]!
    for (let j = 0; j < view.length; j++) if (view[j] !== -1) view[j] = map.get(view[j]!)!
    frame.px = Buffer.from(view.buffer).toString('base64')
  })
}

for (const file of images) {
  const image = load(file)
  for (let f = 0; f < image.count; f++) {
    const rgba = image.rgba.subarray(f * image.w * image.h * 4, (f + 1) * image.w * image.h * 4)
    if (cellColor !== undefined) {
      fromCells(rgba, image.w, image.h)
      continue
    }
    if (grid !== undefined) {
      keyOut(rgba)
      const first = frames.length
      const cells: { cx: number; cy: number; x0: number; y0: number; x1: number; y1: number }[] = []
      for (let cy = 0; cy + grid[1] <= image.h; cy += grid[1]) {
        for (let cx = 0; cx + grid[0] <= image.w; cx += grid[0]) {
          let x0 = cx + grid[0], y0 = cy + grid[1], x1 = cx, y1 = cy
          for (let y = cy; y < cy + grid[1]; y++) {
            for (let x = cx; x < cx + grid[0]; x++) {
              if (rgba[(y * image.w + x) * 4 + 3]! >= 128) {
                x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1)
              }
            }
          }
          if (x1 > x0) {
            cells.push({ cx, cy, x0, y0, x1, y1 })
          }
        }
      }
      gridGround ??= Math.max(...cells.map(cell => cell.y1 - cell.cy))
      for (const cell of cells) {
        add(rgba, image.w, cell.x0, cell.y0, cell.x1 - cell.x0, cell.y1 - cell.y0, cell.cy + gridGround, `cell ${cell.cx},${cell.cy}`)
      }
      console.error(`${file.split('/').pop()}: frames ${first}-${frames.length - 1}`)
      continue
    }
    keyOut(rgba)
    const solid = (x: number, y: number) => rgba[(y * image.w + x) * 4 + 3]! >= 128
    const rowHas = (y: number, x0 = 0, x1 = image.w) => {
      for (let x = x0; x < x1; x++) if (solid(x, y)) return true
      return false
    }
    spans(image.h, y => rowHas(y), 6).forEach(([y0, y1], row) => {
      const boxes = spans(image.w, x => {
        for (let y = y0; y < y1; y++) if (solid(x, y)) return true
        return false
      }, 6)
        .map(([x0, x1]) => {
          const ys = spans(y1 - y0, i => rowHas(y0 + i, x0, x1), 6)
          return { x0, x1, top: y0 + ys[0]![0], bottom: y0 + ys[ys.length - 1]![1] }
        })
        .filter(box => (box.x1 - box.x0) * (box.bottom - box.top) >= 40)
      const ground = Math.max(...boxes.map(box => box.bottom))
      for (const box of boxes) {
        add(rgba, image.w, box.x0, box.top, box.x1 - box.x0, box.bottom - box.top, ground, row)
      }
    })
  }
}

if (!isList) {
  const dir = join(import.meta.dir, '..', 'packs', id)
  mkdirSync(dir, { recursive: true })
  // Keep only the frames some animation uses, renumbered.
  const named = Object.keys(anims).length > 0
  const used = named ? [...new Set(Object.values(anims).flat())].sort((a, b) => a - b) : frames.map((_, i) => i)
  quantize(used.map(i => frames[i]!), colorCount)
  const index = new Map(used.map((old, i) => [old, i]))
  const kept = Object.fromEntries(Object.entries(anims).map(([name, list]) => [name, list.map(i => index.get(i)!)]))
  const out = { id, facing, float: isFloat, frames: used.map(i => frames[i]!), anims: named ? kept : { idle: used } }
  writeFileSync(join(dir, 'pack.json'), JSON.stringify(out) + '\n')
  console.log(`wrote ${out.frames.length} of ${frames.length} frames to ${dir}/pack.json`)
}
