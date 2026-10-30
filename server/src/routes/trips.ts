import { Hono } from 'hono'
import { eq, isNull, or } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { tripVersions, trips } from '../db/schema.ts'
import type { SavedTrip } from '@/types/index.ts'

export const tripsRoute = new Hono()

// 只读：内置示例（client_id 为空）+ 指定测试账号预置的行程。
// 用户自己保存的行程还在本机，这版不做云端写入。
tripsRoute.get('/', async (c) => {
  const clientId = c.req.query('clientId')
  const rows = await db
    .select()
    .from(trips)
    .where(clientId ? or(isNull(trips.clientId), eq(trips.clientId, clientId)) : isNull(trips.clientId))
    .orderBy(trips.id)
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
