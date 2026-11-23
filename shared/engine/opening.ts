import type { Demand, Place } from '@/types'
import { dayDateOf, weekdayOf } from '@/engine/dayDate'

/**
 * 营业时间的季节档（N3 日期之后的第二件事）。
 *
 * 地点表里 `open` 存的是**全年最保守的交集**（`scripts/verify-amap.ts` 取最晚开门、
 * 最早关门）：故宫 `open` 是 08:30–16:00，可它夏天开到 17:00、冬天 16:30 就停检。
 * 日期一旦接上，「这天几点关门」就该跟着季节走，而不是一年到头按最坏那档算 ——
 * 那会把本来排得下的夏天行程判成「落在营业时段外」。
 *
 * 两条与闭馆判断同源的铁律：
 * 1. **只在日期已知时才按季节取档**。`dateFrom` 为空时一律用 `open`（最坏那档）：
 *    不知道哪天去，就不能替用户挑一档更宽松的，否则他在冬天看到的是夏天的关门时间。
 * 2. **只有结构化 `seasons` 才取档**。没有这一项 = 这天的季节时段没核过，退回 `open`。
 *    绝不从 `openText` 现算 —— 见 `Place.seasons` 的注释。
 */

/** 某一档是否覆盖这一天；`from`/`to` 为 MM-DD，支持跨年 */
function covers(season: { from: string; to: string }, mmdd: string): boolean {
  const { from, to } = season
  if (!/^\d{2}-\d{2}$/.test(from) || !/^\d{2}-\d{2}$/.test(to) || !/^\d{2}-\d{2}$/.test(mmdd)) return false
  return from <= to ? mmdd >= from && mmdd <= to : mmdd >= from || mmdd <= to
}

export type Opening = {
  /** 当天实际的 [开门, 关门]，当日分钟数 */
  open: [number, number]
  /** 这档是从季节表里取到的；false 表示用的是全年最保守交集 */
  bySeason: boolean
  /** 取自哪一档的原文（`bySeason` 为真时才有） */
  note?: string
}

/**
 * 这个地点在这一天的营业时段。
 *
 * 取不到季节档就返回 `place.open`，并明确标 `bySeason: false` ——
 * 界面据此才知道「这是全年最坏那档，不是这天的真实时间」。
 */
export function openingOf(place: Place, iso: string | undefined): Opening {
  if (!iso) return { open: place.open, bySeason: false }
  // 格式对不代表日期存在：`2026-13-45` 也能过 MM-DD 正则，但取它会拿一个不存在的日子去比季节档。
  // 用 dayDate.ts 的同一条校验（weekdayOf 对非法日期返 null），避免两处日历口径不一致。
  if (weekdayOf(iso) === null) return { open: place.open, bySeason: false }
  const mmdd = iso.slice(5)
  const hit = (place.seasons ?? []).find((s) => covers(s, mmdd))
  if (!hit) return { open: place.open, bySeason: false }
  return { open: hit.open, bySeason: true, note: hit.text }
}

/**
 * 这一天的营业时段（按 demand 推日期）。
 *
 * 引擎里几乎所有调用点都是这个形状：手里有 demand 和 dayIndex，没有具体日期串。
 * 单独包一层，避免每个调用点都自己 `dayDateOf` 一次再 `openingOf`。
 */
export const openingForDay = (place: Place, demand: Pick<Demand, 'dateFrom' | 'dayCount'>, dayIndex: number): Opening =>
  openingOf(place, dayDateOf(demand, dayIndex))
