import { describe, expect, it } from '@rstest/core';

/**
 * 合并规则（G5）。
 *
 * 只测规则本身，不测 IO：syncMerge 是纯函数，sync.ts 里的 pullCloud 只是把它取回来的
 * 数据喂进来。规则错了，界面上的表现是「换设备后数据莫名变少或变旧」，
 * 而这类问题在真机上很难复现，所以必须在这里钉住。
 */
import { mergeGuides, mergeMemories, mergeTrips, summarizePull } from './syncMerge.js';
import type { RemoteMemory } from './syncMerge.js';
import type { GuideDraft, TripMemory } from './data.js';
import type { SavedTrip } from './storage.js';

// 合并只看 id 与 savedAt，其余字段给个最小占位就行：真字段在这里没有行为差异
const trip = (id: string, savedAt: string): SavedTrip =>
  ({ id, savedAt, demand: {}, plans: [], planIndex: 0, versions: [] }) as unknown as SavedTrip;

const memory = (tripId: string, updatedAt: string, overview = tripId): RemoteMemory => {
  const payload = {
    tripId,
    overview,
    photos: [],
    places: {},
    createdAt: updatedAt,
    updatedAt
  } as unknown as TripMemory;
  return { tripId, payload, updatedAt };
};

const draft = (tripId: string, updatedAt: string, title = tripId): GuideDraft =>
  ({
    id: `draft-${tripId}`,
    tripId,
    title,
    summary: '',
    photos: [],
    showCost: false,
    picked: {},
    sections: [],
    createdAt: updatedAt,
    updatedAt
  }) as unknown as GuideDraft;

describe('mergeTrips', () => {
  it('两边并集：本机独有的留下，云端独有的补进来', () => {
    const out = mergeTrips([trip('a', '2026-11-01T00:00:00Z')], [trip('b', '2026-11-02T00:00:00Z')]);
    expect(out.map((t) => t.id).sort()).toEqual(['a', 'b']);
  });

  it('同 id 取 savedAt 较新的那份', () => {
    const newer = trip('a', '2026-11-05T00:00:00Z');
    expect(mergeTrips([trip('a', '2026-11-01T00:00:00Z')], [newer])[0]?.savedAt).toBe(newer.savedAt);
    const older = trip('a', '2026-10-01T00:00:00Z');
    expect(mergeTrips([trip('a', '2026-11-01T00:00:00Z')], [older])[0]?.savedAt).toBe('2026-11-01T00:00:00Z');
  });

  it('时间完全相同保留本机那份，不让用户刚看到的内容闪一下变样', () => {
    const local = trip('a', '2026-11-01T00:00:00Z');
    const remote = { ...trip('a', '2026-11-01T00:00:00Z'), planIndex: 2 };
    expect(mergeTrips([local], [remote])[0]).toBe(local);
  });

  it('云端为空时原样返回本机', () => {
    const local = [trip('a', '2026-11-01T00:00:00Z'), trip('b', '2026-11-02T00:00:00Z')];
    expect(mergeTrips(local, [])).toEqual(local);
  });
});

describe('mergeMemories', () => {
  it('按 updatedAt 取较新的一份', () => {
    const out = mergeMemories({}, [
      memory('t1', '2026-11-01T00:00:00Z', '旧'),
      memory('t2', '2026-11-02T00:00:00Z')
    ]);
    expect(Object.keys(out).sort()).toEqual(['t1', 't2']);
    expect((out.t1 as TripMemory).overview).toBe('旧');
  });

  it('本机那份更新时不被云端旧的盖掉', () => {
    const local = { t1: memory('t1', '2026-11-05T00:00:00Z', '本机写的').payload };
    const out = mergeMemories(local, [memory('t1', '2026-11-01T00:00:00Z', '云端旧的')]);
    expect((out.t1 as TripMemory).overview).toBe('本机写的');
  });

  it('不改动传进来的本机对象', () => {
    const local = {};
    mergeMemories(local, [memory('t1', '2026-11-01T00:00:00Z')]);
    expect(Object.keys(local).length).toBe(0);
  });
});

describe('mergeGuides', () => {
  it('按 tripId 作键合并，不按草稿自己的 id', () => {
    // 同一趟旅程两份草稿 id 不同：合并后只该有一份，否则用户得自己决定发哪个
    const remote = [{ tripId: 't1', payload: draft('t1', '2026-11-02T00:00:00Z') }];
    const out = mergeGuides({ t1: draft('t1', '2026-11-01T00:00:00Z') }, remote);
    expect(Object.keys(out)).toEqual(['t1']);
    expect(out.t1?.updatedAt).toBe('2026-11-02T00:00:00Z');
  });

  it('本机更新时保留本机', () => {
    const out = mergeGuides({ t1: draft('t1', '2026-11-05T00:00:00Z', '本机') }, [
      { tripId: 't1', payload: draft('t1', '2026-11-01T00:00:00Z', '云端') }
    ]);
    expect(out.t1?.title).toBe('本机');
  });

  it('remote 没给 tripId 时退回 payload 里的', () => {
    const out = mergeGuides({}, [{ tripId: '', payload: draft('t9', '2026-11-01T00:00:00Z') }]);
    expect(out.t9?.updatedAt).toBe('2026-11-01T00:00:00Z');
  });
});

describe('summarizePull', () => {
  it('只报增量，且不会返回负数', () => {
    expect(summarizePull({ trips: 2, memories: 1, guides: 0 }, { trips: 5, memories: 1, guides: 3 })).toEqual({
      trips: 3,
      memories: 0,
      guides: 3
    });
    expect(summarizePull({ trips: 5, memories: 0, guides: 0 }, { trips: 2, memories: 0, guides: 0 })).toEqual({
      trips: 0,
      memories: 0,
      guides: 0
    });
  });
});