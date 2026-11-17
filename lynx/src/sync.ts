import { api, authToken, deviceId } from './api.js';
import type { GuideBook, MemoryBook, SavedTrip } from './storage.js';

/**
 * 本机数据推云端（F06）。
 *
 * 三条硬规则，都是为了「同步失败不能伤到本机数据」：
 *
 * 1. **未登录直接跳过，不报错、不弹登录**。匿名是正常状态，不是错误。
 *    「登录只挡云同步」的意思就是这个函数什么都不做。
 * 2. **只推不拉**。启动时不从云端覆盖本机：本机是用户此刻正在用的那份，被云端旧数据
 *    盖掉比不同步糟得多。跨设备数据靠首次登录时的并账对齐，不靠这里。
 * 3. **失败只吞不抛**。本机已经存好了，推不上去最坏是这次没同步；抛错会让调用处的
 *    effect 崩掉，反而影响本机使用。
 *
 * 早先设计过的 409 stale_write 在这里只打点不重试：重试等于拿本机覆盖云端更新的那份，
 * 而用户此刻看到的就是本机数据，静默覆盖会让他事后发现另一台设备的修改不见了。
 */
export function isLoggedIn(): boolean {
  return !!authToken();
}

/** 推送一条行程；返回是否真的发出去了（未登录 = 没发） */
export async function pushTrip(trip: SavedTrip): Promise<boolean> {
  if (!isLoggedIn()) return false;
  try {
    await api.put(`/api/trips/${encodeURIComponent(trip.id)}`, {
      demand: trip.demand,
      plan: trip.plans[trip.planIndex] ?? trip.plans[0],
      clientId: deviceId(),
    });
    return true;
  } catch {
    return false;
  }
}

export async function pushMemory(tripId: string, memory: MemoryBook[string]): Promise<boolean> {
  if (!isLoggedIn() || !tripId) return false;
  try {
    await api.put(`/api/memories/${encodeURIComponent(tripId)}`, {
      payload: memory,
      updatedAt: memory.updatedAt,
    });
    return true;
  } catch {
    return false;
  }
}

export async function pushGuide(guideId: string, tripId: string, guide: GuideBook[string]): Promise<boolean> {
  if (!isLoggedIn() || !guideId) return false;
  try {
    await api.put(`/api/guides/${encodeURIComponent(guideId)}`, {
      payload: guide,
      tripId,
      updatedAt: guide.updatedAt,
    });
    return true;
  } catch {
    return false;
  }
}
