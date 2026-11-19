import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, like } from 'drizzle-orm'
import { app } from '../app.ts'
import { db, pool } from '../db/client.ts'
import {
  authSessions,
  guideDrafts,
  guideShares,
  smsCodes,
  tripMemories,
  tripVersions,
  trips,
  users
} from '../db/schema.ts'
import type { Demand, Plan } from '@/types/index.ts'

/**
 * G5 云端拉取的集成测试：直接打真库。
 *
 * 与 auth.test.ts 同一个理由：要验的是 SQL 条件与列读写，`plans` / `plan_index` /
 * `ended_at` 这几列有没有真的写进去、旧行读出来会不会散架，mock 一律看不出来。
 *
 * 测试数据统一 `g5-` 前缀，beforeEach 按前缀清，不碰种子数据。
 */

const P1 = '13900000001'
const C1 = 'g5-client-1'

async function cleanup(): Promise<void> {
  await db.delete(smsCodes).where(like(smsCodes.phone, '139000000%'))
  for (const u of await db.select({ id: users.id }).from(users).where(eq(users.phone, P1))) {
    await db.delete(authSessions).where(eq(authSessions.userId, u.id))
    await db.delete(trips).where(eq(trips.userId, u.id))
    await db.delete(tripMemories).where(eq(tripMemories.userId, u.id))
    await db.delete(guideDrafts).where(eq(guideDrafts.userId, u.id))
    await db.delete(guideShares).where(eq(guideShares.userId, u.id))
    await db.delete(users).where(eq(users.id, u.id))
  }
  await db.delete(trips).where(like(trips.id, 'g5-%'))
  await db.delete(tripVersions).where(like(tripVersions.tripId, 'g5-%'))
  await db.delete(tripMemories).where(like(tripMemories.tripId, 'g5-%'))
  await db.delete(guideDrafts).where(like(guideDrafts.id, 'g5-%'))
  await db.delete(guideShares).where(like(guideShares.draftId, 'g5-%'))
}

beforeEach(cleanup)
afterAll(async () => {
  await cleanup()
  await pool.end()
})

async function login(): Promise<string> {
  await app.request('/api/auth/sms-code', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: P1 })
  })
  const res = await app.request('/api/auth/sms-verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: P1, code: '123456', clientId: C1 })
  })
  const body = (await res.json()) as { token?: string }
  return String(body.token ?? '')
}

const auth = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
  'content-type': 'application/json'
})

const DEMAND: Demand = {
  destination: 'chongqing',
  dayCount: 2,
  party: 2,
  budgetLevel: 'mid',
  preferences: [],
  transport: 'public',
  notes: ''
}

const plan = (id: string, pace: Plan['pace']): Plan => ({
  id,
  pace,
  paceLabel: pace,
  transport: 'public',
  destination: 'chongqing',
  suitableFor: '',
  highlights: [],
  days: [],
  budget: { items: [], total: 0, perPerson: 0, uncertain: [] },
  issues: []
})

const put = (token: string, id: string, body: Record<string, unknown>) =>
  app.request(`/api/trips/${id}`, { method: 'PUT', headers: auth(token), body: JSON.stringify(body) })

describe('行程上云范围（G5）', () => {
  it('plans / planIndex / endedAt 都能写进去并读回来', async () => {
    const token = await login()
    const plans = [plan('g5-p1', 'relaxed'), plan('g5-p2', 'balanced'), plan('g5-p3', 'packed')]
    const res = await put(token, 'g5-trip-full', {
      demand: DEMAND,
      plans,
      planIndex: 2,
      endedAt: '2026-11-10T08:00:00.000Z',
      savedAt: '2026-11-09T08:00:00.000Z'
    })
    expect(res.status).toBe(200)

    const list = await app.request(`/api/trips?clientId=${C1}`, { headers: auth(token) })
    const body = (await list.json()) as {
      items: { id: string; plans: Plan[]; planIndex: number; endedAt?: string }[]
    }
    const item = body.items.find((i) => i.id === 'g5-trip-full')
    expect(item?.plans.map((p) => p.id)).toEqual(['g5-p1', 'g5-p2', 'g5-p3'])
    expect(item?.planIndex).toBe(2)
    expect(item?.endedAt).toBe('2026-11-10T08:00:00.000Z')
  })

  it('planIndex 越界被钳到合法范围，不原样回给用户', async () => {
    const token = await login()
    await put(token, 'g5-trip-clamp', { demand: DEMAND, plans: [plan('g5-c1', 'relaxed')], planIndex: 99 })
    const list = await app.request(`/api/trips?clientId=${C1}`, { headers: auth(token) })
    const body = (await list.json()) as { items: { id: string; planIndex: number }[] }
    expect(body.items.find((i) => i.id === 'g5-trip-clamp')?.planIndex).toBe(0)
  })

  it('旧协议只给 plan 时也能存：读出来是只有一套的行程', async () => {
    const token = await login()
    const res = await put(token, 'g5-trip-legacy', { demand: DEMAND, plan: plan('g5-old', 'balanced') })
    expect(res.status).toBe(200)
    const list = await app.request(`/api/trips?clientId=${C1}`, { headers: auth(token) })
    const body = (await list.json()) as { items: { id: string; plans: Plan[]; planIndex: number }[] }
    const item = body.items.find((i) => i.id === 'g5-trip-legacy')
    expect(item?.plans.map((p) => p.id)).toEqual(['g5-old'])
    expect(item?.planIndex).toBe(0)
  })

  it('0015 之前的行（plans 为空）读出来用 plan 兜，不凭空消失', async () => {
    const token = await login()
    const userId = (await db.select({ id: users.id }).from(users).where(eq(users.phone, P1)).limit(1))[0]?.id
    // 直接造一行旧数据：绕过 PUT，模拟迁移之前写下的行程
    await db.insert(trips).values({
      id: 'g5-trip-oldrow',
      userId: userId ?? null,
      demand: DEMAND,
      plan: plan('g5-oldrow-plan', 'relaxed'),
      savedAt: new Date('2026-11-01T00:00:00.000Z')
    })
    const list = await app.request(`/api/trips?clientId=${C1}`, { headers: auth(token) })
    const body = (await list.json()) as { items: { id: string; plans: Plan[] }[] }
    expect(body.items.find((i) => i.id === 'g5-trip-oldrow')?.plans.map((p) => p.id)).toEqual(['g5-oldrow-plan'])
  })

  it('变更记录整份替换，不追加：第二次 PUT 后只剩第二次的那些', async () => {
    const token = await login()
    await put(token, 'g5-trip-vers', {
      demand: DEMAND,
      plans: [plan('g5-v1', 'relaxed')],
      versions: [{ at: '2026-11-01T00:00:00.000Z', note: '首次生成' }]
    })
    await put(token, 'g5-trip-vers', {
      demand: DEMAND,
      plans: [plan('g5-v1', 'relaxed')],
      versions: [
        { at: '2026-11-01T00:00:00.000Z', note: '首次生成' },
        { at: '2026-11-02T00:00:00.000Z', note: '第二天轻松点' }
      ]
    })
    const rows = await db.select().from(tripVersions).where(eq(tripVersions.tripId, 'g5-trip-vers'))
    expect(rows.map((r) => r.note)).toEqual(['首次生成', '第二天轻松点'])
  })

  it('note 为空的版本不写进去：界面上那就是一条空白行', async () => {
    const token = await login()
    await put(token, 'g5-trip-blank', {
      demand: DEMAND,
      plans: [plan('g5-b1', 'relaxed')],
      versions: [{ at: '2026-11-01T00:00:00.000Z', note: '' }]
    })
    const rows = await db.select().from(tripVersions).where(eq(tripVersions.tripId, 'g5-trip-blank'))
    expect(rows.length).toBe(0)
  })

  it('plans 与 plan 都没给 → 400，不写半条记录', async () => {
    const token = await login()
    const res = await put(token, 'g5-trip-empty', { demand: DEMAND })
    expect(res.status).toBe(400)
    const rows = await db.select().from(trips).where(eq(trips.id, 'g5-trip-empty'))
    expect(rows.length).toBe(0)
  })
})

describe('跨设备拉取列表（G5）', () => {
  it('回忆列表回本账号全部，且不含别人的', async () => {
    const token = await login()
    for (const tripId of ['g5-mem-a', 'g5-mem-b']) {
      const res = await app.request(`/api/memories/${tripId}`, {
        method: 'PUT',
        headers: auth(token),
        body: JSON.stringify({ payload: { tripId, overview: tripId, photos: [], places: {} } })
      })
      expect(res.status).toBe(200)
    }
    const list = await app.request('/api/memories', { headers: auth(token) })
    expect(list.status).toBe(200)
    const body = (await list.json()) as { items: { tripId: string }[] }
    expect(body.items.map((i) => i.tripId).sort()).toEqual(['g5-mem-a', 'g5-mem-b'])
  })

  it('回忆列表未登录 401：它是纯私人内容，没有匿名分支', async () => {
    expect((await app.request('/api/memories')).status).toBe(401)
  })

  it('草稿列表回 payload 与当前有效分享，撤回的不算', async () => {
    const token = await login()
    const draft = {
      id: 'g5-draft-a',
      tripId: 'g5-trip-a',
      title: 't',
      summary: '',
      photos: [],
      showCost: false,
      picked: {},
      sections: [],
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z'
    }
    const saved = await app.request('/api/guides/g5-draft-a', {
      method: 'PUT',
      headers: auth(token),
      body: JSON.stringify({ payload: draft, tripId: 'g5-trip-a' })
    })
    expect(saved.status).toBe(200)

    const before = (await (await app.request('/api/guides', { headers: auth(token) })).json()) as {
      items: { id: string; share: unknown }[]
    }
    expect(before.items.find((i) => i.id === 'g5-draft-a')?.share).toBeNull()

    await app.request('/api/guides/g5-draft-a/publish', { method: 'POST', headers: auth(token), body: '{}' })
    const after = (await (await app.request('/api/guides', { headers: auth(token) })).json()) as {
      items: { id: string; share: { token: string } | null }[]
    }
    expect(after.items.find((i) => i.id === 'g5-draft-a')?.share?.token).toBeTruthy()

    await app.request('/api/guides/g5-draft-a/unpublish', { method: 'POST', headers: auth(token), body: '{}' })
    const revoked = (await (await app.request('/api/guides', { headers: auth(token) })).json()) as {
      items: { id: string; share: unknown }[]
    }
    expect(revoked.items.find((i) => i.id === 'g5-draft-a')?.share).toBeNull()
  })

  it('草稿列表未登录 401', async () => {
    expect((await app.request('/api/guides')).status).toBe(401)
  })
})