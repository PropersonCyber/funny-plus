import { useCallback, useEffect, useState } from '@lynx-js/react';

import '../styles/base.scss';
import { HomePage } from '../pages/HomePage/index.js';
import { ItineraryPage } from '../pages/ItineraryPage/index.js';
import { MapPage } from '../pages/MapPage/index.js';
import { AdvicePage } from '../pages/AdvicePage/index.js';
import { TripDetailPage } from '../pages/TripDetailPage/index.js';
import { AssistantPage } from '../pages/AssistantPage/index.js';
import { GuidePage } from '../pages/GuidePage/index.js';
import { ProfilePage } from '../pages/ProfilePage/index.js';
import { PlanSheet } from '../pages/PlanSheet/index.js';
import { CityPage } from '../pages/CityPage/index.js';
import { CITIES, DEFAULT_DEMAND, planFor } from '../data.js';
import { loadSaved, saveTrip } from '../storage.js';
import { track } from '../track.js';

/** 只列有地点数据可用的城市，别让用户切过去看到空方案 */
import { tabSvg } from '../icons.js';
import { filledIcon } from '../icons-filled.js';
import type { ChangeImpact, Demand, Plan } from '../data.js';
import styles from './index.module.scss';
import { makeCls } from '../styles/cls.js';

const cls = makeCls(styles);

/** 底部五栏，与 docs/materials/components/tab-bar.json 一致 */
const TABS = [
  { id: 'home', title: '首页', icon: 'home' },
  { id: 'map', title: '地图', icon: 'map' },
  { id: 'itinerary', title: '行程', icon: 'itinerary' },
  { id: 'guide', title: '避坑', icon: 'shield' },
  { id: 'profile', title: '我的', icon: 'profile' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function App() {
  // 本机存档只读一次：有存档就接着上次的，没有才用默认需求
  const [boot] = useState(() => loadSaved());
  const [tab, setTab] = useState<TabId>('home');
  const [demand, setDemand] = useState<Demand>(boot?.demand ?? DEFAULT_DEMAND);
  const [plans, setPlans] = useState<Plan[]>(() => boot?.plans ?? planFor(DEFAULT_DEMAND));
  const [savedAt, setSavedAt] = useState<string | null>(boot?.savedAt ?? null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // 局部修改只换掉被改的那一套方案，其它方案留着做对比
  const [impact, setImpact] = useState<ChangeImpact | null>(null);
  // 设计稿里的「智能建议」不是 tab，是从首页快捷入口进的子页
  const [route, setRoute] = useState<'advice' | 'detail' | 'assistant' | 'city' | null>(null);

  // 需求或行程一变就写本机，写成功才更新「已保存」时间
  useEffect(() => {
    const at = saveTrip(demand, plans);
    if (!at) return;
    setSavedAt(at);
    track('trip_saved', { destination: demand.destination, dayCount: demand.dayCount, plans: plans.length });
  }, [demand, plans]);

  const onPlanned = useCallback((nextDemand: Demand, nextPlans: Plan[]) => {
    setDemand(nextDemand);
    setPlans(nextPlans);
    setSheetOpen(false);
    setTab('itinerary');
  }, []);

  const openSheet = useCallback(() => setSheetOpen(true), []);

  const onRevise = useCallback((planIndex: number, nextPlan: Plan, nextImpact: ChangeImpact) => {
    setPlans((prev) => prev.map((p, i) => (i === planIndex ? nextPlan : p)));
    setImpact(nextImpact);
  }, []);

  // 换城市要连行程一起重算，否则地图/行程/智能建议还是旧城市的方案
  const onCity = useCallback((city: string) => {
    setDemand((prev) => {
      if (prev.destination === city) return prev;
      const next = { ...prev, destination: city };
      try {
        setPlans(planFor(next));
      } catch {
        // 新城市没数据时保留旧行程，不让城市切换把行程清空
      }
      return next;
    });
    setRoute(null);
    setTab('home');
  }, []);

  return (
    <view className={cls('screen')}>
      <view className={cls('body')}>
        {route === 'city' ? (
          <CityPage
            city={demand.destination}
            cities={CITIES}
            onPick={onCity}
            onBack={() => setRoute(null)}
          />
        ) : route === 'detail' ? (
          <TripDetailPage
            demand={demand}
            plans={plans}
            onBack={() => setRoute(null)}
            onNavigate={() => setTab('map')}
            onEdit={openSheet}
          />
        ) : route === 'assistant' ? (
          <AssistantPage
            onBack={() => setRoute(null)}
            onApply={() => {
              setRoute(null);
              setTab('itinerary');
            }}
          />
        ) : route === 'advice' ? (
          <AdvicePage
            demand={demand}
            plans={plans}
            onBack={() => setRoute(null)}
            onPlan={openSheet}
          />
        ) : tab === 'home' ? (
          <HomePage
            city={demand.destination}
            onPickCity={() => setRoute('city')}
            onPlan={openSheet}
            onTab={(t) => { setRoute(null); setTab(t); }}
            onAdvice={() => setRoute('advice')}
            onAssistant={() => setRoute('assistant')}
          />
        ) : tab === 'itinerary' ? (
          <ItineraryPage
            demand={demand}
            plans={plans}
            onPlan={openSheet}
            onMap={() => setTab('map')}
            onDetail={() => setRoute('detail')}
            onRevise={onRevise}
            impact={impact}
            onDismissImpact={() => setImpact(null)}
            savedAt={savedAt}
          />
        ) : tab === 'map' ? (
          <MapPage demand={demand} plans={plans} onPlan={openSheet} />
        ) : tab === 'guide' ? (
          <GuidePage city={demand.destination} plans={plans} />
        ) : (
          <ProfilePage
            savedAt={savedAt}
            trip={plans[0]}
            onOpenTrip={() => setTab('itinerary')}
          />
        )}
      </view>

      <view className={cls('tabbar')}>
        {TABS.map((t) => (
          <view
            key={t.id}
            className={cls('tab')}
            catchtap={() => {
              setRoute(null);
              setSheetOpen(false);
              setTab(t.id);
              track('tab_switch', { tab: t.id });
            }}
          >
            <svg
              content={tab === t.id ? filledIcon(t.icon, '#2478F2') : tabSvg(t.icon, false)}
              style={{ width: '23px', height: '23px', marginBottom: '2px' }}
            />
            <text className={cls(tab === t.id ? 'tab-label tab-label-on' : 'tab-label')}>
              {t.title}
            </text>
          </view>
        ))}
      </view>

      {sheetOpen ? (
        <PlanSheet
          demand={demand}
          onClose={() => setSheetOpen(false)}
          onPlanned={onPlanned}
        />
      ) : null}
    </view>
  );
}
