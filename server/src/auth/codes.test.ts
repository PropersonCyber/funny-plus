import { describe, expect, it } from 'vitest'
import {
  DEV_CODE,
  SMS_MAX_ATTEMPTS,
  SMS_RESEND_COOLDOWN_MS,
  SMS_TTL_MS,
  checkCode,
  hashCode,
  inCooldown,
  newCodeDigits,
  normalizePhone,
  type CodeRow
} from './codes.ts'

const NOW = new Date('2026-11-17T10:00:00.000Z')

function row(over: Partial<CodeRow> = {}): CodeRow {
  return {
    phone: '13800138000',
    codeHash: hashCode('13800138000', '246810'),
    attempts: 0,
    expiresAt: new Date(NOW.getTime() + SMS_TTL_MS),
    consumedAt: null,
    ...over
  }
}

describe('手机号与验证码生成', () => {
  it('合法手机号归一化，非法的一律 null', () => {
    expect(normalizePhone('13800138000')).toBe('13800138000')
    expect(normalizePhone(' 138 0013 8000 ')).toBe('13800138000')
    expect(normalizePhone('+8613800138000')).toBe('13800138000')
    expect(normalizePhone('1380013800')).toBeNull()
    expect(normalizePhone('23800138000')).toBeNull()
    expect(normalizePhone('138001380001')).toBeNull()
    expect(normalizePhone('abcdefghijk')).toBeNull()
    expect(normalizePhone('')).toBeNull()
  })

  it('验证码是 6 位数字', () => {
    for (let i = 0; i < 20; i++) {
      expect(newCodeDigits()).toMatch(/^\d{6}$/)
    }
  })

  it('同一验证码在不同手机号下哈希不同 —— 不能靠撞库跨号复用', () => {
    expect(hashCode('13800138000', '123456')).not.toBe(hashCode('13900139000', '123456'))
    expect(hashCode('13800138000', '123456')).toBe(hashCode('13800138000', '123456'))
  })
})

describe('checkCode', () => {
  it('正确且在有效期内的验证码通过', () => {
    expect(checkCode(row(), '246810', NOW, { dev: false })).toEqual({ state: 'ok' })
  })

  it('错误验证码是 mismatch —— 对外一律 bad_code，不区分号码是否注册', () => {
    expect(checkCode(row(), '000000', NOW, { dev: false })).toEqual({ state: 'mismatch' })
  })

  it('过期验证码被拒', () => {
    expect(checkCode(row({ expiresAt: new Date(NOW.getTime() - 1) }), '246810', NOW, { dev: false })).toEqual({
      state: 'expired'
    })
  })

  it('已用过的验证码不能二次使用', () => {
    expect(checkCode(row({ consumedAt: new Date(NOW.getTime() - 1000) }), '246810', NOW, { dev: false })).toEqual({
      state: 'consumed'
    })
  })

  it('尝试次数达上限后作废，即使这次输对了也不放行', () => {
    const r = row({ attempts: SMS_MAX_ATTEMPTS })
    expect(checkCode(r, '246810', NOW, { dev: false })).toEqual({ state: 'too_many' })
  })

  it('非生产环境接受固定验证码，生产环境不接受', () => {
    expect(checkCode(row(), DEV_CODE, NOW, { dev: true })).toEqual({ state: 'ok' })
    expect(checkCode(row(), DEV_CODE, NOW, { dev: false })).toEqual({ state: 'mismatch' })
  })
})

describe('inCooldown', () => {
  it('冷却期内拒绝重发', () => {
    const lastSentAt = new Date(NOW.getTime() - SMS_RESEND_COOLDOWN_MS + 1000)
    expect(inCooldown(lastSentAt, NOW)).toBe(true)
  })

  it('超过冷却期允许重发，且首次发送（无记录）直接放行', () => {
    expect(inCooldown(new Date(NOW.getTime() - SMS_RESEND_COOLDOWN_MS - 1000), NOW)).toBe(false)
    expect(inCooldown(null, NOW)).toBe(false)
  })
})
