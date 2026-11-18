import { amap, amapSign } from '../env.ts'
import { hasRoute, placesOf, setRouteMinutes, travelMinutes } from '@/engine/placeIndex.ts'
import type { Demand, Place, Plan } from '@/types/index.ts'

/**
 * 服务端取真实路段耗时（G1）。
 *
 * 为什么服务端要自己取一遍：`planner` 是同步纯函数，路段耗时必须异步拿。客户端
 * （`lynx/src/travel.ts`）的做法是「先按直线跑一遍拿顺序 → 取真实耗时 → 重算一遍」，
 * 服务端对话路径从来没做过这段，于是同一句需求经对话和经表单生成，路上时间不一致。
 *
 * 为什么直接打高德而不回环调自己的 /api/geo/direction：那是给自己发一次 HTTP 请求，
 * 多一次序列化、多一次鉴权、还多一个失败点，而缓存就在下面这份 Map 里。
 *
 * 拿不到就留空：调用方继续用直线折算并标 `straight`，不编数字。
 */

const AMAP_BASE = 'https://restapi.amap.com'
const UPSTREAM_TIMEOUT_MS = 6000
/** 一批几个段。一次全发给高德会撞并发限制，和客户端保持同一个值 */
const BATCH = 4

type CacheEntry = { at: number; minutes: number }
const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
/** 缓存键含 mode：步行和驾车是两条不同的时间 */
const keyOf = (a: Place, b: Place, mode: RouteMode) => `${mode}:${a.lng},${a.lat}>${b.lng},${b.lat}`

export type RouteMode = 'driving' | 'walking'

/** 交通方式 → 高德路线接口。公交要 city 参数还要处理接驳，先不接，缺这一段退回直线估算 */
export const routeModeOf = (transport: Demand['transport']): RouteMode =>
  transport === 'public' ? 'walking' : 'driving'

/** 单段真实耗时（分钟）。未配置 / 服务不可用 / 无路可走都返回 null */
export async function fetchRouteMinutes(a: Place, b: Place, mode: RouteMode): Promise<number | null> {
  if (!amap.configured()) return null
  const key = keyOf(a, b, mode)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at <= CACHE_TTL_MS) return hit.minutes

  const params: Record<string, string> = {
    key: amap.key,
    origin: `${a.lng},${a.lat}`,
    destination: `${b.lng},${b.lat}`
  }
  if (amap.signed()) params.sig = amapSign(params)

  const url = `${AMAP_BASE}/v3/direction/${mode}?${new URLSearchParams(params)}`
  const res = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) }).catch(() => null)
  if (!res) return null
  const body = (await res.json().catch(() => null)) as
    | { status?: string; route?: { paths?: { duration?: string }[] } }
    | null
  if (!body || body.status !== '1') return null

  const durationS = Number(body.route?.paths?.[0]?.duration ?? 0)
  // 高德会回 status=1 但 duration 为 0（两点间无路）：那不是「就在旁边」，是没结果
  if (!Number.isFinite(durationS) || durationS <= 0) return null
  // 向上取整：宁可多留一分钟缓冲，也别让用户按秒赶
  const minutes = Math.max(1, Math.ceil(durationS / 60))
  if (cache.size >= 800) cache.clear()
  cache.set(key, { at: Date.now(), minutes })
  return minutes
}

/** 从方案里取相邻路段。和 lynx/src/legs.ts 同一口径：只取同一天相邻两个地点 */
function legsOf(plans: Plan[], byId: Map<string, Place>): [Place, Place][] {
  const seen = new Set<string>()
  const out: [Place, Place][] = []
  for (const plan of plans) {
    for (const day of plan.days) {
      const stops = day.items
        .filter((i) => i.kind === 'place' && i.placeId)
        .map((i) => byId.get(i.placeId!))
      for (let i = 1; i < stops.length; i++) {
        const a = stops[i - 1]
        const b = stops[i]
        if (!a || !b) continue
        const k = `${a.id}>${b.id}`
        if (seen.has(k)) continue
        seen.add(k)
        out.push([a, b])
      }
    }
  }
  return out
}

export type WarmResult = { asked: number; hit: number }

/**
 * 把这些方案的相邻路段耗时灌进引擎，之后重跑 `generatePlans` 就会用真实值。
 *
 * 第一遍只用来拿到「会用到哪些段」——排序看的是直线距离，所以第一遍的顺序
 * 就是最终顺序，第二遍只有路上时间变准。
 */
export async function warmRoutes(demand: Demand, plans: Plan[]): Promise<WarmResult> {
  const byId = new Map(placesOf(demand.destination).map((p) => [p.id, p]))
  const legs = legsOf(plans, byId)
  if (legs.length === 0) return { asked: 0, hit: 0 }

  const mode = routeModeOf(demand.transport)
  // 引擎里 routeCache 的键带 faster，与 planner 调用 travelMinutes 时传的第三参必须一致
  const faster = demand.transport !== 'public'
  let hit = 0

  for (let i = 0; i < legs.length; i += BATCH) {
    const chunk = legs.slice(i, i + BATCH)
    const got = await Promise.all(
      chunk.map(async ([a, b]) => {
        // 已经有了就不重复要：静态图与路径规划共用配额
        if (hasRoute(a, b, faster)) return true
        const minutes = await fetchRouteMinutes(a, b, mode)
        if (minutes === null) return false
        setRouteMinutes(a.id, b.id, faster, minutes)
        return true
      })
    )
    hit += got.filter(Boolean).length
    // 第一批就全军覆没（没配 key / 断网 / 限流）：别把剩下的段继续打满
    if (i === 0 && got.every((ok) => !ok)) break
  }

  return { asked: legs.length, hit }
}

/** 供测试与排查：某段现在引擎里算出来的耗时，以及它是不是真实值 */
export const legMinutesOf = (a: Place, b: Place, faster: boolean): { minutes: number; real: boolean } => ({
  minutes: travelMinutes(a, b, faster),
  real: hasRoute(a, b, faster)
})
