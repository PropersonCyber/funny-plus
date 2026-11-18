import { createHash, randomInt } from 'node:crypto'

/**
 * 短信验证码的生成、归一化与校验。
 *
 * 存哈希而不是明文：验证码只有 6 位，明文落库等于全表可直接登录。
 * 哈希时把手机号拌进去：否则同一个 6 位码在不同号码下哈希相同，撞库就能跨号复用。
 *
 * 两条独立的作废路径（用过一次 / 试错超限）都必须生效 —— 只做其中一条，要么留下
 * 「同一码可复用」，要么留下「可被暴力枚举」。
 */

/** 验证码有效期：5 分钟。够走完收到短信到输入的过程，又不给暴力枚举留充足窗口 */
export const SMS_TTL_MS = 5 * 60 * 1000

/** 重发冷却：60 秒。既是防骚扰，也是短信成本的主要闸门 */
export const SMS_RESEND_COOLDOWN_MS = 60 * 1000

/** 单个验证码允许的失败次数上限；到顶即作废，必须重新发码 */
export const SMS_MAX_ATTEMPTS = 5

/**
 * 开发用固定验证码。
 *
 * 为什么要有它：真实短信服务商还没接，没有它整条登录链路无法自测。
 *
 * 为什么是「显式开启」而不是「非 production 即开」：仓库里 NODE_ENV 没有任何一处设置，
 * 按代码默认值部署就会走进非生产分支——等于生产环境接受固定码。安全开关必须默认关、
 * 且只能靠一个明确的变量打开。
 */
export const DEV_CODE = '123456'

export type CodeRow = {
  phone: string
  codeHash: string
  attempts: number
  expiresAt: Date
  consumedAt: Date | null
}

export type CodeCheck =
  | { state: 'ok' }
  | { state: 'mismatch' }
  | { state: 'expired' }
  | { state: 'consumed' }
  | { state: 'too_many' }

/**
 * 开发码是否启用。只看一个显式变量，不看 NODE_ENV。
 *
 * 反过来做（非 production 即开）的风险是：仓库里没有任何地方设 NODE_ENV，
 * 部署方也不会主动设，于是「非生产」成了默认——固定码就默认在线上可用。
 * 开一个能看懂的开关，比依赖一个没人设的环境变量靠得住。
 */
export function isDev(flag: string | undefined = process.env.AUTH_DEV_CODE): boolean {
  return flag === '1'
}

/**
 * 归一化成 11 位国内号码。
 * 接受分隔符与 +86 前缀：用户从通讯录粘贴过来的号码常带这两种。
 */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '').replace(/^\+?86/, '')
  return /^1[3-9]\d{9}$/.test(digits) ? digits : null
}

export function newCodeDigits(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export function hashCode(phone: string, code: string): string {
  return createHash('sha256').update(`${phone}:${code}`).digest('hex')
}

/**
 * 判定顺序：已用 → 超限 → 过期 → 比对。
 *
 * 已用与超限排在过期前面：这两个是「这条码已经废了」，报它们比报「过期」更能说清原因，
 * 也不会让用户以为「等我快点输就好了」。
 */
export function checkCode(row: CodeRow, input: string, now: Date, opts: { dev: boolean }): CodeCheck {
  if (row.consumedAt) return { state: 'consumed' }
  if (row.attempts >= SMS_MAX_ATTEMPTS) return { state: 'too_many' }
  if (row.expiresAt.getTime() <= now.getTime()) return { state: 'expired' }
  if (opts.dev && input === DEV_CODE) return { state: 'ok' }
  return row.codeHash === hashCode(row.phone, input) ? { state: 'ok' } : { state: 'mismatch' }
}

export function inCooldown(lastSentAt: Date | null, now: Date): boolean {
  if (!lastSentAt) return false
  return now.getTime() - lastSentAt.getTime() < SMS_RESEND_COOLDOWN_MS
}
