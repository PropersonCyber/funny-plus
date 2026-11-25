import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { places } from '../db/schema.ts'
import { loadFieldEvidence } from '../data/fieldEvidenceQuery.ts'
import type { FieldEvidence, Place } from '@/types/index.ts'

/**
 * 库里的行 → 前端契约：open 还原成 [开始, 结束] 元组，其余同名。
 *
 * `evidence` 是这一格的字段级依据。没有就不带这个键（而不是带一个空数组）：
 * 空数组与缺省在类型上同义，但真序列化出去会让前端以为「查过了、只是没有」。
 */
export const toApi = (r: typeof places.$inferSelect, evidence?: FieldEvidence[]): Place => ({
  id: r.id,
  name: r.name,
  city: r.city,
  lng: r.lng,
  lat: r.lat,
  open: [r.openStart, r.openEnd],
  openText: r.openText ?? undefined,
  closedWeekdays: r.closedWeekdays ?? [],
  closedRanges: r.closedRanges ?? undefined,
  seasons: r.seasons ?? undefined,
  ticket: r.ticket,
  stayMin: r.stayMin,
  walk: r.walk as Place['walk'],
  tags: r.tags,
  rating: r.rating,
  visitors: r.visitors,
  hype: r.hype ?? undefined,
  source: r.source,
  verifiedAt: r.verifiedAt ?? undefined,
  trust: r.trust,
  ...(evidence?.length ? { fieldEvidence: evidence } : {})
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
  // 依据一次性批量取回，避免逐条查
  const evidence = await loadFieldEvidence('place')
  return c.json({ items: rows.map((r) => toApi(r, evidence.get(r.id))) })
})
