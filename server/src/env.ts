import { createHash } from 'node:crypto'

/**
 * 外部服务凭证统一在这里读，路由不直接摸 process.env：
 * 高德 key 要被逆地理 / 距离 / 静态图三处共用，散着读早晚会读到不一样的默认值。
 *
 * 关键是把「没配」和「配错」分开：没配由我们返回 503 并给 code，前端据此降级；
 * 配错是高德自己的错误码（10009 平台不匹配、10001 key 失效），不能混成一句「服务不可用」。
 */
const amapKey = (process.env.AMAP_KEY ?? '').trim()
const amapSecret = (process.env.AMAP_SECRET ?? '').trim()

export const amap = {
  /** 只存 Web 服务 key：JS API key 与它不通用，混用会报 10009 */
  key: amapKey,
  configured: () => amapKey.length > 0,
  /** 开了数字签名就必须每次带 sig，漏一次高德就拒（INVALID_USER_SCODE） */
  signed: () => amapSecret.length > 0
}

/**
 * 高德数字签名：参数名升序拼成 k=v&k=v，末尾接私钥，取 MD5 小写。
 * 统一走这一个函数——顺序错、漏参数都会被判 sig 不合法，让各路由自己拼必然有一处不一致。
 */
export function amapSign(params: Record<string, string>): string {
  const raw = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&')
  return createHash('md5').update(raw + amapSecret).digest('hex')
}

const wechatAppId = (process.env.WECHAT_APP_ID ?? '').trim()
const wechatSecret = (process.env.WECHAT_APP_SECRET ?? '').trim()

export const wechat = { appId: wechatAppId, secret: wechatSecret }
export const wechatConfigured = () => wechatAppId.length > 0 && wechatSecret.length > 0

/** 一键登录服务商未定（运营商直连 / 极光 / 阿里云号码认证），先用通用变量名占位，接哪家都填这一组 */
export const onetap = {
  provider: (process.env.ONETAP_PROVIDER ?? '').trim(),
  appKey: (process.env.ONETAP_APP_KEY ?? '').trim(),
  secret: (process.env.ONETAP_APP_SECRET ?? '').trim()
}
export const onetapConfigured = () =>
  onetap.provider.length > 0 && onetap.appKey.length > 0 && onetap.secret.length > 0
