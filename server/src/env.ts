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
 * 短信服务商（F06 / N5）。目前只接阿里云短信。
 *
 * 「没配」与「配错」必须分开，沿用 amap 的口径：没配时发码接口返回明确错误码，
 * 前端据此提示「短信服务未就绪」；配错时把服务商原始错误码透出来（签名错、模板未审核、
 * 余额不足是完全不同的三件事，混成一句「发送失败」没法排查）。
 *
 * 只读这里，路由不直接摸 process.env —— 同一组凭证在发码与状态接口里都要用。
 */
const smsAccessKeyId = (process.env.SMS_ACCESS_KEY_ID ?? '').trim()
const smsAccessKeySecret = (process.env.SMS_ACCESS_KEY_SECRET ?? '').trim()
const smsSignName = (process.env.SMS_SIGN_NAME ?? '').trim()
const smsTemplateCode = (process.env.SMS_TEMPLATE_CODE ?? '').trim()
const smsRegionId = (process.env.SMS_REGION_ID ?? 'cn-hangzhou').trim()

export const sms = {
  accessKeyId: smsAccessKeyId,
  accessKeySecret: smsAccessKeySecret,
  signName: smsSignName,
  templateCode: smsTemplateCode,
  regionId: smsRegionId
}

/**
 * 四个凭证缺一不可：少了签名名或模板号，请求能发出去但会被服务商拒，
 * 那种「配了一半」比完全没配更难查，所以这里当作未配置处理。
 */
export const smsConfigured = () =>
  smsAccessKeyId.length > 0 &&
  smsAccessKeySecret.length > 0 &&
  smsSignName.length > 0 &&
  smsTemplateCode.length > 0

/**
 * Sign in with Apple（F06 / N5）。
 *
 * 只需要 clientId（= iOS bundle id）：我们做的是**本地验签**，用 Apple 公开的 JWKS
 * 校验客户端递上来的 identityToken，不请求 Apple 的 token 端点，所以不需要 teamId / keyId / 私钥。
 * 那三项是「服务端去换 token」才要的，本流程没有那一步。
 */
const appleClientId = (process.env.APPLE_CLIENT_ID ?? '').trim()
export const apple = { clientId: appleClientId }
export const appleConfigured = () => appleClientId.length > 0

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

/**
 * 照片存储（F08 后半）。
 *
 * 没配 `MEDIA_DIR` 就返回 503，而不是悄悄写进仓库目录：上传是唯一往磁盘写用户内容的地方，
 * 「写到哪儿」必须是显式配置项，否则 staging 与本地会用同一个目录互相污染。
 *
 * 上限默认 5MB，与前端 `photo.ts` 的 2MB 选择上限刻意不同：前端限的是「选图」，
 * 后端限的是「信任边界」。前端那道能被绕过，这道不能。
 */
const mediaDir = (process.env.MEDIA_DIR ?? '').trim()
const mediaMaxBytes = Number.parseInt((process.env.MEDIA_MAX_BYTES ?? '').trim(), 10)

type MediaConfig = {
  dir: string
  maxBytes: number
  /** 分享页与照片地址的外部前缀；未配为空串，前端拼相对路径 */
  publicBase: string
}

export const media: MediaConfig & { configured: () => boolean } = {
  dir: mediaDir,
  /** 单张上限；未配或配错时用 5MB */
  maxBytes: Number.isFinite(mediaMaxBytes) && mediaMaxBytes > 0 ? mediaMaxBytes : 5 * 1024 * 1024,
  // 读自身属性而不是闭包里的常量：测试会整体替换 media.dir 来验证「未配置」这条分支，
  // 闭包读常量的话那种替换是无效的，用例会静默走成「已配置」。
  configured() {
    return this.dir.length > 0
  },
  publicBase: (process.env.MEDIA_PUBLIC_BASE ?? '').trim()
}

/**
 * 分享页要用到的前端静态产物（F08 后半）。
 *
 * 为什么服务端要托管 web bundle：分享页给不装 App 的访客看，他们浏览器里没有壳层，
 * 只能由服务端把构建产物吐出去。`WEB_ASSET_DIR` 默认指向 lynx 的构建输出目录，
 * 部署时换成 CDN 或 nginx 的目录即可，不改代码。
 */
export const webAssets = {
  dir: (process.env.WEB_ASSET_DIR ?? '../lynx/dist').trim(),
  /** 分享页外壳里引资源的前缀，指向上面的目录 */
  base: (process.env.WEB_ASSET_BASE ?? '/web').trim()
}
