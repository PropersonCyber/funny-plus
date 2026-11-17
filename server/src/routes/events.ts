import { Hono } from 'hono'
import { db } from '../db/client.ts'
import { trackEvents } from '../db/schema.ts'
import { resolveActorQuietly } from '../auth/middleware.ts'

/**
 * 埋点上报（F10 评估）。
 *
 * 三条硬规则，都是为了「埋点不能拖累主流程」：
 * 1. **永不返回 4xx 让客户端重试**。除请求体根本无法解析外一律 200 ——
 *    埋点丢一条不影响用户，但一个 4xx 会让客户端反复重发、把队列堵死。
 * 2. **逐条校验、逐条丢弃**。一批里混进一条脏数据，不该连累其余情况。
 * 3. **批量写入一次 insert**。单条 insert 在移动网络下会让首屏多发几十个请求。
 */

/** 事件名与字段长度上限：防止有人把整份行程塞进 props 把库撑爆 */
const BATCH_MAX = 100
const EVENT_MAX = 64
const ID_MAX = 64
const PROP_COUNT_MAX = 20
const PROP_VALUE_MAX = 200

type Incoming = {
  /** 客户端生成，同一次会话内稳定 */
  sessionId: string
  clientId: string
  platform?: string
  event: string
  props: Record<string, string | number | boolean>
  /** 客户端时间，ISO 串 */
  at: string
}

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null

/**
 * props 只收字符串 / 数字 / 布尔。
 * 嵌套对象直接丢弃而不是序列化成字符串：那等于把「不许塞整份行程」的约定绕过去。
 */
function cleanProps(raw: unknown): Record<string, string | number | boolean> | null {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) return null
  const out: Record<string, string | number | boolean> = {}
  let count = 0
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (count >= PROP_COUNT_MAX) break
    const key = k.slice(0, 40)
    if (typeof v === 'string') out[key] = v.slice(0, PROP_VALUE_MAX)
    else if (typeof v === 'number' && Number.isFinite(v)) out[key] = v
    else if (typeof v === 'boolean') out[key] = v
    // undefined / null / 对象 / 数组：跳过这一项，不整条丢
    else continue
    count++
  }
  return out
}

/** 单条校验；任何一项不合格返回 null（调用方丢弃这条，不影响整批） */
function parseOne(raw: unknown): Incoming | null {
  if (!raw || typeof raw !== 'object') return null
  const b = raw as Record<string, unknown>
  const sessionId = str(b.sessionId, ID_MAX)
  const clientId = str(b.clientId, ID_MAX)
  const event = str(b.event, EVENT_MAX)
  if (!sessionId || !clientId || !event) return null

  const props = cleanProps(b.props)
  if (!props) return null

  // 时间不合法就用服务端当前时间：宁可时间是接收时刻，也不要因一条时间戳写错丢掉整条事件
  const atRaw = typeof b.at === 'string' ? new Date(b.at) : null
  const at = atRaw && !Number.isNaN(atRaw.getTime()) ? atRaw : new Date()

  return {
    sessionId,
    clientId,
    platform: str(b.platform, 16) ?? undefined,
    event,
    props,
    at: at.toISOString()
  }
}

export const eventsRoute = new Hono()

eventsRoute.post('/', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object') return c.json({ error: '请求体不是合法 JSON' }, 400)

  const list = (body as { events?: unknown }).events
  if (!Array.isArray(list)) return c.json({ error: 'events 必须是数组' }, 400)

  // 静默解析：token 坏了也照常落库（按 client_id 归属），绝不因此让整批事件失败
  const actor = await resolveActorQuietly(c.req.header('authorization'))

  const rows = list
    .slice(0, BATCH_MAX)
    .map(parseOne)
    .filter((x): x is Incoming => x !== null)
    .map((e) => ({
      id: crypto.randomUUID(),
      sessionId: e.sessionId,
      clientId: e.clientId,
      userId: actor?.userId ?? null,
      platform: e.platform ?? null,
      event: e.event,
      props: e.props,
      at: new Date(e.at)
    }))

  // 全部被过滤掉也返回 200：客户端不该因为「格式我记得不对」陷入重试循环
  if (!rows.length) return c.json({ accepted: 0, received: list.length })

  await db.insert(trackEvents).values(rows)
  return c.json({ accepted: rows.length, received: list.length })
})
