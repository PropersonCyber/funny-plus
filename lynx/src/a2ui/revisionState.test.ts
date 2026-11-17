import { describe, expect, it } from '@rstest/core';

import { DEFAULT_DEMAND, planFor } from '../data.js';
import type { Plan } from '../data.js';
import {
  beginPreview,
  cancelPreview,
  confirmPreview,
  isStale,
  previewIdOf,
  type RevisionBase,
} from './revisionState.js';

/**
 * 基准 = 行程身份 + 方案序号 + plan 对象引用。
 * 用真实 Plan 造，不用假对象：假类型会让「引用比较」的语义看起来成立实际不成立。
 */
const planRef = planFor(DEFAULT_DEMAND)[0] as Plan;

const base = (): RevisionBase => ({
  tripId: 'trip-1',
  planIndex: 0,
  planRef,
});

describe('预览状态机', () => {
  it('每次生成都有自己的 previewId，初始为 pending', () => {
    const a = beginPreview(base());
    const b = beginPreview(base());
    expect(a.previewId).not.toBe(b.previewId);
    expect(a.status).toBe('pending');
    expect(previewIdOf(a)).toBe(a.previewId);
  });

  it('确认上锁：同一预览重复确认只有第一次真的应用', () => {
    const preview = beginPreview(base());
    // 基准复用同一个对象：planRef 换引用会被判过期，那是另一个用例
    const current = base();
    let applied = 0;

    const first = confirmPreview(preview, current, () => {
      applied += 1;
    });
    const second = confirmPreview(first, current, () => {
      applied += 1;
    });
    const third = confirmPreview(second, current, () => {
      applied += 1;
    });

    expect(applied).toBe(1);
    expect(first.status).toBe('applied');
    expect(second.status).toBe('applied');
    expect(third.status).toBe('applied');
  });

  it('已取消的预览不能再确认，且不触发应用', () => {
    const preview = beginPreview(base());
    let applied = 0;

    const cancelled = cancelPreview(preview);
    const after = confirmPreview(cancelled, base(), () => {
      applied += 1;
    });

    expect(applied).toBe(0);
    expect(cancelled.status).toBe('cancelled');
    expect(after.status).toBe('cancelled');
  });

  it('行程身份变了判过期，不覆盖较新行程', () => {
    const preview = beginPreview(base());
    const current = base();
    let applied = 0;

    const next = confirmPreview(preview, { ...current, tripId: 'trip-2' }, () => {
      applied += 1;
    });

    expect(applied).toBe(0);
    expect(next.status).toBe('stale');
  });

  it('方案序号变了判过期', () => {
    const preview = beginPreview(base());
    const current = base();
    const next = confirmPreview(preview, { ...current, planIndex: 1 }, () => {});
    expect(next.status).toBe('stale');
  });

  it('plan 对象引用换了就判过期 —— 覆盖 pickPlan / changeCity 这类不写 versions 的入口', () => {
    const preview = beginPreview(base());
    const current = base();
    // 重算一次：内容可能一样，但引用是新的，旧预览不能盖上去
    const recomputed = planFor(DEFAULT_DEMAND)[0] as Plan;
    const next = confirmPreview(preview, { ...current, planRef: recomputed }, () => {});
    expect(next.status).toBe('stale');
  });

  it('基准不变时 isStale 为 false，变了为 true', () => {
    const current = base();
    const preview = beginPreview(current);
    expect(isStale(preview, current)).toBe(false);
    expect(isStale(preview, { ...current, tripId: 'trip-9' })).toBe(true);
  });

  it('过期后不再接受确认', () => {
    const preview = beginPreview(base());
    const current = base();
    let applied = 0;

    const stale = confirmPreview(preview, { ...current, tripId: 'trip-2' }, () => {
      applied += 1;
    });
    const again = confirmPreview(stale, current, () => {
      applied += 1;
    });

    expect(applied).toBe(0);
    expect(again.status).toBe('stale');
  });
});