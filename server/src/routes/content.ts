import { Hono } from 'hono'
import { asc } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { cities, facts, guides, places, playPlaces, plays } from '../db/schema.ts'
import { factWithTrust, feedbackStats } from './facts.ts'
import { toApi as placeToApi } from './places.ts'
import { loadFieldEvidence } from '../data/fieldEvidenceQuery.ts'
import type { City, Guide, Play } from '@/types/index.ts'

export const contentRoute = new Hono()

/**
 * 一次性给全首屏要用的参照数据：城市 / 地点池 / 避坑 / 攻略 / 玩法。
 * 分接口拉会让 Lynx 冷启动多三四个 RTT，而这几张表都是几十条量级。
 */
contentRoute.get('/', async (c) => {
  const [cityRows, placeRows, factRows, guideRows, playRows, linkRows, factStats, placeEvidence] = await Promise.all([
    db.select().from(cities).orderBy(asc(cities.sortOrder)),
    db.select().from(places).orderBy(asc(places.id)),
    db.select().from(facts).orderBy(asc(facts.id)),
    db.select().from(guides).orderBy(asc(guides.id)),
    db.select().from(plays).orderBy(asc(plays.sortOrder)),
    db.select().from(playPlaces).orderBy(asc(playPlaces.sortOrder)),
    // 避坑的可信度必须和 GET /api/facts 同口径：这个入口同样把 facts 发给客户端，
    // 直接用库里的 trust 就会让同一条避坑在两个接口上给出两个可信度
    feedbackStats(),
    loadFieldEvidence('place')
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
    // 与 /api/places 共用同一个序列化器：两份 toPlace 各改一半，界面内容和地点池就对不上了
    places: placeRows.map((r) => placeToApi(r, placeEvidence.get(r.id))),
    facts: factRows.map((r) => factWithTrust(r, factStats)),
    guides: guideItems,
    plays: playItems
  })
})
