import type {
  ChangeImpact,
  AffectedChange,
  DayWindow,
  Demand,
  ItineraryItem,
  Pace,
  Plan,
  Place,
  ReviseOp,
  TransportMode,
  TripDay
} from '@/types'
import { DAY_WINDOW_LABEL } from '@/types'
import { distanceKm, hasRoute, placesLoaded, placesOf, travelMinutes } from '@/engine/placeIndex'
import { estimateBudget } from '@/engine/budget'
import { validatePlan } from '@/engine/validate'
import { linesAtPlace, nextDeparture } from '@/engine/lines'
import { applyReviseOp, highlightsOf, prevPlace } from '@/engine/planEdit'
import { openingForDay } from '@/engine/opening'
import { generateLightPlan, isLight } from '@/engine/lightPlan'
import { startOf, clock, reverseWindow, windowFeasible } from '@/engine/timeWindow'

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

export function generatePlans(demand: Demand, opts: { order?: string[] } = {}): Plan[] {
  if (!placesLoaded()) throw new UnsupportedDestination('地点数据还没取到，请检查网络后重试')
  // 有 hours 就走轻量规划：他要的是「接下来这几小时」，不是一份两天行程。
  // 分派放在这里而不是每个调用点自己判，两条入口（表单/对话）才会自动一致。
  if (isLight(demand)) return [generateLightPlan(demand)]
  const pool = placesOf(demand.destination)
  if (pool.length === 0) {
    throw new UnsupportedDestination(`A 版只开放重庆、成都、北京三个目的地，「${demand.destination}」暂未接入地点数据`)
  }
  // 必去点：按用户给的顺序取池子里真实存在的，编造或已下线的 id 直接忽略
  const must = (demand.mustVisit ?? [])
    .map((id) => pool.find((p) => p.id === id))
    .filter((p): p is Place => !!p)
  // 一天排几个点由节奏决定，点池不够时后面几天会空着：先算最少要几个点，不够就别硬凑一套行程。
  if (pool.length < demand.dayCount) {
    throw new UnsupportedDestination(
      `${demand.destination}目前收录 ${pool.length} 个地点，排不下 ${demand.dayCount} 天行程，请减少天数`
    )
  }
  const tags = demand.preferences.flatMap((p) => PREF_TAGS[p] ?? [])
  // 必去模式下用户的点序优先于任何自动排序：他说「这四站都要去」，
  // 再按偏好或就近重排一遍，等于把他点名的顺序又改回去了
  const ordered = must.length
    ? [...must, ...orderByProximity(pool.filter((p) => !must.some((m) => m.id === p.id)))]
    : opts.order?.length
      ? applyPreferredOrder(pool, opts.order)
      : orderByPreference(orderByProximity(pool), tags)
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
    // 必去模式下要把「为什么是这个出发时间」讲出来：用户只说了要去哪几个点，
    // 时间是程序倒推的，不说清楚他会以为是我们随便定的
    if (must.length) {
      const w = reverseWindow(must, variantDemand)
      if (w && windowFeasible(w)) {
        plan.issues.unshift({
          id: 'reverse-window',
          code: 'reverse-window',
          level: 'info',
          message: `按${w.basis}倒推，建议 ${clock(w.startMin)} 出发、${clock(w.endMin)} 返回`
        })
      } else if (w) {
        plan.issues.unshift({
          id: 'reverse-infeasible',
          code: 'reverse-infeasible',
          level: 'error',
          message: `这 ${must.length} 个点共需 ${w.totalMin} 分钟，要 ${clock(w.endMin)} 返回就得 ${clock(w.startMin)} 出发，早于可行时间，请减少地点或放宽返回时间`
        })
      }
    }
    if (unmatched.length) {
      plan.issues.push({
        id: 'pref-unmatched',
        code: 'pref-unmatched',
        level: 'info',
        message: `「${unmatched.join('」「')}」在${demand.destination}没有匹配到已收录的地点，这部分偏好未体现在行程里`
      })
    }
    // 延长备选（F03）：用户说「20 点左右回来」，超了不只是一句冲突，
    // 还要说清「晚多久、多玩什么」，让他有得选。只说「超时」等于把问题丢回去
    const late = latestEndOf(days)
    if (Number.isFinite(variantDemand.returnBy) && late > variantDemand.returnBy!) {
      const over = late - variantDemand.returnBy!
      plan.issues.push({
        id: 'extend-option',
        code: 'extend-option',
        level: 'info',
        message:
          `按「${clock(variantDemand.returnBy!)} 左右回来」排不下全部 ${ordered.length} 个点：` +
          `晚约 ${over} 分钟（${clock(late)} 结束）可多走 1–2 站；` +
          `要准点回，就去掉最后一站`
      })
    }
    return plan
  })
}

/** 整份行程里最晚的结束时刻；没有条目返回 0 */
const latestEndOf = (days: TripDay[]): number =>
  days.reduce((max, d) => d.items.reduce((m, i) => Math.max(m, i.endMin), max), 0)

/**
 * 模型给的顺序 → 实际的点序。
 *
 * 只认池子里真实存在的 id，且只用来把它们排到前面：模型编造或漏掉的 id 一律不认，
 * 剩下的仍按就近接在后面。模型报错一个 id 不能让行程少一个点。
 */
function applyPreferredOrder(pool: Place[], order: string[]): Place[] {
  const byId = new Map(pool.map((p) => [p.id, p]))
  const picked: Place[] = []
  const used = new Set<string>()
  for (const id of order) {
    const p = byId.get(id)
    if (!p || used.has(id)) continue
    used.add(id)
    picked.push(p)
  }
  if (!picked.length) return orderByProximity(pool)
  const rest = orderByProximity(pool).filter((p) => !used.has(p.id))
  return [...picked, ...rest]
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
    days.push(buildDay(d + 1, slice, demand))
  }
  return days
}

function buildDay(index: number, slice: Place[], demand: Demand): TripDay {
  const transport = demand.transport
  const items: ItineraryItem[] = []
  // 出发时刻由用户定：说「12 点出发」就从 12 点排，没说才是 9:00。
  // 写死 9:00 的话，用户那句话会被无声忽略，排出来的行程他一站都赶不上
  let t = startOf(demand)
  let prev: Place | undefined
  let ateLunch = false

  slice.forEach((place) => {
    // 首站没有「上一站」，不该凭空送 20 分钟路上时间——那会把出发时间推后，
    // 后面每个到达时刻跟着漂。出发就是 09:00，到早了由营业时间兜（下一行）。
    const leg = prev ? planLeg(prev, place, transport) : null
    t += leg?.minutes ?? 0
    // 到得比开门时间早就在门口等，否则方案自己就会报「落在营业时段外」。
    // 用当季时段而不是全年最保守档：夏天故宫 17:00 才关，按冬天那档等门会白等。
    const opens = openingForDay(place, demand, index).open[0]
    if (t < opens) t = opens
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
      // 首站记 0：没有路段就是没有路段，留 20 只会让「路上耗时」合计虚高
      transportMin: leg?.minutes ?? 0,
      // 首站没有路段，来源也就无从谈起；有路段时才标「真实 / 估算」
      transportSource: leg?.source,
      transportMode: transport,
      lineId: leg?.lineId,
      waitMin: leg?.waitMin ?? null,
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

type Leg = { minutes: number; source?: 'route' | 'straight'; lineId?: string; waitMin?: number }

/**
 * 一段路怎么走（FR-01）。
 *
 * 目的地站点被某条线路覆盖时，这一段就是「等下一班车再坐过去」：
 * 时间由班次表推出来，不能再用直线距离折算——那会把「每小时一班」算成「10 分钟就到」。
 * 班次未核验（首末班为 null）时不编班次，退回普通两点移动，但把 lineId 记上，
 * 好让校验与线路卡知道「这一段其实是坐车的」，从而走「暂无数据 · 影响…」空态。
 */
function planLeg(from: Place, to: Place, transport: TransportMode): Leg {
  const lines = linesAtPlace(to.id)
  if (lines.length) {
    // 多条线覆盖同一站时优先用首末班最全的那条，其次官方来源
    const line = [...lines].sort(
      (a, b) => trustWeight(b.trust) - trustWeight(a.trust) || (b.lastBus ?? 0) - (a.lastBus ?? 0)
    )[0]
    const dep = nextDeparture(line, 9 * 60)
    if (dep !== null && line.rideMin !== null) {
      const waitMin = Math.max(0, dep - 9 * 60)
      return { minutes: waitMin + line.rideMin, source: 'route', lineId: line.id, waitMin }
    }
    // 班次或耗时未核验：时间退回普通估算，但保留 lineId 让上层知道这段本该坐车
    return { minutes: travelMinutes(from, to, transport !== 'public'), source: hasRoute(from, to, transport !== 'public') ? 'route' : 'straight', lineId: line.id }
  }
  return {
    minutes: travelMinutes(from, to, transport !== 'public'),
    source: hasRoute(from, to, transport !== 'public') ? 'route' : 'straight'
  }
}

const trustWeight = (trust: string): number => ({ official: 3, credible: 2, experience: 1, pending: 0 } as Record<string, number>)[trust] ?? 0

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
/** 关键词解析不出任何可执行动作时，给用户的那句话 */
export const NO_KEYWORD_HINT = '这句话没识别出可执行的修改，试试「第二天轻松一点」「这一天换掉最贵的景点」'

/**
 * 本地离线兜底：模型不可用时按关键词认出几类常见修改，**只产出动作，不执行**。
 *
 * 拆成「解析」与「执行」两半，是因为两条调用路径要的东西不一样：
 * 客户端只要改完的结果，服务端要给前端一份带「哪条变了」的完整预览。
 * 两边都从同一个关键词表出发，就不会出现「App 内改了、服务端没改」这种分裂。
 *
 * 这不是主路径 —— 主路径是模型解析出 ReviseOp 后交给 applyReviseOp 执行。
 * 保留它是因为「AI 服务挂了」不该等于「行程改不动」：两者最终都走同一套执行与计算。
 */
export function revisePlan(
  plan: Plan,
  demand: Demand,
  instruction: string,
  /** 当前正在看的天；指令里没写天数时改这一天，不猜第 1 天 */
  currentDay?: number
): { plan: Plan; impact: ChangeImpact; affected: AffectedChange[] } | { supported: false; reason: string } {
  const guess = keywordReviseOp(plan, demand, instruction, currentDay)
  if (!guess) return { supported: false, reason: NO_KEYWORD_HINT }
  // 认出了意图但执行不了（点池排满 / 没有更便宜的）：原因要说具体，不能说「没听懂」
  if ('unsupported' in guess) return { supported: false, reason: guess.unsupported }
  const result = applyReviseOp(plan, demand, guess, 'engine')
  if (!result.ok) return { supported: false, reason: result.reason }
  // affected 一并带出：本地兜底同样知道「哪条变了」，丢掉它只剩一个总差额，
  // 用户没法判断这次改的是不是他想改的那一条
  return { plan: result.preview.plan, impact: result.preview.impact, affected: result.preview.affected }
}

/** 关键词认得出来、但当前数据执行不了的情形，带一句能直接给用户看的原因 */
export type KeywordResult = ReviseOp | { unsupported: string }

/** 关键词 → 动作。只认出后给 id，具体改成几点、花多少钱仍由 applyReviseOp 算 */
export function keywordReviseOp(
  plan: Plan,
  demand: Demand,
  instruction: string,
  currentDay?: number
): KeywordResult | null {
  const dayIndex = parseDayIndex(instruction) ?? currentDay ?? 1
  const day = plan.days.find((d) => d.index === dayIndex)
  if (!day) return null
  const used = new Set(plan.days.flatMap((d) => d.items.map((i) => i.placeId)))

  if (/轻松|少走|累|慢|老人|孩子/.test(instruction)) {
    const placesInDay = day.items.filter((i) => i.kind === 'place')
    // 与 applyReviseOp 同一条底线：这一天只剩一个景点就没什么可精简的
    if (placesInDay.length <= 1) return null
    // 说了时段就只动那个时段。「第二天下午轻松点」以前恒删当天最后一条，
    // 下午的安排还好好待着，反而把晚上那个删了 —— 这是用户能一眼看出来的错。
    const window = parseWindow(instruction)
    if (window) {
      return {
        op: 'ease',
        day: dayIndex,
        window,
        reason: `第 ${dayIndex} 天${DAY_WINDOW_LABEL[window]}减少一个景点，节奏放缓`
      }
    }
    // 没说时段：挑最后一个**没被固定**的景点，固定项不能静默吃掉
    const last = [...placesInDay].reverse().find((i) => !i.pinned)
    if (!last) return { unsupported: `第 ${dayIndex} 天的安排都被你固定了，先取消固定再精简` }
    return { op: 'drop', day: dayIndex, targetId: last.id, reason: `第 ${dayIndex} 天减少一个景点，节奏放缓` }
  }

  if (/省|便宜|预算|贵/.test(instruction)) {
    // 票价未核实（cost === null）的景点不参与「最贵」比较：拿 null 排序会把未知当成 0，选出错的替换目标
    // 固定项也不参与：用户定过的安排不能被「省钱」悄悄换掉
    const expensive = [...day.items.filter((i) => i.kind === 'place' && i.cost !== null && !i.pinned)].sort(
      (a, b) => (b.cost ?? 0) - (a.cost ?? 0)
    )[0]
    if (!expensive || (expensive.cost ?? 0) === 0) return { unsupported: '这一天已没有收费景点，省钱空间主要在其他支出' }
    const budget = expensive.cost ?? 0
    const cheap = nearest(
      prevPlace(day, expensive),
      placesOf(demand.destination).filter((p) => !used.has(p.id) && p.ticket !== null && p.ticket < budget)
    )
    if (!cheap) return null
    return {
      op: 'replace',
      day: dayIndex,
      targetId: expensive.id,
      withPlaceId: cheap.id,
      reason: `第 ${dayIndex} 天把「${expensive.title}」换成「${cheap.name}」，省门票`
    }
  }

  if (/换|替代|改成|不要/.test(instruction)) {
    const target = [...day.items.filter((i) => i.kind === 'place' && !i.pinned)].pop()
    if (!target) return null
    const replacement = nearest(
      prevPlace(day, target),
      placesOf(demand.destination).filter((p) => !used.has(p.id))
    )
    if (!replacement) {
      // 点池被排满时要说清是「收录不够」而不是「没有」，否则用户会以为产品在敷衍
      return {
        unsupported: `${demand.destination}目前收录 ${placesOf(demand.destination).length} 个地点，已全部排进这份行程，暂无可替换景点`
      }
    }
    return {
      op: 'replace',
      day: dayIndex,
      targetId: target.id,
      withPlaceId: replacement.id,
      reason: `第 ${dayIndex} 天把「${target.title}」换成「${replacement.name}」`
    }
  }

  return null
}

/** 「第二天下午」「晚上」这些时段词；没写就返回 undefined，交给调用方按整天处理 */
function parseWindow(text: string): DayWindow | undefined {
  if (/上午|早上|早晨/.test(text)) return 'morning'
  if (/下午|午后/.test(text)) return 'afternoon'
  if (/晚上|傍晚|夜间/.test(text)) return 'evening'
  return undefined
}

/** 「第二天」「第3天」两种写法都要认；没写天数时由调用方给当前天 */
function parseDayIndex(text: string): number | undefined {
  const hit = text.match(/第\s*([0-9一二三四五六七八九十])\s*天/)
  if (!hit) return undefined
  const zh: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
  return zh[hit[1]] ?? Number(hit[1])
}

const nearest = (from: Place | undefined, pool: Place[]): Place | undefined => {
  if (pool.length === 0) return undefined
  if (!from) return pool[0]
  return pool.reduce((best, p) => (distanceKm(from, p) < distanceKm(from, best) ? p : best))
}
