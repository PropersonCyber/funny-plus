import type { Demand, Plan } from './data.js';

/**
 * 本机保存。
 * 现状：web bundle 跑在 web-core 的受限 VM 里，window / document / localStorage
 * 都不存在，location 只能读不能写，所以这里拿不到任何持久化通道，
 * 调用方会拿到 null 并显示「未写入本机」。真要落盘有两种做法，见 README：
 * 给 web-core 注册 NativeModule，或改用原生 LynxView + 宿主 LynxModule。
 */
const KEY = 'funny-plus.trip.v1';

export type SavedTrip = {
  demand: Demand;
  plans: Plan[];
  savedAt: string;
};

export function readLocal(key: string): string | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage.getItem(key);
  } catch {
    return null;
  }
  return null;
}

export function writeLocal(key: string, value: string): boolean {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function loadSaved(): SavedTrip | null {
  const raw = readLocal(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SavedTrip;
    if (!parsed?.demand?.destination || !Array.isArray(parsed.plans) || parsed.plans.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 写成功才返回时间戳；拿不到存储时返回 null，界面据此如实提示 */
export function saveTrip(demand: Demand, plans: Plan[], at = new Date()): string | null {
  const savedAt = at.toISOString();
  return writeLocal(KEY, JSON.stringify({ demand, plans, savedAt })) ? savedAt : null;
}
