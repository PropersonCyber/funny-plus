import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { tripMemories } from '../db/schema.ts'
import { requireUser } from '../auth/middleware.ts'
import { stripLocalPhotos } from '../sync/photos.ts'

/**
 * 旅行回忆的云端副本（F06）。
 *
 * 与行程不同，回忆是纯私人内容：读写都要求登录，没有匿名分支 —— 匿名时它本来就只存在
 * 本机 IndexedDB，云端这层根本没有对应行，放行只会返回空。
 *
 * 整份覆盖写（PUT）而不是字段级 PATCH：客户端持有的就是整份 TripMemory，逐字段合并
 * 需要先确定「同一地点两边都改过怎么办」，而这个问题没有正确答案（见 design.md §5）。
 */
export const memoryRoute = new Hono()

memoryRoute.use('*', requireUser)

memoryRoute.get('/:tripId', async (c) => {
  const actor = c.get('actor')
  if (!actor) return c.json({ error: '请先登录', code: 'unauthorized' }, 401)
  const [row] = await db
    .select()
    .from(tripMemories)
    .where(and(eq(tripMemories.tripId, c.req.param('tripId')), eq(tripMemories.userId, actor.userId)))
    .limit(1)
  return c.json({ item: row ? row.payload : null })
})

memoryRoute.put('/:tripId', async (c) => {
  const actor = c.get('actor')
  if (!actor) return c.json({ error: '请先登录', code: 'unauthorized' }, 401)
  const tripId = c.req.param('tripId')
  const body = (await c.req.json().catch(() => null)) as { payload?: unknown; updatedAt?: string } | null
  const payload = body?.payload
  if (!payload || typeof payload !== 'object') {
    return c.json({ error: '缺少 payload', code: 'bad_param' }, 400)
  }

  const now = new Date()
  const existing = await db
    .select({ updatedAt: tripMemories.updatedAt, userId: tripMemories.userId })
    .from(tripMemories)
    .where(eq(tripMemories.tripId, tripId))
    .limit(1)

  if (existing[0]) {
    // 跨账号写入视为无权访问，不泄露「这条行程回忆已存在」
    if (existing[0].userId !== actor.userId) {
      return c.json({ error: '无权访问', code: 'unauthorized' }, 401)
    }
    const incoming = body?.updatedAt ? new Date(body.updatedAt) : null
    if (incoming && incoming.getTime() < existing[0].updatedAt.getTime()) {
      return c.json({ error: '这台设备的数据比云端旧，请刷新后再改', code: 'stale_write' }, 409)
    }
    const clean = stripLocalPhotos(payload)
    await db
      .update(tripMemories)
      .set({ payload: clean as Record<string, unknown>, updatedAt: now })
      .where(eq(tripMemories.tripId, tripId))
    return c.json({ item: clean })
  }

  const clean = stripLocalPhotos(payload)
  await db.insert(tripMemories).values({
    tripId,
    userId: actor.userId,
    payload: clean as Record<string, unknown>,
    updatedAt: now
  })
  return c.json({ item: clean })
})
