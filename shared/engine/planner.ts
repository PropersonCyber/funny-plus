import type { ChangeImpact, Demand, ItineraryItem, Pace, Plan, Place, TransportMode, TripDay } from '@/types'
import { distanceKm, placeById, placesLoaded, placesOf, travelMinutes } from '@/engine/placeIndex'
import { estimateBudget } from '@/engine/budget'
import { validatePlan } from '@/engine/validate'

// 这里就是「AI 规划模块」的边界：现在用确定性模板生成，接真模型时只换这个文件，
// 上层视图只依赖 Plan 结构，不依赖生成方式。
const PER_DAY: Record<Pace, number> = { relaxed: 2, balanced: 3, packed: 4 }

const PACE_LABEL: Record<Pace, string> = { relaxed: '轻松慢走', balanced: '均衡节奏', packed: '紧凑打卡' }
const SUITABLE: Record<Pace, string> = {
  relaxed: '带老人小孩、不想赶时间',
  balanced: '朋友 / 情侣，想玩到也留有余量',
  packed: '体力好、时间短、目标打卡'
}
const TRANSPORT_LABEL: Record<TransportMode, string> = {
  public: '公共交通',
  car: '自驾',
  charter: '包车',
  compare: '待比较'
}

// 偏好只能映射到地点已有 tags，映射不上的要在方案里说出来，不能假装用了
const PREF_TAGS: Record<string, string[]> = {
  美食探店: ['小吃', '商圈'],
  经典打卡: ['打卡', '老街', '人文'],
  拍照出片: ['拍照', '文创'],
  亲子慢游: ['亲子', '动物', '休闲', '茶馆'],
  夜景江湖: ['夜景']
}

export class UnsupportedDestination extends Error {}

export function generatePlans(demand: Demand): Plan[] {
  // 地点池还没预热完和「城市没接入」是两回事，不能都报成同一个错
  if (!placesLoaded()) throw new UnsupportedDestination('地点数据还没取到，请检查网络后重试')
  const pool = placesOf(demand.destination)
  if (pool.length === 0) {
    throw new UnsupportedDestination(`首期只验证重庆、成都两个目的地，「${demand.destination}」暂未接入地点数据`)
  }

  const tags = demand.preferences.flatMap((p) => PREF_TAGS[p] ?? [])
  const ordered = orderByPreference(orderByProximity(pool), tags)
  const unmatched = demand.preferences.filter((p) => !(PREF_TAGS[p] ?? []).some((t) => pool.some((place) => place.tags.includes(t))))
  const variants: { pace: Pace; transport: TransportMode }[] =
    demand.transport === 'compare'
      ? [
          { pace: 'balanced', transport: 'public' },
          { pace: 'balanced', transport: 'charter' },
          { pace: 'balanced', transport: 'car' }
        ]
      : (['relaxed', 'balanced', 'packed'] as Pace[]).map((pace) => ({ pace, transport: demand.transport }))

  return variants.map((v) => {
    const variantDemand: Demand = { ...demand, transport: v.transport }
    const days = buildDays(variantDemand, ordered, PER_DAY[v.pace])
    const plan: Plan = {
      id: `${demand.destination}-${v.pace}-${v.transport}`,
      pace: v.pace,
      paceLabel: demand.transport === 'compare' ? TRANSPORT_LABEL[v.transport] : PACE_LABEL[v.pace],
      transport: v.transport,
      destination: demand.destination,
      suitableFor: demand.transport === 'compare' ? `${TRANSPORT_LABEL[v.transport]}出行的总价与人均` : SUITABLE[v.pace],
      highlights: highlightsOf(days),
      days,
      budget: estimateBudget(variantDemand, days),
      issues: []
    }
    plan.issues = validatePlan(plan, variantDemand)
    if (unmatched.length) {
      plan.issues.push({
        code: 'pref-unmatched',
        level: 'info',
        message: `「${unmatched.join('」「')}」在${demand.destination}没有匹配到已收录的地点，这部分偏好未体现在行程里`
      })
    }
    return plan
  })
}

/** 命中偏好 tag 多的排前面；同分保持就近顺序，所以路线不会因为偏好被打乱 */
function orderByPreference(ordered: Place[], tags: string[]): Place[] {
  if (!tags.length) return ordered
  const score = (place: Place) => tags.filter((t) => place.tags.includes(t)).length
  return [...ordered].sort((a, b) => score(b) - score(a))
}

/** 按最近邻排景点顺序，避免行程在地图上反复横跳 */
function orderByProximity(pool: Place[]): Place[] {
  const rest = [...pool]
  const out: Place[] = [rest.shift()!]
  while (rest.length) {
    const last = out[out.length - 1]
    let best = 0
    for (let i = 1; i < rest.length; i++) if (distanceKm(last, rest[i]) < distanceKm(last, rest[best])) best = i
    out.push(rest.splice(best, 1)[0])
  }
  return out
}

function buildDays(demand: Demand, ordered: Place[], perDay: number): TripDay[] {
  const days: TripDay[] = []
  for (let d = 0; d < demand.dayCount; d++) {
    const slice = ordered.slice(d * perDay, d * perDay + perDay)
    days.push(buildDay(d + 1, slice, demand.transport))
  }
  return days
}

function buildDay(index: number, slice: Place[], transport: TransportMode): TripDay {
  const items: ItineraryItem[] = []
  let t = 9 * 60
  let prev: Place | undefined
  let ateLunch = false

  slice.forEach((place) => {
    t += prev ? travelMinutes(prev, place, transport !== 'public') : 20
    // 到得比开门时间早就在门口等，否则方案自己就会报「落在营业时段外」
    if (t < place.open[0]) t = place.open[0]
    if (!ateLunch && t >= 11 * 60 + 30) {
      items.push(mealItem(index, t, false))
      t += 60
      ateLunch = true
    }
    const stay = place.stayMin
    items.push({
      id: `${place.id}-d${index}`,
      kind: 'place',
      title: place.name,
      placeId: place.id,
      startMin: t,
      endMin: t + stay,
      stayMin: stay,
      transportMin: prev ? travelMinutes(prev, place, transport !== 'public') : 20,
      transportMode: transport,
      cost: place.ticket
    })
    t += stay
    prev = place
  })

  if (!ateLunch && t > 12 * 60) {
    items.push(mealItem(index, 12 * 60, false))
  }

  return { index, items: items.sort((a, b) => a.startMin - b.startMin) }
}

const mealItem = (dayIndex: number, start: number, dinner: boolean): ItineraryItem => ({
  id: `meal-d${dayIndex}-${start}`,
  kind: 'meal',
  title: dinner ? '晚餐' : '午餐',
  startMin: start,
  endMin: start + 60,
  stayMin: 60,
  transportMin: 0,
  transportMode: 'public',
  cost: 60
})

const highlightsOf = (days: TripDay[]): string[] =>
  days
    .flatMap((d) => d.items.filter((i) => i.kind === 'place'))
    .slice(0, 4)
    .map((i) => i.title)

/** 多轮局部修改：只动受影响的当天，改完重新校验并给出变更影响（PRD 4.1 / 5.3） */
export function revisePlan(
  plan: Plan,
  demand: Demand,
  instruction: string,
  /** 当前正在看的天；指令里没写天数时改这一天，不猜第 1 天 */
  currentDay?: number
): { plan: Plan; impact: ChangeImpact } | { supported: false; reason: string } {
  const dayIndex = parseDayIndex(instruction) ?? currentDay ?? 1
  const day = plan.days.find((d) => d.index === dayIndex)
  if (!day) return { supported: false, reason: `第 ${dayIndex} 天不在本次行程里` }

  const transport = plan.transport ?? 'public'
  const used = new Set(plan.days.flatMap((d) => d.items.map((i) => i.placeId)))
  const unused = placesOf(demand.destination).filter((p) => !used.has(p.id))
  const before = snapshot(plan)

  let nextDay: TripDay
  let note: string

  if (/轻松|少走|累|慢|老人|孩子/.test(instruction)) {
    const placesInDay = day.items.filter((i) => i.kind === 'place')
    if (placesInDay.length <= 1) return { supported: false, reason: '这一天已经只剩一个景点，没有可精简的部分' }
    nextDay = retime({ index: day.index, items: day.items.filter((i) => i !== placesInDay[placesInDay.length - 1]) })
    note = `第 ${dayIndex} 天减少一个景点，节奏放缓`
  } else if (/省|便宜|预算|贵/.test(instruction)) {
    const expensive = [...day.items.filter((i) => i.kind === 'place')].sort((a, b) => b.cost - a.cost)[0]
    if (!expensive || expensive.cost === 0) return { supported: false, reason: '这一天已没有收费景点，省钱空间主要在其他支出' }
    const cheap = nearest(prevPlace(day, expensive), unused.filter((p) => p.ticket < expensive.cost))
    if (!cheap) return { supported: false, reason: '附近没有更便宜的可替代景点' }
    nextDay = retime(replaceItem(day, expensive, cheap, transport))
    note = `第 ${dayIndex} 天把「${expensive.title}」换成「${cheap.name}」，省门票`
  } else if (/换|替代|改成|不要/.test(instruction)) {
    const target = [...day.items.filter((i) => i.kind === 'place')].pop()
    const replacement = target ? nearest(prevPlace(day, target), unused) : undefined
    if (!target || !replacement) return { supported: false, reason: '没有可替换的景点' }
    nextDay = retime(replaceItem(day, target, replacement, transport))
    note = `第 ${dayIndex} 天把「${target.title}」换成「${replacement.name}」`
  } else {
    return { supported: false, reason: '这句话没识别出可执行的修改，试试「第二天轻松一点」「这一天换掉最贵的景点」' }
  }

  const days = plan.days.map((d) => (d.index === dayIndex ? nextDay : d))
  // 用方案自己的交通方式重算，compare 需求直接算会把包车方案报成公交价
  const budget = estimateBudget({ ...demand, transport }, days)
  const nextPlan: Plan = { ...plan, days, highlights: highlightsOf(days), budget }
  nextPlan.issues = validatePlan(nextPlan, { ...demand, transport })

  const after = snapshot(nextPlan)
  return {
    plan: nextPlan,
    impact: {
      minutes: after.minutes - before.minutes,
      cost: after.perPerson - before.perPerson,
      recheck: nextPlan.issues.filter((i) => i.level === 'error').map((i) => i.message).slice(0, 3),
      note
    }
  }
}

/** 「第二天」「第3天」两种写法都要认，没写天数就默认第 1 天 */
/** 「第二天」「第3天」两种写法都要认；没写天数时由调用方给当前天 */
function parseDayIndex(text: string): number | undefined {
  const hit = text.match(/第\s*([0-9一二三四五六七八九十])\s*天/)
  if (!hit) return undefined
  const zh: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
  return zh[hit[1]] ?? Number(hit[1])
}

const placeOf = (item: ItineraryItem): Place | undefined => (item.placeId ? placeById(item.placeId) : undefined)

/** 上一站：换景点后要从这里重新算路上时间，不能用被换掉那站的旧值 */
const prevPlace = (day: TripDay, target: ItineraryItem): Place | undefined => {
  for (let i = day.items.indexOf(target) - 1; i >= 0; i--) {
    const place = placeOf(day.items[i])
    if (place) return place
  }
  return undefined
}

const nearest = (from: Place | undefined, pool: Place[]): Place | undefined => {
  if (pool.length === 0) return undefined
  if (!from) return pool[0]
  return pool.reduce((best, p) => (distanceKm(from, p) < distanceKm(from, best) ? p : best))
}

const replaceItem = (day: TripDay, target: ItineraryItem, place: Place, transport: TransportMode): TripDay => {
  const prev = prevPlace(day, target)
  const transportMin = prev ? travelMinutes(prev, place, transport !== 'public') : target.transportMin
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
            endMin: i.startMin + place.stayMin,
            cost: place.ticket
          }
        : i
    )
  }
}

/** 时间被删/换之后，顺延后续时间点，避免时间轴出现空洞 */
const retime = (day: TripDay): TripDay => {
  let t = day.items[0]?.startMin ?? 9 * 60
  const items = day.items.map((i, idx) => {
    const start = idx === 0 ? t : t + i.transportMin
    const end = start + i.stayMin
    t = end
    return { ...i, startMin: start, endMin: end }
  })
  return { index: day.index, items }
}

const snapshot = (plan: Plan) => ({
  minutes: plan.days.reduce((s, d) => s + d.items.reduce((x, i) => x + i.stayMin + i.transportMin, 0), 0),
  perPerson: plan.budget.perPerson
})
