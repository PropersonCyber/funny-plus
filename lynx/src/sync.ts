import { api, authToken, deviceId } from './api.js';
import type { GuideBook, MemoryBook, SavedTrip } from './storage.js';
import type { GuideShareSnapshot } from './data.js';

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

/**
 * 发布结果。
 *
 * 用判别式而不是「成功返回对象 / 失败返回 null」：调用方要分别处理
 * 「没登录 → 引导登录」与「出错 → 提示重试」，混成一个 null 就没法给不同的界面。
 */
export type PublishResult =
  | { ok: true; token: string; url: string }
  | { ok: false; reason: 'login' | 'failed' };

/**
 * 把一份草稿发布成链接（F08 后半）。
 *
 * `perPerson` 由调用方算好传进来：费用属于行程而不属于攻略草稿，
 * 服务端不该为一个展示字段去重跑一遍预算引擎。
 *
 * 与 push* 系列不同，这里**不吞登录态问题**：发布是用户主动点的动作，
 * 未登录时回 `reason: 'login'`，界面据此给登录入口，而不是转一圈当作失败。
 */
export async function publishGuide(
  draftId: string,
  perPerson: number | undefined
): Promise<PublishResult> {
  if (!isLoggedIn()) return { ok: false, reason: 'login' };
  try {
    const res = await api.post<{ token: string; url: string }>(
      `/api/guides/${encodeURIComponent(draftId)}/publish`,
      typeof perPerson === 'number' ? { perPerson } : {}
    );
    if (!res?.token || !res?.url) return { ok: false, reason: 'failed' };
    return { ok: true, token: res.token, url: res.url };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** 撤回；返回是否真的撤回了一条（false 时可能是本来就没发布，也可能是失败） */
export async function unpublishGuide(draftId: string): Promise<boolean> {
  if (!isLoggedIn()) return false;
  try {
    const res = await api.post<{ ok: boolean; revoked: boolean }>(
      `/api/guides/${encodeURIComponent(draftId)}/unpublish`,
      {}
    );
    return !!res?.ok;
  } catch {
    return false;
  }
}

/**
 * 拉一条公开分享的内容。
 *
 * 这个请求**不带登录也照发**（`api.get` 会自动带上 token，但服务端那条路不校验）：
 * 分享页的访客本来就没账号。失效或不存在统一返回 null，由页面显示引导文案。
 */
export async function fetchShare(
  token: string
): Promise<{ snapshot: GuideShareSnapshot; authorLabel: string } | null> {
  if (!token) return null;
  try {
    return await api.get<{ snapshot: GuideShareSnapshot; authorLabel: string }>(
      `/api/share/${encodeURIComponent(token)}`
    );
  } catch {
    return null;
  }
}
