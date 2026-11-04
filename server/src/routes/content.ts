import { Hono } from 'hono'
import { asc } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { cities, facts, guides, places, playPlaces, plays } from '../db/schema.ts'
import type { City, Guide, Place, Play, TravelFact } from '@/types/index.ts'

const toPlace = (r: typeof places.$inferSelect): Place => ({
  id: r.id,
  name: r.name,
  city: r.city,
  lng: r.lng,
  lat: r.lat,
  open: [r.openStart, r.openEnd],
  ticket: r.ticket,
  stayMin: r.stayMin,
  walk: r.walk as Place['walk'],
  tags: r.tags,
  rating: r.rating,
  visitors: r.visitors,
  hype: r.hype ?? undefined,
  source: r.source,
  verifiedAt: r.verifiedAt ?? undefined,
  trust: r.trust
})

const toFact = (r: typeof facts.$inferSelect): TravelFact => ({
  id: r.id,
  city: r.city,
  category: r.category as TravelFact['category'],
  content: r.content,
  scope: r.scope,
  source: r.source,
  sourceUrl: r.sourceUrl ?? undefined,
  verifiedAt: r.verifiedAt,
  validUntil: r.validUntil ?? undefined,
  trust: r.trust
})

export const contentRoute = new Hono()

/**
 * 一次性给全首屏要用的参照数据：城市 / 地点池 / 避坑 / 攻略 / 玩法。
 * 分接口拉会让 Lynx 冷启动多三四个 RTT，而这几张表都是几十条量级。
 */
contentRoute.get('/', async (c) => {
  const [cityRows, placeRows, factRows, guideRows, playRows, linkRows] = await Promise.all([
    db.select().from(cities).orderBy(asc(cities.sortOrder)),
    db.select().from(places).orderBy(asc(places.id)),
    db.select().from(facts).orderBy(asc(facts.id)),
    db.select().from(guides).orderBy(asc(guides.id)),
    db.select().from(plays).orderBy(asc(plays.sortOrder)),
    db.select().from(playPlaces).orderBy(asc(playPlaces.sortOrder))
  ])

  const cityItems: City[] = cityRows.map((r) => ({
    id: r.id,
    tag: r.tag,
    coverImage: r.coverImage,
    priceFrom: r.priceFrom,
    rating: r.rating,
    visitedText: r.visitedText,
    desc: r.desc,
    days: r.days,
    tips: r.tips,
    isOpen: r.isOpen,
    sortOrder: r.sortOrder
  }))

  const guideItems: Guide[] = guideRows.map((r) => ({
    id: r.id,
    city: r.city,
    title: r.title,
    note: r.note,
    coverImage: r.coverImage,
    views: r.views,
    dayCount: r.dayCount,
    tags: r.tags,
    rating: r.rating,
    badges: r.badges,
    placeIds: r.placeIds,
    body: r.body
  }))

  const playItems: Play[] = playRows.map((r) => ({
    id: r.id,
    title: r.title,
    note: r.note,
    coverImage: r.coverImage,
    city: r.city,
    label: r.label,
    days: r.days,
    chips: r.chips,
    sortOrder: r.sortOrder,
    placeIds: linkRows.filter((l) => l.playId === r.id).map((l) => l.placeId)
  }))

  return c.json({
    cities: cityItems,
    places: placeRows.map(toPlace),
    facts: factRows.map(toFact),
    guides: guideItems,
    plays: playItems
  })
})
