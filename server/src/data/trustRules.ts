import type { TrustLevel } from '@/types/index.ts'

/**
 * 反馈与有效期如何影响「可信度」（C1 / C3）。
 *
 * 阈值全部集中在这里：它们是产品口径，不是实现细节。改口径只改这一个文件，
 * 不允许在路由里散落魔法数字。
 *
 * 为什么定得保守：`official` 这个档位只在「官方核验过」时出现，一旦被几条随手点的
 * 反馈拉下来，它就再也不代表任何东西了。所以要求「足够多的人 + 明确的多数」才动。
 */

/** 降档所需的最少反馈票数（不同 clientId / userId 各算一票） */
export const DEMOTE_MIN_VOTES = 3

/** 负面占比达到多少才降档：只要还有相当比例的人说是适用的，就不该被少数人拉下来 */
export const DEMOTE_RATIO = 0.6

/**
 * 降档顺序：每次只往下一级。
 *
 * 不跳档的理由：从「官方已核验」直接掉到「尚待核实」，用户无法判断到底有多不可信；
 * 而多条规则同时命中时连降两级，等于把两条独立的怀疑叠成一个更严重的结论。
 */
export const downgrade = (t: TrustLevel): TrustLevel => {
  if (t === 'official') return 'credible'
  if (t === 'credible') return 'experience'
  return 'pending'
}

export type FeedbackStat = { met: number; notApplicable: number }

export type TrustVerdict = { trust: TrustLevel; note?: string }

const todayISO = (): string => new Date().toISOString().slice(0, 10)

/**
 * 算出一条避坑信息当下应当显示的可信度。
 *
 * 两条触发条件（C3 过期、C1 反馈）只降一档，原因全部拼进 note ——
 * 悄悄把「官方已核验」改成「可靠来源」而不说明为什么，用户会以为是数据坏了。
 */
export function resolveTrust(
  fact: { trust: TrustLevel; validUntil?: string },
  stat: FeedbackStat | undefined,
  today = todayISO()
): TrustVerdict {
  const reasons: string[] = []

  // C3：过了有效期就不能再声称已核验。界面已经会把过期条目折叠（splitByFreshness），
  // 这里管的是「用户点开还看得见的那条」——它同样不该顶着旧核验日期说话。
  if (fact.validUntil && fact.validUntil < today) reasons.push('已过有效期')

  const total = (stat?.met ?? 0) + (stat?.notApplicable ?? 0)
  const bad = stat?.notApplicable ?? 0
  // C1：票数不够时一律不动。两条反馈说不对就降官方的档，等于让噪音改数据。
  if (total >= DEMOTE_MIN_VOTES && bad / total >= DEMOTE_RATIO) {
    reasons.push(`${total} 条反馈里 ${bad} 条说不适用`)
  }

  if (!reasons.length) return { trust: fact.trust }
  return { trust: downgrade(fact.trust), note: reasons.join('；') }
}

/**
 * 补录生效（C2）的门槛：多少个**独立设备**提交同一个值才写进线上数据。
 *
 * 定 2 而不是 1：单条补录就是一个人说的，直接写进线上表等于把用户填报当官方数据 ——
 * 而 schema 里那条注释写得很清楚，补录只能进池子，不能升档成 official。
 * 这里只做「填上缺失的值」，trust 一个字都不动，所以行程里它最多提示、不会拦人。
 */
export const SUBMIT_CONFIRM_VOTES = 2

/** 允许自动生效的字段白名单：只补班次与营业时间这类事实性字段，且只在原值为空时填 */
export const SUBMIT_PROMOTABLE = {
  line: ['firstBus', 'lastBus', 'intervalMin'],
  place: ['openText']
} as const
