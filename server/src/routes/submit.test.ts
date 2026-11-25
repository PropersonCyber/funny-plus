import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, like } from 'drizzle-orm'
import { app } from '../app.ts'
import { db, pool } from '../db/client.ts'
import { authSessions, dataSubmissions, lines, smsCodes, users } from '../db/schema.ts'
import { reviewSubmission } from '../data/reviewSubmission.ts'
import { publishSubmission } from '../data/publishSubmission.ts'
import { fieldEvidence } from '../db/schema.ts'

/**
 * 用户补录待复核：连库验证提交留存，且不会自动修改线路事实。
 */
const LINE_ID = 't-c2-line'
const CLIENT_A = 't-c2-dev-a'
const CLIENT_B = 't-c2-dev-b'
const PHONE_A = '13900000021'
const PHONE_B = '13900000022'

const seedLine = () =>
  db.insert(lines).values({
    id: LINE_ID,
    city: '测试城',
    name: '测试索道',
    mode: 'cableway',
    stops: [
      { name: 'A', lng: 106.5, lat: 29.5 },
      { name: 'B', lng: 106.6, lat: 29.6 }
    ],
    tickets: [],
    firstBus: null,
    lastBus: null,
    intervalMin: null,
    source: '测试数据',
    trust: 'official'
  })

async function cleanup(): Promise<void> {
  await db.delete(fieldEvidence).where(eq(fieldEvidence.targetId, LINE_ID))
  await db.delete(dataSubmissions).where(eq(dataSubmissions.targetId, LINE_ID))
  await db.delete(dataSubmissions).where(like(dataSubmissions.clientId, 't-c2-dev-%'))
  await db.delete(lines).where(eq(lines.id, LINE_ID))
  await db.delete(smsCodes).where(like(smsCodes.phone, '1390000002%'))
  for (const phone of [PHONE_A, PHONE_B]) {
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.phone, phone))
    for (const u of rows) {
      await db.delete(authSessions).where(eq(authSessions.userId, u.id))
      await db.delete(users).where(eq(users.id, u.id))
    }
  }
}

beforeEach(async () => {
  await cleanup()
  await seedLine()
})
afterAll(async () => {
  await cleanup()
  await pool.end()
})

async function login(phone: string, clientId: string): Promise<string> {
  await app.request('/api/auth/sms-code', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone })
  })
  const res = await app.request('/api/auth/sms-verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone, code: '123456', clientId })
  })
  const body = (await res.json()) as Record<string, unknown>
  return String(body.token ?? '')
}

const submit = (clientId: string, value: string, token?: string) =>
  app.request('/api/submissions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ scope: 'line', targetId: LINE_ID, field: 'lastBus', value, clientId })
  })

const currentLine = async () => {
  const [row] = await db
    .select({ lastBus: lines.lastBus, trust: lines.trust })
    .from(lines)
    .where(eq(lines.id, LINE_ID))
    .limit(1)
  return row
}

describe('补录待复核', () => {
  it('仅发布已核验的缺失字段，并同时保留来源；重复发布不可覆盖', async () => {
    await submit(CLIENT_A, '17:00')
    const [row] = await db.select().from(dataSubmissions).where(eq(dataSubmissions.targetId, LINE_ID))
    await expect(publishSubmission(row.id, '官方公告', 'https://example.com')).rejects.toThrow()
    await reviewSubmission(row.id, 'verified', '编辑', '已核验')
    await publishSubmission(row.id, '官方公告', 'https://example.com')
    expect((await currentLine())?.lastBus).toBe(1020)
    const evidence = await db.select().from(fieldEvidence).where(eq(fieldEvidence.targetId, LINE_ID))
    expect(evidence).toHaveLength(1)
    expect(evidence[0]).toMatchObject({ field: 'lastBus', source: '官方公告' })
    await expect(publishSubmission(row.id, '官方公告', 'https://example.com')).rejects.toThrow()
  })
  it('人工复核留存依据且不可重复处理，不改变线路事实', async () => {
    await submit(CLIENT_A, '17:00')
    const [row] = await db.select().from(dataSubmissions).where(eq(dataSubmissions.targetId, LINE_ID))
    expect(await reviewSubmission(row.id, 'verified', '编辑甲', '官方公告核对')).toBe(true)
    expect(await reviewSubmission(row.id, 'rejected', '编辑乙', '重复处理')).toBe(false)
    const [reviewed] = await db.select().from(dataSubmissions).where(eq(dataSubmissions.id, row.id))
    expect(reviewed).toMatchObject({ status: 'verified', reviewedBy: '编辑甲', reviewReason: '官方公告核对' })
    expect(reviewed.reviewedAt).not.toBeNull()
    expect((await currentLine())?.lastBus).toBeNull()
  })
  it('一个人换两个 clientId 自证，不生效', async () => {
    // 这就是本用例存在的理由：clientId 由调用方自报，换字符串没有任何成本
    const first = await submit(CLIENT_A, '17:00')
    const second = await submit(CLIENT_B, '17:00')
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)

    const line = await currentLine()
    expect(line?.lastBus).toBeNull()
  })

  it('两个登录账号提交相同值仍待复核，不修改官方数据', async () => {
    const tokenA = await login(PHONE_A, CLIENT_A)
    const tokenB = await login(PHONE_B, CLIENT_B)
    expect(tokenA && tokenB).toBeTruthy()

    await submit(CLIENT_A, '17:00', tokenA)
    // 第二个账号使用另一种等价写法。
    await submit(CLIENT_B, '1020', tokenB)

    const line = await currentLine()
    expect(line?.lastBus).toBeNull()
    expect(line?.trust).toBe('official')
  })

  it('同一个账号换设备重投，去重后仍只算一票', async () => {
    const tokenA = await login(PHONE_A, CLIENT_A)
    await submit(CLIENT_A, '17:00', tokenA)
    await submit(CLIENT_B, '17:00', tokenA)

    expect((await currentLine())?.lastBus).toBeNull()
  })

  it('值对不上时不生效：两台设备说的不是同一件事', async () => {
    const tokenA = await login(PHONE_A, CLIENT_A)
    const tokenB = await login(PHONE_B, CLIENT_B)
    await submit(CLIENT_A, '17:00', tokenA)
    await submit(CLIENT_B, '18:00', tokenB)

    expect((await currentLine())?.lastBus).toBeNull()
  })

  it('等价写法的提交均保持待核验', async () => {
    const tokenA = await login(PHONE_A, CLIENT_A)
    const tokenB = await login(PHONE_B, CLIENT_B)
    await submit(CLIENT_A, '17:00', tokenA)
    await submit(CLIENT_B, '1020', tokenB)

    const rows = await db
      .select({ value: dataSubmissions.value, status: dataSubmissions.status })
      .from(dataSubmissions)
      .where(and(eq(dataSubmissions.targetId, LINE_ID), eq(dataSubmissions.field, 'lastBus')))
    // "17:00" 与 "1020" 均须等待复核。
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.status === 'pending')).toBe(true)
  })
})
