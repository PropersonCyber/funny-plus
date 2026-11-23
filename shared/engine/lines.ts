import type { Demand, ItineraryItem, LineMode, TransitLine } from '@/types'

/**
 * 线路索引（FR-01）。
 *
 * 线路是**独立实体**，不是给地点加字段：观光车/索道之所以存在，就是因为它把几个点连成一条线，
 * 把「末班 17:00」挂到某个站点的 POI 上，换个站就查不到了。
 *
 * 和 placeIndex 一样是「先注入再计算」：引擎全同步，没有预热的线路一律当作「暂无数据」，
 * 不允许回退成「随便估算一个班次」——那会让 FR-02 的硬约束判出假 error。
 */
let index = new Map<string, TransitLine>()

export function setLines(list: TransitLine[]): void {
  index = new Map(list.filter((l) => l.stops.length >= 2).map((l) => [l.id, l]))
}

export const lineById = (id: string): TransitLine | undefined => index.get(id)

export const linesOf = (city: string): TransitLine[] => [...index.values()].filter((l) => l.city === city)

/** 在这个地点「等于在乘车点」的线路；行程排到它就说明这一段要走线路型交通 */
export const linesAtPlace = (placeId: string): TransitLine[] => [...index.values()].filter((l) => l.rideAtPlaceId === placeId)

export const LINE_MODE_LABEL: Record<LineMode, string> = {
  sightseeing: '景区观光车',
  shuttle: '摆渡车',
  cableway: '索道',
  escalator: '大扶梯',
  ferry: '游船'
}

/**
 * 班次表算不算「可判硬约束」。
 * 只有官方核验过的一手信息才配拦用户，其余（待核实/用户填报）最多提示（FR-02 / FR-06）。
 * 演示班次即使标了 official 也不算：它的首末班是构造值，拿它拦用户等于用假数据拦住真行程。
 */
export const canJudgeHard = (line: TransitLine): boolean => line.trust === 'official' && !line.isDemo

/**
 * >= startMin 的最近一班车的发车时刻；末班之后没有车就返回 null。
 * 间隔未核验时只认首末班两端：既不能编间隔，也不能因为「不知道几点一班」就说没车。
 */
export function nextDeparture(line: TransitLine, min: number): number | null {
  const first = line.firstBus
  const last = line.lastBus
  if (first === null || last === null) return null
  if (min <= first) return first
  if (min > last) return null
  if (line.intervalMin === null || line.intervalMin <= 0) return min
  const steps = Math.ceil((min - first) / line.intervalMin)
  const at = first + steps * line.intervalMin
  return at > last ? last : at
}

/** 这条线路上「从哪站上、到哪站下」；行程只排了一个点时退回首站→该站 */
export function stopsBetween(line: TransitLine, fromPlaceId?: string, toPlaceId?: string) {
  const at = (id?: string) => (id ? line.stops.findIndex((s) => s.placeId === id) : -1)
  const from = at(fromPlaceId)
  const to = at(toPlaceId)
  if (from >= 0 && to >= 0 && to !== from) return { from: line.stops[from], to: line.stops[to] }
  return { from: line.stops[0], to: line.stops[line.stops.length - 1] }
}

/** 这条线覆盖哪些地点 id，用来在地点池里找出「线路型交通段」 */
export const linePlaceIds = (line: TransitLine): string[] => line.stops.map((s) => s.placeId).filter((id): id is string => !!id)

/**
 * 从行程里挑出所有「线路型」路段：上下两个地点都被同一条线覆盖，
 * 就用这条线替换掉普通两点移动。返回按行程顺序的第一个可替换段。
 */
export function lineSegmentFor(items: ItineraryItem[], index: number): { line: TransitLine; fromPlaceId?: string } | null {
  const item = items[index]
  if (!item?.placeId) return null
  for (let i = index - 1; i >= 0; i--) {
    const prevId = items[i].placeId
    if (!prevId) continue
    const shared = linesAtPlace(item.placeId).filter((line) => linePlaceIds(line).includes(prevId))
    // 多条线都能走同一段时取班次核验最全的那条（官方 > 可靠 > 其他），别拿待核验的顶
    const ranked = shared.sort(rankLine)
    if (ranked[0]) return { line: ranked[0], fromPlaceId: prevId }
    return null
  }
  return null
}

const TRUST_RANK: Record<string, number> = { official: 3, credible: 2, experience: 1, pending: 0 }

const rankLine = (a: TransitLine, b: TransitLine): number => {
  // 演示班次排最后：它 trust 是 official，只降半分仍会压过真实但 pending 的条目，
  // 用户看到的第一个「有班次」的线就成了构造值
  const score = (l: TransitLine) =>
    l.isDemo ? -1 : (TRUST_RANK[l.trust] ?? 0) * 10 + (l.lastBus !== null ? 1 : 0)
  return score(b) - score(a)
}
/**
 * 人数 → 交通结论（FR-03）。
 *
 * 硬规则（PRD FR-03）：
 * 1. 不做 1–3 / 3–5 固定档，必须按当前人数与当前动线算；
 * 2. 钱与时间并列，不合成综合分；
 * 3. 数据不全降级为区间，并写清假设；
 * 4. 缺票价或缺核载时只做单维度对比，明说「仅比了票价/时间」。
 */
const TAXI = { perCar: 4, pricePerCar: 60 }

export function transportAdvice(line: TransitLine, party: number, rideMinutes: number): {
  options: { mode: 'taxi' | 'line'; label: string; cost: number | null; minutes: number | null; basis: string }[]
  verdict: string
  assumptions: string[]
  partial: boolean
} {
  const assumptions: string[] = []
  const cars = Math.ceil(party / TAXI.perCar)
  if (party > TAXI.perCar) assumptions.push(`按 ${TAXI.perCar} 人/车、¥${TAXI.pricePerCar}/车估（不含高速）`)
  else assumptions.push(`按 1 辆车 ¥${TAXI.pricePerCar} 估（不含高速）`)

  const taxiMinutes = rideMinutes > 0 ? rideMinutes : null

  const price = cheapestTicket(line)
  const lineCost = price === null ? null : price * party
  const waitMin = line.intervalMin ?? null
  const lineMinutes = line.rideMin === null ? null : line.rideMin + (waitMin ?? 0)
  if (line.intervalMin === null) assumptions.push('发车间隔未核验，等车时间按 0 计，实际会更久')
  if (line.capacity === null) assumptions.push('单班核载未核验')
  else if (line.capacity < party) assumptions.push(`单班核载 ${line.capacity} 人，${party} 人需分乘`)

  const taxi = { mode: 'taxi' as const, label: `打车 ${cars} 辆`, cost: TAXI.pricePerCar * cars, minutes: taxiMinutes, basis: `${cars} 辆 × ¥${TAXI.pricePerCar}` }
  const byLine = {
    mode: 'line' as const,
    label: `${line.name} ${party} 张`,
    cost: lineCost,
    minutes: lineMinutes,
    basis: price === null ? '票价未核实' : `${party} 张 × ¥${price}`
  }

  const partial = lineCost === null || lineMinutes === null
  // 打车时长和线路时长都可能为 null（未核验）；只要有一个缺失就只比另一维
  const taxiMin = taxiMinutes ?? 0
  const lineMin = lineMinutes ?? 0
  let verdict: string
  if (lineCost === null) {
    verdict = `票价未核实，只能比时间：打车约 ${fmtMin(taxiMinutes)}，${line.name} 约 ${fmtMin(lineMinutes)}`
  } else if (lineMinutes === null || taxiMinutes === null) {
    verdict = `时长未核实，只能比钱：打车约 ¥${taxi.cost}，${line.name} 约 ¥${lineCost}`
  } else {
    const moneyCheaper = lineCost < taxi.cost
    const timeCheaper = lineMin < taxiMin
    if (moneyCheaper && timeCheaper) verdict = `两者都接近，${line.name} 略省`
    else if (!moneyCheaper && !timeCheaper) verdict = `打车更省时，${line.name} 也不便宜`
    else if (moneyCheaper) verdict = `${party} 人：${line.name} 省 ¥${taxi.cost - lineCost}，多花约 ${lineMin - taxiMin} 分钟`
    else verdict = `${party} 人：打车省 ¥${lineCost - taxi.cost}，快约 ${taxiMin - lineMin} 分钟`
  }

  return { options: [taxi, byLine], verdict, assumptions, partial }
}

const cheapestTicket = (line: TransitLine): number | null => {
  const prices = line.tickets.map((t) => t.price).filter((p): p is number => p !== null)
  return prices.length ? Math.min(...prices) : null
}

const fmtMin = (min: number | null): string => (min === null ? '时长未知' : `${min} 分钟`)

/**
 * 需求侧的交通方式与线路冲突时，这句话给界面用。
 * 只在真冲突（用户选了包车/自驾、却排进必须坐线路的点）时返回，不无话找话。
 */
export function demandConflictNote(line: TransitLine, demand: Demand): string | null {
  if (demand.transport !== 'charter' && demand.transport !== 'car') return null
  return `行程里包含「${line.name}」，与当前选择的${demand.transport === 'charter' ? '包车' : '自驾'}不能完全互通，需自行确认停车与换乘`
}

export { fmtMin as fmtMinutes }

/**
 * 没有景区线路时的两种现实选择（F05）。
 *
 * 评审复现的问题：6 个人问「怎么走」，只回了步行时长和一句「可以打车」，
 * 没有打车耗时、费用和分乘 —— 而这正是 6 人场景唯一要比较的东西。
 *
 * 打车按实际人数算几辆车，钱与时间并列；不合成「哪个更好」的总分，
 * 让用户按自己的取舍选。
 */
export function taxiOption(party: number, rideMinutes: number): {
  mode: 'taxi'
  cars: number
  cost: number
  minutes: number | null
  label: string
  basis: string
  assumptions: string[]
} {
  const cars = Math.ceil(party / TAXI.perCar)
  const cost = cars * TAXI.pricePerCar
  const assumptions = [
    party > TAXI.perCar
      ? `${party} 人需 ${cars} 辆（按 ${TAXI.perCar} 人/车）`
      : '1 辆车够坐',
    `按 ¥${TAXI.pricePerCar}/车估（起步价口径，不含高速与拥堵加价）`
  ]
  return {
    mode: 'taxi',
    cars,
    cost,
    minutes: rideMinutes > 0 ? rideMinutes : null,
    label: `打车 ${cars} 辆`,
    basis: `${cars} 辆 × ¥${TAXI.pricePerCar}`,
    assumptions
  }
}
