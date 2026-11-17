import type { Plan } from '../data.js';

/**
 * 行程修改预览的状态机与防重。
 *
 * 为什么要把状态从页面里抽出来：预览的「能不能点」由三件事共同决定 ——
 * 这份预览当初基于哪份行程、现在行程还是不是那份、这一份是不是已经点过了。
 * 三项判断和 UI 无关，抽成纯函数才能测，也才能让 A2UI 卡片和旧卡片共用同一入口
 * （spec FR-4：降级不得绕过防重与过期约束）。
 */

/**
 * 预览的基准。
 *
 * 为什么不用 versions.length 当版本号：pickPlan 与 changeCity 只换 plan、不写 versions，
 * 拿版本条数比会漏判，旧预览就会盖掉用户刚切的方案。
 * 这里用 plan 的对象引用 —— useTrips 的 6 个修改入口都产出新的 store 或新的 plan 对象，
 * 引用比较能覆盖全部入口。
 */
export type RevisionBase = {
  tripId: string;
  planIndex: number;
  planRef: Plan;
};

export type PreviewStatus = 'pending' | 'applied' | 'cancelled' | 'stale';

export type RevisionState = {
  previewId: string;
  baseline: RevisionBase;
  status: PreviewStatus;
};

let seq = 0;

/** 预览身份：同一次对话里可能有多次预览，动作只认这个 id，不认轮次下标 */
function nextPreviewId(): string {
  seq += 1;
  return `rev-${Date.now().toString(36)}-${seq}`;
}

export function beginPreview(baseline: RevisionBase): RevisionState {
  return { previewId: nextPreviewId(), baseline, status: 'pending' };
}

export function previewIdOf(state: RevisionState): string {
  return state.previewId;
}

/** 基准三项任一变化即过期：行程换了、方案序号换了、plan 对象换了都算 */
export function isStale(state: RevisionState, current: RevisionBase): boolean {
  const base = state.baseline;
  return (
    base.tripId !== current.tripId ||
    base.planIndex !== current.planIndex ||
    base.planRef !== current.planRef
  );
}

/**
 * 确认。只有 pending 且基准未变才真的调用 apply，返回新状态。
 *
 * 上锁与判断在这里一次性做完，调用方不需要自己维护「是不是已经点过」——
 * 状态机返回的 status 就是唯一判据。
 */
export function confirmPreview(
  state: RevisionState,
  current: RevisionBase,
  apply: () => void
): RevisionState {
  if (state.status !== 'pending') return state;
  if (isStale(state, current)) return { ...state, status: 'stale' };
  apply();
  return { ...state, status: 'applied' };
}

/** 取消 = 这一份作废，卡片随之移除；原行程从未被改过 */
export function cancelPreview(state: RevisionState): RevisionState {
  if (state.status !== 'pending') return state;
  return { ...state, status: 'cancelled' };
}
