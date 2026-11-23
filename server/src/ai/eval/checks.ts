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

export type Turn = {
  /** 模型最终回复全文（流式增量已在 runner 里拼好） */
  text: string
  /** 这一轮结束时报上来的槽位；引擎没给就是空对象 */
  slots: Record<string, unknown>
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
