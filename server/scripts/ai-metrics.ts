/**
 * 一条命令回答 G7 的两个问题：
 *   1. N 次对话里几次生成方案、几次被采纳、几次降级、工具成功率多少
 *   2. 两条验收旅程各自走到哪一步、断在哪一环
 *
 * 跑法（在 server/ 下）：
 *   npm run metrics                 # 最近 7 天
 *   npm run metrics -- --days 30    # 最近 30 天
 *
 * 刻意做成命令行而不是接口：口径改动频繁，接口一旦发出去就有人依赖它，
 * 改字段等于破坏兼容；命令行改完自己看，没有这个负担。
 * 将来要做看板，从 `ai/metrics.ts` 取同一套口径，不在这里加接口。
 */
import { byPromptVersion, loadAiCalls, loadTrackEvents, journeyFunnels, pct, summarize } from '../src/ai/metrics.ts'

function argDays(): number {
  const i = process.argv.indexOf('--days')
  const raw = i >= 0 ? process.argv[i + 1] : undefined
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 7
}

function line(label: string, value: string): void {
  console.log(`  ${label.padEnd(16, ' ')} ${value}`)
}

async function main(): Promise<void> {
  const days = argDays()
  console.log(`\n=== 最近 ${days} 天 ===\n`)

  const calls = await loadAiCalls(days)
  const s = summarize(calls)

  console.log('[模型侧]（来源 ai_calls）')
  line('调用总数', `${s.calls}（对话 ${s.chatCalls} / 改行程 ${s.reviseCalls}）`)
  line('生成方案', `${s.planGenerated} / ${s.chatCalls} 次对话 = ${pct(s.planRate)}`)
  line('方案重试', `${s.retriedPlans} 次（generatePlans 被调 >1 次，说明没按 hint 停）`)
  line('降级', `${s.degraded} 次 = ${pct(s.degradeRate)}`)
  line('工具调用', `${s.toolCalls} 次，失败 ${s.toolFailures} 次，成功率 ${pct(s.toolSuccessRate)}`)
  line('延迟', `平均 ${s.avgDurationMs}ms / p95 ${s.p95DurationMs}ms`)

  // 按提示词版本分组：改完话术要能对比新版与旧版，回滚才有依据
  const versions = byPromptVersion(calls)
  if (versions.length > 1) {
    console.log('\n[按提示词版本]')
    for (const v of versions) {
      const x = v.summary
      line(
        v.version,
        `${x.calls} 次 · 方案 ${pct(x.planRate)} · 降级 ${pct(x.degradeRate)} · 工具 ${pct(x.toolSuccessRate)} · p95 ${x.p95DurationMs}ms`
      )
    }
  }

  const journeys = new Map<string, number>()
  for (const r of calls) {
    const j = r.journey || '(日常)'
    journeys.set(j, (journeys.get(j) ?? 0) + 1)
  }
  if (journeys.size) {
    console.log('\n[按旅程]（服务端调用数）')
    for (const [j, n] of [...journeys.entries()].sort((a, b) => b[1] - a[1])) {
      line(j, `${n} 次`)
    }
  }

  console.log('\n[旅程漏斗]（来源 track_events，按会话去重）')
  const funnels = journeyFunnels(await loadTrackEvents(days))
  for (const f of funnels) {
    console.log(`\n  旅程 ${f.journey}`)
    for (const step of f.steps) {
      const lost = step.lost > 0 ? `  ← 掉了 ${step.lost}` : ''
      line(step.event, `${step.sessions} 个会话${lost}`)
    }
    if (f.biggestDrop) {
      line('断点', `${f.biggestDrop.from} → ${f.biggestDrop.to}，掉 ${f.biggestDrop.lost} 个会话`)
    } else {
      line('断点', '无可判定下降')
    }
  }

  const degraded = calls.filter((r) => r.degraded)
  if (degraded.length) {
    console.log(`\n[降级明细] 共 ${degraded.length} 次，可关联到 ${new Set(degraded.map((r) => r.sessionId)).size} 轮对话`)
    for (const r of degraded.slice(0, 10)) {
      line(r.sessionId ?? '(无会话)', `${r.kind} / journey=${r.journey ?? '-'} / ${r.durationMs}ms`)
    }
  }

  if (!s.calls) console.log('\n（还没有任何 AI 调用记录）')
  console.log('')
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('查询失败：', err instanceof Error ? err.message : err)
    process.exit(1)
  }
)