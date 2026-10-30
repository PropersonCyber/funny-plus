import { Hono } from 'hono'
import { and, count, eq } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { factFeedbacks, facts } from '../db/schema.ts'
// 类型从 web 单向引；tsx 跑源码时会被抹掉，所以镜像里不需要打 web/src
import type { TravelFact } from '@/types/index.ts'

const NOTE_MAX = 60
const CLIENT_ID_MAX = 64
const VALID_VERDICTS = ['met', 'not-applicable'] as const
type Verdict = (typeof VALID_VERDICTS)[number]

/** 库里的行 → 前端契约；日期列 drizzle 默认就是 'YYYY-MM-DD' 字符串，与前端比较口径一致 */
const toApi = (r: typeof facts.$inferSelect): TravelFact => ({
  id: r.id,
  city: r.city,
  category: r.category as TravelFact['category'],
  content: r.content,
  scope: r.scope,
  source: r.source,
  sourceUrl: r.sourceUrl ?? undefined,
  verifiedAt: r.verifiedAt,
  validUntil: r.validUntil ?? undefined,
  trust: r.trust
})

interface Grouped {
  factId: string
  verdict: Verdict
  total: number
}

interface Mine {
  factId: string
  verdict: Verdict
}

/** 聚合计数 + 当前设备自己的反馈；计数是派生数据，不写回 facts */
function summarize(grouped: Grouped[], mineRows: Mine[]) {
  const map = new Map<string, { factId: string; met: number; notApplicable: number; mine: Verdict | null }>()
  for (const g of grouped) {
    const entry = map.get(g.factId) ?? { factId: g.factId, met: 0, notApplicable: 0, mine: null }
    if (g.verdict === 'met') entry.met = Number(g.total)
    else entry.notApplicable = Number(g.total)
    map.set(g.factId, entry)
  }
  for (const m of mineRows) {
    const entry = map.get(m.factId)
    if (entry) entry.mine = m.verdict
  }
  return [...map.values()]
}

export const factsRoute = new Hono()

// 全量返回，过期过滤在前端做：A2 要展示「已折叠 N 条」，服务端先剪掉就数不出来了
factsRoute.get('/', async (c) => {
  const city = c.req.query('city')
  const rows = await db
    .select()
    .from(facts)
    .where(city ? eq(facts.city, city) : undefined)
    .orderBy(facts.id)
  return c.json({ items: rows.map(toApi) })
})

factsRoute.get('/feedback', async (c) => {
  const clientId = (c.req.query('clientId') ?? '').slice(0, CLIENT_ID_MAX)
  const grouped = await db
    .select({ factId: factFeedbacks.factId, verdict: factFeedbacks.verdict, total: count() })
    .from(factFeedbacks)
    .groupBy(factFeedbacks.factId, factFeedbacks.verdict)

  const mine = clientId
    ? await db
        .select({ factId: factFeedbacks.factId, verdict: factFeedbacks.verdict })
        .from(factFeedbacks)
        .where(eq(factFeedbacks.clientId, clientId))
    : []

  return c.json({ items: summarize(grouped as Grouped[], mine as Mine[]) })
})

factsRoute.post('/feedback', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object') return c.json({ error: '请求体不是合法 JSON' }, 400)

  const { factId, verdict, note, clientId } = body as Record<string, unknown>
  if (typeof factId !== 'string') return c.json({ error: '没有这条避坑信息' }, 400)
  const [known] = await db.select({ id: facts.id }).from(facts).where(eq(facts.id, factId)).limit(1)
  if (!known) return c.json({ error: '没有这条避坑信息' }, 400)
  if (typeof verdict !== 'string' || !VALID_VERDICTS.includes(verdict as Verdict)) {
    return c.json({ error: '反馈类型不合法' }, 400)
  }
  if (typeof clientId !== 'string' || !clientId || clientId.length > CLIENT_ID_MAX) {
    return c.json({ error: '缺少设备标识' }, 400)
  }

  const trimmed = typeof note === 'string' ? note.trim().slice(0, NOTE_MAX) : ''
  const existing = await db
    .select({ id: factFeedbacks.id })
    .from(factFeedbacks)
    .where(and(eq(factFeedbacks.factId, factId), eq(factFeedbacks.clientId, clientId)))
    .limit(1)
  if (existing.length) return c.json({ error: '这条你已经反馈过了' }, 409)

  await db.insert(factFeedbacks).values({
    id: crypto.randomUUID(),
    factId,
    verdict: verdict as Verdict,
    note: trimmed || null,
    clientId
  })

  const grouped = await db
    .select({ factId: factFeedbacks.factId, verdict: factFeedbacks.verdict, total: count() })
    .from(factFeedbacks)
    .where(eq(factFeedbacks.factId, factId))
    .groupBy(factFeedbacks.factId, factFeedbacks.verdict)

  const [summary] = summarize(grouped as Grouped[], [{ factId, verdict: verdict as Verdict }])
  return c.json({ item: summary }, 201)
})
