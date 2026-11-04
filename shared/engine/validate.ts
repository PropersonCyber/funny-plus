import type { Demand, ItineraryItem, Plan, PlanIssue, TripDay } from '@/types'
import { budgetLevelCap } from './budget'
import { placeById } from './placeIndex'

// PRD 六：模型负责理解和规划，程序负责计算和验证。这里就是那层「确定性校验」。
const DAY_START = 8 * 60 + 30
const DAY_END = 21 * 60
const MAX_DAY_SPAN = 12 * 60
const MAX_WALK_MIN = 150

export function validatePlan(plan: Plan, demand: Demand): PlanIssue[] {
  const issues: PlanIssue[] = []
  // 每个景点都发一条「需再确认」会把提示卡刷成流水账，攒起来最后合成一条
  const unconfirmed: string[] = []

  plan.days.forEach((day) => {
    const span = daySpan(day)
    if (span > MAX_DAY_SPAN) {
      issues.push({
        code: 'day-too-long',
        level: 'error',
        dayIndex: day.index,
        message: `第 ${day.index} 天总时长 ${fmt(span)}，超过 12 小时上限`
      })
    }
    day.items.forEach((item) => checkItem(item, day.index, issues, unconfirmed))

    const walk = walkMinutes(day)
    if (walk > MAX_WALK_MIN) {
      issues.push({
        code: 'too-much-walking',
        level: 'warn',
        dayIndex: day.index,
        message: `第 ${day.index} 天步行约 ${walk} 分钟，强度偏高`
      })
    }

    if (day.items.length === 0) {
      issues.push({ code: 'empty-day', level: 'error', dayIndex: day.index, message: `第 ${day.index} 天没有安排` })
    }
  })

  const cap = budgetLevelCap(demand.budgetLevel)
  if (cap !== undefined && plan.budget.perPerson > cap * 1.15) {
    issues.push({
      code: 'over-budget',
      level: 'warn',
      message: `人均 ${plan.budget.perPerson} 元，超预算 ${cap} 元约 ${Math.round((plan.budget.perPerson / cap - 1) * 100)}%`
    })
  }

  if (demand.party >= 6 && demand.transport === 'public') {
    issues.push({ code: 'big-group-public', level: 'info', message: '6 人以上走公共交通，建议同时比一下包车总价' })
  }
  if (demand.party >= 6) {
    issues.push({ code: 'group-vehicle', level: 'info', message: '需确认车辆核载、行李空间与住宿分房' })
  }

  if (unconfirmed.length === 1) {
    issues.push({ code: 'needs-confirm', level: 'info', message: `「${unconfirmed[0]}」的预约要求与开放时间需出发前再确认` })
  } else if (unconfirmed.length > 1) {
    const head = unconfirmed.slice(0, 2).map((n) => `「${n}」`).join('')
    issues.push({
      code: 'needs-confirm',
      level: 'info',
      message: `${head}等 ${unconfirmed.length} 个景点的预约要求与开放时间需出发前再确认`
    })
  }

  return issues
}

function checkItem(item: ItineraryItem, dayIndex: number, issues: PlanIssue[], unconfirmed: string[]) {
  if (item.startMin < DAY_START) {
    issues.push({ code: 'too-early', level: 'warn', dayIndex, message: `「${item.title}」开始时间早于 08:30` })
  }
  if (item.endMin > DAY_END) {
    issues.push({ code: 'too-late', level: 'warn', dayIndex, message: `「${item.title}」结束时间晚于 21:00` })
  }
  if (!item.placeId) return
  const place = placeById(item.placeId)
  if (!place) return
  if (item.startMin < place.open[0] || item.endMin > place.open[1]) {
    // 只有官方核验过的营业时间才配判硬冲突。待核实的数据一旦判 error，
    // 就是把「我们没核过」的锅甩给用户，误报两次之后没人再看提示卡。
    const hard = place.trust === 'official'
    issues.push({
      code: 'closed-window',
      level: hard ? 'error' : 'warn',
      dayIndex,
      message: `「${place.name}」在 ${fmt(place.open[0])}-${fmt(place.open[1])} 开放，当前安排落在时段外${
        hard ? '' : '（营业时间待核实，出发前自行确认）'
      }`
    })
  }
  // 门票与开放时间都可能变，安排进得去也仍要用户确认（PRD 4.3）
  unconfirmed.push(place.name)
}

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

export const fmt = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
