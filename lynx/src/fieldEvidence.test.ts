import { describe, expect, it } from '@rstest/core'

/**
 * 字段级依据的读取与过期（清单 §2.1 / §2.4）。
 *
 * 这一组的价值全在「不许把未知说成可信」上：判错的后果不是崩溃，
 * 而是拿一条过期三年的营业时间给用户排行程，且界面上看不出任何异样。
 */
import { evidenceFor, evidenceNote, isEvidenceExpired, judgeField, openNote, parseWindow, sameFieldValue } from '../../shared/engine/fieldEvidence.js'
import type { FieldEvidence } from '../../shared/types/index.js'

const today = '2026-11-23'

let seq = 0
const ev = (patch: Partial<FieldEvidence> = {}): FieldEvidence => ({
  id: `ev-${++seq}`,
  field: 'openText',
  value: '08:30-17:00',
  source: '故宫官网',
  verifiedAt: '2026-11-01',
  ...patch
})

describe('取依据', () => {
  it('同一字段多条时取核验时间最新的那条', () => {
    const list = [
      ev({ value: '旧', verifiedAt: '2025-01-01' }),
      ev({ value: '新', verifiedAt: '2026-11-20' }),
    ]
    expect(evidenceFor(list, 'openText')?.value).toBe('新')
  })

  it('同一天核验两次时按时刻分先后，不把后核的当成旧的', () => {
    // 之前 verifiedAt 被裁成 YYYY-MM-DD，上午下午两条完全相等，取新就只能靠数组顺序
    const list = [
      ev({ value: '下午更正', verifiedAt: '2026-11-20T09:00:00.000Z' }),
      ev({ value: '上午首次', verifiedAt: '2026-11-20T01:00:00.000Z' }),
    ]
    expect(evidenceFor(list, 'openText')?.value).toBe('下午更正')
  })

  it('核验时刻完全相同时结果稳定，不随数组顺序变', () => {
    const a = ev({ id: 'ev-a', value: 'A', verifiedAt: '2026-11-20T01:00:00.000Z' })
    const b = ev({ id: 'ev-b', value: 'B', verifiedAt: '2026-11-20T01:00:00.000Z' })
    expect(evidenceFor([a, b], 'openText')?.id).toBe(evidenceFor([b, a], 'openText')?.id)
  })

  it('只认字段名，不同字段互不串用', () => {
    expect(evidenceFor([ev({ field: 'ticket' })], 'openText')).toBeUndefined()
  })

  it('没有依据时返回 undefined，不返回空壳对象', () => {
    expect(evidenceFor(undefined, 'openText')).toBeUndefined()
    expect(evidenceFor([], 'openText')).toBeUndefined()
  })
})

describe('过期判定', () => {
  it('过了有效期算过期', () => {
    expect(isEvidenceExpired({ validUntil: '2026-11-01' }, today)).toBe(true)
  })

  it('有效期当天仍算有效：日期是闭区间', () => {
    expect(isEvidenceExpired({ validUntil: today }, today)).toBe(false)
  })

  it('没设有效期不判过期，但仍要值对得上才算核过', () => {
    // 这里只钉「不判过期」，避免把「没设」读成「永久有效」后到处传
    expect(isEvidenceExpired({}, today)).toBe(false)
    expect(judgeField([ev()], 'openText', '08:30-17:00', 'official', today)).toBe('ok')
  })
})

describe('能不能用来判硬', () => {
  it('过期、缺该字段、完全没依据，是三种不同原因', () => {
    const expected = '08:30-17:00'
    expect(judgeField([ev({ validUntil: '2020-01-01' })], 'openText', expected, 'official', today)).toBe('expired')
    // 只有票价的依据：这一格压根没核过，不能说成「过期」
    expect(judgeField([ev({ field: 'ticket' })], 'openText', expected, 'official', today)).toBe('missing')
    // 一条依据都没有 = 退回行级（老数据向后兼容），不是「待核实」
    expect(judgeField(undefined, 'openText', expected, 'official', today)).toBe('ok')
  })
})

describe('给界面的说明', () => {
  it('有依据时说清来源与核验日', () => {
    expect(evidenceNote(ev(), today)).toBe('依据 故宫官网 · 核验于 2026-11-01')
  })

  it('过期时补一句，不能只显示来源', () => {
    expect(evidenceNote(ev({ validUntil: '2020-01-01' }), today)).toContain('已过有效期')
  })

  it('没有依据时返回空串，调用方据此不渲染整行', () => {
    expect(evidenceNote(undefined, today)).toBe('')
  })
})

describe('开放时段说明：有依据用依据', () => {
  const place = (patch: Record<string, unknown> = {}) => ({
    fieldEvidence: undefined,
    source: '高德 POI',
    verifiedAt: '2026-11-01',
    ...patch,
  }) as Parameters<typeof openNote>[0]

  it('有字段依据时输出来源与核验日', () => {
    expect(openNote(place({ fieldEvidence: [ev()] }), today)).toBe('依据 故宫官网 · 核验于 2026-11-01')
  })

  it('依据过期时如实说，不能只报来源', () => {
    expect(openNote(place({ fieldEvidence: [ev({ validUntil: '2020-01-01' })] }), today)).toContain('已过有效期')
  })

  it('没有依据时退回行级来源与核验时间（不能因为新表是空的就把说明抹掉）', () => {
    expect(openNote(place(), today)).toBe('来源高德 POI · 核验 2026-11-01')
  })

  it('行级也没有核验时间时照实说，不拿今天顶上', () => {
    expect(openNote(place({ source: '', verifiedAt: undefined }), today)).toBe('未记录核验时间')
  })
})

describe('过期依据不参与硬约束（清单 §2.2）', () => {
  const open = '08:30-17:00'

  it('没有字段级依据时退回行级：老数据不许因为新表是空的就集体降级', () => {
    expect(judgeField(undefined, 'openText', open, 'official', today)).toBe('ok')
    expect(judgeField([], 'openText', open, 'official', today)).toBe('ok')
  })

  it('行级不是 official 时，字段依据再新也判不了硬', () => {
    expect(judgeField([ev()], 'openText', open, 'credible', today)).toBe('untrustedRow')
  })

  it('依据仍在有效期 → 可以判硬', () => {
    expect(judgeField([ev({ validUntil: '2027-01-01' })], 'openText', open, 'official', today)).toBe('ok')
  })

  it('依据已过期 → 不能判硬，最多提示', () => {
    // 三年前核过的营业时间，行级再标 official 也不能拿来拦用户
    expect(judgeField([ev({ validUntil: '2020-01-01' })], 'openText', open, 'official', today)).toBe('expired')
  })

  it('依据是别的字段时不算数（票价核过≠营业时间核过）', () => {
    expect(judgeField([ev({ field: 'ticket' })], 'openText', open, 'official', today)).toBe('missing')
  })

  it('依据核的是旧值、当前值已改過 → 不算核验过', () => {
    // 依据说末班 17:00，线路现在是 18:00：这条依据什么也没证明，却能把 18:00 当成已核验
    expect(judgeField([ev({ value: open })], 'openText', '09:00-18:00', 'official', today)).toBe('mismatch')
  })

  it('有依据但当前没可比对的原值 → 不算核验过（依据证明不了没写的原文）', () => {
    expect(judgeField([ev()], 'openText', undefined, 'official', today)).toBe('noBaseline')
    expect(judgeField([ev()], 'openText', '', 'official', today)).toBe('noBaseline')
  })
})

describe('依据值与当前值的比对', () => {
  it('时刻的两种写法算同一个值（录入时两种都有人用）', () => {
    expect(sameFieldValue(1020, '1020')).toBe(true)
    expect(sameFieldValue(1020, '17:00')).toBe(true)
    expect(sameFieldValue(1020, '17：00')).toBe(true)
    expect(sameFieldValue(1020, '18:00')).toBe(false)
  })

  it('空串不等于 0 分钟，不给午夜开口子', () => {
    expect(sameFieldValue(0, '')).toBe(false)
    expect(sameFieldValue(0, '0')).toBe(true)
  })

  it('文本只把空白拉平，不改动内容', () => {
    expect(sameFieldValue('周一至周日 00:00-24:00', ' 周一至周日  00:00-24:00 ')).toBe(true)
    expect(sameFieldValue('周一至周日 00:00-24:00', '周一至周日 00:00-23:00')).toBe(false)
  })

  it('时段按分钟对比较，两种写法都认', () => {
    expect(sameFieldValue([540, 1020], '09:00-17:00')).toBe(true)
    expect(sameFieldValue([540, 1020], '540-1020')).toBe(true)
    // 差一分钟也算变了：时段是要拿去拦人的，不能容差
    expect(sameFieldValue([540, 1020], '09:00-16:59')).toBe(false)
  })

  it('解析不出来的时段返回 null，不当成匹配', () => {
    expect(parseWindow('周一至周日 00:00-24:00；景区23点关灯')).toBeNull()
    expect(sameFieldValue([540, 1020], '看公告')).toBe(false)
  })
})
