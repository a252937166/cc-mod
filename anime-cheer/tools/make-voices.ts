// Records every catalog line in its girl's voice, into voices/<girl>/, and
// drops recordings no line uses any more. Run after editing the lines:
//
//   bun tools/make-voices.ts [--engine edge|voicevox] [--vox-run <path to VOICEVOX engine run>]
//
// voicevox (anime voices) is used when its engine answers at 127.0.0.1:50021,
// else edge-tts. The choice and the speaker ids land in voices/engine.json.

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { allLines, CAST, clipPath, spoken, voiceFor, type Girl, type Line } from '../hooks/cast'

const root = join(import.meta.dir, '..')
const args = process.argv.slice(2)
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const VOX = 'http://127.0.0.1:50021'

function findEdgeTts(): string {
  try {
    return execFileSync('/bin/sh', ['-c', 'command -v edge-tts || (. ~/.zshrc; command -v edge-tts) 2>/dev/null'], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}
const tts = findEdgeTts()
const previous = existsSync(join(root, 'voices', 'engine.json'))
  ? (JSON.parse(readFileSync(join(root, 'voices', 'engine.json'), 'utf8')) as { voicevox?: { run?: string } })
  : {}
const voxRun = flag('--vox-run') ?? previous.voicevox?.run

async function voxSpeakers(): Promise<Record<string, number> | undefined> {
  try {
    const list = (await (await fetch(`${VOX}/speakers`)).json()) as { name: string; styles: { name: string; id: number }[] }[]
    return Object.fromEntries(list.flatMap(speaker => speaker.styles.map(style => [`${speaker.name}|${style.name}`, style.id])))
  } catch {
    return undefined
  }
}

const speakers = await voxSpeakers()
const engine = flag('--engine') ?? (speakers !== undefined ? 'voicevox' : 'edge')
if (engine === 'voicevox' && speakers === undefined) {
  console.error('VOICEVOX engine is not answering at', VOX)
  process.exit(1)
}
if (engine === 'edge' && tts === '') {
  console.error('edge-tts not found: pip install edge-tts, or start VOICEVOX for anime voices')
  process.exit(1)
}

type Job = { girl: Girl; line: Line; path: string; isVox: boolean }

const jobs: Job[] = CAST.flatMap(girl =>
  allLines(girl).map(line => {
    const isVox = engine === 'voicevox' && girl.vox !== undefined
    return { girl, line, path: join(root, clipPath(girl, line, isVox ? 'voicevox' : 'edge')), isVox }
  }),
)
for (const job of jobs.filter(one => one.isVox)) {
  const key = `${job.girl.vox!.speaker}|${job.girl.vox!.style}`
  if (speakers![key] === undefined) {
    console.error(`unknown VOICEVOX voice ${key} for ${job.girl.id}; known: ${Object.keys(speakers!).join(', ')}`)
    process.exit(1)
  }
}

// Recordings either engine may still play stay; the rest go.
const wanted = new Set(
  CAST.flatMap(girl =>
    allLines(girl).flatMap(line => [
      join(root, clipPath(girl, line, 'edge')),
      ...(girl.vox !== undefined ? [join(root, clipPath(girl, line, 'voicevox'))] : []),
    ]),
  ),
)

function edge(job: Job): Promise<void> {
  const text = spoken(job.line)
  const voice = voiceFor(job.girl, text)
  return new Promise((resolve, reject) => {
    const child = spawn(tts, ['--voice', voice.name, `--rate=${voice.rate}`, `--pitch=${voice.pitch}`, '--text', text, '--write-media', job.path])
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`${job.girl.id}: ${text}`))))
  })
}

async function voicevox(job: Job): Promise<void> {
  const id = speakers![`${job.girl.vox!.speaker}|${job.girl.vox!.style}`]!
  const query = await fetch(`${VOX}/audio_query?speaker=${id}&text=${encodeURIComponent(spoken(job.line))}`, { method: 'POST' })
  const wav = await fetch(`${VOX}/synthesis?speaker=${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: await query.text(),
  })
  if (!wav.ok) {
    throw new Error(`${job.girl.id}: ${spoken(job.line)}`)
  }
  writeFileSync(job.path, Buffer.from(await wav.arrayBuffer()))
}

const missing = jobs.filter(job => !existsSync(job.path))
let next = 0
let failed = 0
await Promise.all(
  Array.from({ length: engine === 'voicevox' ? 2 : 8 }, async () => {
    while (next < missing.length) {
      const job = missing[next++]!
      mkdirSync(dirname(job.path), { recursive: true })
      for (let attempt = 0; ; attempt++) {
        try {
          await (job.isVox ? voicevox(job) : edge(job))
          break
        } catch (error) {
          if (attempt === 2) {
            failed += 1
            console.error(String(error))
            break
          }
        }
      }
    }
  }),
)

for (const girl of CAST) {
  const dir = join(root, 'voices', girl.id)
  for (const file of existsSync(dir) ? readdirSync(dir) : []) {
    if (!wanted.has(join(dir, file))) {
      rmSync(join(dir, file))
    }
  }
}
writeFileSync(
  join(root, 'voices', 'engine.json'),
  JSON.stringify({ tts, engine, voicevox: { run: voxRun, url: VOX, speakers: speakers ?? {} } }, null, 2) + '\n',
)
console.log(`${engine}: ${jobs.length} lines, ${missing.length - failed} recorded now, ${failed} failed`)
