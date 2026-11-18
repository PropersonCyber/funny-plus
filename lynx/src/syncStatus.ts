/**
 * 云端同步状态（R6）。
 *
 * 单独立一个文件而不是放在 sync.ts 里：sync.ts 依赖 api.ts，而 api.ts 的
 * `<T>(path)` 泛型箭头会让 rstest 当成 JSX 解析失败，测试就进不来。
 *
 * 这里只做「让失败可见」一件事：不重试、不抛错、不弹窗。
 * 本机已经存好了，把好消息变成打扰是得不偿失的。
 */
export type SyncState = 'idle' | 'pending' | 'failed';

let state: SyncState = 'idle';
const listeners = new Set<(s: SyncState) => void>();

export const syncState = (): SyncState => state;

/** 订阅状态变化；返回取消订阅 */
export function onSyncStateChange(fn: (s: SyncState) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function setSyncState(next: SyncState): void {
  if (state === next) return;
  state = next;
  for (const fn of listeners) fn(next);
}
