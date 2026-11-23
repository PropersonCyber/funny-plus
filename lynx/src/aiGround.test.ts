import { describe, expect, it } from '@rstest/core';

import { budgetView, conflictHint, factsView, placeDetailView, segmentView } from '../../shared/engine/aiGround.js';
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

describe('逐段交通比较（F05）', () => {
  const line = {
    id: 'l1',
    name: '观光车',
    city: '北京',
    mode: 'shuttle' as const,
    stops: [],
    rideAtPlaceId: 'p2',
    firstBus: 9 * 60,
    lastBus: 18 * 60,
    intervalMin: 30,
    rideMin: 20,
    capacity: 3,
    tickets: [{ kind: '单程', price: 20 }],
    needAdvance: false,
    trust: 'official' as const,
    source: '景区公示',
    isDemo: false,
  };

  it('2 人与 6 人得出不同结论：分乘与车辆数都要算进去', () => {
    const two = segmentView(line, 2, 20, 25);
    const six = segmentView(line, 6, 20, 25);
    if (!two.ok || !six.ok) throw new Error('线路已给，不该判成无数据');
    // 6 人超过单班核载 3，必须提示分乘
    expect(six.assumptions.join()).toContain('分乘');
    expect(two.assumptions.join()).not.toContain('分乘');
    // 打车按 4 人一车：6 人 = 2 辆
    expect(six.options.find((o) => o.mode === 'taxi')!.label).toContain('2 辆');
  });

  it('走比坐车快时说清楚，不默认推荐坐车', () => {
    const v = segmentView(line, 2, 20, 10);
    if (!v.ok) throw new Error('线路已给，不该判成无数据');
    expect(v.walkFaster).toBe(true);
  });

  it('没有线路数据时只给步行/打车，明确说别编班次', () => {
    const v = segmentView(undefined, 2, 20, 25);
    expect(v.ok).toBe(false);
    expect(v.note).toContain('不要编造');
  });

  it('票价未核实时只比时间，不假装能比钱', () => {
    const noPrice = { ...line, tickets: [] };
    const v = segmentView(noPrice, 2, 20, 25);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.partial).toBe(true);
    expect(v.verdict).toContain('比时间');
  });
});
