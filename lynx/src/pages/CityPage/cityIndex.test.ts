import { describe, expect, it } from '@rstest/core';

import { CITY_IMG } from '../../assets/city-covers.js';
import {
  ALL_CITIES,
  HOT_COVERS,
  HOT_IDS,
  REGIONS,
  countByRegion,
  groupByLetter,
  indexLetters,
  matchCities,
  type CityEntry,
} from './cityIndex.js';

const city = (id: string, letter: string, region: CityEntry['region'] = 'southwest', cover = 'chengdu'): CityEntry => ({
  id,
  letter,
  region,
  cover,
});

describe('城市索引', () => {
  it('热门城市都有封面图，目录里用到的封面 key 也必须能解析', () => {
    for (const id of HOT_IDS) expect(CITY_IMG[HOT_COVERS[id]]).toBeTruthy();
    for (const c of ALL_CITIES) expect(CITY_IMG[c.cover]).toBeTruthy();
  });

  it('城市索引里的地区都在 REGIONS 里', () => {
    const keys = REGIONS.map((r) => r.key);
    for (const c of ALL_CITIES) expect(keys).toContain(c.region);
  });

  it('目录按设计稿的地区数量铺开，名字不重复', () => {
    expect(new Set(ALL_CITIES.map((c) => c.id)).size).toBe(ALL_CITIES.length);
    const rows = countByRegion(ALL_CITIES);
    const count = (key: string) => rows.find((r) => r.region.key === key)?.count;
    expect(count('north')).toBe(11);
    expect(count('east')).toBe(26);
    expect(count('south')).toBe(16);
    expect(count('central')).toBe(16);
    expect(count('southwest')).toBe(21);
    expect(count('northwest')).toBe(12);
    expect(count('northeast')).toBe(10);
    expect(count('hmt')).toBe(3);
  });

  it('A、B 两组的前排顺序和设计稿首屏一致', () => {
    const groups = groupByLetter(ALL_CITIES);
    const ids = (letter: string) => groups.find((g) => g.letter === letter)?.cities.map((c) => c.id);
    expect(ids('A')?.slice(0, 9)).toEqual(['阿坝', '阿克苏', '阿勒泰', '阿拉善', '安康', '安庆', '安阳', '鞍山', '安顺']);
    expect(ids('B')).toEqual(['北京', '保定', '包头', '巴中', '北海', '白山', '滨州', '亳州', '毕节']);
  });

  it('按首字母分组：字母升序，组内保持数据顺序', () => {
    const groups = groupByLetter([city('重庆', 'C'), city('成都', 'C'), city('北京', 'B')]);
    expect(groups.map((g) => g.letter)).toEqual(['B', 'C']);
    expect(groups[1].cities.map((c) => c.id)).toEqual(['重庆', '成都']);
  });

  it('没有城市的字母仍在索引里，但不可点', () => {
    const groups = groupByLetter([city('北京', 'B')]);
    expect(groups).toHaveLength(1);
    const index = indexLetters(groups);
    expect(index).toHaveLength(26);
    expect(index.find((item) => item.letter === 'B')?.enabled).toBe(true);
    expect(index.find((item) => item.letter === 'A')?.enabled).toBe(false);
  });

  it('空列表不崩', () => {
    expect(groupByLetter([])).toEqual([]);
    expect(indexLetters([]).every((item) => !item.enabled)).toBe(true);
  });

  it('地区数量按真实数据算，没有城市的地区是 0', () => {
    const rows = countByRegion([city('北京', 'B', 'north'), city('成都', 'C', 'southwest')]);
    expect(rows).toHaveLength(REGIONS.length);
    expect(rows.find((r) => r.region.key === 'north')?.count).toBe(1);
    expect(rows.find((r) => r.region.key === 'southwest')?.count).toBe(1);
    expect(rows.find((r) => r.region.key === 'hmt')?.count).toBe(0);
  });

  it('搜索：包含即命中，忽略首尾空格，空关键词返回全量', () => {
    const list = [city('成都', 'C'), city('重庆', 'C'), city('北京', 'B')];
    expect(matchCities(list, '成')).toHaveLength(1);
    expect(matchCities(list, '  成  ')).toHaveLength(1);
    expect(matchCities(list, '')).toHaveLength(3);
    expect(matchCities(list, '三亚')).toHaveLength(0);
  });
});
