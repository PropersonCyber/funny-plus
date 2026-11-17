import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { lines } from '../db/schema.ts'
import type { TransitLine } from '@/types/index.ts'

/**
 * 线路（FR-01）。
 *
 * 全量返回、不过滤：数量级是几十条，前端启动时随 /api/content 一起预热一次，
 * 之后引擎里的线路索引就是唯一来源。分页在这里只会让「排行程时缺一条线」变成偶发 bug。
 */
export const lineToApi = (r: typeof lines.$inferSelect): TransitLine => ({
  id: r.id,
  city: r.city,
  name: r.name,
  mode: r.mode,
  stops: r.stops,
  firstBus: r.firstBus ?? null,
  lastBus: r.lastBus ?? null,
  intervalMin: r.intervalMin ?? null,
  tickets: r.tickets,
  needAdvance: r.needAdvance ?? null,
  capacity: r.capacity ?? null,
  rideMin: r.rideMin ?? null,
  seasonNote: r.seasonNote ?? undefined,
  rideAtPlaceId: r.rideAtPlaceId ?? undefined,
  source: r.source,
  sourceUrl: r.sourceUrl ?? undefined,
  verifiedAt: r.verifiedAt ?? undefined,
  trust: r.trust,
  isDemo: r.isDemo
})

export const linesRoute = new Hono()

linesRoute.get('/', async (c) => {
  const city = c.req.query('city')
  const rows = await db
    .select()
    .from(lines)
    .where(city ? eq(lines.city, city) : undefined)
    .orderBy(lines.city, lines.id)
  return c.json({ items: rows.map(lineToApi) })
})
