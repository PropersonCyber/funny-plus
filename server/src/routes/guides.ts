import { Hono } from 'hono'
import { randomBytes } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { guideDrafts, guideShares } from '../db/schema.ts'
import { requireUser } from '../auth/middleware.ts'
import { stripLocalPhotos } from '../sync/photos.ts'
import { buildShareSnapshot } from '../sync/shareSnapshot.ts'
import { media } from '../env.ts'
import type { GuideDraft } from '@/types/index.ts'

/**
 * 攻略草稿的云端副本（F06）与发布（F08 后半）。与回忆同构，区别只有主键语义：
 * 回忆与行程一一对应（tripId 作主键），草稿与行程可以一对多（同一行程重新生成会换 id）。
 */
export const guideRoute = new Hono()

guideRoute.use('*', requireUser)

/** 分享链接的对外形态；配了 MEDIA_PUBLIC_BASE 才是绝对地址，原生端靠它 */
function shareUrl(token: string): string {
  return media.publicBase ? `${media.publicBase}/s/${token}` : `/s/${token}`
}

guideRoute.get('/:id', async (c) => {
  const actor = c.get('actor')
  if (!actor) return c.json({ error: '请先登录', code: 'unauthorized' }, 401)
  const [row] = await db
    .select()
    .from(guideDrafts)
    .where(and(eq(guideDrafts.id, c.req.param('id')), eq(guideDrafts.userId, actor.userId)))
    .limit(1)

  // 同时回传当前有效的分享，省掉前端「打开草稿后再查一次发布状态」的往返
  const active = row
    ? await db
        .select({ token: guideShares.token })
        .from(guideShares)
        .where(and(eq(guideShares.draftId, row.id), isNull(guideShares.revokedAt)))
        .limit(1)
    : []

  return c.json({
    item: row ? row.payload : null,
    share: active[0] ? { token: active[0].token, url: shareUrl(active[0].token) } : null
  })
})

guideRoute.put('/:id', async (c) => {
  const actor = c.get('actor')
  if (!actor) return c.json({ error: '请先登录', code: 'unauthorized' }, 401)
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => null)) as
    | { payload?: unknown; updatedAt?: string; tripId?: string }
    | null
  const payload = body?.payload
  if (!payload || typeof payload !== 'object') {
    return c.json({ error: '缺少 payload', code: 'bad_param' }, 400)
  }
  const tripId =
    typeof body?.tripId === 'string' && body.tripId
      ? body.tripId
      : typeof (payload as { tripId?: unknown }).tripId === 'string'
        ? ((payload as { tripId: string }).tripId as string)
        : ''
  if (!tripId) return c.json({ error: '缺少 tripId', code: 'bad_param' }, 400)

  const now = new Date()
  const [existing] = await db
    .select({ updatedAt: guideDrafts.updatedAt, userId: guideDrafts.userId })
    .from(guideDrafts)
    .where(eq(guideDrafts.id, id))
    .limit(1)

  if (existing) {
    if (existing.userId !== actor.userId) {
      return c.json({ error: '无权访问', code: 'unauthorized' }, 401)
    }
    const incoming = body?.updatedAt ? new Date(body.updatedAt) : null
    if (incoming && incoming.getTime() < existing.updatedAt.getTime()) {
      return c.json({ error: '这台设备的数据比云端旧，请刷新后再改', code: 'stale_write' }, 409)
    }
    const clean = stripLocalPhotos(payload)
    await db
      .update(guideDrafts)
      .set({ payload: clean as Record<string, unknown>, tripId, updatedAt: now })
      .where(eq(guideDrafts.id, id))
    return c.json({ item: clean })
  }

  const clean = stripLocalPhotos(payload)
  await db.insert(guideDrafts).values({
    id,
    userId: actor.userId,
    tripId,
    payload: clean as Record<string, unknown>,
    updatedAt: now
  })
  return c.json({ item: clean })
})

/**
 * 发布成分享链接（F08 后半）。
 *
 * 幂等：同一草稿已有未撤回的分享时原样返回，不新建。理由是「再点一次发布」在用户
 * 看来就是「拿到我的链接」，每次都换 token 会让上一次发出去的链接凭空失效。
 * 撤回后再发布则必须换新 token —— 旧链接已经发出去了，复用等于把撤回变成摆设。
 */
guideRoute.post('/:id/publish', async (c) => {
  const actor = c.get('actor')
  if (!actor) return c.json({ error: '请先登录', code: 'unauthorized' }, 401)

  const id = c.req.param('id')
  const [row] = await db
    .select()
    .from(guideDrafts)
    .where(and(eq(guideDrafts.id, id), eq(guideDrafts.userId, actor.userId)))
    .limit(1)
  // 别人的草稿一律 404 而不是 403：403 等于告诉对方「这个 id 确实存在」
  if (!row) return c.json({ error: '没有找到这份草稿', code: 'not_found' }, 404)

  const active = await db
    .select({ token: guideShares.token })
    .from(guideShares)
    .where(and(eq(guideShares.draftId, id), isNull(guideShares.revokedAt)))
    .limit(1)
  if (active[0]) return c.json({ token: active[0].token, url: shareUrl(active[0].token) })

  const body = (await c.req.json().catch(() => null)) as { perPerson?: unknown } | null
  const perPerson = typeof body?.perPerson === 'number' ? body.perPerson : undefined
  const snapshot = buildShareSnapshot(row.payload as unknown as GuideDraft, perPerson)

  const token = randomBytes(16).toString('base64url')
  await db.insert(guideShares).values({
    token,
    draftId: id,
    userId: actor.userId,
    snapshot: snapshot as unknown as Record<string, unknown>
  })
  return c.json({ token, url: shareUrl(token) })
})

/**
 * 撤回。
 *
 * 没有有效分享时返回 `revoked: false` 而不是报错：撤回本身是幂等的，
 * 用户连点两次或在两台设备上各点一次都不该看到红色报错。
 */
guideRoute.post('/:id/unpublish', async (c) => {
  const actor = c.get('actor')
  if (!actor) return c.json({ error: '请先登录', code: 'unauthorized' }, 401)

  const id = c.req.param('id')
  const [row] = await db
    .select({ id: guideDrafts.id })
    .from(guideDrafts)
    .where(and(eq(guideDrafts.id, id), eq(guideDrafts.userId, actor.userId)))
    .limit(1)
  if (!row) return c.json({ error: '没有找到这份草稿', code: 'not_found' }, 404)

  const active = await db
    .select({ token: guideShares.token })
    .from(guideShares)
    .where(and(eq(guideShares.draftId, id), isNull(guideShares.revokedAt)))
    .limit(1)
  if (!active[0]) return c.json({ ok: true, revoked: false })

  await db
    .update(guideShares)
    .set({ revokedAt: new Date() })
    .where(eq(guideShares.token, active[0].token))
  return c.json({ ok: true, revoked: true })
})
