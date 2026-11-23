import { describe, expect, it } from '@rstest/core';
import { setPlaces } from '../../shared/engine/placeIndex.js';
import { generatePlans } from '../../shared/engine/planner.js';
import { DEFAULT_START, clock, minutesFor, reverseWindow, windowFeasible } from '../../shared/engine/timeWindow.js';
import type { Demand, Place } from '../../shared/types/index.js';

/**
 * 两种规划起点（F03）。
 *
 * 钉三件事：出发时刻听用户的、返回时刻是约束、必去点能反推时间。
 * 这几条如果悄悄失效，产出的仍然是「看起来合理」的行程 —— 用户到点赶不上车，
 * 而界面不会报任何错，是最难发现的一类坏。
 */

const base = {
  open: [480, 1200] as [number, number],
  walk: 1 as const,
  tags: [] as string[],
  source: '测试',
  trust: 'official' as const,
  rating: 4.5,
  visitors: 10,
  stayMin: 60,
  ticket: 0,
};

// 两个点相距约 1.1km，步行折算约 15 分钟
const places: Place[] = [
  { ...base, id: 'w-a', name: '甲', city: '窗口城', lng: 104.0, lat: 30.0, stayMin: 90 },
  { ...base, id: 'w-b', name: '乙', city: '窗口城', lng: 104.01, lat: 30.0, stayMin: 90 },
  { ...base, id: 'w-c', name: '丙', city: '窗口城', lng: 104.02, lat: 30.0, stayMin: 90 },
];

setPlaces(places);

const demand = (over: Partial<Demand> = {}): Demand => ({
  destination: '窗口城',
  dayCount: 1,
  party: 2,
  budgetLevel: 'flexible',
  preferences: [],
  transport: 'public',
  notes: '',
  ...over,
});

describe('出发时刻', () => {
  it('没说就按默认 9:00', () => {
    const [plan] = generatePlans(demand());
    expect(plan!.days[0]!.items[0]!.startMin).toBe(DEFAULT_START);
  });

  it('说了 12 点出发就从 12 点排，不是 9 点', () => {
    // 这是以前写死 9:00 的那个坑：用户那句话被无声忽略
    const [plan] = generatePlans(demand({ startMin: 12 * 60 }));
    const first = plan!.days[0]!.items.find((i) => i.kind === 'place')!;
    expect(first.startMin).toBeGreaterThanOrEqual(12 * 60);
  });
});

describe('返回时刻是约束', () => {
  it('排超过 returnBy 时报 over-return，并说清晚多久', () => {
    const [plan] = generatePlans(demand({ startMin: 14 * 60, returnBy: 15 * 60 }));
    const over = plan!.issues.find((i) => i.code === 'over-return');
    expect(over).toBeTruthy();
    expect(over!.level).toBe('error');
    expect(over!.message).toContain('晚');
  });

  it('放得下时不报 over-return', () => {
    const [plan] = generatePlans(demand({ startMin: 9 * 60, returnBy: 20 * 60 }));
    expect(plan!.issues.some((i) => i.code === 'over-return')).toBe(false);
  });

  it('超时同时给延长备选，说清多玩什么', () => {
    const [plan] = generatePlans(demand({ startMin: 14 * 60, returnBy: 14 * 60 + 30 }));
    const ext = plan!.issues.find((i) => i.code === 'extend-option');
    expect(ext).toBeTruthy();
    expect(ext!.message).toContain('晚约');
  });
});

describe('必去点反推时间', () => {
  it('mustVisit 的顺序就是行程顺序，不被偏好重排', () => {
    // 用户点名 丙 → 甲，引擎不能「就近」把它改成 甲 → 丙
    const [plan] = generatePlans(demand({ mustVisit: ['w-c', 'w-a'] }));
    const titles = plan!.days[0]!.items.filter((i) => i.kind === 'place').map((i) => i.title);
    expect(titles.slice(0, 2)).toEqual(['丙', '甲']);
  });

  it('给了 returnBy 就倒推出发时刻并讲明依据', () => {
    const w = reverseWindow(places.slice(0, 2), demand({ returnBy: 18 * 60 }));
    expect(w!.endMin).toBe(18 * 60);
    expect(w!.startMin).toBeLessThan(w!.endMin);
    expect(w!.basis).toContain('停留');
  });

  it('倒推出的出发时刻早于可行时间时判为不可行，而不是截断到 0 点', () => {
    const w = reverseWindow(places, demand({ returnBy: 9 * 60 }));
    expect(windowFeasible(w!)).toBe(false);
  });

  it('行程里写明建议出发与返回时刻', () => {
    const [plan] = generatePlans(demand({ mustVisit: ['w-a', 'w-b'], startMin: 9 * 60 }));
    const rev = plan!.issues.find((i) => i.code === 'reverse-window' || i.code === 'reverse-infeasible');
    expect(rev).toBeTruthy();
  });

  it('池子里不存在的 id 被忽略，不会毁掉整份行程', () => {
    const [plan] = generatePlans(demand({ mustVisit: ['不存在', 'w-a'] }));
    const titles = plan!.days[0]!.items.filter((i) => i.kind === 'place').map((i) => i.title);
    expect(titles[0]).toBe('甲');
  });
});

describe('minutesFor', () => {
  it('含停留、路上、一顿饭和缓冲', () => {
    const m = minutesFor(places.slice(0, 2), demand());
    expect(m.stay).toBe(180);
    expect(m.legs).toBeGreaterThan(0);
    expect(m.meals).toBe(60);
    expect(m.total).toBe(m.stay + m.legs + m.meals + 10);
  });

  it('单个点不排一顿饭', () => {
    expect(minutesFor(places.slice(0, 1), demand()).meals).toBe(0);
  });

  it('空列表返回 0，不抛异常', () => {
    expect(minutesFor([], demand()).total).toBe(0);
  });
});

describe('clock', () => {
  it('补零到两位', () => {
    expect(clock(9 * 60 + 5)).toBe('09:05');
    expect(clock(0)).toBe('00:00');
  });
});
