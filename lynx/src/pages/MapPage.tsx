import { useCallback, useMemo, useState } from '@lynx-js/react';

import mapArt from '../assets/gen/map-bg.jpg';
import mascotStart from '../assets/ip/mascot-start.png';
import { svgIcon, MAP_ART, COLOR } from '../icons.js';
import { MOCK } from '../mock.js';
import type { Demand, Plan } from '../data.js';
import { placeById } from '../data.js';

type Props = {
  demand: Demand;
  plans: Plan[];
  onPlan: () => void;
};

type Stop = { name: string; x: number; y: number; order: number; time: string; stay: number };

const VIEWS = [
  { id: 'route', label: '行程路线' },
  { id: 'spots', label: '景点列表' },
  { id: 'play', label: '推荐玩法' },
] as const;

// 设计稿里 1 号是紫色，其余是主蓝
const BADGE = ['#8B7CFF', '#2478F2', '#2478F2', '#35C08A', '#F5A03C'];

export function MapPage({ demand, plans, onPlan }: Props) {
  const [dayNo, setDayNo] = useState(1);
  const [view, setView] = useState<'route' | 'spots' | 'play'>('route');
  const plan = plans[0];

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

    // 景点挨太近时纵向错开，否则圆点叠在一起分不清顺序（逻辑与 H5 MapView 一致）
    const placed: { x: number; y: number }[] = [];
    return list.map((s, idx) => {
      const x = clamp(20 + ((s.place.lng - minLng) / spanLng) * 40, 18, 62);
      let y = clamp(20 + ((maxLat - s.place.lat) / spanLat) * 30, 18, 50);
      while (placed.some((p) => Math.abs(p.x - x) < 22 && Math.abs(p.y - y) < 11)) {
        y = y + 9 > 50 ? Math.max(16, y - 9) : y + 9;
      }
      placed.push({ x, y });
      return {
        name: s.place.name,
        order: idx + 1,
        x,
        y,
        time: clock(s.item.startMin),
        stay: s.item.stayMin,
      };
    });
  }, [plan, dayNo]);

  const routeSvg = useMemo(() => {
    if (stops.length < 2) return '';
    const points = stops.map((s) => `${s.x},${s.y}`).join(' ');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points="${points}" fill="none" stroke="#2478F2" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/></svg>`;
  }, [stops]);

  const onDay = useCallback((n: number) => setDayNo(n), []);

  if (!plan) {
    return (
      <view className="page">
        <view className="card">
          <text className="card-title">还没有可画的路线</text>
          <text className="card-note">先规划一次旅行，地图会按当天景点的真实经纬度摆位置。</text>
          <view className="btn-primary" bindtap={onPlan}>
            <text className="btn-primary-text">去规划</text>
          </view>
        </view>
      </view>
    );
  }

  return (
    <view className="map-full">
      <image
        src={mapArt}
        mode="aspectFill"
        style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }}
      />

      <view className="map-top">
        <view className="map-top-pill">
          <svg content={svgIcon('pin', COLOR.primary)} style={{ width: '15px', height: '15px', marginRight: '5px' }} />
          <text className="map-top-city">{demand.destination} {demand.dayCount}天{dayNo > 1 ? '2晚' : '1晚'}</text>
        </view>
        <view className="map-top-pill map-top-weather">
          <svg content={svgIcon('weather', '#F5A03C')} style={{ width: '15px', height: '15px', marginRight: '4px' }} />
          <text className="map-top-temp">{MOCK.weather.temp}</text>
          <text className="map-top-cond">{MOCK.weather.text}</text>
        </view>
      </view>

      {routeSvg ? (
        <svg content={routeSvg} style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }} />
      ) : null}

      {stops.map((s) => (
        <view key={s.order} className="mk" style={{ left: `${s.x}%`, top: `${s.y}%` }}>
          <view className="mk-badge" style={{ backgroundColor: BADGE[(s.order - 1) % BADGE.length] }}>
            <text className="mk-num">{s.order}</text>
          </view>
          <text className="mk-name">{s.name}</text>
        </view>
      ))}

      <view className="map-fab-col">
        <view className="map-fab">
          <svg content={svgIcon('route', '#2A3A57')} style={{ width: '19px', height: '19px' }} />
        </view>
        <view className="map-fab">
          <text className="map-fab-dots">•••</text>
        </view>
      </view>

      <image src={mascotStart} mode="aspectFit" className="map-mascot" />

      <view className="sheet">
        <view className="seg">
          {VIEWS.map((v) => (
            <view key={v.id} className="seg-item" bindtap={() => setView(v.id)}>
              <text className={view === v.id ? 'seg-text seg-text-on' : 'seg-text'}>{v.label}</text>
              <view className={view === v.id ? 'seg-line' : 'seg-line-off'} />
            </view>
          ))}
        </view>

        <view className="sheet-day-row">
          <view className="day-chip" bindtap={() => onDay((dayNo % plan.days.length) + 1)}>
            <text className="day-chip-text">第{dayNo}天</text>
          </view>
          <text className="sheet-route">
            {stops.length > 0 ? stops.map((s) => s.name).join(' → ') : '这一天没有可定位的点'}
          </text>
        </view>

        <scroll-view className="sheet-thumbs" scroll-x>
          <view className="sheet-thumb-row">
            {MAP_ART.thumbs.map((t, i) => (
              <image key={i} src={t} mode="aspectFill" className="sheet-thumb" />
            ))}
          </view>
        </scroll-view>
      </view>
    </view>
  );
}

function clock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h < 10 ? '0' : ''}${h}:${m < 10 ? '0' : ''}${m}`;
}
