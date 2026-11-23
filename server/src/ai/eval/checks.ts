import type { EvalCase } from './cases.ts'

/**
 * 回归用例的判定（N11）。
 *
 * 纯函数，不碰模型也不碰网络：模型怎么调由 `runner.ts` 决定，这里只回答
 * 「这一轮算不算过」。分开的理由很实际 —— 判定逻辑本身写错了，
 * 整个回归集会给出一个稳定但错误的通过率，而这种错最难发现。
 */

export type CaseResult = {
  id: string
  kind: EvalCase['kind']
  ok: boolean
  /** 每一条不通过的断言一句话，直接能看出是哪一条挂了 */
  failures: string[]
}

/** 一次工具调用的产出，按事件顺序保留 */
export type ToolCall = {
  name: string
  /** 工具返回的原始对象（SSE 里 tool_result 的 output） */
  output: unknown
}

export type Turn = {
  /** 模型最终回复全文（流式增量已在 runner 里拼好） */
  text: string
  /** 这一轮结束时报上来的槽位；引擎没给就是空对象 */
  slots: Record<string, unknown>
  /**
   * 本轮所有工具返回。
   *
   * 没有它就只能靠文风判断模型有没有编数字 —— 而文风是可以被绕过的
   * （「洪崖洞 60 元」不在任何禁词里）。有了工具返回，「这个数有没有出处」
   * 才能变成一个可判定的问题。
   */
  tools?: ToolCall[]
}

const flatten = (groups: string[][] | undefined): string[][] => (groups ?? []).map((g) => g.filter(Boolean))

/**
 * 关键词组按「外层或、内层且」判定。
 *
 * 为什么不用正则：中文里同义表达太多，写死正则等于把某一版文案钉进测试，
 * 提示词一改就红，而那种红不说明模型变差了。
 */
function matchAnyGroup(text: string, groups: string[][]): boolean {
  return groups.some((group) => group.every((kw) => text.includes(kw)))
}

/**
 * 回复里出现的金额。
 *
 * 只认「有货币标记的数字」，不认光秃秃的数：中文里数字到处都是（三天、2 人、15:00），
 * 把它们全当成金额判，会让每一条都失败，最后没人看这个报告。
 * 三条正则是：¥60 / 60元（含空格）/ 门票60。
 */
const PRICE_PATTERNS = [/(?:¥|￥)\s*(\d+(?:\.\d+)?)/g, /(\d+(?:\.\d+)?)\s*元/g, /(?:门票|票价|全票|半票|人均)\s*(\d+(?:\.\d+)?)/g]

export function pricesIn(text: string): number[] {
  const out: number[] = []
  for (const re of PRICE_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const n = Number(m[1])
      if (Number.isFinite(n)) out.push(n)
    }
  }
  return out
}

/** 工具返回里出现过的所有数字（含嵌套对象里的） */
function numbersIn(value: unknown, out = new Set<number>()): Set<number> {
  if (typeof value === 'number') {
    out.add(value)
    return out
  }
  if (typeof value === 'string') {
    // 工具返回里的字符串也可能带数字（"17:00"、"人均 635 元"）
    for (const m of value.matchAll(/\d+(?:\.\d+)?/g)) out.add(Number(m[0]))
    return out
  }
  if (Array.isArray(value)) {
    for (const v of value) numbersIn(v, out)
    return out
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) numbersIn(v, out)
  }
  return out
}

/** 工具返回里所有引擎判出来的 issue code（validateView / generatePlans 的 checks） */
function issueCodesIn(tools: ToolCall[] | undefined): Set<string> {
  const codes = new Set<string>()
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const v of value) walk(v)
      return
    }
    const obj = value as Record<string, unknown>
    // validateView 只回 error 的 message/alternatives，没有 code；generatePlans 的
    // checks 里同样只有 message。所以 code 从 message 里认不出来的情况，
    // 由 runner 在 tool_result 之外补一份 plan.issues（见 runner.ts）。
    if (typeof obj.code === 'string') codes.add(obj.code)
    for (const v of Object.values(obj)) walk(v)
  }
  for (const t of tools ?? []) walk(t.output)
  return codes
}

function hasPlans(tools: ToolCall[] | undefined): boolean {
  return (tools ?? []).some((t) => {
    const out = t.output as { plans?: unknown } | null
    return !!out && Array.isArray(out.plans) && out.plans.length > 0
  })
}

export function judge(c: EvalCase, turn: Turn): CaseResult {
  const failures: string[] = []
  const text = turn.text ?? ''

  if (!text.trim()) failures.push('模型没有产出任何文本')

  const must = flatten(c.mustMention)
  if (must.length && !matchAnyGroup(text, must)) {
    failures.push(`缺少必须提到的内容：${must.map((g) => g.join('+')).join(' 或 ')}`)
  }

  const forbidden = flatten(c.mustNotMention)
  if (forbidden.length && matchAnyGroup(text, forbidden)) {
    const hit = forbidden.find((g) => g.every((kw) => text.includes(kw))) ?? []
    failures.push(`说了不该说的内容：${hit.join('+')}`)
  }

  // 槽位只断言给了的那几项：没给的项模型填不填都不算错，
  // 因为有些轮次本来就不该补齐（例如城市都没接入时不该落 destination 以外的槽）
  for (const [key, want] of Object.entries(c.slots ?? {})) {
    if (want === undefined) continue
    const got = turn.slots?.[key]
    if (got !== want) failures.push(`槽位 ${key} 期望 ${String(want)}，实际 ${got === undefined ? '缺失' : String(got)}`)
  }

  // 反过来：明说了「用户没提」的槽位，模型填了就是自己编的
  for (const key of c.slotsAbsent ?? []) {
    const got = turn.slots?.[key]
    if (got !== undefined && got !== null) failures.push(`槽位 ${String(key)} 用户没提，不该填成 ${String(got)}`)
  }

  // 引擎断言：证明引擎自己算出了这个问题，而不是靠模型嘴上说
  if (c.engineIssues) {
    const codes = issueCodesIn(turn.tools)
    for (const want of c.engineIssues.mustInclude ?? []) {
      if (!codes.has(want)) failures.push(`引擎没有判出 ${want}（实际：${[...codes].join('、') || '无'}）`)
    }
    const any = c.engineIssues.mustIncludeAny
    if (any?.length && !any.some((w) => codes.has(w))) {
      failures.push(`引擎没有判出 ${any.join(' 或 ')} 中的任何一个（实际：${[...codes].join('、') || '无'}）`)
    }
    for (const want of c.engineIssues.mustExclude ?? []) {
      if (codes.has(want)) failures.push(`引擎不该判出 ${want}`)
    }
  }

  if (c.expectPlans === true && !hasPlans(turn.tools)) failures.push('引擎没有生成方案')
  if (c.expectPlans === false && hasPlans(turn.tools)) failures.push('这一轮不该生成方案')

  // 不编数字：回复里每个金额都要能在工具返回里找到同一个数
  if (c.noInventedPrices) {
    const grounded = numbersIn(turn.tools)
    const invented = pricesIn(text).filter((n) => !grounded.has(n))
    if (invented.length) {
      failures.push(`回复里的金额在工具返回里找不到出处：${[...new Set(invented)].join('、')}`)
    }
  }

  return { id: c.id, kind: c.kind, ok: failures.length === 0, failures }
}

export type Report = {
  total: number
  passed: number
  /** 通过率；分母为 0 时返回 0，不返回 NaN（写进报告会变成 "NaN%"） */
  passRate: number
  byKind: Record<string, { total: number; passed: number }>
  results: CaseResult[]
}

export function summarize(results: CaseResult[]): Report {
  const byKind: Report['byKind'] = {}
  for (const r of results) {
    const b = byKind[r.kind] ?? { total: 0, passed: 0 }
    b.total += 1
    if (r.ok) b.passed += 1
    byKind[r.kind] = b
  }
  const passed = results.filter((r) => r.ok).length
  return {
    total: results.length,
    passed,
    passRate: results.length ? passed / results.length : 0,
    byKind,
    results
  }
}

/**
 * 与上一版基线比。
 *
 * 只报「退化」不报「进步」：提示词改动最常见的坏结果不是整体掉分，
 * 而是某个类别悄悄归零，而总通过率被别的类别补平了看不出来。
 */
export function diffAgainstBaseline(report: Report, baseline: Report): string[] {
  const lines: string[] = []
  for (const [kind, now] of Object.entries(report.byKind)) {
    const was = baseline.byKind[kind]
    if (!was) {
      lines.push(`新增类别 ${kind}：${now.passed}/${now.total}`)
      continue
    }
    if (now.passed < was.passed) lines.push(`退化 ${kind}：${was.passed}/${was.total} → ${now.passed}/${now.total}`)
  }
  for (const id of baseline.results.filter((r) => r.ok).map((r) => r.id)) {
    const now = report.results.find((r) => r.id === id)
    if (now && !now.ok) lines.push(`用例由通过变为不通过：${id}`)
  }
  if (report.passRate < baseline.passRate) {
    lines.push(`总通过率下降：${(baseline.passRate * 100).toFixed(0)}% → ${(report.passRate * 100).toFixed(0)}%`)
  }
  return lines
}
