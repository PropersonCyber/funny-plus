import { afterAll, expect, it } from 'vitest'
import { inArray } from 'drizzle-orm'
import { app } from '../app.ts'
import { db, pool } from '../db/client.ts'
import { fieldEvidence } from '../db/schema.ts'
const id = 'test-field-evidence'
const laterId = 'test-field-evidence-later'
afterAll(async () => { await db.delete(fieldEvidence).where(inArray(fieldEvidence.id, [id, laterId])); await pool.end() })

it('按对象读取字段来源并隔离其他对象', async () => {
  await db.delete(fieldEvidence).where(inArray(fieldEvidence.id, [id, laterId]))
  await db.insert(fieldEvidence).values({ id, scope: 'place', targetId: 'test-place', field: 'ticket', value: '20', source: '测试公告', verifiedBy: '测试编辑', verifiedAt: new Date('2026-01-01T00:00:00Z') })
  const response = await app.request('/api/field-evidence?scope=place&targetId=test-place')
  expect((await response.json() as { items: { id: string }[] }).items).toEqual(expect.arrayContaining([expect.objectContaining({ id })]))
  const other = await app.request('/api/field-evidence?scope=place&targetId=other')
  expect((await other.json() as { items: unknown[] }).items).toEqual([])
  expect((await app.request('/api/field-evidence?scope=invalid')).status).toBe(400)
})

it('同一天的多次核验按时刻倒序，最新的排在最前', async () => {
  // 之前 verifiedAt 被裁成 YYYY-MM-DD 且查询没有排序，同一天两条的先后看数据库心情
  await db.delete(fieldEvidence).where(inArray(fieldEvidence.id, [id, laterId]))
  await db.insert(fieldEvidence).values([
    { id, scope: 'place', targetId: 'test-place', field: 'openText', value: '08:00-17:00', source: '测试公告', verifiedBy: '测试编辑', verifiedAt: new Date('2026-01-01T01:00:00Z') },
    { id: laterId, scope: 'place', targetId: 'test-place', field: 'openText', value: '09:00-18:00', source: '测试公告', verifiedBy: '测试编辑', verifiedAt: new Date('2026-01-01T09:00:00Z') }
  ])
  const response = await app.request('/api/field-evidence?scope=place&targetId=test-place')
  const items = (await response.json() as { items: { id: string; verifiedAt: string }[] }).items
  expect(items.map((i) => i.id)).toEqual([laterId, id])
  // 时刻不能被裁成日期，否则前端/引擎无法分辨先后
  expect(items[0].verifiedAt).toContain('T')
})
