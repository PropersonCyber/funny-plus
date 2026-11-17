import { describe, expect, it } from '@rstest/core';

import { budgetView, conflictHint, factsView, placeDetailView } from '../../shared/engine/aiGround.js';
import type { Plan, Place, TravelFact } from '../../shared/types/index.js';

const place = (ticket: number | null): Place => ({
  id: 'p1',
  name: '洪崖洞',
  city: '重庆',
  lng: 0,
  lat: 0,
  open: [9 * 60, 22 * 60],
  openText: '09:00-22:00',
  ticket,
  stayMin: 90,
  walk: 2,
  tags: [],
  rating: 0,
  visitors: 0,
  source: '景区公示',
  verifiedAt: '2026-01-01',
  trust: 'official',
});

const fact = (over: Partial<TravelFact>): TravelFact => ({
  id: 'f1',
  city: '重庆',
  category: '预约与门票',
  content: '要预约',
  scope: '洪崖洞',
  source: '官方',
  verifiedAt: '2026-01-01',
  trust: 'official',
  ...over,
});

describe('咕噜解释工具', () => {
  it('票价未核实保持 null，不写成免费', () => {
    const view = placeDetailView(place(null));
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.ticket).toBeNull();
    expect(view.ticketStatus).toBe('未核实');
    expect(view.openFrom).toBe('09:00');
    expect(view.source).toBe('景区公示');
  });

  it('找不到地点时拒绝编造', () => {
    expect(placeDetailView(undefined).ok).toBe(false);
  });

  it('过期避坑只计数，不进 fresh', () => {
    const view = factsView(
      [
        fact({ id: 'fresh', content: '还有效' }),
        fact({ id: 'old', content: '过期了', validUntil: '2020-01-01' }),
        fact({ id: 'other', city: '成都', content: '别的城市' }),
      ],
      '重庆',
      undefined,
      new Date('2026-06-01')
    );
    expect(view.fresh.map((f) => f.id)).toEqual(['fresh']);
    expect(view.expiredCount).toBe(1);
  });

  it('某一天的未核实门票不会被预算视图写成 0', () => {
    const plan = {
      days: [{ index: 2, items: [{ kind: 'place', title: '洪崖洞', cost: null }] }],
      budget: { items: [], total: 0, perPerson: 0, uncertain: ['门票未核实'] },
      issues: [],
    } as unknown as Plan;
    const view = budgetView(plan, 2);
    expect(view.ok).toBe(true);
    if (!view.ok || !('places' in view) || !view.places) return;
    expect(view.places[0].ticket).toBeNull();
    expect(view.places[0].ticketStatus).toBe('未核实');
  });

  it('第二次仍有硬冲突时要求停止再生成', () => {
    expect(conflictHint(0, 2)).toBe('没有硬冲突');
    expect(conflictHint(1, 1)).toBe('有硬冲突，最多再生成一版更松的方案');
    expect(conflictHint(1, 2)).toBe('仍有硬冲突，停止再生成，向用户说明排不下的原因');
  });
});
