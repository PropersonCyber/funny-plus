import { describe, expect, it } from '@rstest/core';

import { makeCls } from './cls.js';

describe('makeCls', () => {
  const cls = makeCls({ card: 'index-module__card', 'chip-on': 'index-module__chip-on' });

  it('本模块的类走哈希映射', () => {
    expect(cls('card')).toBe('index-module__card');
  });

  it('base.scss 的共享类原样透出', () => {
    expect(cls('page card')).toBe('page index-module__card');
  });

  it('连续空格和首尾空格不产生空类名', () => {
    expect(cls('  card   chip-on ')).toBe('index-module__card index-module__chip-on');
  });

  it('空串返回空串，不返回一个空格', () => {
    expect(cls('')).toBe('');
  });
});
