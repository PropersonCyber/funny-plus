import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createSign, generateKeyPairSync } from 'node:crypto'

/**
 * 三方登录的身份合并（F06 / N5）。
 *
 * 连真库：核心要验的是「同一人换渠道登录会不会分裂成两个账号」，
 * 而这完全取决于 users 表上的唯一列与查找顺序，mock 掉数据库就什么都没验。
 *
 * 这一组里最糟的失败不是报错，而是**静默建了第二个账号**：
 * 用户先用微信登录、再用同一手机号收到短信登录，行程就分裂在两处，
 * 而两条路径各自都返回 200，谁都不会发现。
 */

const { app } = await import('../app.ts')
const { db, pool } = await import('../db/client.ts')
const { users, authSessions, smsCodes } = await import('../db/schema.ts')
const { verifyAppleToken } = await import('../auth/providers.ts')

const PHONE = '13700000101'
const UNIONID = 'union-test-account-a'

async function cleanup(): Promise<void> {
  await db.delete(smsCodes).where(eq(smsCodes.phone, PHONE))
  for (const [col, val] of [
    [users.phone, PHONE],
    [users.wechatUnionid, UNIONID]
  ] as const) {
    const rows = await db.select({ id: users.id }).from(users).where(eq(col, val))
    for (const u of rows) {
      await db.delete(authSessions).where(eq(authSessions.userId, u.id))
      await db.delete(users).where(eq(users.id, u.id))
    }
  }
}

/** 用真实接口登录一次（dev 固定码），返回 token 与 userId */
async function loginByPhone(): Promise<{ token: string; userId: string }> {
  await app.request('/api/auth/sms-code', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: PHONE })
  })
  const res = await app.request('/api/auth/sms-verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: PHONE, code: '123456' })
  })
  const body = (await res.json()) as { token?: string; user?: { id: string } }
  return { token: String(body.token ?? ''), userId: String(body.user?.id ?? '') }
}

beforeEach(cleanup)
afterAll(async () => {
  await cleanup()
  await pool.end()
})

describe('短信登录与身份绑定', () => {
  it('首次登录建号，再次登录落到同一个账号', async () => {
    const first = await loginByPhone()
    // 清掉发码冷却：这里验的是账号身份，不是限流（限流另有用例）
    await db.delete(smsCodes).where(eq(smsCodes.phone, PHONE))
    const second = await loginByPhone()
    expect(first.userId).toBeTruthy()
    expect(second.userId).toBe(first.userId)
  })

  it('两条通道各自签发的 token 都是有效 session', async () => {
    const { token } = await loginByPhone()
    const me = await app.request('/api/auth/me', { headers: { authorization: `Bearer ${token}` } })
    expect(me.status).toBe(200)
  })
})

describe('未配置的三方通道明确拒绝，不返回假 token', () => {
  it('微信未配置时回 501 not_configured', async () => {
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'wechat', code: 'whatever' })
    })
    // 环境里没有 WECHAT_APP_ID，所以这条通道应当是「没配」
    expect(res.status).toBe(501)
    expect(((await res.json()) as { code?: string }).code).toBe('not_configured')
  })

  it('Apple 未配置时同样 501，而不是拿 code 当身份', async () => {
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'apple', code: 'fake.jwt.token' })
    })
    expect(res.status).toBe(501)
    expect(((await res.json()) as { code?: string }).code).toBe('not_configured')
  })

  it('不支持的 provider 回 400，不会静默当成功', async () => {
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'weibo', code: 'x' })
    })
    expect(res.status).toBe(400)
  })
})

describe('/status 如实下发通道就绪状态', () => {
  it('没配的通道 configured=false，客户端据此不显示按钮', async () => {
    const res = await app.request('/api/auth/status')
    const body = (await res.json()) as { providers?: { id: string; configured: boolean }[] }
    const ids = (body.providers ?? []).map((p) => p.id)
    // Apple 必须出现在列表里（哪怕是未配置），否则客户端永远不知道这条通道存在
    expect(ids).toContain('apple')
    expect(ids).toContain('wechat')
    expect((body.providers ?? []).every((p) => p.configured === false)).toBe(true)
  })
})

describe('Apple identityToken 验签', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  // publicKey 已经是 KeyObject，直接 export 成 JWK；再造一层 createPublicKey 会报「期望私钥」
  const jwk = publicKey.export({ format: 'jwk' }) as { n: string; e: string }
  const CLIENT = 'com.maka.funnyplus.test'

  /** 造一个 Apple 形状的 JWT；payload 可覆盖，用来验每一种拒绝分支 */
  function makeToken(payload: Record<string, unknown>, kid = 'test-kid'): string {
    const enc = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url')
    const head = enc({ alg: 'RS256', kid })
    const body = enc({ iss: 'https://appleid.apple.com', aud: CLIENT, exp: Math.floor(Date.now() / 1000) + 600, sub: 'apple-sub-1', ...payload })
    const signer = createSign('RSA-SHA256')
    signer.update(`${head}.${body}`)
    return `${head}.${body}.${signer.sign(privateKey).toString('base64url')}`
  }

  beforeEach(() => {
    // 把 Apple 的 JWKS 换成本地生成的这对密钥：验签逻辑照跑，但不打外网
    ;(globalThis as { fetch?: unknown }).fetch = async () =>
      new Response(JSON.stringify({ keys: [{ kid: 'test-kid', kty: 'RSA', alg: 'RS256', n: jwk.n, e: jwk.e }] }), {
        headers: { 'content-type': 'application/json' }
      })
  })

  it('签名、iss、aud、exp 全对时通过', async () => {
    const r = await verifyAppleToken(makeToken({}), CLIENT)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sub).toBe('apple-sub-1')
  })

  it('aud 不是本应用时拒绝 —— 否则别的 App 签出的 token 也能登进来', async () => {
    const r = await verifyAppleToken(makeToken({ aud: 'com.someone.else' }), CLIENT)
    expect(r.ok).toBe(false)
    if (!r.ok && r.reason === 'invalid') expect(r.detail).toContain('aud')
  })

  it('过期 token 拒绝', async () => {
    const r = await verifyAppleToken(makeToken({ exp: Math.floor(Date.now() / 1000) - 10 }), CLIENT)
    expect(r.ok).toBe(false)
    if (!r.ok && r.reason === 'invalid') expect(r.detail).toContain('过期')
  })

  it('issuer 不对时拒绝', async () => {
    const r = await verifyAppleToken(makeToken({ iss: 'https://evil.example' }), CLIENT)
    expect(r.ok).toBe(false)
    if (!r.ok && r.reason === 'invalid') expect(r.detail).toContain('issuer')
  })

  it('alg 被改成 none 时拒绝 —— 算法白名单不能省', async () => {
    const enc = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url')
    const head = enc({ alg: 'none', kid: 'test-kid' })
    const body = enc({ iss: 'https://appleid.apple.com', aud: CLIENT, exp: Math.floor(Date.now() / 1000) + 600, sub: 'x' })
    const r = await verifyAppleToken(`${head}.${body}.`, CLIENT)
    expect(r.ok).toBe(false)
    if (!r.ok && r.reason === 'invalid') expect(r.detail).toContain('算法')
  })

  it('签名被篡改时拒绝', async () => {
    const good = makeToken({})
    const parts = good.split('.')
    const r = await verifyAppleToken(`${parts[0]}.${parts[1]}.AAAA${parts[2].slice(4)}`, CLIENT)
    expect(r.ok).toBe(false)
  })

  it('没配 clientId 时按未配置处理，而不是放行', async () => {
    const r = await verifyAppleToken(makeToken({}), '')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('not_configured')
  })
})
