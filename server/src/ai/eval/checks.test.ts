import { describe, expect, it } from 'vitest'

/**
 * 回归判定本身的测试（N11）。
 *
 * 判定逻辑写错的话，整个回归集会给出一条稳定但错误的通过率 —— 这种错最难发现，
 * 因为「跑通了、数字也好看」。所以这里不测模型，只测「什么样算过、什么样算不过」。
 */
import { judge, summarize, diffAgainstBaseline } from './checks.ts'
import type { CaseResult } from './checks.ts'
import type { EvalCase } from './cases.ts'

const c = (patch: Partial<EvalCase> = {}): EvalCase => ({
  id: 't1',
  kind: 'missing_slot',
  user: '随便说点什么',
  ...patch
})

describe('关键词组：外层或、内层且', () => {
  it('内层必须全部出现才算命中', () => {
    const case_ = c({ mustMention: [['还缺', '天数']] })
    expect(judge(case_, { text: '还缺天数哦', slots: {} }).ok).toBe(true)
    // 只说了一半不算
    expect(judge(case_, { text: '还缺一些信息', slots: {} }).ok).toBe(false)
  })

  it('外层命中任一组即可', () => {
    const case_ = c({ mustMention: [['未核实'], ['查不到']] })
    expect(judge(case_, { text: '这个价格查不到', slots: {} }).ok).toBe(true)
  })

  it('禁词命中就失败，并说明命中了哪一组', () => {
    const case_ = c({ mustNotMention: [['外滩'], ['豫园']] })
    const r = judge(case_, { text: '推荐去外滩看看', slots: {} })
    expect(r.ok).toBe(false)
    expect(r.failures.join()).toContain('外滩')
  })
})

describe('槽位断言', () => {
  it('只断言给了的项，没给的不追究', () => {
    const case_ = c({ slots: { destination: '重庆' } })
    // party 没在用例里声明，模型填了也不该算错
    expect(judge(case_, { text: '好的', slots: { destination: '重庆', party: 99 } }).ok).toBe(true)
  })

  it('缺失与不等都要能区分', () => {
    const case_ = c({ slots: { dayCount: 2 } })
    expect(judge(case_, { text: '好的', slots: {} }).failures.join()).toContain('缺失')
    expect(judge(case_, { text: '好的', slots: { dayCount: 3 } }).failures.join()).toContain('期望 2')
  })
})

describe('空回复', () => {
  it('模型什么都没说也算失败，不能因为没触发禁词就判过', () => {
    expect(judge(c(), { text: '   ', slots: {} }).ok).toBe(false)
  })
})

describe('汇总', () => {
  // 汇总只关心「类别字符串」本身，用真实类别会逼着每个用例都造一遍真实模型输出
  const r = (id: string, kind: string, ok: boolean): CaseResult =>
    ({ id, kind, ok, failures: [] }) as unknown as CaseResult

  it('按类别分组，空输入不产生 NaN', () => {
    expect(summarize([]).passRate).toBe(0)
    const report = summarize([r('a', 'k1', true), r('b', 'k1', false), r('c', 'k2', true)])
    expect(report.passRate).toBeCloseTo(2 / 3)
    expect(report.byKind.k1).toEqual({ total: 2, passed: 1 })
  })

  it('与基线比时只报退化，不报进步', () => {
    const now = summarize([r('a', 'k1', false), r('b', 'k2', true)])
    const was = summarize([r('a', 'k1', true), r('b', 'k2', false)])
    const diffs = diffAgainstBaseline(now, was)
    expect(diffs.join('\n')).toContain('退化 k1')
    // k2 变好了不报：这类信息在总通过率里看得到，混进退化列表会淹掉真问题
    expect(diffs.join('\n')).not.toContain('k2')
  })
})
