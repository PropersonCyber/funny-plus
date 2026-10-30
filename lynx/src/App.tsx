import { useCallback, useState } from '@lynx-js/react';

import './App.css';
import { HomePage } from './pages/HomePage.js';
import { ItineraryPage } from './pages/ItineraryPage.js';
import { MapPage } from './pages/MapPage.js';
import { AdvicePage } from './pages/AdvicePage.js';
import { TripDetailPage } from './pages/TripDetailPage.js';
import { AssistantPage } from './pages/AssistantPage.js';
import { GuidePage } from './pages/GuidePage.js';
import { ProfilePage } from './pages/ProfilePage.js';
import { PlanSheet } from './pages/PlanSheet.js';
import { DEFAULT_DEMAND, planFor } from './data.js';
import { tabSvg } from './icons.js';
import { filledIcon } from './icons-filled.js';
import type { Demand, Plan } from './data.js';

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
  const [tab, setTab] = useState<TabId>('home');
  const [demand, setDemand] = useState<Demand>(DEFAULT_DEMAND);
  // 起手就带一份默认行程，否则地图/行程首屏全是空态（接真数据后由接口填充）
  const [plans, setPlans] = useState<Plan[]>(() => planFor(DEFAULT_DEMAND));
  const [sheetOpen, setSheetOpen] = useState(false);
  // 设计稿里的「智能建议」不是 tab，是从首页快捷入口进的子页
  const [route, setRoute] = useState<'advice' | 'detail' | 'assistant' | null>(null);

  const onPlanned = useCallback((nextDemand: Demand, nextPlans: Plan[]) => {
    setDemand(nextDemand);
    setPlans(nextPlans);
    setSheetOpen(false);
    setTab('itinerary');
  }, []);

  const openSheet = useCallback(() => setSheetOpen(true), []);

  return (
    <view className="screen">
      <view className="body">
        {route === 'detail' ? (
          <TripDetailPage
            demand={demand}
            plans={plans}
            onBack={() => setRoute(null)}
            onNavigate={() => setTab('map')}
            onEdit={openSheet}
          />
        ) : route === 'assistant' ? (
          <AssistantPage onBack={() => setRoute(null)} />
        ) : route === 'advice' ? (
          <AdvicePage
            demand={demand}
            plans={plans}
            onBack={() => setRoute(null)}
            onPlan={openSheet}
          />
        ) : tab === 'home' ? (
          <HomePage
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
          />
        ) : tab === 'map' ? (
          <MapPage demand={demand} plans={plans} onPlan={openSheet} />
        ) : tab === 'guide' ? (
          <GuidePage city={demand.destination} />
        ) : (
          <ProfilePage />
        )}
      </view>

      <view className="tabbar">
        {TABS.map((t) => (
          <view
            key={t.id}
            className="tab"
            catchtap={() => {
              setRoute(null);
              setTab(t.id);
            }}
          >
            <svg
              content={tab === t.id ? filledIcon(t.icon, '#2478F2') : tabSvg(t.icon, false)}
              style={{ width: '23px', height: '23px', marginBottom: '2px' }}
            />
            <text className={tab === t.id ? 'tab-label tab-label-on' : 'tab-label'}>
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
