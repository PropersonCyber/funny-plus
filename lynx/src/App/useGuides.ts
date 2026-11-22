import { useCallback, useEffect, useRef, useState } from '@lynx-js/react';

import { newGuideId, loadGuides, saveGuides } from '../storage.js';
import type { GuideBook } from '../storage.js';
import { track } from '../track.js';
import { toast } from '../toast.js';
import { pushGuide, publishGuide, unpublishGuide } from '../sync.js';
import { mergeGuides } from '../syncMerge.js';
import type { Demand, GuideDraft, GuideSection, Plan, TripMemory } from '../data.js';

/**
 * 攻略草稿（F08 前半）。
 *
 * 为什么单独一个 hook 而不是塞进 useTrips：草稿的编辑频率远高于行程（用户会反复改
 * 标题、勾地点、开关费用），混进 trips 的 store 会让每次敲字都重写整份行程存档。
 *
 * 这个 hook 只负责「本机草稿」。发布（链接、快照、撤回）需要账号与服务端，不在这一期。
 */

/**
 * 从回忆生成一份草稿。
 *
 * 所有地点都进 sections，由用户在页面上逐个勾选是否写进攻略；
 * 默认勾上的只有「明确点过去了（visited === 'yes'）」的。
 *
 * 为什么不默认全勾：默认选中等于替用户宣称他去过，而 unknown 的意思是「用户没说」。
 * 反过来也不默认全不勾：那用户要挨个点一遍，而大多数条目他确实去过。
 * 折中点就是把「他去过的」预先勾好，其余留给他自己决定。
 *
 * 费用默认不公开：隐私开关的默认值必须是「不公开」。
 */
export function draftFromMemory(
  tripId: string,
  demand: Demand,
  plans: Plan[],
  planIndex: number,
  memory: TripMemory
): GuideDraft {
  const plan = plans[Math.min(planIndex, plans.length - 1)] ?? plans[0];
  const days = plan?.days ?? [];

  const sections: GuideSection[] = days
    .map((d) => {
      const items = d.items
        .filter((it) => it.kind !== 'meal' && !!it.placeId)
        .map((it) => {
          const note = memory.places[it.id];
          return {
            planRef: it.id,
            placeTitle: it.title,
            text: note?.text ?? '',
            visited: note?.visited ?? ('unknown' as const),
            photos: note?.photos ?? [],
          };
        });
      return { dayIndex: d.index, items };
    })
    .filter((s) => s.items.length > 0);

  // 默认只勾「明确去过」的；其余保留在 sections 里等用户自己决定
  const picked: Record<string, boolean> = {};
  for (const s of sections) {
    for (const it of s.items) picked[it.planRef] = it.visited === 'yes';
  }

  const now = new Date().toISOString();
  return {
    id: newGuideId(),
    tripId,
    title: `${demand.destination} ${demand.dayCount} 天：我的走法`,
    summary: memory.overview,
    // 照片默认不带：发布是公开行为，默认值必须是「不公开」。
    // 用户要带哪几张，在草稿页自己勾 —— 早先自动带前 3 张，等于替用户决定了公开内容。
    photos: [],
    showCost: false,
    picked,
    sections,
    createdAt: now,
    updatedAt: now,
  };
}

export function useGuides(booted: boolean) {
  const [book, setBook] = useState<GuideBook>({});
  const [loaded, setLoaded] = useState(false);
  const warned = useRef(false);

  useEffect(() => {
    if (!booted) return;
    setBook(loadGuides());
    setLoaded(true);
  }, [booted]);

  useEffect(() => {
    if (!loaded) return;
    if (saveGuides(book)) {
      // 草稿 id 与 tripId 不同（同一行程重生成会换 id），两个都要给云端，见 pushGuide
      for (const [tripId, draft] of Object.entries(book)) {
        void pushGuide(draft.id, tripId, draft);
      }
      return;
    }
    if (!warned.current) {
      warned.current = true;
      toast('本机存储不可用，这次改动刷新后会丢');
    }
  }, [loaded, book]);

  const draftOf = useCallback((tripId: string): GuideDraft | null => book[tripId] ?? null, [book]);

  /**
   * 新建或覆盖某趟旅程的草稿。
   *
   * 用 tripId 作为 book 的 key 而不是草稿自己的 id：一趟旅程对应一份攻略，
   * 多份会让「我到底该发哪一个」变成用户要解决的问题。
   */
  const putDraft = useCallback((draft: GuideDraft) => {
    setBook((prev) => ({ ...prev, [draft.tripId]: { ...draft, updatedAt: new Date().toISOString() } }));
  }, []);

  const generate = useCallback(
    (tripId: string, demand: Demand, plans: Plan[], planIndex: number, memory: TripMemory) => {
      const draft = draftFromMemory(tripId, demand, plans, planIndex, memory);
      putDraft(draft);
      track('guide_draft_create', { tripId });
      return draft;
    },
    [putDraft]
  );

  const patch = useCallback((tripId: string, next: Partial<GuideDraft>) => {
    setBook((prev) => {
      const cur = prev[tripId];
      if (!cur) return prev;
      return { ...prev, [tripId]: { ...cur, ...next, updatedAt: new Date().toISOString() } };
    });
  }, []);

  /** 从草稿里增删某个地点，决定它是否出现在分享内容里 */
  const togglePlace = useCallback((tripId: string, planRef: string) => {
    setBook((prev) => {
      const cur = prev[tripId];
      if (!cur) return prev;
      // 只翻 picked 这一位；sections 是内容清单，不因勾选变化而增删
      const picked = { ...cur.picked, [planRef]: !cur.picked[planRef] };
      return { ...prev, [tripId]: { ...cur, picked, updatedAt: new Date().toISOString() } };
    });
  }, []);

  const drop = useCallback((tripId: string) => {
    setBook((prev) => {
      const next = { ...prev };
      delete next[tripId];
      return next;
    });
    track('guide_draft_delete', { tripId });
  }, []);

  /**
   * 发布 / 撤回（F08 后半）。
   *
   * 发布状态按 tripId 存本机，与草稿同一套 key：一趟旅程对应一份攻略一条链接。
   * 不做「从云端查我发过哪些」，因为本机记的这一份就是用户此刻关心的那一份；
   * 换设备后本来也该以服务端草稿为准，那是同步那一期的事。
   *
   * `publishing` 挡重复点击：发布要建记录、生成 token，连点两次会出两条不同的分享。
   */
  const [published, setPublished] = useState<Record<string, { token: string; url: string }>>({});
  const [publishing, setPublishing] = useState(false);

  const publish = useCallback(
    async (tripId: string, perPerson: number | undefined): Promise<'ok' | 'updated' | 'login' | 'failed'> => {
      const draft = book[tripId];
      if (!draft || publishing) return 'failed';
      setPublishing(true);
      try {
        const res = await publishGuide(draft.id, perPerson);
        if (!res.ok) return res.reason;
        setPublished((prev) => ({ ...prev, [tripId]: { token: res.token, url: res.url } }));
        track('guide_publish', { tripId, updated: res.updated });
        return res.updated ? 'updated' : 'ok';
      } finally {
        setPublishing(false);
      }
    },
    [book, publishing]
  );

  const unpublish = useCallback(
    async (tripId: string): Promise<boolean> => {
      const draft = book[tripId];
      if (!draft) return false;
      const ok = await unpublishGuide(draft.id);
      if (!ok) return false;
      // 撤回成功就清掉本机的链接：留着一条点开是引导页的链接只会让人困惑
      setPublished((prev) => {
        const next = { ...prev };
        delete next[tripId];
        return next;
      });
      track('guide_unpublish', { tripId });
      return true;
    },
    [book]
  );

  /**
   * 把云端草稿并进本机（G5 跨设备找回）。
   *
   * 服务端的列表接口把当前有效的分享一起回了，所以并进来的同时「已发布」状态也回来 ——
   * 不回的话换设备后会以为没发过，又点一次发布；虽然服务端是幂等的（同一条链接），
   * 但界面上那句「已发布，链接可以发出去了」会变成误导。
   */
  const mergeRemote = useCallback(
    (remote: { tripId: string; payload: GuideDraft; share: { token: string; url: string } | null }[]) => {
      if (!remote.length) return;
      setBook((prev) => mergeGuides(prev, remote));
      setPublished((prev) => {
        const next = { ...prev };
        for (const r of remote) {
          const key = r.tripId || r.payload.tripId;
          if (key && r.share) next[key] = r.share;
        }
        return next;
      });
    },
    []
  );
  return {
    drafts: book,
    draftOf,
    generate,
    patch,
    togglePlace,
    drop,
    published,
    publishing,
    publish,
    unpublish,
    mergeRemote,
    /** 给 App 用：读档没完成前不能做登录补推，否则推上去的是空草稿 */
    loaded
  };
}
