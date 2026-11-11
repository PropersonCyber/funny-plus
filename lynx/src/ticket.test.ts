import { describe, expect, it } from '@rstest/core';

import { estimateBudget } from '../../shared/engine/budget.js';
import { setPlaces } from '../../shared/engine/placeIndex.js';
import { generatePlans } from '../../shared/engine/planner.js';
import { ticketAmount, ticketText } from './ticketText.js';
import type { Demand, ItineraryItem, Place, TripDay } from '../../shared/types/index.js';

// 票价未核实（null）和「免费」是两件事：0 是已知免费，null 是不知道。
// 这一组测试钉住两者在展示、预算、行程条目里的不同走法，避免哪天被 `?? 0` 悄悄抹平。

describe('票价展示口径', () => {
  it('null 显示「暂无票价」，不能显示成免费或 ¥0', () => {
    expect(ticketText(null)).toBe('暂无票价');
    expect(ticketText(undefined)).toBe('暂无票价');
  });

  it('0 是明确的免费', () => {
    expect(ticketText(0)).toBe('免费');
  });

  it('正数带 ¥', () => {
    expect(ticketText(60)).toBe('¥60');
  });

  it('求和时未知按 0 计入，但只在这一处折算', () => {
    // 折算是给预算用的中间值，界面上必须走 ticketText 保留「不知道」
    expect(ticketAmount(null)).toBe(0);
    expect(ticketAmount(60)).toBe(60);
  });
});

describe('票价未核实时的预算口径', () => {
  const demand: Demand = {
    destination: '测试城',
    dayCount: 1,
    party: 2,
    budgetLevel: 'mid',
    preferences: ['打卡'],
    transport: 'public',
    notes: '',
  };

  const item = (cost: number | null, id: string): ItineraryItem => ({
    id,
    kind: 'place',
    title: id,
    startMin: 540,
    endMin: 630,
    stayMin: 90,
    transportMin: 0,
    transportMode: 'public',
    cost,
  });

  const days = (items: ItineraryItem[]): TripDay[] => [{ index: 1, items }];

  it('未核实的票价不进总额，并明确告知少算了几个景点', () => {
    const budget = estimateBudget(demand, days([item(60, 'p1'), item(null, 'p2')]));
    const tickets = budget.items.find((i) => i.category === 'tickets')!;
    // 只算已核实的 60 元/人 × 2 人
    expect(tickets.amount).toBe(120);
    expect(budget.uncertain.some((u) => u.includes('1 个景点票价未核实'))).toBe(true);
  });

  it('全部核实时不出现「未核实」提示', () => {
    const budget = estimateBudget(demand, days([item(60, 'p1'), item(0, 'p2')]));
    expect(budget.uncertain.some((u) => u.includes('票价未核实'))).toBe(false);
  });

  it('餐费条目带 cost 也不算门票，不触发「门票为公示价」', () => {
    // 餐费条目的 cost 是 60（planner 里的固定值），曾把「门票为公示价」这条提示顶成永远成立
    const meal: ItineraryItem = {
      id: 'meal-d1',
      kind: 'meal',
      title: '午餐',
      startMin: 720,
      endMin: 780,
      stayMin: 60,
      transportMin: 0,
      transportMode: 'public',
      cost: 60,
    };
    const budget = estimateBudget(demand, days([item(null, 'p1'), meal]));
    expect(budget.uncertain.some((u) => u.includes('门票为公示价'))).toBe(false);
  });
});

describe('行程条目继承票价的可空状态', () => {
  const base = {
    open: [540, 1380] as [number, number],
    walk: 1 as const,
    tags: ['打卡'],
    source: '测试数据',
    trust: 'pending' as const,
    rating: 4.5,
    visitors: 10,
  };

  const pool: Place[] = [
    { ...base, id: 'n-1', name: '门票未知点', city: '票城', lng: 104.0, lat: 30.6, ticket: null, stayMin: 90 },
    { ...base, id: 'n-2', name: '免费点', city: '票城', lng: 104.02, lat: 30.61, ticket: 0, stayMin: 90 },
    { ...base, id: 'n-3', name: '收费点', city: '票城', lng: 104.04, lat: 30.62, ticket: 60, stayMin: 90 },
  ];

  it('places 里 ticket 为 null 的景点，条目 cost 也是 null 而不是 0', () => {
    setPlaces(pool);
    const d: Demand = {
      destination: '票城',
      dayCount: 1,
      party: 2,
      budgetLevel: 'mid',
      preferences: ['打卡'],
      transport: 'public',
      notes: '',
    };
    const plan = generatePlans(d)[0];
    const items = plan.days.flatMap((day) => day.items).filter((i) => i.kind === 'place');
    // 一天排不满三个点是正常的（节奏/时长会挡），所以只钉住真正要证的两件事：
    // 1) 未知票价那条确实排进来了 2) 条目的 cost 和地点池里的 ticket 逐条一致
    expect(items.some((i) => i.placeId === 'n-1')).toBe(true);
    const ticketById = new Map(pool.map((p) => [p.id, p.ticket]));
    for (const it of items) expect(it.cost).toBe(ticketById.get(it.placeId!) ?? null);
    // 单独点明：null 不能被 `?? 0` 折成 0（0 的含义是已知免费）
    expect(items.find((i) => i.placeId === 'n-1')!.cost).toBeNull();
  });
});
