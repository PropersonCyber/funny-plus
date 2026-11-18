import { Hono } from 'hono'
import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { authSessions, smsCodes, users } from '../db/schema.ts'
import { onetap, onetapConfigured, wechat, wechatConfigured } from '../env.ts'
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
type ProviderId = 'wechat' | 'onetap'

const PROVIDERS: { id: ProviderId; label: string; configured: () => boolean }[] = [
  { id: 'wechat', label: '微信登录', configured: wechatConfigured },
  {
    id: 'onetap',
    label: onetap.provider ? `${onetap.provider} 一键登录` : '手机号一键登录',
    configured: onetapConfigured
  }
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
 * 真实短信服务商还没接：非生产环境不发送任何短信，验证码固定为 `DEV_CODE`，
 * 但接口契约、限流、落库全部照真实路径走，接服务商时只替换「发送」这一步。
 */
authRoute.post('/sms-code', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { phone?: string } | null
  const phone = typeof body?.phone === 'string' ? normalizePhone(body.phone) : null
  if (!phone) return c.json({ error: '手机号格式不对', code: 'bad_param' }, 400)

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
})

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
 * 登录兑换：壳层拿到 provider 的 code / 一键登录的 token 后 POST 过来。
 * 未配置直接 501 —— 501（未实现）和 500（服务炸了）必须分开，否则线上分不清是没接还是挂了。
 */
authRoute.post('/login', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { provider?: ProviderId; code?: string } | null
  const provider = PROVIDERS.find((p) => p.id === body?.provider)
  if (!provider) return c.json({ error: '不支持的登录方式', code: 'bad_provider' }, 400)
  if (!provider.configured()) {
    return c.json({ error: `${provider.label}未配置`, code: 'not_configured', provider: provider.id }, 501)
  }
  if (!body?.code) return c.json({ error: '缺少授权码', code: 'bad_param' }, 400)
  // AppID/AppSecret 都在但兑换流程还没写：明确 501，不返回假 token
  return c.json({ error: '登录兑换流程未实现', code: 'not_implemented', provider: provider.id }, 501)
})

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
