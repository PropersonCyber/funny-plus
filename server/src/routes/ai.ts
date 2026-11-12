import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { streamText, tool, stepCountIs } from 'ai'
import { z } from 'zod'
import { db } from '../db/client.ts'
import { places } from '../db/schema.ts'
import { aiConfigured, chatModel } from '../ai/model.ts'
import { placesOf, placesLoaded, setPlaces } from '@/engine/placeIndex.ts'
import { generatePlans } from '@/engine/planner.ts'
import { toApi as dbPlaceToApi } from './places.ts'
import type { Demand, Place } from '@/types/index.ts'

/**
 * 对话式旅行助手。
 *
 * 分层原则：模型只负责「听懂人话」，不负责算钱和排时间。
 * 模型通过工具把自然语言收敛成 Demand 槽位，槽位齐了再调 generatePlans；
 * 预算 / 校验 / 时间轴全部由 shared/engine 的纯函数算 —— 让模型自己输出数字，
 * 它会给你一个自洽但错误的价格，而用户没有能力分辨。
 */
export const aiRoute = new Hono()

const SYSTEM_PROMPT = `你是「咕噜」，趣哪玩儿的旅行助手。用中文口语对话，简短具体，不要客服腔。

硬性约束（违反会被系统拒绝）：
1. 你只负责理解需求，绝不输出任何具体价格、时长分钟数、营业时间、距离数字。
   这些由程序算好后展示给用户，你写出来就是错的。
2. 只能提到 queryPlaces 返回的地点名。不要编造景点，不要提返回结果之外的地名。
3. 信息不足时先追问，一次最多问两件事。目的地、天数、人数、预算档位四项齐了才调用 generatePlans。
4. 用户说「随便」「都行」时，给出具体建议并说明理由，不要把问题原样丢回去。
5. 当前只开放重庆、成都、北京三个目的地。用户提到其他城市要如实说明暂未开放。`

/** 生成方案所需的最小槽位；不齐就不允许调 generatePlans */
const REQUIRED = ['destination', 'dayCount', 'party', 'budgetLevel'] as const

const LABEL: Record<(typeof REQUIRED)[number], string> = {
  destination: '目的地',
  dayCount: '天数',
  party: '人数',
  budgetLevel: '预算'
}

const demandSchema = z.object({
  destination: z.string().optional().describe('目的地城市，如「重庆」'),
  dayCount: z.number().int().min(1).max(5).optional().describe('游玩天数'),
  party: z.number().int().min(1).max(20).optional().describe('同行人数'),
  budgetLevel: z.enum(['low', 'mid', 'high', 'flexible']).optional().describe('预算档位'),
  preferences: z.array(z.string()).optional().describe('偏好标签，如 美食探店 / 经典打卡 / 拍照出片'),
  transport: z.enum(['public', 'car', 'charter', 'compare']).optional().describe('交通方式'),
  notes: z.string().optional().describe('用户的其他补充要求原文')
})

type Slots = Partial<Demand>

const missingOf = (s: Slots): string[] => REQUIRED.filter((k) => s[k] === undefined || s[k] === null).map((k) => LABEL[k])

/**
 * 槽位 → Demand。
 *
 * 不能直接 `slots as Demand`：Demand 的 preferences 等字段是非可选的，
 * 模型没提到偏好时槽位里就没有这个键，引擎里 `demand.preferences.flatMap` 会直接崩。
 * 类型断言在这里只能骗过编译器，骗不过运行时。
 */
function toDemand(s: Slots): Demand {
  return {
    destination: s.destination ?? '',
    dayCount: s.dayCount ?? 1,
    party: s.party ?? 1,
    budgetLevel: s.budgetLevel ?? 'flexible',
    preferences: s.preferences ?? [],
    transport: s.transport ?? 'public',
    notes: s.notes ?? ''
  }
}

/**
 * 地点池只在首次提问时载入一次。
 *
 * shared/engine/placeIndex 是模块级 Map，setPlaces 改的是全局状态：
 * 如果按请求灌不同城市的数据，两个用户并发问不同城市会互相覆盖，
 * A 城市的人拿到 B 城市的地点。所以这里一次性灌全量，之后只读。
 */
let engineReady: Promise<void> | null = null

function ensureEngine(): Promise<void> {
  if (!engineReady) {
    engineReady = (async () => {
      const rows = await db.select().from(places)
      setPlaces(rows.map(dbPlaceToApi))
    })().catch((err) => {
      // 失败要清掉，否则一次数据库抖动会让这个进程永久停在「地点没载入」
      engineReady = null
      throw err
    })
  }
  return engineReady
}

aiRoute.get('/status', (c) => c.json({ enabled: aiConfigured() }))

aiRoute.post('/chat', async (c) => {
  if (!aiConfigured()) {
    // 和 geo / auth 同一套口径：没配是 503 + code，前端据此隐藏入口而不是点了再报错
    return c.json({ error: 'AI 服务未配置', code: 'not_configured' }, 503)
  }

  const body = (await c.req.json().catch(() => null)) as
    | { messages?: { role: 'user' | 'assistant'; content: string }[]; slots?: Slots; stream?: boolean }
    | null
  const messages = (body?.messages ?? []).filter((m) => typeof m?.content === 'string' && m.content.trim())
  if (!messages.length) return c.json({ error: '缺少对话内容', code: 'bad_param' }, 400)

  // 槽位跟着整轮对话走：工具里写入，结束时回传给前端，下一轮原样带回来
  const slots: Slots = { ...(body?.slots ?? {}) }

  const result = streamText({
    model: chatModel(),
    system: SYSTEM_PROMPT,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    // 上限压得很低：对话助手只需要「补槽位 → 生成」两跳。
    // 留大空间只会让模型在循环里空转烧 token，而用户看到的只是变慢
    stopWhen: stepCountIs(6),
    tools: {
      updateDemand: tool({
        description: '把用户这一轮提到的需求字段写进槽位。只写用户明确说过的字段，没提到就不要填。',
        inputSchema: demandSchema,
        execute: async (patch) => {
          for (const [k, v] of Object.entries(patch)) {
            if (v !== undefined && v !== null) (slots as Record<string, unknown>)[k] = v
          }
          const missing = missingOf(slots)
          return {
            ok: true,
            slots,
            missing,
            hint: missing.length ? `还缺：${missing.join('、')}，继续追问` : '槽位已齐，可以调用 generatePlans'
          }
        }
      }),

      queryPlaces: tool({
        description: '查询某个城市已收录的地点。推荐任何景点之前必须先调这个，只能提返回结果里的地点。',
        inputSchema: z.object({
          city: z.string().describe('城市名'),
          tags: z.array(z.string()).optional().describe('按标签过滤，可省略')
        }),
        execute: async ({ city, tags }) => {
          await ensureEngine()
          const all = placesOf(city)
          const filtered = tags?.length ? all.filter((p: Place) => tags.some((t) => p.tags.includes(t))) : all
          return {
            count: filtered.length,
            items: filtered.map((p: Place) => ({ id: p.id, name: p.name, tags: p.tags, walk: p.walk }))
          }
        }
      }),

      generatePlans: tool({
        description: '槽位齐全后生成 2-3 套行程方案。只在 updateDemand 返回槽位已齐时调用。',
        inputSchema: z.object({
          pace: z.enum(['relaxed', 'balanced', 'packed']).optional().describe('节奏；用户没提就省略，会生成三档对比')
        }),
        execute: async ({ pace }) => {
          const missing = missingOf(slots)
          // 模型可能在槽位不全时抢跑。硬拦，并返回一条可读的 tool_result 让它自己纠正，
          // 而不是抛异常打断整轮对话
          if (missing.length) {
            return { ok: false, error: `还缺 ${missing.join('、')}，不能生成方案，先追问用户` }
          }
          await ensureEngine()
          if (!placesLoaded()) return { ok: false, error: '地点数据未载入' }

          const plans = generatePlans(toDemand(slots))
          const picked = pace ? plans.filter((p) => p.pace === pace) : plans
          return {
            ok: true,
            plans: (picked.length ? picked : plans).map((p) => ({
              id: p.id,
              paceLabel: p.paceLabel,
              transport: p.transport,
              suitableFor: p.suitableFor,
              days: p.days.map((d) => ({ index: d.index, items: d.items.map((i) => i.title) })),
              budget: p.budget,
              issues: p.issues
            }))
          }
        }
      })
    }
  })

  /**
   * 非流式分支：给不支持 getReader 的运行时兜底。
   *
   * Lynx 是自研 JS 运行时，不是浏览器，ReadableStream / getReader 是否可用
   * 无法在构建期确定。带 stream:false 时一次性返回全文，前端少了打字机效果
   * 但功能完整；不能因为不支持流式就直接不可用。
   */
  if (body?.stream === false) {
    const chunks: string[] = []
    let plans: unknown = null
    try {
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') chunks.push(part.text)
        else if (part.type === 'tool-result' && part.toolName === 'generatePlans') plans = part.output
        else if (part.type === 'tool-error') console.error('[ai] tool failed:', part.toolName, part.error)
      }
    } catch (err) {
      console.error('[ai] non-stream failed:', err)
      return c.json({ error: '生成回答失败', code: 'upstream_error' }, 502)
    }
    return c.json({ text: chunks.join(''), slots, plans })
  }

  return streamSSE(c, async (stream) => {
    // 消费 fullStream 而不是 textStream：只取文本的话前端看不到
    // 「正在查询地点」这类中间态，几秒钟没有输出会像卡死
    try {
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          await stream.writeSSE({ event: 'delta', data: JSON.stringify({ text: part.text }) })
        } else if (part.type === 'tool-call') {
          await stream.writeSSE({ event: 'tool', data: JSON.stringify({ name: part.toolName }) })
        } else if (part.type === 'tool-result') {
          await stream.writeSSE({
            event: 'tool_result',
            data: JSON.stringify({ name: part.toolName, output: part.output })
          })
        } else if (part.type === 'tool-error') {
          // 工具执行抛异常时 SDK 只发这个事件，不会有 tool-result。
          // 不处理的话前端看到「工具已调用」却永远等不到结果，表现为静默卡住
          console.error('[ai] tool failed:', part.toolName, part.error)
          await stream.writeSSE({
            event: 'tool_result',
            data: JSON.stringify({ name: part.toolName, output: { ok: false, error: String(part.error) } })
          })
        } else if (part.type === 'error') {
          console.error('[ai] stream error:', part.error)
          await stream.writeSSE({ event: 'error', data: JSON.stringify({ message: String(part.error) }) })
        }
      }
    } catch (err) {
      // 已经进流了就没法再改状态码，只能推一条 error 事件让前端收尾
      await stream.writeSSE({ event: 'error', data: JSON.stringify({ message: String(err) }) })
    }
    // 没有账号体系，服务端不存会话：历史由客户端持有，槽位每轮回传
    await stream.writeSSE({ event: 'done', data: JSON.stringify({ slots }) })
  })
})
