import { beforeEach, describe, expect, it } from '@rstest/core';

/**
 * 避坑数据来源（G4）。
 *
 * 只测 factsData（不碰 api.ts）。真正打网络的 loadFacts 不在这里跑：
 * 它的价值在「失败时不动现有数据」，而那一层逻辑就是 adoptServerFacts 的入参校验。
 */
import { adoptServerFacts, facts, factsSource, factsStamp, resetFacts } from './factsData.js';
import { displayTrust, originNote } from '../../shared/engine/facts.js';
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

describe('随包快照不能说成已核验', () => {
  beforeEach(() => resetFacts());

  /**
   * 造一条 trust 仍是 official 的随包快照。
   * 这是真实情形：库里把某条降档之后，打进包里的旧副本还写着 official，
   * 客户端在接口回来之前会先渲染它。
   */
  const snapshot = (): TravelFact => facts()[0]!;

  it('随包快照把 official 降一档，服务端来的照原样显示', () => {
    const f = snapshot();
    expect(f.origin).toBe('bundled');
    expect(displayTrust(f)).toBe('credible');
    expect(displayTrust({ trust: 'official', origin: 'server' })).toBe('official');
    // 缺省 origin 视为 canonical：接口与库里的行不带这个字段
    expect(displayTrust({ trust: 'official' })).toBe('official');
  });

  it('来路要能一句话说清，且只在非权威来源时提示', () => {
    expect(originNote(snapshot())).toContain('随包快照');
    expect(originNote({ origin: 'canonical' })).toBe('');
  });

  it('采纳服务端数据后不再按快照降档', () => {
    adoptServerFacts([{ ...fact('f9'), trust: 'official' }]);
    expect(facts()[0]!.origin).toBe('server');
    expect(displayTrust(facts()[0]!)).toBe('official');
  });
})
