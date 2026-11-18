import { beforeEach, describe, expect, it } from '@rstest/core';

/**
 * 同步状态（R6）的可观测性。
 *
 * 直接测 syncStatus.ts 而不是 sync.ts：sync.ts 依赖 api.ts，
 * 而 api.ts 的 `<T>(path)` 泛型箭头会被 rstest 当成 JSX。
 */
import { onSyncStateChange, setSyncState, syncState } from './syncStatus.js';

describe('云端同步状态可观测（R6）', () => {
  beforeEach(() => setSyncState('idle'));

  it('冷启动是 idle，不是 failed', () => {
    // 没有任何推送发生过，界面不能一进来就说同步失败
    expect(syncState()).toBe('idle');
  });

  it('变化会通知订阅者，同值不重复通知', () => {
    const seen: string[] = [];
    const off = onSyncStateChange((s) => seen.push(s));

    setSyncState('pending');
    setSyncState('pending'); // 重复值不该再通知一次
    setSyncState('failed');

    expect(seen).toEqual(['pending', 'failed']);
    expect(syncState()).toBe('failed');
    off();

    // 退订之后不再收到
    setSyncState('idle');
    expect(seen).toEqual(['pending', 'failed']);
  });
});
