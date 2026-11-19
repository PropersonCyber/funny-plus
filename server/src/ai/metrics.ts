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
}

export type Summary = {
  calls: number
  chatCalls: number
  reviseCalls: number
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
  const toolCalls = rows.reduce((s, r) => s + r.toolCalls, 0)
  const toolFailures = rows.reduce((s, r) => s + r.toolFailures, 0)
  const planGenerated = chat.filter((r) => r.planGenerated).length
  const degraded = rows.filter((r) => r.degraded).length
  const durations = rows.map((r) => r.durationMs).filter((d) => d > 0)

  return {
    calls: rows.length,
    chatCalls: chat.length,
    reviseCalls: revise.length,
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
    p95DurationMs: percentile(durations, 95)
  }
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
      degraded: aiCalls.degraded
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