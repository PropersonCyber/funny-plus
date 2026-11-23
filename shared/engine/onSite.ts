import type { ItineraryItem, Place, Plan, TransitLine, TripDay } from '@/types'
import { kmTo, placeById } from '@/engine/placeIndex'
import { linesAtPlace, lineById } from '@/engine/lines'

/**
 * 到达判定（F04 3.3 三分支）。
 *
 * 产品口径：「定位推断与用户确认分开记录」「定位不可用时不假定到达」。
 * 所以这里只算「**能不能**判定」，不替用户下结论：
 * 精度不够、坐标缺失、超时过期，一律返回 `unknown` 并给出原因，让界面去问用户，
 * 绝不把「大概在附近」说成「已到达」—— 用户按这句话做决定，走错了是我们造成的。
 */

/** 默认到达半径 300 米：博物馆门口与街道对面的差别就在这个量级 */
export const DEFAULT_ARRIVAL_RADIUS_M = 300
/**
 * 定位精度阈值（米）。超过它就不判到达。
 *
 * 500 米是「一条街」的量级：精度比这还差时，300 米的到达半径完全被误差吞掉，
 * 判出来的「到了」和抛硬币差不多。iOS 壳目前给的是公里级精度（kCLLocationAccuracyKilometer），
 * 这条阈值会直接把它挡在 `low-accuracy` 上 —— 这是对的，宁可问用户，也不要乱报到达。
 */
export const ACCURACY_LIMIT_M = 500

export type ArrivalState =
  /** 在范围内且精度达标：可以认定到达 */
  | { kind: 'arrived'; place: Place; distanceM: number }
  /** 坐标有了、也够准，但不在任何一个计划点附近 */
  | { kind: 'elsewhere'; distanceM: number; nearest: Place }
  /** 定位不可用 / 过期 / 被拒：不假定到达 */
  | { kind: 'unknown'; reason: 'no-fix' | 'stale' | 'denied' | 'low-accuracy' | 'no-plan'; accuracyM?: number }

export type Fix = { lng: number; lat: number; accuracy?: number; at?: number }

/** 定位快照超过这么久就不参与判定（与 geo.ts 的 STALE_MS 同口径，5 分钟） */
const STALE_MS = 5 * 60 * 1000

/**
 * 判定用户此刻是否在某个已计划的点上。
 *
 * `dayItems` 传当前这一天的安排：判定「到没到」只该看今天要去的地方，
 * 拿整趟行程的点去比，第 1 天站在第 3 天的景点门口也会被判成「到了」。
 */
export function arrivalAt(
  dayItems: ItineraryItem[],
  fix: Fix | null,
  opts: { now?: number } = {}
): ArrivalState {
  const planned = dayItems.filter((i) => i.kind === 'place' && i.placeId).map((i) => placeById(i.placeId!)).filter((p): p is Place => !!p)
  if (!planned.length) return { kind: 'unknown', reason: 'no-plan' }
  if (!fix) return { kind: 'unknown', reason: 'no-fix' }

  const now = opts.now ?? Date.now()
  // 过期快照不能当「此刻在哪」用：五分钟前的坐标足够让人走到另一个街区
  if (fix.at && now - fix.at > STALE_MS) return { kind: 'unknown', reason: 'stale' }
  const accuracy = fix.accuracy
  if (accuracy !== undefined && accuracy > ACCURACY_LIMIT_M) {
    return { kind: 'unknown', reason: 'low-accuracy', accuracyM: Math.round(accuracy) }
  }

  let best: { place: Place; distanceM: number } | null = null
  for (const place of planned) {
    const km = kmTo(fix, place)
    const distanceM = Math.round(km * 1000)
    if (!best || distanceM < best.distanceM) best = { place, distanceM }
    const radius = place.radiusM ?? DEFAULT_ARRIVAL_RADIUS_M
    if (distanceM <= radius) return { kind: 'arrived', place, distanceM }
  }
  // best 一定存在：planned 已过滤空值
  return { kind: 'elsewhere', distanceM: best!.distanceM, nearest: best!.place }
}

/**
 * 到达后能看什么：这个点挂着的避坑/进出条目。
 *
 * 「吃 / 拍 / 买」在数据里是 0 条（`facts.json` 只有 pitfall / access），
 * 所以这里**只返回真实存在的两类**，并明确告诉调用方缺哪几类 ——
 * 编一条「附近有家好吃的」比什么都不给更糟，用户会照着去找。
 */
export type NearbyTidbit = { id: string; group: 'pitfall' | 'access'; content: string; source: string }

export function nearbyTidbits(all: { id: string; placeId?: string; poiGroup?: string; content: string; source: string }[], placeId: string): {
  items: NearbyTidbit[]
  missing: ('eat' | 'photo' | 'buy')[]
} {
  const items = all
    .filter((f) => f.placeId === placeId && (f.poiGroup === 'pitfall' || f.poiGroup === 'access'))
    .map((f) => ({ id: f.id, group: f.poiGroup as 'pitfall' | 'access', content: f.content, source: f.source }))
  // 三类的缺失是固定事实（数据侧为 0），不是「这次没查到」。写死成常量比每次算更诚实
  return { items, missing: ['eat', 'photo', 'buy'] }
}

/**
 * 下一站：当前点之后，还没去过的那一站，以及能不能坐线路交通到。
 *
 * 只做**已有数据能支撑的结论**：
 * - 有线路覆盖且首末班核验过 → 给出发车时刻与耗时
 * - 有线路但班次未核验 → 如实说「班次未核实」，不编
 * - 没有线路 → 只给「下一站在哪、多远」，不给虚构的公交班次（城市公交数据为 0）
 */
export type NextStop = {
  item: ItineraryItem
  place: Place
  distanceKm: number
  /** 线路型交通（景区观光车/索道等），没有就是 null */
  line: { id: string; name: string; departureMin: number | null; rideMin: number | null; verified: boolean } | null
}

export function nextStopAfter(plan: Plan, itemId: string): NextStop | null {
  const day = plan.days.find((d) => d.items.some((i) => i.id === itemId))
  if (!day) return null
  const idx = day.items.findIndex((i) => i.id === itemId)
  const current = day.items[idx]
  const currentPlace = current?.placeId ? placeById(current.placeId) : undefined

  // 往后找第一个景点（跳过餐食）；到了当天最后一个就返回 null，跨天不算「下一站」
  const next = day.items.slice(idx + 1).find((i) => i.kind === 'place' && i.placeId)
  if (!next?.placeId) return null
  const place = placeById(next.placeId)
  if (!place) return null

  const distanceKm = currentPlace ? kmTo(currentPlace, place) : 0
  return { item: next, place, distanceKm, line: lineFor(next) }
}

/**
 * 这一站有没有线路型交通可用。
 *
 * 判据是 `lineId` 已经挂在条目上（生成时 planner 定过），不是现算 ——
 * 现算会跟行程里实际怎么来的不一致，用户看到「坐索道」而行程其实记的是步行。
 */
function lineFor(item: ItineraryItem): NextStop['line'] {
  if (!item.lineId) return null
  const line = lineById(item.lineId)
  if (!line) return null
  return {
    id: line.id,
    name: line.name,
    // 发车时刻由 `waitMin` 反映（到站等多久），这里不重复算一遍
    departureMin: item.startMin - (item.waitMin ?? 0),
    rideMin: line.rideMin,
    // 未核验的班次不标成已核验，界面据此决定说「约」还是说实话
    verified: line.trust === 'official' && !line.isDemo && line.firstBus !== null
  }
}

/**
 * 城市交通（F05 后半）。
 *
 * 全仓**没有城市公交/地铁数据**：`data/lines.json` 全是景区内部交通（观光车/索道/扶梯/游船），
 * `LineMode` 也没有 bus/metro/subway。所以这里唯一诚实的答案是「没有」，
 * 并给出用户此刻真正能做的两件事（打车 / 步行），而不是编一个假班次。
 */
export type CityTransit = { available: false; reason: string; fallback: string[] }

export const cityTransitFor = (_city: string): CityTransit => ({
  available: false,
  reason: '城市公交与地铁班次尚未接入数据源，这里不显示任何推测的线路或时刻',
  // 打车估算只用已核验的起步价口径（lines.ts 的 TAXI 常数），步行距离用直线
  fallback: ['打车 / 包车（人数对比见方案里的交通建议）', '按地图上的直线距离步行，实际以导航为准']
})

/** 这一站能坐的景区内部交通清单，供「下一站」卡片展示备选 */
export const linesAt = (placeId: string): TransitLine[] => linesAtPlace(placeId)

/** 当天还剩几站没走（按 itemId 之后算），用来回答「还有几个点」 */
export const remainingStops = (day: TripDay, afterItemId: string): number => {
  const idx = day.items.findIndex((i) => i.id === afterItemId)
  if (idx < 0) return 0
  return day.items.slice(idx + 1).filter((i) => i.kind === 'place').length
}

/**
 * 附近推荐的可执行性（F04 3.3）。
 *
 * 只按直线距离排序是不够的：一个 20 米外的景点，如果 16:00 就停止入场、
 * 而现在是 15:30，推荐它等于让用户白走一趟。产品要的是「现在能去哪」，
 * 不是「离我最近的地方有哪些」。
 *
 * `now` 与 `hours` 都由调用方给：没有可用时间时只说「营业中/已关门」，
 * 不替用户假设他有多少时间。
 */
export type Reachability = 'fits' | 'tight' | 'closing' | 'closed' | 'unknown'

export type NearbyOption = {
  place: Place
  km: number
  reach: Reachability
  /** 给人看的一句说明，直接能拼进回答 */
  note: string
}

/**
 * 判断一个点「现在去还来不来得及」。
 *
 * 采用地点自身的 `open`（全年最保守那档），不按季节取：现场推荐手里没有出行日期，
 * 拿一个猜的日期去取季节档会把「夏天还开着」说成「已关门」。
 * 保守档的代价是夏天下班会早说一会儿，但说错方向是「劝你别去」，不会让人白跑。
 */
export function reachabilityOf(place: Place, nowMin: number, hours?: number): { reach: Reachability; note: string } {
  const [open, close] = place.open
  const stay = place.stayMin
  if (nowMin >= close) {
    return { reach: 'closed', note: `${clock(open)}-${clock(close)} 开放，现在已经关门` }
  }
  if (nowMin < open) {
    return { reach: 'closed', note: `${clock(open)} 才开门，现在还没开` }
  }
  // 到点前留 30 分钟：卡着停止入场那一刻到，实际常常进不去
  const left = close - nowMin
  // 用户还说了「我只有两小时」时，两小时也是门槛：逛完超出他的空档一样不可行
  const budget = hours !== undefined ? Math.min(left, hours * 60) : left
  if (left < stay + 30) {
    return { reach: 'closing', note: `${clock(close)} 停止入场，只剩 ${left} 分钟，逛不完（建议停留 ${stay} 分钟）` }
  }
  if (budget < stay + 30) {
    return { reach: 'tight', note: `你只剩约 ${Math.round(budget / 60 * 10) / 10} 小时，这里建议停留 ${stay} 分钟，偏紧` }
  }
  return { reach: 'fits', note: `${clock(open)}-${clock(close)} 开放，现在去来得及` }
}

const clock = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
