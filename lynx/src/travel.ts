import type { Demand, Plan, Place } from '@/types';
import { placesOf, setRouteMinutes } from '@/engine/placeIndex';
import { legsOf } from './legs.js';
import { api } from './api.js';
import { placeById } from './data.js';
import { legGeometry, setLegGeometry } from './routeGeometry.js';
import { parsePolyline, type GeoPoint } from './mapProjection.js';

/**
 * 真实路线耗时的取数层。
 *
 * 为什么分两阶段：`planner.ts` 是同步纯函数（不能自己 await），而路线耗时必须问服务端。
 * 但方案的**排序只看直线距离**（planner 里 nearest 用的是 distanceKm，不是 travelMinutes），
 * 所以可以先用直线估算跑一遍拿到顺序，再按这个顺序取真实耗时，最后重算一遍——
 * 第二遍排序不会变，只有路上时间变准。既不污染同步引擎，也不会把请求花在用不到的段上。
 *
 * 为什么按段取而不是高德 /v3/distance 的批量形状：那个接口是「多个起点 → 同一个终点」，
 * 而行程要的是 1→2→3 的相邻段，硬套等于每次只用一个结果，配额白烧。
 */

type DirectionResp = {
  durationS?: number;
  distanceM?: number;
  empty?: boolean;
  /** 「lng,lat;lng,lat;...」的真实路径折线；服务端没拿到就缺省 */
  path?: string;
};

export type TravelMode = 'driving' | 'walking';

/**
 * 交通方式 → 路线接口。
 * 公交（transit）要 city 参数、还要处理步行接驳，先不接：缺这一段会退回直线折算，
 * 界面标「估算」，比拿一份错的公交时刻表冒充精确要好。
 */
const modeOf = (transport: Demand['transport']): TravelMode =>
  transport === 'public' ? 'walking' : 'driving';

export type WarmResult = { asked: number; hit: number };

/**
 * 把这几个方案的相邻路段耗时灌进 placeIndex，之后重跑 planner 就会用真实值。
 * 拿不到的段自然留在直线折算上，界面会如实标「估算」。
 */
export async function warmTravelMinutes(demand: Demand, plans: Plan[]): Promise<WarmResult> {
  const byId = new Map(placesOf(demand.destination).map((p) => [p.id, p]));
  const legs = legsOf(plans, byId);
  if (legs.length === 0) return { asked: 0, hit: 0 };

  const mode = modeOf(demand.transport);
  const faster = demand.transport !== 'public';
  let hit = 0;

  // 一次全发会把 key 打到限流；4 个一批，串行推进
  const BATCH = 4;
  for (let i = 0; i < legs.length; i += BATCH) {
    const chunk = legs.slice(i, i + BATCH);
    const got = await Promise.all(
      chunk.map(async ([a, b]) => {
        const got = await fetchSegment(a, b, mode);
        if (got === null) return false;
        setRouteMinutes(a.id, b.id, faster, got.minutes);
        // 折线和实际距离单独存：拿不到只是退回直连/直线距离，不影响耗时本身已经取到
        setLegGeometry(a.id, b.id, { path: got.path, distanceM: got.distanceM });
        return true;
      }),
    );
    hit += got.filter(Boolean).length;
    // 第一批就全军覆没（没配 key / 断网 / 限流）：别把剩下的段继续打满
    if (i === 0 && got.every((ok) => !ok)) break;
  }

  return { asked: legs.length, hit };
}

/**
 * 单段结果。拿不到返回 null —— 调用方据此保留直线折算，不编数字。
 * path 可能缺：耗时拿到了但折线没拿到（高德没回 steps）时，时间是准的、
 * 线退回直连，这两个结论互不牵连，不要因为缺折线就把耗时也丢掉。
 */
type SegmentResult = { minutes: number; path?: GeoPoint[]; distanceM?: number };

async function fetchSegment(a: Place, b: Place, mode: TravelMode): Promise<SegmentResult | null> {
  try {
    const body = await api.get<DirectionResp>(
      `/api/geo/direction?origin=${a.lng},${a.lat}&destination=${b.lng},${b.lat}&mode=${mode}`,
    );
    const sec = Number(body.durationS ?? 0);
    if (!Number.isFinite(sec) || sec <= 0) return null;
    // 向上取整到分钟：宁可多留一点缓冲，也不要让用户按秒赶到
    const minutes = Math.max(1, Math.ceil(sec / 60));
    const path = parsePolyline(body.path);
    const dist = Number(body.distanceM ?? 0);
    const distanceM = Number.isFinite(dist) && dist > 0 ? dist : undefined;
    return { minutes, path: path.length >= 2 ? path : undefined, distanceM };
  } catch {
    // 未配 key / 限流 / 网络不通：整批降级，不阻塞生成方案
    return null;
  }
}

/**
 * 地图页专用：把某一天相邻路段的真实折线补齐。
 *
 * 为什么需要它：warmTravelMinutes 只在生成方案时跑一次，把折线留在进程内存里。
 * 冷启动直接进地图页时缓存是空的，于是整条路线退回两点直连的虚线 ——
 * 用户看到的是「一条假路」，而这本来是能拿到的真实路径。
 *
 * 只补缺的段：已经有的不再请求（静态图与路径规划共用配额，重复请求是白烧）。
 * 返回实际补到几段，调用方据此决定要不要重画。
 */
export async function fillDayGeometry(
  day: Plan['days'][number],
  transport: Demand['transport']
): Promise<number> {
  const ids = day.items.map((i) => i.placeId).filter((id): id is string => !!id);
  if (ids.length < 2) return 0;


  const mode = modeOf(transport);
  const missing: [string, string][] = [];
  for (let i = 1; i < ids.length; i++) {
    if (!legGeometry(ids[i - 1], ids[i])) missing.push([ids[i - 1], ids[i]]);
  }
  if (missing.length === 0) return 0;

  // 和 warmTravelMinutes 一样按 4 个一批：一次全发会打到高德的并发限制
  const BATCH = 4;
  let filled = 0;
  for (let i = 0; i < missing.length; i += BATCH) {
    const chunk = missing.slice(i, i + BATCH);
    const got = await Promise.all(
      chunk.map(async ([aId, bId]) => {
        const a = placeById(aId);
        const b = placeById(bId);
        if (!a || !b) return false;
        const seg = await fetchSegment(a, b, mode);
        if (!seg?.path) return false;
        setLegGeometry(aId, bId, { path: seg.path, distanceM: seg.distanceM });
        return true;
      })
    );
    filled += got.filter(Boolean).length;
    // 第一批全失败（没配 key / 断网 / 限流）：别再继续打
    if (i === 0 && got.every((ok) => !ok)) break;
  }
  return filled;
}
