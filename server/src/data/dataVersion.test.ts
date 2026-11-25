import { afterAll, expect, it } from 'vitest'
import { inArray, sql } from 'drizzle-orm'
import { db, pool } from '../db/client.ts'
import { fieldEvidence } from '../db/schema.ts'
import { dataVersion } from './dataVersion.ts'

const ids = ['test-data-version-a', 'test-data-version-b']
afterAll(async () => {
  await db.delete(fieldEvidence).where(inArray(fieldEvidence.id, ids))
  await pool.end()
})

const row = (id: string, verifiedAt: string) => ({
  id,
  scope: 'place' as const,
  targetId: 'test-place',
  field: 'openText',
  value: '08:00-17:00',
  source: '测试公告',
  verifiedBy: '测试编辑',
  verifiedAt: new Date(verifiedAt)
})

/**
 * 版本号是「跨进程数据同步」的唯一依据，所以它必须对**增、改、删**分别都动。
 *
 * 每一步中间都读一次版本：不这样断言的话，「插入也改了版本」会让删除触发器的失效
 * 永远测不出来 —— 那正是这个测试存在的理由。
 */
it('新增、修改、删除各自都推进版本号', async () => {
  await db.delete(fieldEvidence).where(inArray(fieldEvidence.id, ids))
  const v0 = await dataVersion()

  await db.insert(fieldEvidence).values(row(ids[0], '2026-11-20T01:00:00Z'))
  const afterInsert = await dataVersion()
  expect(afterInsert).not.toBe(v0)

  // 改内容但不碰 createdAt：比 max(created_at) 时这里会漏
  await db.execute(sql`update field_evidence set source = '改过的公告' where id = ${ids[0]}`)
  const afterUpdate = await dataVersion()
  expect(afterUpdate).not.toBe(afterInsert)

  // 再插一条更新的，然后删掉旧的那条：最大值不受影响。
  // **必须在插入之后重新取基线**，否则插入带来的变化会掩盖删除触发器失效。
  await db.insert(fieldEvidence).values(row(ids[1], '2026-11-21T01:00:00Z'))
  const beforeDelete = await dataVersion()
  await db.delete(fieldEvidence).where(inArray(fieldEvidence.id, [ids[0]]))
  const afterDelete = await dataVersion()
  expect(afterDelete).not.toBe(beforeDelete)
})

it('删除本身就是一次写入：只删新增的那条也要推进版本号', async () => {
  // 上一条用例把 ids[0] 删了、ids[1] 还在。这里删掉它，基线必须当场取
  const beforeDelete = await dataVersion()
  await db.delete(fieldEvidence).where(inArray(fieldEvidence.id, [ids[1]]))
  expect(await dataVersion()).not.toBe(beforeDelete)
})

it('没有写入时版本号稳定：不然每个 AI 请求都要重装引擎', async () => {
  expect(await dataVersion()).toBe(await dataVersion())
})
