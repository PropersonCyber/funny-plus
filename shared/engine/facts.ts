import type { TravelFact, TrustLevel } from '@/types'

export const trustLabel: Record<TrustLevel, string> = {
  official: '官方已核验',
  credible: '可靠来源',
  experience: '用户经验',
  pending: '尚待核实'
}

/** 过了有效期就不再作为当前有效信息展示（A2）；无有效期的条目无法判过期，保持可见 */
export const isExpired = (fact: TravelFact, today = new Date()): boolean =>
  !!fact.validUntil && fact.validUntil < today.toISOString().slice(0, 10)

/**
 * A2 定的口径是「默认不展示，但要告知还有 N 条」。
 * 只过滤不计数等于悄悄吞掉内容，用户没法判断是没数据还是被藏了，所以两个数一起给。
 */
export function splitByFreshness(facts: TravelFact[], today = new Date()): { fresh: TravelFact[]; expired: TravelFact[] } {
  const fresh: TravelFact[] = []
  const expired: TravelFact[] = []
  for (const f of facts) (isExpired(f, today) ? expired : fresh).push(f)
  return { fresh, expired }
}
