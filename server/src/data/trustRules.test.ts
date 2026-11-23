import { describe, expect, it } from 'vitest'

/**
 * 可信度降档规则（C1 / C3）。
 *
 * 这里全是「不该降」的反向用例：把官方核验的条目降错档，界面不会报错，
 * 只是从此这条信息说的话不再可信 —— 而这种损失没法靠测试以外的手段发现。
 */
import {
  DEMOTE_MIN_VOTES,
  DEMOTE_RATIO,
  SUBMIT_CONFIRM_VOTES,
  SUBMIT_TRUST_CEILING,
  capTrust,
  downgrade,
  isAgreed,
  normalizeSubmitValue,
  resolveTrust
} from './trustRules.ts'

const today = '2026-11-23'

describe('降档顺序只下一级', () => {
  it('official → credible → experience → pending，到底不再变', () => {
    expect(downgrade('official')).toBe('credible')
    expect(downgrade('credible')).toBe('experience')
    expect(downgrade('experience')).toBe('pending')
    expect(downgrade('pending')).toBe('pending')
  })
})

describe('投票不够就不动', () => {
  it('票数低于门槛时原样返回', () => {
    // 门槛减一票，全部投负面
    const votes = DEMOTE_MIN_VOTES - 1
    const out = resolveTrust({ trust: 'official' }, { met: 0, notApplicable: votes }, today)
    expect(out.trust).toBe('official')
    expect(out.note).toBeUndefined()
  })

  it('票数够但负面占比不足时也不降', () => {
    const total = 10
    const bad = Math.max(0, Math.floor(total * DEMOTE_RATIO) - 1)
    const out = resolveTrust({ trust: 'official' }, { met: total - bad, notApplicable: bad }, today)
    expect(out.trust).toBe('official')
  })

  it('票数够且负面过线才降一档，并说明原因', () => {
    const total = 4
    const bad = 3
    const out = resolveTrust({ trust: 'official' }, { met: total - bad, notApplicable: bad }, today)
    expect(out.trust).toBe('credible')
    expect(out.note).toContain('4 条反馈里 3 条说不适用')
  })
})

describe('有效期', () => {
  it('过了有效期降一档', () => {
    const out = resolveTrust({ trust: 'official', validUntil: '2026-11-01' }, undefined, today)
    expect(out.trust).toBe('credible')
    expect(out.note).toContain('已过有效期')
  })

  it('有效期当天仍算有效：日期是闭区间，不是「小于等于就过期」', () => {
    const out = resolveTrust({ trust: 'official', validUntil: today }, undefined, today)
    expect(out.trust).toBe('official')
  })

  it('没有有效期的条目永远不判过期', () => {
    expect(resolveTrust({ trust: 'official' }, undefined, today).trust).toBe('official')
  })
})

describe('多条命中只降一档', () => {
  it('过期 + 反馈同时命中时只下一级，但两条原因都要说出来', () => {
    const out = resolveTrust(
      { trust: 'official', validUntil: '2026-01-01' },
      { met: 0, notApplicable: 5 },
      today
    )
    // 连降两级会让「违反了几条规则」不可见
    expect(out.trust).toBe('credible')
    expect(out.note).toContain('已过有效期')
    expect(out.note).toContain('5 条反馈里 5 条说不适用')
  })
})

describe('补录门槛', () => {
  it('至少两个独立来源才生效', () => {
    expect(SUBMIT_CONFIRM_VOTES).toBeGreaterThan(1)
  })
})

/**
 * 匿名设备票不算数（C2 的一个真漏洞）。
 *
 * `clientId` 由客户端自己生成并上报，同一个人换个字符串就能投两票。
 * 「两个 clientId 一致」根本不等于「两个独立的人一致」，而 C2 的整个立论就是后者。
 */
describe('凑票只认登录账号', () => {
  const voters = (userIds: string[], clientIds: string[]) => ({
    userIds: new Set(userIds),
    clientIds: new Set(clientIds)
  })

  it('两个匿名设备一致也不生效：设备标识是自己报的', () => {
    expect(isAgreed(voters([], ['dev-a', 'dev-b']))).toBe(false)
  })

  it('一个账号 + 任意多个匿名设备仍然不够：匿名票不参与计数', () => {
    // 权重低也还是可伪造，所以这里直接不算，而不是「算半票」
    expect(isAgreed(voters(['u1'], ['dev-a', 'dev-b', 'dev-c']))).toBe(false)
  })

  it('两个不同账号一致时生效', () => {
    expect(isAgreed(voters(['u1', 'u2'], []))).toBe(true)
  })

  it('一个匿名设备孤票不生效', () => {
    expect(isAgreed(voters([], ['dev-a']))).toBe(false)
  })
})

/**
 * 补录值的归一化与可信度上限（C2 的两个真 bug）。
 *
 * 归一化不生效时 C2 是**静默失效**的：接口接受 "17:00"，但写库时 Number("17:00")
 * 是 NaN，于是这条补录永远进不了线上表，用户看到的只是「感谢，待核验」。
 * 上限不生效时则相反 —— 用户填的值顶着官方身份去判硬冲突，看起来比真数据还权威。
 */
describe('补录值归一化', () => {
  it('17:00 与 1020 归一到同一个值，两台设备才能凑成一票', () => {
    const clock = normalizeSubmitValue('lastBus', '17:00')
    const minutes = normalizeSubmitValue('lastBus', '1020')
    expect(clock).toEqual({ kind: 'minutes', value: 1020, label: '1020' })
    expect(minutes).toEqual(clock)
  })

  it('时刻格式不合法时返回 null，不让 NaN 一路走到写库', () => {
    expect(normalizeSubmitValue('firstBus', '25:00')).toBeNull()
    expect(normalizeSubmitValue('firstBus', '17:99')).toBeNull()
    expect(normalizeSubmitValue('firstBus', 'abc')).toBeNull()
    expect(normalizeSubmitValue('firstBus', '')).toBeNull()
  })

  it('间隔必须是正整数：0 分间隔等于两班同一时刻', () => {
    expect(normalizeSubmitValue('intervalMin', '15')).toEqual({ kind: 'minutes', value: 15, label: '15' })
    expect(normalizeSubmitValue('intervalMin', '0')).toBeNull()
    expect(normalizeSubmitValue('intervalMin', '7.5')).toBeNull()
    // 超过一天：int 列存得下，但它描述的是「25 小时一班」，写进线上表会让等车推算全部失真
    expect(normalizeSubmitValue('intervalMin', '1512')).toBeNull()
  })

  it('营业时间是原始文本，不解析成数字', () => {
    expect(normalizeSubmitValue('openText', ' 周一闭馆 ')).toEqual({ kind: 'text', label: '周一闭馆' })
  })
})

describe('补录生效只压上限，不抬档', () => {
  it('官方行吸收用户填报后降到用户经验档', () => {
    expect(capTrust('official', SUBMIT_TRUST_CEILING)).toBe('experience')
    expect(capTrust('credible', SUBMIT_TRUST_CEILING)).toBe('experience')
  })

  it('本来就是待核实的行保持待核实，不因补录升档', () => {
    expect(capTrust('pending', SUBMIT_TRUST_CEILING)).toBe('pending')
    expect(capTrust('experience', SUBMIT_TRUST_CEILING)).toBe('experience')
  })
})
