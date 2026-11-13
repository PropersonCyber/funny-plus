/**
 * 地图视图变换（缩放 + 平移）。纯函数 + 一个极小的状态机，可在 rstest 里直接测。
 *
 * 为什么要自己算：Lynx 只提供 bindtouchstart / touchmove / touchend，没有 pinch 手势，
 * 也没有地图组件。缩放靠两指间距比、平移靠单指位移，都得手算。
 *
 * 坐标约定（和 MapPage 一致）：
 *   内容坐标是 0~100 的百分比，视口变换是
 *     screen = (content - 50) * scale + 50 + offset
 *   也就是说 offset 是「屏幕百分比」，缩放以画面正中为锚。
 */

export type View = {
  /** 1 = 刚好铺满视口；上限 MAX_SCALE */
  scale: number;
  /** 平移量，屏幕百分比 */
  dx: number;
  dy: number;
};

export const IDENTITY: View = { scale: 1, dx: 0, dy: 0 };
/**
 * 缩小的下限。允许缩到 0.5（视野比「铺满」大一倍），因为缩到底就是「退一步看全貌」，
 * 这是真地图该有的行为。再小的话内容会挤成一团，也没法从取景上表达出来。
 */
export const MIN_SCALE = 0.5;
export const MAX_SCALE = 5;
/** 双指间距小于这个值就当还没张开，避免除零把 scale 炸到无穷 */
const MIN_PINCH_DIST = 8;
/** 内容坐标的范围中点，缩放以它为锚 */
const CENTER = 50;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** 把 -0 归一成 0：否则 toBe(0) 之类的相等判断会莫名其妙挂掉 */
const zero = (n: number) => (Math.abs(n) < 1e-9 ? 0 : n);

/**
 * 把视口夹回合法范围。
 *
 * 边界规则：内容放大 scale 倍后，左右各多出 (scale-1)/2 个屏幕宽度可以逛，
 * 换算成屏幕百分比就是 ((scale-1)*100/2)/scale。1 倍时这个值是 0——
 * 正好铺满，没得拖，这是对的，不是 bug。
 *
 * 不做这个夹紧的话，用户能把地图拖成一片空白，而且缩回 1 倍后偏移还在，
 * 地图会「跑掉」回不来。
 */
export function clampView(v: View): View {
  const scale = clamp(v.scale, MIN_SCALE, MAX_SCALE);
  // scale < 1 时「内容比视口小」，理论上能拖的范围是负的 —— 夹到 0，
  // 不能放任它算成负数，否则 clamp 的下界会跑到上界外面，平移被强行掰到一个偏移值上
  const maxShift = Math.max(0, ((scale - 1) * 100) / 2 / scale);
  return {
    scale,
    dx: zero(clamp(v.dx, -maxShift, maxShift)),
    dy: zero(clamp(v.dy, -maxShift, maxShift)),
  };
}

export const isIdentity = (v: View): boolean =>
  Math.abs(v.scale - 1) < 1e-3 && Math.abs(v.dx) < 0.1 && Math.abs(v.dy) < 0.1;

/** 内容坐标 → 屏幕坐标 */
export function project(v: View, x: number, y: number): { x: number; y: number } {
  return {
    x: (x - CENTER) * v.scale + CENTER + v.dx,
    y: (y - CENTER) * v.scale + CENTER + v.dy,
  };
}

/** 屏幕坐标 → 内容坐标。缩放的锚点计算要用它 */
export function unproject(v: View, x: number, y: number): { x: number; y: number } {
  const s = v.scale || 1;
  return {
    x: (x - CENTER - v.dx) / s + CENTER,
    y: (y - CENTER - v.dy) / s + CENTER,
  };
}

/**
 * 以某个屏幕点为锚，把视图缩放到 targetScale。
 *
 * 这是整个手势里最容易写错的地方：锚点下的内容点在缩放前后必须落在同一位置，
 * 否则地图会从指缝里滑走。推导：
 *   设锚点下的内容坐标 c = unproject(v, anchor)
 *   缩放后要满足 project(next, c) = anchor
 *   ⇒ anchor = (c - 50) * target + 50 + dx  ⇒  dx = anchor - (c - 50) * target - 50
 */
export function zoomAt(v: View, targetScale: number, anchor: { x: number; y: number }): View {
  const scale = clamp(targetScale, MIN_SCALE, MAX_SCALE);
  const c = unproject(v, anchor.x, anchor.y);
  return clampView({
    scale,
    dx: anchor.x - (c.x - CENTER) * scale - CENTER,
    dy: anchor.y - (c.y - CENTER) * scale - CENTER,
  });
}

/** 以视口中心为锚放大/缩小一档，给双击和 +/− 按钮用 */
export function zoomBy(v: View, factor: number): View {
  return zoomAt(v, v.scale * factor, { x: CENTER, y: CENTER });
}

type Pt = { x: number; y: number };

const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * 手势状态机：一次手势从 touchstart 到 touchend，期间相对「基准视图」算增量。
 *
 * 三条必须守住的规则：
 *   1. 以手势中点为锚缩放，手指底下的点不能漂；
 *   2. 单指↔双指切换时重置基准——松一根手指的瞬间间距会突变，不重置会跳一大格；
 *   3. 三指以上直接忽略，别和系统手势打架。
 */
export class Gesture {
  private base: View | null = null;
  private startPts: Pt[] = [];

  begin(view: View, pts: Pt[]): void {
    if (pts.length !== 1 && pts.length !== 2) {
      this.base = null;
      this.startPts = [];
      return;
    }
    this.base = { ...view };
    this.startPts = pts.map((p) => ({ ...p }));
  }

  /** 返回 null = 这次 move 不该改视图（没基准 / 手指数量变了） */
  move(pts: Pt[]): View | null {
    const base = this.base;
    if (!base || pts.length !== this.startPts.length) return null;

    if (pts.length === 1) {
      // 单指拖：手指位移直接映射成屏幕位移，不用再除 scale——
      // offset 本身就是屏幕单位，除一次会把「拖 1cm 走 1cm」变成「走 2cm」
      const [p0] = this.startPts;
      const [p1] = pts;
      return clampView({ scale: base.scale, dx: base.dx + (p1.x - p0.x), dy: base.dy + (p1.y - p0.y) });
    }

    const [a0, b0] = this.startPts;
    const [a1, b1] = pts;
    const d0 = dist(a0, b0);
    if (d0 < MIN_PINCH_DIST) return null;
    const d1 = dist(a1, b1);

    // 缩放比 = 当前间距 / 起始间距；锚点取起始中点，再按中点位移补偿平移。
    // 两指同时移动时（一边张开一边平移）这两件事要一起做，否则只认缩放会「黏手」
    const target = base.scale * (d1 / d0);
    const m0 = mid(a0, b0);
    const m1 = mid(a1, b1);
    const scaled = zoomAt(base, target, m0);
    return clampView({
      scale: scaled.scale,
      dx: scaled.dx + (m1.x - m0.x),
      dy: scaled.dy + (m1.y - m0.y),
    });
  }

  /** 松手：清掉基准。调用方在手指数量变化时要重新 begin */
  end(): void {
    this.base = null;
    this.startPts = [];
  }

  get active(): boolean {
    return this.base !== null;
  }
}
