import type { Demand, Place } from '@/types'
import { travelMinutes } from '@/engine/placeIndex'

/**
 * 时间窗口与「按景点反推时间」（F03）。
 *
 * 产品给了两种规划起点，引擎必须都支持：
 * 1. **按时间**：用户说「12 点出发、20 点左右回来」，出发与返回就是这一天的边界。
 * 2. **按景点**：用户说「这四站都要去」，时间由「这些点要花多久」倒推出来。
 *
 * 两条口径：
 * - `startMin` 是**出发**时刻，不填才回落默认的 9:00。以前整天规划把 9:00 写死，
 *   用户说「下午一点出发」会被无声忽略，排出来的行程他一站都赶不上。
 * - `returnBy` 是**最晚返回**。它是约束而不是建议：超了要在 issues 里说清晚多久，
 *   让用户自己决定砍站还是接受晚归。
 */

/** 整天规划的默认出发时刻；用户给了 `startMin` 就用用户的 */
export const DEFAULT_START = 9 * 60
/**
 * 反推时间时预留的缓冲（找入口、排队、上厕所）。
 *
 * 不留缓冲算出来的「刚刚好」计划，实际执行必然晚点，而用户按它定返程车次就会误事。
 */
const BUFFER_MIN = 10
/** 一顿饭的时长；与 planner / lightPlan 同口径 */
const MEAL_MIN = 60

export const startOf = (demand: Pick<Demand, 'startMin'>): number =>
  Number.isFinite(demand.startMin) ? Math.max(0, Math.round(demand.startMin!)) : DEFAULT_START

export type TimeBudget = {
  /** 停留 + 站间交通 + 午饭 + 缓冲 */
  total: number
  stay: number
  legs: number
  meals: number
}

/**
 * 走完这些点要多久。
 *
 * 站间交通复用引擎的唯一估算入口 `travelMinutes`（有真实路线就用真实，没有就直线折算），
 * 不在这里另算一套 —— 两处口径不同的话，反推出来的时间和对不上行程页。
 */
export function minutesFor(
  places: Place[],
  demand: Pick<Demand, 'transport'>
): TimeBudget {
  if (!places.length) return { total: 0, stay: 0, legs: 0, meals: 0 }
  let legs = 0
  for (let i = 1; i < places.length; i++) legs += travelMinutes(places[i - 1], places[i], demand.transport !== 'public')
  const stay = places.reduce((s, p) => s + p.stayMin, 0)
  // 两个点以上才排出跨饭点的可能；单点不需要一顿饭的时长
  const meals = places.length >= 2 ? MEAL_MIN : 0
  return { total: stay + legs + meals + BUFFER_MIN, stay, legs, meals }
}

export type ReverseWindow = {
  startMin: number
  endMin: number
  totalMin: number
  /** 给人看的一句依据，说明这个时间是怎么倒推出来的 */
  basis: string
}

/**
 * 按景点反推出发与返回时间。
 *
 * 给了 `returnBy` 就从它倒推出发；没给就从 `startMin`（缺省 9:00）顺推返回。
 * 倒推出的出发时刻早于 0 点时**不静默截断到 0** —— 那会给出一个同样走不完的假计划，
 * 调用方据此判断「这几个点在这个窗口里放不下」。
 */
export function reverseWindow(
  places: Place[],
  demand: Pick<Demand, 'transport' | 'startMin' | 'returnBy'>
): ReverseWindow | null {
  if (!places.length) return null
  const { total, stay, legs, meals } = minutesFor(places, demand)
  const parts = [
    `停留 ${stay} 分钟`,
    legs > 0 ? `路上 ${legs} 分钟` : '',
    meals > 0 ? '一顿饭 60 分钟' : '',
    `缓冲 ${BUFFER_MIN} 分钟`
  ].filter(Boolean)
  const basis = `${places.length} 个点：${parts.join(' + ')}`

  if (Number.isFinite(demand.returnBy)) {
    const endMin = Math.round(demand.returnBy!)
    return { startMin: endMin - total, endMin, totalMin: total, basis }
  }
  const startMin = startOf(demand)
  return { startMin, endMin: startMin + total, totalMin: total, basis }
}

/** 反推结果是否可行：出发时刻不能是负数，也不能早到天没亮 */
export const windowFeasible = (w: ReverseWindow, earliest = 8 * 60): boolean => w.startMin >= earliest

export const clock = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
