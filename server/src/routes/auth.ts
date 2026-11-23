import { Hono } from 'hono'
import type { Context } from 'hono'
import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { authSessions, smsCodes, users } from '../db/schema.ts'
import { apple, appleConfigured, onetap, onetapConfigured, wechat, wechatConfigured } from '../env.ts'
import { claimAnonData } from '../auth/merge.ts'
import { requireUser } from '../auth/middleware.ts'
import {
  DEV_CODE,
  SMS_MAX_ATTEMPTS,
  SMS_RESEND_COOLDOWN_MS,
  SMS_TTL_MS,
  checkCode,
  hashCode,
  inCooldown,
  isDev,
  newCodeDigits,
  normalizePhone
} from '../auth/codes.ts'
import { newSession, newToken } from '../auth/token.ts'
import { smsReady, smsSender } from '../auth/sms.ts'
import { exchangeOnetapToken, exchangeWechatCode, verifyAppleToken } from '../auth/providers.ts'

/**
 * 账号与登录（F06）。
 *
 * 三通道口径（2026-11-17 定案）：短信验证码全端、微信 App、Apple iOS。本期只打通短信，
 * 微信 / Apple 仍走下面的 provider 占位契约（未配置一律 501，不返回假 token）。
 *
 * 两条不能破的口径：
 * 1. **不泄露账号存在性**：sms-code 对已注册与未注册手机号返回体完全一致；sms-verify
 *    失败一律 bad_code，不区分「号码没注册」。
 * 2. **匿名不降级**：登录失败不能把匿名可用的链路堵死，所有登录接口失败都只影响登录本身。
 */
type ProviderId = 'wechat' | 'onetap' | 'apple'

const PROVIDERS: { id: ProviderId; label: string; configured: () => boolean }[] = [
  { id: 'wechat', label: '微信登录', configured: wechatConfigured },
  {
    id: 'onetap',
    label: onetap.provider ? `${onetap.provider} 一键登录` : '手机号一键登录',
    configured: onetapConfigured
  },
  // Apple 立在这里是为了让 /status 如实下发「这条通道有没有配」：
  // 没配就不出现在客户端可选列表里，而不是让用户点了才收到 501
  { id: 'apple', label: '通过 Apple 登录', configured: appleConfigured }
]

export const authRoute = new Hono()

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function publicUser(u: { id: string; phone: string | null; createdAt: Date }) {
  return { id: u.id, phone: u.phone, createdAt: u.createdAt.toISOString() }
}

/** 通道就绪状态；前端据此决定登录入口显不显示，不报恒 null 的假登录态 */
authRoute.get('/status', (c) =>
  c.json({
    enabled: true,
    providers: PROVIDERS.map((p) => ({ id: p.id, label: p.label, configured: p.configured() })),
    /** 短信通道始终可用（dev 走固定码），所以身份口径不再是纯 device */
    identity: 'account',
    sms: { enabled: true, dev: isDev(), cooldownSeconds: Math.round(SMS_RESEND_COOLDOWN_MS / 1000) }
  })
)

/**
 * 请求验证码。
 *
 * 三个分支必须分开（这是本次补上的核心）：
 * - 配了短信服务商：真发。发送失败要说清是哪一步，且**不留下一个永远收不到的码**
 * - 没配 + 开发开关打开：不发送，固定码登录（dev 自测用）
 * - 没配 + 生产：明确回「短信服务未就绪」，不让用户对着一个收不到的码干等
 */
authRoute.post('/sms-code', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { phone?: string } | null
  const phone = typeof body?.phone === 'string' ? normalizePhone(body.phone) : null
  if (!phone) return c.json({ error: '手机号格式不对', code: 'bad_param' }, 400)

  // 通道没就绪且不在 dev：先拒，连码都不该生成 —— 生成一个发不出去的码只会误导用户
  if (!smsReady() && !isDev()) {
    return c.json({ error: '短信服务未就绪，暂时无法登录', code: 'sms_unavailable' }, 503)
  }

  const now = new Date()
  const [latest] = await db
    .select({ createdAt: smsCodes.createdAt })
    .from(smsCodes)
    .where(eq(smsCodes.phone, phone))
    .orderBy(desc(smsCodes.createdAt))
    .limit(1)
  if (latest && inCooldown(latest.createdAt, now)) {
    return c.json({ error: '验证码发得太频繁，稍后再试', code: 'too_frequent' }, 429)
  }

  const code = newCodeDigits()
  await db.insert(smsCodes).values({
    id: newId('sms'),
    phone,
    codeHash: hashCode(phone, code),
    expiresAt: new Date(now.getTime() + SMS_TTL_MS),
    createdAt: now
  })

  // 只有配了服务商才真发。发送失败把这条码作废：留着它等于占住 60 秒冷却，
  // 用户重试会被告知「太频繁」，而实际上一条短信都没收到
  if (smsReady()) {
    const sent = await smsSender.sendCode(phone, code)
    if (!sent.ok) {
      await db.delete(smsCodes).where(and(eq(smsCodes.phone, phone), eq(smsCodes.codeHash, hashCode(phone, code))))
      if (sent.reason === 'failed') {
        console.error('[auth] 短信发送失败', sent.detail)
        return c.json({ error: '短信发送失败，请稍后重试', code: 'sms_failed' }, 502)
      }
      return c.json({ error: '短信服务未就绪，暂时无法登录', code: 'sms_unavailable' }, 503)
    }
  }

  // 响应体对已注册 / 未注册手机号完全一致；dev 标记只放 header，不进 body
  if (isDev()) c.header('x-dev-code', '1')
  return c.json({ ok: true, cooldown: Math.round(SMS_RESEND_COOLDOWN_MS / 1000) })
})

/** 校验验证码并签发 token；首次登录自动建号，成功即静默并账 */
authRoute.post('/sms-verify', async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { phone?: string; code?: string; clientId?: string }
    | null
  const phone = typeof body?.phone === 'string' ? normalizePhone(body.phone) : null
  const code = typeof body?.code === 'string' ? body.code.trim() : ''
  const clientId = typeof body?.clientId === 'string' && body.clientId ? body.clientId : null
  if (!phone || !code) return c.json({ error: '手机号或验证码缺失', code: 'bad_param' }, 400)

  const now = new Date()
  const [row] = await db
    .select()
    .from(smsCodes)
    .where(and(eq(smsCodes.phone, phone), isNull(smsCodes.consumedAt), gt(smsCodes.expiresAt, now)))
    .orderBy(desc(smsCodes.createdAt))
    .limit(1)
  // 没有可用验证码与验证码错误对外必须同一句话，否则等于提供了账号枚举接口
  if (!row) return c.json({ error: '验证码不正确或已过期', code: 'bad_code' }, 401)

  const checked = checkCode(row, code, now, { dev: isDev() })
  if (checked.state !== 'ok') {
    await db
      .update(smsCodes)
      .set({ attempts: Math.min(row.attempts + 1, SMS_MAX_ATTEMPTS) })
      .where(eq(smsCodes.id, row.id))
    return c.json({ error: '验证码不正确或已过期', code: 'bad_code' }, 401)
  }

  await db.update(smsCodes).set({ consumedAt: now }).where(eq(smsCodes.id, row.id))

  await db.insert(users).values({ id: newId('u'), phone, createdAt: now, lastSeenAt: now }).onConflictDoNothing()
  const [user] = await db.select().from(users).where(eq(users.phone, phone)).limit(1)
  if (!user) return c.json({ error: '账号创建失败', code: 'server_error' }, 500)
  return issueSession(c, user, clientId, now)
})

/**
 * 签发 session + 并账。短信、微信、Apple 三条通道共用这一处。
 *
 * 抽出来的理由不是「少写几行」：三条通道各写一遍签发，早晚有一处忘了滑动续期
 * 或忘了并账 —— 而这两种差别只会在用户换设备时以「数据丢了」暴露出来，
 * 到那时候没人会想到是登录入口的差别造成的。
 */
async function issueSession(
  c: Context,
  user: { id: string; phone: string | null; createdAt: Date },
  clientId: string | null,
  now: Date
) {
  await db.update(users).set({ lastSeenAt: now }).where(eq(users.id, user.id))

  const raw = newToken()
  const session = newSession({ id: newId('s'), userId: user.id, raw, clientId, now })
  // id 只生成一次：newSession 算哈希与过期时间，插入用同一个 id，否则两处各生成一个对不上
  await db.insert(authSessions).values({
    id: session.id,
    userId: user.id,
    tokenHash: session.tokenHash,
    clientId,
    expiresAt: session.expiresAt,
    lastSeenAt: session.lastSeenAt,
    createdAt: now
  })

  // 静默并账：本机 clientId 名下尚无归属的数据认领给这个账号（幂等）
  const merged = await claimAnonData(user.id, clientId)

  return c.json({
    token: raw,
    expiresAt: session.expiresAt.toISOString(),
    user: publicUser(user),
    merged
  })
}

authRoute.get('/me', requireUser, async (c) => {
  const actor = c.get('actor')
  if (!actor) return c.json({ error: '请先登录', code: 'unauthorized' }, 401)
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId)).limit(1)
  if (!user) return c.json({ error: '账号不存在', code: 'unauthorized' }, 401)
  return c.json({ user: publicUser(user) })
})

/**
 * 登出：只作废这个 token，不删账号数据。
 * 上一版是空实现（占位期没有 session 可清），现在有 session 了就必须真的作废，
 * 否则「退出登录」只是个前端动作，token 还能用。
 */
authRoute.post('/logout', requireUser, async (c) => {
  const actor = c.get('actor')
  if (!actor) return c.json({ error: '请先登录', code: 'unauthorized' }, 401)
  await db.update(authSessions).set({ revokedAt: new Date() }).where(eq(authSessions.id, actor.sessionId))
  return c.json({ ok: true })
})

/**
 * 登录兑换：客户端拿到 provider 的一次性 code / token 后 POST 过来。
 *
 * 三条通道共用同一个出口（`finishLogin`），差别只在「怎么把凭证换成一个稳定的用户标识」：
 * - wechat → unionid
 * - apple  → sub
 * - onetap → 手机号（服务商未定，故仍不可用）
 *
 * 换到标识之后按标识找已有账号；找不到才建新号。找的是**同一个账号表里的唯一列**，
 * 所以「先用微信、后用短信登录同一手机号」会落到同一个人 —— 前提是短信登录时
 * 该手机号已绑定在同一行上（见 `linkPhoneIfEmpty`）。
 */
authRoute.post('/login', async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { provider?: ProviderId; code?: string; clientId?: string }
    | null
  const provider = PROVIDERS.find((p) => p.id === body?.provider)
  if (!provider) return c.json({ error: '不支持的登录方式', code: 'bad_provider' }, 400)
  if (!provider.configured()) {
    return c.json({ error: `${provider.label}未配置`, code: 'not_configured', provider: provider.id }, 501)
  }
  if (!body?.code) return c.json({ error: '缺少授权码', code: 'bad_param' }, 400)
  const clientId = typeof body.clientId === 'string' && body.clientId ? body.clientId : null

  if (provider.id === 'wechat') {
    const ex = await exchangeWechatCode(body.code)
    if (!ex.ok) {
      if (ex.reason === 'not_configured') {
        return c.json({ error: '微信登录未配置', code: 'not_configured', provider: provider.id }, 501)
      }
      // 兑换失败与网络失败要分开：一个是用户重试有用（code 过期），一个是我们这边的问题
      return c.json(
        { error: ex.reason === 'rejected' ? '微信授权已失效，请重新授权' : '微信服务暂时不可用', code: ex.reason, provider: provider.id },
        ex.reason === 'rejected' ? 401 : 502
      )
    }
    return finishLogin(c, { kind: 'wechat', unionid: ex.unionid }, clientId)
  }

  if (provider.id === 'apple') {
    const checked = await verifyAppleToken(body.code, apple.clientId)
    if (!checked.ok) {
      if (checked.reason === 'not_configured') {
        return c.json({ error: 'Apple 登录未配置', code: 'not_configured', provider: provider.id }, 501)
      }
      return c.json({ error: 'Apple 凭证无效', code: 'invalid_credential', provider: provider.id }, 401)
    }
    return finishLogin(c, { kind: 'apple', sub: checked.sub }, clientId)
  }

  // onetap：服务商未定，没有实现就明确说不支持，不返回假 token
  const one = await exchangeOnetapToken(body.code)
  if (!one.ok) {
    return c.json({ error: '一键登录服务商未接入', code: 'not_implemented', provider: provider.id }, 501)
  }
  return finishLogin(c, { kind: 'phone', phone: one.phone }, clientId)
})

/** 三种身份标识，任选其一 */
type Identity = { kind: 'wechat'; unionid: string } | { kind: 'apple'; sub: string } | { kind: 'phone'; phone: string }

/**
 * 按身份标识找号 / 建号，然后签发 session。
 *
 * 与短信登录共用同一段签发逻辑（`issueSession`），避免两条通道产出的 token
 * 在过期、归属、并账上有细微差别 —— 那种差别只会在换设备时以「数据丢了」的形式暴露。
 */
async function finishLogin(c: Context, identity: Identity, clientId: string | null) {
  const now = new Date()
  const column = identity.kind === 'wechat' ? users.wechatUnionid : identity.kind === 'apple' ? users.appleSub : users.phone
  const value = identity.kind === 'wechat' ? identity.unionid : identity.kind === 'apple' ? identity.sub : identity.phone

  let [user] = await db.select().from(users).where(eq(column, value)).limit(1)
  if (!user) {
    await db
      .insert(users)
      .values({
        id: newId('u'),
        phone: identity.kind === 'phone' ? identity.phone : null,
        wechatUnionid: identity.kind === 'wechat' ? identity.unionid : null,
        appleSub: identity.kind === 'apple' ? identity.sub : null,
        createdAt: now,
        lastSeenAt: now
      })
      .onConflictDoNothing()
    ;[user] = await db.select().from(users).where(eq(column, value)).limit(1)
  }
  if (!user) return c.json({ error: '账号创建失败', code: 'server_error' }, 500)
  return issueSession(c, user, clientId, now)
}


/** 微信 App 登录需要 AppID 才能拉起授权页；secret 绝不能下发 */
authRoute.get('/wechat-appid', (c) =>
  c.json({ appId: wechatConfigured() ? wechat.appId : '', code: wechatConfigured() ? 'ok' : 'not_configured' })
)

/** dev 固定码，供前端在非生产环境给出提示文案；生产环境恒返回空 */
/**
 * 开发用：把固定码回给前端，省得每台机器都要翻日志。
 * 开关关掉时必须 404 —— 返回空 code 等于告诉外面「这条路由存在但没开」，
 * 那就成了一个可探测的入口。
 */
authRoute.get('/dev-code', (c) => {
  if (!isDev()) return c.json({ error: '不存在', code: 'not_found' }, 404)
  return c.json({ code: DEV_CODE })
})
