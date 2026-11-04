import { describe, expect, it } from '@rstest/core';

import {
  clampView,
  Gesture,
  IDENTITY,
  isIdentity,
  MAX_SCALE,
  MIN_SCALE,
  project,
  unproject,
  zoomBy,
} from './mapGesture.js';

/**
 * 手势这一层最容易出的问题是「地图被拖跑」和「缩放时手指下的点漂移」，
 * 所以测试都对着这两件事写，而不是只验函数能跑通。
 */

const P = (x: number, y: number) => ({ x, y });

describe('clampView', () => {
  it('scale 夹在上下限之间', () => {
    expect(clampView({ scale: 0.1, dx: 0, dy: 0 }).scale).toBe(MIN_SCALE);
    expect(clampView({ scale: 99, dx: 0, dy: 0 }).scale).toBe(MAX_SCALE);
  });

  it('1 倍时不允许任何平移（否则地图能被推开、露出空白）', () => {
    const v = clampView({ scale: 1, dx: 40, dy: -40 });
    expect(v.dx).toBe(0);
    expect(v.dy).toBe(0);
  });

  it('放大后平移量有上界：内容边缘最多贴到视口边缘', () => {
    const v = clampView({ scale: 2, dx: 9999, dy: -9999 });
    const max = ((2 - 1) * 100) / 2 / 2; // 25
    expect(v.dx).toBe(max);
    expect(v.dy).toBe(-max);
  });
});

describe('project / unproject', () => {
  it('1 倍无平移时原样返回', () => {
    expect(project(IDENTITY, 30, 70)).toEqual({ x: 30, y: 70 });
  });

  it('以中心为锚放大：中心点不动，其它点按倍数离开中心', () => {
    const v = { scale: 2, dx: 0, dy: 0 };
    expect(project(v, 50, 50)).toEqual({ x: 50, y: 50 });
    // (60,50) 离中心 10，放大 2 倍变 20
    expect(project(v, 60, 50).x).toBeCloseTo(70, 5);
  });

  it('unproject 是 project 的逆运算', () => {
    const v = { scale: 2.5, dx: 7, dy: -3 };
    for (const p of [P(10, 20), P(50, 50), P(90, 80)]) {
      const back = unproject(v, project(v, p.x, p.y).x, project(v, p.x, p.y).y);
      expect(back.x).toBeCloseTo(p.x, 6);
      expect(back.y).toBeCloseTo(p.y, 6);
    }
  });
});

describe('zoomBy', () => {
  it('放大后原视口中心对应的内容点仍在中心', () => {
    const z = zoomBy(IDENTITY, 2);
    expect(z.scale).toBe(2);
    expect(project(z, 50, 50)).toEqual({ x: 50, y: 50 });
  });

  it('放大再缩回，参数复原（地图能回到原位）', () => {
    const zoomed = zoomBy(IDENTITY, 3);
    expect(isIdentity(zoomBy(zoomed, 1 / 3))).toBe(true);
  });

  it('不会低于 MIN_SCALE，也不会高于 MAX_SCALE', () => {
    expect(zoomBy(IDENTITY, 0.1).scale).toBe(MIN_SCALE);
    expect(zoomBy(IDENTITY, 100).scale).toBe(MAX_SCALE);
  });
});

describe('Gesture 单指平移', () => {
  it('放大后手指位移 1:1 映射成屏幕位移', () => {
    // 为什么用 2 倍起手：1 倍时内容正好铺满视口，没有可拖的余量，
    // clampView 会把平移夹成 0 —— 这是正确行为，不是 bug（下一条专门验它）
    const g = new Gesture();
    g.begin({ scale: 2, dx: 0, dy: 0 }, [P(100, 100)]);
    const v = g.move([P(120, 100)])!;
    expect(v.dx).toBeCloseTo(20, 5);
  });

  it('1 倍时不产生平移', () => {
    const g = new Gesture();
    g.begin(IDENTITY, [P(100, 100)]);
    expect(g.move([P(140, 100)])!.dx).toBe(0);
  });

  it('没 begin 就 move 不出结果', () => {
    expect(new Gesture().move([P(10, 10)])).toBeNull();
  });

  it('手指数量变了就返回 null（调用方要重新 begin）', () => {
    const g = new Gesture();
    g.begin(IDENTITY, [P(0, 0)]);
    expect(g.move([P(10, 0), P(20, 0)])).toBeNull();
  });

  it('三指忽略，不参与变换', () => {
    const g = new Gesture();
    g.begin(IDENTITY, [P(0, 0), P(10, 0), P(20, 0)]);
    expect(g.active).toBe(false);
    expect(g.move([P(50, 50), P(60, 60), P(70, 70)])).toBeNull();
  });
});

describe('Gesture 双指缩放', () => {
  it('间距翻倍就是放大一倍', () => {
    const g = new Gesture();
    g.begin(IDENTITY, [P(80, 100), P(120, 100)]); // 间距 40
    const v = g.move([P(60, 100), P(140, 100)])!; // 间距 80
    expect(v.scale).toBeCloseTo(2, 5);
  });

  it('缩放时手指中点下的内容点不漂移（最容易做错的一处）', () => {
    // 锚点选在离中心不远、又不会撞边界的位置：越靠边，锚定所需的平移越大，
    // 最终会被 clampView 拦住，那是另一条规则（下一条专门验）
    const g = new Gesture();
    const base = { scale: 1, dx: 0, dy: 0 };
    g.begin(base, [P(50, 100), P(70, 100)]); // 中点 60，间距 20
    const v = g.move([P(40, 100), P(80, 100)])!; // 间距 40 → 2 倍
    expect(v.scale).toBeCloseTo(2, 5);

    // 起始中点(60) 对应的内容坐标，缩放后应仍落在屏幕 60
    const content = unproject(base, 60, 100).x;
    expect(project(v, content, 50).x).toBeCloseTo(60, 5);
  });

  it('锚点靠近边缘时优先保证不露空白，允许锚点轻微偏移', () => {
    // 刻意的取舍：宁可锚点偏一点，也不让画面出现空白
    const g = new Gesture();
    g.begin(IDENTITY, [P(5, 100), P(95, 100)]);
    const v = g.move([P(0, 100), P(100, 100)])!;
    const maxShift = ((v.scale - 1) * 100) / 2 / v.scale;
    expect(Math.abs(v.dx)).toBeLessThanOrEqual(maxShift + 1e-6);
  });

  it('超出上限时停在 MAX_SCALE，不会无限放大', () => {
    const g = new Gesture();
    g.begin(IDENTITY, [P(0, 100), P(10, 100)]);
    expect(g.move([P(0, 100), P(10000, 100)])!.scale).toBe(MAX_SCALE);
  });

  it('起始间距太小（两指并拢）不成手势，避免除零', () => {
    const g = new Gesture();
    g.begin(IDENTITY, [P(100, 100), P(102, 100)]);
    expect(g.move([P(0, 100), P(200, 100)])).toBeNull();
  });
});
