import { describe, expect, it } from 'vitest'

/**
 * 引擎缓存代次（C2 的配套）。
 *
 * 这里测的是「数据变了之后缓存一定会作废」这条契约本身。它不会自己出错，
 * 但漏调一次就是一个静默 bug：补录写进 lines 之后，行程页看到新末班、
 * AI 对话还在按旧值排时刻，而两边都不报错、界面上也没有任何异常可看。
 */
import { engineGeneration, invalidateEngine } from './engineCache.ts'

describe('缓存代次', () => {
  it('每次失效都推进代次，两次失效不会互相抵消', () => {
    const before = engineGeneration()
    invalidateEngine()
    const once = engineGeneration()
    expect(once).toBe(before + 1)

    invalidateEngine()
    // 用「自增」而不是「取反」：取反在连续两次失效时回到原值，缓存就永远不作废了
    expect(engineGeneration()).toBe(once + 1)
  })

  it('没调用失效时代次不变（读取本身不能有副作用）', () => {
    const before = engineGeneration()
    engineGeneration()
    engineGeneration()
    expect(engineGeneration()).toBe(before)
  })
})
