import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { dataSubmissions } from '../db/schema.ts'

/** 仅记录人工复核，不把用户内容写入平台事实。 */
export async function reviewSubmission(id: string, decision: 'verified' | 'rejected', reviewer: string, reason: string): Promise<boolean> {
  if (!id.trim() || !reviewer.trim() || !reason.trim()) throw new Error('审核编号、审核人和依据均不能为空')
  const rows = await db.update(dataSubmissions).set({
    status: decision,
    reviewedBy: reviewer.trim(),
    reviewReason: reason.trim(),
    reviewedAt: new Date()
  }).where(and(eq(dataSubmissions.id, id), eq(dataSubmissions.status, 'pending'))).returning({ id: dataSubmissions.id })
  return rows.length === 1
}
