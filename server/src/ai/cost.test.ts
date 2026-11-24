import { afterEach, describe, expect, it } from 'vitest'
import { microsToYuan, priceOf, priceUsage, totalCost } from './cost.ts'

/**
 * 成本折算（F10）。
 *
 * 这一组守的是一条容易被绕过的会计口径：**「不知道」不能写成 0**。
 * 0 的意思是「这次免费」；把缺用量记成 0，日报就会显示「花了 ¥0.00」，
 * 看起来一切正常，实际是整块成本没被记上 —— 那种错误不会有人发现。
 */

const ENV_KEYS = ['AI_PRICE_INPUT_PER_MTOK', 'AI_PRICE_OUTPUT_PER_MTOK', 'AI_PRICE_DEEPSEEK_V4_1_FLASH_INPUT', 'AI_PRICE_DEEPSEEK_V4_1_FLASH_OUTPUT']

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
})

describe('缺用量时一律记 null，不是 0', () => {
  it('两侧都没有用量 → 三个值全 null', () => {
    expect(priceUsage('m', null)).toEqual({ inputTokens: null, outputTokens: null, costMicros: null })
    expect(priceUsage('m', {})).toEqual({ inputTokens: null, outputTokens: null, costMicros: null })
  })

  it('只有一侧用量 → 费用 null，因为半份用量算出来的价必然偏低', () => {
    const onlyInput = priceUsage('m', { inputTokens: 1000 })
    expect(onlyInput.costMicros).toBeNull()
    expect(onlyInput.inputTokens).toBe(1000)

    const onlyOutput = priceUsage('m', { outputTokens: 500 })
    expect(onlyOutput.costMicros).toBeNull()
    expect(onlyOutput.outputTokens).toBe(500)
  })

  it('非法数值当作没有用量', () => {
    const r = priceUsage('m', { inputTokens: Number.NaN, outputTokens: Number.POSITIVE_INFINITY })
    expect(r).toEqual({ inputTokens: null, outputTokens: null, costMicros: null })
  })

  it('负数被夹到 0 —— 模型不该返回负用量，但也不能让它把总额拉低', () => {
    const r = priceUsage('m', { inputTokens: -100, outputTokens: 200 })
    expect(r.inputTokens).toBe(0)
    expect(r.outputTokens).toBe(200)
  })
})

describe('单价来自 env，不写死', () => {
  it('默认单价能算出一个正数', () => {
    const r = priceUsage('some-model', { inputTokens: 1_000_000, outputTokens: 1_000_000 })
    expect(r.costMicros).toBeGreaterThan(0)
  })

  it('全局单价生效', () => {
    process.env.AI_PRICE_INPUT_PER_MTOK = '10'
    process.env.AI_PRICE_OUTPUT_PER_MTOK = '20'
    const r = priceUsage('m', { inputTokens: 1_000_000, outputTokens: 1_000_000 })
    // 1M 输入 × 10 元 + 1M 输出 × 20 元 = 30 元 = 30,000,000 微元
    expect(r.costMicros).toBe(30_000_000)
    expect(microsToYuan(r.costMicros)).toBe(30)
  })

  it('模型专属单价优先于全局', () => {
    process.env.AI_PRICE_INPUT_PER_MTOK = '10'
    process.env.AI_PRICE_OUTPUT_PER_MTOK = '20'
    process.env.AI_PRICE_DEEPSEEK_V4_1_FLASH_INPUT = '1'
    process.env.AI_PRICE_DEEPSEEK_V4_1_FLASH_OUTPUT = '2'
    const r = priceUsage('deepseek-v4.1-flash', { inputTokens: 1_000_000, outputTokens: 1_000_000 })
    expect(r.costMicros).toBe(3_000_000)
  })

  it('模型名大小写与符号差异不影响命中', () => {
    process.env.AI_PRICE_DEEPSEEK_V4_1_FLASH_INPUT = '1'
    process.env.AI_PRICE_DEEPSEEK_V4_1_FLASH_OUTPUT = '1'
    const a = priceUsage('DeepSeek-V4.1-Flash', { inputTokens: 1000, outputTokens: 1000 })
    const b = priceUsage('deepseek-v4.1-flash', { inputTokens: 1000, outputTokens: 1000 })
    expect(a.costMicros).toBe(b.costMicros)
  })

  it('配了非法单价时退回默认值，不让 NaN 污染报表', () => {
    process.env.AI_PRICE_INPUT_PER_MTOK = 'abc'
    const r = priceUsage('m', { inputTokens: 1_000_000, outputTokens: 1_000_000 })
    expect(r.costMicros).not.toBeNull()
    expect(Number.isFinite(r.costMicros)).toBe(true)
  })

  it('priceOf 在没配时也能返回一组可用的数', () => {
    const p = priceOf('whatever')
    expect(p.inputPerMTok).toBeGreaterThanOrEqual(0)
    expect(p.outputPerMTok).toBeGreaterThanOrEqual(0)
  })
})

describe('合计：已知与未知分开算', () => {
  it('只加已知的，未知单独计数', () => {
    const t = totalCost([{ costMicros: 1_000_000 }, { costMicros: null }, { costMicros: 2_000_000 }])
    expect(t.known).toBe(2)
    expect(t.unknown).toBe(1)
    expect(t.yuan).toBe(3)
  })

  it('全部未知时合计是 0 但 known 为 0 —— 调用方据此说「没有可用样本」', () => {
    const t = totalCost([{ costMicros: null }, { costMicros: null }])
    expect(t.known).toBe(0)
    expect(t.unknown).toBe(2)
    expect(t.yuan).toBe(0)
  })

  it('空数组不报错', () => {
    expect(totalCost([])).toEqual({ micros: 0, known: 0, unknown: 0, yuan: 0 })
  })
})

describe('微元 → 元', () => {
  it('null 保持 null，界面据此显示「未知」而不是 0', () => {
    expect(microsToYuan(null)).toBeNull()
  })

  it('按六位小数换算', () => {
    expect(microsToYuan(1_500_000)).toBe(1.5)
    expect(microsToYuan(1)).toBe(0.000001)
  })
})
