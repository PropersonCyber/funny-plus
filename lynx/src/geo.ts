import { api } from './api.js';
import { readLocal, writeLocal } from './storage.js';

/**
 * 定位 + 地图能力的接入层。
 *
 * 经纬度只能由宿主壳给，而且**只能走 `lynx.__globalProps`**：
 * 这个 App 的 web 渲染器把业务 JS 放进 `new Worker(...)` 里跑，Worker 的 globalThis
 * 是 WorkerGlobalScope，看不到主线程的 `window`。之前往 `window.__fpLocation` 注入
 * 的那套在 Worker 里永远读不到，定位必然返回 unsupported —— 这是「定位没接进来」的
 * 真正原因：不是壳没实现，是通道选错了。
 *
 * 现在壳层写 `<lynx-view>.globalProps = { __fpLocation: {...} }`，
 * web-core 的 Value setter 会把更新转发进 Worker。
 * 逆地理 / 真实耗时都走 `server/src/routes/geo.ts`，key 不下发到前端。
 */

export type GeoPoint = { lng: number; lat: number; accuracy?: number; at?: number };

type RawLocation = { lng?: unknown; lat?: unknown; accuracy?: unknown; at?: unknown; error?: unknown };

/** 读 lynx.__globalProps 里的定位快照。没有 lynx 环境（单测 / 浏览器预览）返回 null */
function snapshot(): RawLocation | null {
  const g = (globalThis as any)?.lynx?.__globalProps;
  const loc = g?.__fpLocation;
  return loc && typeof loc === 'object' ? (loc as RawLocation) : null;
}

/**
 * 坐标时效：超过 5 分钟不用——人在高铁上，10 分钟前的城市已经错了，
 * 与其拿旧坐标定位到隔壁城市，不如说「定位已过期」让用户自己选。
 */
const STALE_MS = 5 * 60 * 1000;

/** 系统定位回调通常比页面晚到；最多等这么久，超时就报「定位中」而不是失败 */
const WAIT_MS = 3000;
const POLL_MS = 120;

export type LocateResult =
  | { ok: true; point: GeoPoint }
  | { ok: false; reason: 'unsupported' | 'denied' | 'failed' | 'stale' | 'pending' };

function valid(p: unknown): p is GeoPoint {
  const q = p as GeoPoint | null;
  return (
    !!q &&
    Number.isFinite(q.lng) &&
    Number.isFinite(q.lat) &&
    Math.abs(q.lng) <= 180 &&
    Math.abs(q.lat) <= 90
  );
}

/**
 * 取当前定位。
 *
 * 四种结局分开，界面才能给出不同的下一步：
 *   ok          有坐标且没过期
 *   denied      系统权限被拒 —— 提示去设置里开
 *   pending     等超时还没结果 —— 显示「定位中」，允许重试，不当成失败
 *   unsupported 没有 lynx 环境（浏览器预览 / 单测）—— 如实说没有这个能力
 *   failed      壳报了非权限类错误 / 坐标非法
 */
export async function locate(): Promise<LocateResult> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const snap = snapshot();
    if (snap) {
      if (typeof snap.error === 'string' && snap.error) {
        return { ok: false, reason: snap.error.indexOf('denied') >= 0 ? 'denied' : 'failed' };
      }
      if (valid(snap)) {
        const point: GeoPoint = {
          lng: Number(snap.lng),
          lat: Number(snap.lat),
          accuracy: Number(snap.accuracy) || undefined,
          at: Number(snap.at) || undefined,
        };
        if (point.at && Date.now() - point.at > STALE_MS) return { ok: false, reason: 'stale' };
        return { ok: true, point };
      }
    }
    if (Date.now() >= deadline) {
      const hasLynx = !!(globalThis as any)?.lynx;
      return { ok: false, reason: hasLynx ? 'pending' : 'unsupported' };
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

/**
 * 拉起系统权限设置页：用户点了「拒绝」之后唯一的自救路径。
 * Worker 里拿不到 window.open，只能让壳去做；壳没提供就返回 false，界面不显示这个入口。
 */
export function openLocationSettings(): boolean {
  const g = (globalThis as any)?.lynx?.__globalProps;
  const open = g?.__fpOpenSettings;
  if (typeof open !== 'function') return false;
  try {
    open();
    return true;
  } catch {
    return false;
  }
}

export type Regeo = { city: string; province: string; district: string; coord: 'gcj02' };

const CITY_CACHE = 'funny-plus.located-city.v1';
/** 城市名缓存 30 分钟：逆地理按次计费，冷启动一次就够，不需要每次进页面都打 */
const CITY_TTL_MS = 30 * 60 * 1000;

type CachedCity = { city: string; at: number };

export function cachedCity(): string {
  const raw = readLocal(CITY_CACHE);
  if (!raw) return '';
  try {
    const c = JSON.parse(raw) as CachedCity;
    if (!c.city || typeof c.at !== 'number') return '';
    return Date.now() - c.at > CITY_TTL_MS ? '' : c.city;
  } catch {
    return '';
  }
}

/**
 * 逆地理。三层结果分清楚：
 *   ok      拿到城市名
 *   empty   接口通了但没查到（海上 / 境外），正常返回
 *   offline 服务端未配 key / 网络不通 —— 前端照实降级，不当成「定位失败」
 */
export type CityResult =
  | { status: 'ok'; city: string }
  | { status: 'empty' }
  | { status: 'offline'; reason: 'not_configured' | 'error' };

export async function resolveCity(point: GeoPoint): Promise<CityResult> {
  try {
    const body = await api.get<Regeo>(`/api/geo/regeo?lng=${point.lng}&lat=${point.lat}`);
    const city = (body.city || '').trim();
    if (!city) return { status: 'empty' };
    writeLocal(CITY_CACHE, JSON.stringify({ city, at: Date.now() } satisfies CachedCity));
    return { status: 'ok', city };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    return { status: 'offline', reason: msg.indexOf('未配置') >= 0 ? 'not_configured' : 'error' };
  }
}

/** 一次性拿「定位 → 城市名」，给首页 / 城市选择页用 */
export async function locateCity(): Promise<
  | { status: 'ok'; city: string }
  | { status: 'empty' }
  | {
      status: 'offline';
      reason: 'not_configured' | 'error' | 'no_location' | 'denied' | 'pending';
    }
> {
  const hit = cachedCity();
  if (hit) return { status: 'ok', city: hit };
  const loc = await locate();
  if (!loc.ok) {
    // denied / pending 要原样透给界面：一个该引导去设置，一个该继续转圈
    if (loc.reason === 'denied') return { status: 'offline', reason: 'denied' };
    if (loc.reason === 'pending') return { status: 'offline', reason: 'pending' };
    return { status: 'offline', reason: 'no_location' };
  }
  return resolveCity(loc.point);
}
