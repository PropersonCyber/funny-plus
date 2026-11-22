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
 * 展示用的可信状态：构建期快照永远不许说成「已核验」。
 *
 * 随包 data/*.json 与本次会话拉下来的那份，都可能比库里的旧——库里改过 trust 或有效期后，
 * 快照还在按老样子显示「官方已核验」。所以不论快照里的 trust 写的是什么，
 * 没有 canonical 来路就最多降一档到「可靠来源 · 随包快照」。
 * 缺省 origin 视为 canonical：接口与库里的行不带这个字段。
 */
export const displayTrust = (fact: Pick<TravelFact, 'trust' | 'origin'>): TrustLevel => {
  if (fact.origin !== 'bundled') return fact.trust
  return fact.trust === 'official' ? 'credible' : fact.trust
}

/** 快照时要额外说清来路，否则用户分不出「这份是刚核验的」还是「打进包里的旧副本」 */
export const originNote = (fact: Pick<TravelFact, 'origin'>): string => {
  if (fact.origin === 'bundled') return '随包快照 · 未与服务端核对'
  if (fact.origin === 'server') return '本次从服务端拉取'
  return ''
}

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
