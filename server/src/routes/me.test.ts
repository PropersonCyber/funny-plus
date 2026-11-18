import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, isNull, like } from 'drizzle-orm'
import { app } from '../app.ts'
import { db, pool } from '../db/client.ts'
import { authSessions, collections, smsCodes, users } from '../db/schema.ts'

/**
 * 收藏归属（R5）：clientId 是设备标识，不是身份凭证。
 *
 * 这条必须打真库：要验的正是 SQL 里 `userId` 与 `clientId` 的组合条件，
 * mock 掉就问不出「A 拿着 B 的 clientId 能不能删 B 的行」。
 */
const C1 = 't-client-r5-a'
const C2 = 't-client-r5-b'
const PHONE = '13900000001'
const TARGET = 'cq-hongyadong'

async function cleanup(): Promise<void> {
  await db.delete(smsCodes).where(like(smsCodes.phone, '139000000%'))
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.phone, PHONE))
  for (const u of rows) {
    await db.delete(authSessions).where(eq(authSessions.userId, u.id))
    await db.delete(collections).where(eq(collections.userId, u.id))
    await db.delete(users).where(eq(users.id, u.id))
  }
  await db.delete(collections).where(like(collections.clientId, 't-client-r5-%'))
}

beforeEach(cleanup)
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

const del = (token: string | null, clientId: string) =>
  app.request(
    `/api/me/collections?clientId=${clientId}&targetType=place&targetId=${TARGET}`,
    {
      method: 'DELETE',
      headers: token ? { authorization: `Bearer ${token}` } : {}
    }
  )

const countRows = async (clientId: string) =>
  (await db.select().from(collections).where(eq(collections.clientId, clientId))).length

describe('收藏删除按账号归属（R5）', () => {
  it('匿名时仍按 clientId 删自己的', async () => {
    await db.insert(collections).values({ id: 'r5-anon', clientId: C1, userId: null, targetType: 'place', targetId: TARGET })
    const res = await del(null, C1)
    expect(res.status).toBe(200)
    expect(await countRows(C1)).toBe(0)
  })

  it('带着别人的 clientId 来删，删不掉别人的行', async () => {
    // B 的匿名收藏：user_id 为空
    await db.insert(collections).values({ id: 'r5-b', clientId: C2, userId: null, targetType: 'place', targetId: TARGET })
    const tokenA = await login(PHONE, C1)
    expect(tokenA).toBeTruthy()

    // A 登录后带着 B 的 clientId 删除：scope 走 userId（A 名下无此行）∪ 未并账且同 clientId（A 的 C1，不是 C2）
    const res = await del(tokenA, C2)
    expect(res.status).toBe(200)
    expect(await countRows(C2)).toBe(1)
  })

  it('登录时匿名期收藏被认领到账号，之后可删', async () => {
    // 先以匿名身份留下一条收藏
    await db.insert(collections).values({ id: 'r5-own', clientId: C1, userId: null, targetType: 'place', targetId: TARGET })

    // 登录会把本机 clientId 名下未并账的行认领到账号（claimAnonData），
    // 所以登录后不该再有 user_id 为空的本机行
    const tokenA = await login(PHONE, C1)
    const orphan = await db
      .select()
      .from(collections)
      .where(and(isNull(collections.userId), eq(collections.clientId, C1)))
    expect(orphan.length).toBe(0)

    const res = await del(tokenA, C1)
    expect(res.status).toBe(200)
    expect(await countRows(C1)).toBe(0)
  })
})
