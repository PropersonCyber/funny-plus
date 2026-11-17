import { useCallback, useEffect, useMemo, useRef, useState } from '@lynx-js/react';

import { DEFAULT_DEMAND, planFor } from '../data.js';
import type { ChangeImpact, Demand, Plan } from '../data.js';
import { loadStore, newTripId, saveStore } from '../storage.js';
import type { SavedTrip } from '../storage.js';
import { track } from '../track.js';
import { toast } from '../toast.js';

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
  };
}
