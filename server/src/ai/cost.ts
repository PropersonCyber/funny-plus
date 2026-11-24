/**
 * 模型用量与成本的折算口径（F10）。
 *
 * 三件事必须分开，混在一起就会算错账：
 *
 * 1. **用量**（tokens）来自模型返回，是客观事实。
 * 2. **单价**是外部配置，会变 —— 所以从 env 读，不写死在代码里。
 *    写死的话，换模型或对方调价时，历史账单会被今天的单价重算，对不上。
 * 3. **费用**在写入时算好落库。查询时再乘单价，等于用今天的价格改写昨天的账单。
 *
 * 「不知道」与「零」严格区分：没拿到用量、没配单价，一律是 null，
 * 绝不用 0 顶替 —— 0 的意思是「这次免费」，那是另一件事。
 */

/** 单位：元 / 百万 token。缺省值只作兜底，部署时按实际合同配 */
const DEFAULT_INPUT_PER_MTOK = 1
const DEFAULT_OUTPUT_PER_MTOK = 2

export type TokenUsage = {
  inputTokens?: number | null
  outputTokens?: number | null
}

export type PricedUsage = {
  inputTokens: number | null
  outputTokens: number | null
  /** 1/1,000,000 元；null = 没有可用单价或没有用量 */
  costMicros: number | null
}

const num = (raw: string | undefined, fallback: number): number => {
  const n = Number.parseFloat((raw ?? '').trim())
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/**
 * 单价从环境变量读，按模型区分。
 *
 * 默认值只是「没配时不至于算出 null」的兜底，不是真实报价：
 * 各模型的输入/输出单价差得很远（输出通常是输入的 2–4 倍），
 * 用一组平均单价会让成本报表看起来精确、实际全错。
 */
export function priceOf(model: string | null | undefined): { inputPerMTok: number; outputPerMTok: number } {
  const key = (model ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '_')
  const inputRaw = key ? process.env[`AI_PRICE_${key}_INPUT`] : undefined
  const outputRaw = key ? process.env[`AI_PRICE_${key}_OUTPUT`] : undefined
  // 模型专属配置优先，其次全局默认，最后是代码里那组兜底
  return {
    inputPerMTok: num(inputRaw, num(process.env.AI_PRICE_INPUT_PER_MTOK, DEFAULT_INPUT_PER_MTOK)),
    outputPerMTok: num(outputRaw, num(process.env.AI_PRICE_OUTPUT_PER_MTOK, DEFAULT_OUTPUT_PER_MTOK))
  }
}

/**
 * 一次调用折算成可落库的三个值。
 *
 * 任何一侧的用量缺失时**整条 cost 记 null**：只有输入用量、没有输出用量时
 * 算出来的费用必然偏低，而偏低的价格比「不知道」更危险 —— 它会让人以为预算够。
 *
 * 用微元（1e-6 元）而不是元：整数落库，避免浮点累积误差；
 * 单次调用通常在几千微元量级，integer 足够。
 */
export function priceUsage(model: string | null | undefined, usage: TokenUsage | null | undefined): PricedUsage {
  const input = typeof usage?.inputTokens === 'number' && Number.isFinite(usage.inputTokens) ? Math.max(0, Math.round(usage.inputTokens)) : null
  const output = typeof usage?.outputTokens === 'number' && Number.isFinite(usage.outputTokens) ? Math.max(0, Math.round(usage.outputTokens)) : null
  if (input === null && output === null) return { inputTokens: null, outputTokens: null, costMicros: null }
  if (input === null || output === null) {
    // 用量只到一半：前面说了，半份用量算出来的价一定偏低，宁可记「不知道」
    return { inputTokens: input, outputTokens: output, costMicros: null }
  }
  const { inputPerMTok, outputPerMTok } = priceOf(model)
  const cost = (input / 1_000_000) * inputPerMTok + (output / 1_000_000) * outputPerMTok
  return { inputTokens: input, outputTokens: output, costMicros: Math.round(cost * 1_000_000) }
}

/** 微元 → 元的展示值；null 保持 null，界面据此显示「未知」而不是 0 */
export const microsToYuan = (micros: number | null): number | null =>
  micros === null ? null : Math.round(micros) / 1_000_000

/**
 * 一组调用的合计成本。
 *
 * 关键：**未知调用单独计数**，不参与求和，也不当成 0。
 * 只把已知的加起来会得到一个偏低的总额，看起来完整、实际少算了一部分 ——
 * 那比明确说「有 3 次没记到用量」更危险。
 */
export function totalCost(items: { costMicros: number | null }[]): {
  micros: number
  known: number
  unknown: number
  yuan: number
} {
  let micros = 0
  let known = 0
  let unknown = 0
  for (const item of items) {
    if (item.costMicros === null) unknown += 1
    else {
      micros += item.costMicros
      known += 1
    }
  }
  return { micros, known, unknown, yuan: Math.round(micros) / 1_000_000 }
}
