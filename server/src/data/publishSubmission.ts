import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { dataSubmissions, fieldEvidence, lines, places } from '../db/schema.ts'
import { capTrust, normalizeSubmitValue } from './trustRules.ts'
import { invalidateEngine } from '../engineCache.ts'

/** 手动发布已复核的缺失字段：事实写入和证据记录在同一事务内完成。 */
export async function publishSubmission(id: string, source: string, sourceUrl: string): Promise<void> {
  if (!source.trim() || !/^https?:\/\//i.test(sourceUrl)) throw new Error('必须提供来源名称和网址')
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(dataSubmissions).where(eq(dataSubmissions.id, id)).limit(1)
    if (!row || row.status !== 'verified' || !row.reviewedBy || !row.reviewedAt) throw new Error('仅可发布已核验的记录')
    const normalized = normalizeSubmitValue(row.field, row.value)
    if (!normalized) throw new Error('补录值不合法')
    let written: { id: string }[] = []
    if (row.scope === 'line' && normalized.kind === 'minutes' && ['firstBus', 'lastBus', 'intervalMin'].includes(row.field)) {
      const field = row.field as 'firstBus' | 'lastBus' | 'intervalMin'
      const [current] = await tx.select({ trust: lines.trust }).from(lines).where(eq(lines.id, row.targetId)).limit(1)
      if (!current) throw new Error('对象不存在')
      written = await tx.update(lines).set({ [field]: normalized.value, trust: capTrust(current.trust, 'experience'), updatedAt: new Date() })
        .where(and(eq(lines.id, row.targetId), isNull(lines[field]))).returning({ id: lines.id })
    } else if (row.scope === 'place' && row.field === 'openText' && normalized.kind === 'text') {
      const [current] = await tx.select({ trust: places.trust }).from(places).where(eq(places.id, row.targetId)).limit(1)
      if (!current) throw new Error('对象不存在')
      written = await tx.update(places).set({ openText: normalized.label, trust: capTrust(current.trust, 'experience') })
        .where(and(eq(places.id, row.targetId), isNull(places.openText))).returning({ id: places.id })
    } else throw new Error('该字段暂不支持发布')
    if (!written.length) throw new Error('对象不存在或已有事实；不能覆盖')
    await tx.insert(fieldEvidence).values({ id: crypto.randomUUID(), scope: row.scope as 'line' | 'place', targetId: row.targetId,
      field: row.field, value: normalized.label, source: source.trim(), sourceUrl, verifiedBy: row.reviewedBy, verifiedAt: row.reviewedAt })
  })
  invalidateEngine()
}
