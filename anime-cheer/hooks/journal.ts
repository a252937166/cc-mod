// The task journal: one entry per finished turn, kept per project, so the
// troupe can recap what was done before. Pure: the hooks module stores it.

export type Task = {
  at: number
  prompt: string
  answer: string
  seconds: number
  tools: number
  tokens: number
  files: string[]
  isOk: boolean
}

const oneLine = (text: string, max: number) => {
  const flat = text.replace(/```[\s\S]*?```/g, ' ').replace(/[#*`>_]/g, '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

export function makeTask(at: number, prompt: string, answer: string, seconds: number, tools: number, tokens: number, files: readonly string[], isOk: boolean): Task {
  return { at, prompt: oneLine(prompt, 80), answer: oneLine(answer, 140), seconds, tools, tokens, files: [...new Set(files)].slice(0, 8), isOk }
}

// Slash commands and empty prompts are not tasks worth recalling.
export const isTask = (prompt: string, seconds: number, tools: number) => prompt.trim() !== '' && !prompt.trim().startsWith('/') && (tools > 0 || seconds >= 5)

export function addTask(tasks: readonly Task[], task: Task, max = 60): Task[] {
  return [...tasks, task].slice(-max)
}

function when(at: number, now: number): string {
  const minutes = Math.round((now - at) / 60_000)
  if (minutes < 1) {
    return '刚刚'
  }
  if (minutes < 60) {
    return `${minutes} 分钟前`
  }
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours} 小时前` : `${Math.round(hours / 24)} 天前`
}

const count = (n: number) => (n >= 1e4 ? `${(n / 1e4).toFixed(n >= 1e5 ? 0 : 1)}万` : String(Math.round(n)))

// The text `/waifu recap` prints: the latest tasks, newest first.
export function recapReport(name: string, tasks: readonly Task[], now: number, limit = 8): string {
  if (tasks.length === 0) {
    return `🗂 ${name}：这个项目里还没有记下过任务。`
  }
  const rows = [...tasks].reverse().slice(0, limit).map(task => {
    const files = task.files.length === 0 ? '' : ` · 改了 ${task.files.slice(0, 3).join('、')}${task.files.length > 3 ? ` 等 ${task.files.length} 个文件` : ''}`
    return [
      `- ${when(task.at, now)}${task.isOk ? '' : '（中断）'}：${task.prompt}`,
      `  ${task.seconds}s · ${task.tools} 次工具 · ${count(task.tokens)} token${files}`,
      ...(task.answer === '' ? [] : [`  结果：${task.answer}`]),
    ].join('\n')
  })
  return [`🗂 ${name}的任务回顾（最近 ${rows.length} 条，共 ${tasks.length} 条）`, ...rows].join('\n')
}

// What the bubble says when a new session opens: the last thing done here,
// short enough for a bubble.
export function lastTaskLine(tasks: readonly Task[], now: number): string | undefined {
  const last = tasks[tasks.length - 1]
  return last === undefined ? undefined : `${when(last.at, now)}：${oneLine(last.prompt, 14)}`
}

// A short list of the tasks for the chat model to sum up.
export function recapPrompt(tasks: readonly Task[], now: number): string {
  const rows = [...tasks].slice(-12).map(task => `- ${when(task.at, now)}：${task.prompt}${task.answer === '' ? '' : ` → ${task.answer}`}`)
  return `下面是这个项目里最近做过的任务，请用中文总结成 3 条以内的要点，每条不超过 30 个字，只输出要点：\n${rows.join('\n')}`
}

// A stable key for a project path (FNV-1a).
export function projectKey(path: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < path.length; i++) {
    hash ^= path.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `tasks:${(hash >>> 0).toString(16).padStart(8, '0')}`
}
