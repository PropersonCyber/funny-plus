import { useCallback, useEffect, useState } from '@lynx-js/react';

import '../styles/base.scss';
import { PlanSheet } from '../pages/PlanSheet/index.js';
import type { Demand, Plan } from '../data.js';
import { flushOnHide, track } from '../track.js';
import { ToastHost } from '../toast.js';
import { MainTabs } from './MainTabs.js';
import { SUB_PAGES } from './subPages.js';
import { TabBar } from './TabBar.js';
import { useBootstrap } from './useBootstrap.js';
import { useContent } from './useContent.js';
import { useLocationChannel } from './useLocationChannel.js';
import { useRoute } from './useRoute.js';
import { useTrips } from './useTrips.js';
import { makeCls } from '../styles/cls.js';
import styles from './index.module.scss';
import type { TabId } from './tabs.js';

const cls = makeCls(styles);

/**
 * 应用外壳。
 *
 * 这里只做三件事：装好各条数据通道、把导航意图翻译成状态变更、按路由分发。
 * 具体状态都在 ./useXxx.ts 里，页面装配在 ./MainTabs.tsx 和 ./subPages.tsx 里——
 * 之前这些全挤在这一个文件（547 行、17 个 hook），改任何一处都要通读全文。
 */
export function App() {
  useLocationChannel();
  // 切后台/卸载前补报一次埋点：最后几步往往是判断旅程是否完成的关键
  useEffect(() => {
    flushOnHide();
  }, []);
  const booted = useBootstrap();
  const route = useRoute();
  const trips = useTrips(booted);
  const content = useContent(booted);

  const [tab, setTab] = useState<TabId>('home');
  const [sheetOpen, setSheetOpen] = useState(false);

  const openSheet = useCallback(() => setSheetOpen(true), []);
  const openTab = useCallback((id: TabId) => setTab(id), []);

  /**
   * 新方案落成一条行程后统一跳到行程页：
   * 从智能建议/行程详情/对话里生成时，route 还指着子页，不关掉会生成完停在原子页。
   */
  const onPlanned = useCallback(
    (nextDemand: Demand, nextPlans: Plan[], pickedIndex = 0): string => {
      const id = trips.createTrip(nextDemand, nextPlans, pickedIndex);
      if (!id) return '';
      setSheetOpen(false);
      route.back();
      setTab('itinerary');
      return id;
    },
    [trips.createTrip, route.back]
  );

  // 换城市要连行程一起重算，否则地图/行程/智能建议还是旧城市的方案
  const onCity = useCallback(
    (city: string) => {
      trips.changeCity(city);
      route.back();
      setTab('home');
    },
    [trips.changeCity, route.back]
  );

  // 底部 tab 切换要顺手关掉子页和表单，否则切过去还盖着一层
  const onPickTab = useCallback(
    (id: TabId) => {
      route.back();
      setSheetOpen(false);
      setTab(id);
      track('tab_switch', { tab: id });
    },
    [route.back]
  );

  // 持久层没读完先不渲染：闪一下默认行程再跳成存档，比空一下很难接受
  if (!booted) return <view className={cls('screen')} />;

  const Current = route.route ? SUB_PAGES[route.route] : null;

  return (
    <view className={cls('screen')}>
      <view className={cls('body')}>
        {Current ? (
          <Current
            demand={trips.demand}
            plans={trips.plans}
            planIndex={trips.planIndex}
            versions={trips.versions}
            tripId={trips.active?.id ?? ''}
            content={content.content}
            mine={content.mine}
            params={route.params}
            back={route.back}
            go={route.go}
            setTab={openTab}
            onPlan={openSheet}
            onCity={onCity}
            onPlanned={onPlanned}
            onRevise={trips.revisePlan}
            onToggleCollect={content.toggleCollect}
            onCheckIn={content.checkIn}
          />
        ) : (
          <MainTabs
            tab={tab}
            demand={trips.demand}
            plans={trips.plans}
            planIndex={trips.planIndex}
            tripId={trips.active?.id ?? ''}
            impact={trips.impact}
            trips={trips.store.trips}
            activeId={trips.store.activeId}
            content={content.content}
            mine={content.mine}
            nameOf={content.nameOf}
            setTab={openTab}
            onGo={route.go}
            onPlan={openSheet}
            onPickPlan={trips.pickPlan}
            onRevise={trips.revisePlan}
            onDismissImpact={trips.dismissImpact}
            onSwitchTrip={trips.switchTrip}
            onDeleteTrip={trips.deleteTrip}
          />
        )}
      </view>

      <TabBar current={tab} onPick={onPickTab} />

      {sheetOpen ? (
        <PlanSheet
          demand={trips.demand}
          cities={content.content.cities.filter((c) => c.isOpen).map((c) => c.id)}
          onClose={() => setSheetOpen(false)}
          onPlanned={onPlanned}
        />
      ) : null}

      <ToastHost />
    </view>
  );
}
