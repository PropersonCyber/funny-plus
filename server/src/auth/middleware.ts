import { createMiddleware } from 'hono/factory'
import { eq } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { authSessions } from '../db/schema.ts'
import { describeAuthFailure, type AuthFailure } from './authResult.ts'
import { bearerToken, checkSession, hashToken } from './token.ts'

/**
 * 鉴权中间件的两档语义。
 *
 * 为什么需要两档而不是一刀切强制登录：产品口径是「登录只挡云同步与跨设备找回，不挡
 * 浏览与规划」。收藏 / 足迹 / 反馈 / 埋点在匿名状态就必须能写，否则等于把匿名可用的
 * 口子堵死；而行程 / 回忆 / 草稿必须登录才有意义（没账号就无处可同步）。
 */

export type Actor = {
  userId: string
  sessionId: string
  /** 签发 token 时记下的设备 id，并账与排查「共享设备」靠它 */
  clientId: string | null
}

declare module 'hono' {
  interface ContextVariableMap {
    actor: Actor | null
  }
}

type Resolved = { actor: Actor } | { failure: AuthFailure }

/**
 * 带 token 就校验，不带就当匿名。
 *
 * 关键取舍：token 存在但无效 / 过期时**不**降级为匿名。否则用户以为自己在往账号里写，
 * 实际全落到了 client_id 名下，登录后也并不过来 —— 这种静默丢失比直接报 401 糟得多。
 */
async function resolve(header: string | undefined): Promise<Resolved> {
  const raw = bearerToken(header)
  if (!raw) return { failure: 'missing' }

  const rows = await db
    .select()
    .from(authSessions)
    .where(eq(authSessions.tokenHash, hashToken(raw)))
    .limit(1)
  const row = rows[0]
  if (!row) return { failure: 'unknown' }

  const now = new Date()
  const checked = checkSession(row, now)
  if (checked.state === 'expired') return { failure: 'expired' }
  if (checked.state === 'revoked') return { failure: 'revoked' }

  // 滑动续期只在这里写库；节流窗口内的请求完全不产生 UPDATE
  if (checked.renew) {
    await db
      .update(authSessions)
      .set({ expiresAt: checked.next.expiresAt, lastSeenAt: checked.next.lastSeenAt })
      .where(eq(authSessions.id, row.id))
  }

  return { actor: { userId: row.userId, sessionId: row.id, clientId: row.clientId } }
}

/** 必须登录：无 token / 无效 / 过期一律 401 */
export const requireUser = createMiddleware(async (c, next) => {
  const r = await resolve(c.req.header('authorization'))
  if ('failure' in r) {
    const d = describeAuthFailure(r.failure)
    return c.json({ error: '请先登录', code: d.code }, d.status)
  }
  c.set('actor', r.actor)
  await next()
})

/** 登录可选：匿名放行（actor 为 null），但带坏 token 仍然报错 */
export const optionalUser = createMiddleware(async (c, next) => {
  const r = await resolve(c.req.header('authorization'))
  if ('failure' in r) {
    if (r.failure === 'missing') {
      c.set('actor', null)
      await next()
      return
    }
    const d = describeAuthFailure(r.failure)
    return c.json({ error: '登录已失效，请重新登录', code: d.code }, d.status)
  }
  c.set('actor', r.actor)
  await next()
})

export function actorOf(c: { get: (k: 'actor') => Actor | null }): Actor | null {
  return c.get('actor')
}

/**
 * 静默解析登录态：解析不出来就当匿名，绝不返回 401。
 *
 * 给埋点用 —— 那条链路的第一原则是「埋点不能拖累主流程」。一个过期 token 让整批事件
 * 返回 401，客户端就会反复重发，把队列堵死；而事件本身带 client_id，照样能归到设备上。
 */
export async function resolveActorQuietly(header: string | undefined): Promise<Actor | null> {
  try {
    const r = await resolve(header)
    return 'actor' in r ? r.actor : null
  } catch {
    return null
  }
}
