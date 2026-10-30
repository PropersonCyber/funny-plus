import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { places } from '../db/schema.ts'
import type { Place } from '@/types/index.ts'

/** 库里的行 → 前端契约：open 还原成 [开始, 结束] 元组，其余同名 */
const toApi = (r: typeof places.$inferSelect): Place => ({
  id: r.id,
  name: r.name,
  city: r.city,
  lng: r.lng,
  lat: r.lat,
  open: [r.openStart, r.openEnd],
  ticket: r.ticket,
  stayMin: r.stayMin,
  walk: r.walk as Place['walk'],
  tags: r.tags
})

export const placesRoute = new Hono()

// 前端启动时整池拉一次做预热（placeIndex 需要同步索引），所以不提供分页
placesRoute.get('/', async (c) => {
  const city = c.req.query('city')
  const rows = await db
    .select()
    .from(places)
    .where(city ? eq(places.city, city) : undefined)
    .orderBy(places.id)
  return c.json({ items: rows.map(toApi) })
})
