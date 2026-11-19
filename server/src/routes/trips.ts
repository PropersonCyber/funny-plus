import { Hono } from 'hono'
import { and, eq, isNull, or } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { tripVersions, trips } from '../db/schema.ts'
import { optionalUser, requireUser } from '../auth/middleware.ts'
import type { ChangeImpact, Demand, Plan, SavedTrip } from '@/types/index.ts'

/**
 * 行程读写（F06，G5 补齐上云范围）。
 *
 * 读取保持匿名可用：产品口径是「登录只挡云同步与跨设备找回，不挡浏览与规划」，
 * 所以 GET 走 optionalUser；未登录只能看到内置示例（client_id 为空）与自己 clientId 名下的。
 *
 * 写入必须登录：没有账号就没有可跨设备找回的归属，「匿名写云端」会让同一条行程
 * 在登录前后分裂成两份。本机保存不经过这里。
 *
 * 上云范围是这一版的重点：只推「当前选中的那一套」等于「存了 3 份、换设备只剩 1 份」，
 * 承诺了能找回却找不回，比不承诺更伤。所以 plans / planIndex / endedAt 一起上。
 */
export const tripsRoute = new Hono()

/** 写入体的形状；plans 与 plan 至少给一个（plan 是给旧客户端的兜底） */
type PutBody = {
  demand?: Demand
  plans?: Plan[]
  /** 旧协议：只有选中的那一套 */
  plan?: Plan
  planIndex?: number
  endedAt?: string | null
  savedAt?: string
  versions?: { at: string; note: string; impact?: ChangeImpact }[]
  clientId?: string
}

const isPlan = (p: unknown): p is Plan => {
  const v = p as Plan | null
  return !!v && typeof v.id === 'string' && Array.isArray(v.days) && !!v.budget
}

/** 方案数组归一化：非法项丢掉，全丢就退回 plan，再不行返回 null */
function normalizePlans(body: PutBody): Plan[] | null {
  const list = Array.isArray(body.plans) ? body.plans.filter(isPlan) : []
  if (list.length) return list
  if (isPlan(body.plan)) return [body.plan]
  return null
}

/** 选中项钳到合法范围：越界会让前端渲染时拿到 undefined，比默默用第一套更糟 */
function clampIndex(index: unknown, len: number): number {
  const n = typeof index === 'number' && Number.isFinite(index) ? Math.floor(index) : 0
  return Math.min(Math.max(0, n), Math.max(0, len - 1))
}

/** 客户端时间戳；解析不了就用现在，不因为一条时间写错丢掉整次同步 */
function parseAt(raw: unknown, fallback: Date): Date {
  if (typeof raw !== 'string') return fallback
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? fallback : d
}

type Row = typeof trips.$inferSelect

function toSavedTrip(r: Row, versions: { at: Date; note: string; impact: ChangeImpact | null }[]): SavedTrip {
  // 旧行没有 plans 列：用 plan 兜一份，否则这些行程会在新客户端上直接消失
  const plans = Array.isArray(r.plans) && r.plans.length ? r.plans : [r.plan]
  return {
    id: r.id,
    demand: r.demand,
    plans,
    planIndex: clampIndex(r.planIndex ?? 0, plans.length),
    savedAt: r.savedAt.toISOString(),
    versions: versions
      .filter((v) => v.at)
      .map((v) => ({ at: v.at.toISOString(), note: v.note, impact: v.impact ?? undefined })),
    ...(r.endedAt ? { endedAt: r.endedAt.toISOString() } : {})
  }
}

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

  const items: SavedTrip[] = rows.map((r) =>
    toSavedTrip(
      r,
      versions.filter((v) => v.tripId === r.id).map((v) => ({ at: v.at, note: v.note, impact: v.impact }))
    )
  )
  return c.json({ items })
})

/**
 * 整份覆盖写：客户端持有的就是整条 SavedTrip，不做字段级合并（见 design.md §5）。
 *
 * 变更记录（trip_versions）用「先删后插」整份替换，而不是逐条 diff：
 * 行程版本只有几十条，diff 的复杂度和出错概率都不值得。放在一个事务里，
 * 否则删完还没插的窗口里读到的会是「没有任何变更记录」。
 */
tripsRoute.put('/:id', requireUser, async (c) => {
  const actor = c.get('actor')
  if (!actor) return c.json({ error: '请先登录', code: 'unauthorized' }, 401)
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => null)) as PutBody | null

  const plans = body ? normalizePlans(body) : null
  if (!body?.demand || !plans) {
    return c.json({ error: '缺少 demand 或 plans', code: 'bad_param' }, 400)
  }
  const planIndex = clampIndex(body.planIndex, plans.length)
  const picked = plans[planIndex] ?? plans[0]!
  const clientId = typeof body.clientId === 'string' && body.clientId ? body.clientId : null
  const now = new Date()

  const [existing] = await db.select({ userId: trips.userId }).from(trips).where(eq(trips.id, id)).limit(1)
  // 内置示例（user_id 与 client_id 都为空）不允许被覆盖，否则一个账号能改掉所有人看到的示例
  if (existing && existing.userId !== actor.userId) {
    return c.json({ error: '无权修改这条行程', code: 'unauthorized' }, 401)
  }

  const savedAt = parseAt(body.savedAt, now)
  const endedAt = typeof body.endedAt === 'string' && body.endedAt ? parseAt(body.endedAt, now) : null
  // 变更记录只收有 note 的：note 为空的版本在界面上就是一条空白行，没有信息量
  const cleanVersions = Array.isArray(body.versions)
    ? body.versions.filter((v) => v && typeof v.note === 'string' && v.note).slice(-200)
    : []
  const versions = cleanVersions.map((v) => ({
    id: crypto.randomUUID(),
    tripId: id,
    note: v.note,
    impact: v.impact ?? null
  }))

  await db.transaction(async (tx) => {
    if (existing) {
      await tx
        .update(trips)
        .set({ demand: body.demand!, plan: picked, plans, planIndex, endedAt, savedAt })
        .where(eq(trips.id, id))
    } else {
      await tx
        .insert(trips)
        .values({ id, clientId, userId: actor.userId, demand: body.demand!, plan: picked, plans, planIndex, endedAt, savedAt })
    }
    await tx.delete(tripVersions).where(eq(tripVersions.tripId, id))
    if (versions.length) await tx.insert(tripVersions).values(versions)
  })

  // 直接回本行的投影，不去复用 toSavedTrip：那条路要求先拼一个假的 Row，
  // 为了少写六行而造一个类型断言不值的
  const item: SavedTrip = {
    id,
    demand: body.demand!,
    plans,
    planIndex,
    savedAt: savedAt.toISOString(),
    versions: cleanVersions.map((v) => ({ at: v.at, note: v.note, impact: v.impact })),
    ...(endedAt ? { endedAt: endedAt.toISOString() } : {})
  }
  return c.json({ item })
})