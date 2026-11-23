import type { Demand, IssueAlternative, ItineraryItem, Plan, PlanIssue, TripDay } from '@/types'
import { budgetLevelCap } from './budget'
import { placeById } from './placeIndex'
import { canJudgeHard, lineById, nextDeparture } from './lines'
import { closureIssue, closureOf, dayDateOf } from './dayDate'

// PRD 六：模型负责理解和规划，程序负责计算和验证。这里就是那层「确定性校验」。
const DAY_START = 8 * 60 + 30
const DAY_END = 21 * 60
const MAX_DAY_SPAN = 12 * 60
const MAX_WALK_MIN = 150
/** 到站后等到下一班的时间超过班次间隔的这么多倍，就提示（FR-02 第 2 步） */
const WAIT_FACTOR = 2

/**
 * FR-02 的判定顺序是硬要求，不能跳步：
 * 1 硬约束（末班 / 首班 / 需提前购票 / 营业时间）→ 违反即 error；
 * 2 等待成本 → warn；
 * 3 软约束（日时长 / 步行 / 预算）→ 沿用 V0.1 规则。
 * 顺序体现在 issues 的排列上：界面按顺序展示，用户先看到必须解决的。
 */
export function validatePlan(plan: Plan, demand: Demand): PlanIssue[] {
  const hard: PlanIssue[] = []
  const wait: PlanIssue[] = []
  const soft: PlanIssue[] = []
  const unconfirmed: string[] = []

  plan.days.forEach((day) => {
    checkDay(day, hard, wait, soft, unconfirmed, demand)
  })

  const cap = budgetLevelCap(demand.budgetLevel)
  if (cap !== undefined && plan.budget.perPerson > cap * 1.15) {
    soft.push({
      id: `over-budget`,
      code: 'over-budget',
      level: 'warn',
      message: `人均 ${plan.budget.perPerson} 元，超预算 ${cap} 元约 ${Math.round((plan.budget.perPerson / cap - 1) * 100)}%`
    })
  }

  if (demand.party >= 6 && demand.transport === 'public') {
    soft.push({ id: 'big-group-public', code: 'big-group-public', level: 'info', message: '6 人以上走公共交通，建议同时比一下包车总价' })
  }
  if (demand.party >= 6) {
    soft.push({ id: 'group-vehicle', code: 'group-vehicle', level: 'info', message: '需确认车辆核载、行李空间与住宿分房' })
  }

  if (unconfirmed.length === 1) {
    soft.push({ id: 'needs-confirm', code: 'needs-confirm', level: 'info', message: `「${unconfirmed[0]}」的预约要求与开放时间需出发前再确认` })
  } else if (unconfirmed.length > 1) {
    const head = unconfirmed.slice(0, 2).map((n) => `「${n}」`).join('')
    soft.push({
      id: 'needs-confirm',
      code: 'needs-confirm',
      level: 'info',
      message: `${head}等 ${unconfirmed.length} 个景点的预约要求与开放时间需出发前再确认`
    })
  }

  return [...dedupe(hard), ...dedupe(wait), ...dedupe(soft)]
}

/** 同一 id 只留一条：同一条线的同一问题在一趟行程里报 3 次只会让人关掉提示卡 */
function dedupe(list: PlanIssue[]): PlanIssue[] {
  const seen = new Set<string>()
  return list.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)))
}

function checkDay(
  day: TripDay,
  hard: PlanIssue[],
  wait: PlanIssue[],
  soft: PlanIssue[],
  unconfirmed: string[],
  demand: Demand
) {
  const span = daySpan(day)
  if (span > MAX_DAY_SPAN) {
    soft.push({
      id: `day-too-long-d${day.index}`,
      code: 'day-too-long',
      level: 'error',
      dayIndex: day.index,
      message: `第 ${day.index} 天总时长 ${fmt(span)}，超过 12 小时上限`
    })
  }
  day.items.forEach((item) => checkItem(item, day, hard, wait, soft, unconfirmed))

  // 闭馆判断只在日期已知时做：拿今天充数会凭空造出用户没定过的出行日，
  // 「周一闭馆」的提示也就变成了噪音（见 dayDate.ts 的注释）
  const date = dayDateOf(demand, day.index)
  if (date) {
    for (const item of day.items) {
      if (item.kind !== 'place' || !item.placeId) continue
      const place = placeById(item.placeId)
      if (!place) continue
      const closure = closureOf(place, date)
      if (closure.closed) hard.push(closureIssue(day, item, date, closure.note!))
    }
  }

  const walk = walkMinutes(day)
  if (walk > MAX_WALK_MIN) {
    soft.push({
      id: `too-much-walking-d${day.index}`,
      code: 'too-much-walking',
      level: 'warn',
      dayIndex: day.index,
      message: `第 ${day.index} 天步行约 ${walk} 分钟，强度偏高`
    })
  }

  if (day.items.length === 0) {
    soft.push({ id: `empty-day-d${day.index}`, code: 'empty-day', level: 'error', dayIndex: day.index, message: `第 ${day.index} 天没有安排` })
  }
}

function checkItem(
  item: ItineraryItem,
  day: TripDay,
  hard: PlanIssue[],
  wait: PlanIssue[],
  soft: PlanIssue[],
  unconfirmed: string[]
) {
  if (item.startMin < DAY_START) {
    soft.push({
      id: `too-early-${item.id}`,
      code: 'too-early',
      level: 'warn',
      dayIndex: day.index,
      message: `「${item.title}」开始时间早于 08:30`
    })
  }
  if (item.endMin > DAY_END) {
    soft.push({
      id: `too-late-${item.id}`,
      code: 'too-late',
      level: 'warn',
      dayIndex: day.index,
      message: `「${item.title}」结束时间晚于 21:00`
    })
  }

  // FR-01/02：这一段是坐线路型交通走的，先按班次判，再谈营业时间
  if (item.lineId) checkLineSegment(item, day, hard, wait, soft)

  if (!item.placeId) return
  const place = placeById(item.placeId)
  if (!place) return
  if (item.startMin < place.open[0] || item.endMin > place.open[1]) {
    // 只有官方核验过的营业时间才配判硬冲突。待核实的数据一旦判 error，
    // 就是把「我们没核过」的锅甩给用户，误报两次之后没人再看提示卡。
    const isHard = place.trust === 'official'
    const alt = isHard ? nextDayAlternatives(day, `「${place.name}」在 ${fmt(place.open[0])} 开门，提前到点也进不去`) : undefined
    push(hard, soft, {
      id: `closed-window-${place.id}`,
      code: 'closed-window',
      level: isHard ? 'error' : 'warn',
      dayIndex: day.index,
      message: `「${place.name}」在 ${fmt(place.open[0])}-${fmt(place.open[1])} 开放，当前安排落在时段外${
        isHard ? '' : '（营业时间待核实，出发前自行确认）'
      }`,
      alternatives: alt
    })
  }
  // 门票与开放时间都可能变，安排进得去也仍要用户确认（PRD 4.3）
  unconfirmed.push(place.name)
}

/**
 * 线路段的三档判断。
 *
 * 关键分寸：**未核验的班次不产生 error**。"用户填报"或"暂无数据"时最多 warn 并标待确认，
 * 否则一次误报就让用户从此不信任何提示（PRD FR-02 / 风险表）。
 */
function checkLineSegment(item: ItineraryItem, day: TripDay, hard: PlanIssue[], wait: PlanIssue[], soft: PlanIssue[]) {
  const line = lineById(item.lineId!)
  if (!line) return
  const hard_ok = canJudgeHard(line)
  const lastBus = line.lastBus
  const missLabel = line.lastBus === null ? '暂无末班时间' : `末班 ${fmt(line.lastBus)}`
  const impact = `你可能排到 ${fmt(item.endMin)} 却无车可回`

  // 1. 末班：到站/离开时刻晚于末班 = 没有车了
  if (lastBus === null) {
    wait.push({
      id: `no-lastbus-${line.id}-d${day.index}`,
      code: 'no-lastbus',
      level: 'warn',
      dayIndex: day.index,
      lineId: line.id,
      message: `${line.name}${missLabel} · ${impact}`,
      alternatives: [{ kind: 'advance', label: '补一条末班时间（提交后立刻用于你这份行程）' }]
    })
  } else if (item.startMin >= lastBus) {
    const alts = lineAlternatives(line, item, day)
    push(hard, soft, {
      id: `after-lastbus-${line.id}-d${day.index}`,
      code: 'after-lastbus',
      level: hard_ok ? 'error' : 'warn',
      dayIndex: day.index,
      lineId: line.id,
      message: `${line.name}末班 ${fmt(lastBus)}，当前安排 ${fmt(item.startMin)} 才到站${
        hard_ok ? '' : `（班次未核验，按现有来源为「${line.source}」）`
      }`,
      alternatives: alts
    })
  } else if (line.firstBus !== null && item.startMin < line.firstBus) {
    push(hard, soft, {
      id: `before-firstbus-${line.id}-d${day.index}`,
      code: 'before-firstbus',
      level: hard_ok ? 'error' : 'warn',
      dayIndex: day.index,
      lineId: line.id,
      message: `${line.name}首班 ${fmt(line.firstBus)}，当前 ${fmt(item.startMin)} 到站还没开始运营`,
      alternatives: [{ kind: 'advance', label: `把这一段挪到 ${fmt(line.firstBus)} 之后` }]
    })
  }

  // 2. 等待成本：等太久不拦，但要告诉用户「等多久」这个真实代价
  const dep = nextDeparture(line, item.startMin)
  if (dep === null) return
  const waiting = dep - item.startMin
  if (line.intervalMin !== null && line.intervalMin > 0 && waiting > line.intervalMin * WAIT_FACTOR) {
    wait.push({
      id: `long-wait-${line.id}-d${day.index}`,
      code: 'long-wait',
      level: 'warn',
      dayIndex: day.index,
      lineId: line.id,
      message: `${line.name}要等约 ${waiting} 分钟（${fmt(dep)} 发车，间隔约 ${line.intervalMin} 分钟）`,
      alternatives: [{ kind: 'advance', label: `把这一段挪到 ${fmt(dep)} 前后，少等 ${waiting} 分钟` }]
    })
  }

  // 3. 必须提前购票/预约，而行程里没留出排队取票的时间
  if (line.needAdvance === true) {
    soft.push({
      id: `need-advance-${line.id}-d${day.index}`,
      code: 'need-advance',
      level: 'warn',
      dayIndex: day.index,
      lineId: line.id,
      message: `${line.name}需提前购票/预约，现场排队可能超 1 小时`
    })
  }
}

/** error 必须同时给至少一条出路；一条都给不出时界面要明说「暂无可替代」（由 UI 负责） */
function lineAlternatives(line: NonNullable<ReturnType<typeof lineById>>, item: ItineraryItem, day: TripDay): IssueAlternative[] {
  const alts: IssueAlternative[] = []
  if (line.lastBus !== null) {
    const latestStart = line.lastBus
    alts.push({ kind: 'advance', label: `把这一段挪到 ${fmt(latestStart)} 之前` })
  }
  if (item.transportMode !== 'charter' && item.transportMode !== 'car') {
    alts.push({ kind: 'switch-mode', label: '改打车 / 包车（人数对比见线路卡）' })
  } else {
    alts.push({ kind: 'switch-mode', label: '改走公共交通或打车' })
  }
  if (day.items.filter((i) => i.kind === 'place').length > 1) {
    alts.push({ kind: 'change-spot', label: '换掉这一天的一个景点，提前回程' })
  }
  return alts
}

const nextDayAlternatives = (day: TripDay, reason: string): IssueAlternative[] =>
  day.items.filter((i) => i.kind === 'place').length > 1
    ? [
        { kind: 'advance', label: `${reason}，把这站挪到开放时段内` },
        { kind: 'change-spot', label: '换一个当天开放的景点' }
      ]
    : [{ kind: 'advance', label: `${reason}，需要改期或换点` }]

const push = (hard: PlanIssue[], other: PlanIssue[], issue: PlanIssue) =>
  (issue.level === 'error' ? hard : other).push(issue)

export const daySpan = (day: TripDay): number =>
  day.items.length === 0 ? 0 : day.items[day.items.length - 1].endMin - day.items[0].startMin

export const walkMinutes = (day: TripDay): number =>
  day.items
    .filter((i) => i.kind === 'place')
    .reduce((s, i) => s + (placeById(i.placeId!)?.walk ?? 1) * i.stayMin * 0.15, 0) | 0

/** 校验结果分三档，「没有 error」不等于已通过：待确认项一样要讲出来 */
export type PlanStatus = 'conflict' | 'warn' | 'unverified' | 'ok'

export const planStatus = (issues: PlanIssue[]): PlanStatus => {
  if (issues.some((i) => i.level === 'error')) return 'conflict'
  if (issues.some((i) => i.level === 'warn')) return 'warn'
  if (issues.some((i) => i.level === 'info')) return 'unverified'
  return 'ok'
}

/**
 * FR-06 的横切口径：任何一个数字旁边都要有状态，不允许裸数字。
 * 这个函数就是那唯一一处「状态 → 文案 + 是否参与计算」的映射。
 */
export type DataStatus = 'verified' | 'reported' | 'missing'

export interface StatusBadge {
  status: DataStatus
  label: string
  /** 这个状态能不能参与 error 判定 */
  canError: boolean
  /** 缺失时告诉用户「影响是什么」，空态文案必须带影响 */
  impact?: string
}

export const statusOfTrust = (trust: string, opts: { missingImpact?: string } = {}): StatusBadge => {
  if (trust === 'official') return { status: 'verified', label: '官方已核验', canError: true }
  if (trust === 'credible') return { status: 'verified', label: '可靠来源 · 待官方复核', canError: false }
  if (trust === 'experience') return { status: 'reported', label: '用户填报 · 未核验', canError: false }
  return { status: 'missing', label: '暂无数据', canError: false, impact: opts.missingImpact }
}

export const fmt = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
