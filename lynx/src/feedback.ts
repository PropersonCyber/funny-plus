import { readLocal, writeLocal } from './storage.js';
import { api, deviceId } from './api.js';

/**
 * 避坑反馈：本机记录「我也遇到了 / 不适用」。
 * 聚合计数在服务端（/api/facts/feedback），原生端拿不到网也就没有跨用户计数，
 * 所以这里只承诺「本机已记录」，不编造别人的反馈数。
 */
const KEY = 'funny-plus.feedback.v1';

export type Verdict = 'met' | 'not-applicable';

type Store = Record<string, Verdict>;

function readAll(): Store {
  const raw = readLocal(KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Store;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function myVerdict(factId: string): Verdict | null {
  return readAll()[factId] ?? null;
}

/** 同一设备同一条只能记一次；重复提交直接返回旧值，不叠加 */
export function saveVerdict(factId: string, verdict: Verdict): Verdict | null {
  const all = readAll();
  if (all[factId]) return null;
  all[factId] = verdict;
  return writeLocal(KEY, JSON.stringify(all)) ? verdict : null;
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  met: '我也遇到了',
  'not-applicable': '不适用'
};

export type Summary = { factId: string; met: number; notApplicable: number; mine: Verdict | null };

/** 聚合计数：服务端失败就当没拿到，界面不编数字 */
export async function fetchSummaries(): Promise<Record<string, Summary>> {
  const body = await api.get<{ items: Summary[] }>(`/api/facts/feedback?clientId=${encodeURIComponent(deviceId())}`);
  const out: Record<string, Summary> = {};
  for (const s of body.items) out[s.factId] = s;
  return out;
}

/** 提交反馈；返回服务端算好的最新计数，界面直接用它，不再自增 */
export async function submitVerdict(factId: string, verdict: Verdict): Promise<Summary> {
  const body = await api.post<{ item: Summary }>('/api/facts/feedback', {
    factId,
    verdict,
    clientId: deviceId()
  });
  return body.item;
}
