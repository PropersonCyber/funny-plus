import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, like } from 'drizzle-orm'
import { app } from '../app.ts'
import { db, pool } from '../db/client.ts'
import { authSessions, dataSubmissions, lines, smsCodes, users } from '../db/schema.ts'

/**
 * 补录生效（C2）打真库验证。
 *
 * 必须连库：要验的是「谁能凑成那两票」——`clientId` 是客户端自报的，
 * 而账号归属来自 token。这两件事只有真跑一遍 INSERT/UPDATE 才说得清。
 *
 * 核心用例是**一个人自导自演**：同一请求体里换两次 clientId，
 * 过去就能把一条未经核验的末班写进线上表。
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

describe('补录生效（C2）', () => {
  it('一个人换两个 clientId 自证，不生效', async () => {
    // 这就是本用例存在的理由：clientId 由调用方自报，换字符串没有任何成本
    const first = await submit(CLIENT_A, '17:00')
    const second = await submit(CLIENT_B, '17:00')
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)

    const line = await currentLine()
    expect(line?.lastBus).toBeNull()
  })

  it('两个登录账号说同一个值才写进线上表，并降到用户填报档', async () => {
    const tokenA = await login(PHONE_A, CLIENT_A)
    const tokenB = await login(PHONE_B, CLIENT_B)
    expect(tokenA && tokenB).toBeTruthy()

    await submit(CLIENT_A, '17:00', tokenA)
    // 第二个账号用另一种写法：归一化之后应该是同一个值
    await submit(CLIENT_B, '1020', tokenB)

    const line = await currentLine()
    expect(line?.lastBus).toBe(1020)
    // 用户填报不能顶着官方身份去判硬冲突
    expect(line?.trust).toBe('experience')
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

  it('生效后所有等价写法的行都标成已核验', async () => {
    const tokenA = await login(PHONE_A, CLIENT_A)
    const tokenB = await login(PHONE_B, CLIENT_B)
    await submit(CLIENT_A, '17:00', tokenA)
    await submit(CLIENT_B, '1020', tokenB)

    const rows = await db
      .select({ value: dataSubmissions.value, status: dataSubmissions.status })
      .from(dataSubmissions)
      .where(and(eq(dataSubmissions.targetId, LINE_ID), eq(dataSubmissions.field, 'lastBus')))
    // "17:00" 与 "1020" 是同一个值的两种写法，都该显示「已核验」
    expect(rows.every((r) => r.status === 'verified')).toBe(true)
  })
})
