import { describe, expect, it } from '@rstest/core';

import { cityKey, locationLabel } from './locationLabel.js';

describe('定位展示文案', () => {
  it('带不带「市」都收成同一个字符串，首页和城市页不会各写各的', () => {
    expect(locationLabel('成都')).toBe('成都市');
    expect(locationLabel('成都市')).toBe('成都市');
    expect(locationLabel('成都')).toBe(locationLabel('成都市'));
    expect(locationLabel('北京市')).toBe('北京市');
  });

  it('香港、澳门不再加「市」', () => {
    expect(locationLabel('香港')).toBe('香港');
    expect(locationLabel('澳门')).toBe('澳门');
  });

  it('点选用短名，才能对上城市索引里的「成都」', () => {
    expect(cityKey('成都市')).toBe('成都');
    expect(cityKey('北京市')).toBe('北京');
    expect(cityKey('香港')).toBe('香港');
  });
});
