import { createHmac } from 'node:crypto'
import { sms, smsConfigured } from '../env.ts'

/**
 * 短信发送（F06 / N5 的第一通道）。
 *
 * 上一版只落库、不发送：验证码在库里生成好了，用户手机里却一条短信都没有。
 * 开发时靠 `AUTH_DEV_CODE=1` 用固定码绕过，看起来「登录是通的」，
 * 实际这条通道从来没把码送到过任何人手上。
 *
 * 这一层只做一件事：把码发出去。发送成功与否必须**如实返回**，
 * 绝不能吞掉失败让调用方以为发出去了 —— 那等于让用户对着一个永远收不到的码干等。
 *
 * 服务商按「适配器」组织：目前只接了阿里云短信（`dysmsapi`），
 * 接别家只需实现同一个 `SmsSender` 形状，上层不用动。
 */

export type SendResult =
  | { ok: true }
  /** 没有配置服务商：调用方据此决定是走 dev 固定码，还是明确告诉用户「发不了」 */
  | { ok: false; reason: 'not_configured' }
  | { ok: false; reason: 'failed'; detail: string }

export interface SmsSender {
  /** 发一条验证码短信 */
  sendCode(phone: string, code: string): Promise<SendResult>
}

/**
 * 阿里云短信（dysmsapi 2017-05-25）。
 *
 * 为什么手写签名而不引 SDK：只需要一个 SendSms 调用，引一个几十 MB 的 SDK
 * 换一个 HMAC 签名不划算，而且它的默认重试会在这里放大短信成本。
 *
 * 签名规则（阿里云 RPC 风格 V1）：
 *   1. 参数按 key 升序拼成 `k=percentEncode(v)`，用 `&` 连接
 *   2. `StringToSign = "GET&%2F&" + percentEncode(canonicalized)`
 *   3. `Signature = Base64(HMAC-SHA1(StringToSign, secret + "&"))`
 */
const PERCENT = (s: string): string =>
  encodeURIComponent(s)
    .replace(/\+/g, '%20')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~')

function aliyunSignature(params: Record<string, string>, secret: string): string {
  const canonical = Object.keys(params)
    .sort()
    .map((k) => `${PERCENT(k)}=${PERCENT(params[k])}`)
    .join('&')
  const stringToSign = `GET&%2F&${PERCENT(canonical)}`
  // 阿里云的 key 后缀必须带一个 &，漏了签名恒错（SignatureDoesNotMatch）
  return createHmac('sha1', `${secret}&`).update(stringToSign).digest('base64')
}

/** 阿里云上模板变量名的默认值；不同模板可能不一样，用 env 可覆盖 */
const TEMPLATE_PARAM_KEY = 'code'

class AliyunSender implements SmsSender {
  async sendCode(phone: string, code: string): Promise<SendResult> {
    const params: Record<string, string> = {
      AccessKeyId: sms.accessKeyId,
      Action: 'SendSms',
      Format: 'JSON',
      PhoneNumbers: phone,
      RegionId: sms.regionId,
      SignName: sms.signName,
      SignatureMethod: 'HMAC-SHA1',
      SignatureNonce: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      SignatureVersion: '1.0',
      TemplateCode: sms.templateCode,
      // 模板变量：{"code":"123456"}。变量名与模板里写的必须一致，否则服务商报参数缺失
      TemplateParam: JSON.stringify({ [TEMPLATE_PARAM_KEY]: code }),
      Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      Version: '2017-05-25'
    }
    params.Signature = aliyunSignature(params, sms.accessKeySecret)

    const url = `https://dysmsapi.aliyuncs.com/?${new URLSearchParams(params).toString()}`
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
      const body = (await res.json().catch(() => null)) as { Code?: string; Message?: string } | null
      // 阿里云用 HTTP 200 + Code 表达失败，只看 status 会把失败当成成功
      if (body?.Code === 'OK') return { ok: true }
      return { ok: false, reason: 'failed', detail: `${body?.Code ?? res.status} ${body?.Message ?? '未知错误'}`.trim() }
    } catch (err) {
      return { ok: false, reason: 'failed', detail: err instanceof Error ? err.message : '网络错误' }
    }
  }
}

/**
 * 未配置任何服务商时的发送器。
 *
 * 它**不发短信**，也不假装成功。调用方拿到 `not_configured` 后要自己决定：
 * 开发环境（`AUTH_DEV_CODE=1`）走固定码，生产环境则明确告诉用户「短信服务未就绪」。
 * 这是本项目「没配和配错要分开」口径的延续（见 env.ts 的注释）。
 */
class UnconfiguredSender implements SmsSender {
  async sendCode(): Promise<SendResult> {
    return { ok: false, reason: 'not_configured' }
  }
}

export const smsSender: SmsSender = (() => {
  if (!smsConfigured()) return new UnconfiguredSender()
  return new AliyunSender()
})()

/** 给 /status 与健康检查用：当前有没有真的能发出短信的通道 */
export const smsReady = (): boolean => smsConfigured()
