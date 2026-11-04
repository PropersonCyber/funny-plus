import { api } from './api.js';
import { readLocal, writeLocal } from './storage.js';

/**
 * 定位 + 地图能力的接入层。
 *
 * 经纬度只能由原生壳给：Lynx 原生端没有 navigator.geolocation，web 预览里浏览器有，
 * 所以壳会往 `globalThis.__fpLocation` 写一份缓存坐标（见各壳的注入逻辑），
 * 前端读它，读不到就如实说「没有定位」，绝不退回一个假城市。
 *
 * 逆地理 / 真实耗时都走 `server/src/routes/geo.ts`，key 不下发到前端。
 */

export type GeoPoint = { lng: number; lat: number; accuracy?: number; at?: number };

/** 壳注入的桥：取当前定位。返回 Promise，权限被拒时 reject */
type LocationBridge = { get?: () => Promise<GeoPoint>; current?: GeoPoint };
/** 壳注入的桥：打开系统权限设置页 */
type PermissionBridge = { openSettings?: () => void };

const bridge = (): LocationBridge | null => {
  const g = globalThis as any;
  const b = g?.__fpLocation;
  return b && typeof b === 'object' ? (b as LocationBridge) : null;
};

/**
 * 坐标时效：超过 5 分钟不用——人在高铁上，10 分钟前的城市已经错了，
 * 与其拿旧坐标定位到隔壁城市，不如说「定位已过期」让用户自己选。
 */
const STALE_MS = 5 * 60 * 1000;

export type LocateResult =
  | { ok: true; point: GeoPoint }
  | { ok: false; reason: 'unsupported' | 'denied' | 'failed' | 'stale' };

function valid(p: unknown): p is GeoPoint {
  const q = p as GeoPoint | null;
  return !!q && Number.isFinite(q.lng) && Number.isFinite(q.lat) && Math.abs(q.lng) <= 180 && Math.abs(q.lat) <= 90;
}

export async function locate(): Promise<LocateResult> {
  const b = bridge();
  // 没有桥 = 跑在浏览器预览里，或壳还没实现注入。这两种都不该让用户等
  if (!b) return { ok: false, reason: 'unsupported' };

  let point: GeoPoint | null = null;
  if (typeof b.get === 'function') {
    try {
      const got = await b.get();
      if (valid(got)) point = got;
    } catch (err) {
      // 桥 reject 的字符串约定：denied = 用户拒绝 / 权限被关
      const msg = String((err as { message?: string } | null)?.message ?? err ?? '');
      return { ok: false, reason: msg.indexOf('denied') >= 0 ? 'denied' : 'failed' };
    }
  }
  // 壳是「上次定位结果」的同步快照，直接可用；两条都没有就不猜
  if (!point && valid(b.current)) point = b.current!;
  if (!point) return { ok: false, reason: 'failed' };

  if (point.at && Date.now() - point.at > STALE_MS) return { ok: false, reason: 'stale' };
  return { ok: true, point };
}

/** 拉起系统权限设置页：用户点了「拒绝」之后唯一的自救路径 */
export function openLocationSettings(): boolean {
  const p = (globalThis as any)?.__fpPermission as PermissionBridge | null | undefined;
  if (!p || typeof p.openSettings !== 'function') return false;
  p.openSettings();
  return true;
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
  { status: 'ok'; city: string } | { status: 'empty' } | { status: 'offline'; reason: 'not_configured' | 'error' | 'no_location' }
> {
  const hit = cachedCity();
  if (hit) return { status: 'ok', city: hit };
  const loc = await locate();
  if (!loc.ok) return { status: 'offline', reason: 'no_location' };
  return resolveCity(loc.point);
}
