// A quick code review of the working tree's changes by the chat model. Pure:
// builds the request, trims the diff, reads the answer, formats the report.

export type ReviewFinding = { file: string; line: number; severity: 'high' | 'mid' | 'low'; issue: string; fix: string }
export type Review = { verdict: 'ok' | 'warn' | 'bad'; summary: string; findings: ReviewFinding[] }

export const REVIEW_SYSTEM =
  '你是一名严格但务实的代码审查者。只报告会导致结果错误、崩溃、数据丢失或安全问题的真实缺陷，' +
  '每条都要能指出具体的文件和行。不谈命名、格式和个人偏好。拿不准的不要报。只输出 JSON，不要解释。'

// Whole files' hunks until the budget is used; the rest are named as left out.
export function trimDiff(diff: string, maxChars = 60_000): { text: string; files: number; omitted: string[] } {
  const parts = diff.split(/^(?=diff --git )/m).filter(part => part.trim() !== '')
  const kept: string[] = []
  const omitted: string[] = []
  let size = 0
  for (const part of parts) {
    const name = /^diff --git a\/(.+?) b\//.exec(part)?.[1] ?? '?'
    if (/^Binary files /m.test(part) || /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/.test(name)) {
      omitted.push(name)
    } else if (size + part.length <= maxChars) {
      kept.push(part)
      size += part.length
    } else {
      omitted.push(name)
    }
  }
  return { text: kept.join(''), files: kept.length, omitted }
}

export function reviewPrompt(diff: string, omitted: readonly string[]): string {
  return [
    '审查下面这份 git diff（工作区相对 HEAD 的改动）。',
    '输出 JSON：{"verdict":"ok|warn|bad","summary":"一句话结论，不超过30字","findings":[{"file":"路径","line":行号,"severity":"high|mid|low","issue":"问题，不超过60字","fix":"怎么改，不超过60字"}]}',
    '最多 6 条 findings，按严重程度从高到低。没有问题时 findings 为空数组、verdict 为 ok。',
    'verdict：有 high 用 bad，只有 mid 或 low 用 warn。行号用改动后文件里的行号。',
    ...(omitted.length > 0 ? [`以下文件没有包含在内（太大或是锁文件）：${omitted.join('、')}`] : []),
    '',
    diff,
  ].join('\n')
}

const SEVERITIES = ['high', 'mid', 'low'] as const

// The model's answer as a Review; undefined when it is not the JSON asked for.
export function parseReview(text: string): Review | undefined {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) {
    return undefined
  }
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as { verdict?: unknown; summary?: unknown; findings?: unknown }
    const findings = (Array.isArray(raw.findings) ? raw.findings : [])
      .filter((one): one is Record<string, unknown> => typeof one === 'object' && one !== null)
      .map(one => ({
        file: String(one.file ?? ''),
        line: Number(one.line) || 0,
        severity: SEVERITIES.find(level => level === one.severity) ?? 'low',
        issue: String(one.issue ?? ''),
        fix: String(one.fix ?? ''),
      }))
      .filter(one => one.issue !== '')
      .slice(0, 6)
    const worst = findings.some(one => one.severity === 'high') ? 'bad' : findings.length > 0 ? 'warn' : 'ok'
    const verdict = raw.verdict === 'ok' || raw.verdict === 'warn' || raw.verdict === 'bad' ? raw.verdict : worst
    return {
      verdict: findings.length === 0 ? 'ok' : verdict === 'ok' ? worst : verdict,
      summary: typeof raw.summary === 'string' && raw.summary.trim() !== '' ? raw.summary.trim().slice(0, 60) : findings.length === 0 ? '没发现问题' : `发现 ${findings.length} 处问题`,
      findings,
    }
  } catch {
    return undefined
  }
}

const LEVEL = { high: '高', mid: '中', low: '低' } as const

// The text `/waifu review` prints.
export function reviewReport(name: string, review: Review, files: number, omitted: readonly string[], model: string): string {
  return [
    `🔍 ${name}的代码 review（${files} 个文件，${model}）`,
    `结论：${review.summary}`,
    ...review.findings.flatMap((one, i) => [
      `${i + 1}. [${LEVEL[one.severity]}] ${one.file}${one.line > 0 ? `:${one.line}` : ''}  ${one.issue}`,
      ...(one.fix === '' ? [] : [`   建议：${one.fix}`]),
    ]),
    ...(omitted.length > 0 ? [`没看的文件：${omitted.join('、')}`] : []),
    '这是一次快速检查，只看了 diff 本身。要深入审查可以用 /code-review。',
  ].join('\n')
}
