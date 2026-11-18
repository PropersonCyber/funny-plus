import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, like } from 'drizzle-orm'

/**
 * 发布 / 撤回 / 公开访问的端到端语义。
 *
 * 连真库：这里要验证的核心是 SQL 条件（`revokedAt is null`、按 userId 过滤）
 * 与「公开面到底吐了哪些字段」，mock 掉数据库这两件事都验不了。
 */

const { app } = await import('../app.ts')
const { db, pool } = await import('../db/client.ts')
const { users, authSessions, smsCodes, guideDrafts, guideShares } = await import('../db/schema.ts')

const P1 = '13700000001'
const P2 = '13700000002'

const DRAFT_PAYLOAD = {
  id: 't-guide-share-1',
  tripId: 't-trip-share-1',
  title: '成都两日：我的走法',
  summary: '一天吃一天逛。',
  photos: [],
  showCost: false,
  picked: { p1: true, p2: false },
  sections: [
    {
      dayIndex: 1,
      items: [
        { planRef: 'p1', placeTitle: '人民公园', text: '喝茶晒太阳', visited: 'yes', photos: [] },
        { planRef: 'p2', placeTitle: '未勾选的地点', text: '不该出现在分享里', visited: 'no', photos: [] }
      ]
    }
  ],
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-02T00:00:00.000Z'
}

async function cleanup(): Promise<void> {
  await db.delete(smsCodes).where(like(smsCodes.phone, '137000000%'))
  for (const phone of [P1, P2]) {
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.phone, phone))
    for (const u of rows) {
      await db.delete(guideShares).where(eq(guideShares.userId, u.id))
      await db.delete(guideDrafts).where(eq(guideDrafts.userId, u.id))
      await db.delete(authSessions).where(eq(authSessions.userId, u.id))
      await db.delete(users).where(eq(users.id, u.id))
    }
  }
  await db.delete(guideShares).where(like(guideShares.draftId, 't-guide-share-%'))
  await db.delete(guideDrafts).where(like(guideDrafts.id, 't-guide-share-%'))
}

async function login(phone: string): Promise<{ token: string; userId: string }> {
  await app.request('/api/auth/sms-code', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone })
  })
  const res = await app.request('/api/auth/sms-verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone, code: '123456' })
  })
  const body = (await res.json()) as { token?: string; user?: { id: string } }
  return { token: String(body.token ?? ''), userId: String(body.user?.id ?? '') }
}

/** 用真实 PUT /api/guides/:id 落一份草稿，避免测试绕过写接口自己插行 */
async function seedDraft(token: string, id = DRAFT_PAYLOAD.id): Promise<void> {
  const res = await app.request(`/api/guides/${id}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ payload: { ...DRAFT_PAYLOAD, id }, tripId: DRAFT_PAYLOAD.tripId })
  })
  expect(res.status).toBe(200)
}

async function publish(token: string, id = DRAFT_PAYLOAD.id) {
  const res = await app.request(`/api/guides/${id}/publish`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ perPerson: 388 })
  })
  return { status: res.status, body: (await res.json()) as { token?: string; url?: string; code?: string } }
}

beforeEach(cleanup)
afterAll(async () => {
  await cleanup()
  await pool.end()
})

describe('发布', () => {
  it('未登录发布返回 401', async () => {
    const res = await app.request(`/api/guides/${DRAFT_PAYLOAD.id}/publish`, { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('发布别人的草稿返回 404，且不产生分享记录', async () => {
    const a = await login(P1)
    const b = await login(P2)
    await seedDraft(a.token)

    const res = await publish(b.token)
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('not_found')

    // 限定到本次草稿：全表 count 会被其它用例或库里残留数据干扰
    const rows = await db.select({ token: guideShares.token }).from(guideShares).where(eq(guideShares.draftId, DRAFT_PAYLOAD.id))
    expect(rows.length).toBe(0)
  })

  it('首次发布返回随机 token，且不含 draftId / tripId / userId 的任何片段', async () => {
    const a = await login(P1)
    await seedDraft(a.token)
    const res = await publish(a.token)

    expect(res.status).toBe(200)
    const token = String(res.body.token)
    expect(token.length).toBeGreaterThanOrEqual(16)
    expect(token).not.toContain(DRAFT_PAYLOAD.id)
    expect(token).not.toContain(DRAFT_PAYLOAD.tripId)
    expect(token).not.toContain(a.userId)
    expect(res.body.url).toContain(`/s/${token}`)
  })

  it('重复发布返回同一个 token，不产生第二条记录', async () => {
    const a = await login(P1)
    await seedDraft(a.token)
    const first = await publish(a.token)
    const second = await publish(a.token)

    expect(second.body.token).toBe(first.body.token)
    const rows = await db.select({ token: guideShares.token }).from(guideShares).where(eq(guideShares.draftId, DRAFT_PAYLOAD.id))
    expect(rows.length).toBe(1)
  })
})

describe('公开访问', () => {
  it('未登录可拿到快照，且响应不含 userId / 手机号 / tripId / draftId', async () => {
    const a = await login(P1)
    await seedDraft(a.token)
    const pub = await publish(a.token)

    const res = await app.request(`/api/share/${pub.body.token}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    const json = JSON.stringify(body)

    expect(body.valid).toBe(true)
    expect(json).not.toContain(a.userId)
    expect(json).not.toContain(P1)
    expect(json).not.toContain(DRAFT_PAYLOAD.tripId)
    expect(json).not.toContain(DRAFT_PAYLOAD.id)
    // 未勾选的条目不能出现在公开内容里
    expect(json).not.toContain('不该出现在分享里')
  })

  it('分享页外壳含 og:title 且标题来自该次发布', async () => {
    const a = await login(P1)
    await seedDraft(a.token)
    const pub = await publish(a.token)

    const res = await app.request(`/s/${pub.body.token}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const html = await res.text()
    expect(html).toContain('og:title')
    expect(html).toContain('og:type')
    expect(html).toContain('og:url')
    expect(html).toContain(DRAFT_PAYLOAD.title)
  })

  it('不存在的 token：接口 404，外壳 200 且不含正文', async () => {
    const apiRes = await app.request('/api/share/not-a-real-token')
    expect(apiRes.status).toBe(404)

    const shellRes = await app.request('/s/not-a-real-token')
    expect(shellRes.status).toBe(200)
    const html = await shellRes.text()
    expect(html).toContain('内容已不再公开')
    expect(html).not.toContain(DRAFT_PAYLOAD.title)
  })
})

describe('撤回', () => {
  it('撤回后接口 404、外壳 200 引导页且不含正文', async () => {
    const a = await login(P1)
    await seedDraft(a.token)
    const pub = await publish(a.token)

    const un = await app.request(`/api/guides/${DRAFT_PAYLOAD.id}/unpublish`, {
      method: 'POST',
      headers: { authorization: `Bearer ${a.token}` }
    })
    expect(un.status).toBe(200)
    expect(((await un.json()) as { revoked: boolean }).revoked).toBe(true)

    const apiRes = await app.request(`/api/share/${pub.body.token}`)
    expect(apiRes.status).toBe(404)

    const shellRes = await app.request(`/s/${pub.body.token}`)
    expect(shellRes.status).toBe(200)
    const html = await shellRes.text()
    expect(html).toContain('内容已不再公开')
    expect(html).not.toContain(DRAFT_PAYLOAD.title)
  })

  it('非作者撤回返回 404，且分享保持可访问', async () => {
    const a = await login(P1)
    const b = await login(P2)
    await seedDraft(a.token)
    const pub = await publish(a.token)

    const un = await app.request(`/api/guides/${DRAFT_PAYLOAD.id}/unpublish`, {
      method: 'POST',
      headers: { authorization: `Bearer ${b.token}` }
    })
    expect(un.status).toBe(404)

    const still = await app.request(`/api/share/${pub.body.token}`)
    expect(still.status).toBe(200)
  })

  it('撤回后再发布换新 token，旧 token 保持失效', async () => {
    const a = await login(P1)
    await seedDraft(a.token)
    const first = await publish(a.token)
    await app.request(`/api/guides/${DRAFT_PAYLOAD.id}/unpublish`, {
      method: 'POST',
      headers: { authorization: `Bearer ${a.token}` }
    })
    const second = await publish(a.token)

    expect(second.body.token).not.toBe(first.body.token)
    expect((await app.request(`/api/share/${first.body.token}`)).status).toBe(404)
    expect((await app.request(`/api/share/${second.body.token}`)).status).toBe(200)
  })

  it('没有有效分享时撤回幂等返回 revoked:false', async () => {
    const a = await login(P1)
    await seedDraft(a.token)
    const un = await app.request(`/api/guides/${DRAFT_PAYLOAD.id}/unpublish`, {
      method: 'POST',
      headers: { authorization: `Bearer ${a.token}` }
    })
    expect(un.status).toBe(200)
    expect(((await un.json()) as { revoked: boolean }).revoked).toBe(false)
  })
})

describe('快照语义', () => {
  it('发布后改草稿，已发布链接仍展示发布时的标题', async () => {
    const a = await login(P1)
    await seedDraft(a.token)
    const pub = await publish(a.token)

    // 直接走写接口改标题
    const put = await app.request(`/api/guides/${DRAFT_PAYLOAD.id}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${a.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        payload: { ...DRAFT_PAYLOAD, title: '改过的标题' },
        tripId: DRAFT_PAYLOAD.tripId
      })
    })
    expect(put.status).toBe(200)

    const res = await app.request(`/api/share/${pub.body.token}`)
    const body = (await res.json()) as { snapshot: { title: string } }
    expect(body.snapshot.title).toBe(DRAFT_PAYLOAD.title)
  })
})
