import { api, authToken, deviceId } from './api.js';
import type { GuideBook, MemoryBook, SavedTrip } from './storage.js';
import type { GuideShareSnapshot } from './data.js';
import type { RemoteGuide, RemoteMemory } from './syncMerge.js';

/**
 * 本机数据推云端 / 从云端拉回来（F06，G5 补上拉取）。
 *
 * 四条硬规则，都是为了「同步失败不能伤到本机数据」：
 *
 * 1. **未登录直接跳过，不报错、不弹登录**。匿名是正常状态，不是错误。
 *    「登录只挡云同步」的意思就是这个函数什么都不做。
 * 2. **启动时不从云端覆盖本机**。跨设备的数据由登录后的显式 `pullCloud()` 拉，
 *    合并规则在 syncMerge.ts 里按 id 取较新的那份 —— 无条件覆盖会让本机最新的一份被云端旧的盖掉。
 * 3. **失败只吞不抛**。本机已经存好了，推不上去最坏是这次没同步；抛错会让调用处的
 *    effect 崩掉，反而影响本机使用。拉取失败返回 null，调用方据此保持现状。
 * 4. **只推本机有的**。拉回来的东西不自动回推：那会在两台设备之间来回打脸，
 *    而且用户此刻可能正在编辑其中一份。
 *
 * 早先设计过的 409 stale_write 在这里只打点不重试：重试等于拿本机覆盖云端更新的那份，
 * 而用户此刻看到的就是本机数据，静默覆盖会让他事后发现另一台设备的修改不见了。
 */
export function isLoggedIn(): boolean {
  return !!authToken();
}

// 状态机单独放 syncStatus.ts：它能被 rstest 直接测，而 sync.ts 依赖 api.ts 不行
import { setSyncState } from './syncStatus.js';

export { onSyncStateChange, syncState } from './syncStatus.js';
export type { SyncState } from './syncStatus.js';

/**
 * 推送一条行程；返回是否真的发出去了（未登录 = 没发）。
 *
 * 推的是整条 SavedTrip（全部方案 + 选中项 + 结束状态 + 变更记录），不是「当前选中的那一套」：
 * 只推一套的后果是「存了 3 份行程，换设备登录后只剩 1 份」—— 承诺了能找回却找不回。
 */
export async function pushTrip(trip: SavedTrip): Promise<boolean> {
  if (!isLoggedIn()) return false;
  setSyncState('pending');
  try {
    await api.put(`/api/trips/${encodeURIComponent(trip.id)}`, {
      demand: trip.demand,
      plans: trip.plans,
      planIndex: trip.planIndex,
      // 显式传 null 而不是省略：省略的话服务端分不清「还在进行中」和「老客户端没这个字段」
      endedAt: trip.endedAt ?? null,
      savedAt: trip.savedAt,
      versions: trip.versions,
      clientId: deviceId()
    });
    setSyncState('idle');
    return true;
  } catch {
    setSyncState('failed');
    return false;
  }
}

/**
 * 把本机全部行程推一遍（登录后的补推）。
 *
 * 登录前产生的行程本机有、云端没有，不补推就永远上不去 —— 这正是 G5 要解决的
 * 「匿名期已产生行程，首次登录后无需再次编辑即完成并账与上行」。
 */
export async function pushAllTrips(trips: SavedTrip[]): Promise<number> {
  let ok = 0;
  for (const t of trips) {
    if (await pushTrip(t)) ok += 1;
  }
  return ok;
}

export async function pushMemory(tripId: string, memory: MemoryBook[string]): Promise<boolean> {
  if (!isLoggedIn() || !tripId) return false;
  setSyncState('pending');
  try {
    await api.put(`/api/memories/${encodeURIComponent(tripId)}`, {
      payload: memory,
      updatedAt: memory.updatedAt
    });
    setSyncState('idle');
    return true;
  } catch {
    setSyncState('failed');
    return false;
  }
}

export async function pushGuide(guideId: string, tripId: string, guide: GuideBook[string]): Promise<boolean> {
  if (!isLoggedIn() || !guideId) return false;
  setSyncState('pending');
  try {
    await api.put(`/api/guides/${encodeURIComponent(guideId)}`, {
      payload: guide,
      tripId,
      updatedAt: guide.updatedAt
    });
    setSyncState('idle');
    return true;
  } catch {
    setSyncState('failed');
    return false;
  }
}

/**
 * 云端全量快照（G5 跨设备找回）。
 *
 * 三个请求并发发：它们互不依赖，串行等于把一次登录的等待拉长三倍。
 * 任一失败整体返回 null 而不是「拿到多少算多少」—— 半份数据会让调用方以为云端是完整的，
 * 而它其实少了一类（比如只有行程没有回忆），比明确失败更难查。
 */
export type CloudSnapshot = {
  trips: SavedTrip[];
  memories: RemoteMemory[];
  guides: RemoteGuide[];
};

export async function pullCloud(): Promise<CloudSnapshot | null> {
  if (!isLoggedIn()) return null;
  setSyncState('pending');
  try {
    const [t, m, g] = await Promise.all([
      api.get<{ items?: SavedTrip[] }>('/api/trips'),
      api.get<{ items?: RemoteMemory[] }>('/api/memories'),
      api.get<{ items?: RemoteGuide[] }>('/api/guides')
    ]);
    setSyncState('idle');
    return { trips: t.items ?? [], memories: m.items ?? [], guides: g.items ?? [] };
  } catch {
    setSyncState('failed');
    return null;
  }
}

/**
 * 发布结果。
 *
 * 用判别式而不是「成功返回对象 / 失败返回 null」：调用方要分别处理
 * 「没登录 → 引导登录」与「出错 → 提示重试」，混成一个 null 就没法给不同的界面。
 */
export type PublishResult =
  /** updated = 这条链接之前就发过，这次只是把快照刷新成当前草稿 */
  | { ok: true; token: string; url: string; updated: boolean }
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
    const res = await api.post<{ token: string; url: string; updated?: boolean }>(
      `/api/guides/${encodeURIComponent(draftId)}/publish`,
      typeof perPerson === 'number' ? { perPerson } : {}
    );
    if (!res?.token || !res?.url) return { ok: false, reason: 'failed' };
    return { ok: true, token: res.token, url: res.url, updated: res.updated === true };
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