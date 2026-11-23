import { GuidePage } from '../pages/GuidePage/index.js';
import { HomePage } from '../pages/HomePage/index.js';
import { ItineraryPage } from '../pages/ItineraryPage/index.js';
import { MapPage } from '../pages/MapPage/index.js';
import { ProfilePage } from '../pages/ProfilePage/index.js';
import type { ChangeImpact, Demand, Plan } from '../data.js';
import type { Content, Mine } from '../remote.js';
import type { SavedTrip } from '../storage.js';
import type { TabId } from './tabs.js';
import type { RouteName, RouteParams } from './useRoute.js';

type Props = {
  tab: TabId;
  demand: Demand;
  plans: Plan[];
  planIndex: number;
  tripId: string;
  impact: ChangeImpact | null;
  trips: SavedTrip[];
  activeId: string;
  content: Content;
  mine: Mine;
  nameOf: (item: Mine['collections'][number] | Mine['footprints'][number]) => string;
  setTab: (id: TabId) => void;
  onGo: (name: RouteName, params?: Partial<RouteParams>) => void;
  onPlan: () => void;
  onPickPlan: (index: number) => void;
  onRevise: (index: number, plan: Plan, impact: ChangeImpact) => void;
  /** 固定 / 取消固定一条安排（N3）：固定的条目不会被 AI 改动或关键词兜底删掉 */
  onTogglePin: (planItemId: string, pinned: boolean) => void;
  onDismissImpact: () => void;
  onSwitchTrip: (id: string) => void;
  onDeleteTrip: (id: string) => void;
  /** 已登录手机号；null = 未登录，「我的」页据此显示登录入口 */
  accountPhone: string | null;
  onLogin: () => void;
};

/**
 * 主 tab 的内容区。
 *
 * 与「子页」分开渲染：子页是一层覆盖在 tab 之上的路由（见 App 里的 ROUTES），
 * 这里只负责五个 tab 各自那一屏。抽出来是为了让 App 只管「组合 + 路由表」，
 * 不再混着五百行 tab 分支。
 */
export function MainTabs(props: Props) {
  const { tab, demand, plans, planIndex, tripId, content, mine } = props;

  /**
   * 当前旅行卡（F01）。只挑展示需要的几个数，不把整份 Plan 传进首页 ——
   * 首页只读展示，传整份方案会让它「顺手」开始算行程，职责就散了。
   */
  const active = props.trips.find((t) => t.id === props.activeId) ?? props.trips[0];
  const currentTrip = active
    ? {
        id: active.id,
        destination: active.demand.destination,
        dayCount: active.demand.dayCount,
        party: active.demand.party,
        perPerson: active.plans[active.planIndex]?.budget.perPerson ?? 0,
        ended: !!active.endedAt,
      }
    : null;

  if (tab === 'home') {
    return (
      <HomePage
        city={demand.destination}
        onPickCity={() => props.onGo('city')}
        onAllCities={() => props.onGo('cityList')}
        // 主 CTA 进助理（自然语言），表单仍从「行程规划」快捷格进
        onPlan={() => props.onGo('assistant')}
        onAskAssistant={(text) => props.onGo('assistant', { ask: text })}
        trip={currentTrip}
        onTab={(t) => props.setTab(t)}
        onAdvice={() => props.onGo('advice')}
        onAssistant={() => props.onGo('assistant')}
        cities={content.cities}
        guides={content.guides}
        plays={content.plays}
        onOpenCity={(id) => props.onGo('hot', { cityId: id })}
        onAllGuides={() => props.onGo('guides')}
        onGuide={(id) => props.onGo('guide', { guideId: id })}
        onPlay={(id) => props.onGo('play', { playId: id })}
      />
    );
  }

  if (tab === 'itinerary') {
    return (
      <ItineraryPage
        demand={demand}
        plans={plans}
        tripId={tripId}
        planIndex={planIndex}
        onPickPlan={props.onPickPlan}
        onPlan={props.onPlan}
        onMap={() => props.setTab('map')}
        onDetail={() => props.onGo('detail')}
        onRevise={props.onRevise}
        onTogglePin={props.onTogglePin}
        impact={props.impact}
        onDismissImpact={props.onDismissImpact}
        // 现场入口带着一句话进助理；改动仍由对话里的确认卡收口
        onAsk={(text) => props.onGo('assistant', { ask: text })}
      />
    );
  }

  if (tab === 'map') {
    return (
      <MapPage
        demand={demand}
        plans={plans}
        planIndex={planIndex}
        onPlan={props.onPlan}
        plays={content.plays}
        onPlay={(id) => props.onGo('play', { playId: id })}
      />
    );
  }

  if (tab === 'guide') {
    return <GuidePage city={demand.destination} plans={plans} />;
  }

  return (
    <ProfilePage
      trips={props.trips}
      activeId={props.activeId}
      onSwitch={props.onSwitchTrip}
      onDelete={props.onDeleteTrip}
      collections={mine.collections}
      footprints={mine.footprints}
      nameOf={props.nameOf}
      onOpenTrip={() => props.setTab('itinerary')}
      accountPhone={props.accountPhone}
      onLogin={props.onLogin}
    />
  );
}
