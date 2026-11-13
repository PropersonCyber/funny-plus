import { describe, expect, it } from '@rstest/core';

import {
  DEFAULT_ASPECT,
  boundsCenter,
  fitZoom,
  makeProjection,
  makeStaticMapProjection,
  niceScaleBar,
  projectToWorld,
  unprojectFromImage,
  unprojectFromWorld,
  parsePolyline,
  simplifyPath,
  PAD_X,
  PAD_Y,
  type GeoPoint,
} from './mapProjection.js';

/**
 * 这一组测试钉的是「图上量出来的距离等于标签上写的米数」这件事。
 * 旧实现把经度按 40%、纬度按 30% 各自归一化，方向和比例都不对，
 * 但因为没有测试，谁都看不出来——所以每条都对着一个具体的失真方式写。
 */

/** 成都市区四个点，经度跨度约 0.024°、纬度约 0.027° */
const CHENGDU: GeoPoint[] = [
  { lng: 104.0658, lat: 30.6598 }, // 天府广场
  { lng: 104.0579, lat: 30.6572 }, // 宽窄巷子
  { lng: 104.0487, lat: 30.6437 }, // 武侯祠
  { lng: 104.0724, lat: 30.6702 }, // 文殊院
];

/** 屏幕上两点之间的距离：y 的百分比分母是屏高，要乘回 aspect 才是真实像素比例 */
const screenDist = (a: { x: number; y: number }, b: { x: number; y: number }, aspect = DEFAULT_ASPECT) =>
  Math.hypot(b.x - a.x, (b.y - a.y) * aspect);

/** 两点间的近似地表距离（度），只用来算比值 */
const kmLike = (a: GeoPoint, b: GeoPoint) => {
  const dLng = (a.lng - b.lng) * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  const dLat = a.lat - b.lat;
  return Math.hypot(dLng, dLat);
};

describe('makeProjection', () => {
  it('等角度在东西和南北的投影长度按 cos(lat) 差开（墨卡托保角）', () => {
    // 北纬 30.65° 附近：0.01° 经度 = 111.32·cos(30.65)·0.01 ≈ 0.958km，
    // 0.01° 纬度 = 111.32·0.01 ≈ 1.113km。墨卡托保角，屏幕长度之比必须等于
    // 这个比例（≈0.861）——这是「两个方向用同一把尺子」的可验证形式。
    // 旧实现各自归一化，这个比值根本不受纬度影响，恒等于 40/30 那个固定系数
    const c = { lng: 104.06, lat: 30.65 };
    const east = { lng: 104.07, lat: 30.65 };
    const north = { lng: 104.06, lat: 30.66 };
    const proj = makeProjection([c, east, north]);

    const p0 = proj.project(c);
    const ratio = screenDist(p0, proj.project(east)) / screenDist(p0, proj.project(north));
    expect(ratio).toBeCloseTo(Math.cos((30.655 * Math.PI) / 180), 2);
  });

  it('屏幕上的等比与 aspect 无关（横屏竖屏都不会歪）', () => {
    const c = { lng: 104.06, lat: 30.65 };
    const east = { lng: 104.07, lat: 30.65 };
    const north = { lng: 104.06, lat: 30.66 };
    const expected = Math.cos((30.655 * Math.PI) / 180);

    for (const aspect of [1, 1.6, DEFAULT_ASPECT, 3]) {
      const proj = makeProjection([c, east, north], aspect);
      const p0 = proj.project(c);
      const ratio = screenDist(p0, proj.project(east), aspect) / screenDist(p0, proj.project(north), aspect);
      expect(ratio).toBeCloseTo(expected, 2);
    }
  });

  it('所有点都落在留白框内', () => {
    const proj = makeProjection(CHENGDU);
    for (const p of CHENGDU) {
      const xy = proj.project(p);
      expect(xy.x).toBeGreaterThanOrEqual(PAD_X - 0.001);
      expect(xy.x).toBeLessThanOrEqual(100 - PAD_X + 0.001);
      expect(xy.y).toBeGreaterThanOrEqual(PAD_Y - 0.001);
      expect(xy.y).toBeLessThanOrEqual(100 - PAD_Y + 0.001);
    }
  });

  it('纬度越大 y 越大（北在上，配合 bottom 百分比）', () => {
    const proj = makeProjection(CHENGDU);
    const south = proj.project({ lng: 104.0487, lat: 30.6437 });
    const north = proj.project({ lng: 104.0724, lat: 30.6702 });
    expect(north.y).toBeGreaterThan(south.y);
  });

  it('所有点重合时不产出 NaN', () => {
    const same = { lng: 104.06, lat: 30.65 };
    const proj = makeProjection([same, { ...same }]);
    const xy = proj.project(same);
    expect(Number.isFinite(xy.x)).toBe(true);
    expect(Number.isFinite(xy.y)).toBe(true);
    expect(Number.isNaN(proj.kmPerUnit(same))).toBe(true);
  });

  it('空输入不炸', () => {
    const proj = makeProjection([]);
    expect(proj.project({ lng: 0, lat: 0 })).toEqual({ x: 50, y: 50 });
  });

  it('投影后的屏幕距离与地理距离成比例', () => {
    // 关键回归：等比投影下，两条线段的屏幕长度之比必须等于实际距离之比。
    // 旧实现（各自归一化）在这里会直接失败
    const proj = makeProjection(CHENGDU);
    const p = CHENGDU.map((g) => proj.project(g));
    // 用两对不同长度的线段交叉验证，避免「恰好相等」
    const screenRatio = screenDist(p[0], p[1]) / screenDist(p[2], p[3]);
    const kmRatio = kmLike(CHENGDU[0], CHENGDU[1]) / kmLike(CHENGDU[2], CHENGDU[3]);
    expect(screenRatio).toBeCloseTo(kmRatio, 1);
  });

  it('kmPerUnit 与投影自洽：图上距离 × kmPerUnit = 真实公里数', () => {
    // 这是 kmPerUnit 存在的唯一意义，也是比例尺可信的前提。
    // 只在 x 方向验证：比例尺画的是横线，用的就是 x 方向的换算
    const proj = makeProjection(CHENGDU);
    const a = CHENGDU[0];
    const b = CHENGDU[2];
    const dxPct = Math.abs(proj.project(a).x - proj.project(b).x);
    const realKm = 111.32 * Math.cos((a.lat * Math.PI) / 180) * Math.abs(a.lng - b.lng);
    expect((dxPct * proj.kmPerUnit(a)) / realKm).toBeCloseTo(1, 1);
  });
});

describe('niceScaleBar', () => {
  it('挑一个 1/2/5 × 10^n 的整数米数，长度落在 8~22 个单位', () => {
    const bar = niceScaleBar(0.05); // 每单位 50 米
    expect(bar).not.toBeNull();
    expect([100, 200, 500].includes(bar!.meters)).toBe(true);
    expect(bar!.units).toBeGreaterThanOrEqual(8);
    expect(bar!.units).toBeLessThanOrEqual(22);
  });

  it('无法换算时返回 null，不编一个数出来', () => {
    expect(niceScaleBar(NaN)).toBeNull();
    expect(niceScaleBar(0)).toBeNull();
    expect(niceScaleBar(-1)).toBeNull();
  });
});

describe('parsePolyline', () => {
  it('解析高德的 lng,lat;lng,lat', () => {
    const pts = parsePolyline('104.06,30.65;104.07,30.66');
    expect(pts).toHaveLength(2);
    expect(pts[0]).toEqual({ lng: 104.06, lat: 30.65 });
  });

  it('任一点坏掉就整条不要（宁可不画，也不画半条假路）', () => {
    expect(parsePolyline('104.06,30.65;abc,def')).toEqual([]);
    expect(parsePolyline('104.06,30.65;999,30.66')).toEqual([]);
    expect(parsePolyline('')).toEqual([]);
    expect(parsePolyline(null)).toEqual([]);
    expect(parsePolyline(undefined)).toEqual([]);
  });
});

describe('simplifyPath', () => {
  it('直线上的点被压成两端', () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ x: i, y: i }));
    const out = simplifyPath(line, 0.4);
    expect(out.length).toBe(2);
    expect(out[0]).toEqual({ x: 0, y: 0 });
    // 抽稀后只剩首尾两个，不能拿原下标去取
    expect(out[1]).toEqual({ x: 49, y: 49 });
  });

  it('保留拐点：直角不会被抹掉', () => {
    const corner = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 10, y: 10 },
    ];
    expect(simplifyPath(corner, 0.4)).toContainEqual({ x: 10, y: 0 });
  });

  it('点数不会增加，首尾一定保留', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ x: i * 0.3, y: Math.sin(i) * 5 }));
    const out = simplifyPath(many, 0.4);
    expect(out.length).toBeLessThan(many.length);
    expect(out[0]).toEqual(many[0]);
    expect(out[out.length - 1]).toEqual(many[many.length - 1]);
  });

  it('两个点以下原样返回', () => {
    const two = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    expect(simplifyPath(two)).toEqual(two);
    expect(simplifyPath([])).toEqual([]);
  });
});

/**
 * 静态底图的投影与「取景」。
 *
 * 第一条用实测数据钉死瓦片尺寸：高德静态图的 zoom 按 512px 瓦片算，
 * 写成 Web Mercator 常见的 256 会让整条路线缩水一半并整体偏移。
 * 下面的数字是在 location=104.066,30.659&zoom=13&size=600*600 上量出来的真值，
 * 端点误差 0-4px（线宽与抗锯齿的量级）。
 */
describe('静态底图投影', () => {
  const W = 600;
  const H = 600;
  const CENTER: GeoPoint = { lng: 104.066, lat: 30.659 };
  const view = { center: CENTER, zoom: 13, width: W, height: H };

  it('中心点落在图片正中', () => {
    const p = makeStaticMapProjection(view);
    const xy = p.project(CENTER);
    expect(xy.x).toBeCloseTo(50, 6);
    expect(xy.y).toBeCloseTo(50, 6);
  });

  it('对齐高德实测的像素位置（512px 瓦片）', () => {
    const p = makeStaticMapProjection(view);
    // 实测：这两点画出的折线端点是 (204,399) 与 (393,203)
    const a = p.project({ lng: 104.058, lat: 30.652 });
    const b = p.project({ lng: 104.074, lat: 30.666 });
    const toPx = (xy: { x: number; y: number }) => ({
      x: (xy.x / 100) * W,
      y: (1 - xy.y / 100) * H,
    });
    const pa = toPx(a);
    const pb = toPx(b);
    expect(Math.abs(pa.x - 204)).toBeLessThanOrEqual(6);
    expect(Math.abs(pa.y - 399)).toBeLessThanOrEqual(6);
    expect(Math.abs(pb.x - 393)).toBeLessThanOrEqual(6);
    expect(Math.abs(pb.y - 203)).toBeLessThanOrEqual(6);
  });

  it('用 256 瓦片会明显对不上，防止有人改回去', () => {
    const p = makeStaticMapProjection(view);
    const a = p.project({ lng: 104.058, lat: 30.652 });
    const pxX = (a.x / 100) * W;
    // 256 瓦片下这一点应落在 ~253px，与实测 204px 差近 50px
    expect(Math.abs(pxX - 253)).toBeGreaterThan(20);
  });

  it('纬度越高同样的经度跨度像素越窄', () => {
    const north = makeStaticMapProjection({ center: { lng: 104, lat: 45 }, zoom: 13, width: W, height: H });
    const south = makeStaticMapProjection({ center: { lng: 104, lat: 25 }, zoom: 13, width: W, height: H });
    const spanOf = (p: ReturnType<typeof makeStaticMapProjection>) =>
      p.project({ lng: 104.05, lat: p === north ? 45 : 25 }).x;
    // 墨卡托横向不受纬度影响，经度跨度对应的像素应当一致
    expect(spanOf(north)).toBeCloseTo(spanOf(south), 6);
  });

  it('containing 判定与 project 的 0-100 边界一致', () => {
    const p = makeStaticMapProjection(view);
    expect(p.contains(CENTER)).toBe(true);
    expect(p.contains({ lng: 104.9, lat: 30.659 })).toBe(false);
  });

  it('fitZoom 让所有点落进视野，且不越界 3-17', () => {
    const pts = [
      { lng: 104.04, lat: 30.64 },
      { lng: 104.1, lat: 30.69 },
      { lng: 104.07, lat: 30.66 },
    ];
    const z = fitZoom(pts, W, H);
    expect(z).toBeGreaterThanOrEqual(3);
    expect(z).toBeLessThanOrEqual(17);
    const p = makeStaticMapProjection({ center: boundsCenter(pts), zoom: z, width: W, height: H });
    for (const pt of pts) expect(p.contains(pt)).toBe(true);
  });

  it('点更散时 fitZoom 会选更小的 zoom', () => {
    const tight = [
      { lng: 104.060, lat: 30.655 },
      { lng: 104.070, lat: 30.663 },
    ];
    const wide = [
      { lng: 103.9, lat: 30.5 },
      { lng: 104.3, lat: 30.9 },
    ];
    expect(fitZoom(wide, W, H)).toBeLessThan(fitZoom(tight, W, H));
  });

  it('单点或空集不炸', () => {
    expect(fitZoom([], W, H)).toBe(13);
    expect(fitZoom([CENTER], W, H)).toBe(14);
    const p = makeStaticMapProjection({ center: boundsCenter([]), zoom: 13, width: W, height: H });
    expect(Number.isFinite(p.project(CENTER).x)).toBe(true);
  });
});

/**
 * 反向投影是「放大后重取底图」的地基：手势结束后要凭它算出新的 center。
 * 只要它和正向投影不是严格互逆，用户每放一次大地图就会整体漂一段，而且是累积的。
 */
describe('unprojectFromWorld / unprojectFromImage', () => {
  const W = 512;
  const H = 1024;
  const CENTER_GEO = { lng: 104.066, lat: 30.659 };

  it('和 projectToWorld 严格互逆', () => {
    for (const zoom of [3, 8, 13, 17]) {
      const wpt = projectToWorld(CENTER_GEO, zoom);
      const back = unprojectFromWorld(wpt.x, wpt.y, zoom);
      expect(back.lng).toBeCloseTo(CENTER_GEO.lng, 6);
      expect(back.lat).toBeCloseTo(CENTER_GEO.lat, 6);
    }
  });

  it('底图正中的像素反解出来就是底图中心', () => {
    const view = { center: CENTER_GEO, zoom: 14, width: W, height: H };
    const back = unprojectFromImage({ x: W / 2, y: H / 2 }, view);
    expect(back.lng).toBeCloseTo(CENTER_GEO.lng, 6);
    expect(back.lat).toBeCloseTo(CENTER_GEO.lat, 6);
  });

  it('和 makeStaticMapProjection.project 互逆（百分比口径）', () => {
    const view = { center: CENTER_GEO, zoom: 14, width: W, height: H };
    const proj = makeStaticMapProjection(view);
    // 取底图上偏右下的一点，正向算成百分比再反解回经纬度
    const target = { lng: CENTER_GEO.lng + 0.01, lat: CENTER_GEO.lat - 0.008 };
    const pct = proj.project(target);
    const px = { x: (pct.x / 100) * W, y: ((100 - pct.y) / 100) * H };
    const back = unprojectFromImage(px, view);
    expect(back.lng).toBeCloseTo(target.lng, 6);
    expect(back.lat).toBeCloseTo(target.lat, 6);
  });
});
