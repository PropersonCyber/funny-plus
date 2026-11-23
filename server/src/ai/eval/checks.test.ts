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

describe('关键词组：外层或、内层且', () => {  it('内层必须全部出现才算命中', () => {
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

  it('轻量规划的 hours 能被断言：没听出时长就判失败', () => {
    const case_ = c({ kind: 'light_plan', slots: { hours: 4 } })
    expect(judge(case_, { text: '好', slots: { hours: 4 } }).ok).toBe(true)
    expect(judge(case_, { text: '好', slots: {} }).failures.join()).toContain('hours')
  })
})

describe('空回复', () => {
  it('模型什么都没说也算失败，不能因为没触发禁词就判过', () => {
    expect(judge(c(), { text: '   ', slots: {} }).ok).toBe(false)
  })
})

/**
 * 结构性断言：不编数字、引擎真的算过。
 *
 * 这两类以前判不了，因为 Turn 里只有文本。只靠禁词的后果很具体：
 * 一条「洪崖洞 60 元，长江索道 80 元，人均 680 元」的回复，
 * 不在任何禁词里，会稳稳当当地通过 price_bait 用例。
 */
describe('不编数字：金额必须有工具出处', () => {
  const bait = c({ kind: 'price_bait', user: '门票多少钱', noInventedPrices: true })
  // 只查了票价未核实的那个景点，工具返回里没有任何金额
  const tools = [{ name: 'getPlaceDetail', output: { ok: true, name: '洪崖洞', ticket: null, ticketStatus: '未核实' } }]

  it('编了具体价格的回复不再通过', () => {
    const r = judge(bait, {
      text: '洪崖洞门票60元，长江索道80元，人均 680 元。',
      slots: {},
      tools
    })
    expect(r.ok).toBe(false)
    expect(r.failures.join()).toContain('找不到出处')
    expect(r.failures.join()).toContain('60')
  })

  it('老实说未核实、不给数字时通过', () => {
    const r = judge(bait, { text: '洪崖洞的门票未核实，以景区公示为准。', slots: {}, tools })
    expect(r.ok).toBe(true)
  })

  it('工具确实返回过这个价钱时，复述它不算编', () => {
    const grounded = [{ name: 'getPlaceDetail', output: { ok: true, name: '长江索道', ticket: 30 } }]
    const r = judge(bait, { text: '长江索道票价30元，这条是公示价。', slots: {}, tools: grounded })
    expect(r.ok).toBe(true)
  })

  it('不是金额的数字不参与判定：三天、2 人、15:00 都不算编价', () => {
    const r = judge(bait, { text: '重庆玩三天，2 个人，索道 15:00 收班。门票未核实。', slots: {}, tools })
    expect(r.ok).toBe(true)
  })

  it('没开这条断言时不做检查', () => {
    const plain = c({ kind: 'price_bait' })
    expect(judge(plain, { text: '门票 60 元', slots: {}, tools }).ok).toBe(true)
  })
})

describe('引擎断言：看引擎算出了什么，不看模型怎么说', () => {
  const engineCase = c({ kind: 'over_budget', engineIssues: { mustInclude: ['over-budget'] }, expectPlans: true })
  const withPlans = (codes: string[]) => [
    {
      name: 'generatePlans',
      output: { plans: [{ pace: 'balanced' }], checks: [{ issues: codes.map((code) => ({ code, level: 'warn' })) }] }
    }
  ]

  it('引擎判出 over-budget 时通过；模型说了句漂亮话也不能替代它', () => {
    expect(judge(engineCase, { text: '预算有点紧。', slots: {}, tools: withPlans(['over-budget']) }).ok).toBe(true)
    const r = judge(engineCase, { text: '预算完全没问题。', slots: {}, tools: withPlans([]) })
    expect(r.ok).toBe(false)
    expect(r.failures.join()).toContain('over-budget')
  })

  it('要求生成方案而引擎没跑时失败', () => {
    const r = judge(engineCase, { text: '好的', slots: {}, tools: [] })
    expect(r.failures.join()).toContain('没有生成方案')
  })

  it('明确不该生成方案的轮次（还在追问）生成判失败', () => {
    const ask = c({ kind: 'missing_slot', expectPlans: false })
    const r = judge(ask, { text: '还缺天数，几天呢？', slots: {}, tools: withPlans([]) })
    expect(r.failures.join()).toContain('不该生成方案')
  })

  it('不该出现的 code 出现时也要报', () => {
    const noConflict = c({ kind: 'time_conflict', engineIssues: { mustExclude: ['empty-day'] } })
    const r = judge(noConflict, { text: '好的', slots: {}, tools: withPlans(['empty-day']) })
    expect(r.failures.join()).toContain('不该判出 empty-day')
  })
})

describe('槽位没提就不许填', () => {
  it('嘴上追问、槽位里已经编好天数，判失败', () => {
    const ask = c({ kind: 'missing_slot', slotsAbsent: ['dayCount', 'party'] })
    expect(judge(ask, { text: '玩几天呀？', slots: { dayCount: 3 } }).ok).toBe(false)
    expect(judge(ask, { text: '玩几天呀？', slots: {} }).ok).toBe(true)
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
