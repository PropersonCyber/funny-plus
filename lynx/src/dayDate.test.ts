import { describe, expect, it } from '@rstest/core';
import { closureOf, dayDateOf, dateRangeLabel, weekdayOf, withinMmDd } from '../../shared/engine/dayDate.js';
import type { Demand } from '@/types';

/**
 * 闭馆判断（N3 日期之后的必然下一步）。
 *
 * 这一组的失败形态是最糟的那种：不是报错，而是「今天闭馆」被静默说成「今天开放」，
 * 用户到了门口才发现。所以每个用例都从「什么时候**不该**判闭馆」那一侧反着断言。
 */

const demand = (patch: Partial<Demand> = {}): Demand => ({
  destination: '北京',
  dayCount: 2,
  party: 2,
  budgetLevel: 'mid',
  preferences: [],
  transport: 'public',
  notes: '',
  ...patch,
});

describe('日期推算', () => {
  it('第 1 天就是出发日，第 2 天是次日', () => {
    const d = demand({ dateFrom: '2026-12-05', dayCount: 3 });
    expect(dayDateOf(d, 1)).toBe('2026-12-05');
    expect(dayDateOf(d, 2)).toBe('2026-12-06');
  });

  it('跨月与跨年都要算对，不能只加"日"那一位', () => {
    expect(dayDateOf(demand({ dateFrom: '2026-12-31' }), 2)).toBe('2027-01-01');
    expect(dayDateOf(demand({ dateFrom: '2028-02-28' }), 2)).toBe('2028-02-29');
  });

  it('日期未填时返回 undefined，绝不拿今天充数', () => {
    expect(dayDateOf(demand(), 1)).toBeUndefined();
    expect(weekdayOf('2026-13-45')).toBeNull();
  });

  it('2026-12-05 是周六', () => {
    expect(weekdayOf('2026-12-05')).toBe(6);
  });
});

describe('日期区间文案', () => {
  it('没填日期时说「日期未定」，不留空也不写具体日子', () => {
    expect(dateRangeLabel(demand())).toBe('日期未定');
  });

  it('填了就写真实区间', () => {
    expect(dateRangeLabel(demand({ dateFrom: '2026-12-05', dayCount: 2 }))).toBe('12月5日 - 12月6日');
  });

  it('单日行程不写成 5 日 - 5 日', () => {
    expect(dateRangeLabel(demand({ dateFrom: '2026-12-05', dayCount: 1 }))).toBe('12月5日');
  });
});

describe('闭馆判定只在能确定时给出结论', () => {
  const museum = { closedWeekdays: [1] }; // 周一闭馆

  it('周一闭馆、排到周一时判闭馆', () => {
    // 2026-12-07 是周一
    const r = closureOf(museum, '2026-12-07');
    expect(r.closed).toBe(true);
    expect(r.note).toContain('周一');
  });

  it('排到周二时不判闭馆', () => {
    expect(closureOf(museum, '2026-12-08').closed).toBe(false);
  });

  it('日期未知时一律不判：凭空提示闭馆和凭空说开门一样糟', () => {
    expect(closureOf(museum, undefined).closed).toBe(false);
  });

  it('没有结构化闭馆数据时不判，哪怕 openText 里写了「周一闭馆」', () => {
    // 「没核过」和「每天都开」是两件事，这里只能选择不判
    expect(closureOf({}, '2026-12-07').closed).toBe(false);
  });

  it('整段闭馆区间也能判，含跨年', () => {
    const p = { closedRanges: [{ from: '12-20', to: '01-10', note: '冬季维护' }] };
    expect(closureOf(p, '2026-12-25').closed).toBe(true);
    expect(closureOf(p, '2027-01-05').closed).toBe(true);
    expect(closureOf(p, '2027-02-01').closed).toBe(false);
  });
});

describe('MM-DD 区间比较', () => {
  it('不跨年时按字面比较', () => {
    expect(withinMmDd('03-15', '03-01', '03-31')).toBe(true);
    expect(withinMmDd('04-01', '03-01', '03-31')).toBe(false);
  });

  it('跨年区间要被年界线切成两段，不能靠字符串比较', () => {
    // '12-25' <= '01-10' 为 false，字面比较会漏掉整个冬天
    expect(withinMmDd('12-25', '12-20', '01-10')).toBe(true);
    expect(withinMmDd('01-05', '12-20', '01-10')).toBe(true);
    expect(withinMmDd('06-01', '12-20', '01-10')).toBe(false);
  });
});
