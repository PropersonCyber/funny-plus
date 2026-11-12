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

/**
 * AI 通道走公司 ops-ai-gateway（OpenAI 兼容），不直连模型厂商。
 * key 只在服务端：一旦随包下发，任何人都能拿它烧额度，且模型侧无法区分是我们还是别人。
 *
 * 默认模型 deepseek-v4.1-flash 是按「中文口语对话 + tool calling + 流式」三项实测选定的，
 * 换模型前要重新验证这三项，尤其 tool calling —— 部分 flash 档模型只支持纯文本。
 */
const aiBaseUrl = (process.env.AI_BASE_URL ?? 'https://ops-ai-gateway.yc345.tv/v1').trim()
const aiKey = (process.env.AI_API_KEY ?? '').trim()
const aiModel = (process.env.AI_MODEL ?? 'deepseek-v4.1-flash').trim()

export const aiGateway = {
  baseUrl: aiBaseUrl,
  apiKey: aiKey,
  model: aiModel,
  configured: () => aiKey.length > 0
}
