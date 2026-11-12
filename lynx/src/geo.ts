import { api } from './api.js';
import { readLocal, writeLocal } from './storage.js';
import { getHostLocation, hostApiBase, locationStamp } from './hostBridge.js';

/**
 * 定位 + 地图能力的接入层。
 *
 * 经纬度只能由宿主壳给。这个 App 的 web 渲染器把业务 JS 放进 `new Worker(...)` 里跑，
 * Worker 的 globalThis 是 WorkerGlobalScope，看不到主线程的 `window`。
 *
 * 现状（在 iPhone 18 Pro / iOS 27.2 模拟器上逐条验过）：
 *   - 壳侧能拿到坐标，locationd 日志有 `client authorized for location` 和
 *     `Sending location to client`，注入脚本里 globalProps 也确实写进去了；
 *   - 业务代码里 **`globalThis.lynx` 是 undefined**：web 渲染器（纯 Worker）和
 *     原生 Lynx 两种情况都实测过，一样没有。所以 `lynx.__globalProps.__fpLocation`
 *     这条路从来就没通过，别再往这个方向查。
 *
 * 能用的只有 React 层的 `useGlobalProps()`，见 hostBridge.ts。
 *
 * 逆地理 / 真实耗时都走 `server/src/routes/geo.ts`，key 不下发到前端。
 */

export { locationStamp };

export type GeoPoint = { lng: number; lat: number; accuracy?: number; at?: number };

type RawLocation = { lng?: unknown; lat?: unknown; accuracy?: unknown; at?: unknown; error?: unknown };

/** 最近一次宿主下发的定位快照（值由 hostBridge 存，App 根组件负责灌） */
function snapshot(): RawLocation | null {
  const loc = getHostLocation();
  return loc ? (loc as RawLocation) : null;
}

/** 宿主有没有下发过定位数据：区分「没接进来」和「接了但坐标还没回来」 */
function hasChannel(): boolean {
  return getHostLocation() !== null;
}

const STALE_MS = 5 * 60 * 1000;

/**
 * 等系统定位的时间上限。
 * 首次授权要走「弹窗 → 用户点允许 → 系统定位」三步，慢的时候 5 秒以上很正常，
 * 所以这里给 8 秒；超时只是报「定位中」，不当作失败，界面还能重试。
 */
const WAIT_MS = 8000;
const POLL_MS = 150;

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
/**
 * 最近一次取定位失败时的诊断码，界面上直接显示。
 * 这些不是给用户看的文案，是给我排查用的——真机拿不到只能靠它判断断在哪一层：
 *   no-channel  有 lynx 运行时，但 globalProps 里没有 __fpLocation 键 → 壳没注入进来
 *   no-payload  键在，但里面没有坐标 → 注入到了、坐标还没填 → 定位本身没回来
 */
export let diagnostic = '';

export async function locate(): Promise<LocateResult> {
  diagnostic = '';
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
      if (!hasLynx) return { ok: false, reason: 'unsupported' };
      // 有 lynx 但 globalProps 里连这个键都没有 = 壳的注入没进到 Worker；
      // 有键但值是空对象 = 注入成功但坐标还没填。两者要分开，否则没法定位问题
      diagnostic = hasChannel() ? 'no-payload' : 'no-channel';
      return { ok: false, reason: 'pending' };
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

/**
 * 静态底图 URL。交给 `<image src>` 直接请求，因此必须是完整地址而非 JSON 接口。
 *
 * 后端只做透传（key 不过河、不缓存），前端拿到的永远是一张 PNG。
 * 尺寸按「逻辑尺寸 × dpr」要：高德的 scale=2 能把有效分辨率翻倍，
 * 但 size 上限 1024，所以 dpr 高的时候要先把逻辑尺寸压到 512 以内再用 scale=2。
 */
export function staticMapUrl(
  center: { lng: number; lat: number },
  zoom: number,
  width: number,
  height: number,
  dpr = 2
): string {
  const useScale2 = width * 2 <= 1024 && height * 2 <= 1024 && dpr >= 2;
  const w = Math.min(1024, Math.round(width * (useScale2 ? 1 : Math.min(1, 1024 / Math.max(width, 1)))));
  const h = Math.min(1024, Math.round(height * (useScale2 ? 1 : Math.min(1, 1024 / Math.max(height, 1)))));
  const qs = [
    `center=${center.lng.toFixed(6)},${center.lat.toFixed(6)}`,
    `zoom=${zoom}`,
    `size=${w}*${h}`,
    useScale2 ? 'scale=2' : 'scale=1'
  ].join('&');
  const base = hostApiBase();
  return `${base}/api/geo/staticmap?${qs}`;
}
