import type { TravelFact } from '@/types'

export const trustLabel: Record<TravelFact['trust'], string> = {
  official: '官方已核验',
  credible: '可靠来源',
  experience: '用户经验',
  pending: '尚待核实'
}

/** 过了有效期就不再作为当前有效信息展示（A2）；无有效期的条目无法判过期，保持可见 */
export const isExpired = (fact: TravelFact): boolean =>
  !!fact.validUntil && fact.validUntil < new Date().toISOString().slice(0, 10)
