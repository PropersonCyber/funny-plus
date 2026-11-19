import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, like } from 'drizzle-orm'
import { app } from '../app.ts'
import { db, pool } from '../db/client.ts'
import { aiMessages, aiSessions, authSessions, smsCodes, users } from '../db/schema.ts'
import { appendTurn, latestTurnsOf, loadTurns, resolveSession } from '../ai/history.ts'

/**
 * 会话上云（G6）的集成测试：直接打真库。
 *
 * 为什么不打 `/api/ai/chat`：那条路要真调模型，一次几秒、结果随模型变，
 * 钉不住也不该让单测依赖外网。会话的**存储语义**（归属、续聊、裁剪、只读文本）
 * 全在 history.ts 里，测它就够了；chat → 落库这一段走手工冒烟。
 */

const P1 = '13700000001'
const P2 = '13700000002'

/** 手机号 → userId，由 login() 填；断言归属时用 */
const userIdByPhone: Record<string, string> = {}

const auth = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
  'content-type': 'application/json'
})

async function cleanup(): Promise<void> {
  await db.delete(smsCodes).where(like(smsCodes.phone, '137000000%'))
  for (const phone of [P1, P2]) {
    for (const u of await db.select({ id: users.id }).from(users).where(eq(users.phone, phone))) {
      await db.delete(authSessions).where(eq(authSessions.userId, u.id))
      await db.delete(aiSessions).where(eq(aiSessions.userId, u.id))
      await db.delete(users).where(eq(users.id, u.id))
    }
  }
  // 消息没有 userId 列（它挂在会话下），按 sessionId 前缀清
  await db.delete(aiMessages).where(like(aiMessages.sessionId, 'g6-%'))
}

beforeEach(cleanup)
afterAll(async () => {
  await cleanup()
  await pool.end()
})

async function login(phone: string): Promise<string> {
  await app.request('/api/auth/sms-code', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone })
  })
  const res = await app.request('/api/auth/sms-verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone, code: '123456', clientId: `g6-${phone}` })
  })
  const body = (await res.json()) as { token?: string; user?: { id: string } }
  userIdByPhone[phone] = body.user?.id ?? ''
  return String(body.token ?? '')
}

describe('会话归属与续聊（G6）', () => {
  it('未登录读历史 401：会话是账号私有内容', async () => {
    expect((await app.request('/api/ai/history?tripId=g6-trip')).status).toBe(401)
  })

  it('没带 tripId 时回空历史而不是报错：从零规划本来就没有历史可续', async () => {
    const token = await login(P1)
    const res = await app.request('/api/ai/history', { headers: auth(token) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sessionId: null, turns: [], updatedAt: null })
  })

  it('同一 tripId 第二次进助手能读回上次的两句话', async () => {
    const token = await login(P1)
    const uid = userIdByPhone[P1]!
    const session = await resolveSession(uid, '', 'g6-trip-a')
    await appendTurn(uid, session.id, 'g6-trip-a', '重庆两天怎么排', '第一天先去鹅岭二厂')

    const res = await app.request('/api/ai/history?tripId=g6-trip-a', { headers: auth(token) })
    const body = (await res.json()) as {
      sessionId: string
      turns: { role: string; content: string }[]
    }
    expect(body.sessionId).toBe(session.id)
    expect(body.turns).toEqual([
      { role: 'user', content: '重庆两天怎么排' },
      { role: 'assistant', content: '第一天先去鹅岭二厂' }
    ])
  })

  it('换个行程就是另一段历史，不串台', async () => {
    const token = await login(P1)
    const uid = userIdByPhone[P1]!
    const s = await resolveSession(uid, '', 'g6-trip-a')
    await appendTurn(uid, s.id, 'g6-trip-a', 'a 行程', 'a 回答')

    const other = await app.request('/api/ai/history?tripId=g6-trip-b', { headers: auth(token) })
    expect(((await other.json()) as { turns: unknown[] }).turns).toEqual([])
  })

  it('读历史只回 role + content：方案卡与预览卡不在协议里，也就无法被复活', async () => {
    const token = await login(P1)
    const uid = userIdByPhone[P1]!
    const s = await resolveSession(uid, '', 'g6-trip-a')
    await appendTurn(uid, s.id, 'g6-trip-a', '改第二天', '已提了一版修改')

    const res = await app.request('/api/ai/history?tripId=g6-trip-a', { headers: auth(token) })
    const body = (await res.json()) as { turns: Record<string, unknown>[] }
    for (const t of body.turns) {
      expect(Object.keys(t).sort()).toEqual(['content', 'role'])
    }
  })

  it('别人拿到我的 sessionId 也读不到：查询带 userId', async () => {
    const tokenA = await login(P1)
    const uidA = userIdByPhone[P1]!
    const s = await resolveSession(uidA, '', 'g6-trip-a')
    await appendTurn(uidA, s.id, 'g6-trip-a', '只有 A 能看', 'A 的回答')

    // B 用自己的 token 读 A 的会话 id：历史接口只按 tripId 查，所以这里直接验证 loadTurns 的归属
    await login(P2)
    const uidB = userIdByPhone[P2]!
    expect(await loadTurns(uidB, s.id)).toEqual([])
    // B 拿 A 的 id 去 resolveSession：不采纳，新建自己的
    const mine = await resolveSession(uidB, s.id, 'g6-trip-a')
    expect(mine.id).not.toBe(s.id)
    expect(mine.userId).toBe(uidB)
    void tokenA
  })

  it('同一个 id 属于自己时复用，不新建', async () => {
    const token = await login(P1)
    const uid = userIdByPhone[P1]!
    const s = await resolveSession(uid, '', 'g6-trip-a')
    const again = await resolveSession(uid, s.id, 'g6-trip-a')
    expect(again.id).toBe(s.id)
    void token
  })
})

describe('历史裁剪', () => {
  it('超过 40 轮只留最后 40 轮：再多的部分模型也读不完', async () => {
    const token = await login(P1)
    const uid = userIdByPhone[P1]!
    const s = await resolveSession(uid, '', 'g6-trip-trim')
    for (let i = 0; i < 45; i += 1) {
      await appendTurn(uid, s.id, 'g6-trip-trim', `第 ${i} 句`, `第 ${i} 答`)
    }
    const turns = await loadTurns(uid, s.id)
    expect(turns.length).toBe(80)
    // 留的是最近的：最后两句必须在
    expect(turns[turns.length - 1]?.content).toBe('第 44 答')
    void token
  })
})

describe('latestTurnsOf', () => {
  it('没有会话时返回 null，不抛', async () => {
    const token = await login(P1)
    expect(await latestTurnsOf(userIdByPhone[P1]!, 'g6-none')).toBeNull()
    void token
  })

  it('同一 tripId 有多段会话时取最近更新的那段', async () => {
    const token = await login(P1)
    const uid = userIdByPhone[P1]!
    // 直接造两段会话：resolveSession 会复用同 tripId 的最近一段，走它造不出「多段」
    await db.insert(aiSessions).values([
      { id: 'g6-old', userId: uid, tripId: 'g6-trip-multi', updatedAt: new Date('2026-11-01T00:00:00Z') },
      { id: 'g6-new', userId: uid, tripId: 'g6-trip-multi', updatedAt: new Date('2026-11-05T00:00:00Z') }
    ])
    await db
      .insert(aiMessages)
      .values({ id: 'g6-msg-old', sessionId: 'g6-old', role: 'user', content: '旧' })
    // 只给新的那段写：appendTurn 会把会话的 updatedAt 刷成现在，两段都刷就分不出先后
    await appendTurn(uid, 'g6-new', 'g6-trip-multi', '新', '新回答')

    const got = await latestTurnsOf(uid, 'g6-trip-multi')
    expect(got?.sessionId).toBe('g6-new')
    expect(got?.turns.map((t) => t.content)).toEqual(['新', '新回答'])
    void token
  })
})