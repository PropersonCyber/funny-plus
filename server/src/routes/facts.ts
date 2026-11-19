import { Hono } from 'hono'
import { and, count, eq, isNull, or } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { factFeedbacks, facts } from '../db/schema.ts'
import { resolveActorQuietly } from '../auth/middleware.ts'
// 类型从 shared 单向引；tsx 跑源码时会被抹掉，所以镜像里不需要打 shared
import type { TravelFact } from '@/types/index.ts'

const NOTE_MAX = 60
const CLIENT_ID_MAX = 64
const VALID_VERDICTS = ['met', 'not-applicable'] as const
type Verdict = (typeof VALID_VERDICTS)[number]

/** 库里的行 → 前端契约；日期列 drizzle 默认就是 'YYYY-MM-DD' 字符串，与前端比较口径一致 */
export const factToApi = (r: typeof facts.$inferSelect): TravelFact => ({
  id: r.id,
  city: r.city,
  category: r.category as TravelFact['category'],
  content: r.content,
  scope: r.scope,
  source: r.source,
  sourceUrl: r.sourceUrl ?? undefined,
  verifiedAt: r.verifiedAt,
  validUntil: r.validUntil ?? undefined,
  trust: r.trust,
  placeId: r.placeId ?? undefined,
  poiGroup: r.poiGroup ?? undefined
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
  return c.json({ items: rows.map(factToApi) })
})

factsRoute.get('/feedback', async (c) => {
  const clientId = (c.req.query('clientId') ?? '').slice(0, CLIENT_ID_MAX)
  const actor = await resolveActorQuietly(c.req.header('authorization'))
  const grouped = await db
    .select({ factId: factFeedbacks.factId, verdict: factFeedbacks.verdict, total: count() })
    .from(factFeedbacks)
    .groupBy(factFeedbacks.factId, factFeedbacks.verdict)

  // 「我投过哪些」登录后按 userId 找：换设备时 clientId 换了，只按 clientId 会查不到自己投过的
  const mine = actor
    ? await db
        .select({ factId: factFeedbacks.factId, verdict: factFeedbacks.verdict })
        .from(factFeedbacks)
        .where(
          or(
            eq(factFeedbacks.userId, actor.userId),
            clientId ? and(isNull(factFeedbacks.userId), eq(factFeedbacks.clientId, clientId)) : undefined
          )
        )
    : clientId
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

  // 登录用户必须按 userId 落库：GET /facts 的「我投过哪些」是按 userId 查的，
  // 只写 clientId 等于登录用户换台设备就找不到自己投过的反馈
  const actor = await resolveActorQuietly(c.req.header('authorization'))
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
  // 同一条只投一次：clientId 兜未登录，userId 兜「换设备还登着同一个号」
  const existing = await db
    .select({ id: factFeedbacks.id })
    .from(factFeedbacks)
    .where(
      and(
        eq(factFeedbacks.factId, factId),
        // 登录用户按 userId 判重：换设备 clientId 变了，只按 clientId 会让他再投一次
        actor
          ? or(
              eq(factFeedbacks.userId, actor.userId),
              and(isNull(factFeedbacks.userId), eq(factFeedbacks.clientId, clientId))
            )
          : eq(factFeedbacks.clientId, clientId)
      )
    )
    .limit(1)
  if (existing.length) return c.json({ error: '这条你已经反馈过了' }, 409)

  await db.insert(factFeedbacks).values({
    id: crypto.randomUUID(),
    factId,
    verdict: verdict as Verdict,
    note: trimmed || null,
    // 两条都写：clientId 留着做匿名并账的认领条件，userId 让登录用户换设备也认得出自己投过
    clientId,
    userId: actor?.userId ?? null
  })

  const grouped = await db
    .select({ factId: factFeedbacks.factId, verdict: factFeedbacks.verdict, total: count() })
    .from(factFeedbacks)
    .where(eq(factFeedbacks.factId, factId))
    .groupBy(factFeedbacks.factId, factFeedbacks.verdict)

  const [summary] = summarize(grouped as Grouped[], [{ factId, verdict: verdict as Verdict }])
  return c.json({ item: summary }, 201)
})
