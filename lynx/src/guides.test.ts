import { beforeEach, describe, expect, it } from '@rstest/core';

/**
 * 攻略草稿 id 的稳定性（X4）。
 *
 * book 的键是 tripId，但草稿自己有 id（gd-xxx）。`loadGuides` 曾经用键当 id 恢复，
 * 于是重启后 `draft.id === tripId`：推送换了个云端 id，云端多出一份草稿，
 * 而旧分享链接再也撤不回来 —— 撤回是 `DELETE /api/guides/:id` 按 draftId 找行的。
 *
 * 这类 bug 不会报错、不会白屏，只会在「重启后再撤回」这一步静默走错，
 * 所以必须在这里钉住。
 */
import { loadGuides, saveGuides } from './storage.js';
import type { GuideBook } from './storage.js';
import type { GuideDraft } from './data.js';

const draft = (id: string, tripId: string): GuideDraft => ({
  id,
  tripId,
  title: '重庆 2 天：我的走法',
  summary: '',
  photos: [],
  showCost: false,
  picked: {},
  sections: [],
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z'
});

beforeEach(() => {
  // 每个用例用自己的 tripId，避免上一条用例写进内存的那份干扰断言
  saveGuides({});
});

describe('草稿 id 跨重启稳定', () => {
  it('存进去是 gd-xxx，读回来还是 gd-xxx，不是 tripId', () => {
    const book: GuideBook = { 'x4-trip-a': draft('gd-aaa', 'x4-trip-a') };
    // 不断言返回值：persist 在测试环境没有可用后端，会回 false，但内存里已经写进去了
    saveGuides(book);
    const back = loadGuides()['x4-trip-a'];
    expect(back?.id).toBe('gd-aaa');
    expect(back?.tripId).toBe('x4-trip-a');
  });

  it('同一趟旅程重新生成的草稿 id 各自保留，不都退化成 tripId', () => {
    // 两次生成的 id 不同；都退化成 tripId 的话云端只剩一份
    saveGuides({ 'x4-trip-b': draft('gd-bbb', 'x4-trip-b') });
    expect(loadGuides()['x4-trip-b']?.id).toBe('gd-bbb');
  });

  it('老存档里 id 缺失时退回用 book 的键，不让整条草稿读不出来', () => {
    const legacy = { tripId: 'x4-trip-c', title: '老存档' };
    saveGuides({ 'x4-trip-c': legacy as unknown as GuideDraft });
    expect(loadGuides()['x4-trip-c']?.id).toBe('x4-trip-c');
  });

  it('草稿内容跟着 id 一起回来，不会因为改读 id 而丢字段', () => {
    const book: GuideBook = { 'x4-trip-d': draft('gd-ddd', 'x4-trip-d') };
    book['x4-trip-d']!.title = '改过的标题';
    saveGuides(book);
    const back = loadGuides()['x4-trip-d'];
    expect(back?.id).toBe('gd-ddd');
    expect(back?.title).toBe('改过的标题');
  });
});