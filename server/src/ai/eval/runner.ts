import type { EvalCase } from './cases.ts'
import type { ToolCall, Turn } from './checks.ts'

/**
 * 跑一条用例：直接打正在运行的 `/api/ai/chat`（N11）。
 *
 * 为什么走 HTTP 而不是在进程内调模型：
 * 回归要测的是**线上那条链路**——系统提示词、工具 schema、槽位收敛、度量写入，
 * 全都在路由里。进程内另写一份调用，测的就是另一份代码，改完路由这里不会红。
 * 代价是跑之前得先起服务（`npm run dev:api`），这一条写在脚本帮助里。
 */

export type RunnerOptions = {
  baseUrl: string
  /** 登录 token；不带就是匿名链路（匿名也要能通过，这是产品底线） */
  token?: string
  timeoutMs?: number
}

const DEFAULT_TIMEOUT = 90_000

/** SSE 是 `event: x\ndata: {...}\n\n`；这里不引第三方解析器，格式就这三行 */
function parseSseBlock(block: string): { event: string; data: string } | null {
  let event = ''
  let data = ''
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data += line.slice(5).trim()
  }
  return event ? { event, data } : null
}

async function chatOnce(
  opts: RunnerOptions,
  messages: { role: 'user' | 'assistant'; content: string }[],
  slots: Record<string, unknown>
): Promise<Turn> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT)
  try {
    const res = await fetch(`${opts.baseUrl}/api/ai/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {})
      },
      body: JSON.stringify({ messages, slots, stream: true }),
      signal: ctl.signal
    })
    if (!res.ok || !res.body) {
      // 503 未配置是最常见的一种：直接抛，让上层给出「先配 AI_API_KEY」的提示
      const detail = await res.text().catch(() => '')
      throw new Error(`chat ${res.status}: ${detail.slice(0, 200)}`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let text = ''
    let finalSlots: Record<string, unknown> = { ...slots }
    const tools: ToolCall[] = []

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      // 事件以空行分隔；最后一段可能不完整，留在 buf 里等下一轮
      let idx = buf.indexOf('\n\n')
      while (idx >= 0) {
        const block = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        const parsed = parseSseBlock(block)
        if (parsed) {
          const payload = (() => {
            try {
              return JSON.parse(parsed.data) as Record<string, unknown>
            } catch {
              return null
            }
          })()
          if (parsed.event === 'delta' && payload) text += String(payload.text ?? '')
          if (parsed.event === 'done' && payload?.slots && typeof payload.slots === 'object') {
            finalSlots = payload.slots as Record<string, unknown>
          }
          // 工具返回要留下：判定「不编数字」「引擎判出 over-budget」全靠它，
          // 只留文本的话这两类断言根本写不出来（以前 Turn 只有 text + slots）
          if (parsed.event === 'tool_result' && payload) {
            tools.push({ name: String(payload.name ?? ''), output: payload.output })
          }
          if (parsed.event === 'error' && payload) throw new Error(String(payload.message ?? '模型报错'))
        }
        idx = buf.indexOf('\n\n')
      }
    }
    return { text, slots: finalSlots, tools }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 跑一条用例。有 history 的先跑前置轮次（只要把上下文喂进去，结果不判定），
 * 最后一轮才是被判定的那句 —— 多轮用例的价值在于槽位跨轮累积。
 *
 * 返回的工具调用只取**最后一轮**：判定的是这一轮有没有拿工具结果说话，
 * 前面轮次的查询不该替这一轮的编造作证。
 */
export async function runCase(c: EvalCase, opts: RunnerOptions): Promise<Turn> {
  const messages: { role: 'user' | 'assistant'; content: string }[] = []
  let slots: Record<string, unknown> = {}

  for (const turn of c.history ?? []) {
    messages.push({ role: 'user', content: turn })
    const r = await chatOnce(opts, messages, slots)
    slots = r.slots
    messages.push({ role: 'assistant', content: r.text })
  }

  messages.push({ role: 'user', content: c.user })
  const last = await chatOnce(opts, messages, slots)
  return { text: last.text, slots: last.slots, tools: last.tools }
}
