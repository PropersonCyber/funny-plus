import { useCallback, useMemo, useRef, useState } from '@lynx-js/react';

import mapArt from '../../assets/gen/map-bg.jpg';
import mascotPeek from '../../assets/ip/mascot-peek.png';
import emptyState from '../../assets/ip/empty-state.png';
import markerBase from '../../assets/map/marker-base.png';
import { svgIcon, MAP_ART, COLOR } from '../../icons.js';
import { MOCK } from '../../mock.js';
import type { Demand, Plan } from '../../data.js';
import { distanceKm, placeById } from '../../data.js';
import { track } from '../../track.js';
import { toast } from '../../toast.js';
import styles from './index.module.scss';
import { makeCls } from '../../styles/cls.js';
import {
  makeProjection,
  niceScaleBar,
  simplifyPath,
  PAD_X,
  PAD_Y,
  type GeoPoint,
} from '../../mapProjection.js';
import { legGeometry } from '../../routeGeometry.js';
import { Gesture, IDENTITY, isIdentity, MAX_SCALE, MIN_SCALE, project, zoomBy, type View } from '../../mapGesture.js';

const cls = makeCls(styles);

type Props = {
  demand: Demand;
  plans: Plan[];
  /** 地图要跟行程页同一套方案，否则用户看的路线不是自己选的那条 */
  planIndex: number;
  onPlan: () => void;
  /** 地图第三栏「推荐玩法」直接读接口内容 */
  plays: { id: string; title: string; note: string }[];
  onPlay: (id: string) => void;
};

type Stop = {
  name: string;
  placeId: string;
  tags: string[];
  x: number;
  y: number;
  order: number;
  time: string;
  stay: number;
  ticket: number;
  /** 到上一个点的直线距离，如 1.2km / 900m，地图标签上显示 */
  dist: string;
  /** 真实投影坐标（百分比）。防重叠可能把 marker 挪开，这两个值留作路线与比例尺的基准 */
  trueX: number;
  trueY: number;
  /** 被防重叠挪离了原位——挪过的点要标出来，否则又是一层假精度 */
  moved: boolean;
  /** 挪不开位置了，只留圆形缩略图，不显示文字 */
  crowded: boolean;
};

const VIEWS = [
  { id: 'route', label: '行程路线', short: '路线' },
  { id: 'spots', label: '景点列表', short: '景点' },
  { id: 'play', label: '推荐玩法', short: '玩法' },
] as const;

// 两个 marker 的气泡要隔开多少才不叠：横向算的是圆盘 + 气泡文字宽度，纵向是气泡高度。
// 这两个值配合 SPREAD 的候选偏移，让「挪过的点」仍落在附近一格内，
// 而不是像以前那样被扔到任意格点上去。
const MINDX = 18;
const MINDY = 10;
/** 原位优先，再上下、再左右、最后对角；不做 while ±1 递推，两个坑位互相抢会挂住主线程 */
const SPREAD: [number, number][] = [
  [0, 0],
  [0, 10], [0, -10],
  [17, 0], [-17, 0],
  [17, 10], [-17, 10], [17, -10], [-17, -10],
  [0, 20], [0, -20],
  [24, 20], [-24, 20], [24, -20], [-24, -20],
  [34, 0], [-34, 0],
  [34, 12], [-34, 12], [34, -12], [-34, -12],
  [0, 30], [0, -30],
];

export function MapPage({ demand, plans, planIndex, onPlan, plays, onPlay }: Props) {
  const [dayNo, setDayNo] = useState(1);
  const [view, setView] = useState<'route' | 'spots' | 'play'>('route');
  // 选中某个景点后，卡片区换成该点的详情；换天要清掉，否则 index 指向的是上一天的顺序
  const [picked, setPicked] = useState<number | null>(null);
  const plan = plans[Math.min(planIndex, plans.length - 1)] ?? plans[0];

  /**
   * 地图视口。手势只改这个值，不重算投影——投影是「地理 → 内容坐标」，
   * 缩放平移是「内容坐标 → 屏幕坐标」，两层分开才能拖动时不抖。
   */
  const [mapView, setMapView] = useState<View>(IDENTITY);
  // touch 回调里读不到最新的 state（闭包），用 ref 并存一份
  const viewRef = useRef<View>(IDENTITY);
  const gestureRef = useRef(new Gesture());
  const applyView = useCallback((v: View) => {
    viewRef.current = v;
    setMapView(v);
  }, []);

  /** Lynx 的 touch 事件给 clientX/clientY；拿不到时退回 x/y，别整块手势瞎掉 */
  const ptsOf = (e: any) =>
    (e?.touches ?? []).map((t: any) => ({ x: Number(t.clientX ?? t.x ?? 0), y: Number(t.clientY ?? t.y ?? 0) }));

  const onTouchStart = useCallback((e: any) => {
    const pts = ptsOf(e);
    // 新手指按下时 touchstart 会重放全部触点，基准要跟着重置，
    // 否则双指变三指再变回双指时，间距基准还是旧的，会猛跳一下
    gestureRef.current.begin(viewRef.current, pts);
  }, []);

  const onTouchMove = useCallback((e: any) => {
    const next = gestureRef.current.move(ptsOf(e));
    if (next) applyView(next);
  }, [applyView]);

  const onTouchEnd = useCallback((e: any) => {
    const pts = ptsOf(e);
    // 松一根手指后剩下的那根要继续能拖：以剩余触点重新起基准
    if (pts.length > 0) gestureRef.current.begin(viewRef.current, pts);
    else gestureRef.current.end();
  }, []);

  const resetView = useCallback(() => applyView(IDENTITY), [applyView]);
  const zoomIn = useCallback(() => applyView(zoomBy(viewRef.current, 1.6)), [applyView]);
  const zoomOut = useCallback(() => applyView(zoomBy(viewRef.current, 1 / 1.6)), [applyView]);

  const stops = useMemo<Stop[]>(() => {
    const day = plan?.days.find((d) => d.index === dayNo);
    if (!day) return [];
    const list = day.items
      .map((i) => ({ item: i, place: i.placeId ? placeById(i.placeId) : undefined }))
      .filter((s): s is { item: typeof day.items[number]; place: NonNullable<ReturnType<typeof placeById>> } => !!s.place);

    if (list.length === 0) return [];
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    // 真实等比投影：以前经度按 40%、纬度按 30% 各自归一化，东西向和南北向的比例
    // 完全是两回事，marker 之间的视觉距离对不上标签上的米数。投影规则见 mapProjection.ts
    const proj = makeProjection(list.map((s) => s.place));

    // 景点挨太近时错开，否则标记叠在一起分不清顺序。只错开 y 不够：两个点经度也接近时，
    // 光上下挪会被上下界夹回去。这里按固定候选位逐个试，全试完还挤就只留圆点。
    // 挪过的点要标出来（moved），不能让用户以为 marker 就在那儿——那是另一种假精度。
    const placed: { x: number; y: number }[] = [];
    return list.map((s, idx) => {
      const at = proj.project(s.place);
      let x = at.x;
      let y = at.y;
      let crowded = false;
      let moved = false;
      let ok = false;
      for (const [dx, dy] of SPREAD) {
        const cx = clamp(at.x + dx, PAD_X - 4, 100 - PAD_X + 4);
        const cy = clamp(at.y + dy, PAD_Y - 4, 100 - PAD_Y + 4);
        if (!placed.some((p) => Math.abs(p.x - cx) < MINDX && Math.abs(p.y - cy) < MINDY)) {
          x = cx;
          y = cy;
          ok = true;
          // 候选位 [0,0] 是原位；只要不是它，就是挪过
          moved = dx !== 0 || dy !== 0;
          break;
        }
      }
      if (!ok) {
        // 点太密挪不开：退到「离已有点最远」的格点，圆点好歹分得开，标签收起来
        crowded = true;
        moved = true;
        let bestD = -1;
        for (let gx = 16; gx <= 84; gx += 12) {
          for (let gy = 14; gy <= 86; gy += 10) {
            const d = Math.min(...placed.map((p) => Math.abs(p.x - gx) + Math.abs(p.y - gy)));
            if (d > bestD) {
              bestD = d;
              x = gx;
              y = gy;
            }
          }
        }
      }
      placed.push({ x, y });
      // 距离优先用路段实际行驶距离（高德给的），取不到才退回两点直线：
      // 直线会让用户以为「走过去很近」，而绕路可能是两倍
      const prevPlace = list[idx - 1]?.place;
      const legGeo = prevPlace ? legGeometry(prevPlace.id, s.place.id) : null;
      const distText = legGeo?.distanceM
        ? fmtMeters(legGeo.distanceM)
        : prevPlace
          ? fmtDist(distanceKm(s.place, prevPlace))
          : '';
      return {
        name: s.place.name,
        placeId: s.place.id,
        tags: s.place.tags,
        order: idx + 1,
        x,
        y,
        trueX: at.x,
        trueY: at.y,
        moved,
        time: clock(s.item.startMin),
        stay: s.item.stayMin,
        ticket: s.place.ticket,
        dist: distText,
        crowded,
      };
    });
  }, [plan, dayNo]);

  /** 每段是否有真实折线：没有的用两点直连并标「估算」 */
  const legs = useMemo(() => {
    if (stops.length < 2) return [];
    const ids = stops.map((s) => s.placeId);
    const out: { from: string; to: string; path: GeoPoint[] | null; real: boolean; distanceM?: number }[] = [];
    for (let i = 1; i < ids.length; i++) {
      const geo = legGeometry(ids[i - 1], ids[i]);
      out.push({ from: ids[i - 1], to: ids[i], path: geo?.path ?? null, real: !!geo?.path, distanceM: geo?.distanceM });
    }
    return out;
  }, [stops]);

  /**
   * 路线。有真实折线的段按折线画（车实际走的路），没有的段退回两点直连，
   * 并用虚线区分——用户一眼能看出哪一段是算准的、哪一段只是连了条线。
   *
   * 以前是拿 marker 的**屏幕位置**连贝塞尔，等于把「防重叠挪过的坐标」也当路画了：
   * 挪过的点会把路拽歪，而那条路和真实街道毫无关系。
   * 现在折线先用同一套投影落到百分比坐标，再按 stops 的挪动量整体补偿，
   * 保持「线穿过气泡尖角」的视觉关系。
   */
  const routeSvg = useMemo(() => {
    if (stops.length < 2) return '';
    // 折线要点到 stop 上取它的挪动量，所以先建 id → stop 的索引
    const byId = new Map(stops.map((s) => [s.placeId, s]));

    const day = plan?.days.find((d) => d.index === dayNo);
    const allPlaces = (day?.items ?? [])
      .map((i) => (i.placeId ? placeById(i.placeId) : undefined))
      .filter((p): p is NonNullable<typeof p> => !!p);
    const proj = makeProjection(allPlaces);

    // stops 的 y 是「自下往上」的百分比（配 bottom 用），SVG 的 y 是自上往下，
    // 所以这里必须翻一次；viewBox 高度 216 = 100 × aspect，宽高比已经含在里面，
    // 所以 y 只做翻转、不再乘 aspect。
    // 再套一层视口变换：内容坐标 → 屏幕坐标 → SVG 坐标
    const toSvg = (x: number, y: number) => {
      const p = project(mapView, x, y);
      return { x: p.x, y: ((100 - p.y) / 100) * 216 };
    };

    const solid: string[] = [];
    const dashed: string[] = [];

    for (const leg of legs) {
      const a = byId.get(leg.from);
      const b = byId.get(leg.to);
      if (!a || !b) continue;
      if (!leg.path) {
        // 没有真实折线：两点直连，虚线标出来
        const pa = toSvg(a.x, a.y);
        const pb = toSvg(b.x, b.y);
        dashed.push(`M${pa.x.toFixed(1)} ${pa.y.toFixed(1)}L${pb.x.toFixed(1)} ${pb.y.toFixed(1)}`);
        continue;
      }
      // 折线不按 marker 的挪动量整体平移：marker 会一起动，但路是真实地理，
      // 硬平移会让整条路跟着偏移，反而更不准。误差只体现在首尾这一小段
      const pts = leg.path.map((gp) => {
        const xy = proj.project(gp);
        return toSvg(xy.x, xy.y);
      });
      const thinned = simplifyPath(pts, 0.4);
      // 真实路径不插值：车走的路本来就有直角转弯，Catmull-Rom 会把路口抹成弧线
      solid.push(`M${thinned.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('L')}`);
    }

    if (solid.length === 0 && dashed.length === 0) return '';
    const dSolid = solid.join('');
    const dDashed = dashed.join('');
    const dots = stops
      .map((s) => {
        const p = toSvg(s.x, s.y);
        return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="0.55" fill="#2478F2"/>`;
      })
      .join('');
    // 白描边打底：底图是插画，蓝线直接压上去会和绿地的对比度不够
    const halo = (d: string) =>
      d
        ? `<path d="${d}" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>`
        : '';
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 216" preserveAspectRatio="none">` +
      halo(dSolid) +
      (dSolid ? `<path d="${dSolid}" fill="none" stroke="#2478F2" stroke-width="0.85" stroke-linecap="round" stroke-linejoin="round"/>` : '') +
      halo(dDashed) +
      (dDashed
        ? `<path d="${dDashed}" fill="none" stroke="#7E93D6" stroke-width="0.7" stroke-linecap="round" stroke-dasharray="1.6 1.6"/>`
        : '') +
      dots +
      `</svg>`
    );
  }, [stops, legs, plan, dayNo, mapView]);

  /**
   * 比例尺。它由投影的 kmPerUnit 算出，不是估计值：
   * 图上这一段线的长度就是标签上写的米数，用户可以自己核对点之间是不是真的那么近。
   */
  const scaleBar = useMemo(() => {
    const day = plan?.days.find((d) => d.index === dayNo);
    if (!day) return null;
    const places = day.items
      .map((i) => (i.placeId ? placeById(i.placeId) : undefined))
      .filter((p): p is NonNullable<typeof p> => !!p);
    if (places.length === 0) return null;
    const proj = makeProjection(places);
    // 比例尺必须跟着缩放走：放大 2 倍后同样的屏幕长度只代表一半的实际距离。
    // 不联动的话它就从「可核对的量纲」退化成一条装饰线
    return niceScaleBar(proj.kmPerUnit(places[0]) / mapView.scale);
  }, [plan, dayNo, mapView.scale]);

  /** 比例尺文案：1km 以下按米，避免出现「0.5km」这种读起来别扭的数 */
  const scaleLabel = useMemo(() => {
    if (!scaleBar) return '';
    const m = scaleBar.meters;
    return m >= 1000 ? `${m / 1000}km` : `${m}m`;
  }, [scaleBar]);
  const pickedSpot = picked === null ? undefined : stops.find((s) => s.order === picked);

  const onDay = useCallback((n: number) => {
    setDayNo(n);
    setPicked(null);
  }, []);

  if (!plan) {
    return (
      <view className={cls('page')}>
        <view className={cls('card')}>
          <image src={emptyState} mode="aspectFit" style={{ width: '120px', height: '120px', alignSelf: 'center' }} />
          <text className={cls('card-title')}>还没有可画的路线</text>
          <text className={cls('card-note')}>先规划一次旅行，地图会按当天景点的真实经纬度摆位置。</text>
          <view className={cls('btn-primary')} bindtap={onPlan}>
            <text className={cls('btn-primary-text')}>去规划</text>
          </view>
        </view>
      </view>
    );
  }

  return (
    <view
      className={cls('map-full')}
      bindtouchstart={onTouchStart}
      bindtouchmove={onTouchMove}
      bindtouchend={onTouchEnd}
      bindtouchcancel={onTouchEnd}
    >
      <image
        src={mapArt}
        mode="aspectFill"
        style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }}
      />
      {/* 插画底图只当氛围：压一层淡遮罩，让真实折线是画面上唯一的「路」。
          不压的话，插画里那些假街道会和折线混在一起，等于又在暗示一张假地图 */}
      <view className={cls('map-veil')} />


      <view className={cls('map-top')}>
        <view className={cls('map-top-pill')}>
          <svg content={svgIcon('pin', COLOR.primary)} style={{ width: '15px', height: '15px', marginRight: '5px' }} />
          <text className={cls('map-top-city')}>
            {demand.destination} {plan.days.length}天{plan.days.length > 1 ? `${plan.days.length - 1}晚` : ''}
          </text>
        </view>
        <view className={cls('map-tabs')}>
          {VIEWS.map((v) => (
            <view
              key={v.id}
              className={view === v.id ? cls('map-tab map-tab-on') : cls('map-tab')}
              bindtap={() => setView(v.id)}
            >
              <text className={view === v.id ? cls('map-tab-text on') : cls('map-tab-text')}>{v.short}</text>
            </view>
          ))}
        </view>
        {/* 地图里没有可搜的东西，搜不到就去景点列表找：比弹个空搜索框诚实 */}
        <view
          className={cls('map-top-pill map-top-icon')}
          bindtap={() => {
            setView('spots');
            toast('地图内不做搜索，已切到景点列表');
          }}
        >
          <svg content={svgIcon('search', '#3F5980')} style={{ width: '17px', height: '17px' }} />
        </view>
      </view>

      {routeSvg ? (
        <svg content={routeSvg} style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }} />
      ) : null}

      {stops.map((s) => (
        // 气泡自己承担定位：left/top 落在真实坐标上，再用负 margin 把「尖角尖端」推到该点。
        // 不套 0 尺寸的定位容器——原生 Lynx 会把这种容器里的绝对定位子元素压成 0 宽，
        // 圆图和文字会整个消失（web 端 shrink-to-fit 不会，所以只在真机上暴露）
        <view
          key={s.order}
          className={cls(mkClass(picked, s))}
          style={(() => {
            // marker 跟着视口一起变换；气泡本身尺寸不变（缩放的是地图像素，
            // 不是 UI 元素——否则放大后标签会大到糊住半个屏幕）
            const p = project(mapView, s.x, s.y);
            return { left: `${p.x}%`, bottom: `${p.y}%` };
          })()}
          bindtap={() => {
            const next = picked === s.order ? null : s.order;
            setPicked(next);
            if (next !== null) track('poi_detail_open', { order: next, source: 'marker' });
          }}
        >
          {/* 圆图和尖角用同一张 PNG 底盘（marker-base）：圆环 + 水滴是一体的形状，
              用 CSS 分别画圆和三角时，两者只在单点相切、必然露出接缝。
              底盘只负责白环和尖角，照片另外塞进中间的镂空孔 */}
          <view className={cls('mk-badge')}>
            <image className={cls('mk-base')} src={markerBase} mode="scaleToFill" />
            <image
              className={cls('mk-thumb')}
              src={MAP_ART.thumbs[(s.order - 1) % MAP_ART.thumbs.length]}
              mode="aspectFill"
            />
          </view>
          {/* 位置太密时只留圆图；点开后其它点也收起来，避免标签互相压 */}
          {isCollapsed(picked, s) ? null : (
            <view className={cls('mk-info')}>
              <text className={cls('mk-name')}>{s.name}</text>
              {s.dist ? (
                <view className={cls('mk-dist-row')}>
                  <text className={cls('mk-dist')}>{s.dist}</text>
                  <svg content={svgIcon('chevronRight', '#7E93D6')} style={{ width: '11px', height: '11px' }} />
                </view>
              ) : null}
            </view>
          )}
          {/* 为了不叠在一起被挪过位的点：「~」表示这个气泡的位置是示意，
              真实位置在尖角指向处附近。不标出来，用户量出来的距离就对不上标签 */}
          {s.moved && !s.crowded ? (
            <text className={cls('mk-approx')}>~</text>
          ) : null}
        </view>
      ))}

      {/* 比例尺：这段线多长就是图上标的米数，让「示意图」也带可核对的量纲 */}
      {scaleLabel && scaleBar ? (
        <view className={cls('map-scale')}>
          <view className={cls('map-scale-line')} style={{ width: `${scaleBar.units}%` }} />
          <text className={cls('map-scale-text')}>{scaleLabel}</text>
        </view>
      ) : null}

      {/* 缩放控件：和手势两条路都能用——手势不灵时至少还有按钮能救 */}
      <view className={cls('map-zoom-col')}>
        <view className={cls('map-zoom-btn')} bindtap={zoomIn}>
          <text className={cls('map-zoom-txt')}>+</text>
        </view>
        <view className={cls('map-zoom-btn')} bindtap={zoomOut}>
          <text className={cls('map-zoom-txt')}>−</text>
        </view>
        {/* 只有真的缩放/平移过才给复位入口，否则是个永远灰着的按钮 */}
        {isIdentity(mapView) ? null : (
          <view className={cls('map-zoom-btn')} bindtap={resetView}>
            <text className={cls('map-zoom-reset')}>复位</text>
          </view>
        )}
      </view>

      {/* 定位能力没接入前不放定位按钮：按不到东西的按钮比没有更糟 */}
      <view className={cls('map-fab-col')}>
        <view className={cls('map-fab')} bindtap={() => setView('spots')}>
          <svg content={svgIcon('map', '#2A3A57')} style={{ width: '20px', height: '20px' }} />
        </view>
      </view>

      <view className={cls('map-sheet')}>
        {/* 趴在卡片上沿探头的吉祥物：锚定在卡片顶部 */}
        <image src={mascotPeek} mode="aspectFit" className={cls('sheet-peek')} />
        {pickedSpot ? (
          <view className={cls('poi-card')}>
            <image
              className={cls('poi-thumb')}
              src={MAP_ART.thumbs[(pickedSpot.order - 1) % MAP_ART.thumbs.length]}
              mode="aspectFill"
            />
            <view className={cls('poi-main')}>
              <text className={cls('poi-name')}>{pickedSpot.name}</text>
              <text className={cls('poi-meta')}>
                {pickedSpot.time} 起 · 停留 {pickedSpot.stay} 分 · 门票 ¥{pickedSpot.ticket}
              </text>
              <view className={cls('poi-tags')}>
                {pickedSpot.tags.slice(0, 3).map((t) => (
                  <text key={t} className={cls('poi-tag')}>{t}</text>
                ))}
              </view>
            </view>
            <view className={cls('poi-close')} bindtap={() => setPicked(null)}>
              <text className={cls('poi-close-text')}>×</text>
            </view>
          </view>
        ) : view === 'route' ? (
          <view className={cls('sheet-body')}>
            <view className={cls('sheet-day-row')}>
              <view className={cls('day-chip')} bindtap={() => onDay((dayNo % plan.days.length) + 1)}>
                <text className={cls('day-chip-text')}>第{dayNo}天</text>
              </view>
              <text className={cls('sheet-route')}>
                {stops.length > 0 ? stops.map((s) => s.name).join(' → ') : '这一天没有可定位的点'}
              </text>
              {stops.length > 0 ? (
                <view className={cls('sheet-more')} bindtap={() => setView('spots')}>
                  <svg content={svgIcon('chevronRight', '#2478F2')} style={{ width: '16px', height: '16px' }} />
                </view>
              ) : null}
            </view>

            {/* 当天景点卡：点一张就选中地图上对应的点，两边是同一个 picked */}
            {stops.length > 0 ? (
              <scroll-view className={cls('spot-strip')} scroll-x>
                <view className={cls('spot-row')}>
                  {stops.map((s) => (
                    <view
                      key={s.order}
                      className={picked === s.order ? cls('spot-card spot-card-on') : cls('spot-card')}
                      bindtap={() => {
                        const next = picked === s.order ? null : s.order;
                        setPicked(next);
                        if (next !== null) track('poi_detail_open', { order: next, source: 'sheet_card' });
                      }}
                    >
                      <view className={cls('spot-photo-box')}>
                        <image
                          className={cls('spot-photo')}
                          src={MAP_ART.thumbs[(s.order - 1) % MAP_ART.thumbs.length]}
                          mode="aspectFill"
                        />
                        {picked === s.order ? (
                          <view className={cls('spot-check')}>
                            <svg content={svgIcon('check', '#FFFFFF')} style={{ width: '11px', height: '11px' }} />
                          </view>
                        ) : null}
                      </view>
                      <view className={cls('spot-text')}>
                        <text className={cls('spot-name')}>{s.name}</text>
                        <text className={cls('spot-meta')}>
                          {s.time} 起 · {s.ticket > 0 ? `¥${s.ticket}` : '免费'}
                        </text>
                      </view>
                    </view>
                  ))}
                </view>
              </scroll-view>
            ) : null}
          </view>
        ) : view === 'spots' ? (
          <scroll-view className={cls('sheet-list')} scroll-y>
            {stops.map((s) => {
              return (
                <view
                  key={s.order}
                  className={cls('sp-row')}
                  bindtap={() => {
                    setPicked(s.order);
                    track('poi_detail_open', { order: s.order, source: 'list' });
                  }}
                >
                  <view className={cls('sp-thumb')}>
                    <image
                      src={MAP_ART.thumbs[(s.order - 1) % MAP_ART.thumbs.length]}
                      mode="aspectFit"
                      style={{ width: '56px', height: '42px' }}
                    />
                  </view>
                  <view className={cls('sp-main')}>
                    <text className={cls('sp-name')}>{s.name}</text>
                    <text className={cls('sp-meta')}>
                      {s.time} 起 · 停留 {s.stay} 分 · 门票 ¥{s.ticket}
                    </text>
                  </view>
                  <svg content={svgIcon('chevronRight', '#C7D2E3')} style={{ width: '13px', height: '13px' }} />
                </view>
              );
            })}
            {stops.length === 0 ? <text className={cls('sp-empty')}>这一天没有排到的景点</text> : null}
          </scroll-view>
        ) : (
          <scroll-view className={cls('sheet-list')} scroll-y>
            {plays.map((p) => (
              <view key={p.id} className={cls('sp-row')} bindtap={() => onPlay(p.id)}>
                <view className={cls('sp-icon')}>
                  <svg content={svgIcon('sparkles', '#2478F2')} style={{ width: '18px', height: '18px' }} />
                </view>
                <view className={cls('sp-main')}>
                  <text className={cls('sp-name')}>{p.title}</text>
                  <text className={cls('sp-meta')}>{p.note}</text>
                </view>
                <svg content={svgIcon('chevronRight', '#C7D2E3')} style={{ width: '13px', height: '13px' }} />
              </view>
            ))}
          </scroll-view>
        )}
      </view>
    </view>
  );
}

/** 水滴形定位针：圆头 + 下尖，数字叠在上半部圆心 */
function pinSvg(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="54" viewBox="0 0 22 27"><path d="M11 0.6C5.2 0.6 0.6 5.2 0.6 11c0 7.4 10.4 15.6 10.4 15.6S21.4 18.4 21.4 11C21.4 5.2 16.8 0.6 11 0.6Z" fill="${color}"/></svg>`;
}

/** 收起成圆点：位置太密的点，或已经选中了别的点（此时只留 badge，不展示名字和距离） */
function isCollapsed(picked: number | null, s: Stop): boolean {
  return s.crowded || (picked !== null && picked !== s.order);
}

/** 打开某个点后其它点只留圆点：一行全是标签时反而看不清谁是谁 */
function mkClass(picked: number | null, s: Stop): string {
  const on = picked === s.order ? ' mk-on' : '';
  const dim = picked !== null && picked !== s.order ? ' mk-dim' : '';
  const collapse = isCollapsed(picked, s) ? ' mk-collapsed' : '';
  return `mk${on}${dim}${collapse}`;
}

/** 高德给的是米：整数展示，公里级才换单位 */
function fmtMeters(m: number): string {
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;
}

/** 1 公里以下按米显示，别让近处的点也写成 0.3km */
function fmtDist(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)}m` : `${km}km`;
}

function clock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h < 10 ? '0' : ''}${h}:${m < 10 ? '0' : ''}${m}`;
}
