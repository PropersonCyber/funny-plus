import { describe, expect, it } from 'vitest'
import { applyPatch, missingOf, toDemand } from './slots.ts'

/**
 * 槽位窄化与 Demand 落地的纯函数测试。
 *
 * 钉三件事：轻量规划不该被追问天数/预算；hours 必须真的进到 Demand
 * （漏掉的话表单里选的时长在服务端这条路上等于没选）；改口要能清空 hours。
 */
describe('missingOf', () => {
  it('整趟规划缺四要素时逐项列出来', () => {
    expect(missingOf({ destination: '北京' })).toEqual(['天数', '人数', '预算'])
  })

  it('轻量规划只要有目的地，不追问天数和预算', () => {
    expect(missingOf({ destination: '北京', hours: 4 })).toEqual([])
  })

  it('轻量规划连目的地都没有时只问目的地', () => {
    expect(missingOf({ hours: 4 })).toEqual(['目的地'])
  })
})

describe('toDemand', () => {
  it('hours 与 startMin 一起带进 Demand', () => {
    const d = toDemand({ destination: '北京', hours: 4, startMin: 840 })
    expect(d.hours).toBe(4)
    expect(d.startMin).toBe(840)
  })

  it('没给 hours 时不落这个键，走整天规划', () => {
    expect('hours' in toDemand({ destination: '北京' })).toBe(false)
  })

  it('日期仍然只在用户给了时才出现', () => {
    expect('dateFrom' in toDemand({ destination: '北京' })).toBe(false)
  })

  it('returnBy 与 mustVisit 一起带进 Demand', () => {
    const d = toDemand({ destination: '北京', returnBy: 1200, mustVisit: ['bj-gugong'] })
    expect(d.returnBy).toBe(1200)
    expect(d.mustVisit).toEqual(['bj-gugong'])
  })

  it('空的 mustVisit 不落这个键，避免被当成「必去点为空」的必去模式', () => {
    expect('mustVisit' in toDemand({ destination: '北京', mustVisit: [] })).toBe(false)
  })
})

describe('applyPatch', () => {
  it('普通字段直接写入', () => {
    const s = {}
    applyPatch(s, { destination: '北京', hours: 4 })
    expect(s).toEqual({ destination: '北京', hours: 4 })
  })

  it('hours: null 清空，改口按天数规划后不再走轻量', () => {
    const s: Record<string, unknown> = { destination: '北京', hours: 4, startMin: 840 }
    applyPatch(s, { hours: null })
    expect('hours' in s).toBe(false)
    // startMin 留着无害：没有 hours 时引擎根本不看它
    expect(missingOf(s as { destination?: string })).toEqual(['天数', '人数', '预算'])
  })

  it('undefined 不覆盖已有值', () => {
    const s: Record<string, unknown> = { destination: '北京' }
    applyPatch(s, { destination: undefined })
    expect(s.destination).toBe('北京')
  })
})
