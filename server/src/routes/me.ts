import { Hono } from 'hono'
import { and, asc, eq, isNull, or } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { collections, footprints, places } from '../db/schema.ts'
import { optionalUser } from '../auth/middleware.ts'
import type { CollectTarget, Collection, Footprint } from '@/types/index.ts'

/**
 * 收藏与足迹（我的页）。
 *
 * 这两类数据匿名就能用，所以走 optionalUser 而不是 requireUser —— 登录只挡云同步与
 * 跨设备找回，不挡浏览与收藏。7 张表收口后仍然保持这个语义。
 *
 * 读写规则（与 design.md §3 一致）：
 * - 写：登录时同时写 user_id 与 client_id；匿名时只写 client_id。
 * - 读：登录时覆盖「账号名下」+「本机 clientId 名下尚未并账」两类行；匿名时只按 client_id。
 *
 * 为什么读要带上未并账那部分：用户可能在这台设备上匿名存过、后来登录了，但那条行
 * 的 user_id 还是空。只查 user_id 会让刚收藏的东西凭空消失。
 */
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

meRoute.use('*', optionalUser)

/** 收藏 + 足迹一次拿全：我的页要同时显示计数和列表 */
meRoute.get('/', async (c) => {
  const actor = c.get('actor')
  const clientId = clientOf(c)
  if (!actor && !clientId) return c.json({ collections: [], footprints: [] })

  const colScope = actor
    ? or(
        eq(collections.userId, actor.userId),
        clientId ? and(isNull(collections.userId), eq(collections.clientId, clientId)) : undefined
      )
    : eq(collections.clientId, clientId)
  const fpScope = actor
    ? or(
        eq(footprints.userId, actor.userId),
        clientId ? and(isNull(footprints.userId), eq(footprints.clientId, clientId)) : undefined
      )
    : eq(footprints.clientId, clientId)

  const [cols, fps] = await Promise.all([
    db.select().from(collections).where(colScope).orderBy(asc(collections.createdAt)),
    db.select().from(footprints).where(fpScope).orderBy(asc(footprints.visitedOn))
  ])
  return c.json({ collections: cols.map(toCollection), footprints: fps.map(toFootprint) })
})

/** 收藏：幂等，重复点不报错也不重复插 */
meRoute.post('/collections', async (c) => {
  const actor = c.get('actor')
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
  await db
    .insert(collections)
    .values({ id: crypto.randomUUID(), clientId, userId: actor?.userId ?? null, targetType, targetId })
    .onConflictDoNothing()
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
  const actor = c.get('actor')
  const clientId = clientOf(c)
  const targetType = c.req.query('targetType') as CollectTarget | undefined
  const targetId = c.req.query('targetId') ?? ''
  if (!clientId || !targetType || !TARGETS.includes(targetType) || !targetId) {
    return c.json({ error: '参数不完整' }, 400)
  }
  // 已登录只认 userId：clientId 是请求参数、由客户端任意填写，
  // 拿它当已登录请求的凭证，等于谁填对别人的 clientId 就能删别人的数据。
  // 未并账的本机行由首次登录的 claimAnonData 认领（auth.ts），不走这条删除路径兜底。
  const scope = actor ? eq(collections.userId, actor.userId) : eq(collections.clientId, clientId)
  await db
    .delete(collections)
    .where(and(scope, eq(collections.targetType, targetType), eq(collections.targetId, targetId)))
  return c.json({ ok: true })
})

/** 足迹：同一天同一景点重复打卡幂等 */
meRoute.post('/footprints', async (c) => {
  const actor = c.get('actor')
  const body = (await c.req.json().catch(() => null)) as { clientId?: string; placeId?: string } | null
  const clientId = (body?.clientId ?? '').slice(0, CLIENT_MAX)
  const placeId = body?.placeId ?? ''
  if (!clientId || !placeId) return c.json({ error: '参数不完整' }, 400)

  const hit = await db.select({ id: places.id, city: places.city }).from(places).where(eq(places.id, placeId)).limit(1)
  if (!hit.length) return c.json({ error: '地点不存在' }, 404)

  const visitedOn = new Date().toISOString().slice(0, 10)
  await db
    .insert(footprints)
    .values({ id: crypto.randomUUID(), clientId, userId: actor?.userId ?? null, city: hit[0].city, placeId, visitedOn })
    .onConflictDoNothing()
  const saved = await db
    .select()
    .from(footprints)
    .where(and(eq(footprints.clientId, clientId), eq(footprints.placeId, placeId), eq(footprints.visitedOn, visitedOn)))
    .limit(1)
  return c.json({ item: saved.length ? toFootprint(saved[0]) : null })
})
