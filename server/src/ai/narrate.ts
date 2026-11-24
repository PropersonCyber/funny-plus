import { generateText, stepCountIs, tool } from 'ai'
import { z } from 'zod'
import { chatModel } from './model.ts'
import type { TokenUsage } from './cost.ts'

/**
 * 回忆的叙述整理（N8 之后：从「确定性拼串」到「人话叙述」）。
 *
 * 边界：模型**只做重排与措辞**，不新增任何事实。这是整份回忆最重要的红线 ——
 * 回忆是「实际发生了什么」，一旦模型编了一句「下午很惬意」，用户自己在攻略里
 * 就分不清哪些是他写的、哪些是机器写的，亲历与计划的边界就废了。
 *
 * 所以输入只给「用户已经写下的东西」，输出逐条带 sourceRef：
 * 每条叙述必须指向输入里的某条记录，指向不上的句子一律丢弃（见 applyNarrative）。
 * 模型想编一句评论，就会因为没有可挂靠的记录而被扔掉。
 */

const narrativeSchema = z.object({
  paragraphs: z
    .array(
      z.object({
        /** 对应输入里的哪一条记录（`day:itemId`）；整段总结用 `overview` 之外的固定值 */
        sourceRef: z.string().describe('这句叙述来自输入里的哪条记录，必须原样抄输入的 ref 字段'),
        text: z.string().describe('把这条记录改写成通顺的一句话，不得新增任何事实、感受或评价')
      })
    )
    .describe('按天顺序排列')
})

export type NarrativeParagraph = { sourceRef: string; text: string }
/**
 * `usage` 由调用点落库折算成本；degraded 分支也带用量 ——
 * 模型答得不对不代表这次没花钱。
 */
export type NarrativeResult =
  | { ok: true; paragraphs: NarrativeParagraph[]; usage: TokenUsage | null }
  | { ok: false; degraded: true; usage: TokenUsage | null }

/** 一条喂给模型的记录：ref 是它在输入里的唯一标识，也是模型唯一被允许挂靠的锚点 */
export type NarrativeSource = {
  /** `d{n}:{itemId}` 或 `unrecorded` */
  ref: string
  day: number
  title: string
  visited: 'yes' | 'no' | 'unknown'
  /** 用户原文；空串表示只有勾选没有写字 */
  text: string
  hasPhotos: boolean
}

export const NARRATIVE_SYSTEM_PROMPT = `你是「咕噜」，正在把一趟旅行的记录整理成一段回顾。你这一轮只做一件事：
把用户已经写下的内容改写得通顺，交给 writeNarrative 工具。

硬性约束（违反会被程序直接丢弃）：
1. **不得新增任何事实**。不提输入里没有的地点、时间、价格、天气。
2. **不得编造感受或评价**。不要写「很惬意」「令人难忘」「不虚此行」这类词；
   用户没写的体验，一个字都不能替他补。只做语序调整与连接词。
3. 每条输出必须带 sourceRef，值必须原样抄输入里某条记录的 ref。
   一条输入最多对应一条输出。指向不上任何输入的句子会被丢掉。
4. visited 为 no 的记录要明写「没去」，不能从回顾里消失——那是用户明确否认过的。
   visited 为 unknown 的只能说「有记录但未确认到访」，不能写成去过。
5. text 为空的记录只写「去了」或「没去」，不要为它编内容。
6. 保持第一人称、口语、简短。不要加标题、不要加 emoji、不要用分点符号。`

export async function narrateMemory(sources: NarrativeSource[]): Promise<NarrativeResult> {
  if (!sources.length) return { ok: false, degraded: true, usage: null }

  let raw: unknown
  let usage: TokenUsage | null = null
  try {
    const result = await generateText({
      model: chatModel(),
      system: NARRATIVE_SYSTEM_PROMPT,
      prompt: JSON.stringify({
        // 只给用户写过的东西。给整份 plan 会让模型开始描述「计划」而不是「经历」
        records: sources.map((s) => ({
          ref: s.ref,
          day: s.day,
          place: s.title,
          visited: s.visited,
          userText: s.text,
          hasPhotos: s.hasPhotos
        }))
      }),
      tools: {
        writeNarrative: tool({
          description: '提交整理好的叙述',
          inputSchema: narrativeSchema
        })
      },
      toolChoice: 'required',
      stopWhen: stepCountIs(1)
    })
    raw = result.toolCalls?.[0]?.input
    usage = { inputTokens: result.usage?.inputTokens ?? null, outputTokens: result.usage?.outputTokens ?? null }
  } catch (err) {
    console.error('[ai] memory narrative failed:', err)
    return { ok: false, degraded: true, usage }
  }

  const parsed = narrativeSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, degraded: true, usage }
  return { ok: true, paragraphs: applyNarrative(parsed.data.paragraphs, sources), usage }
}

/**
 * 把模型的输出与输入记录对齐。
 *
 * 这里做的是**剪枝而不是信任**：
 * - `sourceRef` 不在输入里的段落直接丢弃（模型编了一句评论，没有可挂靠的记录）
 * - 同一条记录的第二句也丢弃（一条记录只该被改写一次，多出来的是模型在加戏）
 *
 * 抽成纯函数是因为它不依赖模型，可以直接测：模型再怎么编，这一层都只放行
 * 「指向真实记录、且每条只一次」的句子。
 */
export function applyNarrative(paragraphs: { sourceRef: string; text: string }[], sources: NarrativeSource[]): NarrativeParagraph[] {
  const valid = new Set(sources.map((s) => s.ref))
  const seen = new Set<string>()
  return paragraphs.filter((p) => {
    if (!valid.has(p.sourceRef)) return false
    if (seen.has(p.sourceRef)) return false
    if (!p.text.trim()) return false
    seen.add(p.sourceRef)
    return true
  })
}
