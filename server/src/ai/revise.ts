import { generateText, stepCountIs, tool } from 'ai'
import { z } from 'zod'
import { chatModel } from './model.ts'
import { REVISE_SYSTEM_PROMPT } from './prompt.ts'
import { dayBrief } from '@/engine/planEdit.ts'
import { placesOf } from '@/engine/placeIndex.ts'
import type { Demand, Plan, ReviseOp } from '@/types/index.ts'

/**
 * 「这句话想怎么改」——由模型解析，只产出**动作**，不产出任何数字。
 *
 * 为什么单独成模块：对话里说「第二天下午轻松点」和行程页里「调整这一天」，
 * 走的是同一份解析契约（同一个 tool schema、同一个系统提示），
 * 否则两个入口对同一句话给出不同改动，用户会觉得是两个产品（AI Native 判据 J3）。
 *
 * 边界写死在这里：模型只能挑 item id 和 place id。
 * 时间段、路上耗时、门票金额一律由 shared/engine 计算后回给前端 —
 * 让模型自己写价格，它会给出一个自洽但错误的数，而用户没有能力分辨。
 */

/** 工具入参：字段全部可选，缺什么由引擎判「执行不了」，不在 schema 上偷偷兜底 */
const opSchema = z.object({
  op: z
    .enum(['drop', 'replace', 'reorder', 'none'])
    .describe('要做的动作。判断不出可执行的动作时用 none'),
  day: z.number().int().describe('改哪一天，用行程里已有的天的序号'),
  targetId: z.string().optional().describe('要删掉或替换的行程项 id，必须来自输入的 items，不得自造'),
  withPlaceId: z.string().optional().describe('replace 时换成哪个地点 id，必须来自输入的 candidates，不得自造'),
  order: z.array(z.string()).optional().describe('reorder 时这一天地点项按新顺序排的 id 列表'),
  reason: z.string().describe('一句话告诉用户这么改的理由，不超过 40 字，**不要出现任何数字或时刻**')
})


/** 给模型看的一天：id、地名、时刻、票价（null = 未核实，不许当 0） */
const brief = (plan: Plan, demand: Demand) => ({
  destination: demand.destination,
  party: demand.party,
  days: plan.days.map((d) => ({ day: d.index, items: dayBrief(d) })),
  candidates: placesOf(demand.destination).map((p) => ({
    id: p.id,
    name: p.name,
    ticket: p.ticket,
    stayMin: p.stayMin
  }))
})

export type ProposeResult =
  /** 模型给出一条可执行动作；能不能真执行还要过 applyReviseOp */
  | { ok: true; op: ReviseOp }
  /** 模型明确判断做不到，reason 可以直接给用户看 */
  | { ok: false; reason: string }
  /** 模型不可用或输出不可解析：调用方落回本地兜底，不要给用户看技术错误 */
  | { degraded: true }

export async function proposeReviseOp(
  plan: Plan,
  demand: Demand,
  instruction: string,
  currentDay?: number
): Promise<ProposeResult> {
  let raw: unknown
  try {
    const result = await generateText({
      model: chatModel(),
      system: REVISE_SYSTEM_PROMPT,
      prompt: JSON.stringify({
        instruction,
        currentDay: currentDay ?? null,
        ...brief(plan, demand)
      }),
      // 不给 execute：这一轮只要它把动作说出来，执行由调用方按引擎规则跑
      tools: { proposeRevise: tool({ description: '提交这次行程修改动作', inputSchema: opSchema }) },
      toolChoice: 'required',
      stopWhen: stepCountIs(1)
    })
    raw = result.toolCalls?.[0]?.input
  } catch (err) {
    console.error('[ai] revise proposal failed:', err)
    return { degraded: true }
  }

  const parsed = opSchema.safeParse(raw)
  if (!parsed.success) return { degraded: true }
  const picked = parsed.data

  if (picked.op === 'none') return { ok: false, reason: picked.reason }
  if (picked.op === 'replace' && !picked.withPlaceId) {
    return { ok: false, reason: '没听清要换成哪个地点，再说一次？' }
  }
  if (picked.op === 'reorder' && !picked.order?.length) {
    return { ok: false, reason: '没听出想换成什么顺序，说具体一点？' }
  }
  if (picked.op !== 'reorder' && !picked.targetId) {
    return { ok: false, reason: '没听出要动哪一个安排，说具体一点？' }
  }

  const op: ReviseOp =
    picked.op === 'drop'
      ? { op: 'drop', day: picked.day, targetId: picked.targetId!, reason: picked.reason }
      : picked.op === 'replace'
        ? { op: 'replace', day: picked.day, targetId: picked.targetId!, withPlaceId: picked.withPlaceId!, reason: picked.reason }
        : { op: 'reorder', day: picked.day, order: picked.order!, reason: picked.reason }
  return { ok: true, op }
}
