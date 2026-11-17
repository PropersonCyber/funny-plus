import { Hono } from 'hono'
import { and, eq, isNull, or } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { tripVersions, trips } from '../db/schema.ts'
import { optionalUser, requireUser } from '../auth/middleware.ts'
import type { Demand, Plan, SavedTrip } from '@/types/index.ts'

/**
 * 行程读写（F06）。
 *
 * 读取保持匿名可用：产品口径是「登录只挡云同步与跨设备找回，不挡浏览与规划」，
 * 所以 GET 走 optionalUser；未登录只能看到内置示例（client_id 为空）与自己 clientId 名下的。
 *
 * 写入必须登录：没有账号就没有可跨设备找回的归属，「匿名写云端」会让同一条行程
 * 在登录前后分裂成两份。本机保存不经过这里。
 */
export const tripsRoute = new Hono()

tripsRoute.get('/', optionalUser, async (c) => {
  const actor = c.get('actor')
  const clientId = c.req.query('clientId')

  // 登录后要同时覆盖两类行：账号名下的，以及本机尚未并账的（user_id 为空 + 自己的 clientId）
  const scope = actor
    ? or(
        isNull(trips.clientId),
        eq(trips.userId, actor.userId),
        clientId ? and(isNull(trips.userId), eq(trips.clientId, clientId)) : undefined
      )
    : clientId
      ? or(isNull(trips.clientId), eq(trips.clientId, clientId))
      : isNull(trips.clientId)

  const rows = await db.select().from(trips).where(scope).orderBy(trips.id)
  const versions = await db.select().from(tripVersions).orderBy(tripVersions.at)

  const items: SavedTrip[] = rows.map((r) => ({
    id: r.id,
    demand: r.demand,
    plan: r.plan,
    savedAt: r.savedAt.toISOString(),
    versions: versions
      .filter((v) => v.tripId === r.id)
      .map((v) => ({ at: v.at.toISOString(), note: v.note, impact: v.impact ?? undefined }))
  }))
  return c.json({ items })
})

/** 整份覆盖写：客户端持有的就是整条 SavedTrip，不做字段级合并（见 design.md §5） */
tripsRoute.put('/:id', requireUser, async (c) => {
  const actor = c.get('actor')
  if (!actor) return c.json({ error: '请先登录', code: 'unauthorized' }, 401)
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => null)) as
    | { demand?: Demand; plan?: Plan; clientId?: string }
    | null
  if (!body?.demand || !body?.plan) {
    return c.json({ error: '缺少 demand 或 plan', code: 'bad_param' }, 400)
  }
  const clientId = typeof body.clientId === 'string' && body.clientId ? body.clientId : null

  const [existing] = await db.select({ userId: trips.userId }).from(trips).where(eq(trips.id, id)).limit(1)
  // 内置示例（user_id 与 client_id 都为空）不允许被覆盖，否则一个账号能改掉所有人看到的示例
  if (existing && existing.userId !== actor.userId) {
    return c.json({ error: '无权修改这条行程', code: 'unauthorized' }, 401)
  }

  const now = new Date()
  if (existing) {
    await db.update(trips).set({ demand: body.demand, plan: body.plan, savedAt: now }).where(eq(trips.id, id))
  } else {
    await db.insert(trips).values({ id, clientId, userId: actor.userId, demand: body.demand, plan: body.plan, savedAt: now })
  }
  return c.json({ item: { id, demand: body.demand, plan: body.plan, savedAt: now.toISOString(), versions: [] } })
})
