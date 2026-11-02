import { useCallback, useMemo, useState } from '@lynx-js/react';

import mapArt from '../../assets/gen/map-bg.jpg';
import mascotPeek from '../../assets/ip/mascot-peek.png';
import emptyState from '../../assets/ip/empty-state.png';
import { svgIcon, MAP_ART, COLOR } from '../../icons.js';
import { MOCK } from '../../mock.js';
import type { Demand, Plan } from '../../data.js';
import { distanceKm, placeById } from '../../data.js';
import { track } from '../../track.js';
import styles from './index.module.scss';
import { makeCls } from '../../styles/cls.js';

const cls = makeCls(styles);

type Props = {
  demand: Demand;
  plans: Plan[];
  onPlan: () => void;
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
  /** 挪不开位置了，只留圆形缩略图，不显示文字 */
  crowded: boolean;
  /** 靠近右边缘：气泡向左展开，否则文字被屏幕裁掉 */
  flip: boolean;
};

const VIEWS = [
  { id: 'route', label: '行程路线', short: '路线' },
  { id: 'spots', label: '景点列表', short: '景点' },
  { id: 'play', label: '推荐玩法', short: '玩法' },
] as const;

// 两个 marker 的圆心要隔开多少才不叠：横向只算圆点直径 + 一点余量，
// 纵向要够高，否则两张带文字的标签会在同一行撞上（18/10 是成都 4 点、北京 8 点都排得开的取值）
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

export function MapPage({ demand, plans, onPlan }: Props) {
  const [dayNo, setDayNo] = useState(1);
  const [view, setView] = useState<'route' | 'spots' | 'play'>('route');
  // 选中某个景点后，卡片区换成该点的详情；换天要清掉，否则 index 指向的是上一天的顺序
  const [picked, setPicked] = useState<number | null>(null);
  // 地图上按「紧凑打卡」档取点，否则轻松档一天只排 2 个点，路线画出来就是一根直线
  const plan = plans.find((p) => p.pace === 'packed') ?? plans[0];

  const stops = useMemo<Stop[]>(() => {
    const day = plan?.days.find((d) => d.index === dayNo);
    if (!day) return [];
    const list = day.items
      .map((i) => ({ item: i, place: i.placeId ? placeById(i.placeId) : undefined }))
      .filter((s): s is { item: typeof day.items[number]; place: NonNullable<ReturnType<typeof placeById>> } => !!s.place);

    if (list.length === 0) return [];
    const lngs = list.map((s) => s.place.lng);
    const lats = list.map((s) => s.place.lat);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const spanLng = maxLng - minLng || 0.01;
    const spanLat = maxLat - minLat || 0.01;
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

    // 景点挨太近时错开，否则标记叠在一起分不清顺序。
    // 只错开 y 不够：两个点经度也接近时，光上下挪会被 y 的上下界夹回去，仍然压在原地。
    // 这里按固定候选位逐个试（横向留出右侧文字标签的宽度），全试完还挤就只留圆点。
    const placed: { x: number; y: number }[] = [];
    return list.map((s, idx) => {
      const rawX = clamp(20 + ((s.place.lng - minLng) / spanLng) * 40, 16, 60);
      const rawY = clamp(20 + ((maxLat - s.place.lat) / spanLat) * 30, 16, 52);
      let x = rawX;
      let y = rawY;
      let crowded = false;
      let ok = false;
      for (const [dx, dy] of SPREAD) {
        const cx = clamp(rawX + dx, 10, 62);
        const cy = clamp(rawY + dy, 10, 56);
        if (!placed.some((p) => Math.abs(p.x - cx) < MINDX && Math.abs(p.y - cy) < MINDY)) {
          x = cx;
          y = cy;
          ok = true;
          break;
        }
      }
      if (!ok) {
        // 点太密挪不开：退到「离已有点最远」的格点，圆点好歹分得开，标签收起来
        crowded = true;
        let bestD = -1;
        for (let gx = 12; gx <= 60; gx += 12) {
          for (let gy = 14; gy <= 54; gy += 10) {
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
      const prev = list[idx - 1]?.place ?? list[idx + 1]?.place;
      return {
        name: s.place.name,
        placeId: s.place.id,
        tags: s.place.tags,
        order: idx + 1,
        x,
        y,
        time: clock(s.item.startMin),
        stay: s.item.stayMin,
        ticket: s.place.ticket,
        dist: prev ? fmtDist(distanceKm(s.place, prev)) : '',
        crowded,
        // 靠右边缘时气泡改向左展开，否则文字会顶出屏幕被裁掉
        flip: x > 58,
      };
    });
  }, [plan, dayNo]);

  const routeSvg = useMemo(() => {
    if (stops.length < 2) return '';
    // viewBox 取 100×216 贴合手机宽高比，x/y 单位长度接近，描边才不会被拉成一条宽带
    const k = 2.16;
    const pts = stops.map((s) => ({ x: s.x, y: s.y * k }));
    const d = smoothPath(pts);
    const dots = pts.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="0.55" fill="#2478F2"/>`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 216" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/><path d="${d}" fill="none" stroke="#2478F2" stroke-width="0.85" stroke-linecap="round" stroke-linejoin="round"/>${dots}</svg>`;
  }, [stops]);

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
    <view className={cls('map-full')}>
      <image
        src={mapArt}
        mode="aspectFill"
        style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }}
      />

      <view className={cls('map-top')}>
        <view className={cls('map-top-pill')}>
          <svg content={svgIcon('pin', COLOR.primary)} style={{ width: '15px', height: '15px', marginRight: '5px' }} />
          <text className={cls('map-top-city')}>{demand.destination} {demand.dayCount}天{dayNo > 1 ? '2晚' : '1晚'}</text>
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
        <view className={cls('map-top-pill map-top-icon')}>
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
          className={cls(mkClass(picked, s)) + (s.flip ? ' ' + cls('mk-flip') : '')}
          style={s.flip ? { right: `${100 - s.x}%`, bottom: `${100 - s.y}%` } : { left: `${s.x}%`, bottom: `${100 - s.y}%` }}
          bindtap={() => {
            const next = picked === s.order ? null : s.order;
            setPicked(next);
            if (next !== null) track('poi_detail_open', { order: next, source: 'marker' });
          }}
        >
          <view className={cls('mk-photo')}>
            <image
              src={MAP_ART.thumbs[(s.order - 1) % MAP_ART.thumbs.length]}
              mode="aspectFill"
              style={{ width: '46px', height: '46px' }}
            />
          </view>
          {/* 位置太密时只留圆图；点开后其它点也收起来，避免标签互相压 */}
          {s.crowded || (picked !== null && picked !== s.order) ? null : (
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
          {/* 气泡下方的尖角：指向实际坐标点，参考图是「水滴」而不是平底胶囊 */}
          {s.crowded || (picked !== null && picked !== s.order) ? null : <view className={cls('mk-tail')} />}
        </view>
      ))}

      <view className={cls('map-fab-col')}>
        <view className={cls('map-fab')}>
          <svg content={svgIcon('locate', '#2A3A57')} style={{ width: '20px', height: '20px' }} />
        </view>
        <view className={cls('map-fab')}>
          <text className={cls('map-fab-dots')}>•••</text>
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
            {MOCK.playStyles.map((p) => (
              <view key={p.title} className={cls('sp-row')}>
                <view className={cls('sp-icon')}>
                  <svg content={svgIcon(p.icon, '#2478F2')} style={{ width: '18px', height: '18px' }} />
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

/** Catmull-Rom 插值成三次贝塞尔：viewBox 拉伸下也不会出现折线硬拐 */
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return '';
  let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

/** 打开某个点后其它点只留圆点：一行全是标签时反而看不清谁是谁 */
function mkClass(picked: number | null, s: Stop): string {
  const on = picked === s.order ? ' mk-on' : '';
  const dim = picked !== null && picked !== s.order ? ' mk-dim' : '';
  return `mk${on}${dim}`;
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
