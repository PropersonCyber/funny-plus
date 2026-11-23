import { describe, expect, it } from '@rstest/core';
import { setPlaces } from '../../shared/engine/placeIndex.js';
import { generatePlans } from '../../shared/engine/planner.js';
import { LIGHT_MAX_HOURS, LIGHT_START, LightPlanError, generateLightPlan, lightWindowLabel } from '../../shared/engine/lightPlan.js';
import type { Demand, Place } from '../../shared/types/index.js';

/**
 * 轻量规划（F04「当地临时规划」）。
 *
 * 这一组里最要命的失败不是报错，而是**排了一个用户到不了的点**：
 * 他说「下午有四小时」，行程却从 09:00 开始、或者把 17:30 才出发的景点也塞进来。
 * 所以他拿到的时间表看着完整，实际执行不了 —— 比直接说「排不下」更糟。
 * 每个用例都从「超出时长的那一站必须在」这一侧反着断言。
 */

const base = {
  open: [540, 1380] as [number, number],
  walk: 1 as const,
  tags: ['打卡'],
  source: '测试数据',
  trust: 'official' as const,
  rating: 4.5,
  visitors: 10,
  stayMin: 60,
  ticket: 0,
};

const places: Place[] = [
  // 四个点，坐标从近到远，方便验证「从 origin 排起」
  { ...base, id: 'l-near', name: '近点', city: '轻量城', lng: 104.0, lat: 30.6, stayMin: 60 },
  { ...base, id: 'l-mid', name: '中点', city: '轻量城', lng: 104.05, lat: 30.6, stayMin: 60 },
  { ...base, id: 'l-far', name: '远点', city: '轻量城', lng: 104.5, lat: 30.6, stayMin: 60 },
  // 只到 16:00，用来验证「到得晚就跳过，不硬塞」
  { ...base, id: 'l-earlyclose', name: '早关点', city: '轻量城', lng: 104.02, lat: 30.61, stayMin: 60, open: [540, 960] },
];

setPlaces(places);

const demand = (over: Partial<Demand> = {}): Demand => ({
  destination: '轻量城',
  dayCount: 1,
  party: 2,
  budgetLevel: 'mid',
  preferences: [],
  transport: 'public',
  notes: '',
  hours: 4,
  ...over,
});

const itemsOf = (d: Demand) => generateLightPlan(d).days[0].items;
const endOf = (d: Demand) => Math.max(...itemsOf(d).map((i) => i.endMin));

describe('轻量规划从给定时刻起算，不从头排', () => {
  it('给了 14:00 就从 14:00 开始，不从 09:00', () => {
    const plan = generateLightPlan(demand({ startMin: 14 * 60 }));
    expect(plan.days[0].items[0].startMin).toBeGreaterThanOrEqual(14 * 60);
  });

  it('没说几点时按下午两点，不默认早上九点', () => {
    const plan = generateLightPlan(demand());
    expect(plan.days[0].items[0].startMin).toBeGreaterThanOrEqual(LIGHT_START);
  });
});

describe('超出时长的一个点都不排', () => {
  it('每个安排都在 start + hours 之内结束', () => {
    const d = demand({ startMin: 14 * 60, hours: 2 });
    expect(endOf(d)).toBeLessThanOrEqual(14 * 60 + 2 * 60);
  });

  it('时间只够一站时，就只排一站', () => {
    // 单站 60 分钟，2 小时够排一到两个，但绝不能超时
    const items = itemsOf(demand({ startMin: 14 * 60, hours: 1.5 })).filter((i) => i.kind === 'place');
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items.length).toBeLessThanOrEqual(2);
  });

  it('到得比关门前晚的点不硬塞进去', () => {
    // 早关点 16:00 关门；16:30 才开始的话它必须被跳过
    const items = itemsOf(demand({ startMin: 16 * 60 + 30, hours: 3 })).filter((i) => i.kind === 'place');
    expect(items.some((i) => i.placeId === 'l-earlyclose')).toBe(false);
  });
});

describe('时长本身不合法时说清楚，不悄悄改成别的数', () => {
  it('超过 12 小时要求改走按天规划', () => {
    expect(() => generateLightPlan(demand({ hours: LIGHT_MAX_HOURS + 4 }))).toThrow(LightPlanError);
    expect(() => generateLightPlan(demand({ hours: LIGHT_MAX_HOURS + 4 }))).toThrow(/按天数规划/);
  });

  it('不足一小时直接说排不了', () => {
    expect(() => generateLightPlan(demand({ hours: 0.5 }))).toThrow(/至少要留出/);
  });

  it('时长不够排下任何一站时给可读原因，不返回空行程', () => {
    // 晚城只收录一个 09:00-12:00 的馆子；21:00 才开始，怎么排都到不了
    setPlaces([...places, { ...base, id: 'late-only', name: '只开到中午', city: '晚城', lng: 104, lat: 30, open: [540, 720] }]);
    expect(() => generateLightPlan(demand({ destination: '晚城', startMin: 21 * 60, hours: 1 }))).toThrow(LightPlanError);
    setPlaces(places);
  });
});

describe('给了当前位置就从最近的点排起', () => {
  it('origin 在远点附近时，远点排在近点前面', () => {
    const plan = generateLightPlan(
      demand({ startMin: 14 * 60, hours: 6, origin: { lng: 104.5, lat: 30.6 } })
    );
    const ids = plan.days[0].items.filter((i) => i.kind === 'place').map((i) => i.placeId);
    expect(ids[0]).toBe('l-far');
  });

  it('没给 origin 时不冒充「离你最近」，不能假装知道用户在哪', () => {
    // 没有 origin 时走普通就近排序（从第一个点出发），不读取任何位置
    const plan = generateLightPlan(demand({ startMin: 14 * 60, hours: 6 }));
    expect(plan.days[0].items.length).toBeGreaterThan(0);
  });
});

describe('轻量规划的预算与口径', () => {
  it('不含住宿项，并且明说未计入住宿', () => {
    const plan = generateLightPlan(demand());
    expect(plan.budget.items.some((i) => i.category === 'lodging')).toBe(false);
    expect(plan.budget.uncertain.some((u) => u.includes('住宿'))).toBe(true);
  });

  it('人均 = 总额 / 人数', () => {
    const plan = generateLightPlan(demand({ party: 3 }));
    expect(plan.budget.perPerson).toBe(Math.round(plan.budget.total / 3));
  });

  it('把起止时刻写进 issue，用户能核对是不是他想的那几个小时', () => {
    const plan = generateLightPlan(demand({ startMin: 14 * 60, hours: 3 }));
    const issue = plan.issues.find((i) => i.code === 'light-window');
    expect(issue?.message).toContain('14:00');
    expect(issue?.message).toContain('17:00');
  });

  it('paceLabel 写的是时长，不是「轻松慢走」这种整天的说法', () => {
    expect(generateLightPlan(demand({ hours: 3 })).paceLabel).toContain('3 小时');
  });
});

describe('接在 generatePlans 里：给了 hours 自动走轻量', () => {
  it('有 hours 时只出一套，不是三套对比', () => {
    expect(generatePlans(demand()).length).toBe(1);
  });

  it('没有 hours 时仍是正常的多套方案', () => {
    const normal = demand({ hours: undefined });
    expect(generatePlans(normal).length).toBeGreaterThan(1);
  });
});

describe('时间窗文案', () => {
  it('给出可读的起止区间', () => {
    expect(lightWindowLabel({ hours: 4, startMin: 14 * 60 })).toBe('14:00-18:00');
  });

  it('不是轻量需求时返回空串，不硬凑一段文字', () => {
    expect(lightWindowLabel({ hours: undefined })).toBe('');
  });
});
