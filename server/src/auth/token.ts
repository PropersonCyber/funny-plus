import { createHash, randomBytes } from 'node:crypto'

/**
 * 登录态 token 的签发、校验与滑动续期。
 *
 * 为什么是 opaque token 而不是 JWT：已选「每次校验就顺延过期时间」，JWT 的无状态优势
 * 在这个策略下不存在（照样要写库），而 opaque 换来了登出即时失效 —— JWT 做不到。
 *
 * 为什么只存哈希：库被读走时明文 token 等于把所有人的账号一起交出去。校验靠哈希比对，
 * 明文只在签发那一刻回给客户端，服务端不再持有。
 */

/** session 默认有效期：30 天。滑动续期会不断往后推，这个值只决定「多久不用就失效」 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * 续期节流窗口：5 分钟。
 *
 * 不节流等于每个请求一次 UPDATE，批量埋点上报会把 auth_sessions 打成热点行。
 * 代价是「最后一次使用」最多晚 5 分钟才被记下 —— 对本场景无影响。
 */
export const RENEW_THROTTLE_MS = 5 * 60 * 1000

export type SessionRow = {
  id: string
  userId: string
  tokenHash: string
  clientId: string | null
  expiresAt: Date
  lastSeenAt: Date
  revokedAt: Date | null
}

export type CheckResult =
  | { state: 'ok'; userId: string; renew: false }
  | { state: 'ok'; userId: string; renew: true; next: { expiresAt: Date; lastSeenAt: Date } }
  | { state: 'expired' }
  | { state: 'revoked' }

/** 32 字节随机数，base64url 后 43 字符；长度足够抗枚举 */
export function newToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export function newSession(args: {
  id: string
  userId: string
  raw: string
  clientId: string | null
  now: Date
}): { id: string; tokenHash: string; expiresAt: Date; lastSeenAt: Date } {
  return {
    id: args.id,
    tokenHash: hashToken(args.raw),
    expiresAt: new Date(args.now.getTime() + SESSION_TTL_MS),
    lastSeenAt: args.now
  }
}

/**
 * 判定顺序（不能换）：吊销 → 过期 → 续期。
 *
 * 先判吊销：一个已登出的 token 即便时间上也过期了，报 revoked 比 expired 更准确，
 * 也让「是不是我点了退出」在日志里说得清。
 */
export function checkSession(row: SessionRow, now: Date): CheckResult {
  if (row.revokedAt) return { state: 'revoked' }
  if (row.expiresAt.getTime() <= now.getTime()) return { state: 'expired' }

  const sinceSeen = now.getTime() - row.lastSeenAt.getTime()
  if (sinceSeen < RENEW_THROTTLE_MS) return { state: 'ok', userId: row.userId, renew: false }

  return {
    state: 'ok',
    userId: row.userId,
    renew: true,
    next: {
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      lastSeenAt: now
    }
  }
}

/** 从 Authorization 头取 token；只认 Bearer，其他方案一律当没有 */
export function bearerToken(header: string | undefined | null): string | null {
  if (!header) return null
  const m = /^Bearer\s+(.+)$/i.exec(header.trim())
  return m ? m[1].trim() : null
}
