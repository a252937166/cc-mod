import type { Register } from 'claude-code'

// 最小的 mod：数工具调用、拦一条危险命令、干完活弹个提示。
export const register: Register = on => {
  let startedAt = 0
  let tools = 0

  // 一轮对话开始
  on('turn.start', async ($, e, next) => {
    startedAt = await $.clock.now()
    tools = 0
    return next(e)
  })

  // 每次工具调用。不调 next 直接返回 { deny }，这次调用就被拦下了
  on('tool.call', ($, e, next) => {
    if (e.tool === 'Bash' && /\brm\s+-rf\s+~/.test(e.command)) {
      return { deny: `${$.plugin.name}：这条命令太危险，先别跑` }
    }
    tools += 1
    $.ui.status(`本轮已调用 ${tools} 次工具`)
    return next(e)
  })

  // 一轮结束（子代理结束也会触发，这里只管主对话）
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const seconds = Math.round(((await $.clock.now()) - startedAt) / 1000)
      $.ui.status(undefined)
      $.ui.toast(`搞定：${seconds} 秒，${tools} 次工具`)
    }
    return next(e)
  })
}
