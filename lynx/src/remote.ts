import { api, deviceId } from './api.js';
import { readLocal, writeLocal } from './storage.js';
import citiesSeed from '../../data/cities.json';
import guidesSeed from '../../data/guides.json';
import playsSeed from '../../data/plays.json';
import placesSeed from '../../data/places.json';
import type { City, Collection, CollectTarget, Footprint, Guide, Place, Play } from '../../shared/types/index.js';

/**
 * 参照数据（城市 / 攻略 / 玩法）唯一的线上来源是 GET /api/content。
 * data/*.json 只是同一份种子数据的随包副本：冷启动断网时先用它渲染，
 * 拉到接口后覆盖缓存，下一次启动直接吃缓存，避免首屏空白。
 */
export type Content = { cities: City[]; guides: Guide[]; plays: Play[]; places: Place[] };

const CACHE_KEY = 'funny-plus.content.v1';

export const SEED_CONTENT: Content = {
  cities: citiesSeed as City[],
  guides: guidesSeed as Guide[],
  plays: playsSeed as Play[],
  places: placesSeed as unknown as Place[],
};

function readCache(): Content | null {
  const raw = readLocal(CACHE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Content;
    if (!parsed.cities?.length || !parsed.guides?.length || !parsed.plays?.length || !parsed.places?.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 启动时先用它：缓存 > 随包种子，保证首屏一定有内容 */
export function initialContent(): Content {
  return readCache() ?? SEED_CONTENT;
}

export async function fetchContent(): Promise<Content> {
  const body = await api.get<Content>('/api/content');
  if (!body.cities?.length) throw new Error('内容为空');
  writeLocal(
    CACHE_KEY,
    JSON.stringify({ cities: body.cities, guides: body.guides, plays: body.plays, places: body.places }),
  );
  return body;
}

export type Mine = { collections: Collection[]; footprints: Footprint[] };
export const EMPTY_MINE: Mine = { collections: [], footprints: [] };

export async function fetchMine(): Promise<Mine> {
  const body = await api.get<Mine>(`/api/me?clientId=${encodeURIComponent(deviceId())}`);
  return { collections: body.collections ?? [], footprints: body.footprints ?? [] };
}

export function addCollection(targetType: CollectTarget, targetId: string): Promise<{ item: Collection | null }> {
  return api.post('/api/me/collections', { clientId: deviceId(), targetType, targetId });
}

export function removeCollection(targetType: CollectTarget, targetId: string): Promise<{ ok: boolean }> {
  const q = `clientId=${encodeURIComponent(deviceId())}&targetType=${targetType}&targetId=${encodeURIComponent(targetId)}`;
  return api.delete(`/api/me/collections?${q}`);
}

export function addFootprint(placeId: string): Promise<{ item: Footprint | null }> {
  return api.post('/api/me/footprints', { clientId: deviceId(), placeId });
}
