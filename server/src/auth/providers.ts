import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto'
import { wechat, wechatConfigured } from '../env.ts'

/**
 * 三方登录的凭证兑换（F06 / N5）。
 *
 * 这一层的存在意义只有一个：**把外部凭证换成我们可信的身份**，并且失败时说清是哪一步。
 * 上一版 `/api/auth/login` 恒返 501，等于三条通道都没接。
 *
 * 三条铁律：
 * 1. **绝不返回假身份**。任何一步拿不到 unionid / sub，就必须失败，不能拿 code 当 id。
 * 2. **凭证只走服务端**。AppSecret 永不下发；客户端只递交一次性 code。
 * 3. **兑换失败与未配置分开**。前者是服务商拒了（code 过期 / 已用过），后者是我们没配。
 */

export type ExchangeResult =
  | { ok: true; unionid: string; nickname?: string }
  | { ok: false; reason: 'not_configured' }
  | { ok: false; reason: 'rejected'; detail: string }
  | { ok: false; reason: 'upstream'; detail: string }

const WECHAT_TIMEOUT_MS = 8000

/**
 * 微信 App 登录：`code` → access_token → unionid。
 *
 * 必须走 `sns/oauth2/access_token` 而不是 `sns/userinfo`：前者一次就带回 unionid，
 * 后者只能拿到同应用内的 openid —— 同一用户在不同应用下 openid 不同，
 * 用 openid 当主键会让「同一人换渠道登录」永远合不上。
 */
export async function exchangeWechatCode(code: string): Promise<ExchangeResult> {
  if (!wechatConfigured()) return { ok: false, reason: 'not_configured' }
  const url =
    'https://api.weixin.qq.com/sns/oauth2/access_token' +
    `?appid=${encodeURIComponent(wechat.appId)}` +
    `&secret=${encodeURIComponent(wechat.secret)}` +
    `&code=${encodeURIComponent(code)}` +
    '&grant_type=authorization_code'

  type WechatBody = { unionid?: string; openid?: string; errcode?: number; errmsg?: string }
  let body: WechatBody | null = null
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(WECHAT_TIMEOUT_MS) })
    body = (await res.json().catch(() => null)) as WechatBody | null
  } catch (err) {
    return { ok: false, reason: 'upstream', detail: err instanceof Error ? err.message : '网络错误' }
  }

  // 微信用业务错误码表达失败（code 已用过、AppID 不匹配），HTTP 仍是 200
  if (!body || body.errcode) {
    return { ok: false, reason: 'rejected', detail: `${body?.errcode ?? 'invalid'}:${body?.errmsg ?? '无返回'}` }
  }
  // 有些老账号没有 unionid 绑定：这时只能拿 openid，而 openid 不可跨应用合并。
  // 与其悄悄用 openid 建号（同一人会在换渠道时分裂成两个账号），不如如实失败。
  if (!body.unionid) {
    return { ok: false, reason: 'rejected', detail: '该微信账号未绑定开放平台 unionid，无法跨渠道合并' }
  }
  return { ok: true, unionid: body.unionid }
}

/**
 * 一键登录（运营商 / 极光 / 阿里云号码认证）。
 *
 * 服务商未定，所以这里只定义**契约**，不虚构某家的实现：
 * 接哪家都由 `ONETAP_PROVIDER` 决定，服务端把 token 交给对应校验逻辑，换回手机号。
 * 现在没有任何一家的实现，因此恒返 not_configured —— 这与「写了假实现」有本质区别。
 */
export async function exchangeOnetapToken(_token: string): Promise<{ ok: true; phone: string } | { ok: false; reason: 'not_configured' }> {
  return { ok: false, reason: 'not_configured' }
}

/**
 * Sign in with Apple：identityToken 验签。
 *
 * Apple 的 identityToken 是 JWT，签名用 Apple 的公钥（从 JWKS 取）。
 * 校验**必须**覆盖：签名、`iss === https://appleid.apple.com`、`aud === 我们的 clientId`、
 * `exp` 未过期。漏掉 aud 校验是经典漏洞 —— 别人拿另一个 App 签出的 token 也能登进来。
 *
 * 这里只做本地验签（不请求 Apple 的 token 端点），因为客户端递交的是已签发的 identityToken。
 * JWKS 缓存 1 小时：Apple 的公钥轮换很慢，每次登录都拉一遍既慢又浪费。
 */
const APPLE_ISS = 'https://appleid.apple.com'
const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys'
const JWKS_TTL_MS = 60 * 60 * 1000

type Jwk = { kid: string; n: string; e: string; kty: string; alg?: string }
let jwksCache: { keys: Jwk[]; at: number } | null = null

async function appleKeys(): Promise<Jwk[]> {
  if (jwksCache && Date.now() - jwksCache.at < JWKS_TTL_MS) return jwksCache.keys
  const res = await fetch(APPLE_JWKS_URL, { signal: AbortSignal.timeout(8000) })
  const body = (await res.json()) as { keys?: Jwk[] }
  const keys = (body.keys ?? []).filter((k) => k.kty === 'RSA')
  jwksCache = { keys, at: Date.now() }
  return keys
}

const b64url = (s: string): Buffer => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')

type ApplePayload = { sub?: string; iss?: string; aud?: string; exp?: number; email?: string }

export type AppleResult =
  | { ok: true; sub: string; email?: string }
  | { ok: false; reason: 'not_configured' }
  | { ok: false; reason: 'invalid'; detail: string }

/**
 * 校验 Apple identityToken。
 *
 * `clientId` 是 iOS App 的 bundle id（如 `com.maka.funnyplus`），必须与 aud 对得上。
 * 不配它就是「没有 Apple 通道」—— 与微信/一键登录同一口径。
 */
export async function verifyAppleToken(identityToken: string, clientId: string): Promise<AppleResult> {
  if (!clientId.trim()) return { ok: false, reason: 'not_configured' }
  const parts = identityToken.split('.')
  if (parts.length !== 3) return { ok: false, reason: 'invalid', detail: 'token 不是 JWT' }

  let header: { kid?: string; alg?: string }
  let payload: ApplePayload
  try {
    header = JSON.parse(b64url(parts[0]).toString('utf8'))
    payload = JSON.parse(b64url(parts[1]).toString('utf8'))
  } catch {
    return { ok: false, reason: 'invalid', detail: 'token 解析失败' }
  }
  // 只接受 RS256：算法可被 header 指定时，必须白名单校验，否则 "alg":"none" 就能绕过签名
  if (header.alg !== 'RS256') return { ok: false, reason: 'invalid', detail: `不支持的签名算法 ${header.alg ?? '空'}` }

  const keys = await appleKeys().catch(() => [] as Jwk[])
  const jwk = keys.find((k) => k.kid === header.kid)
  if (!jwk) return { ok: false, reason: 'invalid', detail: '找不到对应的 Apple 公钥' }

  let valid = false
  try {
    const key = createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' })
    valid = cryptoVerify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, b64url(parts[2]))
  } catch {
    return { ok: false, reason: 'invalid', detail: '签名校验异常' }
  }
  if (!valid) return { ok: false, reason: 'invalid', detail: '签名不匹配' }

  if (payload.iss !== APPLE_ISS) return { ok: false, reason: 'invalid', detail: 'issuer 不是 Apple' }
  // 这一条不能省：不校验 aud，别的 App 签出的 token 也能登进我们的账号
  if (payload.aud !== clientId) return { ok: false, reason: 'invalid', detail: 'aud 与本应用不匹配' }
  if (!payload.exp || payload.exp * 1000 < Date.now()) return { ok: false, reason: 'invalid', detail: 'token 已过期' }
  if (!payload.sub) return { ok: false, reason: 'invalid', detail: 'token 里没有 sub' }

  return { ok: true, sub: payload.sub, email: payload.email }
}

/** 稳定但不可逆的短标识，仅用于日志排查，不参与身份判定 */
export const fingerprint = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 12)
