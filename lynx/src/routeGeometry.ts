/**
 * 路段实际数据的缓存：真实路程距离 + 真实折线。
 *
 * 为什么单独放一个模块，而不是塞进 placeIndex：
 * placeIndex 在 shared/engine，被服务端和两端共用，只管「分钟数」这种会参与排序的数字。
 * 折线是纯展示数据、体积大（一段几十到两百个点），塞进去会让引擎的纯函数也拖上它。
 *
 * 生命周期跟进程一致：不落盘。地图页是「取到就画、没取到退回直连」，
 * 冷启动第一次打开地图会是直连，生成方案时顺手取到的段才画真实路线。
 * 这是可接受的降级——比为了折线单独再发一轮请求更省。
 */

import type { GeoPoint } from './mapProjection.js';

export type LegGeometry = {
  /** 高德给的实际行驶距离（米）。不是两点直线距离：宽窄巷子→武侯祠直线 1.6km，步行绕路 2.35km */
  distanceM?: number;
  /** 真实路径折线；缺省表示这一段没取到，画两点直连 */
  path?: GeoPoint[];
};

/** 键是「起点id>终点id」，和 travel.ts / legsOf 的方向一致；反向要单独取，不自动复用 */
const store = new Map<string, LegGeometry>();

const keyOf = (a: string, b: string): string => `${a}>${b}`;

export function setLegGeometry(a: string, b: string, geo: LegGeometry): void {
  // 折线不足两个点等于没有，但距离仍可能有效，所以分开判断
  const next: LegGeometry = {};
  if (geo.path && geo.path.length >= 2) next.path = geo.path;
  if (Number.isFinite(geo.distanceM) && (geo.distanceM ?? 0) > 0) next.distanceM = geo.distanceM;
  if (!next.path && next.distanceM === undefined) return;
  store.set(keyOf(a, b), next);
}

/** 没有这一段的记录就返回 null —— 调用方据此退回两点直连 / 直线距离，并标注为估算 */
export function legGeometry(a: string, b: string): LegGeometry | null {
  return store.get(keyOf(a, b)) ?? null;
}

export const hasLegGeometry = (a: string, b: string): boolean => store.has(keyOf(a, b));

export function clearLegGeometry(): void {
  store.clear();
}
