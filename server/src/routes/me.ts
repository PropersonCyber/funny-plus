import { Hono } from 'hono'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { collections, footprints, places } from '../db/schema.ts'
import type { CollectTarget, Collection, Footprint } from '@/types/index.ts'

const CLIENT_MAX = 64
const TARGETS: CollectTarget[] = ['place', 'fact', 'guide', 'play']

const clientOf = (c: { req: { query: (k: string) => string | undefined } }) =>
  (c.req.query('clientId') ?? '').slice(0, CLIENT_MAX)

const toCollection = (r: typeof collections.$inferSelect): Collection => ({
  id: r.id,
  targetType: r.targetType,
  targetId: r.targetId,
  createdAt: r.createdAt.toISOString()
})

const toFootprint = (r: typeof footprints.$inferSelect): Footprint => ({
  id: r.id,
  city: r.city,
  placeId: r.placeId,
  visitedOn: r.visitedOn
})

export const meRoute = new Hono()

/** 收藏 + 足迹一次拿全：我的页要同时显示计数和列表 */
meRoute.get('/', async (c) => {
  const clientId = clientOf(c)
  if (!clientId) return c.json({ collections: [], footprints: [] })
  const [cols, fps] = await Promise.all([
    db.select().from(collections).where(eq(collections.clientId, clientId)).orderBy(asc(collections.createdAt)),
    db.select().from(footprints).where(eq(footprints.clientId, clientId)).orderBy(asc(footprints.visitedOn))
  ])
  return c.json({ collections: cols.map(toCollection), footprints: fps.map(toFootprint) })
})

/** 收藏：幂等，重复点不报错也不重复插 */
meRoute.post('/collections', async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { clientId?: string; targetType?: CollectTarget; targetId?: string }
    | null
  const clientId = (body?.clientId ?? '').slice(0, CLIENT_MAX)
  const targetType = body?.targetType
  const targetId = body?.targetId ?? ''
  if (!clientId || !targetType || !TARGETS.includes(targetType) || !targetId) {
    return c.json({ error: '参数不完整' }, 400)
  }
  // 目标得真的存在，否则收藏表会攒一堆指向空内容的孤儿行
  if (targetType === 'place') {
    const hit = await db.select({ id: places.id }).from(places).where(eq(places.id, targetId)).limit(1)
    if (!hit.length) return c.json({ error: '地点不存在' }, 404)
  }
  const row = { id: crypto.randomUUID(), clientId, targetType, targetId }
  await db.insert(collections).values(row).onConflictDoNothing()
  const saved = await db
    .select()
    .from(collections)
    .where(
      and(
        eq(collections.clientId, clientId),
        eq(collections.targetType, targetType),
        eq(collections.targetId, targetId)
      )
    )
    .limit(1)
  return c.json({ item: saved.length ? toCollection(saved[0]) : null })
})

meRoute.delete('/collections', async (c) => {
  const clientId = clientOf(c)
  const targetType = c.req.query('targetType') as CollectTarget | undefined
  const targetId = c.req.query('targetId') ?? ''
  if (!clientId || !targetType || !TARGETS.includes(targetType) || !targetId) {
    return c.json({ error: '参数不完整' }, 400)
  }
  await db
    .delete(collections)
    .where(
      and(
        eq(collections.clientId, clientId),
        eq(collections.targetType, targetType),
        eq(collections.targetId, targetId)
      )
    )
  return c.json({ ok: true })
})

/** 足迹：同一天同一景点重复打卡幂等 */
meRoute.post('/footprints', async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { clientId?: string; placeId?: string }
    | null
  const clientId = (body?.clientId ?? '').slice(0, CLIENT_MAX)
  const placeId = body?.placeId ?? ''
  if (!clientId || !placeId) return c.json({ error: '参数不完整' }, 400)

  const hit = await db.select({ id: places.id, city: places.city }).from(places).where(eq(places.id, placeId)).limit(1)
  if (!hit.length) return c.json({ error: '地点不存在' }, 404)

  const visitedOn = new Date().toISOString().slice(0, 10)
  await db
    .insert(footprints)
    .values({ id: crypto.randomUUID(), clientId, city: hit[0].city, placeId, visitedOn })
    .onConflictDoNothing()
  const saved = await db
    .select()
    .from(footprints)
    .where(and(eq(footprints.clientId, clientId), eq(footprints.placeId, placeId), eq(footprints.visitedOn, visitedOn)))
    .limit(1)
  return c.json({ item: saved.length ? toFootprint(saved[0]) : null })
})
