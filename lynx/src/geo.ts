import { api } from './api.js';
import { readLocal, writeLocal } from './storage.js';

/**
 * 定位 + 地图能力的接入层。
 *
 * 经纬度只能由宿主壳给。这个 App 的 web 渲染器把业务 JS 放进 `new Worker(...)` 里跑，
 * Worker 的 globalThis 是 WorkerGlobalScope，看不到主线程的 `window`。
 *
 * 现状（在 iPhone 18 Pro / iOS 27.2 模拟器上逐条验过）：
 *   - 壳侧能拿到坐标，locationd 日志有 `client authorized for location` 和
 *     `Sending location to client`，注入脚本里 globalProps 也确实写进去了；
 *   - 但业务代码跑在纯 Worker 里，`globalThis.lynx` 是 undefined ——
 *     实测 Worker 全局只有 WorkerGlobalScope / indexedDB / postMessage /
 *     importScripts，没有 lynx、没有 __globalProps、没有 parent。
 *
 * 所以下面这些读取（globalProps / __fpLocation / GlobalEventEmitter）在这个 web
 * 渲染器上都拿不到东西，**保留它们是给 Lynx 原生渲染器留的门**：真机走原生
 * Lynx 时 `lynx.__globalProps` 是真的存在的，那时代码不用改就能用。
 * 在当前 web 渲染器上定位会如实返回 unsupported，界面据此显示「定位未接入」，
 * 不编造城市。
 *
 * 逆地理 / 真实耗时都走 `server/src/routes/geo.ts`，key 不下发到前端。
 */

export type GeoPoint = { lng: number; lat: number; accuracy?: number; at?: number };

type RawLocation = { lng?: unknown; lat?: unknown; accuracy?: unknown; at?: unknown; error?: unknown };

/**
 * 宿主推过来的最近一次定位。
 *
 * 模块加载时就订阅，不等组件挂载：壳可能在页面脚本跑起来之前就拿到了坐标，
 * 那一次推送要是没接住，就只能等下一次定位（而 requestLocation 是一次性的）。
 */
let pushed: RawLocation | null = null;
let subscribed = false;

/** 订阅宿主推送。返回是否订阅成功——Worker 里没有 lynx JSModule 时（web 预览 / 单测）为 false */
export function subscribeLocation(): boolean {
  if (subscribed) return true;
  const g = globalThis as any;
  try {
    const emitter = g?.lynx?.getJSModule?.('GlobalEventEmitter');
    if (!emitter || typeof emitter.addListener !== 'function') return false;
    emitter.addListener('__fpLocation', (payload: unknown) => {
      if (payload && typeof payload === 'object') pushed = payload as RawLocation;
    });
    subscribed = true;
    return true;
  } catch {
    return false;
  }
}

subscribeLocation();

/**
 * 读定位快照。
 *
 * 三处取值都试，按可靠性从高到低：
 *   1. `globalThis.lynx.__globalProps` —— 官方 React runtime 内部就是这么读的
 *      （`Object.assign(lynx.__globalProps, newData)`），Worker 里有这个全局；
 *   2. `globalThis.__globalProps` —— 有些构建把 globalProps 直接摊到全局；
 *   3. 壳写进来的同名旁路 `globalThis.__fpLocation` —— 只在 web 预览里有效。
 *
 * 为什么不怕「多试几处显得脏」：这条链路已经在真机上错过两次（window 方案、
 * 注入时机），每次都是「看着应该能行」。宁可三个位置都查一遍，也不要再猜一次。
 */
function snapshot(): RawLocation | null {
  if (pushed) return pushed;
  const g = globalThis as any;
  const holder = g?.lynx?.__globalProps ?? g?.__globalProps;
  const loc = holder?.__fpLocation ?? g?.__fpLocation;
  return loc && typeof loc === 'object' ? (loc as RawLocation) : null;
}

/** globalProps 容器里有没有 __fpLocation 这个键（用于区分「壳没注入」和「注入了没坐标」） */
function hasChannel(): boolean {
  if (pushed) return true;
  const g = globalThis as any;
  const holder = g?.lynx?.__globalProps ?? g?.__globalProps;
  return !!(holder && '__fpLocation' in holder) || !!g?.__fpLocation;
}

/**
 * 坐标时效：超过 5 分钟不用——人在高铁上，10 分钟前的城市已经错了，
 * 与其拿旧坐标定位到隔壁城市，不如说「定位已过期」让用户自己选。
 */
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
