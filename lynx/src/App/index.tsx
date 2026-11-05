import { useCallback, useEffect, useMemo, useRef, useState, useGlobalProps } from '@lynx-js/react';

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
import { DEFAULT_DEMAND, applyPlaces, planFor } from '../data.js';
import { initialContent, fetchContent, fetchMine, EMPTY_MINE, addCollection, removeCollection, addFootprint } from '../remote.js';
import { PlayDetailPage } from '../pages/PlayDetailPage/index.js';
import { HotDetailPage } from '../pages/HotDetailPage/index.js';
import { GuideListPage } from '../pages/GuideListPage/index.js';
import { hydrate, loadStore, newTripId, saveStore } from '../storage.js';
import { setHostProps } from '../hostBridge.js';
import type { SavedTrip } from '../storage.js';
import { track } from '../track.js';
import { ToastHost, toast } from '../toast.js';

/** 只列有地点数据可用的城市，别让用户切过去看到空方案 */
import { tabSvg } from '../icons.js';
import { filledIcon } from '../icons-filled.js';
import type { ChangeImpact, Demand, Plan } from '../data.js';
import type { CollectTarget } from '../../../shared/types/index.js';
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

type Store = { trips: SavedTrip[]; activeId: string };

const emptyTrip = (): SavedTrip | null => {
  // 地点池没就绪时首屏也得好歹渲染出来，不能因为算不出方案整页白屏
  try {
    return {
      id: newTripId(),
      demand: DEFAULT_DEMAND,
      plans: planFor(DEFAULT_DEMAND),
      planIndex: 0,
      savedAt: new Date().toISOString(),
      versions: [],
    };
  } catch {
    return null;
  }
};

const initialStore = (): Store => {
  const first = emptyTrip();
  return first ? { trips: [first], activeId: first.id } : { trips: [], activeId: '' };
};

export function App() {
  // globalProps 只能通过官方 Hook 拿：直接读 globalThis.lynx 在原生和 web 两边都是
  // undefined（实测），定位坐标是壳经 updateGlobalPropsWithDictionary: 下发的。
  // 直接同步塞进去而不是放 useEffect：城市页在首帧就会读定位，
  // 等 effect 跑完再写的窗口期内会先渲染成「定位未接入」。
  setHostProps(useGlobalProps());

  // 本机存档要先等持久层读完（IndexedDB / 注入桥都是异步），没读完就渲染会闪一下默认数据
  const [booted, setBooted] = useState(false);
  const [tab, setTab] = useState<TabId>('home');
  // 行程是复数：一次规划 = 一条行程，用户在「我的」里切换，别再让后一次规划覆盖前一份
  const [store, setStore] = useState<Store>(initialStore);
  const [sheetOpen, setSheetOpen] = useState(false);
  // 局部修改只换掉被改的那一套方案，其它方案留着做对比
  const [impact, setImpact] = useState<ChangeImpact | null>(null);
  // 设计稿里的「智能建议」不是 tab，是从首页快捷入口进的子页
  const [route, setRoute] = useState<'advice' | 'detail' | 'assistant' | 'city' | 'guide' | 'guides' | 'hot' | 'play' | null>(null);
  // 内容区（城市/攻略/玩法）：先用缓存或随包种子渲染，接口回来再覆盖
  const [content, setContent] = useState(initialContent);
  // 收藏与足迹在服务端，按 clientId 归属这台设备
  const [mine, setMine] = useState(EMPTY_MINE);
  // 首页「精选攻略」/「爆款玩法」点开的是哪一条
  const [guideId, setGuideId] = useState('');
  const [playId, setPlayId] = useState('');
  // 热门推荐点开的是哪座城市
  const [hotCity, setHotCity] = useState('');
  // 持久层写不进去只提醒一次，别每改一下弹一条
  const warned = useRef(false);

  // 当前行程 + 当前选中的方案：全部由 store 派生，避免「页面各存一份 index」导致看的是另一套方案
  const active = useMemo(
    () => store.trips.find((t) => t.id === store.activeId) ?? store.trips[0],
    [store]
  );
  const demand = active?.demand ?? DEFAULT_DEMAND;
  const plans = active?.plans ?? [];
  const planIndex = active?.planIndex ?? 0;
  const versions = active?.versions ?? [];

  const mutateActive = useCallback((fn: (trip: SavedTrip) => SavedTrip) => {
    setStore((prev) => ({
      ...prev,
      trips: prev.trips.map((t) => (t.id === prev.activeId ? fn(t) : t)),
    }));
  }, []);

  useEffect(() => {
    let alive = true;
    hydrate().then(() => {
      if (!alive) return;
      const saved = loadStore();
      if (saved) setStore(saved);
      // 内容缓存也在本机，hydrate 之前读不到，读完再取一次
      setContent(initialContent());
      setBooted(true);
    });
    // 内容与「我的」都走接口；拿不到就继续用缓存/随包种子，不阻塞首屏
    fetchContent()
      .then((next) => {
        if (!alive) return;
        setContent(next);
        // 地点池以接口为准；失败时继续用随包副本，只是方案里的坐标是副本口径
        applyPlaces(next.places);
      })
      .catch(() => {});
    fetchMine()
      .then((next) => {
        if (alive) setMine(next);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // 存档没读出来之前不许写，否则会把上次的行程覆盖成默认数据
  useEffect(() => {
    if (!booted) return;
    if (saveStore(store)) {
      warned.current = false;
      return;
    }
    if (!warned.current) {
      warned.current = true;
      toast('本机存储不可用，这次改动刷新后会丢');
    }
  }, [booted, store]);

  const onToggleCollect = useCallback(
    (targetType: CollectTarget, targetId: string) => {
      const has = mine.collections.some((c) => c.targetType === targetType && c.targetId === targetId);
      // 先改本地再打接口：Lynx 端到端延迟肉眼可见，等响应回来再切换按钮会像卡住
      if (has) {
        setMine((prev) => ({
          ...prev,
          collections: prev.collections.filter((c) => !(c.targetType === targetType && c.targetId === targetId)),
        }));
        removeCollection(targetType, targetId).catch(() => {
          fetchMine().then(setMine).catch(() => {});
        });
      } else {
        addCollection(targetType, targetId)
          .then((r) => {
            if (r.item) setMine((prev) => ({ ...prev, collections: [...prev.collections, r.item!] }));
          })
          .catch(() => toast('网络不通，收藏没存上'));
      }
    },
    [mine.collections],
  );

  const onCheckIn = useCallback(
    (placeId: string) => {
      if (mine.footprints.some((f) => f.placeId === placeId)) return;
      addFootprint(placeId)
        .then((r) => {
          if (r.item) setMine((prev) => ({ ...prev, footprints: [...prev.footprints, r.item!] }));
        })
        .catch(() => toast('网络不通，打卡没记上'));
    },
    [mine.footprints],
  );

  const onPlanned = useCallback((nextDemand: Demand, nextPlans: Plan[]) => {
    // 新一次规划 = 新一条行程；不覆盖上一份，用户才敢多试几种需求
    const trip: SavedTrip = {
      id: newTripId(),
      demand: nextDemand,
      plans: nextPlans,
      planIndex: 0,
      savedAt: new Date().toISOString(),
      versions: [{ at: new Date().toISOString(), note: '首次生成' }],
    };
    setStore((prev) => ({ trips: [...prev.trips, trip], activeId: trip.id }));
    setImpact(null);
    setSheetOpen(false);
    // 从智能建议/行程详情里打开表单时，route 还指着子页；不关掉会生成完停在原子页
    setRoute(null);
    setTab('itinerary');
  }, []);

  const openSheet = useCallback(() => setSheetOpen(true), []);

  const onPickPlan = useCallback(
    (index: number) => {
      mutateActive((t) => ({ ...t, planIndex: Math.min(Math.max(0, index), t.plans.length - 1) }));
      track('compare_pick', { index });
    },
    [mutateActive]
  );

  const onRevise = useCallback(
    (index: number, nextPlan: Plan, nextImpact: ChangeImpact) => {
      const at = new Date().toISOString();
      mutateActive((t) => ({
        ...t,
        plans: t.plans.map((p, i) => (i === index ? nextPlan : p)),
        // 变更记录落盘：改了什么、影响多少，下次打开还看得到
        versions: [...t.versions, { at, note: nextImpact.note, impact: nextImpact }],
        savedAt: at,
      }));
      setImpact(nextImpact);
    },
    [mutateActive]
  );

  // 换城市要连行程一起重算，否则地图/行程/智能建议还是旧城市的方案
  const onCity = useCallback(
    (city: string) => {
      mutateActive((t) => {
        if (t.demand.destination === city) return t;
        const next: Demand = { ...t.demand, destination: city };
        try {
          // 换城市后旧方案里的地点全对不上，方案序号也必须归零
          return { ...t, demand: next, plans: planFor(next), planIndex: 0 };
        } catch {
          // 新城市没数据时保留旧行程，不让城市切换把行程清空
          return t;
        }
      });
      setRoute(null);
      setTab('home');
    },
    [mutateActive]
  );

  const onSwitchTrip = useCallback((id: string) => {
    setStore((prev) => ({ ...prev, activeId: id }));
    setImpact(null);
  }, []);

  const onDeleteTrip = useCallback((id: string) => {
    setStore((prev) => {
      const trips = prev.trips.filter((t) => t.id !== id);
      const activeId = trips.some((t) => t.id === prev.activeId) ? prev.activeId : (trips[0]?.id ?? '');
      return { trips, activeId };
    });
    setImpact(null);
  }, []);

  // 持久层没读完先不渲染：闪一下默认行程再跳成存档，比空一下很难接受
  if (!booted) return <view className={cls('screen')} />;

  return (
    <view className={cls('screen')}>
      <view className={cls('body')}>
        {route === 'city' ? (
          <CityPage
            city={demand.destination}
            cities={content.cities.filter((c) => c.isOpen).map((c) => c.id)}
            onPick={onCity}
            onBack={() => setRoute(null)}
          />
        ) : route === 'detail' ? (
          <TripDetailPage
            demand={demand}
            plans={plans}
            planIndex={planIndex}
            versions={versions}
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
        ) : route === 'play' ? (
          (() => {
            const play = content.plays.find((p) => p.id === playId) ?? content.plays[0];
            if (!play) return <view />;
            return (
              <PlayDetailPage
                play={play}
                places={play.placeIds
                  .map((id) => content.places.find((p) => p.id === id))
                  .filter((p): p is NonNullable<typeof p> => Boolean(p))}
                collected={mine.collections.some((c) => c.targetType === 'play' && c.targetId === play.id)}
                visitedIds={mine.footprints.map((f) => f.placeId)}
                onToggleCollect={() => onToggleCollect('play', play.id)}
                onCheckIn={onCheckIn}
                onBack={() => setRoute(null)}
              />
            );
          })()
        ) : route === 'guides' ? (
          <GuideListPage
            guides={content.guides}
            onBack={() => setRoute(null)}
            onOpen={(id) => {
              setGuideId(id);
              setRoute('guide');
              track('guide_open', { id, from: 'list' });
            }}
          />
        ) : route === 'hot' ? (
          (() => {
            const hot = content.cities.find((c) => c.id === hotCity) ?? content.cities[0];
            if (!hot) return <view />;
            return (
              <HotDetailPage
                city={hot}
                places={content.places}
                plays={content.plays}
                onBack={() => setRoute(null)}
                onSeeAllPlaces={() => {
                  setRoute(null);
                  setTab('map');
                }}
                onOpenPlay={(id) => {
                  setPlayId(id);
                  setRoute('play');
                  track('play_open', { id, from: 'hot' });
                }}
                // 加入行程 = 把这个城市设为当前目的地再打开表单，生成的方案才对得上
                onAddPlan={() => {
                  onCity(hot.id);
                  setSheetOpen(true);
                  track('hot_to_plan', { city: hot.id });
                }}
              />
            );
          })()
        ) : route === 'guide' ? (
          <GuideDetailPage
            guide={content.guides.find((g) => g.id === guideId) ?? content.guides[0]}
            onBack={() => setRoute(null)}
            collected={mine.collections.some((c) => c.targetType === 'guide' && c.targetId === guideId)}
            onToggleCollect={() => onToggleCollect('guide', guideId)}
          />
        ) : route === 'advice' ? (
          <AdvicePage demand={demand} plans={plans} planIndex={planIndex} onBack={() => setRoute(null)} onPlan={openSheet} />
        ) : tab === 'home' ? (
          <HomePage
            city={demand.destination}
            onPickCity={() => setRoute('city')}
            onPlan={openSheet}
            onTab={(t) => { setRoute(null); setTab(t); }}
            onAdvice={() => setRoute('advice')}
            onAssistant={() => setRoute('assistant')}
            cities={content.cities}
            guides={content.guides}
            plays={content.plays}
            onOpenCity={(id) => {
              setHotCity(id);
              setRoute('hot');
              track('hot_open', { id });
            }}
            onAllGuides={() => {
              setRoute('guides');
              track('guide_list_open', {});
            }}
            onGuide={(id) => {
              setGuideId(id);
              setRoute('guide');
              track('guide_open', { id });
            }}
            onPlay={(id) => {
              setPlayId(id);
              setRoute('play');
              track('play_open', { id });
            }}
          />
        ) : tab === 'itinerary' ? (
          <ItineraryPage
            demand={demand}
            plans={plans}
            planIndex={planIndex}
            onPickPlan={onPickPlan}
            onPlan={openSheet}
            onMap={() => setTab('map')}
            onDetail={() => setRoute('detail')}
            onRevise={onRevise}
            impact={impact}
            onDismissImpact={() => setImpact(null)}
          />
        ) : tab === 'map' ? (
          <MapPage
            demand={demand}
            plans={plans}
            planIndex={planIndex}
            onPlan={openSheet}
            plays={content.plays}
            onPlay={(id) => {
              setPlayId(id);
              setRoute('play');
            }}
          />
        ) : tab === 'guide' ? (
          <GuidePage city={demand.destination} plans={plans} />
        ) : (
          <ProfilePage
            trips={store.trips}
            activeId={store.activeId}
            onSwitch={onSwitchTrip}
            onDelete={onDeleteTrip}
            collections={mine.collections}
            footprints={mine.footprints}
            nameOf={(item) => {
              if ('placeId' in item) {
                return content.places.find((p) => p.id === item.placeId)?.name ?? '已下架的景点';
              }
              if (item.targetType === 'place') return content.places.find((p) => p.id === item.targetId)?.name ?? '已下架的景点';
              if (item.targetType === 'guide') return content.guides.find((g) => g.id === item.targetId)?.title ?? '已下架的攻略';
              if (item.targetType === 'play') return content.plays.find((p) => p.id === item.targetId)?.title ?? '已下架的玩法';
              return item.targetId;
            }}
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
            <image
              src={tab === t.id ? filledIcon(t.icon, '#2478F2') : tabSvg(t.icon, false)}
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
          cities={content.cities.filter((c) => c.isOpen).map((c) => c.id)}
          onClose={() => setSheetOpen(false)}
          onPlanned={onPlanned}
        />
      ) : null}

      <ToastHost />
    </view>
  );
}
