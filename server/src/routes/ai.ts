import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { streamText, tool, stepCountIs } from 'ai'
import { z } from 'zod'
import { db } from '../db/client.ts'
import { facts, lines, places } from '../db/schema.ts'
import { aiConfigured, chatModel, modelName } from '../ai/model.ts'
import { proposeReviseOp } from '../ai/revise.ts'
import { recordAiCall, startedAt, elapsedMs } from '../ai/observe.ts'
import { appendTurn, latestTurnsOf, loadTurns, resolveSession } from '../ai/history.ts'
import { resolveActorQuietly } from '../auth/middleware.ts'
import { placeById, placesOf, placesLoaded, setPlaces } from '@/engine/placeIndex.ts'
import { warmRoutes } from '../ai/routeWarm.ts'
import { linesOf, setLines } from '@/engine/lines.ts'
import { budgetView, factsView, linesView, placeDetailView, validateView } from '@/engine/aiGround.ts'
import { NO_KEYWORD_HINT, generatePlans, keywordReviseOp } from '@/engine/planner.ts'
import { applyReviseOp, dayBrief } from '@/engine/planEdit.ts'
import { toApi as dbPlaceToApi } from './places.ts'
import { factToApi } from './facts.ts'
import { lineToApi } from './lines.ts'
import { CHAT_SYSTEM_PROMPT } from '../ai/prompt.ts'
import { proposePlanOrder } from '../ai/propose.ts'
import type { Demand, Place, RevisePreview, TravelFact, TripContext } from '@/types/index.ts'
/**
 * 对话式旅行助手。
 *
 * 分层原则：模型只负责「听懂人话」，不负责算钱和排时间。
 * 模型通过工具把自然语言收敛成 Demand 槽位，槽位齐了再调 generatePlans；
 * 预算 / 校验 / 时间轴全部由 shared/engine 的纯函数算 —— 让模型自己输出数字，
 * 它会给你一个自洽但错误的价格，而用户没有能力分辨。
 */
export const aiRoute = new Hono()

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
let factCache: TravelFact[] = []

function ensureEngine(): Promise<void> {
  if (!engineReady) {
    engineReady = (async () => {
      const [placeRows, factList, lineRows] = await Promise.all([
        db.select().from(places),
        db.select().from(facts),
        db.select().from(lines)
      ])
      // 全量灌入后只读：按请求换城市会让并发的两个人互相盖掉地点和线路
      setPlaces(placeRows.map(dbPlaceToApi))
      setLines(lineRows.map(lineToApi))
      // 显式包一层：factToApi 第二位是可选的可信度结论，直接 map(factToApi) 会把下标当成它传进去
      factCache = factList.map((f) => factToApi(f))
    })().catch((err) => {
      engineReady = null
      throw err
    })
  }
  return engineReady
}

aiRoute.get('/status', (c) => c.json({ enabled: aiConfigured() }))

/** 对话里要改的是用户刚说的那句，不是模型转述后的说法 */
function lastUserText(messages: { role: string; content: string }[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') {
      const text = messages[i].content.trim()
      if (text) return text
    }
  }
  return ''
}

function tripContextOf(raw: unknown): TripContext | null {
  const trip = raw as TripContext | null | undefined
  if (!trip?.plan?.days?.length || !trip?.demand?.destination) return null
  if (trip.demand.destination !== trip.plan.destination) return null
  return trip
}

/** 把行程压成模型能读懂的清单：只给 id、地名、时刻、票价，票价未核实就写「未核实」 */
function tripPrompt(trip: TripContext): string {
  const lines = trip.plan.days.map(
    (d) =>
      `第 ${d.index} 天：` +
      dayBrief(d)
        .map((i) => `${i.title}（id=${i.id}，${i.start}-${i.end}${i.cost === null ? '，票价未核实' : ''}）`)
        .join('；')
  )
  return [
    '',
    '## 当前旅行（工作台上正在看的那一份）',
    `目的地：${trip.demand.destination}；天数：${trip.demand.dayCount}；人数：${trip.demand.party}；交通：${trip.demand.transport}`,
    ...lines,
    '用户说「改一下 / 轻松点 / 换个地方」时，指的是上面这份行程',
    ''
  ].join('\n')
}

/**
 * 某趟旅程最近一次对话（G6 换设备续聊）。
 *
 * 只回文本：方案与预览由客户端按当前行程重新渲染，历史卡片不复活 ——
 * 跨设备把「待确认」变成「可确认」是最危险的一种复活。
 */
/**
 * 表单主链路的模型提案（N10）。
 *
 * 与对话入口共用同一套引擎与服务端路段预热，但**不需要**模型听懂人话：
 * 表单已经把 Demand 填成结构化槽位，这里只让它在地点池里挑走法与顺序。
 *
 * 降级是无损的：模型没配 / 超时 / 输出不可解析，一律当没提过，
 * 走回原来的 `generatePlans(demand)`，产出与今天完全一致（只是没有模型参与）。
 */
aiRoute.post('/plans', async (c) => {
  const body = (c.req.json ? await c.req.json().catch(() => null) : null) as
    | { demand?: unknown; sessionId?: string; journey?: string }
    | null
  const demand = toDemand((body?.demand ?? {}) as Slots)
  const started = startedAt()
  const actor = await resolveActorQuietly(c.req.header('authorization'))
  const sessionId = typeof body?.sessionId === 'string' && body.sessionId ? body.sessionId.slice(0, 64) : null
  const journey = typeof body?.journey === 'string' && body.journey ? body.journey.slice(0, 32) : null

  await ensureEngine()
  if (!placesLoaded()) return c.json({ error: '地点数据未载入', code: 'not_ready' }, 503)

  let by: 'model' | 'engine' = 'engine'
  let order: string[] | undefined
  let reason = ''
  if (aiConfigured()) {
    const proposed = await proposePlanOrder(demand)
    if ('ok' in proposed) {
      by = 'model'
      order = proposed.order
      reason = proposed.reason
    }
  }

  let plans
  try {
    // 与对话入口同一套两遍生成：第一遍定顺序，预热路段后第二遍把到达时刻变准。
    // 顺序交给模型时两遍都用同一个 order，否则第一遍的模型顺序和第二遍的就对不上了。
    const firstPass = generatePlans(demand, { order })
    const warm = await warmRoutes(demand, firstPass)
    plans = warm.hit > 0 ? generatePlans(demand, { order }) : firstPass
  } catch (err) {
    await recordAiCall({
      kind: 'plan',
      sessionId,
      userId: actor?.userId ?? null,
      model: modelName(),
      journey,
      toolCalls: by === 'model' ? 1 : 0,
      degraded: true,
      degradeReason: 'generate_failed',
      durationMs: elapsedMs(started)
    })
    const msg = err instanceof Error ? err.message : '生成方案失败'
    return c.json({ error: msg, code: 'plan_failed' }, 400)
  }

  await recordAiCall({
    kind: 'plan',
    sessionId,
    userId: actor?.userId ?? null,
    model: modelName(),
    journey,
    toolCalls: by === 'model' ? 1 : 0,
    degraded: by !== 'model',
    degradeReason: by === 'model' ? null : 'model_unavailable_or_unparsable',
    durationMs: elapsedMs(started)
  })
  return c.json({ plans, by, reason })
})

aiRoute.get('/history', async (c) => {
  const actor = await resolveActorQuietly(c.req.header('authorization'))
  if (!actor) return c.json({ error: '请先登录', code: 'unauthorized' }, 401)
  const tripId = (c.req.query('tripId') ?? '').trim()
  // 没有 tripId 时不报错：从零规划的场景本来就没有历史可续
  if (!tripId) return c.json({ sessionId: null, turns: [], updatedAt: null })
  const found = await latestTurnsOf(actor.userId, tripId)
  return c.json(found ?? { sessionId: null, turns: [], updatedAt: null })
})

aiRoute.post('/chat', async (c) => {
  if (!aiConfigured()) {
    // 和 geo / auth 同一套口径：没配是 503 + code，前端据此隐藏入口而不是点了再报错
    return c.json({ error: 'AI 服务未配置', code: 'not_configured' }, 503)
  }

  const body = (await c.req.json().catch(() => null)) as
    | {
        messages?: { role: 'user' | 'assistant'; content: string }[]
        slots?: Slots
        stream?: boolean
        trip?: TripContext
        sessionId?: string
        journey?: string
        /** G6：登录时只传本轮输入，历史由服务端持有 */
        input?: string
      }
    | null

  // 静默解析：token 坏了只是 userId 记不上，不该让整轮对话失败
  const actor = await resolveActorQuietly(c.req.header('authorization'))

  // ---- G6 会话上云 ----
  // 登录且只给了 input 时走「服务端持有历史」：客户端不再把整段对话带上来，
  // 换设备才不会「没聊过」。匿名仍然整段带（服务端没有归属，存了也找不回来）。
  const input = typeof body?.input === 'string' ? body.input.trim() : ''
  const trip = tripContextOf(body?.trip)
  const session = actor?.userId && input
    ? await resolveSession(actor.userId, typeof body?.sessionId === 'string' ? body.sessionId : '', trip?.tripId ?? null)
    : null
  const history: { role: 'user' | 'assistant'; content: string }[] = session
    ? await loadTurns(session.userId, session.id)
    : []

  const messages = session
    ? [...history, { role: 'user' as const, content: input }]
    : (body?.messages ?? []).filter((m) => typeof m?.content === 'string' && m.content.trim())
  if (!messages.length) return c.json({ error: '缺少对话内容', code: 'bad_param' }, 400)

  // 槽位跟着整轮对话走：工具里写入，结束时回传给前端，下一轮原样带回来
  const slots: Slots = { ...(body?.slots ?? {}) }
  // 同一轮里 generatePlans 调了几次。第二次仍有硬冲突就停，不能让模型一直重排
  let planAttempts = 0
  // 有当前行程时按「改这份行程」聊；没有时按「从零规划」聊
  const system = trip ? `${CHAT_SYSTEM_PROMPT}\n${tripPrompt(trip)}` : CHAT_SYSTEM_PROMPT

  // ---- G7 服务端度量：本轮对话的服务端侧账 ----
  // journey 由客户端标注（plan = 从零规划，revise = 改已有行程），空表示日常使用。
  // sessionId 用来把同一轮对话里的多次调用串起来 —— 「降级次数」要能落回某一轮对话，
  // 只有时间戳是做不到的（同一秒可以有多轮）。
  const journey = typeof body?.journey === 'string' && body.journey ? body.journey.slice(0, 32) : null
  const sessionId = session?.id ?? (typeof body?.sessionId === 'string' && body.sessionId ? body.sessionId.slice(0, 64) : null)
  const started = startedAt()
  const counters = { toolCalls: 0, toolFailures: 0, plans: 0 }
  const record = (extra: { durationMs: number; error?: string | null }) =>
    recordAiCall({
      kind: 'chat',
      sessionId,
      userId: actor?.userId ?? null,
      model: modelName(),
      journey,
      stream: body?.stream !== false,
      toolCalls: counters.toolCalls,
      toolFailures: counters.toolFailures,
      planGenerated: counters.plans > 0,
      planAttempts,
      durationMs: extra.durationMs,
      error: extra.error ?? null
    })

  const result = streamText({
    model: chatModel(),
    system,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    // 补槽位、查事实、生成、硬冲突后再松一版、改一天。再多就是空转
    stopWhen: stepCountIs(8),
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

      getPlaceDetail: tool({
        description: '查一个已收录地点的营业时间、票价、来源和核验时间。placeId 必须来自 queryPlaces。',
        inputSchema: z.object({ placeId: z.string().describe('地点 id') }),
        execute: async ({ placeId }) => {
          await ensureEngine()
          return placeDetailView(placeById(placeId))
        }
      }),

      getFacts: tool({
        description: '查某城市或地点仍有效的避坑。过期条目只返回数量，不返回正文。',
        inputSchema: z.object({
          city: z.string().describe('城市名'),
          placeId: z.string().optional().describe('地点 id，可省略')
        }),
        execute: async ({ city, placeId }) => {
          await ensureEngine()
          return factsView(factCache, city, placeId)
        }
      }),

      getBudget: tool({
        description: '解释当前行程的费用依据。没有行程时不要调用。省略 day 则返回整份分项。',
        inputSchema: z.object({ day: z.number().int().optional().describe('只看第几天，可省略') }),
        execute: async ({ day }) => {
          if (!trip) return { ok: false, error: '还没有行程，不能解释费用' }
          return budgetView(trip.plan, day)
        }
      }),

      validatePlan: tool({
        description: '检查当前行程有没有硬冲突。没有行程时不要调用。',
        inputSchema: z.object({ check: z.boolean().optional().describe('可省略') }),
        execute: async () => {
          if (!trip) return { ok: false, error: '还没有行程，不能校验' }
          return validateView(trip.plan, trip.demand, 1)
        }
      }),

      listLines: tool({
        description: '查某城市已收录线路的首末班和核载。没有数据就说未核实，不要编班次。',
        inputSchema: z.object({ city: z.string().describe('城市名') }),
        execute: async ({ city }) => {
          await ensureEngine()
          return linesView(linesOf(city))
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

          const demand = toDemand(slots)
          let plans
          try {
            // 第一遍只用来知道「会用到哪些相邻段」：planner 排序看直线距离，
            // 所以这一遍的顺序就是最终顺序，第二遍只有路上时间变准。
            const firstPass = generatePlans(demand)
            const warm = await warmRoutes(demand, firstPass)
            // 一段都没取到（未配高德 / 断网 / 限流）：不必重跑，第一遍已经是直线估算
            plans = warm.hit > 0 ? generatePlans(demand) : firstPass
          } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : '生成方案失败' }
          }
          planAttempts += 1
          const picked = pace ? plans.filter((p) => p.pace === pace) : plans
          const ready = picked.length ? picked : plans
          // 返回完整 Plan：工作台渲染的就是它。checks 把硬冲突喂回模型，让它决定要不要再松一版
          return {
            demand,
            plans: ready,
            attempt: planAttempts,
            checks: ready.map((p) => ({ pace: p.pace, ...validateView(p, demand, planAttempts) }))
          }
        }
      }),

      /**
       * 改当前行程。对话模型不自己挑动作，只交用户原话。
       * 解析走 resolveRevision，和行程页 POST /api/ai/revise 是同一个函数。
       */
      proposeRevise: tool({
        description: '用户要修改当前这份已排好的行程时调用。不要自己决定怎么改，程序会按用户原话出预览。',
        inputSchema: z.object({
          instruction: z.string().describe('用户这一句原话，原样抄过来，不要改写')
        }),
        execute: async ({ instruction }) => {
          if (!trip) {
            return { ok: false, error: '当前没有正在编辑的行程，先用 generatePlans 生成一份' }
          }
          // 以用户原话为准，不采用模型改写后的 instruction：
          // 行程页拿的也是用户敲进去的那句，两边必须是同一句才谈得上同一种改动
          const said = lastUserText(messages) || instruction.trim()
          if (!said) return { ok: false, error: '没有听到要改什么' }
          const { preview, reason } = await resolveRevision(trip, said)
          if (!preview) return { ok: false, error: reason }
          return { ok: true, preview }
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
    let revise: unknown = null
    try {
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') chunks.push(part.text)
        else if (part.type === 'tool-call') counters.toolCalls += 1
        else if (part.type === 'tool-result' && part.toolName === 'generatePlans') {
          // 调用次数只在 tool-call 那一支记：同一次调用先发 tool-call 再发 tool-result，
          // 两支都加会把「调了 1 次工具」记成 2 次，成功率永远算不对
          counters.plans += 1
          plans = part.output
        } else if (part.type === 'tool-result' && part.toolName === 'proposeRevise') {
          revise = part.output
        } else if (part.type === 'tool-error') {
          counters.toolFailures += 1
          console.error('[ai] tool failed:', part.toolName, part.error)
        }
      }
    } catch (err) {
      console.error('[ai] non-stream failed:', err)
      await record({ durationMs: elapsedMs(started), error: err instanceof Error ? err.message : String(err) })
      return c.json({ error: '生成回答失败', code: 'upstream_error' }, 502)
    }
    const text = chunks.join('')
    // 会话上云：落库放在返回之前，否则用户切后台这条就永远补不回来。
    // 失败只记日志：历史没存上不该让这次回答变成报错
    if (session) {
      await appendTurn(session.userId, session.id, trip?.tripId ?? null, input, text).catch((err) =>
        console.error('[ai] history append failed:', err)
      )
    }
    await record({ durationMs: elapsedMs(started) })
    // revise 必须跟 plans 一起回：Lynx 读不了流时走这条，漏了的话对话里永远出不了确认卡
    return c.json({ text, slots, plans, revise, sessionId: session?.id ?? null })
  }

  return streamSSE(c, async (stream) => {
    // 消费 fullStream 而不是 textStream：只取文本的话前端看不到
    // 「正在查询地点」这类中间态，几秒钟没有输出会像卡死
    let failed: string | null = null
    // 全文攒一份：会话上云要落库，而流式没有「一次性拿到全文」的时机
    const text: string[] = []
    try {
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          text.push(part.text)
          await stream.writeSSE({ event: 'delta', data: JSON.stringify({ text: part.text }) })
        } else if (part.type === 'tool-call') {
          counters.toolCalls += 1
          await stream.writeSSE({ event: 'tool', data: JSON.stringify({ name: part.toolName }) })
        } else if (part.type === 'tool-result') {
          if (part.toolName === 'generatePlans') counters.plans += 1
          await stream.writeSSE({
            event: 'tool_result',
            data: JSON.stringify({ name: part.toolName, output: part.output })
          })
        } else if (part.type === 'tool-error') {
          counters.toolFailures += 1
          // 工具执行抛异常时 SDK 只发这个事件，不会有 tool-result。
          // 不处理的话前端看到「工具已调用」却永远等不到结果，表现为静默卡住
          console.error('[ai] tool failed:', part.toolName, part.error)
          await stream.writeSSE({
            event: 'tool_result',
            data: JSON.stringify({ name: part.toolName, output: { ok: false, error: String(part.error) } })
          })
        } else if (part.type === 'error') {
          failed = String(part.error)
          console.error('[ai] stream error:', part.error)
          await stream.writeSSE({ event: 'error', data: JSON.stringify({ message: failed }) })
        }
      }
    } catch (err) {
      // 已经进流了就没法再改状态码，只能推一条 error 事件让前端收尾
      failed = err instanceof Error ? err.message : String(err)
      await stream.writeSSE({ event: 'error', data: JSON.stringify({ message: failed }) })
    }
    // 会话上云：在发 done 之前落库。done 之后前端就收流了，
    // 用户很可能立刻切后台，那时这次写入就没机会了
    const full = text.join('')
    if (session && input && full) {
      await appendTurn(session.userId, session.id, trip?.tripId ?? null, input, full).catch((err) =>
        console.error('[ai] history append failed:', err)
      )
    }
    // 先记度量再发 done：done 之后前端就收流了，这次写库不该占用用户的时间
    void record({ durationMs: elapsedMs(started), error: failed })
    await stream.writeSSE({
      event: 'done',
      data: JSON.stringify({ slots, sessionId: session?.id ?? null })
    })
  })
})

/**
 * 一次自然语言修改：模型解析意图 → 引擎执行并算影响 → 返回待确认的预览。
 *
 * 这里不落库，也不改任何已保存的行程：确认权在用户手里，前端确认后才写本机存档。
 * 模型不可用时**不报错**，而是落回本地关键词兜底（by='engine'），主链路不阻塞——
 * 但界面必须照实说这次是本地兜底，不能让人以为模型听懂了。
 */
aiRoute.post('/revise', async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { trip?: TripContext; instruction?: string; currentDay?: number; sessionId?: string; journey?: string }
    | null
  const trip = tripContextOf(body?.trip)
  const instruction = (body?.instruction ?? '').trim()
  if (!trip) return c.json({ error: '缺少当前行程，先在工作台生成一份行程', code: 'bad_param' }, 400)
  if (!instruction) return c.json({ error: '缺少修改要求', code: 'bad_param' }, 400)

  const started = startedAt()
  const actor = await resolveActorQuietly(c.req.header('authorization'))
  const sessionId = typeof body?.sessionId === 'string' && body.sessionId ? body.sessionId.slice(0, 64) : null
  const journey = typeof body?.journey === 'string' && body.journey ? body.journey.slice(0, 32) : null

  await ensureEngine()
  if (!placesLoaded()) return c.json({ error: '地点数据未载入', code: 'not_ready' }, 503)

  const { preview, reason, by } = await resolveRevision(trip, instruction, body?.currentDay)
  // by === 'engine' 就是降级：模型没配置 / 挂了 / 输出不可解析，改走本地关键词兜底。
  // 这一条要单独能查 —— 「模型不可用触发降级」是 G7 的验收项之一。
  await recordAiCall({
    kind: 'revise',
    sessionId,
    userId: actor?.userId ?? null,
    model: modelName(),
    journey,
    toolCalls: by === 'model' ? 1 : 0,
    degraded: by !== 'model',
    degradeReason: by === 'model' ? null : 'model_unavailable_or_unparsable',
    durationMs: elapsedMs(started)
  })
  if (!preview) {
    return c.json({ supported: false as const, reason, by })
  }
  return c.json({ supported: true as const, preview })
})

/**
 * 主路径走模型，失败不带错误码地落回本地兜底。
 * 抽成函数是为了让「模型说做不到」和「模型挂了」分开：
 * 前者要如实转述，后者换成兜底并说明来源，不能都变成一句「修改失败」。
 */
async function resolveRevision(
  trip: TripContext,
  instruction: string,
  currentDay?: number
): Promise<{ preview: RevisePreview | null; reason: string; by: RevisePreview['by'] }> {
  if (aiConfigured()) {
    const proposed = await proposeReviseOp(trip.plan, trip.demand, instruction, currentDay)
    if ('op' in proposed) {
      const applied = applyReviseOp(trip.plan, trip.demand, proposed.op, 'model')
      if (applied.ok) return { preview: applied.preview, reason: '', by: 'model' }
      return { preview: null, reason: applied.reason, by: 'model' }
    }
    if ('reason' in proposed) return { preview: null, reason: proposed.reason, by: 'model' }
  }

  // 模型没配置 / 挂了 / 输出不可解析：落回同一套关键词表，界面会标明这次是本地兜底
  const guess = keywordReviseOp(trip.plan, trip.demand, instruction, currentDay)
  if (!guess) return { preview: null, reason: NO_KEYWORD_HINT, by: 'engine' }
  if ('unsupported' in guess) return { preview: null, reason: guess.unsupported, by: 'engine' }
  const applied = applyReviseOp(trip.plan, trip.demand, guess, 'engine')
  if (applied.ok) return { preview: applied.preview, reason: '', by: 'engine' }
  return { preview: null, reason: applied.reason, by: 'engine' }
}
