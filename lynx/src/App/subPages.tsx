import type { ReactElement } from '@lynx-js/react';

import { AdvicePage } from '../pages/AdvicePage/index.js';
import { AssistantPage } from '../pages/AssistantPage/index.js';
import { CityListPage } from '../pages/CityListPage/index.js';
import { CityPage } from '../pages/CityPage/index.js';
import { GuideDetailPage } from '../pages/GuideDetailPage/index.js';
import { GuideListPage } from '../pages/GuideListPage/index.js';
import { HotDetailPage } from '../pages/HotDetailPage/index.js';
import { MemoryPage } from '../pages/MemoryPage/index.js';
import { PlayDetailPage } from '../pages/PlayDetailPage/index.js';
import type { ChangeImpact, Demand, PhotoRef, PlaceNote, Plan, TripMemory } from '../data.js';
import { TripDetailPage } from '../pages/TripDetailPage/index.js';
import type { Content, Mine } from '../remote.js';
import { track } from '../track.js';
import type { RouteName, RouteParams } from './useRoute.js';

export type SubPageProps = {
  demand: Demand;
  plans: Plan[];
  planIndex: number;
  versions: { at: string; note: string }[];
  tripId: string;
  content: Content;
  mine: Mine;
  params: RouteParams;
  back: () => void;
  go: (name: RouteName, params?: Partial<RouteParams>) => void;
  /** 只切 tab，不动路由：调用方要回 tab 层时自己先 back() */
  setTab: (id: 'home' | 'map' | 'itinerary' | 'guide' | 'profile') => void;
  onPlan: () => void;
  onCity: (city: string) => void;
  onPlanned: (demand: Demand, plans: Plan[], pickedIndex?: number) => string;
  onRevise: (index: number, plan: Plan, impact: ChangeImpact) => void;
  onToggleCollect: (target: 'place' | 'fact' | 'guide' | 'play', id: string) => void;
  onCheckIn: (placeId: string) => void;
  /** 行程是否已结束；回忆页据此显示「结束」还是「重新标记为进行中」 */
  endedAt?: string;
  memory: TripMemory;
  onEnd: (ended: boolean) => void;
  onSaveOverview: (text: string) => void;
  onOverviewPhotos: (photos: PhotoRef[]) => void;
  onSavePlace: (
    patch: { planRef: string; dayIndex: number; placeId: string; placeTitle: string } & Partial<PlaceNote>
  ) => void;
};

/**
 * 子页路由表。
 *
 * 之前这是一个 9 层的三元表达式链，加页面要动三处（类型、链、调用点）。
 * 现在是 `route → 渲染函数` 的映射，加页面只加一行 + 一个 RouteName。
 *
 * 每项拿到整齐的 SubPageProps，自己决定用哪几个——比让 App 记住
 * 「哪个页面要 versions、哪个要 plays」更不容易漏传。
 */
export const SUB_PAGES: Record<RouteName, (p: SubPageProps) => ReactElement> = {
  cityList: (p) => (
    <CityListPage
      onBack={p.back}
      onOpen={(id) => {
        p.go('hot', { cityId: id });
        track('hot_open', { id, source: 'city_list' });
      }}
    />
  ),

  city: (p) => (
    <CityPage
      current={p.demand.destination}
      cities={p.content.cities.filter((c) => c.isOpen).map((c) => c.id)}
      onPick={p.onCity}
      onBack={p.back}
      // 热门城市「查看更多」直接进热门城市列表页，和首页「全部城市」同一个目标：
      // 两个入口各写一套筛选逻辑，用户迟早会看到两份不一样的「热门」
      onMore={() => {
        p.go('cityList');
        track('city_list_open', { source: 'city_page_more' });
      }}
    />
  ),

  detail: (p) => (
    <TripDetailPage
      demand={p.demand}
      plans={p.plans}
      planIndex={p.planIndex}
      versions={p.versions}
      onBack={p.back}
      onNavigate={() => {
        p.back();
        p.setTab('map');
      }}
      onEdit={p.onPlan}
      endedAt={p.endedAt}
      onMemory={() => p.go('memory')}
    />
  ),

  // 旅行回忆：私人的「实际发生了什么」，与行程（计划）分开
  memory: (p) => (
    <MemoryPage
      demand={p.demand}
      plans={p.plans}
      planIndex={p.planIndex}
      endedAt={p.endedAt}
      memory={p.memory}
      onBack={p.back}
      onSaveOverview={p.onSaveOverview}
      onPhotos={p.onOverviewPhotos}
      onSavePlace={p.onSavePlace}
      onEnd={() => p.onEnd(!p.endedAt)}
    />
  ),
  assistant: (p) => (
    <AssistantPage
      tripId={p.tripId}
      demand={p.demand}
      plan={p.plans[p.planIndex] ?? null}
      planIndex={p.planIndex}
      onBack={p.back}
      onOpenItinerary={() => {
        p.back();
        p.setTab('itinerary');
      }}
      // 对话里选的方案直接落成当前行程：落到同一个 store，
      // 行程页渲染的就是用户刚才在对话里挑的那一份，不存在第二份展示数据
      onApplyPlans={(nextDemand, nextPlans, nextIndex) => p.onPlanned(nextDemand, nextPlans, nextIndex)}
      // 确认后留在对话页：卡片要显示「已写进行程」，跳走就看不见了（spec FR-2）。
      // 想核对整份行程用卡片上的「去行程页核对」，导航仍由用户发起。
      onApplyRevise={(nextPlan, nextImpact) => {
        p.onRevise(p.planIndex, nextPlan, nextImpact);
      }}
    />
  ),

  play: (p) => {
    const play = p.content.plays.find((x) => x.id === p.params.playId) ?? p.content.plays[0];
    if (!play) return <view />;
    return (
      <PlayDetailPage
        play={play}
        places={play.placeIds
          .map((id) => p.content.places.find((x) => x.id === id))
          .filter((x): x is NonNullable<typeof x> => Boolean(x))}
        collected={p.mine.collections.some((c) => c.targetType === 'play' && c.targetId === play.id)}
        visitedIds={p.mine.footprints.map((f) => f.placeId)}
        onToggleCollect={() => p.onToggleCollect('play', play.id)}
        onCheckIn={p.onCheckIn}
        onBack={p.back}
      />
    );
  },

  guides: (p) => (
    <GuideListPage
      guides={p.content.guides}
      onBack={p.back}
      onOpen={(id) => {
        p.go('guide', { guideId: id });
        track('guide_open', { id, from: 'list' });
      }}
    />
  ),

  hot: (p) => {
    const hot = p.content.cities.find((c) => c.id === p.params.cityId) ?? p.content.cities[0];
    if (!hot) return <view />;
    return (
      <HotDetailPage
        city={hot}
        places={p.content.places}
        plays={p.content.plays}
        onBack={p.back}
        // 先退掉子页再切 tab：只切 tab 的话 route 还指着 hot，界面不会动
        onSeeAllPlaces={() => {
          p.back();
          p.setTab('map');
        }}
        onOpenPlay={(id) => {
          p.go('play', { playId: id });
          track('play_open', { id, from: 'hot' });
        }}
        // 加入行程 = 把这个城市设为当前目的地再打开表单，生成的方案才对得上
        onAddPlan={() => {
          p.onCity(hot.id);
          p.onPlan();
          track('hot_to_plan', { city: hot.id });
        }}
      />
    );
  },

  guide: (p) => {
    // 收藏必须绑「实际展示的这一条」：参数 id 失效时会回落到 guides[0]，
    // 若还拿参数 id 去查/写收藏，就会显示未收藏、点一下往服务端写空 id
    const guide = p.content.guides.find((g) => g.id === p.params.guideId) ?? p.content.guides[0];
    if (!guide) return <view />;
    return (
      <GuideDetailPage
        guide={guide}
        onBack={p.back}
        collected={p.mine.collections.some((c) => c.targetType === 'guide' && c.targetId === guide.id)}
        onToggleCollect={() => p.onToggleCollect('guide', guide.id)}
      />
    );
  },

  advice: (p) => (
    <AdvicePage demand={p.demand} plans={p.plans} planIndex={p.planIndex} onBack={p.back} onPlan={p.onPlan} />
  ),
};
