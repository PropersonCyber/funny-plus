import { useCallback, useEffect, useMemo, useRef, useState } from '@lynx-js/react';

import { DEFAULT_DEMAND, planFor } from '../data.js';
import type { ChangeImpact, Demand, PhotoRef, PlaceNote, Plan, TripMemory } from '../data.js';
import { loadMemory, loadStore, newTripId, saveMemory, saveStore } from '../storage.js';
import type { MemoryBook, SavedTrip } from '../storage.js';
import { track } from '../track.js';
import { toast } from '../toast.js';
import { pushAllTrips, pushMemory } from '../sync.js';
import { mergeMemories, mergeTrips } from '../syncMerge.js';
import type { RemoteMemory } from '../syncMerge.js';

export type Store = { trips: SavedTrip[]; activeId: string };

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

/**
 * 行程 store：多行程的增删改、当前行程派生、方案切换与局部修订、存档读写。
 *
 * 「当前行程 + 当前方案」全部由 store 派生，不让页面各存一份 index ——
 * 那样迟早出现详情页看的是另一套方案。
 *
 * booted 之前不写档：hydrate 没完成时读不到旧存档，写下去就把上次的行程覆盖成默认数据。
 */
export function useTrips(booted: boolean) {
  // 行程是复数：一次规划 = 一条行程，用户在「我的」里切换，别再让后一次规划覆盖前一份
  const [store, setStore] = useState<Store>(initialStore);
  // 局部修改只换掉被改的那一套方案，其它方案留着做对比
  const [impact, setImpact] = useState<ChangeImpact | null>(null);
  // 持久层写不进去只提醒一次，别每改一下弹一条
  const warned = useRef(false);

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

  // 存档读出来之后才能覆盖默认行程。loaded 是「读档已完成」的闸门：
  // 读档 setStore 要等下一轮渲染才生效，而写档 effect 在同一轮提交里就跑了，
  // 那时 store 还是初始的默认行程——不加闸门就会把用户上次的存档覆盖掉。
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!booted) return;
    const saved = loadStore();
    if (saved) setStore(saved);
    setLoaded(true);
  }, [booted]);

  useEffect(() => {
    if (!loaded) return;
    if (saveStore(store)) {
      warned.current = false;
      // 本机已落盘，再尽力推云端：未登录时 pushAllTrips 内部直接跳过，不产生任何请求。
      // 全部行程都推而不是只推当前这一条：只推一条的话「存了 3 份、换设备只回来 1 份」
      void pushAllTrips(store.trips);
      return;
    }
    if (!warned.current) {
      warned.current = true;
      toast('本机存储不可用，这次改动刷新后会丢');
    }
  }, [loaded, store]);

  /**
   * 对话/表单生成的新方案落成一条行程。
   *
   * pickedIndex 是用户在对话里挑中的那套：不传就取第一套。
   * 存 planIndex 而不是把选中的那套挪到首位——方案对比里还要看其它两套，
   * 顺序被改过之后用户会以为方案变了。
   *
   * 返回值是新建的行程 id：调用方据此决定要不要切页面（导航意图不放进 store）。
   */
  const createTrip = useCallback((nextDemand: Demand, nextPlans: Plan[], pickedIndex = 0): string => {
    if (!nextPlans.length) return '';
    // 新一次规划 = 新一条行程；不覆盖上一份，用户才敢多试几种需求
    const trip: SavedTrip = {
      id: newTripId(),
      demand: nextDemand,
      plans: nextPlans,
      planIndex: Math.min(Math.max(0, pickedIndex), nextPlans.length - 1),
      savedAt: new Date().toISOString(),
      versions: [{ at: new Date().toISOString(), note: '首次生成' }],
    };
    setStore((prev) => ({ trips: [...prev.trips, trip], activeId: trip.id }));
    setImpact(null);
    return trip.id;
  }, []);

  const pickPlan = useCallback(
    (index: number) => {
      mutateActive((t) => ({ ...t, planIndex: Math.min(Math.max(0, index), t.plans.length - 1) }));
      track('compare_pick', { index });
    },
    [mutateActive]
  );

  const revisePlan = useCallback(
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
  const changeCity = useCallback(
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
    },
    [mutateActive]
  );

  const switchTrip = useCallback((id: string) => {
    setStore((prev) => ({ ...prev, activeId: id }));
    setImpact(null);
  }, []);

  const deleteTrip = useCallback((id: string) => {
    setStore((prev) => {
      const trips = prev.trips.filter((t) => t.id !== id);
      const activeId = trips.some((t) => t.id === prev.activeId) ? prev.activeId : (trips[0]?.id ?? '');
      return { trips, activeId };
    });
    setImpact(null);
  }, []);

  /* ---------------- 旅行回忆 ---------------- */

  /**
   * 回忆单独一份 state，不放 Store 里。
   *
   * 理由是生命周期不同：Store 每次改行程都会整体重写，回忆只在用户动它时才变。
   * 混在一起会让「改一次行程」触发回忆也重新序列化，而且一旦行程校验失败，
   * 用户的文字会跟着一起被丢弃 —— 那是不可接受的数据损失。
   */
  const [memories, setMemories] = useState<MemoryBook>({});
  const [memLoaded, setMemLoaded] = useState(false);

  useEffect(() => {
    if (!booted) return;
    setMemories(loadMemory());
    setMemLoaded(true);
  }, [booted]);

  useEffect(() => {
    if (!memLoaded) return;
    if (saveMemory(memories)) {
      // 回忆是纯私人内容，未登录时云端没有对应行，pushMemory 会自己跳过
      const tripId = store.activeId;
      const mem = memories[tripId];
      if (tripId && mem) void pushMemory(tripId, mem);
      return;
    }
    if (!warned.current) {
      warned.current = true;
      toast('本机存储不可用，这次改动刷新后会丢');
    }
  }, [memLoaded, memories]);

  /**
   * 把云端行程并进本机（G5 跨设备找回）。
   *
   * 只在这里做一次合并，之后照常走 saveStore —— 合并结果要落本机，
   * 否则下次冷启动又只剩本机原来那几份。
   *
   * activeId 不动：用户此刻在看哪一份是他自己的选择，
   * 云端多回来几份不该把他手上这份换掉。
   */
  const mergeRemoteTrips = useCallback((remote: SavedTrip[]) => {
    if (!remote.length) return;
    setStore((prev) => ({ ...prev, trips: mergeTrips(prev.trips, remote) }));
  }, []);

  /** 把云端回忆并进本机；照片里的 local / dataUri 已在服务端剥离，回来的都是可跨设备的 */
  const mergeRemoteMemories = useCallback((remote: RemoteMemory[]) => {
    if (!remote.length) return;
    setMemories((prev) => mergeMemories(prev, remote));
  }, []);

  /** 取某趟旅行的回忆；没有就返回一份空壳，不写回存储（避免只读浏览也产生写入） */
  const memoryOf = useCallback(
    (tripId: string): TripMemory => {
      const found = memories[tripId];
      if (found) return found;
      const now = new Date().toISOString();
      return { tripId, overview: '', photos: [], places: {}, createdAt: now, updatedAt: now };
    },
    [memories]
  );

  /**
   * 结束旅行。
   *
   * 只记时刻，不清任何数据：结束后行程仍然是用户的，只是归类到「已结束」。
   * 之后要重开（endedAt 置空）也走这里，所以不做成单向动作。
   */
  const endTrip = useCallback((id: string, ended: boolean) => {
    const at = new Date().toISOString();
    setStore((prev) => ({
      ...prev,
      trips: prev.trips.map((t) =>
        t.id === id ? { ...t, endedAt: ended ? at : undefined } : t
      ),
    }));
    track(ended ? 'trip_end' : 'trip_reopen', { tripId: id });
  }, []);

  /** 改整趟回顾。空串也存：用户清空内容是他自己的决定，不该被当成「没保存」 */
  const saveOverview = useCallback((tripId: string, overview: string) => {
    setMemories((prev) => {
      const now = new Date().toISOString();
      const cur = prev[tripId] ?? {
        tripId,
        overview: '',
        photos: [],
        places: {},
        createdAt: now,
        updatedAt: now,
      };
      return { ...prev, [tripId]: { ...cur, overview, updatedAt: now } };
    });
    track('memory_overview_save', { tripId, chars: overview.length });
  }, []);

  /** 加/删整趟照片 */
  const setOverviewPhotos = useCallback((tripId: string, photos: PhotoRef[]) => {
    setMemories((prev) => {
      const now = new Date().toISOString();
      const cur = prev[tripId] ?? {
        tripId,
        overview: '',
        photos: [],
        places: {},
        createdAt: now,
        updatedAt: now,
      };
      return { ...prev, [tripId]: { ...cur, photos, updatedAt: now } };
    });
  }, []);

  /**
   * 写一条地点记录。
   *
   * patch 只带要改的字段：调「去了」不该把用户已经写好的感受覆盖成空串。
   */
  const savePlaceNote = useCallback(
    (tripId: string, patch: { planRef: string; dayIndex: number; placeId: string; placeTitle: string } & Partial<PlaceNote>) => {
      setMemories((prev) => {
        const now = new Date().toISOString();
        const cur = prev[tripId] ?? {
          tripId,
          overview: '',
          photos: [],
          places: {},
          createdAt: now,
          updatedAt: now,
        };
        const existing = cur.places[patch.planRef];
        const next: PlaceNote = {
          planRef: patch.planRef,
          dayIndex: patch.dayIndex,
          placeId: patch.placeId,
          placeTitle: patch.placeTitle,
          // 新记录默认 unknown：用户没表态时绝不能替他认定「去过」
          visited: patch.visited ?? existing?.visited ?? 'unknown',
          text: patch.text ?? existing?.text ?? '',
          photos: patch.photos ?? existing?.photos ?? [],
          updatedAt: now,
        };
        return {
          ...prev,
          [tripId]: { ...cur, places: { ...cur.places, [patch.planRef]: next }, updatedAt: now },
        };
      });
    },
    []
  );

  return {
    store,
    active,
    demand,
    plans,
    planIndex,
    versions,
    impact,
    dismissImpact: useCallback(() => setImpact(null), []),
    createTrip,
    pickPlan,
    revisePlan,
    changeCity,
    switchTrip,
    deleteTrip,
    endTrip,
    memories,
    memoryOf,
    saveOverview,
    setOverviewPhotos,
    savePlaceNote,
    mergeRemoteTrips,
    mergeRemoteMemories,
    /** 给 App 用：读档没完成前不能做登录补推，否则推上去的是默认空行程 */
    loaded,
    memoriesLoaded: memLoaded
  };
}
