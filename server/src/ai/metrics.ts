/**
 * 度量口径（G7）。
 *
 * 为什么不把口径写在 SQL 里：写在 SQL 里的口径没法测。
 * 这里把「读行」和「算指标」分开 —— `summarize` / `journeyFunnels` 是纯函数，
 * 喂进去一组行就能断言；`loadAiCalls` / `loadTrackEvents` 只负责取数。
 *
 * 改口径只改这一处，脚本、接口、临时排查都从这里取，不允许各写一遍。
 */
import { gte } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { aiCalls, trackEvents } from '../db/schema.ts'

/** 一行 ai_calls，字段比表少：算指标用不到 id / 时间戳 */
export type AiCallRow = {
  kind: string
  sessionId: string | null
  journey: string | null
  durationMs: number
  toolCalls: number
  toolFailures: number
  planGenerated: boolean
  planAttempts: number
  degraded: boolean
  /**
   * 这一轮用的提示词版本。
   *
   * 以前只写不读 —— 于是「改话术能按版本回滚」只是口号：出了问题查不到是哪版、
   * 也没法比较两版的方案采纳率与降级率。现在按版本分组统计，回滚才有依据。
   */
  promptVersion: string
  /** 输入/输出 token；null = 这次没拿到用量（不是 0，0 是「免费」） */
  inputTokens: number | null
  outputTokens: number | null
  /** 折算费用（微元）；null = 未计价 */
  costMicros: number | null
}

export type Summary = {
  calls: number
  chatCalls: number
  reviseCalls: number
  /** 表单主链路（N10）的模型提案次数；与对话分开计，否则「表单走没走模型」被混进 chat 里看不出来 */
  planCalls: number
  /** 生成了方案的对话数；分母是 chatCalls 而不是 calls —— 改行程那类调用本来就不该产方案 */
  planGenerated: number
  planRate: number
  /** generatePlans 被调了不止一次：说明模型没按 hint 停，是提示词要改的信号 */
  retriedPlans: number
  degraded: number
  degradeRate: number
  toolCalls: number
  toolFailures: number
  toolSuccessRate: number
  avgDurationMs: number
  p95DurationMs: number
  /** token 合计（只累加有记录的调用） */
  inputTokens: number
  outputTokens: number
  /** 成本（元）；只合计已知的，未知单独计数 */
  costYuan: number
  /** 没拿到用量的调用数 —— 报表要能说「有多少笔没记到」，而不是让总额看起来是全部 */
  costUnknown: number
  /** 单次对话均价（元）；没有可用样本时为 null */
  avgCostYuan: number | null
}

/** 最近分位；空数组返回 0。用最近秩而不是插值：延迟分布是长尾的，插值会把尾巴抹平 */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[rank] ?? 0
}

const rate = (num: number, den: number): number => (den > 0 ? num / den : 0)

export function summarize(rows: AiCallRow[]): Summary {
  const chat = rows.filter((r) => r.kind === 'chat')
  const revise = rows.filter((r) => r.kind === 'revise')
  const plan = rows.filter((r) => r.kind === 'plan')
  const toolCalls = rows.reduce((s, r) => s + r.toolCalls, 0)
  const toolFailures = rows.reduce((s, r) => s + r.toolFailures, 0)
  const planGenerated = chat.filter((r) => r.planGenerated).length
  const degraded = rows.filter((r) => r.degraded).length
  const durations = rows.map((r) => r.durationMs).filter((d) => d > 0)

  return {
    calls: rows.length,
    chatCalls: chat.length,
    reviseCalls: revise.length,
    planCalls: plan.length,
    planGenerated,
    planRate: rate(planGenerated, chat.length),
    retriedPlans: chat.filter((r) => r.planAttempts > 1).length,
    degraded,
    degradeRate: rate(degraded, rows.length),
    toolCalls,
    toolFailures,
    // 分母用「调用数」而不是「调用数 - 失败数」：成功率要能反映「压根没调成」的情况
    toolSuccessRate: rate(toolCalls - toolFailures, toolCalls),
    avgDurationMs: durations.length ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length) : 0,
    p95DurationMs: percentile(durations, 95),
    ...costOf(rows)
  }
}

/**
 * 成本汇总。
 *
 * 未知用量的调用单独计数、不进求和：只把已知的加起来会得到一个偏低的总额，
 * 看起来完整、实际少算了一部分 —— 那比明确说「有 N 笔没记到」更危险。
 * 均价的分母也只取已知成本的那些，否则单价会被未知笔数稀释成虚低。
 */
function costOf(rows: AiCallRow[]): Pick<Summary, 'inputTokens' | 'outputTokens' | 'costYuan' | 'costUnknown' | 'avgCostYuan'> {
  let inputTokens = 0
  let outputTokens = 0
  let costMicros = 0
  let known = 0
  let unknown = 0
  for (const r of rows) {
    if (r.inputTokens !== null) inputTokens += r.inputTokens
    if (r.outputTokens !== null) outputTokens += r.outputTokens
    if (r.costMicros === null || r.costMicros === undefined) unknown += 1
    else {
      costMicros += r.costMicros
      known += 1
    }
  }
  return {
    inputTokens,
    outputTokens,
    costYuan: Math.round(costMicros) / 1_000_000,
    costUnknown: unknown,
    avgCostYuan: known ? Math.round((costMicros / known) * 10) / 10_000_000 : null
  }
}

/**
 * 按提示词版本分组。改话术之后要能回答「新版比旧版好还是差」——
 * 只有把同一套口径分别跑在每个版本上，回滚才有依据。
 * 按调用数倒序：正在用的那一版排最前。
 */
export function byPromptVersion(rows: AiCallRow[]): { version: string; summary: Summary }[] {
  return groupBy(rows, (r) => r.promptVersion || '(未记录)')
}

/**
 * 从复合版本里取出某一块的号。
 *
 * 落库的版本形如 `base@2026-11-24.1/plan@2026-11-24.1`。
 * 想回答「改了 nearby 之后效果如何」，就得只按 nearby 那一段分组 ——
 * 按整串分组会把「base 相同、任务不同」拆成好几组，
 * 正好和「对比某块改动前后」的目的相反。
 *
 * 老数据没有 `@`（单值版本），原样返回，归到 `(旧版)` 那一组里，
 * 不与新格式混在一起比。
 */
export function blockVersion(version: string, block: string): string {
  for (const seg of version.split('/')) {
    const at = seg.indexOf('@')
    if (at <= 0) continue
    if (seg.slice(0, at) === block) return seg.slice(at + 1)
  }
  return version.includes('@') ? '(未记录)' : '(旧版)'
}

/** 按某一块的版本分组，用于「只改了这一块」的前后对比 */
export function byPromptBlock(rows: AiCallRow[], block: string): { version: string; summary: Summary }[] {
  return groupBy(rows, (r) => blockVersion(r.promptVersion, block))
}

function groupBy(rows: AiCallRow[], keyOf: (r: AiCallRow) => string): { version: string; summary: Summary }[] {
  const groups = new Map<string, AiCallRow[]>()
  for (const r of rows) {
    const key = keyOf(r)
    const list = groups.get(key) ?? []
    list.push(r)
    groups.set(key, list)
  }
  return [...groups.entries()]
    .map(([version, list]) => ({ version, summary: summarize(list) }))
    .sort((a, b) => b.summary.calls - a.summary.calls)
}

/**
 * 两条验收旅程的漏斗。
 *
 * 每步按「有多少个会话走到过这一步」统计，而不是事件条数：
 * 条数会被反复重试放大，看不出「人走到哪就不走了」。
 *
 * 只认客户端上报的事件（track_events）：服务端 ai_calls 没有「用户看到了没有」这一层，
 * 模型生成了方案不等于用户采纳了。
 */
export const JOURNEY_STEPS: Record<string, string[]> = {
  plan: ['plan_submitted', 'compare_open', 'compare_pick', 'plan_adopted'],
  revise: ['revise_open', 'revise_preview', 'revise_applied']
}

export type FunnelStep = { event: string; sessions: number; lost: number }
export type JourneyFunnel = {
  journey: string
  steps: FunnelStep[]
  /** 掉得最多的那一跳；一路走到底（没有任何下降）时为 null */
  biggestDrop: { from: string; to: string; lost: number } | null
}

export function journeyFunnels(
  rows: { journey: string | null; sessionId: string; event: string }[]
): JourneyFunnel[] {
  return Object.entries(JOURNEY_STEPS).map(([journey, steps]) => {
    const mine = rows.filter((r) => (r.journey ?? '') === journey)
    let prev = 0
    let biggestDrop: JourneyFunnel['biggestDrop'] = null
    const out: FunnelStep[] = steps.map((event, i) => {
      // 会话集合而不是条数：同一个会话反复触发同一个事件只算一次
      const sessions = new Set(mine.filter((r) => r.event === event).map((r) => r.sessionId)).size
      const lost = i === 0 ? 0 : Math.max(0, prev - sessions)
      // 只记真的掉了人的那一跳：lost 为 0 的环节不是断点，报出来只会淹没真正的那个
      if (i > 0 && lost > 0 && (!biggestDrop || lost > biggestDrop.lost)) {
        biggestDrop = { from: steps[i - 1] ?? '', to: event, lost }
      }
      prev = sessions
      return { event, sessions, lost }
    })
    return { journey, steps: out, biggestDrop }
  })
}

/** 取最近 N 天的 AI 调用。N 太小看不出趋势，太大把早期口径混进来，默认 7 天 */
export async function loadAiCalls(days = 7): Promise<AiCallRow[]> {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000)
  return db
    .select({
      kind: aiCalls.kind,
      sessionId: aiCalls.sessionId,
      journey: aiCalls.journey,
      durationMs: aiCalls.durationMs,
      toolCalls: aiCalls.toolCalls,
      toolFailures: aiCalls.toolFailures,
      planGenerated: aiCalls.planGenerated,
      planAttempts: aiCalls.planAttempts,
      degraded: aiCalls.degraded,
      promptVersion: aiCalls.promptVersion,
      inputTokens: aiCalls.inputTokens,
      outputTokens: aiCalls.outputTokens,
      costMicros: aiCalls.costMicros
    })
    .from(aiCalls)
    .where(gte(aiCalls.at, since))
}

/** 取最近 N 天的客户端事件里漏斗用得到的那几项 */
export async function loadTrackEvents(
  days = 7
): Promise<{ journey: string | null; sessionId: string; event: string }[]> {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000)
  const wanted = new Set(Object.values(JOURNEY_STEPS).flat())
  const rows = await db
    .select({ journey: trackEvents.journey, sessionId: trackEvents.sessionId, event: trackEvents.event })
    .from(trackEvents)
    .where(gte(trackEvents.at, since))
  return rows.filter((r) => wanted.has(r.event))
}

/** 百分比排版：0.1234 → "12.3%"。统一在这里做，脚本和接口不会各写一套小数位 */
export function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`
}