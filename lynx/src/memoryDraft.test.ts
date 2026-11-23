import { describe, expect, it } from '@rstest/core';

/**
 * 回忆草稿（N8）。
 *
 * 这一组的价值全在「不该写什么」上：草稿把 unknown 写成亲历、或者替用户生成一句
 * 「下午很惬意」，页面不会报错、分享页也不会崩，但用户从此分不清哪些话是他自己写的。
 * 所以每个用例都从一个「多写了东西」的失败态反着断言。
 */
import { buildMemoryDraft } from './memoryDraft.js';
import type { Demand, Plan, PlaceNote, TripMemory } from './data.js';
import type { ItineraryItem } from '../../shared/types/index.js';

const demand = (): Demand => ({
  destination: '成都',
  dayCount: 2,
  party: 2,
  budgetLevel: 'mid',
  preferences: [],
  transport: 'public',
  notes: ''
});

const item = (id: string, title: string, kind: 'place' | 'meal' = 'place'): ItineraryItem => ({
  id,
  kind,
  title,
  placeId: kind === 'meal' ? undefined : `p-${id}`,
  startMin: 540,
  endMin: 600,
  stayMin: 60,
  transportMin: 0,
  transportMode: 'public',
  cost: null
});

const plan = (days: { index: number; items: ItineraryItem[] }[]): Plan => ({
  id: 'plan-1',
  pace: 'balanced',
  paceLabel: '松弛',
  transport: 'public',
  destination: '成都',
  suitableFor: '',
  highlights: [],
  days,
  budget: { items: [], total: 0, perPerson: 0, uncertain: [] },
  issues: []
});

const note = (planRef: string, patch: Partial<PlaceNote>): PlaceNote => ({
  planRef,
  dayIndex: 1,
  placeId: `p-${planRef}`,
  placeTitle: planRef,
  visited: 'unknown',
  text: '',
  photos: [],
  updatedAt: '2026-11-01T00:00:00.000Z',
  ...patch
});

const memory = (places: Record<string, PlaceNote>): TripMemory => ({
  tripId: 't1',
  overview: '',
  photos: [],
  places,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z'
});

describe('回忆草稿只重排用户写过的东西', () => {
  it('明确去了的写成亲历，并原样带上用户写的字', () => {
    const out = buildMemoryDraft(
      { demand: demand(), plans: [plan([{ index: 1, items: [item('a', '熊猫基地')] }])], planIndex: 0 },
      memory({ a: note('a', { visited: 'yes', text: '早上人少，值得' }) })
    );
    expect(out).toContain('熊猫基地（去了）：早上人少，值得');
  });

  it('明确否认的写成没去，不能从草稿里悄悄消失', () => {
    const out = buildMemoryDraft(
      { demand: demand(), plans: [plan([{ index: 1, items: [item('a', '都江堰')] }])], planIndex: 0 },
      memory({ a: note('a', { visited: 'no' }) })
    );
    // 用户否认过去过；草稿里连名字都不出现的话，他会以为系统记错了
    expect(out).toContain('都江堰（没去）');
  });

  it('写了字但没点去没去的，标未确认到访，不冒充亲历', () => {
    const out = buildMemoryDraft(
      { demand: demand(), plans: [plan([{ index: 1, items: [item('a', '锦里')] }])], planIndex: 0 },
      memory({ a: note('a', { visited: 'unknown', text: '人太多' }) })
    );
    expect(out).toContain('锦里（未确认到访）：人太多');
    expect(out).not.toContain('去了');
  });

  it('一点记录都没有的地点只进待补清单，不为它生成任何句子', () => {
    const out = buildMemoryDraft(
      {
        demand: demand(),
        plans: [plan([{ index: 1, items: [item('a', '熊猫基地'), item('b', '宽窄巷子')] }])],
        planIndex: 0
      },
      // 只给 a 写记录，b 一个字没有
      memory({ a: note('a', { visited: 'yes' }) })
    );
    expect(out).toContain('还没记：宽窄巷子');
    // 关键：b 不能出现在 Day 块里被描述成经历过
    const dayBlock = out.split('还没记')[0] ?? '';
    expect(dayBlock).not.toContain('宽窄巷子');
  });

  it('全都没记录时只给待补清单，绝不编一句总结', () => {
    const out = buildMemoryDraft(
      { demand: demand(), plans: [plan([{ index: 1, items: [item('a', '熊猫基地')] }])], planIndex: 0 },
      memory({})
    );
    expect(out).toBe('还没记：熊猫基地');
  });

  it('餐食条目不算地点，不追问「午餐去没去」', () => {
    const out = buildMemoryDraft(
      {
        demand: demand(),
        plans: [plan([{ index: 1, items: [item('a', '熊猫基地'), item('m', '午餐', 'meal')] }])],
        planIndex: 0
      },
      memory({ a: note('a', { visited: 'yes' }) })
    );
    expect(out).not.toContain('午餐');
  });

  it('没有方案时返回空串，交给页面邀请补充', () => {
    expect(buildMemoryDraft({ demand: demand(), plans: [], planIndex: 0 }, memory({}))).toBe('');
  });

  it('planIndex 越界时钳到最后一套，不因为下标错整份草稿为空', () => {
    const out = buildMemoryDraft(
      {
        demand: demand(),
        plans: [
          plan([]),
          plan([{ index: 2, items: [item('a', '青城山')] }])
        ],
        planIndex: 9
      },
      memory({ a: note('a', { visited: 'yes' }) })
    );
    expect(out).toContain('青城山（去了）');
  });

  it('按天分块，不同天的安排不混在一起', () => {
    const out = buildMemoryDraft(
      {
        demand: demand(),
        plans: [
          plan([
            { index: 1, items: [item('a', '熊猫基地')] },
            { index: 2, items: [item('b', '青城山')] }
          ])
        ],
        planIndex: 0
      },
      memory({ a: note('a', { visited: 'yes' }), b: note('b', { visited: 'yes' }) })
    );
    expect(out.indexOf('Day 1')).toBeLessThan(out.indexOf('Day 2'));
    expect(out.split('\n')).toContain('Day 2');
  });
});
