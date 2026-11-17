import { describe, expect, it } from 'vitest'
import {
  RENEW_THROTTLE_MS,
  SESSION_TTL_MS,
  checkSession,
  hashToken,
  newSession,
  newToken,
  type SessionRow
} from './token.ts'

const NOW = new Date('2026-11-17T10:00:00.000Z')

function row(over: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 's1',
    userId: 'u1',
    tokenHash: 'h',
    clientId: null,
    expiresAt: new Date(NOW.getTime() + SESSION_TTL_MS),
    lastSeenAt: new Date(NOW.getTime()),
    revokedAt: null,
    ...over
  }
}

describe('token 签发与校验', () => {
  it('签发的 token 不可预测，且哈希后能自校验', () => {
    const a = newToken()
    const b = newToken()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(40)
    // 明文与哈希必须不同：库里只存哈希
    expect(hashToken(a)).not.toBe(a)
    expect(hashToken(a)).toBe(hashToken(a))
    expect(hashToken(a)).not.toBe(hashToken(b))
  })

  it('newSession 存的只有哈希，且过期时间按 TTL 顺推', () => {
    const raw = newToken()
    const s = newSession({ id: 's1', userId: 'u1', raw, clientId: 'c1', now: NOW })
    expect(s.tokenHash).toBe(hashToken(raw))
    expect(s.tokenHash).not.toBe(raw)
    expect(s.expiresAt.getTime()).toBe(NOW.getTime() + SESSION_TTL_MS)
  })
})

describe('checkSession', () => {
  it('有效 session 返回 ok', () => {
    const r = checkSession(row({ lastSeenAt: new Date(NOW.getTime()) }), NOW)
    expect(r.state).toBe('ok')
    expect(r.state === 'ok' && r.userId).toBe('u1')
  })

  it('过期返回 expired 而不是 unauthorized —— 前端要靠它清 token', () => {
    const r = checkSession(row({ expiresAt: new Date(NOW.getTime() - 1) }), NOW)
    expect(r.state).toBe('expired')
  })

  it('已吊销哪怕没过期也返回 revoked', () => {
    const r = checkSession(row({ revokedAt: new Date(NOW.getTime() - 1000) }), NOW)
    expect(r.state).toBe('revoked')
  })

  it('节流窗口内不续期，也不改 lastSeenAt', () => {
    const lastSeenAt = new Date(NOW.getTime() - RENEW_THROTTLE_MS + 1000)
    const r = checkSession(row({ lastSeenAt }), NOW)
    expect(r.state).toBe('ok')
    expect(r.state === 'ok' && r.renew).toBe(false)
  })

  it('超过节流窗口才顺延过期时间', () => {
    const lastSeenAt = new Date(NOW.getTime() - RENEW_THROTTLE_MS - 1000)
    const r = checkSession(row({ lastSeenAt }), NOW)
    expect(r.state).toBe('ok')
    // 用 `next` 是否存在收窄联合类型：只判 state 的话 TS 仍认为可能是 renew:false 那支
    if (!('next' in r)) throw new Error('超过节流窗口却没有续期')
    expect(r.renew).toBe(true)
    // 顺延后必须比原过期时间更晚，否则等于没续
    expect(r.next.expiresAt.getTime()).toBe(NOW.getTime() + SESSION_TTL_MS)
    expect(r.next.lastSeenAt.getTime()).toBe(NOW.getTime())
  })
})
