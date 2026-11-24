import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { streamText, tool, stepCountIs } from 'ai'
import { z } from 'zod'
import { db } from '../db/client.ts'
import { facts, lines, places } from '../db/schema.ts'
import { aiConfigured, chatModel, modelName } from '../ai/model.ts'
import { proposeReviseOp } from '../ai/revise.ts'
import { recordAiCall, startedAt, elapsedMs } from '../ai/observe.ts'
import { composePromptVersion, PROMPT_VERSIONS } from '../ai/prompt.ts'
import type { TokenUsage } from '../ai/cost.ts'
import { appendTurn, latestTurnsOf, loadTurns, resolveSession } from '../ai/history.ts'
import { resolveActorQuietly } from '../auth/middleware.ts'
import { nearestTo, placeById, placesOf, placesLoaded, setPlaces, travelMinutes } from '@/engine/placeIndex.ts'
import { warmRoutes } from '../ai/routeWarm.ts'
import { linePlaceIds, linesAtPlace, linesOf, setLines } from '@/engine/lines.ts'
import { budgetView, clock, factsView, linesView, placeDetailView, segmentView, validateView } from '@/engine/aiGround.ts'
import { cityTransitFor, nextStopAfter, reachabilityOf } from '@/engine/onSite.ts'
import type { Reachability } from '@/engine/onSite.ts'
import { NO_KEYWORD_HINT, generatePlans, keywordReviseOp } from '@/engine/planner.ts'
import { isLight } from '@/engine/lightPlan.ts'
import { applyReviseOp } from '@/engine/planEdit.ts'
import { toApi as dbPlaceToApi } from './places.ts'
import { factWithTrust, feedbackStats } from './facts.ts'
import { lineToApi } from './lines.ts'
import { buildChatPrompt } from '../ai/chatPrompt.ts'
import { applyPatch, missingOf, toDemand } from '../ai/slots.ts'
import type { Slots } from '../ai/slots.ts'
import { proposePlanOrder } from '../ai/propose.ts'
import { narrateMemory } from '../ai/narrate.ts'
import type { NarrativeParagraph, NarrativeSource } from '../ai/narrate.ts'
import { buildMemoryDraft } from '@/engine/memoryDraft.ts'
import type { Place, RevisePreview, TripContext, TripMemory } from '@/types/index.ts'
/**
 * 对话式旅行助手。
 *
 * 分层原则：模型只负责「听懂人话」，不负责算钱和排时间。
 * 模型通过工具把自然语言收敛成 Demand 槽位，槽位齐了再调 generatePlans；
 * 预算 / 校验 / 时间轴全部由 shared/engine 的纯函数算 —— 让模型自己输出数字，
 * 它会给你一个自洽但错误的价格，而用户没有能力分辨。
 */
/** 请求里的定位快照：只认合法坐标，别的一律当作没有定位 */
function locOf(raw: unknown): { lng: number; lat: number; accuracy?: number; at?: number } | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const lng = Number(r.lng)
  const lat = Number(r.lat)
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
  if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return null
  const accuracy = Number(r.accuracy)
  const at = Number(r.at)
  return {
    lng,
    lat,
    ...(Number.isFinite(accuracy) ? { accuracy } : {}),
    ...(Number.isFinite(at) ? { at } : {})
  }
}

export const aiRoute = new Hono()

/**
 * 「附近有什么」的三类筛选（F04）。
 *
 * 数据里没有独立的餐厅/机位实体，只有地点标签。所以这三类只能按标签近似筛，
 * 筛不出来就如实说「这类没收录」—— 拿一个博物馆冒充「吃饭的地方」比不回答更糟。
 */
const CATEGORY_TAGS: Record<'eat' | 'play' | 'photo', string[]> = {
  // 小吃/商圈是现有数据里唯一与「吃」相关的标签
  eat: ['小吃', '商圈'],
  play: ['人文', '休闲', '亲子', '动物', '博物馆', '园林', '茶馆'],
  photo: ['拍照', '文创', '夜景']
}
const CATEGORY_LABEL: Record<'eat' | 'play' | 'photo', string> = { eat: '吃饭', play: '游玩', photo: '拍照' }

/** 现在能不能去的排序：来得及的排前面，已关门的排最后（不删，它本身也是答案） */
const REACH_ORDER: Record<Reachability, number> = { fits: 0, tight: 1, closing: 2, closed: 3, unknown: 4 }

/**
 * 这座城市现在的本地时间。
 *
 * 现场推荐靠「现在几点」判断还开不开门，用服务器时区会错 8 小时 ——
 * 服务器多半跑在 UTC，那样整天的判断都会偏。三个开放城市都在东八区，直接按它算。
 *
 * shortcut: 只支持国内城市。接入其他时区时改成按城市查时区表。
 */
function nowInCity(now = new Date()): number {
  const utc = now.getTime() + now.getTimezoneOffset() * 60_000
  const local = new Date(utc + 8 * 3_600_000)
  return local.getHours() * 60 + local.getMinutes()
}

const demandSchema = z.object({
  destination: z.string().optional().describe('目的地城市，如「重庆」'),
  dayCount: z.number().int().min(1).max(5).optional().describe('游玩天数'),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('出发日期 YYYY-MM-DD。用户没说就省略，绝不要拿今天充数'),
  party: z.number().int().min(1).max(20).optional().describe('同行人数'),
  budgetLevel: z.enum(['low', 'mid', 'high', 'flexible']).optional().describe('预算档位'),
  preferences: z.array(z.string()).optional().describe('偏好标签，如 美食探店 / 经典打卡 / 拍照出片'),
  transport: z.enum(['public', 'car', 'charter', 'compare']).optional().describe('交通方式'),
  notes: z.string().optional().describe('用户的其他补充要求原文'),
  hours: z
    .number()
    .min(1)
    .max(12)
    .nullable()
    .optional()
    .describe('只安排接下来几小时（当地临时规划），如「下午还有四小时」= 4。改口要按天数了传 null 清空'),
  startMin: z
    .number()
    .int()
    .min(0)
    .max(22 * 60)
    .optional()
    .describe('从当天几点开始，当日分钟数（14:00 = 840）。用户说了起始时刻才填，没说就省略'),
  returnBy: z
    .number()
    .int()
    .min(0)
    .max(23 * 60 + 59)
    .optional()
    .describe('最晚返回时刻，当日分钟数（20:00 = 1200）。用户说「20 点前回来」才填，是约束不是建议'),
  mustVisit: z
    .array(z.string())
    .optional()
    .describe('用户点名必去的地点 id，按他说的先后顺序。id 必须来自 queryPlaces，不要自己编')
})

/**
 * 地点池只在首次提问时载入一次。
 *
 * shared/engine/placeIndex 是模块级 Map，setPlaces 改的是全局状态：
 * 如果按请求灌不同城市的数据，两个用户并发问不同城市会互相覆盖，
 * A 城市的人拿到 B 城市的地点。所以这里一次性灌全量，之后只读。
 *
 * **避坑不在这里缓存**：它的可信度依赖反馈与有效期（C1/C3），一旦和地点池一起
 * 缓存到进程生命周期，AI 的回答就永远停在第一次启动时那一档 —— 攻略页因为
 * 反馈降了档，AI 还在拿「官方已核验」说话。47 条数据一次查完是一次很便宜的查询，
 * 每次 getFacts 重查反馈聚合即可（见 tools.getFacts）。
 */
let engineReady: Promise<void> | null = null

function ensureEngine(): Promise<void> {
  if (!engineReady) {
    engineReady = (async () => {
      const [placeRows, lineRows] = await Promise.all([db.select().from(places), db.select().from(lines)])
      // 全量灌入后只读：按请求换城市会让并发的两个人互相盖掉地点和线路
      setPlaces(placeRows.map(dbPlaceToApi))
      setLines(lineRows.map(lineToApi))
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
  // 轻量规划只有一套、顺序由「离我最近」决定，模型提的顺序会被引擎丢掉 ——
  // 这一步照样会花掉一次模型调用，不如省掉
  const light = isLight(demand)
  // 模型调用的用量要带进度量：降级分支也拿得到（模型答得不对不代表没花钱）
  let usage: TokenUsage | null = null
  if (aiConfigured() && !light) {
    const proposed = await proposePlanOrder(demand)
    usage = proposed.usage
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
      promptVersion: composePromptVersion({ proposal: PROMPT_VERSIONS.proposal }),
      sessionId,
      userId: actor?.userId ?? null,
      model: modelName(),
      journey,
      toolCalls: by === 'model' ? 1 : 0,
      degraded: true,
      degradeReason: 'generate_failed',
      durationMs: elapsedMs(started),
      usage
    })
    const msg = err instanceof Error ? err.message : '生成方案失败'
    return c.json({ error: msg, code: 'plan_failed' }, 400)
  }

  // 轻量规划本来就不走模型（顺序由距离决定，模型提的顺序会被丢掉）。
  // 这不算降级：把它记成降级会让「模型不可用率」凭空变高
  await recordAiCall({
    kind: 'plan',
    promptVersion: composePromptVersion({ proposal: PROMPT_VERSIONS.proposal }),
    sessionId,
    userId: actor?.userId ?? null,
    model: modelName(),
    journey,
    toolCalls: by === 'model' ? 1 : 0,
    degraded: !light && by !== 'model',
    degradeReason: by === 'model' || light ? null : 'model_unavailable_or_unparsable',
    durationMs: elapsedMs(started),
    usage
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
        /** 当前定位（用户授权后由客户端上传）；没有就是没授权，不推断 */
        loc?: { lng?: number; lat?: number; accuracy?: number; at?: number }
      }
    | null

  // 静默解析：token 坏了只是 userId 记不上，不该让整轮对话失败
  const actor = await resolveActorQuietly(c.req.header('authorization'))

  // ---- G6 会话上云 ----
  // 登录且只给了 input 时走「服务端持有历史」：客户端不再把整段对话带上来，
  // 换设备才不会「没聊过」。匿名仍然整段带（服务端没有归属，存了也找不回来）。
  const input = typeof body?.input === 'string' ? body.input.trim() : ''
  const trip = tripContextOf(body?.trip)
  const loc = locOf(body?.loc)
  const session = actor?.userId && input
    ? await resolveSession(actor.userId, typeof body?.sessionId === 'string' ? body.sessionId : '', trip?.tripId ?? null)
    : null
  const history: { role: 'user' | 'assistant'; content: string }[] = session
    ? await loadTurns(session.userId, session.id)
    : []

  const messages = session
    ? [...history, { role: 'user' as const, content: input }]
    : (Array.isArray(body?.messages) ? body.messages : []).filter((m) =>
      (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim()
    )
  const userText = lastUserText(messages)
  if (!userText) return c.json({ error: '缺少对话内容', code: 'bad_param' }, 400)

  // 槽位跟着整轮对话走：工具里写入，结束时回传给前端，下一轮原样带回来
  const slots: Slots = { ...(body?.slots ?? {}) }
  // 同一轮里 generatePlans 调了几次。第二次仍有硬冲突就停，不能让模型一直重排
  let planAttempts = 0
  const prompt = buildChatPrompt({ text: userText, trip, loc, slots })

  // ---- G7 服务端度量：本轮对话的服务端侧账 ----
  // journey 由客户端标注（plan = 从零规划，revise = 改已有行程），空表示日常使用。
  // sessionId 用来把同一轮对话里的多次调用串起来 —— 「降级次数」要能落回某一轮对话，
  // 只有时间戳是做不到的（同一秒可以有多轮）。
  const journey = typeof body?.journey === 'string' && body.journey ? body.journey.slice(0, 32) : null
  const sessionId = session?.id ?? (typeof body?.sessionId === 'string' && body.sessionId ? body.sessionId.slice(0, 64) : null)
  const started = startedAt()
  const counters = { toolCalls: 0, toolFailures: 0, plans: 0 }
  const record = (extra: { durationMs: number; error?: string | null; usage?: TokenUsage | null }) =>
    recordAiCall({
      kind: 'chat',
      promptVersion: prompt.version,
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
      error: extra.error ?? null,
      usage: extra.usage ?? null
    })

  /**
   * 读这次调用的用量。
   *
   * `totalUsage` 是 Promise：流式响应要等整轮结束才拿得到，
   * 所以只能在 record 之前 await。拿不到就当 null，绝不让计量失败影响回答本身 ——
   * 少一行成本记录远好过让用户的对话变成 500。
   */
  const usageOf = async (): Promise<TokenUsage | null> => {
    try {
      const u = await result.totalUsage
      return { inputTokens: u?.inputTokens ?? null, outputTokens: u?.outputTokens ?? null }
    } catch {
      return null
    }
  }

  const result = streamText({
    model: chatModel(),
    system: prompt.system,
    activeTools: prompt.activeTools,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    // 补槽位、查事实、生成、硬冲突后再松一版、改一天。再多就是空转
    stopWhen: stepCountIs(8),
    tools: {
      updateDemand: tool({
        description: '把用户这一轮提到的需求字段写进槽位。只写用户明确说过的字段，没提到就不要填。',
        inputSchema: demandSchema,
        execute: async (patch) => {
          applyPatch(slots, patch)
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
          // 每次重查而不是读一份进程级缓存：可信度按反馈与有效期实时算（C1/C3），
          // 缓存住那一刻的档位，模型就会拿旧结论回答「这条是官方核验的」
          const [rows, stats] = await Promise.all([db.select().from(facts), feedbackStats()])
          return factsView(rows.map((r) => factWithTrust(r, stats)), city, placeId)
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

      /**
       * 附近有什么（F04 现场推荐）。
       *
       * 只按**用户给的坐标**排距离，没有坐标时不猜：拿城市中心冒充用户位置，
       * 排出来看着合理，实际会让他跨半个城市去一个「附近」的点。
       */
      nearbyPlaces: tool({
        description:
          '按位置找附近已收录的地点。用户没授权定位时可以传 placeId 手动指定一个地点作为起点（F04 拒绝定位后仍能继续）。没有定位也没有 placeId 时先追问。',
        inputSchema: z.object({
          limit: z.number().int().min(1).max(10).optional().describe('返回几个，默认 5'),
          city: z.string().optional().describe('城市名，省略则用当前行程目的地'),
          placeId: z.string().optional().describe('用户手动指定的起点地点 id，定位不可用且用户说了在哪时用'),
          want: z
            .enum(['eat', 'play', 'photo'])
            .optional()
            .describe(
              '用户想找哪一类（吃/玩/拍照）。eat 目前只有小吃街与商圈，没有独立餐厅数据；说的时候别把它说成「推荐餐厅」'
            ),
          hours: z
            .number()
            .min(0.5)
            .max(12)
            .optional()
            .describe('用户还剩多少小时可用；给了就按它判断来不来得及，没给就只看营业状态')
        }),
        execute: async ({ limit, city, placeId, want, hours }) => {
          await ensureEngine()
          const target = (city ?? trip?.demand.destination ?? '').trim()
          // 手动指定的起点优先于设备定位：用户明确说了「我在前门」，比一个可能过期的坐标可信
          const anchor = placeId ? placeById(placeId) : undefined
          if (placeId && !anchor) return { ok: false, error: '这个地点 id 不在已收录数据里，换一个或让用户说地名' }
          if (!anchor && !loc) {
            return { ok: false, error: '还没有位置。先问用户在哪个位置（地名也行），或让他手动指定，不要推断' }
          }
          const city_ = (anchor?.city ?? target).trim()
          if (!city_) return { ok: false, error: '不知道在哪个城市，先问用户' }
          const all = placesOf(city_).filter((p) => p.id !== anchor?.id)
          if (!all.length) return { ok: false, error: `${city_} 暂未收录地点数据` }
          // 按已有标签筛：数据里没有「餐厅」这类实体，只有地点的 tags。
          // 筛完为空时如实说「这类没有收录」，不要让模型拿别的类别凑数
          const tags = want ? CATEGORY_TAGS[want] : null
          const pool = tags ? all.filter((p) => tags.some((t) => p.tags.includes(t))) : all
          if (!pool.length) {
            return { ok: false, error: `${city_} 暂未收录「${CATEGORY_LABEL[want!]}」类地点，如实告诉用户，不要拿别的类别顶替` }
          }
          const from = anchor ?? loc!
          const nowMin = nowInCity()
          const near = nearestTo(from, pool, limit ?? 5)
          // 只按距离排是不够的：20 米外但已经停止入场，推荐它等于让用户白走一趟。
          // 关门的排到最后而不是删掉 —— 「那家已经关了」本身也是有用的答案
          const ranked = near
            .map(({ place, km }) => {
              const r = reachabilityOf(place, nowMin, hours)
              return { place, km, reach: r.reach, note: r.note }
            })
            .sort((a, b) => REACH_ORDER[a.reach] - REACH_ORDER[b.reach] || a.km - b.km)
          return {
            ok: true,
            // 距离是直线近似，不是导航里程；界面与模型都不能把它说成「走过去多久」
            basis: '直线距离',
            want: want ?? null,
            from: anchor ? { name: anchor.name, manual: true } : { manual: false },
            now: clock(nowMin),
            items: ranked.map(({ place, km, reach, note }) => ({
              id: place.id,
              name: place.name,
              km,
              tags: place.tags,
              stayMin: place.stayMin,
              reach,
              note
            }))
          }
        }
      }),

      /**
       * 这一段怎么走（F05 逐段交通比较）。
       *
       * 按**当前人数**比钱和时间，不合成总分：2 人和 6 人本来就该得出不同结论。
       * 没有线路数据时如实说只能步行/打车，不编班次。
       */
      transportFor: tool({
        description:
          '比较某一段路的交通方式：步行、打车、景区线路，按当前人数给出费用、耗时与分乘。用户问「怎么过去」「打车还是坐车」「我们 6 个人怎么划算」时用。',
        inputSchema: z.object({
          fromPlaceId: z.string().describe('这一段起点的地方 id'),
          toPlaceId: z.string().describe('这一段终点的地方 id'),
          party: z.number().int().min(1).max(20).optional().describe('实际人数，省略用当前行程人数')
        }),
        execute: async ({ fromPlaceId, toPlaceId, party }) => {
          await ensureEngine()
          const from = placeById(fromPlaceId)
          const to = placeById(toPlaceId)
          if (!from || !to) return { ok: false, error: '起点或终点不在已收录数据里，先用 queryPlaces 确认 id' }
          const people = party ?? trip?.demand.party ?? slots.party ?? 1
          // 步行时长与引擎排程同口径：真实路线优先，没有就直线折算
          const walk = travelMinutes(from, to, false)
          const ride = travelMinutes(from, to, true)
          // 这一段有没有线路覆盖，由引擎按「终点是不是乘车点」判断
          const line = linesAtPlace(to.id).find((l) => linePlaceIds(l).includes(from.id))
          return segmentView(line, people, ride, walk)
        }
      }),

      nextStop: tool({
        description: '查当前行程里某一站的下一站、距离和可用的景区交通。用户说「接下来去哪」「下一个点」时用。',
        inputSchema: z.object({
          itemId: z.string().describe('当前所在那一站的行程条目 id')
        }),
        execute: async ({ itemId }) => {
          if (!trip) return { ok: false, error: '还没有行程，不能算下一站' }
          const next = nextStopAfter(trip.plan, itemId)
          if (!next) return { ok: true, last: true, hint: '这一天没有下一站了，如实告诉用户，不要编一个' }
          return {
            ok: true,
            last: false,
            title: next.place.name,
            placeId: next.place.id,
            distanceKm: next.distanceKm,
            distanceBasis: '直线距离',
            // 没有线路数据时 line 是 null：模型必须说「没查到交通」，不能编班次
            line: next.line
              ? {
                  name: next.line.name,
                  departure: clock(next.line.departureMin),
                  rideMin: next.line.rideMin,
                  verified: next.line.verified
                }
              : null,
            // 城市公交数据为 0，这里显式告知，避免模型自行编造地铁/公交班次
            cityTransit: cityTransitFor(trip.demand.destination)
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

          const demand = toDemand(slots)
          // 轻量规划从「我现在在哪」排起；模型不给 origin，只有设备坐标可用。
          // 坐标只用于这一次排序，不写回 demand：它会随方案存进本机行程，
          // 而用户没同意让精确位置跟着出行记录长期留着
          const from = isLight(demand) && !demand.origin && loc ? { ...demand, origin: { lng: loc.lng, lat: loc.lat } } : demand
          let plans
          try {
            // 第一遍只用来知道「会用到哪些相邻段」：planner 排序看直线距离，
            // 所以这一遍的顺序就是最终顺序，第二遍只有路上时间变准。
            const firstPass = generatePlans(from)
            const warm = await warmRoutes(from, firstPass)
            // 一段都没取到（未配高德 / 断网 / 限流）：不必重跑，第一遍已经是直线估算
            plans = warm.hit > 0 ? generatePlans(from) : firstPass
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
        execute: async () => {
          if (!trip) {
            return { ok: false, error: '当前没有正在编辑的行程，先用 generatePlans 生成一份' }
          }
          // 以用户原话为准，不采用模型改写后的 instruction：
          // 行程页拿的也是用户敲进去的那句，两边必须是同一句才谈得上同一种改动
          const { preview, reason } = await resolveRevision(trip, userText)
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
    await record({ durationMs: elapsedMs(started), usage: await usageOf() })
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
    // 先记度量再发 done：done 之后前端就收流了，这次写库不该占用用户的时间。
    // usageOf 要等整轮结束才 resolve，所以先 await 拿用量，再 fire-and-forget 写库 ——
    // 反过来（不 await 就直接读 promise）会拿到 undefined，成本列永远是 null
    const usage = await usageOf()
    void record({ durationMs: elapsedMs(started), error: failed, usage })
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

  const { preview, reason, by, usage } = await resolveRevision(trip, instruction, body?.currentDay)
  // by === 'engine' 就是降级：模型没配置 / 挂了 / 输出不可解析，改走本地关键词兜底。
  // 这一条要单独能查 —— 「模型不可用触发降级」是 G7 的验收项之一。
  await recordAiCall({
    kind: 'revise',
    promptVersion: composePromptVersion({ revision: PROMPT_VERSIONS.revision }),
    sessionId,
    userId: actor?.userId ?? null,
    model: modelName(),
    journey,
    toolCalls: by === 'model' ? 1 : 0,
    degraded: by !== 'model',
    degradeReason: by === 'model' ? null : 'model_unavailable_or_unparsable',
    durationMs: elapsedMs(started),
    usage
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
): Promise<{ preview: RevisePreview | null; reason: string; by: RevisePreview['by']; usage: TokenUsage | null }> {
  if (aiConfigured()) {
    const proposed = await proposeReviseOp(trip.plan, trip.demand, instruction, currentDay)
    // 用量在模型这一段就定了：后面无论落地成功还是落回兜底，这次调用都已经发生
    const usage = proposed.usage
    if ('op' in proposed) {
      const applied = applyReviseOp(trip.plan, trip.demand, proposed.op, 'model')
      if (applied.ok) return { preview: applied.preview, reason: '', by: 'model', usage }
      return { preview: null, reason: applied.reason, by: 'model', usage }
    }
    if ('reason' in proposed) return { preview: null, reason: proposed.reason, by: 'model', usage }
    // 走到这里说明模型不可用：用量仍可能非空（调用发生过但输出不可解析）
    const guess = keywordReviseOp(trip.plan, trip.demand, instruction, currentDay)
    if (!guess) return { preview: null, reason: NO_KEYWORD_HINT, by: 'engine', usage }
    if ('unsupported' in guess) return { preview: null, reason: guess.unsupported, by: 'engine', usage }
    const applied = applyReviseOp(trip.plan, trip.demand, guess, 'engine')
    if (applied.ok) return { preview: applied.preview, reason: '', by: 'engine', usage }
    return { preview: null, reason: applied.reason, by: 'engine', usage }
  }

  // 模型没配置：一次调用都没发生，用量就是 null（不是 0）
  const guess = keywordReviseOp(trip.plan, trip.demand, instruction, currentDay)
  if (!guess) return { preview: null, reason: NO_KEYWORD_HINT, by: 'engine', usage: null }
  if ('unsupported' in guess) return { preview: null, reason: guess.unsupported, by: 'engine', usage: null }
  const applied = applyReviseOp(trip.plan, trip.demand, guess, 'engine')
  if (applied.ok) return { preview: applied.preview, reason: '', by: 'engine', usage: null }
  return { preview: null, reason: applied.reason, by: 'engine', usage: null }
}

/**
 * 回忆叙述：把用户写下的记录整理成一段通顺的回顾（F07 / N8 之后）。
 *
 * 与其它 AI 端点的三点不同，都来自「回忆是用户的亲历，不是产品的内容」：
 *
 * 1. **不读库**。回忆由客户端上传（`payload.trip` + `payload.memory`），
 *    匿名用户的回忆只在本机，强制登录会砍掉主场景；越权风险因此也不存在。
 * 2. **模型不可用时降级到确定性草稿**，返回 200 + `by:'engine'`，不报错 ——
 *    与 `/revise` 同一口径：AI 是加分项，不是回忆功能的前提。
 * 3. **结果必须带来源**。模型输出的每一段都对着一条真实记录（见 narrate.applyNarrative），
 *    对不上的句子被丢弃。所以这里返回的 `by` 不只是「谁写的」，也是「能不能信」。
 */
aiRoute.post('/memory-narrative', async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { trip?: TripContext; memory?: TripMemory; sessionId?: string; journey?: string }
    | null
  const trip = tripContextOf(body?.trip)
  const memory = memoryOfBody(body?.memory)
  if (!trip || !memory) return c.json({ error: '缺少行程或回忆内容', code: 'bad_param' }, 400)

  const started = startedAt()
  const actor = await resolveActorQuietly(c.req.header('authorization'))
  const sessionId = typeof body?.sessionId === 'string' && body.sessionId ? body.sessionId.slice(0, 64) : null
  const journey = typeof body?.journey === 'string' && body.journey ? body.journey.slice(0, 32) : null

  // 兜底与基线永远是同一份确定性文本：模型失败时用户拿到的内容，
  // 与结束旅行时自动生成的那份完全一致，不会因为「AI 挂了」突然少了几条记录
  const baseline = buildMemoryDraft({ demand: trip.demand, plans: [trip.plan], planIndex: 0 }, memory)
  const sources = narrativeSources(trip, memory)

  let text = baseline
  let by: 'model' | 'engine' = 'engine'
  let usage: TokenUsage | null = null
  if (aiConfigured() && sources.length) {
    const narrated = await narrateMemory(sources)
    usage = narrated.usage
    if (narrated.ok) {
      const joined = joinNarrative(narrated.paragraphs)
      // 模型给的内容真的可用才替换基线。空串或只剩待补清单时保留基线
      if (joined) {
        text = joined
        by = 'model'
      }
    }
  }

  await recordAiCall({
    kind: 'memory',
    promptVersion: composePromptVersion({ narrative: PROMPT_VERSIONS.narrative }),
    sessionId,
    userId: actor?.userId ?? null,
    model: modelName(),
    journey,
    toolCalls: by === 'model' ? 1 : 0,
    degraded: by !== 'model',
    degradeReason: by === 'model' ? null : 'model_unavailable_or_unparsable',
    durationMs: elapsedMs(started),
    usage
  })

  return c.json({ text, by })
})

/** 回忆正文只用到这几个字段，其余（照片等）不进 prompt，也不回传 */
function memoryOfBody(raw: unknown): TripMemory | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Partial<TripMemory>
  if (!m.places || typeof m.places !== 'object') return null
  return {
    tripId: typeof m.tripId === 'string' ? m.tripId : '',
    overview: typeof m.overview === 'string' ? m.overview : '',
    photos: Array.isArray(m.photos) ? m.photos : [],
    places: m.places as TripMemory['places'],
    createdAt: typeof m.createdAt === 'string' ? m.createdAt : '',
    updatedAt: typeof m.updatedAt === 'string' ? m.updatedAt : ''
  }
}

/** 把记录摊平成「一行一条」，只含有用户写过东西的那些 */
function narrativeSources(trip: TripContext, memory: TripMemory): NarrativeSource[] {
  const out: NarrativeSource[] = []
  for (const day of trip.plan.days) {
    for (const item of day.items) {
      if (item.kind === 'meal' || !item.placeId) continue
      const note = memory.places[item.id]
      const text = (note?.text ?? '').trim()
      const visited = note?.visited ?? 'unknown'
      const hasPhotos = (note?.photos ?? []).length > 0
      // 与 buildMemoryDraft 同一条过滤：什么都没记的点不进叙述，只进末尾待补
      if (visited === 'unknown' && !text && !hasPhotos) continue
      out.push({ ref: `d${day.index}:${item.id}`, day: day.index, title: item.title, visited, text, hasPhotos })
    }
  }
  return out
}

/**
 * 模型段落 → 草稿文本。
 *
 * 按天分块，格式与 `buildMemoryDraft` 保持同一形状（`Day N` 头 + 每行一个点），
 * 这样回忆页的渲染逻辑不用为「模型版」单独写一套 —— 两套渲染意味着两处都会出 bug。
 */
function joinNarrative(paragraphs: NarrativeParagraph[]): string {
  const days = new Map<number, string[]>()
  for (const p of paragraphs) {
    const m = /^d(\d+):/.exec(p.sourceRef)
    if (!m) continue
    const day = Number(m[1])
    const list = days.get(day) ?? []
    list.push(`· ${p.text.trim()}`)
    days.set(day, list)
  }
  return [...days.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, lines]) => `Day ${day}\n${lines.join('\n')}`)
    .join('\n')
}
