import type {
  AffectedChange,
  ChangeImpact,
  Demand,
  ItineraryItem,
  Plan,
  Place,
  ReviseOp,
  RevisePreview,
  TripDay
} from '@/types'
import { hasRoute, placeById, placesOf, travelMinutes } from '@/engine/placeIndex'
import { estimateBudget } from '@/engine/budget'
import { fmt, validatePlan } from '@/engine/validate'

/**
 * 方案的「按天编辑」原子操作。
 *
 * 单独成文件而不是继续堆在 planner.ts 里：planner 负责「从需求生成方案」，
 * 这里负责「在一份已有方案上改一天」。两条路径共用同一套重排/重算，
 * 所以聊天里说「第二天下午轻松点」和行程页里点同一个快捷词，落到的改动是同一份实现。
 *
 * 铁律：这一层只做执行与计算。想改什么由调用方给成结构化动作（ReviseOp），
 * 改完的时间、费用、校验结果全部由这里算，不接受外部塞进来的数字。
 */

/** 上一站：换景点后要从这里重新算路上时间，不能用被换掉那站的旧值 */
export const prevPlace = (day: TripDay, target: ItineraryItem): Place | undefined => {
  for (let i = day.items.indexOf(target) - 1; i >= 0; i--) {
    const place = day.items[i].placeId ? placeById(day.items[i].placeId!) : undefined
    if (place) return place
  }
  return undefined
}

const placeOf = (item: ItineraryItem): Place | undefined => (item.placeId ? placeById(item.placeId) : undefined)

/** 只替换一个景点，其余项保持原 id 与顺序 */
const replaceItem = (day: TripDay, target: ItineraryItem, place: Place, transport: Demand['transport']): TripDay => {
  const prev = prevPlace(day, target)
  // 首站被替换时没有「上一站」，沿用 target 原来的 transportMin（首站记 0），
  // 不要拿一个路段耗时冒充出发耗时
  const transportMin = prev ? travelMinutes(prev, place, transport !== 'public') : target.transportMin
  const transportSource = prev
    ? hasRoute(prev, place, transport !== 'public')
      ? 'route'
      : 'straight'
    : target.transportSource
  return {
    index: day.index,
    items: day.items.map((i) =>
      i === target
        ? {
            ...i,
            placeId: place.id,
            title: place.name,
            stayMin: place.stayMin,
            transportMin,
            transportSource,
            endMin: i.startMin + place.stayMin,
            cost: place.ticket
          }
        : i
    )
  }
}

/**
 * 删点 / 换序之后按「新的前后站」重算每一段路上时间。
 *
 * 只顺延时刻、沿用旧的 transportMin，「省了多少分钟」就会算错：
 * 被删掉那站可能离线很远，删掉它本该省下更多。首站没有上一站，记 0。
 */
function relink(day: TripDay, transport: Demand['transport']): TripDay {
  let prev: Place | undefined
  const items = day.items.map((i) => {
    if (i.kind !== 'place') return i
    const place = placeOf(i)
    if (!place) return i
    const transportMin = prev ? travelMinutes(prev, place, transport !== 'public') : 0
    const transportSource: ItineraryItem['transportSource'] = prev
      ? hasRoute(prev, place, transport !== 'public')
        ? 'route'
        : 'straight'
      : undefined
    prev = place
    return { ...i, transportMin, transportSource }
  })
  return { index: day.index, items }
}

/** 一天最早的出发时刻；跟 planner 的 09:00 对齐，不顺延到开门前干等 */
const DAY_START = 9 * 60
/** 午餐最早 / 最晚开饭；超出就去掉这顿饭，而不是把午饭排到上午十点 */
const LUNCH_EARLIEST = 11 * 60
const LUNCH_LATEST = 14 * 60

/**
 * 时间被删/换之后，按新的顺序重排时刻。
 *
 * 这里不能只做「上一项结束 + 路上时间」：删掉上午的景点后，午餐会一路顶到
 * 上午十点半，看起来像系统排错了。餐食的约束是「在中午吃」，不是「紧跟前一个点」，
 * 所以到达后照旧按 OPEN 等待 + 饭点判定：早到就在原地等到最早开饭时间，
 * 晚到就顺延，超过最晚开饭时间则不留这顿饭（宁可少排一顿，也不排一顿下午三点的午饭）。
 */
const retime = (day: TripDay): TripDay => {
  let t = day.items[0]?.startMin ?? DAY_START
  const items: ItineraryItem[] = []
  for (const [idx, item] of day.items.entries()) {
    const arrive = idx === 0 ? t : t + item.transportMin
    const start = item.kind === 'meal' ? Math.max(arrive, LUNCH_EARLIEST) : arrive
    if (item.kind === 'meal' && start > LUNCH_LATEST) continue
    const end = start + item.stayMin
    items.push({ ...item, startMin: start, endMin: end })
    t = end
  }
  return { index: day.index, items }
}

export const highlightsOf = (days: TripDay[]): string[] =>
  days
    .flatMap((d) => d.items.filter((i) => i.kind === 'place'))
    .slice(0, 4)
    .map((i) => i.title)

const snapshot = (plan: Plan) => ({
  minutes: plan.days.reduce((s, d) => s + d.items.reduce((x, i) => x + i.stayMin + i.transportMin, 0), 0),
  perPerson: plan.budget.perPerson
})

export type ApplyReviseResult =
  | { ok: true; preview: RevisePreview }
  | { ok: false; reason: string }

/**
 * 执行一条修改动作，算出新的方案、变更影响与逐条受影响的安排。
 *
 * 拒绝（ok:false）要给出人和模型都能读懂的原因：前端原样展示，
 * 换成客服腔或者「操作失败请重试」会让用户反复试同一句不可能执行的话。
 */
export function applyReviseOp(
  plan: Plan,
  demand: Demand,
  op: ReviseOp,
  /** 这次动作是谁解析出来的：model = 模型；engine = 模型不可用时的本地兜底 */
  by: RevisePreview['by'] = 'model'
): ApplyReviseResult {
  const transport = plan.transport ?? 'public'
  const day = plan.days.find((d) => d.index === op.day)
  if (!day) return { ok: false, reason: `第 ${op.day} 天不在本次行程里` }

  if (op.op === 'drop') {
    const target = day.items.find((i) => i.id === op.targetId)
    if (!target) return { ok: false, reason: '这句话指到的安排不在这一天里，换个说法试试' }
    // 餐食不单独删：删掉午餐只会让时间轴空一块，不是用户说的「轻松点」
    if (target.kind !== 'place') return { ok: false, reason: '只能精简景点，用餐时间不单独删' }
    const placeCount = day.items.filter((i) => i.kind === 'place').length
    if (placeCount <= 1) return { ok: false, reason: `第 ${op.day} 天只剩一个景点，再删就没有可玩的内容了` }
    const kept: TripDay = { index: day.index, items: day.items.filter((i) => i.id !== op.targetId) }
    return finish(plan, demand, day, retime(relink(kept, transport)), op.reason, by)
  }

  if (op.op === 'replace') {
    const target = day.items.find((i) => i.id === op.targetId)
    if (!target) return { ok: false, reason: '这句话指到的安排不在这一天里，换个说法试试' }
    if (target.kind !== 'place' || !target.placeId) return { ok: false, reason: '只能替换景点，用餐不能换成景点' }
    const place = placeById(op.withPlaceId)
    if (!place) return { ok: false, reason: '提议的地点不在已收录数据里，换个地点试试' }
    if (place.city !== demand.destination) {
      return { ok: false, reason: `「${place.name}」不在${demand.destination}，排不进这次行程` }
    }
    const used = new Set(plan.days.flatMap((d) => d.items.map((i) => i.placeId)))
    if (used.has(place.id)) return { ok: false, reason: `「${place.name}」已经在行程里了，不重复排` }
    return finish(plan, demand, day, retime(replaceItem(day, target, place, transport)), op.reason, by)
  }

  // reorder：只认这一天里真实存在的景点 id，重复与不存在的都剔掉。
  // 不要求模型列全：它只需要说清「哪几个换成什么顺序」，没提的保持原有相对次序，
  // 否则漏一个 id 就要整轮重来，模型几乎每次都会漏。
  const ids = day.items.filter((i) => i.kind === 'place').map((i) => i.id)
  const listed = op.order.filter((id) => ids.includes(id))
  if (new Set(listed).size !== listed.length) return { ok: false, reason: '调整顺序时重复指定了同一个地点，没有执行' }
  if (listed.length < 2) return { ok: false, reason: '调整顺序至少要说到这一天的两个地点' }
  const finalOrder = [...listed, ...ids.filter((id) => !listed.includes(id))]
  const byId = new Map(day.items.map((i) => [i.id, i]))
  let k = 0
  const shuffled = day.items.map((i) => (i.kind === 'place' ? byId.get(finalOrder[k++])! : i))
  return finish(plan, demand, day, retime(relink({ index: day.index, items: shuffled }, transport)), op.reason, by)
}

/** 收尾：重算预算与校验，再产出变更影响与逐条受影响项 */
function finish(
  plan: Plan,
  demand: Demand,
  before: TripDay,
  nextDay: TripDay,
  reason: string,
  by: RevisePreview['by']
): ApplyReviseResult {
  // 用方案自己的交通方式重算：需求是 compare 时直接算会把包车方案报成公交价
  const demandOfPlan: Demand = { ...demand, transport: plan.transport ?? 'public' }
  const days = plan.days.map((d) => (d.index === nextDay.index ? nextDay : d))
  const budget = estimateBudget(demandOfPlan, days)
  const nextPlan: Plan = { ...plan, days, highlights: highlightsOf(days), budget }
  nextPlan.issues = validatePlan(nextPlan, demandOfPlan)

  const prev = snapshot(plan)
  const next = snapshot(nextPlan)
  const impact: ChangeImpact = {
    minutes: next.minutes - prev.minutes,
    cost: next.perPerson - prev.perPerson,
    recheck: nextPlan.issues.filter((i) => i.level === 'error').map((i) => i.message).slice(0, 3),
    note: reason
  }
  return { ok: true, preview: { plan: nextPlan, impact, affected: affectedOf(before, nextDay), reason, by } }
}

/** 逐条对比改动前后的这一天，让用户看到具体哪条变了 */
function affectedOf(before: TripDay, after: TripDay): AffectedChange[] {
  const now = new Map(after.items.map((i) => [i.id, i]))
  const out: AffectedChange[] = []
  for (const item of before.items) {
    const next = now.get(item.id)
    if (!next) {
      out.push({ kind: 'removed', title: item.title, detail: '已移出这一天' })
      continue
    }
    if (next.placeId !== item.placeId) {
      out.push({ kind: 'replaced', title: item.title, detail: `换成「${next.title}」` })
      continue
    }
    if (next.startMin !== item.startMin) {
      out.push({ kind: 'retimed', title: item.title, detail: `${fmt(item.startMin)} → ${fmt(next.startMin)}` })
    }
  }
  return out.slice(0, 6)
}

/** 给模型看的这一天的可选替换地点：只要能排进这座城市的已收录点，且没被别的天占用 */
export function replaceCandidates(plan: Plan, demand: Demand, dayIndex: number, targetId: string): Place[] {
  const day = plan.days.find((d) => d.index === dayIndex)
  const target = day?.items.find((i) => i.id === targetId)
  if (!day || !target) return []
  const used = new Set(plan.days.flatMap((d) => d.items.map((i) => i.placeId)))
  return placesOf(demand.destination).filter((p) => !used.has(p.id))
}

/** 模型做提案时要看到的一天：只给 id、地名、时刻与票价，不给它自由发挥的空间 */
export function dayBrief(day: TripDay): { id: string; title: string; kind: string; start: string; end: string; cost: number | null }[] {
  return day.items.map((i) => ({
    id: i.id,
    title: i.title,
    kind: i.kind,
    start: fmt(i.startMin),
    end: fmt(i.endMin),
    cost: i.cost
  }))
}
