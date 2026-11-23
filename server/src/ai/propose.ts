import { generateText, stepCountIs, tool } from 'ai'
import { z } from 'zod'
import { chatModel } from './model.ts'
import { PLAN_SYSTEM_PROMPT } from './prompt.ts'
import { placesOf } from '@/engine/placeIndex.ts'
import type { Demand } from '@/types/index.ts'

/**
 * 表单主链路的「模型提案」（N10）。
 *
 * 模型只做一件事：在已收录的地点里挑一套走法和顺序。
 * 时刻、路上耗时、预算、校验全部仍由 shared/engine 算 ——
 * 这是整条链路唯一不能让步的分工：让模型自己写票价，它会给出一个自洽但错误的数，
 * 而用户没有能力分辨（与 revise.ts 同一条边界）。
 *
 * 返回值故意不做「部分成功」：要么给一个可用的顺序，要么退化成 degraded，
 * 由调用方落回本地引擎。半套顺序混进去反而更难解释。
 */

/** 提案 schema：只要 id 序列 + 一句理由，不要任何数字 */
const orderSchema = z.object({
  order: z
    .array(z.string())
    .describe('按第 1 天到第 N 天的游玩顺序排列的地点 id，必须全部来自输入的 places，不得自造'),
  reason: z.string().describe('一句话说明为什么这么排，不超过 40 字')
})

export type PlanProposal = { ok: true; order: string[]; reason: string } | { degraded: true }

export async function proposePlanOrder(demand: Demand): Promise<PlanProposal> {
  const pool = placesOf(demand.destination)
  if (!pool.length) return { degraded: true }

  let raw: unknown
  try {
    const result = await generateText({
      model: chatModel(),
      system: PLAN_SYSTEM_PROMPT,
      prompt: JSON.stringify({
        demand,
        places: pool.map((p) => ({
          id: p.id,
          name: p.name,
          tags: p.tags,
          // null = 票价未核验，给模型看的就是 null，不让它当成 0 也不让它猜
          ticket: p.ticket,
          stayMin: p.stayMin
        })),
        // 一天排几个点由引擎按节奏决定，这里只告诉模型大概的量级，避免它排出 12 个点的水泥路
        perDayHint: { relaxed: 2, balanced: 3, packed: 4 }
      }),
      tools: { proposeOrder: tool({ description: '提交这套行程的地点顺序', inputSchema: orderSchema }) },
      toolChoice: 'required',
      stopWhen: stepCountIs(1)
    })
    raw = result.toolCalls?.[0]?.input
  } catch (err) {
    console.error('[ai] plan proposal failed:', err)
    return { degraded: true }
  }

  const parsed = orderSchema.safeParse(raw)
  if (!parsed.success) return { degraded: true }
  if (!parsed.data.order.length) return { degraded: true }
  return { ok: true, order: parsed.data.order, reason: parsed.data.reason }
}
