import { useCallback, useEffect, useState } from '@lynx-js/react';

import '../styles/base.scss';
import { HomePage } from '../pages/HomePage/index.js';
import { ItineraryPage } from '../pages/ItineraryPage/index.js';
import { MapPage } from '../pages/MapPage/index.js';
import { AdvicePage } from '../pages/AdvicePage/index.js';
import { TripDetailPage } from '../pages/TripDetailPage/index.js';
import { AssistantPage } from '../pages/AssistantPage/index.js';
import { GuidePage } from '../pages/GuidePage/index.js';
import { GuideDetailPage } from '../pages/GuideDetailPage/index.js';
import { ProfilePage } from '../pages/ProfilePage/index.js';
import { PlanSheet } from '../pages/PlanSheet/index.js';
import { CityPage } from '../pages/CityPage/index.js';
import { CITIES, DEFAULT_DEMAND, planFor } from '../data.js';
import { MOCK } from '../mock.js';
import { hydrate, loadSaved, saveTrip } from '../storage.js';
import { track } from '../track.js';
import { ToastHost } from '../toast.js';

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
  // 本机存档要先等持久层读完（IndexedDB / 注入桥都是异步），没读完就渲染会闪一下默认数据
  const [booted, setBooted] = useState(false);
  const [tab, setTab] = useState<TabId>('home');
  const [demand, setDemand] = useState<Demand>(DEFAULT_DEMAND);
  const [plans, setPlans] = useState<Plan[]>(() => planFor(DEFAULT_DEMAND));
  const [sheetOpen, setSheetOpen] = useState(false);
  // 局部修改只换掉被改的那一套方案，其它方案留着做对比
  const [impact, setImpact] = useState<ChangeImpact | null>(null);
  // 设计稿里的「智能建议」不是 tab，是从首页快捷入口进的子页
  const [route, setRoute] = useState<'advice' | 'detail' | 'assistant' | 'city' | 'guide' | null>(null);
  // 首页「精选攻略」哪一张被点开了
  const [guideIndex, setGuideIndex] = useState(0);

  // 需求或行程一变就写本机，写成功才更新「已保存」时间
  useEffect(() => {
    let alive = true;
    hydrate().then(() => {
      if (!alive) return;
      const saved = loadSaved();
      if (saved) {
        setDemand(saved.demand);
        setPlans(saved.plans);
      }
      setBooted(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    // 存档还没读出来就写，会把上次的行程覆盖成默认需求
    if (!booted) return;
    if (!saveTrip(demand, plans)) return;
    track('trip_saved', { destination: demand.destination, dayCount: demand.dayCount, plans: plans.length });
  }, [booted, demand, plans]);

  const onPlanned = useCallback((nextDemand: Demand, nextPlans: Plan[]) => {
    setDemand(nextDemand);
    setPlans(nextPlans);
    setSheetOpen(false);
    // 从智能建议/行程详情里打开表单时，route 还指着子页；不关掉会生成完停在原子页
    setRoute(null);
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

  // 持久层没读完先不渲染：闪一下默认行程再跳成存档，比空一下很难接受
  if (!booted) return <view className={cls('screen')} />;

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
        ) : route === 'guide' ? (
          <GuideDetailPage
            guide={MOCK.guides[guideIndex] ?? MOCK.guides[0]}
            onBack={() => setRoute(null)}
            // 攻略属于某个城市：先切城市（会重算行程）再开表单，不留给用户一份牛头不对马嘴的方案
            onPlan={(city) => {
              onCity(city);
              setSheetOpen(true);
              track('guide_to_plan', { city });
            }}
            onMap={() => {
              setRoute(null);
              setTab('map');
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
            onGuide={(i) => {
              setGuideIndex(i);
              setRoute('guide');
              track('guide_open', { index: i });
            }}
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
          />
        ) : tab === 'map' ? (
          <MapPage demand={demand} plans={plans} onPlan={openSheet} />
        ) : tab === 'guide' ? (
          <GuidePage city={demand.destination} plans={plans} />
        ) : (
          <ProfilePage
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

      <ToastHost />
    </view>
  );
}
