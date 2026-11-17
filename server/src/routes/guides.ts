import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { guideDrafts } from '../db/schema.ts'
import { requireUser } from '../auth/middleware.ts'
import { stripLocalPhotos } from '../sync/photos.ts'

/**
 * 攻略草稿的云端副本（F06）。与回忆同构，区别只有主键语义：
 * 回忆与行程一一对应（tripId 作主键），草稿与行程可以一对多（同一行程重新生成会换 id）。
 */
export const guideRoute = new Hono()

guideRoute.use('*', requireUser)

guideRoute.get('/:id', async (c) => {
  const actor = c.get('actor')
  if (!actor) return c.json({ error: '请先登录', code: 'unauthorized' }, 401)
  const [row] = await db
    .select()
    .from(guideDrafts)
    .where(and(eq(guideDrafts.id, c.req.param('id')), eq(guideDrafts.userId, actor.userId)))
    .limit(1)
  return c.json({ item: row ? row.payload : null })
})

guideRoute.put('/:id', async (c) => {
  const actor = c.get('actor')
  if (!actor) return c.json({ error: '请先登录', code: 'unauthorized' }, 401)
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => null)) as
    | { payload?: unknown; updatedAt?: string; tripId?: string }
    | null
  const payload = body?.payload
  if (!payload || typeof payload !== 'object') {
    return c.json({ error: '缺少 payload', code: 'bad_param' }, 400)
  }
  const tripId =
    typeof body?.tripId === 'string' && body.tripId
      ? body.tripId
      : typeof (payload as { tripId?: unknown }).tripId === 'string'
        ? ((payload as { tripId: string }).tripId as string)
        : ''
  if (!tripId) return c.json({ error: '缺少 tripId', code: 'bad_param' }, 400)

  const now = new Date()
  const [existing] = await db
    .select({ updatedAt: guideDrafts.updatedAt, userId: guideDrafts.userId })
    .from(guideDrafts)
    .where(eq(guideDrafts.id, id))
    .limit(1)

  if (existing) {
    if (existing.userId !== actor.userId) {
      return c.json({ error: '无权访问', code: 'unauthorized' }, 401)
    }
    const incoming = body?.updatedAt ? new Date(body.updatedAt) : null
    if (incoming && incoming.getTime() < existing.updatedAt.getTime()) {
      return c.json({ error: '这台设备的数据比云端旧，请刷新后再改', code: 'stale_write' }, 409)
    }
    const clean = stripLocalPhotos(payload)
    await db
      .update(guideDrafts)
      .set({ payload: clean as Record<string, unknown>, tripId, updatedAt: now })
      .where(eq(guideDrafts.id, id))
    return c.json({ item: clean })
  }

  const clean = stripLocalPhotos(payload)
  await db.insert(guideDrafts).values({
    id,
    userId: actor.userId,
    tripId,
    payload: clean as Record<string, unknown>,
    updatedAt: now
  })
  return c.json({ item: clean })
})
