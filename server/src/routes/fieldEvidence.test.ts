import { afterAll, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { app } from '../app.ts'
import { db, pool } from '../db/client.ts'
import { fieldEvidence } from '../db/schema.ts'
const id = 'test-field-evidence'
afterAll(async () => { await db.delete(fieldEvidence).where(eq(fieldEvidence.id, id)); await pool.end() })
it('按对象读取字段来源并隔离其他对象', async () => {
  await db.delete(fieldEvidence).where(eq(fieldEvidence.id, id))
  await db.insert(fieldEvidence).values({ id, scope: 'place', targetId: 'test-place', field: 'ticket', value: '20', source: '测试公告', verifiedBy: '测试编辑', verifiedAt: new Date('2026-01-01T00:00:00Z') })
  const response = await app.request('/api/field-evidence?scope=place&targetId=test-place')
  expect((await response.json() as { items: { id: string }[] }).items).toEqual(expect.arrayContaining([expect.objectContaining({ id })]))
  const other = await app.request('/api/field-evidence?scope=place&targetId=other')
  expect((await other.json() as { items: unknown[] }).items).toEqual([])
  expect((await app.request('/api/field-evidence?scope=invalid')).status).toBe(400)
})
