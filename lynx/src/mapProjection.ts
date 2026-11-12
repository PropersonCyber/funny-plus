/**
 * 地图投影。纯函数，不碰运行时（可被 rstest 直接测）。
 *
 * 为什么单独成模块：投影的三条规则（等比、墨卡托、留白）都会被测试钉住，
 * 而 MapPage 里混着 marker 的防重叠和气泡布局，那部分不适合当纯函数测。
 *
 * 三条规则各自防一个坑：
 *   1. **等比**：以前经度按 40%、纬度按 30% 各自归一化——成都东西向和南北向的实际
 *      尺度完全不同，却被拉成一样长。「图上 1 厘米」在两个方向上不一样长，
 *      用户量出来的距离自然对不上标签上的米数。
 *   2. **墨卡托**：纬度方向按 1/cos(lat) 拉伸，和经度用同一把尺子，投影才保角。
 *      x 和 y 都乘同一个 scale 之后，1 个百分比在两个方向上代表同样的公里数。
 *   3. **留白**：等比缩放后必然有一个方向用不满，居中留白。绝不为「铺满画面」
 *      再拉伸——那就又回到失真了。
 */

export type GeoPoint = { lng: number; lat: number };
export type XY = { x: number; y: number };

/** 投影结果，单位是 0~100 的百分比（和 MapPage 的 left/bottom 百分比对上） */
export type Projection = {
  project: (p: GeoPoint) => XY;
  /** 1 个百分比单位在当前纬度等于多少公里；NaN 表示点全重合、无法换算 */
  kmPerUnit: (p: GeoPoint) => number;
};

/**
 * 归一化网格的边距。marker 是 52px 高的水滴 + 右侧文字标签，贴边会被裁掉。
 * 横向留得比纵向多：气泡的尖角在底部正中，但标签往右伸，右边要宽松些。
 */
export const PAD_X = 16;
export const PAD_Y = 12;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * 墨卡托 y：dy/dlat = 1/cos(lat)。输出的是**弧度**单位，不是度——
 * x 必须也换成弧度（见 mercatorX），两者才是同一把尺子，
 * 否则经度按「度」、纬度按「弧度」混算，南北会被压缩 1/0.017 倍（实测差 49 倍）。
 */
const mercatorY = (lat: number): number => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

/** 墨卡托 x：经度转弧度。和 mercatorY 同量纲，这才叫等比 */
const mercatorX = (lng: number): number => (lng * Math.PI) / 180;

/**
 * 地球半径（公里）。
 * 墨卡托空间里 1 个弧度单位在纬度 φ 处的实际长度是 R·cos(φ)：越靠北越短，
 * 这正是墨卡托把高纬拉大的来源。所以「1 个百分比是多少公里」必须带纬度，不能是常数。
 */
const EARTH_RADIUS_KM = 6371.0088;

/**
 * 屏高 / 屏宽。x 和 y 的百分比分母不同（屏宽 vs 屏高），
 * 同一个百分比在两个方向上的像素长度差 aspect 倍，投影必须按它补偿，
 * 否则「等比」只在百分比空间成立、在屏幕上是歪的。
 * 默认 2.16 = MapPage 里 SVG viewBox 的 216/100，真机 iPhone 也在这个量级。
 */
export const DEFAULT_ASPECT = 2.16;


export function makeProjection(points: GeoPoint[], aspect: number = DEFAULT_ASPECT): Projection {
  if (points.length === 0) {
    return { project: () => ({ x: 50, y: 50 }), kmPerUnit: () => NaN };
  }

  // 经度和纬度都先转进墨卡托弧度空间：同一把尺子，才能等比
  const xs = points.map((p) => mercatorX(p.lng));
  const ys = points.map((p) => mercatorY(p.lat));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const spanX = maxX - minX;
  const spanY = maxY - minY;

  // 所有点重合（当天只去一个地方，或两个点坐标一致）：居中放，而不是除零后
  // 炸成 NaN 把整个 marker 摆到屏幕外
  const degenerate = spanX < 1e-12 && spanY < 1e-12;

  const innerW = 100 - PAD_X * 2;
  const innerH = 100 - PAD_Y * 2;

  // 等比：x 走「百分比 / 墨卡托弧度」，y 走同一把尺子但因为分母是屏高，
  // 要按 aspect 再收一次，两边才能在屏幕上等长。谁更紧就用谁，另一边居中留白
  const scale = degenerate ? 0 : Math.min(innerW / spanX, (innerH * aspect) / spanY);

  const usedW = spanX * scale;
  const usedH = (spanY * scale) / aspect;
  const offsetX = PAD_X + (innerW - usedW) / 2;
  // y 用 bottom 百分比，所以从下边界往上排
  const offsetY = PAD_Y + (innerH - usedH) / 2;

  const project = (p: GeoPoint): XY => {
    if (degenerate) return { x: 50, y: 50 };
    // x 和 y 都在弧度空间里，y 额外除以 aspect——这是「屏幕上等比」的全部内容
    const x = offsetX + (mercatorX(p.lng) - minX) * scale;
    const y = offsetY + ((mercatorY(p.lat) - minY) * scale) / aspect;
    return { x: clamp(x, 0, 100), y: clamp(y, 0, 100) };
  };

  // 1 个 x 百分比 = (1/scale) 个墨卡托弧度，而 1 个弧度的实际长度是 R·cos(lat)，
  // 所以每百分比对应的公里数要带纬度。比例尺是横线，用 x 方向的换算即可
  // （上面已经保证 y 方向的每像素公里数与 x 相同）
  const kmPerUnit = (p: GeoPoint): number => {
    if (degenerate || scale <= 0) return NaN;
    return (EARTH_RADIUS_KM * Math.cos((p.lat * Math.PI) / 180)) / scale;
  };

  return { project, kmPerUnit };
}

/** 标尺：取 1/2/5 × 10^n 米，让长度落在 8~22 个百分比单位之间 */
export function niceScaleBar(kmPerUnit: number): { meters: number; units: number } | null {
  if (!Number.isFinite(kmPerUnit) || kmPerUnit <= 0) return null;
  const candidates = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
  for (const meters of candidates) {
    const units = meters / 1000 / kmPerUnit;
    if (units >= 8 && units <= 22) return { meters, units };
  }
  return null;
}

/**
 * 高德返回的 polyline 是「lng,lat;lng,lat;...」。
 * 任一点解析失败就整条不要——宁可退回直连，也不画半条假路。
 */
export function parsePolyline(raw: unknown): GeoPoint[] {
  if (typeof raw !== 'string' || !raw) return [];
  const out: GeoPoint[] = [];
  for (const pair of raw.split(';')) {
    const [lngRaw, latRaw] = pair.split(',');
    const lng = Number(lngRaw);
    const lat = Number(latRaw);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return [];
    if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return [];
    out.push({ lng, lat });
  }
  return out;
}

/**
 * 折线抽稀：一段 16km 的路高德可能给上千个点，全塞进 SVG path 会让渲染树爆掉
 * （Lynx 按节点数算开销，一条几千段的 path 在真机上直接掉帧）。
 * Douglas-Peucker 保留形状，把点数压到几十个。容差单位是百分比，0.4 ≈ 一个圆点半径。
 */
export function simplifyPath(points: XY[], tolerance = 0.4): XY[] {
  if (points.length <= 2) return points;

  const sqTol = tolerance * tolerance;
  const sqSegDist = (p: XY, a: XY, b: XY): number => {
    let x = a.x;
    let y = a.y;
    let dx = b.x - x;
    let dy = b.y - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) {
        x = b.x;
        y = b.y;
      } else if (t > 0) {
        x += dx * t;
        y += dy * t;
      }
    }
    dx = p.x - x;
    dy = p.y - y;
    return dx * dx + dy * dy;
  };

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];

  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maxSq = 0;
    let idx = -1;
    for (let i = first + 1; i < last; i++) {
      const sq = sqSegDist(points[i], points[first], points[last]);
      if (sq > maxSq) {
        maxSq = sq;
        idx = i;
      }
    }
    if (maxSq > sqTol && idx > 0) {
      keep[idx] = 1;
      stack.push([first, idx], [idx, last]);
    }
  }

  const out: XY[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/* ============================================================
 * 静态底图（高德 /v3/staticmap）用的投影
 *
 * 和上面 makeProjection 的区别：
 *   makeProjection 是「把点铺满屏幕」，缩放比例由点集自己决定 —— 配合自绘插画用；
 *   这里反过来，屏幕上的缩放由**底图 zoom** 决定，点只能去适应它。
 * 两套不能混用：拿 makeProjection 去配真底图，每换一天行程底图就得跟着变 zoom，
 * 而静态图是按固定 zoom 出的，结果就是路线和路网对不上。
 * ============================================================ */

/** 经纬度 → 世界像素坐标（Web Mercator，与高德静态图内部一致） */
/**
 * 高德静态图的 zoom 是按 **512px 瓦片**算的，不是 Web Mercator 常见的 256px。
 *
 * 这是实测标定出来的，不是抄来的：同一条折线在 location/zoom/size 不变时，
 * 用 256 预测出的端点会整体偏 ~50px、线长差 2.048 倍；换成 512 后端点误差 0-4px、
 * 长度比 1.024（残差是线宽和抗锯齿）。写死 256 的话，路线会整体缩水一半且位置偏移。
 */
const AMAP_STATIC_TILE = 512;
export function projectToWorld(p: GeoPoint, zoom: number): { x: number; y: number } {
  const scale = AMAP_STATIC_TILE * Math.pow(2, zoom);
  const x = ((p.lng + 180) / 360) * scale;
  const sinLat = Math.sin((p.lat * Math.PI) / 180);
  // 极区会被拉飞，夹到 ±85.05（墨卡托的极点），和各家底图的做法一致
  const clamped = Math.max(-0.9999, Math.min(0.9999, sinLat));
  const y = (0.5 - Math.log((1 + clamped) / (1 - clamped)) / (4 * Math.PI)) * scale;
  return { x, y };
}

export type StaticMapView = {
  center: GeoPoint;
  zoom: number;
  /** 底图像素尺寸（不乘 scale=2，那个只影响清晰度不影响覆盖范围） */
  width: number;
  height: number;
};

export type StaticMapProjection = {
  /** 返回屏幕百分比坐标，和 MapPage 里 left/bottom 的百分比同一套 */
  project: (p: GeoPoint) => XY;
  /** 点是否落在底图范围内；范围外的点画出来会飘在留白里，调用方据此决定要不要画 */
  contains: (p: GeoPoint) => boolean;
  /** 1 个 x 百分比代表多少公里，用于比例尺 */
  kmPerUnit: (p: GeoPoint) => number;
};

export function makeStaticMapProjection(view: StaticMapView): StaticMapProjection {
  const { center, zoom, width, height } = view;
  const cw = projectToWorld(center, zoom);

  /** 世界像素 → 图片内像素（相对图片左上角） */
  const toImagePx = (p: GeoPoint) => {
    const wpt = projectToWorld(p, zoom);
    return { x: wpt.x - cw.x + width / 2, y: wpt.y - cw.y + height / 2 };
  };

  const project = (p: GeoPoint): XY => {
    const px = toImagePx(p);
    // 图片像素 → 百分比。y 转成「从底部算」，因为 MapPage 用 bottom 定位
    return { x: (px.x / width) * 100, y: (1 - px.y / height) * 100 };
  };

  const contains = (p: GeoPoint): boolean => {
    const px = toImagePx(p);
    return px.x >= 0 && px.x <= width && px.y >= 0 && px.y <= height;
  };

  // 1 个百分比 = width/100 像素；zoom 下 1 像素对应的弧度是 2π/(512·2^zoom)
  const kmPerUnit = (p: GeoPoint): number => {
    const mPerPx = (2 * Math.PI * EARTH_RADIUS_KM * Math.cos((p.lat * Math.PI) / 180)) /
      (AMAP_STATIC_TILE * Math.pow(2, zoom));
    return mPerPx * (width / 100);
  };

  return { project, contains, kmPerUnit };
}

/**
 * 给一组点选一个合适的 zoom：让所有点都落进底图的可视区，并留出边距。
 *
 * 只在 3~17 里取整（高德静态图的有效区间，再大也不给）。返回的是能让「最远两点」
 * 刚好塞进 (width*usage, height*usage) 的最大 zoom —— 取最大而不是居中，
 * 因为用户更希望看清细节，铺得开不如看得清。
 */
export function fitZoom(
  points: GeoPoint[],
  width: number,
  height: number,
  usage = 0.78
): number {
  if (points.length === 0) return 13;
  if (points.length === 1) return 14;

  let best = 3;
  for (let z = 17; z >= 3; z--) {
    const pts = points.map((p) => projectToWorld(p, z));
    const spanX = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
    const spanY = Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y));
    if (spanX <= width * usage && spanY <= height * usage) {
      best = z;
      break;
    }
  }
  return best;
}

/** 点集的中心（用世界坐标的包围盒中心，不是简单经纬度平均：跨日期变更线时前者才对） */
export function boundsCenter(points: GeoPoint[]): GeoPoint {
  if (points.length === 0) return { lng: 0, lat: 0 };
  const lngs = points.map((p) => p.lng);
  const lats = points.map((p) => p.lat);
  return {
    lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
    lat: (Math.min(...lats) + Math.max(...lats)) / 2
  };
}
