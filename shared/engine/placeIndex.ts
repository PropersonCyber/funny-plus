import type { Place } from '@/types'

// 地点池来自 GET /api/places，启动时预热一次。引擎全是同步纯函数，
// 所以这里做成「先注入再计算」：没有预热就没有地点，generatePlans 会明确报错而不是静默出空方案。
let index = new Map<string, Place>()
let loaded = false

export function setPlaces(list: Place[]): void {
  index = new Map(list.map((p) => [p.id, p]))
  loaded = true
}

export const placesLoaded = (): boolean => loaded

export const placesOf = (city: string): Place[] => [...index.values()].filter((p) => p.city === city)

// 行程项只存 placeId，回查地名/坐标统一走这里，避免各处重复 filter。
export const placeById = (id: string): Place | undefined => index.get(id)

export const distanceKm = (a: Place, b: Place): number => {
  const dLat = (a.lat - b.lat) * 111
  const dLng = (a.lng - b.lng) * 111 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180))
  return Math.round(Math.hypot(dLat, dLng) * 10) / 10
}

/** 耗时来源：区分「真问过地图服务」和「直线折算」，界面要如实标注，不能混成一个数字 */
export type TravelSource = 'route' | 'straight'

const routeCache = new Map<string, number>()

const routeKey = (a: Place, b: Place, faster: boolean): string => `${a.id}>${b.id}>${faster ? 'f' : 's'}`

/**
 * 真实路线耗时由调用方预先取好再灌进来（引擎是同步纯函数，不能自己去 await）。
 * 没灌到的路段自然退回直线折算，所以取数失败不会让整个方案生成失败。
 */
export function setRouteMinutes(a: string, b: string, faster: boolean, minutes: number): void {
  if (Number.isFinite(minutes) && minutes > 0) routeCache.set(`${a}>${b}>${faster ? 'f' : 's'}`, Math.round(minutes))
}

export function clearRouteMinutes(): void {
  routeCache.clear()
}

/** 这一段有没有拿到真实耗时；界面用它决定标注「估算」与否 */
export const hasRoute = (a: Place, b: Place, faster = false): boolean =>
  routeCache.has(routeKey(a, b, faster))

/**
 * 两点之间的耗时。优先用地图服务的真实路线时长；没有就按直线距离折算。
 * 折算那档只是占位，别对外当成导航结果——界面上要标「估算」。
 */
export const travelMinutes = (a: Place, b: Place, faster = false): number => {
  const hit = routeCache.get(routeKey(a, b, faster))
  if (hit !== undefined) return hit
  const base = Math.max(10, Math.round((distanceKm(a, b) / (faster ? 22 : 15)) * 60))
  return Math.ceil(base / 5) * 5
}
