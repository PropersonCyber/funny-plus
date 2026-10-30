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

/** 两次地点之间按直线距离折算耗时，仅用于排程估算；真实导航耗时接地图服务后替换 */
export const travelMinutes = (a: Place, b: Place, faster = false): number => {
  const base = Math.max(10, Math.round((distanceKm(a, b) / (faster ? 22 : 15)) * 60))
  return Math.ceil(base / 5) * 5
}
