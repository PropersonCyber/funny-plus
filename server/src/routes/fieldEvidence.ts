import { Hono } from 'hono'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { fieldEvidence } from '../db/schema.ts'

export const fieldEvidenceRoute = new Hono()
fieldEvidenceRoute.get('/', async (c) => {
  const scope = c.req.query('scope')
  const targetId = c.req.query('targetId')?.trim()
  if ((scope !== 'place' && scope !== 'line') || !targetId) return c.json({ error: '需要有效的对象类型和编号' }, 400)
  const rows = await db.select({
    id: fieldEvidence.id,
    scope: fieldEvidence.scope,
    targetId: fieldEvidence.targetId,
    field: fieldEvidence.field,
    value: fieldEvidence.value,
    source: fieldEvidence.source,
    sourceUrl: fieldEvidence.sourceUrl,
    verifiedAt: fieldEvidence.verifiedAt,
    validUntil: fieldEvidence.validUntil
  }).from(fieldEvidence)
    .where(and(eq(fieldEvidence.scope, scope), eq(fieldEvidence.targetId, targetId)))
    // 与 fieldEvidenceQuery 同一套总序：同时刻靠 id 定先后，不靠返回顺序
    .orderBy(desc(fieldEvidence.verifiedAt), desc(fieldEvidence.id))
  return c.json({ items: rows })
})
