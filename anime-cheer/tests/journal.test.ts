import { expect, test } from 'claude-code/testing'

import { addTask, isTask, lastTaskLine, makeTask, projectKey, recapPrompt, recapReport } from '../hooks/journal'
import { parseReview, reviewPrompt, reviewReport, trimDiff } from '../hooks/review'

const NOW = 1_000_000_000
const LOGIN = makeTask(
  NOW - 3 * 3_600_000,
  '帮我把登录页的表单校验补上，\n再跑一下测试',
  '搞定了：**邮箱格式**、密码至少 8 位。\n```ts\ncode\n```\n12 个测试全部通过。',
  42,
  18,
  52_000,
  ['src/Login.tsx', 'src/Login.tsx', 'src/Login.test.tsx'],
  true,
)

test('a task is kept as one line of prompt, one of answer, and the files it touched', () => {
  expect(LOGIN.prompt).toBe('帮我把登录页的表单校验补上， 再跑一下测试')
  expect(LOGIN.answer).toBe('搞定了：邮箱格式、密码至少 8 位。 12 个测试全部通过。')
  expect(LOGIN.files).toEqual(['src/Login.tsx', 'src/Login.test.tsx'])
  expect([isTask('/waifu token', 3, 0), isTask('修 bug', 20, 3), isTask('你好', 2, 0), isTask('  ', 30, 2), isTask('解释一下', 8, 0)]).toEqual([false, true, false, false, true])
  expect(addTask(Array.from({ length: 60 }, () => LOGIN), LOGIN)).toHaveLength(60)
  expect(projectKey('/a/b')).toMatch(/^tasks:[0-9a-f]{8}$/)
  expect(projectKey('/a/b')).toBe(projectKey('/a/b'))
  expect(projectKey('/a/b') === projectKey('/a/c')).toBe(false)
})

test('the recap lists the newest tasks first', () => {
  const tasks = addTask(addTask([], LOGIN), makeTask(NOW - 5 * 60_000, '加一个导出按钮', '', 12, 4, 9000, [], false))
  expect(recapReport('不知火舞', tasks, NOW).split('\n')).toEqual([
    '🗂 不知火舞的任务回顾（最近 2 条，共 2 条）',
    '- 5 分钟前（中断）：加一个导出按钮',
    '  12s · 4 次工具 · 9000 token',
    '- 3 小时前：帮我把登录页的表单校验补上， 再跑一下测试',
    '  42s · 18 次工具 · 5.2万 token · 改了 src/Login.tsx、src/Login.test.tsx',
    '  结果：搞定了：邮箱格式、密码至少 8 位。 12 个测试全部通过。',
  ])
  expect(lastTaskLine(tasks, NOW)).toBe('5 分钟前：加一个导出按钮')
  expect(lastTaskLine([LOGIN], NOW)).toBe('3 小时前：帮我把登录页的表单校验补上…')
  expect([recapReport('舞', [], NOW), lastTaskLine([], NOW)]).toEqual(['🗂 舞：这个项目里还没有记下过任务。', undefined])
  expect(recapPrompt(tasks, NOW)).toContain('- 5 分钟前：加一个导出按钮')
})

test('a diff is trimmed by whole files; lock files and what does not fit are named', () => {
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1 +1 @@',
    '-a',
    '+b',
    'diff --git a/package-lock.json b/package-lock.json',
    '--- a/package-lock.json',
    '+++ b/package-lock.json',
    '@@ -1 +1 @@',
    '-x',
    '+y',
    'diff --git a/big.ts b/big.ts',
    '--- a/big.ts',
    '+++ b/big.ts',
    '@@ -1 +1 @@',
    `+${'z'.repeat(300)}`,
    '',
  ].join('\n')
  const trimmed = trimDiff(diff, 200)
  expect([trimmed.files, trimmed.omitted, trimmed.text.includes('src/a.ts'), trimmed.text.includes('big.ts')]).toEqual([1, ['package-lock.json', 'big.ts'], true, false])
  expect(reviewPrompt(trimmed.text, trimmed.omitted)).toContain('package-lock.json、big.ts')
})

test("a review is read from the model's JSON, whatever it wraps it in", () => {
  const answer =
    '好的：\n```json\n{"verdict":"ok","summary":"有一个空指针","findings":[{"file":"src/a.ts","line":12,"severity":"high","issue":"user 可能为空","fix":"先判断"},{"file":"b.ts","severity":"weird","issue":"x"},{"issue":""}]}\n```'
  const review = parseReview(answer)
  // A verdict of "ok" over a high finding is not believed.
  expect(review).toEqual({
    verdict: 'bad',
    summary: '有一个空指针',
    findings: [
      { file: 'src/a.ts', line: 12, severity: 'high', issue: 'user 可能为空', fix: '先判断' },
      { file: 'b.ts', line: 0, severity: 'low', issue: 'x', fix: '' },
    ],
  })
  expect(parseReview('{"verdict":"bad","summary":"","findings":[]}')).toEqual({ verdict: 'ok', summary: '没发现问题', findings: [] })
  expect([parseReview('抱歉我不能'), parseReview('{not json}')]).toEqual([undefined, undefined])
  expect(reviewReport('卡蜜拉', review!, 3, ['x.lock'], 'sonnet').split('\n').slice(0, 5)).toEqual([
    '🔍 卡蜜拉的代码 review（3 个文件，sonnet）',
    '结论：有一个空指针',
    '1. [高] src/a.ts:12  user 可能为空',
    '   建议：先判断',
    '2. [低] b.ts  x',
  ])
})
