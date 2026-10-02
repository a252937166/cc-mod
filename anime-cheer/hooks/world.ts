// The stage as a little world: who is on it, where each girl is heading and
// what she is doing. Pure: the hooks module feeds it the time and draws it.

import {
  animLength,
  boxOf,
  canDraw,
  Canvas,
  drawCup,
  drawGirl,
  drawHeart,
  drawPack,
  heightOf,
  packOf,
  drawNote,
  drawZ,
  SPRITE_H,
  type Pose,
} from './art'
import { GIRLS } from './cast'

export type Mode = 'idle' | 'work' | 'tea'

export type Act = 'enter' | 'walk' | 'stand' | 'dance' | 'cheer' | 'serve' | 'massage' | 'sleep' | 'attack' | 'leave'

export type Actor = {
  id: string
  x: number
  y: number
  tx: number
  ty: number
  act: Act
  until: number
  facing: 1 | -1
  seed: number
  talkUntil: number
  hasArrived: boolean
  actedAt: number
  // Until then she paces: every arrival sends her off to another spot.
  paceUntil: number
}

export type World = {
  w: number
  h: number
  actors: Actor[]
  mode: Mode
  frame: number
  hasCup: boolean
  restSince: number
  isRoaming: boolean
}

// Pixels are half a cell wide and half a cell tall: across counts double.
const STEP = 2.2
const STEP_Y = 0.6
const SLEEP_AFTER_MS = 10 * 60_000

type Range = readonly [number, number]

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo)
const tall = (id: string) => heightOf(GIRLS.get(id))
const isPacked = (id: string) => packOf(GIRLS.get(id)) !== undefined
const widthOf = ([from, to]: Range) => to - from
// How far from her middle a girl keeps the stage edge and the others, and how
// far past the edge she is out of sight.
const reachOf = (id: string) => boxOf(GIRLS.get(id)!).reach + 2
const strideOf = (id: string) => boxOf(GIRLS.get(id)!).stride + 2

export function createWorld(w: number, h: number, now: number): World {
  return { w, h, actors: [], mode: 'idle', frame: 0, hasCup: false, restSince: now, isRoaming: false }
}

// The room left of everyone else and right of everyone else on the roaming
// stage, for this girl. `byTarget` counts only where the others are heading:
// for someone who walks in behind a girl still on her way.
function room(world: World, id: string, byTarget = false): { left: Range; right: Range } {
  const lo = reachOf(id)
  const hi = Math.max(lo, world.w - lo)
  let leftEnd = hi
  let rightStart = lo
  for (const other of onStage(world)) {
    if (other.id === id) {
      continue
    }
    const gap = lo + reachOf(other.id) + 2
    leftEnd = Math.min(leftEnd, (byTarget ? other.tx : Math.min(other.x, other.tx)) - gap)
    rightStart = Math.max(rightStart, (byTarget ? other.tx : Math.max(other.x, other.tx)) + gap)
  }
  return { left: [lo, leftEnd], right: [rightStart, hi] }
}

// Somewhere for a girl to go: on the roaming stage she keeps to her side of
// the others with room to spare, so their drawings never cover each other.
function spot(world: World, height = SPRITE_H, id?: string): { x: number; y: number } {
  const top = Math.min(height - 1, world.h - 1)
  const y = rand(top, world.h - 1)
  const me = id === undefined ? undefined : world.actors.find(actor => actor.id === id)
  if (me === undefined || id === undefined) {
    return { x: rand(6, Math.max(7, world.w - 7)), y }
  }
  const lo = reachOf(id)
  const hi = Math.max(lo, world.w - lo)
  const others = onStage(world).filter(actor => actor.id !== id)
  if (!world.isRoaming || others.length === 0) {
    return { x: rand(lo, hi), y }
  }
  const { left, right } = room(world, id)
  // Two girls on one spot: the id says who is "left", so they part.
  const isLeft = others.every(other => me.x < other.x || (me.x === other.x && me.id < other.id))
  const mine = isLeft ? left : right
  if (widthOf(mine) > 0) {
    return { x: rand(mine[0], mine[1]), y }
  }
  // No room on her side: standing in someone's drawing, she crosses over if
  // there is room there. On a stage too narrow for the gap, each keeps to
  // her own edge, as far apart as it allows.
  const isCrowded = others.some(other => Math.abs(other.x - me.x) < lo + reachOf(other.id))
  const across = isLeft ? right : left
  if (isCrowded && widthOf(across) > 0) {
    return { x: rand(across[0], across[1]), y }
  }
  return { x: isLeft ? lo : hi, y }
}

function headTo(actor: Actor, x: number, y: number, act: Act) {
  actor.tx = x
  actor.ty = y
  actor.act = act
  actor.hasArrived = false
}

export function resize(world: World, w: number, h: number) {
  const was = world.w
  world.w = w
  world.h = h
  for (const actor of world.actors) {
    const lo = reachOf(actor.id)
    const hi = Math.max(lo, w - lo)
    // A place on the stage keeps its share of the width; a place past the
    // right edge (walking in or out) moves with the edge.
    const placed = (x: number) => (x < 0 ? x : x > was ? x - was + w : Math.min(Math.max((x / was) * w, lo), hi))
    actor.x = placed(actor.x)
    actor.tx = placed(actor.tx)
    const top = Math.min(tall(actor.id) - 1, h - 1)
    actor.y = Math.min(Math.max(actor.y, top), h - 1)
    actor.ty = Math.min(Math.max(actor.ty, top), h - 1)
  }
}

export function onStage(world: World): Actor[] {
  return world.actors.filter(actor => actor.act !== 'leave')
}

// A girl walks in from a side; `isAtOnce` puts her on the stage already.
export function enter(world: World, id: string, now: number, isAtOnce = false): Actor | undefined {
  if (!canDraw(GIRLS.get(id)) || onStage(world).some(actor => actor.id === id)) {
    return undefined
  }
  world.actors = world.actors.filter(actor => actor.id !== id)
  const lo = reachOf(id)
  const hi = Math.max(lo, world.w - lo)
  const top = Math.min(tall(id) - 1, world.h - 1)
  const y = rand(top, world.h - 1)
  const others = onStage(world)
  let fromLeft = Math.random() < 0.5
  let x = rand(lo, hi)
  if (isAtOnce) {
    // The opening cast, often before the stage has its size: one each side.
    x = others.length % 2 === 0 ? rand(world.w * 0.15, world.w * 0.4) : rand(world.w * 0.6, world.w * 0.85)
  } else if (world.isRoaming && others.length > 0) {
    // She walks in on the roomier side and stops short of the others.
    let sides = room(world, id)
    if (widthOf(sides.left) <= 0 && widthOf(sides.right) <= 0) {
      sides = room(world, id, true)
    }
    if (widthOf(sides.left) > 0 || widthOf(sides.right) > 0) {
      fromLeft = widthOf(sides.left) >= widthOf(sides.right)
      const side = fromLeft ? sides.left : sides.right
      x = rand(side[0], side[1])
    } else {
      // Too narrow for the gap: the edge farthest from where the others stand.
      fromLeft = others.reduce((sum, other) => sum + other.tx, 0) / others.length > world.w / 2
      x = fromLeft ? lo : hi
    }
  }
  // Out of sight at first, behind anyone already walking in on that side.
  const stride = strideOf(id)
  const queue = world.actors.filter(actor => (fromLeft ? actor.x < 0 : actor.x > world.w)).length
  const start = fromLeft ? -stride * (1 + queue * 2) : world.w + stride * (1 + queue * 2)
  const actor: Actor = {
    id,
    x: isAtOnce ? x : start,
    y,
    tx: x,
    ty: y,
    act: isAtOnce ? 'stand' : 'enter',
    until: now + rand(1000, 4000),
    facing: fromLeft ? 1 : -1,
    seed: Math.floor(Math.random() * 100),
    talkUntil: 0,
    hasArrived: isAtOnce,
    actedAt: 0,
    paceUntil: 0,
  }
  world.actors.push(actor)
  return actor
}

export function leave(world: World, id: string) {
  const actor = world.actors.find(one => one.id === id && one.act !== 'leave')
  if (actor === undefined) {
    return
  }
  // Out by the nearer side, unless someone stands in the way there.
  const others = onStage(world).filter(one => one.id !== id)
  const isBlockedLeft = world.isRoaming && others.some(other => other.x < actor.x)
  const isBlockedRight = world.isRoaming && others.some(other => other.x >= actor.x)
  const isNearLeft = actor.x < world.w / 2
  const toLeft = isBlockedLeft === isBlockedRight ? isNearLeft : isBlockedRight
  headTo(actor, toLeft ? -strideOf(id) : world.w + strideOf(id), actor.y, 'leave')
}

// Who brings the tea and who rubs your shoulders, by preference.
const SERVERS = ['saki', 'kaa', 'neko', 'chizuru']

export function setMode(world: World, mode: Mode, now: number): { server?: Actor; masseuse?: Actor } {
  world.mode = mode
  // A girl still walking in keeps walking: she takes up the mode on arrival.
  const cast = onStage(world).filter(actor => actor.act !== 'enter')
  if (mode !== 'idle') {
    world.restSince = now
  }
  if (mode === 'work') {
    world.hasCup = false
    for (const actor of cast) {
      actor.act = 'dance'
      actor.hasArrived = true
      actor.until = now + rand(3000, 8000)
    }
    return {}
  }
  if (mode === 'idle') {
    for (const actor of cast) {
      if (actor.act === 'serve' || actor.act === 'massage' || actor.act === 'dance' || actor.act === 'cheer') {
        actor.act = 'stand'
        actor.until = now + rand(500, 3000)
      }
    }
    return {}
  }
  const server = cast.find(actor => SERVERS.includes(actor.id)) ?? cast[0]
  const others = cast.filter(actor => actor !== server)
  const masseuse =
    others.find(actor => actor.id !== 'yuki' && !isPacked(actor.id)) ??
    others.find(actor => !isPacked(actor.id)) ??
    others[0]
  if (server !== undefined) {
    server.act = 'serve'
    server.hasArrived = true
    server.actedAt = world.frame
    server.until = now + 800
  }
  if (masseuse !== undefined) {
    masseuse.act = 'massage'
    masseuse.hasArrived = true
    masseuse.actedAt = world.frame
  }
  for (const actor of cast) {
    if (actor !== server && actor !== masseuse) {
      actor.act = 'cheer'
      actor.hasArrived = true
      actor.actedAt = world.frame
      actor.until = now + rand(2500, 4500)
    }
  }
  return { server, masseuse }
}

function walk(actor: Actor): boolean {
  const pack = packOf(GIRLS.get(actor.id))
  const step = pack?.isFloating ? STEP * 0.6 : pack !== undefined ? STEP * 1.1 : STEP
  const dx = actor.tx - actor.x
  const dy = actor.ty - actor.y
  if (Math.abs(dx) < step && Math.abs(dy) < STEP_Y) {
    actor.x = actor.tx
    actor.y = actor.ty
    return true
  }
  if (Math.abs(dx) >= step) {
    actor.x += Math.sign(dx) * step
    actor.facing = dx > 0 ? 1 : -1
  }
  if (Math.abs(dy) >= STEP_Y) {
    actor.y += Math.sign(dy) * STEP_Y
  }
  return false
}

function plan(world: World, actor: Actor, now: number) {
  if (now < actor.paceUntil) {
    headTo(actor, spot(world, tall(actor.id), actor.id).x, actor.y, 'walk')
    return
  }
  if (world.mode === 'work') {
    if (Math.random() < 0.3) {
      actor.act = 'dance'
      actor.until = now + rand(3000, 6000)
    } else {
      const to = spot(world, tall(actor.id), actor.id)
      headTo(actor, to.x, to.y, 'walk')
    }
    return
  }
  if (world.mode === 'idle' && now - world.restSince > SLEEP_AFTER_MS && Math.random() < 0.4) {
    actor.act = 'sleep'
    actor.until = now + rand(30_000, 90_000)
    return
  }
  if (Math.random() < 0.65) {
    const to = spot(world, tall(actor.id), actor.id)
    headTo(actor, to.x, to.y, 'walk')
  } else {
    actor.act = 'stand'
    actor.until = now + rand(2000, 6000)
  }
}

export function tick(world: World, now: number) {
  world.frame += 1
  for (const actor of [...world.actors]) {
    const isTalking = now < actor.talkUntil
    const moves =
      actor.act === 'enter' ||
      actor.act === 'walk' ||
      actor.act === 'leave' ||
      ((actor.act === 'serve' || actor.act === 'massage') && !actor.hasArrived)
    if (moves) {
      if (isTalking && actor.act === 'walk') {
        continue
      }
      if (walk(actor)) {
        actor.hasArrived = true
        if (actor.act === 'leave') {
          world.actors = world.actors.filter(one => one !== actor)
        } else if (actor.act === 'serve') {
          actor.until = now + 1500
        } else if (actor.act === 'enter' || actor.act === 'walk') {
          actor.act = 'stand'
          actor.until = now < actor.paceUntil ? now : now + rand(1000, 3000)
        }
      }
      continue
    }
    if (actor.act === 'serve' && !world.hasCup && now >= actor.until) {
      world.hasCup = true
    }
    if (isTalking || now < actor.until) {
      continue
    }
    if (actor.act === 'serve' || actor.act === 'massage') {
      continue
    }
    if (actor.act === 'sleep' && world.mode === 'idle') {
      actor.until = now + rand(20_000, 60_000)
      continue
    }
    plan(world, actor, now)
  }
}

// A girl stops what she is doing for a move of her own (an attack, a cheer).
export function perform(world: World, id: string, act: Act, now: number, ms: number) {
  const actor = onStage(world).find(one => one.id === id)
  if (actor !== undefined) {
    actor.act = act
    actor.hasArrived = true
    actor.actedAt = world.frame
    actor.until = now + ms
  }
}

// A girl walks up and down (thinking something over) for a while.
export function pace(world: World, id: string, now: number, ms: number) {
  const actor = onStage(world).find(one => one.id === id)
  if (actor !== undefined && actor.act !== 'enter') {
    actor.paceUntil = now + ms
    headTo(actor, spot(world, tall(id), id).x, actor.y, 'walk')
  }
}

export function settle(world: World, id: string) {
  const actor = world.actors.find(one => one.id === id)
  if (actor !== undefined) {
    actor.paceUntil = 0
  }
}

export function moveLength(id: string, anim: string): number {
  const pack = packOf(GIRLS.get(id))
  return pack === undefined ? 8 : animLength(pack, anim)
}

export function wake(world: World, now: number) {
  world.restSince = now
  for (const actor of world.actors) {
    if (actor.act === 'sleep') {
      actor.act = 'stand'
      actor.until = now + rand(500, 2000)
    }
  }
}

const DANCE_ARMS = ['up', 'out', 'up', 'wave', 'up', 'out', 'up', 'down'] as const
const DANCE_LEGS = ['stand', 'stand', 'liftL', 'stand', 'stand', 'stand', 'liftR', 'stand'] as const
const DANCE_BOB = [0, 1, 2, 1, 0, 1, 2, 1]
const CHEER_BOB = [0, 2, 3, 2, 0, 0]

// Which animation of her pack a girl plays now, and which frame of it.
function animOf(world: World, actor: Actor, now: number): { anim: string; step: number; faceLeft: boolean } {
  const f = world.frame + actor.seed
  const since = world.frame - actor.actedAt
  const moving = !actor.hasArrived && ['enter', 'walk', 'leave', 'serve', 'massage'].includes(actor.act) && now >= actor.talkUntil
  if (moving) {
    return { anim: 'walk', step: f, faceLeft: actor.facing < 0 }
  }
  switch (actor.act) {
    case 'dance':
      return { anim: 'dance', step: f, faceLeft: Math.floor(f / moveLength(actor.id, 'dance')) % 2 === 1 }
    case 'cheer':
      return { anim: 'cheer', step: Math.min(since, moveLength(actor.id, 'cheer') - 1), faceLeft: actor.facing < 0 }
    case 'attack':
      return { anim: 'attack', step: Math.min(since, moveLength(actor.id, 'attack') - 1), faceLeft: actor.facing < 0 }
    case 'sleep':
      // Dozing on her feet: the sheets' lying-down frames are knock-outs.
      return { anim: 'idle', step: 0, faceLeft: actor.facing < 0 }
    case 'serve':
      return { anim: 'idle', step: f, faceLeft: !world.isRoaming }
    default:
      return { anim: 'idle', step: f, faceLeft: actor.facing < 0 }
  }
}

function poseOf(world: World, actor: Actor, now: number): Pose {
  const f = world.frame + actor.seed
  const isTalking = now < actor.talkUntil
  const pose: Pose = {
    arms: 'down',
    legs: 'stand',
    eyesShut: f % 33 === 0,
    mouthOpen: isTalking && f % 2 === 0,
    bob: 0,
    flip: actor.facing < 0,
  }
  const moving =
    !actor.hasArrived && ['enter', 'walk', 'leave', 'serve', 'massage'].includes(actor.act) && !isTalking
  if (moving) {
    pose.legs = (['stand', 'liftL', 'stand', 'liftR'] as const)[f % 4]!
    pose.bob = f % 2
    pose.arms = actor.act === 'serve' ? 'cup' : 'down'
    return pose
  }
  switch (actor.act) {
    case 'dance': {
      const d = f % 8
      pose.arms = DANCE_ARMS[d]!
      pose.legs = DANCE_LEGS[d]!
      pose.bob = DANCE_BOB[d]!
      pose.flip = Math.floor(f / 8) % 2 === 1
      pose.eyesShut = d === 2 || d === 6
      break
    }
    case 'cheer': {
      const d = f % 6
      pose.arms = d < 4 ? 'up' : 'down'
      pose.bob = CHEER_BOB[d]!
      break
    }
    case 'serve':
      pose.arms = world.hasCup ? 'wave' : 'cup'
      pose.flip = !world.isRoaming
      break
    case 'massage':
      pose.arms = 'hidden'
      pose.bob = f % 4 < 2 ? 0 : 1
      pose.eyesShut = f % 8 < 3
      break
    case 'sleep':
      pose.eyesShut = true
      pose.bob = -1
      break
    default:
      if (isTalking) {
        pose.arms = f % 16 < 8 ? 'wave' : 'down'
      }
  }
  return pose
}

// Floating girls drift up and down; a girl drawn from one picture hops as she walks.
function bobOf(world: World, actor: Actor, pack: { isFloating: boolean; anims: Readonly<Record<string, readonly number[]>> }): number {
  const f = world.frame + actor.seed
  if (pack.isFloating) {
    return Math.round(Math.sin(f / 4))
  }
  const isWalking = !actor.hasArrived && ['enter', 'walk', 'leave'].includes(actor.act)
  return isWalking && (pack.anims.walk ?? []).length <= 1 ? -(f % 2) : 0
}

// The little extras by a girl: her tea, hearts for the shoulder rub, Zs.
function drawExtras(c: Canvas, world: World, actor: Actor, x: number, feet: number, head: number) {
  const f = world.frame + actor.seed
  if (actor.act === 'serve' && world.hasCup) {
    drawCup(c, x + 4, feet - 1, f)
  }
  if (actor.act === 'massage' && f % 12 < 8) {
    drawHeart(c, x + 2, head - 1 - Math.floor((f % 12) / 3))
  }
  if (actor.act === 'sleep') {
    drawZ(c, x + 3, head - 2 - Math.floor((f % 9) / 3))
  }
}

export function draw(world: World, now: number): Canvas {
  const c = new Canvas(world.w, world.h)
  for (const actor of [...world.actors].sort((a, b) => a.y - b.y)) {
    const girl = GIRLS.get(actor.id)
    const pack = packOf(girl)
    if (pack !== undefined) {
      const { anim, step, faceLeft } = animOf(world, actor, now)
      const bob = bobOf(world, actor, pack)
      drawPack(c, pack, anim, step, actor.x, actor.y + bob, faceLeft)
    } else if (girl !== undefined) {
      drawGirl(c, girl, actor.x, actor.y, poseOf(world, actor, now))
    }
    drawExtras(c, world, actor, actor.x, actor.y, actor.y - tall(actor.id))
    if (actor.act === 'dance' && (world.frame + actor.seed) % 24 < 12) {
      const rise = (world.frame + actor.seed) % 12
      drawNote(c, actor.x + Math.round(tall(actor.id) / 3), actor.y - tall(actor.id) - rise / 2, world.frame + actor.seed)
    }
  }
  return c
}

export type Placed = { c: Canvas; left: number; row: number }

// One girl in her own box, for the roaming stage: where the box sits, in
// columns and cell rows of the stage, and what is in it.
export function drawActor(world: World, actor: Actor, now: number): Placed | undefined {
  const girl = GIRLS.get(actor.id)
  if (girl === undefined) {
    return undefined
  }
  const box = boxOf(girl)
  const topPx = Math.round(actor.y) - (box.h - 1)
  const row = Math.floor(topPx / 2)
  const shift = topPx - row * 2
  const leftPx = Math.round(actor.x) - box.cx
  const column = Math.floor(leftPx / 2)
  const nudge = leftPx - column * 2
  const c = new Canvas(box.w + 2 + (box.w % 2), box.h + 2)
  const feet = box.h - 1 + shift
  const cx = box.cx + nudge
  const pack = packOf(girl)
  if (pack !== undefined) {
    const { anim, step, faceLeft } = animOf(world, actor, now)
    const bob = bobOf(world, actor, pack)
    drawPack(c, pack, anim, step, cx, feet + bob, faceLeft)
  } else {
    drawGirl(c, girl, cx, feet, poseOf(world, actor, now))
  }
  drawExtras(c, world, actor, cx, feet, Math.max(3, feet - tall(actor.id) + 1))
  return { c, left: column, row }
}
