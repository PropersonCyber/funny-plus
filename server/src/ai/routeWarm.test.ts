import { describe, expect, it } from 'vitest'
import { routeModeOf, warmRoutes } from './routeWarm.ts'
import type { Demand, Plan } from '@/types/index.ts'

/**
 * G1 的可测部分。
 *
 * 真正打高德的那条路不在这里测：`.env` 里 `AMAP_KEY` 是活的，跑一次就烧一次配额，
 * 而且结果随路况变，钉不住。这里钉两件不依赖网络的事——映射对不对，
 * 以及「没有相邻路段时不该发任何请求」（发出去就是白烧配额）。
 */

const demand = (over: Partial<Demand> = {}): Demand => ({
  destination: '测试城',
  dayCount: 1,
  party: 2,
  budgetLevel: 'mid',
  preferences: [],
  transport: 'public',
  notes: '',
  ...over
})

const emptyPlan = (): Plan => ({
  id: 'p',
  pace: 'balanced',
  paceLabel: '测试',
  transport: 'public',
  destination: '测试城',
  suitableFor: '测试',
  highlights: [],
  days: [{ index: 1, items: [] }],
  budget: { items: [], total: 0, perPerson: 0, uncertain: [] },
  issues: []
})

describe('服务端路段耗时（G1）', () => {
  it('交通方式映射：公交走步行路线，其余走驾车', () => {
    expect(routeModeOf('public')).toBe('walking')
    expect(routeModeOf('car')).toBe('driving')
    expect(routeModeOf('charter')).toBe('driving')
    expect(routeModeOf('compare')).toBe('driving')
  })

  it('没有相邻路段时不发请求', async () => {
    const res = await warmRoutes(demand(), [emptyPlan()])
    expect(res).toEqual({ asked: 0, hit: 0 })
  })
})
