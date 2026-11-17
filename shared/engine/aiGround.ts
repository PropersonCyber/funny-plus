import type { Demand, Plan, Place, TransitLine, TravelFact } from '@/types'
import { splitByFreshness } from '@/engine/facts'
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

export function validateView(plan: Plan, demand: Demand, attempt = 1) {
  const errors = validatePlan(plan, demand).filter((i) => i.level === 'error')
  return {
    ok: true as const,
    errorCount: errors.length,
    errors: errors.map((i) => ({
      dayIndex: i.dayIndex ?? null,
      message: i.message,
      alternatives: (i.alternatives ?? []).map((a) => a.label)
    })),
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
