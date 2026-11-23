import type { Demand, ItineraryItem, PlanIssue, TripDay } from '@/types'

/**
 * 闭馆判断（N3 日期之后的必然下一步）。
 *
 * 日期一旦接上，「这天到底开不开」就不再是可选项：故宫周一闭馆、国博周一会关，
 * 而行程页只会照常把点排进去。用户不会在出发当天才发现，而是在门口。
 *
 * 两条铁律：
 * 1. **只在已知日期时判**。`dateFrom` 为空时一律不判 —— 拿今天充数会凭空造出一个
 *    用户没定过的出行日，而「周一闭馆」的提示会因此变成噪音。
 * 2. **只有结构化闭馆数据才判**。`closedWeekdays` 为空 = 没核过，不是「每天都开」。
 *    从 `openText` 里正则抠周几闭馆就等于把自由文本当数据源，判错一次就把
 *    「今天闭馆」说成「今天开放」，比不判更糟。
 */

/** `YYYY-MM-DD` → 0=周日 … 6=周六；格式不对返回 null，调用方据此当作「日期未知」 */
export function weekdayOf(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  // 用 UTC 构造：`new Date('2026-12-05')` 也是 UTC 零点，两边一致才不会跨时区错一天
  const t = Date.parse(`${iso}T00:00:00Z`)
  if (Number.isNaN(t)) return null
  return new Date(t).getUTCDay()
}

/**
 * 这一天这个点开放吗。
 *
 * `weekday` 为 null（日期未知）时一律返回 open：宁可不判，也不要凭空提示闭馆。
 */
export function closureOf(
  place: { closedWeekdays?: number[]; closedRanges?: { from: string; to: string; note?: string }[] },
  iso: string | undefined
): { closed: boolean; note?: string } {
  if (!iso) return { closed: false }
  const weekday = weekdayOf(iso)
  if (weekday === null) return { closed: false }
  if ((place.closedWeekdays ?? []).includes(weekday)) {
    return { closed: true, note: `每周${WEEKDAY_CN[weekday]}不开放` }
  }
  const mmdd = iso.slice(5)
  for (const range of place.closedRanges ?? []) {
    if (withinMmDd(mmdd, range.from, range.to)) {
      return { closed: true, note: range.note ?? `${range.from} 至 ${range.to} 闭馆` }
    }
  }
  return { closed: false }
}

const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六']

/**
 * MM-DD 是否落在 [from, to] 内，支持跨年区间（如 12-20 至 01-10）。
 * 只比字符串会漏掉跨年：`'12-25' <= '01-10'` 为 false。
 */
export function withinMmDd(value: string, from: string, to: string): boolean {
  if (!/^\d{2}-\d{2}$/.test(value)) return false
  if (from <= to) return value >= from && value <= to
  // 跨年：区间被年界线切成两段
  return value >= from || value <= to
}

/**
 * 把闭馆点从「硬冲突」的语义上讲清楚：它比营业时间更硬。
 *
 * 营业时间不对可以挪到开放时段内；闭馆是整天都不开，挪时间没有意义，
 * 只有「换一天」或「换一个点」两条出路。所以给的是 change-day / change-spot，
 * 而不是 advance（`IssueAlternative` 目前没有 change-day，用 advance + 文案说清）。
 */
export function closureIssue(day: TripDay, item: ItineraryItem, iso: string, note: string): PlanIssue {
  return {
    id: `closed-weekday-${item.id}`,
    code: 'closed-weekday',
    level: 'error',
    dayIndex: day.index,
    message: `「${item.title}」${iso} ${note}，这一天进不去`,
    alternatives: [
      { kind: 'advance', label: `把「${item.title}」挪到不闭馆的那天` },
      { kind: 'change-spot', label: '换一个当天开放的景点' }
    ]
  }
}

/**
 * 第 `dayIndex` 天对应哪一天。`dateFrom` 为空、或日期不合法时返回 undefined。
 *
 * `dayIndex` 从 1 开始；`dateFrom` 就是第 1 天。不用本地时区做加减 ——
 * 全程按 UTC 算，跨时区打开 App 不会让「第 2 天」变成前一天。
 */
export function dayDateOf(demand: Demand, dayIndex: number): string | undefined {
  if (!demand.dateFrom) return undefined
  const base = Date.parse(`${demand.dateFrom}T00:00:00Z`)
  if (Number.isNaN(base)) return undefined
  if (!Number.isInteger(dayIndex) || dayIndex < 1) return undefined
  return new Date(base + (dayIndex - 1) * 86_400_000).toISOString().slice(0, 10)
}

/**
 * 行程页顶部那一行日期文案。
 *
 * 未填日期时返回「日期未定」，**不留空、不写「待定」以外的任何猜测** ——
 * 设计稿里原来写死的示例日期曾经就摆在这里，跟真实预算并排，看起来像真数据。
 */
export function dateRangeLabel(demand: Demand): string {
  if (!demand.dateFrom) return '日期未定'
  const first = demand.dateFrom
  const last = dayDateOf(demand, Math.max(1, demand.dayCount))
  // 单日行程别写成 "12-05 - 12-05"
  if (!last || last === first) return shortDate(first)
  return `${shortDate(first)} - ${shortDate(last)}`
}

/** `2026-12-05` → `12月5日`；格式不对原样返回，绝不编一个日期出来 */
export function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  return `${Number(m[2])}月${Number(m[3])}日`
}
