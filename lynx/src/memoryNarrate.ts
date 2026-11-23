import { api } from './api.js';
import { trackJourney, trackSessionId } from './track.js';
import { buildMemoryDraft } from '../../shared/engine/memoryDraft.js';
import type { Demand, Plan, TripMemory } from '../../shared/types/index.js';

/**
 * 回忆叙述取数（N8 之后）。
 *
 * 与 `planFetch.ts` 同一套降级原则：服务端 / 模型不可用时，落回本地的确定性草稿，
 * 用户拿到的内容与「结束旅行时自动生成的那一份」完全一致，不会因为 AI 挂了就少几条记录。
 *
 * `by` 与 `source` 两个维度是正交的，界面必须分开说：
 * - by='model'：模型改写过的，可读性更好，但**每一句都能对上一条记录**（服务端已剪枝）
 * - by='engine'：确定性拼串，逐条照抄用户写的内容
 * 把降级说成「咕噜帮你写好了」是最容易让人误判产品能力的地方。
 */

export type NarrativeResult = {
  text: string;
  by: 'model' | 'engine';
  source: 'server' | 'local';
};

/** 模型改写通常比本地拼串慢，给 10 秒；超时就走本地，不让用户对着空卡片等 */
const TIMEOUT_MS = 10_000;

type Trip = { demand: Demand; plans: Plan[]; planIndex: number };

/** 本地确定性草稿：与结束旅行时生成的那份是同一个函数 */
export function narrateLocally(trip: Trip, memory: TripMemory): NarrativeResult {
  return { text: buildMemoryDraft(trip, memory), by: 'engine', source: 'local' };
}

export async function fetchNarrative(trip: Trip, memory: TripMemory): Promise<NarrativeResult> {
  try {
    const res = await Promise.race([
      api.post<{ text?: unknown; by?: unknown }>('/api/ai/memory-narrative', {
        // 服务端不读库：回忆由客户端上传。匿名用户的回忆只在本机，强制登录会砍掉主场景
        trip: { tripId: memory.tripId, demand: trip.demand, plan: trip.plans[trip.planIndex] ?? trip.plans[0] },
        memory,
        sessionId: trackSessionId(),
        journey: trackJourney(),
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS)),
    ]);
    if (!res || typeof res.text !== 'string') return narrateLocally(trip, memory);
    // 服务端可能返回空文本（整理不出内容）。这时本地也多半是空的，直接照实返回
    return {
      text: res.text,
      by: res.by === 'model' ? 'model' : 'engine',
      source: 'server',
    };
  } catch {
    // 断网 / 后端没起 / 接口报错：本地草稿算得出来，不把网络错误抛给用户
    return narrateLocally(trip, memory);
  }
}
