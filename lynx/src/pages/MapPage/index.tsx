import { useCallback, useEffect, useMemo, useRef, useState } from '@lynx-js/react';

import mapArt from '../../assets/gen/map-bg.jpg';
import mascotPeek from '../../assets/ip/mascot-peek.png';
import emptyState from '../../assets/ip/empty-state.png';
import markerBase from '../../assets/map/marker-base.png';
import { svgDataUri } from '../../icon-svg.js';
import { svgIcon, MAP_ART, COLOR } from '../../icons.js';
import type { Demand, Plan } from '../../data.js';
import { distanceKm, placeById } from '../../data.js';
import { track } from '../../track.js';
import { toast } from '../../toast.js';
import styles from './index.module.scss';
import { makeCls } from '../../styles/cls.js';
import {
  boundsCenter,
  fitZoom,
  makeProjection,
  makeStaticMapProjection,
  simplifyPath,
  PAD_X,
  PAD_Y,
  unprojectFromImage,
  type GeoPoint,
  type StaticMapProjection,
} from '../../mapProjection.js';
import { legGeometry } from '../../routeGeometry.js';
import { fillDayGeometry } from '../../travel.js';
import { Gesture, IDENTITY, isIdentity, project, unproject, type View } from '../../mapGesture.js';
import { staticMapUrl } from '../../geo.js';
import { ticketText } from '../../ticketText.js';

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
  ticket: number | null;
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
  // 底部面板收起来才能看全地图。默认展开：收起态下用户看不到路线摘要，
  // 而这是本页的主信息，不该一进来就藏起来。
  const [sheetOpen, setSheetOpen] = useState(true);
  const plan = plans[Math.min(planIndex, plans.length - 1)] ?? plans[0];

  /**
   * 地图视口。手势只改这个值，不重算投影——投影是「地理 → 内容坐标」，
   * 缩放平移是「内容坐标 → 屏幕坐标」，两层分开才能拖动时不抖。
   */
  const [mapView, setMapView] = useState<View>(IDENTITY);
  // touch 回调里读不到最新的 state（闭包），用 ref 并存一份
  const viewRef = useRef<View>(IDENTITY);
  const gestureRef = useRef(new Gesture());
  // 新底图是否还在路上。手势提交后视图先不复位，等新图真正加载完再复位，
  // 否则用户会看到「刚放大又弹回去」—— 那时新图还没到，屏幕上是旧图。
  const pendingResetRef = useRef(false);
  // touchend 要把手势结果提交成一次重取图，但 commitCamera 定义在后面（依赖 baseView），
  // 用 ref 转一层，避免为了顺序把回调挪来挪去、也避免闭包拿到过期的 baseView
  const commitRef = useRef<(v: View) => void>(() => {});
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
    if (pts.length > 0) {
      gestureRef.current.begin(viewRef.current, pts);
      return;
    }
    gestureRef.current.end();
    // 手势彻底结束：把「我拖到哪、放到多大」提交成一次真实取景变更。
    // 放着不提交的话，这只手看到的是一张被 CSS 拉大/挪动的旧图，
    // 松手后既没有新细节，也没有任何东西记住用户在多看哪一块。
    commitRef.current(viewRef.current);
  }, []);

  // 补到折线后 bump 一次，触发下面 stops/routeSvg 重算（折线存在模块内存里，不进 state）
  const [geoBump, setGeoBump] = useState(0);



  /**
   * 当天行程的底图取景。center/zoom 由点集算出，尺寸取一个固定的逻辑尺寸：
   * 真机全屏约 390×760pt，要 512×1024 逻辑尺寸再用 scale=2 才够清晰（实测上限就是 1024）。
   * 这里不读运行时尺寸 —— Lynx 里拿宽高要等布局回调，地图不该为此闪一帧。
   */
  const BASE_W = 512;
  const BASE_H = 1024;

  /** 当天的「初始取景」：按点集算，换天/换方案时相机复位到这里 */
  const dayFit = useMemo(() => {
    const day = plan?.days.find((d) => d.index === dayNo);
    const places = (day?.items ?? [])
      .map((i) => (i.placeId ? placeById(i.placeId) : undefined))
      .filter((p): p is NonNullable<ReturnType<typeof placeById>> => !!p);
    if (places.length === 0) return null;
    const center = boundsCenter(places);
    const zoom = fitZoom(places, BASE_W, BASE_H);
    return { center, zoom };
  }, [plan, dayNo]);

  /**
   * 当前底图取景。手势结束后写这里，和 dayFit 不同就说明用户看的是另一个位置/比例。
   *
   * 为什么要有它：底图是服务端按 center/zoom 现出的一张静态图，
   * 想真的放大只能按新取景再取一张 —— CSS 拉伸只是把同样的像素摊大，会糊。
   */
  const [camera, setCamera] = useState<{ center: GeoPoint; zoom: number } | null>(null);
  // 换天/换方案后旧取景已经无意义了，连视图变换一起复位
  useEffect(() => {
    setCamera(null);
    applyView(IDENTITY);
  }, [dayFit, applyView]);
  const baseView = camera ?? dayFit;

  /**
   * 底图投影：点集 → 屏幕百分比。
   * 和 stops 里那个 makeProjection 是两套，不能混：这里必须严格按底图的 zoom 走，
   * 否则 marker 会落在和路网无关的位置上（实测用 256 瓦片公式会偏 50px 以上）。
   */
  const baseProj = useMemo<StaticMapProjection | null>(
    () =>
      baseView
        ? makeStaticMapProjection({
            center: baseView.center,
            zoom: baseView.zoom,
            width: BASE_W,
            height: BASE_H,
          })
        : null,
    [baseView]
  );

  /**
   * 把手势结果「提交」成一次真正的取景变更：算出新的 center/zoom，重取底图。
   *
   * 只在松手时调用，不在 touchmove 里调 —— 静态图是服务端现出的一张 PNG，
   * 手势中途每帧取一次会瞬间打爆配额（服务条款也不允许缓存，没法靠缓存省）。
   *
   * 换算规则：视口正中在旧图里的像素位置反解成经纬度作为新中心；
   * zoom 按 2 的对数加 scale，因为高德 zoom 每 +1 视野缩小一半。
   */
  const commitCamera = useCallback(
    (v: View) => {
      const view = baseView;
      if (!view || !baseProj) return;
      if (isIdentity(v)) {
        // 回到原样：不用重取，直接回到当天初始取景
        setCamera(null);
        return;
      }

      // 视口正中（内容坐标 50,50）落在旧图的哪个像素上 → 反解成经纬度，就是新图的中心。
      // 不这么做的话，用户拖到的位置在重取后会跳回原点附近。
      const c = unproject(v, 50, 50);
      const px = { x: (c.x / 100) * BASE_W, y: ((100 - c.y) / 100) * BASE_H };
      const center = unprojectFromImage(px, {
        center: view.center,
        zoom: view.zoom,
        width: BASE_W,
        height: BASE_H,
      });

      // 高德 zoom 是整数档：每 +1 视野缩小一半，所以 scale 的 2 的对数就是档数变化。
      // 取整而不是保留小数 —— 服务端也只接受整数档，给小数会被它静默取整，白白多算一次。
      const target = view.zoom + Math.log2(v.scale);
      const zoom = Math.min(17, Math.max(3, Math.round(target)));

      // 档位没变 = 这一手只是拖动（或缩放不足半档），中心点照常移动，但不必换图也能移动——
      // 只有真正换档才需要重取，否则就是在拿同样的细节重画一遍
      const zoomChanged = zoom !== view.zoom;
      const moved = Math.abs(center.lng - view.center.lng) > 1e-5 || Math.abs(center.lat - view.center.lat) > 1e-5;
      if (!zoomChanged && !moved) {
        applyView(IDENTITY);
        return;
      }

      // 先把新取景挂上，等新图真的换上之后再复位视图（见下面的 pendingReset）。
      // 若在这里立刻 applyView(IDENTITY)，用户会看到自己刚放大的图瞬间弹回原大小 ——
      // 新图还没到，屏幕上还是旧图，看起来就像「缩放被取消了」。
      pendingResetRef.current = true;
      setCamera({ center, zoom });
    },
    [baseView, baseProj, applyView]
  );
  // touchend 通过 ref 调它，避免 onTouchEnd 反过来依赖 baseView 造成每次手势重建回调
  commitRef.current = commitCamera;
  const stops = useMemo<Stop[]>(() => {
    const day = plan?.days.find((d) => d.index === dayNo);
    if (!day) return [];
    const list = day.items
      .map((i) => ({ item: i, place: i.placeId ? placeById(i.placeId) : undefined }))
      .filter((s): s is { item: typeof day.items[number]; place: NonNullable<ReturnType<typeof placeById>> } => !!s.place);

    if (list.length === 0) return [];
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

    // 景点挨太近时错开，否则标记叠在一起分不清顺序。只错开 y 不够：两个点经度也接近时，
    // 光上下挪会被上下界夹回去。这里按固定候选位逐个试，全试完还挤就只留圆点。
    // 挪过的点要标出来（moved），不能让用户以为 marker 就在那儿——那是另一种假精度。
    // 底图是真地图时，marker 必须落在底图的路网上：用底图投影。
    // 拿不到底图取景（没有地点数据）时才退回旧的「铺满屏幕」投影，
    // 那种情况页面显示的是空态卡片，本来也不会画 marker。
    const proj = baseProj ?? makeProjection(list.map((s) => s.place));

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
  }, [plan, dayNo, geoBump]);

  /**
   * 冷启动补折线。
   *
   * 折线只活在进程内存里，冷启动直接进地图页时是空的，路线会退回两点直连的虚线。
   * 这里在缺段时补拉一次，补到就 bump 一下触发重算 —— 用户多等 1 秒看到真路，
   * 好过一进来就是一条假路。只补缺的、只补当天、只补一次。
   */
  const filledRef = useRef<string>('');
  useEffect(() => {
    const day = plan?.days.find((d) => d.index === dayNo);
    if (!day || day.items.length < 2) return;
    const key = `${plan?.id ?? ''}:${dayNo}`;
    if (filledRef.current === key) return;
    const ids = day.items.map((i) => i.placeId).filter((id): id is string => !!id);
    let need = false;
    for (let i = 1; i < ids.length; i++) {
      if (!legGeometry(ids[i - 1], ids[i])) { need = true; break; }
    }
    if (!need) return;
    filledRef.current = key;
    let alive = true;
    fillDayGeometry(day, demand.transport)
      .then((n) => {
        if (alive && n > 0) setGeoBump((v) => v + 1);
      })
      .catch(() => {
        // 取不到就继续显示直连虚线，界面本来就有「估算」标注，不弹错
      });
    return () => {
      alive = false;
    };
  }, [plan, dayNo, demand]);

  /**
   * 底图地址。它是一张 PNG 的 URL，不是 JSON 接口，所以直接交给 <image src>。
   * 只有 center/zoom 变了才换 URL —— 每换一次就是一次真实的高德请求，
   * 而静态图按协议不允许缓存，拖动手势绝不能触发重新请求（那会瞬间烧掉配额）。
   */
  const baseMapSrc = useMemo(() => {
    if (!baseView) return mapArt;
    return staticMapUrl(baseView.center, baseView.zoom, BASE_W, BASE_H);
  }, [baseView]);

  /**
   * 静态图加载失败（没配 key / 配额用尽 / 网络不通）时退回插画。
   * <image src> 失败不会抛错，不接这个信号，用户看到的就是一块白板。
   */
  const [baseMapFailed, setBaseMapFailed] = useState(false);
  // 取景变了就再试一次真底图：换天 / 换方案后配额恢复，还能显示出来
  useEffect(() => {
    setBaseMapFailed(false);
  }, [baseMapSrc]);
  const showArt = !baseView || baseMapFailed;

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
    // 路线必须和 marker 用同一个投影，否则线会从气泡旁边穿过去。
    // 底图是真地图时用底图投影；没有底图时才用「铺满屏幕」那套。
    const proj = baseProj ?? makeProjection(allPlaces);

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
    const svg = (
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
    // 原生 Lynx 没有 svg 组件，路线图也是 data URI 交给 <image>
    return svgDataUri(svg);
  }, [stops, legs, plan, dayNo, mapView]);

  const pickedSpot = picked === null ? undefined : stops.find((s) => s.order === picked);

  /**
   * 当天里程胶囊：只回答两件事——第几天、这天一共走多远。
   * 有真实折线的段用高德给的实际里程；缺段的退回直线折算，并在数字前加「约」，
   * 不把估算值写成确定值。
   */
  const daySummary = useMemo(() => {
    if (stops.length < 2) return '';
    let meters = 0;
    let estimated = false;
    for (let i = 1; i < stops.length; i++) {
      const a = placeById(stops[i - 1].placeId);
      const b = placeById(stops[i].placeId);
      if (!a || !b) continue;
      const geo = legGeometry(a.id, b.id);
      if (geo?.distanceM) meters += geo.distanceM;
      else {
        meters += distanceKm(a, b) * 1000;
        estimated = true;
      }
    }
    if (meters <= 0) return '';
    return `第${dayNo}天 · ${estimated ? '约' : ''}${fmtMeters(meters)}`;
  }, [stops, dayNo]);
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
      catchtouchmove={onTouchMove}
      bindtouchend={onTouchEnd}
      bindtouchcancel={onTouchEnd}
    >
      {/*
        底图：有取景信息时用高德静态图（服务端透传，key 不过河），否则退回插画。
        退回是必要的 —— 地图服务未配置、超过配额、或当天还没有地点时，
        用户至少要看到一张底图，而不是一块白板。
      */}
      <image
        src={showArt ? mapArt : baseMapSrc}
        mode="aspectFill"
        className={showArt ? undefined : cls('map-base')}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          height: '100%',
          // 底图必须和 marker/路线一起变换，否则双指缩放时只有标记在动、地图纹丝不动，
          // 看上去就像「地图不能放大」。缩放锚点是画面中心，和 project() 的约定一致。
          transform: `translate(${mapView.dx}%, ${-mapView.dy}%) scale(${mapView.scale})`,
          // 手势中途是 CSS 拉伸（快、不花配额），松手后 commitCamera 会重取一张真正的图
          transformOrigin: 'center center',
        }}
        bindload={() => {
          // 新取景的图已经到了，这时候再把视图复位才不会让用户看到「放大又弹回」
          if (pendingResetRef.current) {
            pendingResetRef.current = false;
            applyView(IDENTITY);
          }
        }}
        binderror={() => {
          // 取景失败：同样要复位，否则用户被卡在「一张拉大的旧图」上
          pendingResetRef.current = false;
          if (!showArt) setBaseMapFailed(true);
        }}
      />
      {/* 高德静态图接口不认 style 参数（实测 fresh / dark / 数字 id 全返回同一张图），
          所以配色只能在前端做：先降饱和把「米黄底 + 蓝水 + 绿园」拉成灰阶，
          再叠一层淡绿。不降饱和直接叠色的话，白色路网会被一起染绿，
          路和地就分不出来了 —— 而路网是这个页面唯一需要看清的底图信息 */}
      {/* 蒙版跟着底图一起变换：底图被拉伸时蒙版留在原地，缩放中会看见一条没被染色的边 */}
      {showArt ? null : (
        <view
          className={cls('map-tint')}
          style={{ transform: `translate(${mapView.dx}%, ${-mapView.dy}%) scale(${mapView.scale})` }}
        />
      )}
      {/* 插画当底图时才需要压遮罩：它自带的假街道会和折线混在一起。
          真地图上不加遮罩——那会把真实路网的清晰度白白磨掉一层 */}
      {showArt ? <view className={cls('map-veil')} /> : null}
      <view className={cls('map-top')}>
        <view className={cls('map-top-pill')}>
          <image src={svgIcon('pin', COLOR.primary)} style={{ width: '15px', height: '15px', marginRight: '5px' }} />
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
          <image src={svgIcon('search', '#3F5980')} style={{ width: '17px', height: '17px' }} />
        </view>
      </view>

      {routeSvg ? (
        <image src={routeSvg} style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }} />
      ) : null}
      {/* 当天里程胶囊：贴起点一侧，只回答「第几天、这天一共走多远」 */}
      {daySummary ? (
        <view
          className={cls('map-day-pill')}
          style={(() => {
            // 胶囊整体在点的左侧：起点贴边时往里收一点，别让文字滑出屏幕
            const p = project(mapView, stops[0].x, stops[0].y);
            const x = Math.min(92, Math.max(30, p.x));
            return { left: `${x}%`, bottom: `${p.y}%` };
          })()}
        >
          <text className={cls('map-day-text')}>{daySummary}</text>
        </view>
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
                  <image src={svgIcon('chevronRight', '#7E93D6')} style={{ width: '11px', height: '11px' }} />
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

      {/* 定位能力没接入前不放定位按钮：按不到东西的按钮比没有更糟 */}
      <view className={cls('map-fab-col')}>
        <view className={cls('map-fab')} bindtap={() => setView('spots')}>
          <image src={svgIcon('map', '#2A3A57')} style={{ width: '20px', height: '20px' }} />
        </view>
      </view>

      {sheetOpen ? (
      <view className={cls('map-sheet')}>
        {/* 收起把手：点一下让出地图。放在面板顶部正中，和地图手势不冲突 */}
        <view className={cls('sheet-grabber-hit')} catchtap={() => setSheetOpen(false)}>
          <view className={cls('sheet-grabber')} />
        </view>
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
                {pickedSpot.time} 起 · 停留 {pickedSpot.stay} 分 · 门票 {ticketText(pickedSpot.ticket)}
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
                            <image src={svgIcon('check', '#FFFFFF')} style={{ width: '11px', height: '11px' }} />
                          </view>
                        ) : null}
                      </view>
                      <view className={cls('spot-text')}>
                        <text className={cls('spot-name')}>{s.name}</text>
                        <text className={cls('spot-meta')}>
                          {s.time} 起 · {ticketText(s.ticket)}
                        </text>
                      </view>
                    </view>
                  ))}
                </view>
              </scroll-view>
            ) : null}
          </view>
        ) : view === 'spots' ? (
          <scroll-view className={cls('sheet-list')} scroll-y bounces={false}>
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
                      {s.time} 起 · 停留 {s.stay} 分 · 门票 {ticketText(s.ticket)}
                    </text>
                  </view>
                  <image src={svgIcon('chevronRight', '#C7D2E3')} style={{ width: '13px', height: '13px' }} />
                </view>
              );
            })}
            {stops.length === 0 ? <text className={cls('sp-empty')}>这一天没有排到的景点</text> : null}
          </scroll-view>
        ) : (
          <scroll-view className={cls('sheet-list')} scroll-y bounces={false}>
            {plays.map((p) => (
              <view key={p.id} className={cls('sp-row')} bindtap={() => onPlay(p.id)}>
                <view className={cls('sp-icon')}>
                  <image src={svgIcon('sparkles', '#2478F2')} style={{ width: '18px', height: '18px' }} />
                </view>
                <view className={cls('sp-main')}>
                  <text className={cls('sp-name')}>{p.title}</text>
                  <text className={cls('sp-meta')}>{p.note}</text>
                </view>
                <image src={svgIcon('chevronRight', '#C7D2E3')} style={{ width: '13px', height: '13px' }} />
              </view>
            ))}
          </scroll-view>
        )}
      </view>
      ) : (
        <view className={cls('sheet-reopen')} catchtap={() => setSheetOpen(true)}>
          <image
            src={svgIcon('chevronRight', '#2478F2')}
            className={cls('sheet-reopen-icon')}
            style={{ width: '14px', height: '14px' }}
          />
          <text className={cls('sheet-reopen-text')}>展开路线</text>
        </view>
      )}
    </view>
  );
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
