import { useCallback, useEffect, useRef, useState } from '@lynx-js/react';

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
import { useGuides } from './useGuides.js';
import { useLocationChannel } from './useLocationChannel.js';
import { useRoute } from './useRoute.js';
import { useTrips } from './useTrips.js';
import { useAuth } from './useAuth.js';
import { pullCloud, pushAllTrips, pushGuide, pushMemory } from '../sync.js';
import { hostShareToken } from '../hostBridge.js';
import { countUnshareable } from '../photoData.js';
import { toast } from '../toast.js';
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
  const guides = useGuides(booted);
  const auth = useAuth();
  const [tab, setTab] = useState<TabId>('home');
  const [sheetOpen, setSheetOpen] = useState(false);

  /**
   * 登录后补推本机数据 + 拉回云端（G5）。
   *
   * 两件事都必须在登录时自动做，不能要求用户「再编辑一次」：
   * 登录前攒下的行程 / 回忆 / 草稿云端没有，不补推就永远上不去；
   * 另一台设备上产生的数据只在云端，不拉就找不回来。
   *
   * 用 ref 按 userId 挡重复：登录态续期、页面重渲染都会让这个 effect 重跑，
   * 每跑一次就是三轮写 + 三个 GET，不能让它变成每次渲染都同步。
   */
  const syncedFor = useRef<string>('');
  useEffect(() => {
    const uid = auth.user?.id ?? '';
    if (!uid || syncedFor.current === uid) return;
    // 读档没完成就补推，推上去的是初始默认行程 —— 等于用空数据盖掉云端
    if (!trips.loaded || !trips.memoriesLoaded || !guides.loaded) return;
    syncedFor.current = uid;
    void (async () => {
      await pushAllTrips(trips.store.trips);
      for (const [tripId, mem] of Object.entries(trips.memories)) await pushMemory(tripId, mem);
      for (const [tripId, draft] of Object.entries(guides.drafts)) await pushGuide(draft.id, tripId, draft);

      const cloud = await pullCloud();
      if (!cloud) {
        // 拉不到就保持本机现状：说一句，但绝不动本机数据
        toast('云端数据没拉回来，本机数据不受影响');
        return;
      }
      trips.mergeRemoteTrips(cloud.trips);
      trips.mergeRemoteMemories(cloud.memories);
      guides.mergeRemote(cloud.guides);
      const added = cloud.trips.length + cloud.memories.length + cloud.guides.length;
      // 只在真的带回了东西时提示：每次登录都弹一句「已同步」是噪音
      if (added) toast(`已从云端找回 ${added} 条记录`);
    })();
  }, [auth.user?.id, trips.loaded, trips.memoriesLoaded, guides.loaded]);

  const openSheet = useCallback(() => setSheetOpen(true), []);
  const openTab = useCallback((id: TabId) => setTab(id), []);

  /** 当前行程的草稿与其中「发不出去」的照片数，供草稿页的发布区如实提示 */
  const activeDraft = guides.draftOf(trips.active?.id ?? '');
  const draftDirtyPhotos = activeDraft ? countUnshareable(activeDraft.photos, activeDraft.sections) : 0;


  /**
   * 分享页启动：外壳把 token 放进 globalProps，这里读一次就进分享路由。
   *
   * 只在首帧之后跑一次：`useLocationChannel` 在首帧就把 globalProps 落进了 hostBridge，
   * 所以 effect 里一定读得到。用 ref 挡住重复进入——用户从分享页点「回 App」后
   * 不该再被拉回去。
   */
  const shareEntered = useRef(false);
  useEffect(() => {
    if (shareEntered.current) return;
    shareEntered.current = true;
    const token = hostShareToken();
    if (token) route.go('share', { shareToken: token });
    // route 的身份稳定（useCallback 包过），只跑一次
  }, [route]);
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
            endedAt={trips.active?.endedAt}
            memory={trips.memoryOf(trips.active?.id ?? '')}
            onEnd={(ended) => trips.endTrip(trips.active?.id ?? '', ended)}
            onSaveOverview={(text) => trips.saveOverview(trips.active?.id ?? '', text)}
            onOverviewPhotos={(photos) => trips.setOverviewPhotos(trips.active?.id ?? '', photos)}
            onSavePlace={(patch) => trips.savePlaceNote(trips.active?.id ?? '', patch)}
            draft={guides.draftOf(trips.active?.id ?? '')}
            onGenerateDraft={() =>
              guides.generate(
                trips.active?.id ?? '',
                trips.demand,
                trips.plans,
                trips.planIndex,
                trips.memoryOf(trips.active?.id ?? '')
              )
            }
            onPatchDraft={(next) => guides.patch(trips.active?.id ?? '', next)}
            onToggleDraftPlace={(planRef) => guides.togglePlace(trips.active?.id ?? '', planRef)}
            perPerson={trips.plans[trips.planIndex]?.budget.perPerson ?? 0}
            publishedDraft={guides.published[trips.active?.id ?? ''] ?? null}
            publishingDraft={guides.publishing}
            // 只数「发不出去」的照片：local 与 dataUri 换设备就失效，不能承诺读者能看到
            draftDirtyPhotos={draftDirtyPhotos}
            onPublishDraft={() => {
              void (async () => {
                const res = await guides.publish(
                  trips.active?.id ?? '',
                  trips.plans[trips.planIndex]?.budget.perPerson
                );
                if (res === 'login') {
                  toast('发布需要先登录');
                  route.go('login');
                } else if (res === 'failed') {
                  toast('发布没成功，稍后再试一次');
                } else if (res === 'updated') {
                  toast('已更新，原链接还是同一个地址');
                } else {
                  toast('已发布，链接可以发出去了');
                }
              })();
            }}
            onUnpublishDraft={() => {
              void (async () => {
                const ok = await guides.unpublish(trips.active?.id ?? '');
                toast(ok ? '已撤回，原链接已经打不开了' : '撤回没成功，稍后再试一次');
              })();
            }}
            onCopyDraftLink={() => {
              // 壳层没有剪贴板能力时只能提示手动复制；页面上链接本身是可选中的文本
              const url = guides.published[trips.active?.id ?? '']?.url ?? '';
              if (!url) return;
              const nav = (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } })
                .navigator;
              // writeText 必须在点击的同步栈里调用：await 过再调会被浏览器判为「非用户手势」
              const p = nav?.clipboard?.writeText?.(url);
              if (!p) {
                toast('请长按上面的链接复制');
                return;
              }
              void p.then(
                () => toast('链接已复制'),
                () => toast('请长按上面的链接复制')
              );
            }}
            accountPhone={auth.user?.phone ?? null}
            smsCooldown={auth.sms.cooldown}
            smsSending={auth.sms.sending}
            smsVerifying={auth.sms.verifying}
            smsError={auth.sms.error}
            onSendCode={auth.sendCode}
            onVerifyCode={auth.verify}
            onLogout={auth.logout}
            devCodeHint={auth.devHint}
            shareToken={route.params.shareToken}
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
            accountPhone={auth.user?.phone ?? null}
            onLogin={() => route.go('login')}
          />
        )}
      </view>

      {/* 分享页是给站外访客看的只读页：底部 tab 会让人以为这是 App 内页，还会占掉一屏 */}
      {route.route === 'share' ? null : <TabBar current={tab} onPick={onPickTab} />}

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
