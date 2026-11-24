import type { Demand, ItineraryItem, Place, Plan, TripDay } from '@/types'
import { kmTo, placesLoaded, placesOf, travelMinutes } from '@/engine/placeIndex'
import { estimateBudget } from '@/engine/budget'
import { validatePlan } from '@/engine/validate'
import { openingForDay } from '@/engine/opening'

/**
 * 轻量规划（F04 / 任务 B「当地临时规划」）。
 *
 * 用户说「我在前门附近，下午有四小时，想吃点东西逛一逛」时，他要的不是一份两天行程，
 * 而是**接下来这几个小时能干点什么**。`generatePlans` 排的是整天（09:00 起、按天分片、
 * 含住宿预算），对这句话是错的形状：它会排出用户已经过掉的那半天，
 * 也会把「还剩 3 小时」算成「一整天的住宿与三餐」。
 *
 * 三条与主链路不同的口径：
 * 1. **从 `startMin` 起算**，不从 09:00。说「下午两点开始」就两点开始。
 * 2. **到点就停**：超出 `startMin + hours*60` 的景点一个都不排。宁可少排，
 *    不可排一个用户到不了的点——那比不排更让人沮丧。
 * 3. **不产生住宿**：几小时里没有过夜。预算里住宿项直接省略（见 lightBudget）。
 *
 * 与主链路共享的部分：点池、偏好排序、班次/营业时间校验、`validatePlan`。
 * 只有「生成哪些天、起止时刻、预算口径」这三处不同，其余全是同一套引擎。
 */

/** 没说几点开始时，按下午两点：上午多半已经过掉了 */
export const LIGHT_START = 14 * 60
/** 一顿饭的时长；轻量规划里吃饭是真实占用，不排就是给用户一个做不完的计划 */
const MEAL_MIN = 60
/** 吃饭最早/最晚；与 planEdit 的午餐口径一致 */
const MEAL_EARLIEST = 11 * 60
const MEAL_LATEST = 14 * 60 + 30
/** 轻量规划的天花板：超过一天的时长该走正常规划 */
export const LIGHT_MAX_HOURS = 12
export const LIGHT_MIN_HOURS = 1

export class LightPlanError extends Error {}

/** 这次需求是不是轻量规划（有 `hours` 就走这条路） */
export const isLight = (demand: Pick<Demand, 'hours'>): boolean => typeof demand.hours === 'number' && demand.hours > 0

/**
 * 把 `hours` 归一成可用的值。
 *
 * 不是直接 clamp 掉：明显超范围时报错，让用户知道「你要的 16 小时这里排不了」，
 * 而不是悄悄按 12 小时排一份和他说的话对不上的行程。
 */
export function normalizeHours(hours: number): number {
  if (!Number.isFinite(hours)) throw new LightPlanError('时长不是有效数字')
  if (hours < LIGHT_MIN_HOURS) throw new LightPlanError(`至少要留出 ${LIGHT_MIN_HOURS} 小时才排得下一个点`)
  if (hours > LIGHT_MAX_HOURS) {
    throw new LightPlanError(`超过 ${LIGHT_MAX_HOURS} 小时请按天数规划，临时安排只算当下这几个小时`)
  }
  // 半小时粒度是真实需求（「我有三个半小时」），精确到 0.5 就够
  return Math.round(hours * 2) / 2
}

/** 轻量规划的预算：没有住宿，其余照旧 */
function lightBudget(demand: Demand, days: TripDay[]) {
  const full = estimateBudget({ ...demand, dayCount: 1 }, days)
  const items = full.items.filter((i) => i.category !== 'lodging')
  const total = items.reduce((s, i) => s + i.amount, 0)
  return {
    items,
    total,
    perPerson: Math.round(total / Math.max(1, demand.party)),
    // 住宿项被去掉这件事要说出来：不说，用户会以为总额里含了住的地方
    uncertain: [...full.uncertain.filter((u) => !u.includes('住宿')), '只有几个小时，未计入住宿']
  }
}

/**
 * 点池按「离我多远」排 —— 只有在给了 `origin` 时。
 *
 * 没给就沿用主链路的就近排序（从第一个点出发的最近邻），不能拿城市中心冒充用户位置：
 * 排出来看着合理，实际让用户跨半个城市去一个「附近」的点。
 */
function orderFrom(pool: Place[], origin?: { lng: number; lat: number }): Place[] {
  if (!origin) return pool
  return [...pool].sort((a, b) => kmTo(origin, a) - kmTo(origin, b))
}

/**
 * 生成一份轻量安排。
 *
 * 返回单个 `Plan`（不是三套）：用户此刻要的是「现在能去哪」，给他三套对比
 * 是在增加决策负担，而他只有几个小时。
 */
export function generateLightPlan(demand: Demand): Plan {
  if (!placesLoaded()) throw new LightPlanError('地点数据还没取到，请检查网络后重试')
  const hours = normalizeHours(demand.hours ?? 0)
  const pool = placesOf(demand.destination)
  if (pool.length === 0) {
    throw new LightPlanError(`「${demand.destination}」暂未接入地点数据`)
  }

  const start = clampStart(demand.startMin)
  // 用户同时说了时长和返回时刻时，两个都是约束：取更早的那个截止。
  // 「接下来四小时，但 14 点前必须回来」如果只按四小时排，排出来的行程
  // 到点也回不去 —— 那正是这次评审复现出来的问题
  const byHours = start + Math.round(hours * 60)
  const endsAt = Number.isFinite(demand.returnBy) ? Math.min(byHours, demand.returnBy!) : byHours
  if (endsAt <= start) {
    throw new LightPlanError(
      `返回时间 ${clock(demand.returnBy!)} 早于出发时间 ${clock(start)}，先确认这两个时刻`
    )
  }
  const ordered = orderFrom(pool, demand.origin)


  const items = fillUntil(ordered, demand, start, endsAt)
  if (!items.some((i) => i.kind === 'place')) {
    // 一个点都排不下时要给出能懂的原因，不能返回一份空行程
    const remaining = Math.round((endsAt - start) / 60)
    throw new LightPlanError(
      `${remaining} 小时不足以安排一个景点（${demand.destination}最短的景点也要停留一段时间），再多留一点时间？`
    )
  }

  const day: TripDay = { index: 1, items }
  const lightDemand: Demand = { ...demand, dayCount: 1 }
  const plan: Plan = {
    id: `${demand.destination}-light-${start}-${endsAt}`,
    pace: 'relaxed',
    paceLabel: `接下来 ${hours} 小时`,
    transport: demand.transport,
    destination: demand.destination,
    suitableFor: '已经在当地，只想安排接下来这一段时间',
    highlights: items.filter((i) => i.kind === 'place').map((i) => i.title),
    days: [day],
    budget: lightBudget(lightDemand, [day]),
    issues: []
  }
  plan.issues = validatePlan(plan, lightDemand)
  // 终点要显式讲清楚：用户给的是「四小时」，行程编排页只显示时刻，没这句话他对不上。
  // 被返回时刻提前截断时要说清是哪个约束生效了，否则用户以为是四小时排不下
  const clipped = endsAt < byHours
  plan.issues.push({
    id: 'light-window',
    code: 'light-window',
    level: 'info',
    message: clipped
      ? `按 ${clock(start)} 至 ${clock(endsAt)} 安排：你要求 ${clock(demand.returnBy!)} 前回来，比「${hours} 小时」更早，所以只排到 ${clock(endsAt)}`
      : `按 ${clock(start)} 至 ${clock(endsAt)} 安排，共 ${hours} 小时`
  })
  return plan
}

/** 起始时刻：没给按下午两点，给了就夹在营业日范围内，午夜之后的时间是输入错误 */
function clampStart(startMin?: number): number {
  if (startMin === undefined || !Number.isFinite(startMin)) return LIGHT_START
  return Math.min(Math.max(0, Math.round(startMin)), 22 * 60)
}

/**
 * 从 start 开始往里塞景点，直到下一站放不下为止。
 *
 * 「放得下」= 到达时刻 + 停留时长 <= 截止时刻。这里**不**为了塞满而截短停留时间：
 * 把「建议停留 90 分钟」的景点压到 30 分钟，等于给用户一个走马观花的假计划。
 *
 * 某一站放不下就跳过它继续看下一站（更远的点也可能停留更短），
 * 但绝不把它截短硬塞 —— 那正是「排得下」和「能去」的分别。
 */
function fillUntil(ordered: Place[], demand: Demand, start: number, endsAt: number): ItineraryItem[] {
  const items: ItineraryItem[] = []
  let t = start
  let prev: Place | undefined
  let ate = false

  for (const place of ordered) {
    const leg = prev ? travelMinutes(prev, place, demand.transport !== 'public') : 0
    const window = openingForDay(place, demand, 1).open
    // 饭点先吃饭再出发：跨过饭点还空着肚子赶路，排出来的时间表是假的
    if (!ate && t >= MEAL_EARLIEST && t <= MEAL_LATEST && t + MEAL_MIN + leg + place.stayMin <= endsAt) {
      items.push(mealItem(t, t + MEAL_MIN))
      t += MEAL_MIN
      ate = true
    }
    const arrive = t + leg
    // 到得比开门早就在门口等；等完再判放不放得下
    const began = Math.max(arrive, window[0])
    const end = began + place.stayMin
    // 三个门槛：时间窗放得下、到的时候它还开着、走完还能回到起点。
    // 第三条只在有起点坐标时才有意义 —— 用户说「14 点前回来」是回到起点，
    // 不是回到最后一个景点，漏掉这段回程他会以为卡点，实际晚半小时。
    // 这里不再把 origin 强转成 Place：它没有 id，强转后路段缓存键会变成
    // `undefined>xxx`，真实耗时永远命中不了（见 placeIndex.pointKey）
    const back = demand.origin ? travelMinutes(place, demand.origin, demand.transport !== 'public') : 0
    // 只看 endsAt 会把「23:00 关门、22:30 到、停留一小时」排进去 —— 用户到了门口进不去。
    if (end + back > endsAt || end > window[1]) continue
    items.push(placeItem(place, began, leg, demand))
    t = end
    prev = place
  }
  return items
}

const placeItem = (place: Place, startMin: number, transportMin: number, demand: Demand): ItineraryItem => ({
  id: `${place.id}-light`,
  kind: 'place',
  title: place.name,
  placeId: place.id,
  startMin,
  endMin: startMin + place.stayMin,
  stayMin: place.stayMin,
  transportMin,
  transportMode: demand.transport === 'compare' ? 'public' : demand.transport,
  cost: place.ticket
})

const mealItem = (startMin: number, endMin: number): ItineraryItem => ({
  id: `meal-light-${startMin}`,
  kind: 'meal',
  title: '用餐',
  startMin,
  endMin,
  stayMin: endMin - startMin,
  transportMin: 0,
  transportMode: 'public',
  cost: 60
})

const clock = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

/** 用户那句话里的时长 → 一句可读的确认（用在预览卡上，让他核对是不是这个意思） */
export const lightWindowLabel = (demand: Pick<Demand, 'hours' | 'startMin' | 'returnBy'>): string => {
  if (!isLight(demand)) return ''
  const start = clampStart(demand.startMin)
  const byHours = start + Math.round((demand.hours ?? 0) * 60)
  // 与 generateLightPlan 同一口径：返回时刻更早就以它为准，
  // 否则卡片上写的窗口和实际排出来的对不上
  const endsAt = Number.isFinite(demand.returnBy) ? Math.min(byHours, demand.returnBy!) : byHours
  return `${clock(start)}-${clock(endsAt)}`
}
