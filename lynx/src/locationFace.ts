import { CITY_CACHE, locateCity, locationStamp } from './geo.js';
import { cityKey, locationLabel } from './locationLabel.js';
import { writeLocal } from './storage.js';

/**
 * 首页定位胶囊和城市页「当前定位」共用这一份文案。
 * 两处各调一次 locateCity 会在「缓存命中 / 还在转圈 / 高德带不带市」上岔开，
 * 用户会看到首页写「成都」、城市页写「成都市」或「定位中…」。
 */

export type LocationStatus = 'pending' | 'ok' | 'denied' | 'missing';

export type LocationFace = {
  /** 界面上直接显示的字符串，两处必须相同 */
  label: string;
  /** 城市索引里的短名，用来点选；还没定位到时是空串 */
  id: string;
  status: LocationStatus;
};

const PENDING: LocationFace = { label: '定位中…', id: '', status: 'pending' };
const DENIED: LocationFace = { label: '未授权', id: '', status: 'denied' };
const MISSING: LocationFace = { label: '未获取到位置', id: '', status: 'missing' };

function faceFromCity(city: string): LocationFace {
  const id = cityKey(city);
  const label = locationLabel(city);
  if (!id || !label) return MISSING;
  return { label, id, status: 'ok' };
}

let face: LocationFace = PENDING;
let seenStamp = '';
let inflight: Promise<void> | null = null;
let gen = 0;
const listeners = new Set<() => void>();

function publish(next: LocationFace) {
  face = next;
  for (const fn of listeners) fn();
}

export function readLocationFace(): LocationFace {
  return face;
}

export function watchLocationFace(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

async function pull(fresh: boolean): Promise<LocationFace> {
  const r = await locateCity(fresh ? { fresh: true } : undefined);
  if (r.status === 'ok' && r.city) return faceFromCity(r.city);
  if (r.status === 'offline' && r.reason === 'denied') return DENIED;
  if (r.status === 'offline' && r.reason === 'pending') return PENDING;
  return MISSING;
}

/**
 * 已经拿到城市、坐标也没变，就别再打一遍：进城市页时如果重新转圈，
 * 会和首页刚才那一行对不上。
 */
export function ensureLocation(force = false): void {
  const stamp = locationStamp();
  if (!force && face.status === 'ok' && stamp === seenStamp) return;
  if (inflight && !force) return;
  const ticket = ++gen;
  seenStamp = stamp;
  if (force || face.status !== 'ok') publish(PENDING);
  inflight = pull(force)
    .then((next) => {
      if (ticket !== gen) return;
      publish(next);
      if (next.status === 'ok') seenStamp = locationStamp();
    })
    .finally(() => {
      if (ticket === gen) inflight = null;
    });
}

/** 右侧定位按钮：丢掉城市名缓存，按当前坐标再查一次 */
export function refreshLocation(): void {
  writeLocal(CITY_CACHE, '');
  gen += 1;
  inflight = null;
  seenStamp = '';
  ensureLocation(true);
}
