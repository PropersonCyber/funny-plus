import { describe, expect, it } from 'vitest'
import { JOURNEY_STEPS, journeyFunnels, percentile, summarize } from './metrics.ts'
import type { AiCallRow } from './metrics.ts'

const row = (over: Partial<AiCallRow> = {}): AiCallRow => ({
  kind: 'chat',
  sessionId: 's1',
  journey: null,
  durationMs: 100,
  toolCalls: 0,
  toolFailures: 0,
  planGenerated: false,
  planAttempts: 0,
  degraded: false,
  promptVersion: '2026-11-22.1',
  // 默认「没记到用量」而不是 0：测试与线上一样，缺省不该被当成免费
  inputTokens: null,
  outputTokens: null,
  costMicros: null,
  ...over
})

/** 造一串「某会话在某旅程下触发了这些事件」 */
const events = (journey: string, session: string, list: string[]) =>
  list.map((event) => ({ journey, sessionId: session, event }))

describe('percentile', () => {
  it('空数组返回 0，不抛', () => {
    expect(percentile([], 95)).toBe(0)
  })

  it('最近秩取到长尾里的值，不做插值', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1)
    // p95 → ceil(0.95*100)-1 = 94 → 第 95 小的值
    expect(percentile(values, 95)).toBe(95)
    expect(percentile(values, 100)).toBe(100)
  })
})

describe('summarize', () => {
  it('空集合不除零，所有比率为 0', () => {
    const s = summarize([])
    expect(s.calls).toBe(0)
    expect(s.planRate).toBe(0)
    expect(s.degradeRate).toBe(0)
    expect(s.toolSuccessRate).toBe(0)
    expect(s.avgDurationMs).toBe(0)
  })

  it('生成方案的分母是对话数而不是全部调用数', () => {
    // 改行程的调用本来就不该产出方案，算进分母会让「生成率」凭空变低
    const s = summarize([
      row({ kind: 'chat', planGenerated: true }),
      row({ kind: 'chat', planGenerated: false }),
      row({ kind: 'revise' })
    ])
    expect(s.chatCalls).toBe(2)
    expect(s.reviseCalls).toBe(1)
    expect(s.planGenerated).toBe(1)
    expect(s.planRate).toBeCloseTo(0.5, 5)
  })

  it('工具成功率的分母是调用总数，失败的调用也算在内', () => {
    const s = summarize([row({ toolCalls: 3, toolFailures: 0 }), row({ toolCalls: 2, toolFailures: 1 })])
    expect(s.toolCalls).toBe(5)
    expect(s.toolFailures).toBe(1)
    expect(s.toolSuccessRate).toBeCloseTo(0.8, 5)
  })

  it('降级按调用数统计，能算出占比', () => {
    const s = summarize([row({ degraded: true }), row({ kind: 'revise', degraded: true }), row()])
    expect(s.degraded).toBe(2)
    expect(s.degradeRate).toBeCloseTo(2 / 3, 5)
  })

  it('方案重试 = planAttempts > 1 的对话数', () => {
    const s = summarize([row({ planAttempts: 2 }), row({ planAttempts: 1 }), row({ planAttempts: 3 })])
    expect(s.retriedPlans).toBe(2)
  })

  it('平均延迟跳过 0 值：未测到耗时的行不该拉低均值', () => {
    const s = summarize([row({ durationMs: 0 }), row({ durationMs: 200 }), row({ durationMs: 400 })])
    expect(s.avgDurationMs).toBe(300)
    expect(s.p95DurationMs).toBe(400)
  })
})

describe('journeyFunnels', () => {
  it('每个旅程都有漏斗，步骤来自 JOURNEY_STEPS', () => {
    const funnels = journeyFunnels([])
    expect(funnels.map((f) => f.journey)).toEqual(Object.keys(JOURNEY_STEPS))
    expect(funnels[0]?.steps.map((s) => s.event)).toEqual(JOURNEY_STEPS.plan)
  })

  it('按会话去重：同一会话反复触发同一事件只算一个', () => {
    const rows = [
      ...events('plan', 'a', ['plan_submitted', 'plan_submitted', 'plan_submitted']),
      ...events('plan', 'b', ['plan_submitted'])
    ]
    const plan = journeyFunnels(rows).find((f) => f.journey === 'plan')
    expect(plan?.steps[0]?.sessions).toBe(2)
  })

  it('掉得最多的那一跳被指出来', () => {
    // 3 个会话提交 → 1 个点开对比 → 1 个挑方案 → 1 个采纳
    const rows = [
      ...events('plan', 'a', ['plan_submitted', 'compare_open', 'compare_pick', 'plan_adopted']),
      ...events('plan', 'b', ['plan_submitted']),
      ...events('plan', 'c', ['plan_submitted'])
    ]
    const plan = journeyFunnels(rows).find((f) => f.journey === 'plan')
    expect(plan?.steps.map((s) => s.sessions)).toEqual([3, 1, 1, 1])
    // 第一跳掉了 2 个，之后都是 0，所以断点在 plan_submitted → compare_open
    expect(plan?.biggestDrop).toEqual({ from: 'plan_submitted', to: 'compare_open', lost: 2 })
  })

  it('一路走到底时不报断点', () => {
    const rows = events('revise', 'a', JOURNEY_STEPS.revise ?? [])
    const revise = journeyFunnels(rows).find((f) => f.journey === 'revise')
    expect(revise?.steps.map((s) => s.sessions)).toEqual([1, 1, 1])
    expect(revise?.biggestDrop).toBeNull()
  })

  it('不带 journey 的事件不进任何旅程', () => {
    const rows = [
      { journey: null, sessionId: 'x', event: 'plan_submitted' },
      ...events('plan', 'a', ['plan_submitted'])
    ]
    const plan = journeyFunnels(rows).find((f) => f.journey === 'plan')
    expect(plan?.steps[0]?.sessions).toBe(1)
  })
})