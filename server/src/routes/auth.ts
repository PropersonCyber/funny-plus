import { Hono } from 'hono'
import { onetap, onetapConfigured, wechat, wechatConfigured } from '../env.ts'

/**
 * 登录通道占位层。
 *
 * 现在的身份仍然是设备级 clientId（`lynx/src/api.ts` 的 deviceId）：收藏 / 足迹 / 反馈
 * 都按它归类，行程还在本机。这里先把「provider 契约 + 回调入口」占住，等 AppID 到手接真流程，
 * 不动现有匿名链路——登录失败也必须能继续用完整功能，否则等于把匿名可用的口子堵死。
 *
 * 真接通时要补的三件事（别在占位阶段假装已经做了）：
 *   1. `users` + `auth_sessions` 两张表，以及把 collections/footprints/fact_feedbacks
 *      的 client_id 补上 user_id（登录后把本机 clientId 的数据并过去）
 *   2. 壳层回调：iOS `application:openURL:options:` / Android `onNewIntent` 拿到 code 后注入前端
 *   3. token 校验中间件；现在所有业务接口都没有鉴权，凭 clientId 就能读别人的收藏
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

/**
 * 前端启动时拉一次，据此决定登录入口显不显示。
 * 只报「通道是否就绪」，不报登录态——没有 session 表就没有可信的登录态，报一个恒 null 的 user 是自欺。
 */
authRoute.get('/status', (c) =>
  c.json({
    /** false 时前端应把登录入口藏起来，而不是点了再报错 */
    enabled: PROVIDERS.some((p) => p.configured()),
    providers: PROVIDERS.map((p) => ({ id: p.id, label: p.label, configured: p.configured() })),
    /** 当前身份口径。等登录接通后这里会变成 'account' 并附 userId */
    identity: 'device'
  })
)

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

/** 退出：占位阶段没有服务端 session 可清，前端删本地 token 即可 */
authRoute.post('/logout', (c) => c.json({ ok: true }))

/** 微信 App 登录需要 AppID 才能拉起授权页；secret 绝不能下发 */
authRoute.get('/wechat-appid', (c) =>
  c.json({ appId: wechatConfigured() ? wechat.appId : '', code: wechatConfigured() ? 'ok' : 'not_configured' })
)
