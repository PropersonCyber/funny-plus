import { and, desc, eq, inArray } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { fieldEvidence } from '../db/schema.ts'
import type { FieldEvidence } from '@/types/index.ts'

/**
 * 按对象批量取字段依据（清单 §2.4「消费链路接入」的取数口）。
 *
 * 为什么批量：地点池一次 37 条、线路 5 条，逐条查就是 42 次往返。
 * 为什么按 targetId 分组返回而不是让调用方自己 filter：三个序列化器
 * （`/api/places`、`/api/content`、`/api/lines`）都要同一份，分组逻辑放这里一份。
 *
 * 日期口径分两种，不要混：`verifiedAt` 是**时刻**（完整 ISO），`validUntil` 是**日期**。
 * 核验时刻戟成日期会让同一天的两条依据变成同一个值，「取最新」就只能看数据库
 * 返回顺序 —— 后核的依据可能被先核的盖掉。
 */
export async function loadFieldEvidence(
  scope: 'place' | 'line',
  ids?: string[]
): Promise<Map<string, FieldEvidence[]>> {
  // 明确传了空数组 = 这次没有对象要查，不要退化成「查全部」
  if (ids && !ids.length) return new Map()

  const rows = await db
    .select()
    .from(fieldEvidence)
    .where(ids ? and(eq(fieldEvidence.scope, scope), inArray(fieldEvidence.targetId, ids)) : eq(fieldEvidence.scope, scope))
    // 新→旧。同时刻时用 id 定一个稳的总序，否则同一时刻下的两条依据先后看数据库心情
    .orderBy(desc(fieldEvidence.verifiedAt), desc(fieldEvidence.id))

  const out = new Map<string, FieldEvidence[]>()
  for (const r of rows) {
    const day = (d: Date | null): string | undefined => (d ? d.toISOString().slice(0, 10) : undefined)
    const list = out.get(r.targetId) ?? []
    list.push({
      id: r.id,
      field: r.field,
      value: r.value,
      source: r.source,
      sourceUrl: r.sourceUrl ?? undefined,
      verifiedAt: r.verifiedAt.toISOString(),
      validUntil: day(r.validUntil)
    })
    out.set(r.targetId, list)
  }
  return out
}
