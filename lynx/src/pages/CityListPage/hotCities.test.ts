import { describe, expect, it } from '@rstest/core';
import { HOT_CITIES, filterCities } from './hotCities.js';

const base = { category: 'all' as const, maxDays: 0, crowd: 'all' as const, month: 0 };

describe('热门城市筛选', () => {
  it('默认全量 8 个', () => {
    expect(filterCities(HOT_CITIES, base).length).toBe(8);
  });

  it('自然风光只留山区湖泊城市', () => {
    const r = filterCities(HOT_CITIES, { ...base, category: 'nature' });
    expect(r.map((c) => c.id)).toEqual(['杭州', '大理', '丽江', '张家界']);
  });

  it('历史类不含纯自然城市', () => {
    const r = filterCities(HOT_CITIES, { ...base, category: 'history' });
    expect(r.map((c) => c.id)).toEqual(['北京', '杭州', '丽江', '西安']);
  });

  it('2天内只留 minDays<=2 的', () => {
    const r = filterCities(HOT_CITIES, { ...base, maxDays: 2 });
    expect(r.map((c) => c.id)).toEqual(['成都', '重庆', '杭州', '西安']);
  });

  it('4天以上只留 minDays>=4 的（当前数据应为空）', () => {
    expect(filterCities(HOT_CITIES, { ...base, maxDays: 4 }).length).toBe(0);
  });

  it('带娃家庭筛出亲子友好城市', () => {
    const r = filterCities(HOT_CITIES, { ...base, crowd: 'family' });
    expect(r.map((c) => c.id)).toEqual(['成都', '北京', '杭州', '西安']);
  });

  it('冬季只留含 12/1/2 月的城市', () => {
    const r = filterCities(HOT_CITIES, { ...base, month: 12 });
    expect(r.length).toBe(0);
  });

  it('多条件同时收窄', () => {
    const r = filterCities(HOT_CITIES, { category: 'history', maxDays: 0, crowd: 'family', month: 9 });
    expect(r.map((c) => c.id)).toEqual(['北京', '杭州', '西安']);
  });
});
