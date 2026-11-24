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

/** 任何带坐标的点；设备定位与 Place 都满足 */
export type Point = { lng: number; lat: number }

export const distanceKm = (a: Place, b: Place): number => {
  const dLat = (a.lat - b.lat) * 111
  const dLng = (a.lng - b.lng) * 111 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180))
  return Math.round(Math.hypot(dLat, dLng) * 10) / 10
}

/**
 * 任一点 ↔ 地点 的距离（km）。
 *
 * `distanceKm` 只吃两个 Place，而现场场景手里只有一个设备坐标（`GeoPoint`），
 * 硬套就得先伪造一个 Place —— 那会把 lng/lat 之外的一堆必填字段填成假的。
 * 同一个近似公式单独开一个签名，精度口径与 `distanceKm` 完全一致。
 */
export const kmTo = (from: { lng: number; lat: number }, to: { lng: number; lat: number }): number => {
  const dLat = (from.lat - to.lat) * 111
  const dLng = (from.lng - to.lng) * 111 * Math.cos(((from.lat + to.lat) / 2) * (Math.PI / 180))
  return Math.round(Math.hypot(dLat, dLng) * 10) / 10
}

/** 离某点最近的 N 个地点，按距离升序；用于「我在这附近」这类候选检索 */
export const nearestTo = (point: { lng: number; lat: number }, pool: Place[], limit: number): { place: Place; km: number }[] =>
  pool
    .map((place) => ({ place, km: kmTo(point, place) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, Math.max(0, limit))

/** 耗时来源：区分「真问过地图服务」和「直线折算」，界面要如实标注，不能混成一个数字 */
export type TravelSource = 'route' | 'straight'

const routeCache = new Map<string, number>()

/**
 * 路段缓存键。
 *
 * 用 id 而不是坐标：id 比浮点坐标稳定，也短。
 * 但**设备定位点没有 id** —— 早期这里直接读 `a.id`，于是回程段（景点 → 用户当前位置）
 * 的键变成 `undefined>xxx`，真实耗时永远命中不了，界面也就永远显示直线估算，
 * 而用户以为那是导航结果。
 *
 * 没有 id 的点退化成坐标：`~lng,lat`。坐标按 5 位小数量化，
 * 避免 GPS 抖动导致每次调用都算一段「新路」—— 那会让缓存形同虚设、每次都要问地图服务。
 */
const pointKey = (p: Point): string => {
  const id = (p as { id?: string }).id
  if (typeof id === 'string' && id) return id
  const lng = Number.isFinite(p.lng) ? p.lng.toFixed(5) : '?'
  const lat = Number.isFinite(p.lat) ? p.lat.toFixed(5) : '?'
  return `~${lng},${lat}`
}

const routeKey = (a: Point, b: Point, faster: boolean): string =>
  `${pointKey(a)}>${pointKey(b)}>${faster ? 'f' : 's'}`

/**
 * 真实路线耗时由调用方预先取好再灌进来（引擎是同步纯函数，不能自己去 await）。
 * 没灌到的路段自然退回直线折算，所以取数失败不会让整个方案生成失败。
 *
 * 传 id 或坐标点都行：回程段（景点 → 用户当前位置）没有 id，
 * 只能按坐标灌 —— 只支持 id 的话，那段永远是估算。
 */
export function setRouteMinutes(a: string | Point, b: string | Point, faster: boolean, minutes: number): void {
  if (!Number.isFinite(minutes) || minutes <= 0) return
  const key = (p: string | Point): string => (typeof p === 'string' ? p : pointKey(p))
  routeCache.set(`${key(a)}>${key(b)}>${faster ? 'f' : 's'}`, Math.round(minutes))
}

export function clearRouteMinutes(): void {
  routeCache.clear()
}

/** 这一段有没有拿到真实耗时；界面用它决定标注「估算」与否 */
export const hasRoute = (a: Point, b: Point, faster = false): boolean =>
  routeCache.has(routeKey(a, b, faster))

/**
 * 两点之间的耗时。优先用地图服务的真实路线时长；没有就按直线距离折算。
 * 折算那档只是占位，别对外当成导航结果——界面上要标「估算」。
 */
export const travelMinutes = (a: Point, b: Point, faster = false): number => {
  const hit = routeCache.get(routeKey(a, b, faster))
  if (hit !== undefined) return hit
  const base = Math.max(10, Math.round((kmTo(a, b) / (faster ? 22 : 15)) * 60))
  return Math.ceil(base / 5) * 5
}
