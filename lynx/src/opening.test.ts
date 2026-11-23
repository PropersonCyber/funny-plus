import { describe, expect, it } from '@rstest/core';
import { openingOf } from '../../shared/engine/opening.js';
import type { Place } from '../../shared/types/index.js';

/**
 * 季节营业时段（N3 日期之后）。
 *
 * 失败形态同样是「不报错、但把错的时间告诉用户」：夏天故宫 17:00 关，
 * 拿全年最保守那档（16:00）判，会把一份实际排得下的行程报成冲突；
 * 反过来冬天按夏天判，用户 16:30 到门口发现进不去。
 */

const place = (over: Partial<Place> = {}): Place => ({
  id: 'p',
  name: '测试点',
  city: '测试城',
  lng: 104,
  lat: 30,
  // 全年最保守交集：夏天 17:00 关、冬天 16:30 停检 → 取最早那个
  open: [510, 960],
  ticket: 0,
  stayMin: 60,
  walk: 1,
  tags: [],
  rating: 4.5,
  visitors: 10,
  source: '测试',
  trust: 'official',
  ...over,
});

const gugong = place({
  seasons: [
    { from: '04-01', to: '10-31', open: [510, 1020], text: '旺季 08:30-17:00' },
    { from: '11-01', to: '03-31', open: [510, 990], text: '淡季 08:30-16:30' },
  ],
});

describe('有日期且有时段表时按季节取档', () => {
  it('夏天取旺季那档', () => {
    const r = openingOf(gugong, '2026-07-15');
    expect(r.open).toEqual([510, 1020]);
    expect(r.bySeason).toBe(true);
    expect(r.note).toContain('旺季');
  });

  it('冬天取淡季那档', () => {
    expect(openingOf(gugong, '2026-12-15').open).toEqual([510, 990]);
  });

  it('跨年区间也能命中：1 月落在 11-01 至 03-31 里', () => {
    expect(openingOf(gugong, '2026-01-20').open).toEqual([510, 990]);
  });

  it('区间边界当天算在内', () => {
    expect(openingOf(gugong, '2026-04-01').open).toEqual([510, 1020]);
    expect(openingOf(gugong, '2026-03-31').open).toEqual([510, 990]);
  });
});

describe('不该按季节判的时候一律退回最保守那档', () => {
  it('日期未知时不挑一档更宽松的 —— 冬天看到夏天的关门时间是最糟的错', () => {
    const r = openingOf(gugong, undefined);
    expect(r.open).toEqual([510, 960]);
    expect(r.bySeason).toBe(false);
  });

  it('没有时段表的地点用 open，并标清不是当季时段', () => {
    const r = openingOf(place(), '2026-07-15');
    expect(r.open).toEqual([510, 960]);
    expect(r.bySeason).toBe(false);
    expect(r.note).toBeUndefined();
  });

  it('日期落在所有档之外时退回 open，不拿相邻档顶替', () => {
    const only = place({ seasons: [{ from: '07-01', to: '08-31', open: [540, 1080] }] });
    const r = openingOf(only, '2026-01-15');
    expect(r.open).toEqual([510, 960]);
    expect(r.bySeason).toBe(false);
  });

  it('日期格式不对时不做季节判断', () => {
    expect(openingOf(gugong, '2026-13-45').bySeason).toBe(false);
    expect(openingOf(gugong, '2026-13-45').open).toEqual([510, 960]);
  });
});
