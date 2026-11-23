import { describe, expect, it } from 'vitest'

/**
 * 可信度降档规则（C1 / C3）。
 *
 * 这里全是「不该降」的反向用例：把官方核验的条目降错档，界面不会报错，
 * 只是从此这条信息说的话不再可信 —— 而这种损失没法靠测试以外的手段发现。
 */
import { DEMOTE_MIN_VOTES, DEMOTE_RATIO, downgrade, resolveTrust, SUBMIT_CONFIRM_VOTES } from './trustRules.ts'

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
  it('至少两个独立设备才生效', () => {
    expect(SUBMIT_CONFIRM_VOTES).toBeGreaterThan(1)
  })
})
