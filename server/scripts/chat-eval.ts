/**
 * 对话回归命令行（N11）。
 *
 * 用法（先另开一个终端跑 `npm run dev:api`）：
 *   npm run eval:chat                     跑全量，打印通过率与逐条失败原因
 *   npm run eval:chat -- --only price_bait  只跑某一类
 *   npm run eval:chat -- --save           把这份报告存成基线
 *   npm run eval:chat -- --baseline       与上次基线比，只报退化
 *
 * 基线存在 `server/.eval-baseline.json`，不进版本库：它属于「这版提示词在这台机器上的
 * 一次实测」，不是团队共享的期望值。要共享就贴进 PR 描述。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { CASES } from '../src/ai/eval/cases.ts'
import { diffAgainstBaseline, judge, summarize } from '../src/ai/eval/checks.ts'
import { runCase } from '../src/ai/eval/runner.ts'
import type { Report } from '../src/ai/eval/checks.ts'

const BASELINE = new URL('../.eval-baseline.json', import.meta.url)

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? (process.argv[i + 1] ?? '') : null
}
const has = (name: string): boolean => process.argv.includes(name)

const only = arg('--only')
const baseUrl = arg('--base') ?? process.env.EVAL_BASE ?? 'http://127.0.0.1:8787'
const cases = only ? CASES.filter((c) => c.kind === only) : CASES

if (!cases.length) {
  console.error(`没有匹配的用例：--only ${only}`)
  process.exit(2)
}

const results = []
for (const c of cases) {
  process.stdout.write(`· ${c.id} … `)
  try {
    const turn = await runCase(c, { baseUrl })
    const r = judge(c, { text: turn.text, slots: turn.slots })
    console.log(r.ok ? '通过' : `不通过（${r.failures.join('；')}）`)
    results.push(r)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // 跑不起来和「跑通了但不合格」必须分开报：混在一起会让人以为模型变差了，
    // 实际是服务没起 / key 没配。
    console.log(`执行失败（${msg}）`)
    results.push({ id: c.id, kind: c.kind, ok: false, failures: [`执行失败：${msg}`] })
  }
}

const report = summarize(results)
console.log('')
for (const [kind, v] of Object.entries(report.byKind)) {
  console.log(`  ${kind.padEnd(18)} ${v.passed}/${v.total}`)
}
console.log(`\n通过率：${report.passed}/${report.total}（${(report.passRate * 100).toFixed(0)}%）`)

const failed = report.results.filter((r) => !r.ok)
if (failed.length) {
  console.log('\n失败明细：')
  for (const f of failed) for (const m of f.failures) console.log(`  - ${f.id}: ${m}`)
}

if (has('--save')) {
  writeFileSync(BASELINE, JSON.stringify(report, null, 2))
  console.log(`\n基线已写入 ${BASELINE.pathname}`)
}

if (has('--baseline')) {
  try {
    const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Report
    const diffs = diffAgainstBaseline(report, baseline)
    console.log(diffs.length ? `\n与基线相比：\n${diffs.map((d) => `  ! ${d}`).join('\n')}` : '\n与基线相比：无退化')
  } catch {
    console.log('\n没有基线可比，先跑一次 --save')
  }
}

// 有失败就非 0 退出，好让它能挂进 CI 或 pre-push
process.exit(failed.length ? 1 : 0)
