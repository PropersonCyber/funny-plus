import { beforeEach, describe, expect, it } from '@rstest/core';

/**
 * 避坑数据来源（G4）。
 *
 * 只测 factsData（不碰 api.ts）。真正打网络的 loadFacts 不在这里跑：
 * 它的价值在「失败时不动现有数据」，而那一层逻辑就是 adoptServerFacts 的入参校验。
 */
import { adoptServerFacts, facts, factsSource, factsStamp, resetFacts } from './factsData.js';
import type { TravelFact } from '../../shared/types/index.js';

const fact = (id: string): TravelFact => ({
  id,
  city: '成都',
  category: '预约与门票',
  content: '测试',
  scope: '全城',
  source: '测试',
  verifiedAt: '2026-11-01',
  trust: 'official'
});

describe('避坑数据来源（G4）', () => {
  beforeEach(() => resetFacts());

  it('默认用随包快照，且时点文案明说是兜底', () => {
    expect(factsSource()).toBe('bundled');
    // 关键：不能让用户以为手里这份是刚核验的
    expect(factsStamp()).toContain('随包快照');
  });

  it('采纳服务端数据后，来源与时点都变成服务端', () => {
    expect(adoptServerFacts([fact('f1'), fact('f2')])).toBe(true);
    expect(factsSource()).toBe('server');
    expect(facts().length).toBe(2);
    expect(factsStamp()).toContain('服务端');
  })

  it('空数组当作无效：不能把用户手里的兜底副本清空', () => {
    expect(adoptServerFacts([])).toBe(false);
    expect(factsSource()).toBe('bundled');
    expect(facts().length).toBeGreaterThan(0);
  })
})
