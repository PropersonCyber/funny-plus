import { describe, expect, it } from 'vitest'
import { buildShareSnapshot } from './shareSnapshot.ts'
import type { GuideDraft } from '@/types/index.ts'

/**
 * 发布快照的隐私口径。
 *
 * 这些用例是「不要泄露」那条线的唯一自动化保障：快照一旦多带一个字段，
 * 就是直接公开到互联网。所以断言不只看「该有的有」，更要看「不该有的一个都没有」。
 */

function draft(over: Partial<GuideDraft> = {}): GuideDraft {
  return {
    id: 'g-1',
    tripId: 'trip-1',
    title: '成都三日：我的走法',
    summary: '第一天主要吃，第二天逛园子。',
    photos: [],
    showCost: false,
    picked: { p1: true, p2: false, p3: true },
    sections: [
      {
        dayIndex: 1,
        items: [
          { planRef: 'p1', placeTitle: '人民公园', text: '喝茶', visited: 'yes', photos: [] },
          { planRef: 'p2', placeTitle: '没勾的地方', text: '不该出现', visited: 'no', photos: [] }
        ]
      },
      {
        dayIndex: 2,
        items: [{ planRef: 'p3', placeTitle: '青羊宫', text: '清淡', visited: 'yes', photos: [] }]
      }
    ],
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
    ...over
  }
}

describe('buildShareSnapshot', () => {
  it('只保留用户勾选的条目，未勾的整条不进快照', () => {
    const snap = buildShareSnapshot(draft(), undefined)
    const titles = snap.sections.flatMap((s) => s.items.map((i) => i.placeTitle))
    expect(titles).toEqual(['人民公园', '青羊宫'])
    expect(titles).not.toContain('没勾的地方')
    // 被排除条目的正文一个字都不能留下
    expect(JSON.stringify(snap)).not.toContain('不该出现')
  })

  it('某天所有条目都没勾时，整天不进快照', () => {
    const snap = buildShareSnapshot(draft({ picked: { p1: true, p2: false, p3: false } }), undefined)
    expect(snap.sections.map((s) => s.dayIndex)).toEqual([1])
  })

  it('showCost 为 false 时不带 perPerson 字段（不是带 0 或 null）', () => {
    const snap = buildShareSnapshot(draft({ showCost: false }), 388)
    expect('perPerson' in snap).toBe(false)
  })

  it('showCost 为 true 且费用为 0 时仍然带上（0 是合法费用）', () => {
    const snap = buildShareSnapshot(draft({ showCost: true }), 0)
    expect(snap.perPerson).toBe(0)
  })

  it('showCost 为 true 但没给费用时也不带该字段', () => {
    const snap = buildShareSnapshot(draft({ showCost: true }), undefined)
    expect('perPerson' in snap).toBe(false)
  })

  it('剥掉 local 与 dataUri 照片，只留 remote', () => {
    const snap = buildShareSnapshot(
      draft({
        photos: [
          { id: 'a', kind: 'remote', value: 'https://cdn/x.jpg', addedAt: '2026-11-01T00:00:00.000Z' },
          { id: 'b', kind: 'local', value: '/tmp/y.jpg', addedAt: '2026-11-01T00:00:00.000Z' },
          { id: 'c', kind: 'dataUri', value: 'data:image/png;base64,AAA', addedAt: '2026-11-01T00:00:00.000Z' }
        ]
      }),
      undefined
    )
    expect(snap.photos.map((p) => p.id)).toEqual(['a'])
  })

  it('输出不含 id / tripId / picked 等内部标识', () => {
    // showCost 默认为 false，所以这里不该出现 perPerson —— 正好用来验「字段数」这条断言
    const snap = buildShareSnapshot(draft(), 100)
    const keys = Object.keys(snap).sort()
    expect(keys).toEqual(['photos', 'publishedAt', 'sections', 'showCost', 'summary', 'title'])
    const json = JSON.stringify(snap)
    expect(json).not.toContain('trip-1')
    expect(json).not.toContain('"g-1"')
  })
})
