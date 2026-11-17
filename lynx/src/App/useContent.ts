import { useCallback, useEffect, useState } from '@lynx-js/react';

import { applyPlaces } from '../data.js';
import { EMPTY_MINE, addCollection, addFootprint, fetchContent, fetchMine, initialContent, removeCollection } from '../remote.js';
import type { Content, Mine } from '../remote.js';
import { toast } from '../toast.js';
import type { CollectTarget } from '../../../shared/types/index.js';
import type { Collection, Footprint } from '../../../shared/types/index.js';

/**
 * 内容区（城市/攻略/玩法/地点）与「我的」（收藏/足迹）。
 *
 * 三层数据来源，优先级从高到低：
 *   接口 → 本机缓存 → 随包种子。
 * 首屏先用缓存/种子渲染，接口回来再覆盖；接口失败就一直用缓存，不阻塞首屏。
 *
 * booted 之后要重读一次缓存：hydrate 之前 readLocal 拿不到存档，
 * 首帧那个 initialContent() 大概率是种子而不是上次的缓存。
 */
export function useContent(booted: boolean) {
  // 内容区（城市/攻略/玩法）：先用缓存或随包种子渲染，接口回来再覆盖
  const [content, setContent] = useState<Content>(initialContent);
  // 收藏与足迹在服务端，按 clientId 归属这台设备
  const [mine, setMine] = useState<Mine>(EMPTY_MINE);

  // 缓存只在「接口还没回来」时补一次，一旦接口回了就以接口为准。
  // 拆成两个 effect 后这里出现过真实回归：接口快于 hydrate 时会用缓存把接口结果盖掉，
  // 而地点池已经被 applyPlaces 换成接口口径 —— 界面内容和地点池对不上。
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    // fetched 只用来判断「要不要补缓存」，它不该触发本 effect，故不进 deps
    if (booted && !fetched) setContent(initialContent());
  }, [booted]);

  useEffect(() => {
    let alive = true;
    fetchContent()
      .then((next) => {
        if (!alive) return;
        setFetched(true);
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

  const toggleCollect = useCallback(
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
    [mine.collections]
  );

  const checkIn = useCallback(
    (placeId: string) => {
      if (mine.footprints.some((f) => f.placeId === placeId)) return;
      addFootprint(placeId)
        .then((r) => {
          if (r.item) setMine((prev) => ({ ...prev, footprints: [...prev.footprints, r.item!] }));
        })
        .catch(() => toast('网络不通，打卡没记上'));
    },
    [mine.footprints]
  );

  /**
   * 收藏/足迹条目的展示名。
   * 目标可能已经下架，所以每种类型都要给兜底文案——不能因为它没了就渲染空字符串，
   * 用户会以为列表坏了。
   */
  const nameOf = useCallback(
    (item: Collection | Footprint): string => {
      if ('placeId' in item) {
        return content.places.find((p) => p.id === item.placeId)?.name ?? '已下架的景点';
      }
      if (item.targetType === 'place') return content.places.find((p) => p.id === item.targetId)?.name ?? '已下架的景点';
      if (item.targetType === 'guide') return content.guides.find((g) => g.id === item.targetId)?.title ?? '已下架的攻略';
      if (item.targetType === 'play') return content.plays.find((p) => p.id === item.targetId)?.title ?? '已下架的玩法';
      return item.targetId;
    },
    [content]
  );

  return { content, mine, toggleCollect, checkIn, nameOf };
}
