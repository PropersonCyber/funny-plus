import { api } from './api.js';
import { planFor } from './data.js';
import { trackJourney, trackSessionId } from './track.js';
import type { Demand, Plan } from '../../shared/types/index.js';

/**
 * 表单主链路的方案取数（N10）。
 *
 * 主路径问服务端要「模型提案 + 引擎裁决」的结果；服务端不可用、超时、模型没配、
 * 返回的形状不对 —— 一律落回本地 `planFor`，产出与今天完全一致。
 *
 * 为什么降级要这么彻底：表单是产品的唯一主干道，模型是加分项不是前提。
 * 只要有一处「服务端挂了就生成不了」，整个 App 在弱网下就等于不能用。
 */

export type PlansResult = {
  plans: Plan[];
  /**
   * model = 模型挑了走法并过了引擎；engine = 确定性引擎。
   * 界面必须把这两个分开说 —— 让人以为模型规划了、其实是本地兜底，
   * 是最容易让人误判产品能力的谎。
   */
  by: 'model' | 'engine';
  /**
   * 这批方案是谁算的。与 by 正交：服务端也可能返回 engine。
   * 服务端的 engine 已经套过两遗路段预热，客户端不能再预热一次（多一圈请求 + 时刻反而变）。
   */
  source: 'server' | 'local';
  /** 模型为什么这么排；engine 时为空 */
  reason: string;
};

/**
 * 服务端这一路给的时间比普通接口短。
 *
 * 用户点「生成方案」后盯着过渡卡，等 8 秒再落回本地等于白等 ——
 * 服务端这条路上还套了一次模型调用，超了就直接让本地引擎接手。
 */
const SERVER_TIMEOUT_HINT = 6000;

const isPlanList = (v: unknown): v is Plan[] =>
  Array.isArray(v) && v.length > 0 && v.every((p) => !!p && typeof p === 'object' && Array.isArray((p as Plan).days));

/** 本地引擎：任何异常都往上抛，由调用方决定怎么跟用户说（与改动前行为一致） */
export function plansLocally(demand: Demand): PlansResult {
  return { plans: planFor(demand), by: 'engine', source: 'local', reason: '' };
}

export async function fetchPlans(demand: Demand): Promise<PlansResult> {
  try {
    const res = await Promise.race([
      api.post<{ plans?: unknown; by?: unknown; reason?: unknown }>('/api/ai/plans', {
        demand,
        sessionId: trackSessionId(),
        journey: trackJourney(),
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), SERVER_TIMEOUT_HINT)),
    ]);
    if (!res || !isPlanList(res.plans)) return plansLocally(demand);
    return {
      plans: res.plans,
      by: res.by === 'model' ? 'model' : 'engine',
      source: 'server',
      reason: typeof res.reason === 'string' ? res.reason : '',
    };
  } catch {
    // 断网 / 后端没起 / 接口 4xx5xx：都走本地。不能把网络错误抛给用户，
    // 表单这条路本地算得出来，抛错只会让用户以为「今天用不了」。
    return plansLocally(demand);
  }
}
