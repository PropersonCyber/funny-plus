import type { Demand, Plan, Place, TransitLine, TravelFact } from '@/types'
import { splitByFreshness } from '@/engine/facts'
import { transportAdvice } from '@/engine/lines'
import { validatePlan } from '@/engine/validate'

/** 分钟数换成工具里的时刻。模型只能引用这个字符串，不能自己换算。 */
export function clock(min: number | null): string | null {
  if (min === null || !Number.isFinite(min)) return null
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function placeDetailView(place: Place | undefined) {
  if (!place) return { ok: false as const, error: '地点不在收录里，不能编造营业时间或票价' }
  return {
    ok: true as const,
    id: place.id,
    name: place.name,
    city: place.city,
    openText: place.openText ?? null,
    openFrom: clock(place.open[0]),
    openUntil: clock(place.open[1]),
    ticket: place.ticket,
    ticketStatus: place.ticket === null ? '未核实' : '公示价',
    stayMin: place.stayMin,
    walk: place.walk,
    source: place.source,
    verifiedAt: place.verifiedAt ?? null,
    trust: place.trust
  }
}

/** placeId 有值时：该地点的条目，加上没有挂地点的全市条目。过期的只计数。 */
export function factsView(all: TravelFact[], city: string, placeId?: string, today = new Date()) {
  const scoped = all.filter((f) => {
    if (f.city !== city) return false
    if (!placeId) return true
    return f.placeId === placeId || !f.placeId
  })
  const { fresh, expired } = splitByFreshness(scoped, today)
  return {
    ok: true as const,
    fresh: fresh.map((f) => ({
      id: f.id,
      content: f.content,
      scope: f.scope,
      source: f.source,
      verifiedAt: f.verifiedAt,
      trust: f.trust,
      placeId: f.placeId ?? null
    })),
    expiredCount: expired.length
  }
}

export function budgetView(plan: Plan, day?: number) {
  if (day !== undefined) {
    const found = plan.days.find((d) => d.index === day)
    if (!found) return { ok: false as const, error: `当前行程没有第 ${day} 天` }
    const places = found.items
      .filter((i) => i.kind === 'place')
      .map((i) => ({
        title: i.title,
        ticket: i.cost,
        ticketStatus: i.cost === null ? '未核实' : '公示价'
      }))
    return {
      ok: true as const,
      day,
      places,
      note: '未核实票价不是免费。整天的总额以整份 budget 为准。'
    }
  }
  return {
    ok: true as const,
    items: plan.budget.items.map((i) => ({
      category: i.category,
      amount: i.amount,
      basis: i.basis,
      evidence: i.evidence
    })),
    total: plan.budget.total,
    perPerson: plan.budget.perPerson,
    uncertain: plan.budget.uncertain
  }
}

export function conflictHint(errorCount: number, attempt: number): string {
  if (errorCount <= 0) return '没有硬冲突'
  if (attempt >= 2) return '仍有硬冲突，停止再生成，向用户说明排不下的原因'
  return '有硬冲突，最多再生成一版更松的方案'
}

/**
 * 给模型看的校验结果。
 *
 * 只回 error 是刻意的：模型据此判断「要不要再松一版」，warn/info 混进来会让它
 * 以为没排好而反复重排。但回归集要断言「引擎真的判出了 over-budget」这类 warn，
 * 所以额外回一份 issues（code + level），仅供程序判定，提示词里没有引用它。
 */
export function validateView(plan: Plan, demand: Demand, attempt = 1) {
  const all = validatePlan(plan, demand)
  const errors = all.filter((i) => i.level === 'error')
  return {
    ok: true as const,
    errorCount: errors.length,
    errors: errors.map((i) => ({
      dayIndex: i.dayIndex ?? null,
      message: i.message,
      alternatives: (i.alternatives ?? []).map((a) => a.label)
    })),
    /** 全部三级问题的 code 与等级；模型不读，回归集用它判「引擎算出了什么」 */
    issues: all.map((i) => ({ code: i.code, level: i.level })),
    attempt,
    hint: conflictHint(errors.length, attempt)
  }
}

export function linesView(list: TransitLine[]) {
  return {
    ok: true as const,
    count: list.length,
    items: list.map((l) => ({
      id: l.id,
      name: l.name,
      mode: l.mode,
      firstBus: clock(l.firstBus),
      lastBus: clock(l.lastBus),
      capacity: l.capacity,
      trust: l.trust,
      source: l.source,
      verifiedAt: l.verifiedAt ?? null,
      isDemo: !!l.isDemo,
      scheduleStatus: l.firstBus === null || l.lastBus === null ? '班次未核实' : '有首末班'
    }))
  }
}

/**
 * 逐段交通比较（F05）。
 *
 * 用户问「这段怎么走」「打车还是坐观光车」「2 人和 6 人哪种合适」，要给的是
 * **当前人数下的钱与时间并列**，不是一句「建议打车」。`lines.ts` 的 transportAdvice
 * 早就算好了这件事，但一直没接到任何入口上，等于没有。
 *
 * 缺数据的处理照老规矩：票价没核实就只说时间差，核载没核实就写明假设，
 * 不能合成一个看起来精确的总分。
 */
export function segmentView(
  line: TransitLine | undefined,
  party: number,
  rideMinutes: number,
  walkMinutes: number
) {
  // 没有线路数据时只给步行与打车两种现实选择，并明确说线路「未接入」，
  // 不能给一个假的班次对比
  if (!line) {
    return {
      ok: false as const,
      party,
      walk: { minutes: walkMinutes },
      note: '这一段没有已收录的线路型交通，只能步行或打车；不要编造班次'
    }
  }
  const advice = transportAdvice(line, party, rideMinutes)
  return {
    ok: true as const,
    party,
    walk: { minutes: walkMinutes, note: '默认方式；能走下去时不必换乘' },
    ...advice,
    // 走比坐车还快时要说出来：用户往往默认「坐车一定更快」
    walkFaster: walkMinutes < (advice.options.find((o) => o.mode === 'line')?.minutes ?? Infinity)
  }
}
