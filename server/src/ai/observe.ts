/**
 * 服务端 AI 度量（G7）。
 *
 * 为什么要有这一层：客户端 32 个埋点事件只能回答「用户做了什么」，
 * 回答不了「模型这次靠不靠谱」—— token 用了多少、慢在哪、工具失败率多少、
 * 降级了几次、提示词哪一版。这些只有服务端知道。
 *
 * 三条硬规则：
 * 1. **永不抛**。度量的价值在于「有」，不在于「全」。写不进去就少一行，
 *    绝不能因此让这次回答变成 500。
 * 2. **不等结果**。写库是 fire-and-forget，调用方不 await 也不会拖慢响应；
 *    要 await 的场景（脚本 / 测试）走 `recordAiCall`。
 * 3. **口径只有一处**。所有派生指标（漏斗、成功率）都在 `ai/metrics.ts` 里算，
 *    不在写入时算——写入时算等于把口径冻在旧代码里，改口径要重刷历史数据。
 */
import { db } from '../db/client.ts'
import { aiCalls } from '../db/schema.ts'
import { PROMPT_VERSION } from './prompt.ts'
import { priceUsage } from './cost.ts'
import type { TokenUsage } from './cost.ts'

export type AiCallKind = 'chat' | 'revise' | 'plan' | 'memory'

export type AiObservation = {
  kind: AiCallKind
  /** 对话附带任务标识，沿用按提示词版本聚合的度量。 */
  promptVersion?: string
  /** 客户端会话 id；同一个 id 下的多行就是同一轮对话 */
  sessionId?: string | null
  userId?: string | null
  model?: string | null
  durationMs: number
  toolCalls?: number
  toolFailures?: number
  planGenerated?: boolean
  planAttempts?: number
  degraded?: boolean
  degradeReason?: string | null
  /** 本轮归属的验收旅程（plan / revise）；空表示日常使用 */
  journey?: string | null
  stream?: boolean
  error?: string | null
  /**
   * 模型返回的用量（input / output tokens）。
   *
   * 缺省或拿不到时 three cost 列都写 null —— 「不知道」不是「免费」。
   * 由 `recordAiCall` 内部折算成费用，调用点不需要知道单价。
   */
  usage?: TokenUsage | null
}

/** 提示词版本集中从这里取：调用点写死字符串的话，改了提示词忘了改埋点就白记了 */
/**
 * 默认版本 = base 这一块的号。
 *
 * 只作兜底：对话端点会显式传 `composePromptVersion(...)` 带上任务块；
 * 没有显式传的调用点（如 plan / revise / memory）必须自己传对应块的号，
 * 否则它们会被记成 base 版本 —— 看起来「和对话用了同一版提示词」，
 * 实际用的是完全不同的那份，回滚对照时对不上。
 */
export function promptVersion(): string {
  return PROMPT_VERSION
}

function row(o: AiObservation) {
  const priced = priceUsage(o.model, o.usage)
  return {
    id: crypto.randomUUID(),
    sessionId: o.sessionId || null,
    userId: o.userId || null,
    kind: o.kind,
    promptVersion: o.promptVersion ?? PROMPT_VERSION,
    model: o.model || null,
    durationMs: Math.max(0, Math.round(o.durationMs)),
    toolCalls: o.toolCalls ?? 0,
    toolFailures: o.toolFailures ?? 0,
    planGenerated: o.planGenerated ?? false,
    planAttempts: o.planAttempts ?? 0,
    degraded: o.degraded ?? false,
    degradeReason: o.degradeReason || null,
    journey: o.journey || null,
    stream: o.stream ?? false,
    error: o.error ? o.error.slice(0, 500) : null,
    inputTokens: priced.inputTokens,
    outputTokens: priced.outputTokens,
    costMicros: priced.costMicros
  }
}

/** 写一行度量。永不抛——调用方不需要 try/catch，也不该为它改控制流。 */
export async function recordAiCall(o: AiObservation): Promise<void> {
  try {
    await db.insert(aiCalls).values(row(o))
  } catch (err) {
    // 只记日志：这里抛出去会污染调用点的 catch 语义（模型失败 vs 埋点失败混成一种）
    console.error('[ai-metrics] record failed:', err)
  }
}

/** 毫秒计时起点 */
export function startedAt(): number {
  return Date.now()
}

/** 计时终点；负数钳成 0，防止系统时钟回拨写出负延迟把均值带偏 */
export function elapsedMs(from: number): number {
  return Math.max(0, Date.now() - from)
}
