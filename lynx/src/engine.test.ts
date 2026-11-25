import { describe, expect, it } from '@rstest/core';

import { estimateBudget } from '../../shared/engine/budget.js';
import { isExpired, splitByFreshness } from '../../shared/engine/facts.js';
import { clearRouteMinutes, hasRoute, placeById, placesOf, setPlaces, setRouteMinutes, travelMinutes } from '../../shared/engine/placeIndex.js';
import { generatePlans, keywordReviseOp, revisePlan } from '../../shared/engine/planner.js';
import { applyReviseOp } from '../../shared/engine/planEdit.js';
import { canJudgeLineHard, lineSegmentFor, setLines } from '../../shared/engine/lines.js';
import { validatePlan } from '../../shared/engine/validate.js';
import { legsOf } from './legs.js';
import { windowOf } from '../../shared/types/index.js';
import type { Demand, ItineraryItem, Place, Plan, TransitLine, TravelFact, TripDay } from '../../shared/types/index.js';

// 引擎是纯函数，「确定性」是产品卖点，这里用固定地点池把口径钉住：
// 改预算常数、改校验阈值、改人天口径，下面几条会先红。
const base = {
  open: [540, 1380] as [number, number],
  walk: 1 as const,
  tags: ['打卡'],
  source: '测试数据',
  trust: 'official' as const,
  // 展示字段与引擎无关，但类型上是必填：给固定值，免得加展示字段时测试跟着改
  rating: 4.5,
  visitors: 10,
};

const places: Place[] = [
  { ...base, id: 'a-1', name: '一号点', city: '测试城', lng: 104.0, lat: 30.6, ticket: 0, stayMin: 90 },
  { ...base, id: 'a-2', name: '二号点', city: '测试城', lng: 104.02, lat: 30.61, ticket: 60, stayMin: 120 },
  { ...base, id: 'a-3', name: '三号点', city: '测试城', lng: 104.05, lat: 30.62, ticket: 0, stayMin: 90 },
  // 只在 17:00 前开放，用来造「营业时间冲突」
  { ...base, id: 'a-4', name: '早关门点', city: '测试城', lng: 104.08, lat: 30.63, ticket: 0, stayMin: 90, open: [540, 1020], openText: '09:00-17:00' },
  ...Array.from({ length: 8 }, (_, i) => ({
    ...base,
    id: `a-x${i}`,
    name: `填充点${i}`,
    city: '测试城',
    lng: 104.1 + i * 0.01,
    lat: 30.6 + i * 0.005,
    ticket: 0,
    stayMin: 60,
  })),
];

setPlaces(places);

const demand = (over: Partial<Demand> = {}): Demand => ({
  destination: '测试城',
  dayCount: 1,
  party: 2,
  budgetLevel: 'mid',
  preferences: [],
  transport: 'public',
  notes: '',
  ...over,
});

const emptyPlan = (items: ItineraryItem[]): Plan => ({
  id: 'p',
  pace: 'balanced',
  paceLabel: '测试',
  transport: 'public',
  destination: '测试城',
  suitableFor: '测试',
  highlights: [],
  days: [{ index: 1, items }],
  budget: { items: [], total: 0, perPerson: 0, uncertain: [] },
  issues: [],
});

describe('预算按实际人数算', () => {
  it('人均 = 总额 / 实际人数，不用人数区间', () => {
    const days = generatePlans(demand())[0].days;
    const two = estimateBudget(demand({ party: 2 }), days);
    const eight = estimateBudget(demand({ party: 8 }), days);
    expect(two.perPerson).toBe(Math.round(two.total / 2));
    expect(eight.perPerson).toBe(Math.round(eight.total / 8));
  });

  it('8 人按 4 间房、8 份门票算，不会退化成 6 人口径', () => {
    const d8 = demand({ party: 8, dayCount: 2 });
    const budget = estimateBudget(d8, generatePlans(d8)[0].days);
    const lodging = budget.items.find((i) => i.category === 'lodging')!;
    const tickets = budget.items.find((i) => i.category === 'tickets')!;
    // 2 天 = 1 晚，8 人 / 2 人 1 间 = 4 间
    expect(lodging.amount).toBe(4 * 350);
    expect(tickets.basis).toContain('8 人');
  });

  it('每个分项都带证据等级，不允许裸数字', () => {
    const items = estimateBudget(demand(), generatePlans(demand())[0].days).items;
    expect(items.length).toBe(5);
    expect(items.every((i) => i.evidence === 'estimate' || i.evidence === 'price')).toBe(true);
  });
});

describe('校验按可信状态分级', () => {
  // 20:00 到站，早关门点 17:00 关门
  const lateItem: ItineraryItem = {
    id: 'x',
    kind: 'place',
    title: '早关门点',
    placeId: 'a-4',
    startMin: 20 * 60,
    endMin: 21 * 60,
    stayMin: 60,
    transportMin: 0,
    transportMode: 'public',
    cost: 0,
  };

  const withTrust = (trust: Place['trust']) => {
    setPlaces(places.map((p) => (p.id === 'a-4' ? { ...p, trust } : p)));
    return validatePlan(emptyPlan([lateItem]), demand());
  };

  it('官方核验过的营业时间冲突判 error', () => {
    const issues = withTrust('official');
    expect(issues.some((i) => i.code === 'closed-window' && i.level === 'error')).toBe(true);
  });

  it('待核实的营业时间最多判 warn，并写明要自行确认', () => {
    const issues = withTrust('pending');
    const hit = issues.find((i) => i.code === 'closed-window');
    expect(hit?.level).toBe('warn');
    expect(hit?.message).toContain('待核实');
    // 复位，避免影响后续用例
    setPlaces(places);
  });

  // 字段级依据（清单 §2.2）：行级 official 只是必要条件。
  // 三年前核过的营业时间，档位再高也不能拿来拦用户 —— 他按这句话改行程，走错了是我们造成的。
  //
  // 基谁是有讲究的：判行程用的是 `openingForDay` 算出的窗口，所以依据落在 `openWindow`，
  // 而不是 `openText` 原文。拿原文当基就会出现「核了一句话，却用另一份数字拦人」。
  const withEvidence = (validUntil?: string, window = '09:00-17:00') => {
    setPlaces(
      places.map((p) =>
        p.id === 'a-4'
          ? {
              ...p,
              trust: 'official' as const,
              fieldEvidence: [
                {
                  id: 'ev-engine-open',
                  field: 'openWindow',
                  value: window,
                  source: '景区公告',
                  verifiedAt: '2023-01-01',
                  ...(validUntil ? { validUntil } : {}),
                },
              ],
            }
          : p
      )
    );
    return validatePlan(emptyPlan([lateItem]), demand());
  };

  it('依据仍在有效期时，官方档位照常判 error', () => {
    const issues = withEvidence('2027-01-01');
    expect(issues.some((i) => i.code === 'closed-window' && i.level === 'error')).toBe(true);
    setPlaces(places);
  });

  it('依据已过期时降为 warn，并说明是依据过期而不是数据待核实', () => {
    const issues = withEvidence('2020-01-01');
    const hit = issues.find((i) => i.code === 'closed-window');
    expect(hit?.level).toBe('warn');
    // 两种 warn 的原因不能混：一个是「没人核过」，一个是「核过但过期了」
    expect(hit?.message).toContain('依据已过期');
    setPlaces(places);
  });

  it('依据核的是旧时段 → 不能再判 error', () => {
    // 依据说 09:00-17:00，当前窗口已经是 10:00-16:00：那条依据没核过当前这个窗口，不能拿它拦人
    const issues = withEvidence('2027-01-01', '10:00-16:00');
    const hit = issues.find((i) => i.code === 'closed-window');
    expect(hit?.level).toBe('warn');
    expect(hit?.message).toContain('不一致');
    setPlaces(places);
  });

  it('依据只核了原文、没核结构化时段 → 最多 warn', () => {
    // 典型漏洞：原文和依据都是 09:00-17:00，但 `open` 被改成 09:00-16:00。
    // 依据能证明「那句话」，证明不了行程实际用的是哪个窗口，所以不能判硬。
    setPlaces(
      places.map((p) =>
        p.id === 'a-4'
          ? {
              ...p,
              openText: '09:00-17:00',
              trust: 'official' as const,
              fieldEvidence: [
                { id: 'ev-text', field: 'openText', value: '09:00-17:00', source: '景区公告', verifiedAt: '2023-01-01' },
              ],
            }
          : p
      )
    );
    const hit = validatePlan(emptyPlan([lateItem]), demand()).find((i) => i.code === 'closed-window');
    expect(hit?.level).toBe('warn');
    setPlaces(places);
  });

  it('只有票价依据时，营业时间仍按待核实而不是「已过期」', () => {
    setPlaces(
      places.map((p) =>
        p.id === 'a-4'
          ? {
              ...p,
              trust: 'official' as const,
              fieldEvidence: [
                { id: 'ev-ticket', field: 'ticket', value: '0', source: '景区公告', verifiedAt: '2026-11-01' },
              ],
            }
          : p
      )
    );
    const hit = validatePlan(emptyPlan([lateItem]), demand()).find((i) => i.code === 'closed-window');
    expect(hit?.level).toBe('warn');
    expect(hit?.message).toContain('待核实');
    expect(hit?.message).not.toContain('过期');
    setPlaces(places);
  });
});

describe('单日局部修改的范围', () => {
  it('不含天数的指令只改当前正在看的那天', () => {
    const d = demand({ dayCount: 2 });
    const plan = generatePlans(d)[0];
    const before = plan.days.map((day) => day.items.map((i) => `${i.title}@${i.startMin}`).join('|'));
    const result = revisePlan(plan, d, '轻松一点', 2);
    expect('plan' in result).toBe(true);
    if (!('plan' in result)) return;
    const after = result.plan.days.map((day) => day.items.map((i) => `${i.title}@${i.startMin}`).join('|'));
    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
  });

  it('识别不了的指令不静默改动行程', () => {
    const d = demand({ dayCount: 2 });
    const plan = generatePlans(d)[0];
    const result = revisePlan(plan, d, '我想吃火锅', 1);
    expect('reason' in result).toBe(true);
  });

  it('点池被排满时说清是「收录不够」而不是「没有」', () => {
    const full = demand({ dayCount: 8 });
    const plan = generatePlans(full)[0];
    const used = new Set(plan.days.flatMap((day) => day.items.map((i) => i.placeId)).filter(Boolean));
    expect(used.size).toBe(places.length);
    const result = revisePlan(plan, full, '换个景点', 1);
    expect('reason' in result && result.reason).toContain('已全部排进');
  });
});

describe('修改提案：只认动作，数字由引擎算', () => {
  const trace = (p: Plan, day = 1) =>
    p.days
      .find((d) => d.index === day)!
      .items.map((i) => `${i.id}@${i.startMin}-${i.endMin}/${i.transportMin}`)
      .join('|');

  it('applyReviseOp 不修改传入的方案（确认前原计划不变）', () => {
    const d = demand({ dayCount: 2 });
    const plan = generatePlans(d)[0];
    const snapshot = JSON.stringify(plan);
    const target = plan.days[1].items.find((i) => i.kind === 'place')!;
    const result = applyReviseOp(plan, d, { op: 'drop', day: 2, targetId: target.id, reason: '少排一个' });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(plan)).toBe(snapshot);
  });

  it('删点后按新的前后站重算路上时间，才算得出真实省下的时间', () => {
    const d = demand({ dayCount: 2 });
    const plan = generatePlans(d)[0];
    const places = plan.days[1].items.filter((i) => i.kind === 'place');
    if (places.length < 2) return;
    const result = applyReviseOp(plan, d, { op: 'drop', day: 2, targetId: places[0].id, reason: '少排一个' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = result.preview.plan.days[1].items.filter((i) => i.kind === 'place');
    // 新的首个景点没有上一站，路上时间必须是 0，不能留着被删那站的旧值
    expect(after[0].transportMin).toBe(0);
    expect(result.preview.affected.some((a) => a.kind === 'removed')).toBe(true);
    expect(trace(result.preview.plan, 2)).not.toBe(trace(plan, 2));
  });

  it('这一天只剩一个景点时拒绝，并给出能读懂的原因', () => {
    const d = demand({ dayCount: 1 });
    const one: Plan = {
      ...generatePlans(d)[0],
      days: [
        {
          index: 1,
          items: [
            {
              id: 'only',
              kind: 'place',
              title: '一号点',
              placeId: 'a-1',
              startMin: 540,
              endMin: 630,
              stayMin: 90,
              transportMin: 0,
              transportMode: 'public',
              cost: 0,
            },
          ],
        },
      ],
    };
    const result = applyReviseOp(one, d, { op: 'drop', day: 1, targetId: 'only', reason: '少排一个' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('只剩一个景点');
  });

  it('替换到不存在的地点、或已经在行程里的地点都会被拒绝', () => {
    const d = demand({ dayCount: 1 });
    const plan = generatePlans(d)[0];
    const target = plan.days[0].items.find((i) => i.kind === 'place')!;
    const missing = applyReviseOp(plan, d, {
      op: 'replace',
      day: 1,
      targetId: target.id,
      withPlaceId: '不存在的地点',
      reason: '换个地方',
    });
    expect(missing.ok).toBe(false);

    const same = plan.days[0].items.filter((i) => i.kind === 'place')[1];
    if (!same?.placeId) return;
    const dup = applyReviseOp(plan, d, {
      op: 'replace',
      day: 1,
      targetId: target.id,
      withPlaceId: same.placeId,
      reason: '换成已经在行程里的点',
    });
    expect(dup.ok).toBe(false);
  });

  it('换序只认这一天已有的 id，没提到的保持原有相对次序', () => {
    const d = demand({ dayCount: 1 });
    const plan = generatePlans(d)[0];
    const ids = plan.days[0].items.filter((i) => i.kind === 'place').map((i) => i.id);
    if (ids.length < 3) return;
    const result = applyReviseOp(plan, d, {
      op: 'reorder',
      day: 1,
      // 只给两个 id，且夹一个不存在的：应当被忽略，剩下的按原次序跟在后面
      order: [ids[1], 'not-an-id', ids[0]],
      reason: '先远后近',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = result.preview.plan.days[0].items.filter((i) => i.kind === 'place').map((i) => i.id);
    expect(after.slice(0, 2)).toEqual([ids[1], ids[0]]);
    expect(after.slice(2)).toEqual(ids.slice(2));
  });

  it('未知票价不参与省钱比较，也不会被当成免费', () => {
    const d = demand({ dayCount: 1 });
    const plan = generatePlans(d)[0];
    const tuned: Plan = {
      ...plan,
      days: plan.days.map((day) => ({
        index: day.index,
        items: day.items.map((i) => (i.kind === 'place' ? { ...i, cost: null } : i)),
      })),
    };
    const guess = keywordReviseOp(tuned, d, '省点钱', 1);
    // 全部票价未核实 = 没有任何「最贵」可挑，不能凭 null 选出替换目标
    expect(guess === null || 'unsupported' in guess).toBe(true);
  });

  it('本地兜底与主路径给出同一种改动（换谁解析不影响结果）', () => {
    const d = demand({ dayCount: 2 });
    const plan = generatePlans(d)[0];
    const guess = keywordReviseOp(plan, d, '第二天轻松一点', 1);
    expect(guess && 'op' in guess && guess.op).toBe('drop');
    if (!guess || !('op' in guess)) return;
    const viaEngine = applyReviseOp(plan, d, guess, 'engine');
    const viaModel = applyReviseOp(plan, d, guess, 'model');
    expect(viaEngine.ok && viaModel.ok).toBe(true);
    if (!viaEngine.ok || !viaModel.ok) return;
    expect(trace(viaEngine.preview.plan, 2)).toBe(trace(viaModel.preview.plan, 2));
    expect(viaEngine.preview.impact).toEqual(viaModel.preview.impact);
    expect(viaEngine.preview.by).toBe('engine');
  });
});

describe('地点池不够时不硬凑行程', () => {
  it('天数超过收录地点数直接报错，不生成半空行程', () => {
    expect(() => generatePlans(demand({ dayCount: 20 }))).toThrow(/排不下/);
  });

  it('没接入的城市明确说不支持', () => {
    expect(() => generatePlans(demand({ destination: '不存在城' }))).toThrow(/暂未接入/);
  });
});

describe('避坑过期口径（A2）', () => {
  const fact = (over: Partial<TravelFact>): TravelFact => ({
    id: 'f',
    city: '测试城',
    category: '交通与路线',
    content: 'x',
    scope: '测试城 · 一号点',
    source: '官方',
    verifiedAt: '2026-01-01',
    trust: 'official',
    ...over,
  });

  it('过期条目被分出去而不是丢掉，条数可数', () => {
    const { fresh, expired } = splitByFreshness(
      [fact({ id: 'a', validUntil: '2026-01-01' }), fact({ id: 'b', validUntil: '2099-01-01' }), fact({ id: 'c' })],
      new Date('2026-06-01')
    );
    expect(fresh.map((f) => f.id)).toEqual(['b', 'c']);
    expect(expired.map((f) => f.id)).toEqual(['a']);
  });

  it('没有有效期就无法判过期，保持可见', () => {
    expect(isExpired(fact({ validUntil: undefined }), new Date('2099-01-01'))).toBe(false);
  });
});

describe('路线耗时是估算，不是导航结果', () => {
  it('直线折算有下限，同一点也不会出现 0 分钟', () => {
    expect(travelMinutes(places[0], places[0])).toBeGreaterThanOrEqual(10);
  });
});

describe('真实路线耗时优先，取不到的如实退回估算', () => {
  it('灌入路线耗时后这一段用真实值，不再是直线折算', () => {
    clearRouteMinutes();
    const straight = travelMinutes(places[0], places[1]);
    setRouteMinutes(places[0].id, places[1].id, false, 47);
    expect(travelMinutes(places[0], places[1])).toBe(47);
    expect(travelMinutes(places[0], places[1])).not.toBe(straight);
    clearRouteMinutes();
  });

  it('hasRoute 按 faster 档隔离：驾车取到的值不能冒充步行', () => {
    clearRouteMinutes();
    expect(hasRoute(places[0], places[1], false)).toBe(false);
    setRouteMinutes(places[0].id, places[1].id, false, 30);
    expect(hasRoute(places[0], places[1], false)).toBe(true);
    expect(hasRoute(places[0], places[1], true)).toBe(false);
    clearRouteMinutes();
  });

  it('首站没有路段，路上耗时记 0，不凭空给 20 分钟', () => {
    clearRouteMinutes();
    const [plan] = generatePlans(demand({ dayCount: 1 }));
    const first = plan.days[0].items.find((i) => i.kind === 'place');
    expect(first?.transportMin).toBe(0);
    // 没有路段就没有来源，不能标成 route 也不能标成 straight
    expect(first?.transportSource).toBeUndefined();
  });

  it('没取到真实耗时的路段必须标成 straight，不能冒充导航结果', () => {
    clearRouteMinutes();
    const [plan] = generatePlans(demand({ dayCount: 1 }));
    const legs = plan.days[0].items.filter((i) => i.kind === 'place' && i.transportMin > 0);
    expect(legs.length).toBeGreaterThan(0);
    expect(legs.every((i) => i.transportSource === 'straight')).toBe(true);
  });
});

describe('只对真正用到的相邻段取真实耗时', () => {
  const byId = new Map(places.map((p) => [p.id, p]));
  // 用点数最多的那套（packed）才有 3 段以上：relaxed 每天只 2 个点，段数太少，
  // 正确实现和「两两组合」的错误实现会得到同样的数字，测不出差别。
  const dense = () => { const ps = generatePlans(demand({ dayCount: 1, transport: 'car' })); return ps[ps.length - 1]; };

  it('一天 4 个点只产生 3 段，不会炸成两两组合的 6 段', () => {
    const plan = dense();
    const stops = plan.days[0].items.filter((i) => i.kind === 'place');
    const legs = legsOf([plan], byId);
    expect(stops.length).toBe(4);
    expect(legs.length).toBe(3);
    expect(legs.length).not.toBe((stops.length * (stops.length - 1)) / 2);
  });

  it('段只能由相邻站点构成：间隔 >1 的组合一律不许出现', () => {
    const plan = dense();
    const order = plan.days[0].items.filter((i) => i.kind === 'place').map((i) => i.placeId!);
    for (const [a, b] of legsOf([plan], byId)) {
      expect(order.indexOf(b.id) - order.indexOf(a.id)).toBe(1);
    }
  });

  it('三套方案共用同一段时只算一次，不重复请求', () => {
    const plans = generatePlans(demand({ dayCount: 1, transport: 'car' }));
    const legs = legsOf(plans, byId);
    const keys = legs.map(([a, b]) => `${a.id}>${b.id}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('跨天不算一段：两天各算各的', () => {
    const plans = generatePlans(demand({ dayCount: 2, transport: 'car' }));
    const plan = plans[plans.length - 1];
    const expected = plan.days.reduce(
      (s, d) => s + Math.max(0, d.items.filter((i) => i.kind === 'place').length - 1),
      0,
    );
    expect(legsOf([plan], byId).length).toBe(expected);
  });
});

// R4：演示班次是构造值（首末班、票价都是编的），trust 却写着 official。
// 拿它判硬错误，等于让假数据拦住真行程。
describe('演示班次不参与硬约束（R4）', () => {
  const line = (over: Partial<TransitLine>): TransitLine => ({
    id: 'l',
    city: '重庆',
    name: '演示线',
    mode: 'cableway',
    stops: [
      { name: 'A', lng: 106.5, lat: 29.5, placeId: 'a' },
      { name: 'B', lng: 106.6, lat: 29.6, placeId: 'b' },
    ],
    rideAtPlaceId: 'a',
    firstBus: 450,
    lastBus: 1020,
    intervalMin: 15,
    tickets: [{ kind: '单程', price: 20 }],
    needAdvance: null,
    capacity: null,
    rideMin: 4,
    source: '构造值',
    trust: 'official',
    ...over,
  });

  it('isDemo 为真时即使 official 也不判硬', () => {
    expect(canJudgeLineHard(line({ isDemo: true }), 'lastBus')).toBe(false);
    // 未标 isDemo 的 official 仍可判硬，别把整条路堵死
    expect(canJudgeLineHard(line({ isDemo: false }), 'lastBus')).toBe(true);
  });

  it('首末班各用各的依据：末班依据有效不能顺手证明首班', () => {
    // 末班重核过、首班依据已过期 —— 以前只看末班，首班会被过期依据硬拦
    const l = line({
      fieldEvidence: [
        { id: 'ev-last', field: 'lastBus', value: '1020', source: '公告 A', verifiedAt: '2026-11-01', validUntil: '2027-01-01' },
        { id: 'ev-first', field: 'firstBus', value: '450', source: '公告 B', verifiedAt: '2020-01-01', validUntil: '2021-01-01' },
      ],
    });
    expect(canJudgeLineHard(l, 'lastBus')).toBe(true);
    expect(canJudgeLineHard(l, 'firstBus')).toBe(false);
  });

  it('依据核的末班与当前末班不同时不算核验过', () => {
    const l = line({
      fieldEvidence: [
        { id: 'ev-last', field: 'lastBus', value: '17:00', source: '公告', verifiedAt: '2026-11-01' },
      ],
    });
    // 17:00 = 1020，与当前末班一致
    expect(canJudgeLineHard(l, 'lastBus')).toBe(true);
    expect(canJudgeLineHard(line({ ...l, lastBus: 1080 }), 'lastBus')).toBe(false);
  });

  it('同段有真实线路时，演示班次不排前面', () => {
    const demo = line({ id: 'demo', isDemo: true, rideAtPlaceId: 'b' });
    // 真实那条首末班全空，靠 trust 也赢不了 demo 的 30 分，必须靠 isDemo 沉底
    const real = line({ id: 'real', trust: 'pending', firstBus: null, lastBus: null, isDemo: false, rideAtPlaceId: 'b' });
    setLines([demo, real]);
    const items: ItineraryItem[] = [
      { kind: 'place', title: 'A', placeId: 'a', startMin: 600, endMin: 660, cost: null, stayMin: 60, transportMin: 0 },
      { kind: 'place', title: 'B', placeId: 'b', startMin: 670, endMin: 700, cost: null, stayMin: 30, transportMin: 10 },
    ] as ItineraryItem[];
    expect(lineSegmentFor(items, 1)?.line.id).toBe('real');
  });
});

// G2：客户端不注入线路时，validate 里「末班之后没车」永远拿不到 lineById 的结果，
// 表单生成会静默跳过这一类校验，只有对话路径会报。注入同一份数据后两端才一致。
describe('线路注入决定班次校验是否发生（G2）', () => {
  const item: ItineraryItem = {
    id: 'g2-item',
    kind: 'place',
    title: '坐索道',
    placeId: 'a-4',
    startMin: 23 * 60,
    endMin: 23 * 60 + 30,
    stayMin: 30,
    transportMin: 0,
    transportMode: 'public',
    cost: 0,
    lineId: 'g2-line',
  }

  const officialLine: TransitLine = {
    id: 'g2-line',
    city: '测试城',
    name: '测试索道',
    mode: 'cableway',
    stops: [
      { name: 'A', lng: 106.5, lat: 29.5, placeId: 'a-1' },
      { name: 'B', lng: 106.6, lat: 29.6, placeId: 'a-2' },
    ],
    firstBus: 480,
    lastBus: 1020,
    intervalMin: 15,
    tickets: [{ kind: '单程', price: 20 }],
    needAdvance: null,
    capacity: null,
    rideMin: 5,
    rideAtPlaceId: 'a-1',
    source: '测试数据',
    trust: 'official',
  }

  it('未注入线路：这条段没有班次问题（校验被静默跳过）', () => {
    setLines([])
    const issues = validatePlan(emptyPlan([item]), demand())
    expect(issues.some((i) => i.code === 'after-lastbus' || i.code === 'no-lastbus')).toBe(false)
  })

  it('注入官方线路后：晚于末班判 error', () => {
    setLines([officialLine])
    const issues = validatePlan(emptyPlan([item]), demand())
    expect(issues.find((i) => i.code === 'after-lastbus')?.level).toBe('error')
    // 复位，避免影响后续用例
    setLines([])
  })

  // 首末班各有各的依据：末班刚重核过，不能顺手把过期三年的首班也当成已核验。
  it('末班依据有效、首班依据过期时，首班只提示不硬拦', () => {
    const early: ItineraryItem = { ...item, startMin: 6 * 60, endMin: 6 * 60 + 30 }
    setLines([
      {
        ...officialLine,
        fieldEvidence: [
          { id: 'ev-last', field: 'lastBus', value: '1020', source: '公告 A', verifiedAt: '2026-11-01', validUntil: '2027-01-01' },
          { id: 'ev-first', field: 'firstBus', value: '480', source: '公告 B', verifiedAt: '2020-01-01', validUntil: '2021-01-01' },
        ],
      },
    ])
    const issues = validatePlan(emptyPlan([early]), demand())
    expect(issues.find((i) => i.code === 'before-firstbus')?.level).toBe('warn')
    setLines([])
  })

  it('首班依据有效时照常判 error', () => {
    const early: ItineraryItem = { ...item, startMin: 6 * 60, endMin: 6 * 60 + 30 }
    setLines([
      {
        ...officialLine,
        fieldEvidence: [
          { id: 'ev-first', field: 'firstBus', value: '08:00', source: '公告', verifiedAt: '2026-11-01', validUntil: '2027-01-01' },
        ],
      },
    ])
    const issues = validatePlan(emptyPlan([early]), demand())
    expect(issues.find((i) => i.code === 'before-firstbus')?.level).toBe('error')
    setLines([])
  })
})

// G3：「有 N 个景点票价未核实」这条告知以前会被住宿假设挤掉——界面只渲染
// uncertain[0]，而住宿永远排在前面。顺序是引擎定的，所以这里钉住这条契约：
// 两条都得在数组里，展示层才有东西可全量渲染。
describe('未核实项不能被挤掉（G3）', () => {
  it('同时有住宿与未核实票价时，两条都在 uncertain 里', () => {
    const days = generatePlans(demand({ dayCount: 2 }))[0].days
    // 把第一个景点票价置空，模拟「查不到票价」
    const patched = days.map((d) => ({
      ...d,
      items: d.items.map((i, idx) => (i.kind === 'place' && idx === 0 ? { ...i, cost: null } : i)),
    }))
    const budget = estimateBudget(demand({ dayCount: 2 }), patched)
    expect(budget.uncertain.some((u) => u.includes('住宿'))).toBe(true)
    expect(budget.uncertain.some((u) => u.includes('票价未核实'))).toBe(true)
  })
})

// N10：表单主链路的模型提案只决定「去哪儿、先哪个」，不许碰时刻与钱。
// 所以这条契约钉在两件事上：模型给的顺序被采纳；模型给错 id 时点一个不少。
describe('模型提案只改顺序，不改点数（N10）', () => {
  const firstDayIds = (plans: Plan[]) => plans[0].days[0].items.filter((i) => i.kind === 'place').map((i) => i.placeId)

  it('给出的顺序排在最前，其余点仍按就近接在后面', () => {
    const plain = generatePlans(demand({ dayCount: 1 }))[0]
    const ids = plain.days.flatMap((d) => d.items.map((i) => i.placeId)).filter(Boolean) as string[]
    const target = ids[ids.length - 1]
    const ordered = generatePlans(demand({ dayCount: 1 }), { order: [target] })[0]
    expect(firstDayIds([ordered])[0]).toBe(target)
  })

  it('模型编造的 id 不认，行程点数与没给顺序时一致', () => {
    const plain = generatePlans(demand({ dayCount: 1 }))[0]
    const faked = generatePlans(demand({ dayCount: 1 }), { order: ['编造-1', '编造-2'] })[0]
    const count = (p: Plan) => p.days.reduce((s, d) => s + d.items.filter((i) => i.kind === 'place').length, 0)
    expect(count(faked)).toBe(count(plain))
  })

  it('给空数组时完全退化成就近排序', () => {
    const a = generatePlans(demand({ dayCount: 1 }), { order: [] })[0]
    const b = generatePlans(demand({ dayCount: 1 }))[0]
    expect(firstDayIds([a])).toEqual(firstDayIds([b]))
  })
})

// N4：时段粒度。「第二天下午轻松点」以前恒删当天最后一个景点——
// 下午的安排原封不动，反而把晚上那个删了，用户一眼就能看出改错了地方。
describe('定向修改只动指定时段（N4）', () => {
  it('关键词里的时段被认出来，产出 ease 而不是整天 drop', () => {
    const plan = generatePlans(demand({ dayCount: 2 }))[0]
    const guess = keywordReviseOp(plan, demand({ dayCount: 2 }), '第二天下午轻松点')
    expect(guess && 'op' in guess ? guess.op : null).toBe('ease')
    expect(guess && 'window' in guess ? guess.window : null).toBe('afternoon')
  })

  it('没写时段时仍按整天 drop，不退化成忽略指令', () => {
    const plan = generatePlans(demand({ dayCount: 2 }))[0]
    const guess = keywordReviseOp(plan, demand({ dayCount: 2 }), '第二天轻松点')
    expect(guess && 'op' in guess ? guess.op : null).toBe('drop')
  })

  it('ease 只删该时段的景点，其他时段与其他天的安排一字不改', () => {
    const plan = generatePlans(demand({ dayCount: 2 }))[0]
    // 拿第一天第一个景点的实际时段来测：固定写 'afternoon' 会随排点规则变化而空转
    const first = plan.days[0].items.find((i) => i.kind === 'place')!
    const window = windowOf(first.startMin)
    const apply = applyReviseOp(plan, demand({ dayCount: 2 }), {
      op: 'ease',
      day: 1,
      window,
      reason: '测试',
    })
    expect(apply.ok).toBe(true)
    if (!apply.ok) return
    const before = plan.days[0].items.map((i) => i.id)
    const after = apply.preview.plan.days[0].items.map((i) => i.id)
    // 只少了 1 条
    expect(before.length - after.length).toBe(1)
    // 第 2 天完全没动
    expect(apply.preview.plan.days[1].items.map((i) => i.id)).toEqual(plan.days[1].items.map((i) => i.id))
  })

  /**
   * N4 的原话是「只有第 2 天下午的安排变化」。
   *
   * 上一版只做到「只删该时段」，时刻仍整天顺延：说「上午轻松点」，下午和晚上的安排
   * 会被整体前移十几分钟到一小时 —— 用户眼里就是「我只说了上午，怎么全变了」。
   * 现在 ease 把时段外的条目冻在原时刻。
   */
  it('ease 之后，时段外的安排一秒不差', () => {
    const d = demand({ dayCount: 2 })
    const base = generatePlans(d)[2]
    const day = base.days[1]
    const win = windowOf(day.items.find((i) => i.kind === 'place')!.startMin)
    const apply = applyReviseOp(base, d, { op: 'ease', day: 2, window: win, reason: '测试' })
    expect(apply.ok).toBe(true)
    if (!apply.ok) return
    for (const item of apply.preview.plan.days[1].items) {
      const before = day.items.find((i) => i.id === item.id)
      if (!before || windowOf(before.startMin) === win) continue
      // 报了变化就说明它挪了，而它不该挪
      expect(`${item.title}@${item.startMin}`).toBe(`${before.title}@${before.startMin}`)
    }
  })

  /**
   * 压缩不能跨时段。
   *
   * 删掉下午一站之后，晚上那条 19:00 的夜游若被顺延重排，会算到下午 14:50 —
   * 用户的指令是「下午轻松点」，看到的却是「晚上那站没了」。
   * 这里手工造一条晚上安排，因为种子数据里没有排到 18:00 之后的点。
   */
  it('压缩该时段时，后面的安排不会被拖进上一个时段', () => {
    const d = demand({ dayCount: 2 })
    const base = generatePlans(d)[2]
    const evening: ItineraryItem = {
      id: 'evening-1',
      kind: 'place',
      title: '夜景点',
      placeId: base.days[1].items.find((i) => i.kind === 'place')!.placeId!,
      startMin: 19 * 60,
      endMin: 20 * 60,
      stayMin: 60,
      transportMin: 30,
      transportMode: 'public',
      cost: 40,
    }
    const plan: Plan = {
      ...base,
      days: [base.days[0], { index: 2, items: [...base.days[1].items, evening] }],
    }
    const apply = applyReviseOp(plan, d, { op: 'ease', day: 2, window: 'afternoon', reason: '测试' })
    expect(apply.ok).toBe(true)
    if (!apply.ok) return
    const after = apply.preview.plan.days[1].items.find((i) => i.id === evening.id)
    expect(after).toBeDefined()
    expect(windowOf(after!.startMin)).toBe('evening')
    // 早上 / 中午的安排也不该被反向挪动
    for (const item of apply.preview.plan.days[1].items) {
      const was = plan.days[1].items.find((i) => i.id === item.id)
      if (was && windowOf(was.startMin) === 'morning') expect(windowOf(item.startMin)).toBe('morning')
    }
  })
})

// N3：固定安排是约束，不是提示。删掉它必须让用户自己动手。
describe('固定安排不被静默改掉（N3）', () => {
  const withPin = (p: Plan, id: string) => {
    const next = structuredClone(p) as Plan
    for (const d of next.days) for (const i of d.items) if (i.id === id) i.pinned = true
    return next
  }

  it('drop 指向固定项时拒绝执行并说明原因', () => {
    const plan = generatePlans(demand({ dayCount: 1 }))[0]
    // 必须挑景点：餐食走的是另一条前置分支（「只能精简景点」），测不到固定项
    const target = [...plan.days[0].items].reverse().find((i) => i.kind === 'place')!
    const pinned = withPin(plan, target.id)
    const r = applyReviseOp(pinned, demand({ dayCount: 1 }), {
      op: 'drop',
      day: 1,
      targetId: target.id,
      reason: '测试',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('固定')
  })

  it('关键词兜底跳过固定项，不把最后一个固定项当成可删对象', () => {
    const plan = generatePlans(demand({ dayCount: 1 }))[0]
    const placesInDay = plan.days[0].items.filter((i) => i.kind === 'place')
    const pinned = withPin(plan, placesInDay[placesInDay.length - 1].id)
    const guess = keywordReviseOp(pinned, demand({ dayCount: 1 }), '轻松点')
    // 挑到的必须不是被固定的那一个
    expect(guess && 'targetId' in guess ? guess.targetId : null).not.toBe(placesInDay[placesInDay.length - 1].id)
  })

  /**
   * 换序过去会把固定项一起挪走：pinned 只拦了 drop / replace 两条分支，
   * reorder 走的是另一条路，用户定过的安排换个顺序就变了位次。
   */
  it('reorder 不让固定项换位，并在原因里说清没挪', () => {
    const d = demand({ dayCount: 1 })
    const plan = generatePlans(d)[2]
    const placesInDay = plan.days[0].items.filter((i) => i.kind === 'place')
    // 固定中间那个，然后要求把它排到第一位
    const pinnedItem = placesInDay[1]
    const pinned = withPin(plan, pinnedItem.id)
    const order = [pinnedItem.id, ...placesInDay.filter((i) => i.id !== pinnedItem.id).map((i) => i.id)]
    const r = applyReviseOp(pinned, d, { op: 'reorder', day: 1, order, reason: '换个顺序' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const after = r.preview.plan.days[0].items.filter((i) => i.kind === 'place')
    // 位次不变：固定项仍在原来的下标上
    expect(after.findIndex((i) => i.id === pinnedItem.id)).toBe(1)
    // 「没挪」必须说出来，不能静默照做一半
    expect(r.preview.reason).toContain('已固定')
  })
})

/**
 * 日期接上之后的闭馆判断（N3）。
 *
 * 这条链路的价值在于：日期填了、行程排上了、点又恰好周一闭馆 —— 三者同时成立时
 * 用户能不能在出发前看到提示。三缺一就不该判，否则提示会变成噪音。
 */
describe('闭馆判断只在三件事同时成立时报警（N3 日期）', () => {
  // 夹具城市是合成数据，闭馆标记也要在这里造：真数据里的故宫不参与这一组
  const museum: Place = {
    ...base,
    id: 'closed-mon',
    name: '周一闭馆点',
    city: '测试城',
    lng: 104.3,
    lat: 30.7,
    ticket: 0,
    stayMin: 120,
    closedWeekdays: [1],
  };
  const item: ItineraryItem = {
    id: 'closed-1',
    kind: 'place',
    title: museum.name,
    placeId: museum.id,
    startMin: 9 * 60,
    endMin: 11 * 60,
    stayMin: 120,
    transportMin: 0,
    transportMode: 'public',
    cost: 0,
  };
  const planWith = (): Plan => {
    setPlaces([museum]);
    return {
      ...generatePlans(demand({ dayCount: 1 }))[0],
      days: [{ index: 1, items: [item] }],
    };
  };

  it('日期未知时不判：凭空提示闭馆和凭空说开门一样糟', () => {
    const plan = planWith();
    const issues = validatePlan(plan, demand({ dayCount: 1 }));
    expect(issues.some((i) => i.code === 'closed-weekday')).toBe(false);
    setPlaces(places);
  });

  it('日期落在周一且排到了闭馆点时报 error，并给出换天 / 换点两条出路', () => {
    const plan = planWith();
    // 2026-12-07 是周一
    const issues = validatePlan(plan, demand({ dayCount: 1, dateFrom: '2026-12-07' }));
    const hit = issues.find((i) => i.code === 'closed-weekday');
    expect(hit?.level).toBe('error');
    expect(hit?.message).toContain('周一');
    expect(hit?.alternatives?.length).toBeGreaterThanOrEqual(2);
    setPlaces(places);
  });

  it('同一行程换到周二就不报', () => {
    const plan = planWith();
    const issues = validatePlan(plan, demand({ dayCount: 1, dateFrom: '2026-12-08' }));
    expect(issues.some((i) => i.code === 'closed-weekday')).toBe(false);
    setPlaces(places);
  });
});

describe('设备定位点也能命中真实路段（F03 回程）', () => {
  it('用坐标灌入的路线耗时能被回程段命中', () => {
    clearRouteMinutes();
    const here = { lng: 104.05, lat: 30.62 };
    setRouteMinutes('a-3', here, false, 37);
    // 按坐标查同一个点：量化到 5 位小数，同一个坐标必须命中
    expect(travelMinutes(placeById('a-3')!, here, false)).toBe(37);
    expect(hasRoute(placeById('a-3')!, here, false)).toBe(true);
    clearRouteMinutes();
  });

  it('没有 id 的点之间不会共用一条「undefined」键', () => {
    clearRouteMinutes();
    setRouteMinutes({ lng: 104.0, lat: 30.0 }, { lng: 104.1, lat: 30.1 }, false, 42);
    // 另一对完全不同的坐标不该读到上面那条
    expect(hasRoute({ lng: 104.3, lat: 30.3 }, { lng: 104.4, lat: 30.4 }, false)).toBe(false);
    expect(travelMinutes({ lng: 104.0, lat: 30.0 }, { lng: 104.1, lat: 30.1 }, false)).toBe(42);
    clearRouteMinutes();
  });
});

// P0-1 的前提：服务端补录生效后会重新 setPlaces / setLines。
// 这里钉住「重新装入是整体替换」——如果它其实是合并，那被删掉的地点会永远留在索引里，
// 光靠「下次重新装载」根本不够，得再加一个显式的清空入口。
describe('重新装载地点池是整体替换', () => {
  it('重新 setPlaces 后，没在新列表里的地点查不到', () => {
    const snapshot = placesOf('测试城')
    try {
      const first = snapshot[0]
      setPlaces([{ ...first, id: 'only-1', name: '唯一' }])
      expect(placeById(first.id)).toBeUndefined()
      expect(placeById('only-1')?.name).toBe('唯一')
    } finally {
      // 别的用例共用这份池，必须还原
      setPlaces(snapshot)
    }
  })
})
