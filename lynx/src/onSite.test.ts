import { describe, expect, it } from '@rstest/core';
import { setPlaces } from '../../shared/engine/placeIndex.js';
import { setLines } from '../../shared/engine/lines.js';
import {
  ACCURACY_LIMIT_M,
  DEFAULT_ARRIVAL_RADIUS_M,
  arrivalAt,
  cityTransitFor,
  nearbyTidbits,
  nextStopAfter,
  remainingStops,
} from '../../shared/engine/onSite.js';
import type { Demand, ItineraryItem, Place, Plan, TransitLine } from '../../shared/types/index.js';

/**
 * 到达判定与下一站（F04 / F05）。
 *
 * 这一组最糟的失败不是报错，而是**把「大概在附近」说成「已到达」**：
 * 用户按这句话做决定（门票、预约、走哪条路），错了是我们造成的。
 * 所以每个用例都从「什么时候必须说不知道」那一侧反着断言。
 */

const base = {
  open: [540, 1380] as [number, number],
  walk: 1 as const,
  tags: [],
  source: '测试数据',
  trust: 'official' as const,
  rating: 4.5,
  visitors: 10,
  stayMin: 90,
  ticket: 0,
};

// 1 度纬度约 111km，所以 0.001 度 ≈ 111m，方便按米造距离
const places: Place[] = [
  { ...base, id: 's-museum', name: '博物馆', city: '现场城', lng: 104.0, lat: 30.0, radiusM: 200 },
  { ...base, id: 's-park', name: '公园', city: '现场城', lng: 104.1, lat: 30.0 },
  // 这个点在第三天才去，用来验证「只看今天」
  { ...base, id: 's-later', name: '后天再去', city: '现场城', lng: 104.0, lat: 30.0001 },
];

setPlaces(places);

const item = (id: string, placeId: string, startMin = 9 * 60): ItineraryItem => ({
  id,
  kind: 'place',
  title: placeId,
  placeId,
  startMin,
  endMin: startMin + 90,
  stayMin: 90,
  transportMin: 0,
  transportMode: 'public',
  cost: 0,
});

const demand = (over: Partial<Demand> = {}): Demand => ({
  destination: '现场城',
  dayCount: 2,
  party: 2,
  budgetLevel: 'mid',
  preferences: [],
  transport: 'public',
  notes: '',
  ...over,
});

const plan = (items: ItineraryItem[]): Plan => ({
  id: 'p',
  pace: 'balanced',
  paceLabel: '测试',
  transport: 'public',
  destination: '现场城',
  suitableFor: '测试',
  highlights: [],
  days: [{ index: 1, items }],
  budget: { items: [], total: 0, perPerson: 0, uncertain: [] },
  issues: [],
});

const now = Date.parse('2026-12-05T06:00:00Z');

describe('到达判定：只在该确定时给结论', () => {
  it('在半径内且精度够，判定到达', () => {
    const fix = { lng: 104.0005, lat: 30.0, accuracy: 50, at: now };
    const r = arrivalAt([item('i1', 's-museum')], fix, { now });
    expect(r.kind).toBe('arrived');
    if (r.kind === 'arrived') expect(r.distanceM).toBeLessThanOrEqual(200);
  });

  it('超出该点的半径时不说到达', () => {
    // 约 450 米，博物馆半径只有 200
    const fix = { lng: 104.004, lat: 30.0, accuracy: 20, at: now };
    const r = arrivalAt([item('i1', 's-museum')], fix, { now });
    expect(r.kind).toBe('elsewhere');
  });

  it('没给半径的点用默认半径，不因为缺字段就判成「不在」', () => {
    // 约 150 米，公园没有 radiusM
    const fix = { lng: 104.1013, lat: 30.0, accuracy: 20, at: now };
    const r = arrivalAt([item('i1', 's-park')], fix, { now });
    expect(r.kind).toBe('arrived');
    expect(DEFAULT_ARRIVAL_RADIUS_M).toBeGreaterThan(150);
  });

  it('精度不足时不判到达，哪怕坐标就在门口', () => {
    const fix = { lng: 104.0, lat: 30.0, accuracy: ACCURACY_LIMIT_M + 100, at: now };
    const r = arrivalAt([item('i1', 's-museum')], fix, { now });
    expect(r.kind).toBe('unknown');
    if (r.kind === 'unknown') {
      expect(r.reason).toBe('low-accuracy');
      expect(r.accuracyM).toBeGreaterThan(ACCURACY_LIMIT_M);
    }
  });

  it('没有定位时不假定到达', () => {
    expect(arrivalAt([item('i1', 's-museum')], null, { now }).kind).toBe('unknown');
  });

  it('过期的定位快照不能当「此刻在哪」用', () => {
    const fix = { lng: 104.0, lat: 30.0, accuracy: 20, at: now - 10 * 60 * 1000 };
    const r = arrivalAt([item('i1', 's-museum')], fix, { now });
    expect(r.kind).toBe('unknown');
    if (r.kind === 'unknown') expect(r.reason).toBe('stale');
  });

  it('今天没有安排时说「没有计划」，不拿别的天充数', () => {
    const r = arrivalAt([], { lng: 104.0, lat: 30.0, accuracy: 20, at: now }, { now });
    expect(r.kind).toBe('unknown');
    if (r.kind === 'unknown') expect(r.reason).toBe('no-plan');
  });

  it('只看传入的这一天的点：不在列表里的点不算到达', () => {
    // 站在 s-later 门口（约 11 米），但今天只安排去 5 公里外的公园
    const fix = { lng: 104.0, lat: 30.0001, accuracy: 10, at: now };
    const r = arrivalAt([item('i1', 's-park')], fix, { now });
    expect(r.kind).toBe('elsewhere');
  });
});

describe('到达后能看到什么', () => {
  const facts = [
    { id: 'f1', placeId: 's-museum', poiGroup: 'pitfall', content: '需预约', source: '官方' },
    { id: 'f2', placeId: 's-museum', poiGroup: 'access', content: '地铁 A 口最近', source: '实测' },
    { id: 'f3', placeId: 's-park', poiGroup: 'pitfall', content: '别的地方', source: '官方' },
  ];

  it('只返回这个点挂着的条目', () => {
    const r = nearbyTidbits(facts, 's-museum');
    expect(r.items.map((i) => i.id).sort()).toEqual(['f1', 'f2']);
  });

  it('如实说明吃/拍/买三类没有数据，不编一条附近好吃的', () => {
    const r = nearbyTidbits(facts, 's-museum');
    expect(r.missing).toEqual(['eat', 'photo', 'buy']);
  });

  it('这个点没有任何条目时返回空列表，不是伪造内容', () => {
    expect(nearbyTidbits(facts, 's-later').items).toEqual([]);
  });
});

describe('下一站', () => {
  it('找当前点之后的下一个景点，跳过餐食', () => {
    const items = [
      item('i1', 's-museum'),
      { ...item('m1', ''), kind: 'meal' as const, placeId: undefined, title: '午餐' },
      item('i2', 's-park', 12 * 60),
    ];
    const next = nextStopAfter(plan(items), 'i1');
    expect(next?.place.id).toBe('s-park');
  });

  it('当天最后一站没有下一站（跨天不冒充连续）', () => {
    const items = [item('i1', 's-museum'), item('i2', 's-park', 12 * 60)];
    expect(nextStopAfter(plan(items), 'i2')).toBeNull();
  });

  it('给出到下一站的直线距离', () => {
    const items = [item('i1', 's-museum'), item('i2', 's-park', 12 * 60)];
    const next = nextStopAfter(plan(items), 'i1');
    expect(next!.distanceKm).toBeGreaterThan(5);
  });

  it('没有线路数据时不编一条交通方式', () => {
    const items = [item('i1', 's-museum'), item('i2', 's-park', 12 * 60)];
    expect(nextStopAfter(plan(items), 'i1')!.line).toBeNull();
  });

  it('剩余站点数按当前位置往后数', () => {
    const day = { index: 1, items: [item('i1', 's-museum'), item('i2', 's-park', 12 * 60)] };
    expect(remainingStops(day, 'i1')).toBe(1);
    expect(remainingStops(day, 'i2')).toBe(0);
  });
});

describe('城市交通：没有数据就说没有', () => {
  it('明确不可用，并说明原因', () => {
    const t = cityTransitFor('现场城');
    expect(t.available).toBe(false);
    expect(t.reason).toContain('尚未接入');
  });

  it('给出此刻能做的替代方案，而不是空手', () => {
    expect(cityTransitFor('现场城').fallback.length).toBeGreaterThan(0);
  });
});

describe('线路交通：未核验的班次不标成已核验', () => {
  const demoLine: TransitLine = {
    id: 'line-1',
    city: '现场城',
    name: '观光车',
    mode: 'sightseeing',
    stops: [
      { name: 'A', lng: 104.0, lat: 30.0 },
      { name: 'B', lng: 104.1, lat: 30.0 },
    ],
    firstBus: 540,
    lastBus: 1020,
    intervalMin: 20,
    tickets: [],
    needAdvance: null,
    capacity: null,
    rideMin: 15,
    rideAtPlaceId: 's-park',
    source: '演示',
    trust: 'official',
    isDemo: true,
  };

  it('演示班次不被说成已核验', () => {
    setLines([demoLine]);
    const items: ItineraryItem[] = [
      item('i1', 's-museum'),
      { ...item('i2', 's-park', 12 * 60), lineId: 'line-1', waitMin: 5 },
    ];
    const next = nextStopAfter(plan(items), 'i1');
    expect(next!.line?.verified).toBe(false);
    setLines([]);
  });
});
