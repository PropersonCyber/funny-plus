import { IconSvg } from '../../IconSvg.js';
import { useCallback, useEffect, useMemo, useRef, useState } from '@lynx-js/react';

import mascotAi from '../../assets/ip/mascot-ai.png';
import { MOCK } from '../../mock.js';
import { chat, aiStatus } from '../../aiChat.js';
import type { ChatMessage, ChatSlots } from '../../aiChat.js';
import { CHAT_STORAGE_KEY, followTrip, parseChatBook, readLog, writeLog } from '../../chatSession.js';
import { readLocal, writeLocal } from '../../storage.js';
import { svgIcon } from '../../icons.js';
import { placeById } from '../../data.js';
import type { ChangeImpact, Demand, Plan } from '../../data.js';
import { setJourney, track } from '../../track.js';
import type { RevisePreview, TripContext } from '../../../../shared/types/index.js';
import {
  beginPreview,
  cancelPreview,
  confirmPreview,
  type PreviewStatus,
  type RevisionBase,
  type RevisionState,
} from '../../a2ui/revisionState.js';
import { RevisionSurface } from '../../a2ui/RevisionSurface.js';
import styles from './index.module.scss';
import { makeCls } from '../../styles/cls.js';

const cls = makeCls(styles);

type Props = {
  /** 当前旅行：对话必须看着这一份说话，否则会出现「咕噜讲的和工作台排的不是一回事」 */
  tripId: string;
  demand: Demand;
  /** 工作台上正在看的那套方案；没有行程时为 null */
  plan: Plan | null;
  /** 上面这套 plan 在 plans 里的位置；过期判定要它，只比 plan 引用会漏掉同plan换序号 */
  planIndex: number;
  onBack: () => void;
  /** 确认后去行程页核对整体：导航意图由用户点，不由应用替用户跳 */
  onOpenItinerary: () => void;
  /** 把这次对话生成的方案落成一条行程并切到行程页；返回新建行程 id，空串表示没写成 */
  onApplyPlans: (demand: Demand, plans: Plan[], planIndex: number) => string;
  /** 确认咕噜提的修改，写到当前行程上 */
  onApplyRevise: (plan: Plan, impact: ChangeImpact) => void;
};

/** 麦克风图表不在 docs/materials/icons 里，只有这一个页面用，就地内联 */
const MIC_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2.6" width="6" height="11" rx="3"/><path d="M5.2 11a6.8 6.8 0 0 0 13.6 0M12 17.8V21"/></svg>`;

const micSvg = (color: string) => MIC_SVG.split('currentColor').join(color);

/** 工具名 → 等待文案。模型调工具时会有几秒没有文本输出，不给反馈就像卡死 */
const TOOL_HINT: Record<string, string> = {
  updateDemand: '咕噜正在理解你的需求…',
  queryPlaces: '咕噜正在查景点…',
  generatePlans: '咕噜正在排行程…',
  proposeRevise: '咕噜正在算怎么改…',
};

type Turn = {
  role: 'user' | 'assistant';
  text: string;
  /** 这一轮生成的方案；用户可挑一套再进工作台 */
  plans?: Plan[];
  planDemand?: Demand;
  /** 用户挑了哪一套 */
  picked?: number;
  /** 咕噜提的一次修改，等用户确认 */
  preview?: RevisePreview;
  /**
   * 这份预览的身份与状态。放在轮次里而不是页面级 Map：
   * 一轮只保留最后一份预览，覆盖即作废旧 previewId，天然满足「旧动作忽略」。
   */
  revision?: RevisionState;
};

/**
 * AI 助手（设计稿第 7 屏）。
 *
 * 对话历史与槽位都由本组件持有、每轮随请求发给服务端：
 * 目前没有账号体系，服务端存了也分不清是谁的，存了反而制造一份无主的隐私数据。
 * 接上登录后再迁到服务端，接口形状不用变。
 *
 * 与工作台的关系：进来时读同一份当前行程（demand + plan），走的时候把选中的方案写回同一份 store。
 * 用户在这里看到的内容，就是行程页上排的内容 —— 中间不存在另一份「展示用」数据。
 */
export function AssistantPage({
  tripId,
  demand,
  plan,
  planIndex,
  onBack,
  onOpenItinerary,
  onApplyPlans,
  onApplyRevise,
}: Props) {
  // 只切视觉态：录音没有接，别让按钮看起来像真的在收音
  const [listening, setListening] = useState(false);
  const toggleListening = useCallback(() => setListening((v) => !v), []);

  const [enabled, setEnabled] = useState<boolean | null>(null);
  // 按当前行程把上次的对话从本机读回来。方案卡片不存：行程以工作台那份为准
  const stored = useRef(readLog(parseChatBook(readLocal(CHAT_STORAGE_KEY)), tripId));
  const [turns, setTurns] = useState<Turn[]>(() => stored.current.turns);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [hint, setHint] = useState('');

  // 槽位与历史用 ref：流式回调里要读到最新值，state 的快照会读到旧的
  const slotsRef = useRef<ChatSlots>(stored.current.slots);
  const turnsRef = useRef<Turn[]>(stored.current.turns);

  const persist = useCallback((id: string, nextTurns: Turn[], slots: ChatSlots) => {
    const book = parseChatBook(readLocal(CHAT_STORAGE_KEY));
    writeLocal(
      CHAT_STORAGE_KEY,
      JSON.stringify(
        writeLog(book, id, {
          turns: nextTurns.map((t) => ({ role: t.role, text: t.text })),
          slots,
        })
      )
    );
  }, []);

  useEffect(() => {
    persist(tripId, turns, slotsRef.current);
  }, [persist, tripId, turns]);

  /**
   * 开口前就把当前需求填进槽位。
   * 不填的话用户说「第二天轻松点」时咕噜还在问「去哪儿、玩几天」，
   * 而这两件事工作台上早就有了。已经从本机恢复过槽位时不再覆盖。
   */
  useEffect(() => {
    if (slotsRef.current.destination) return;
    slotsRef.current = {
      destination: demand.destination,
      dayCount: demand.dayCount,
      party: demand.party,
      budgetLevel: demand.budgetLevel,
      preferences: demand.preferences,
      transport: demand.transport,
      notes: demand.notes,
    };
  }, [demand]);

  // 每次发问前取最新的行程，避免 useCallback 里抓到旧 plan
  const trip = useMemo<TripContext | undefined>(
    () => (plan ? { tripId, demand, plan } : undefined),
    [tripId, demand, plan]
  );
  const tripRef = useRef<TripContext | undefined>(trip);
  tripRef.current = trip;

  // 这一轮工作属于哪条验收旅程：带行程进来是「改已有行程」，没带是「从零规划」。
  // 它只影响埋点与 AI 度量的分组，不改变任何界面行为 —— 所以放在 effect 里标一次，
  // 不塞进 render 路径。离开页面时清掉，避免下一页的事件被算进上一段旅程。
  useEffect(() => {
    setJourney(trip ? 'revise' : 'plan');
    return () => setJourney(null);
  }, [trip]);

  // input 没有受控 value，靠换 key 重挂载来清空，发完一轮 +1
  const [inputKey, setInputKey] = useState(0);

  useEffect(() => {
    let alive = true;
    aiStatus().then((r) => {
      if (alive) setEnabled(r.enabled);
    });
    return () => {
      alive = false;
    };
  }, []);

  const appendDelta = useCallback((text: string) => {
    setTurns((prev) => {
      const last = prev[prev.length - 1];
      // 流式增量要累加到同一条助手消息上，不是每条新开一个气泡
      const next: Turn[] =
        last && last.role === 'assistant' && !last.plans
          ? [...prev.slice(0, -1), { ...last, text: last.text + text }]
          : [...prev, { role: 'assistant' as const, text }];
      turnsRef.current = next;
      return next;
    });
  }, []);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;

    const history: ChatMessage[] = [
      ...turnsRef.current.map((t) => ({ role: t.role, content: t.text })),
      { role: 'user', content: text },
    ];
    const nextTurns: Turn[] = [...turnsRef.current, { role: 'user', text }];
    turnsRef.current = nextTurns;
    setTurns(nextTurns);
    setDraft('');
    setSending(true);
    setHint('');

    try {
      const res = await chat(
        history,
        slotsRef.current,
        {
          onDelta: appendDelta,
          onTool: (name) => setHint(TOOL_HINT[name] ?? ''),
          onPlans: (plans, planDemand) => {
            setTurns((prev) => {
              const last = prev[prev.length - 1];
              const next =
                last && last.role === 'assistant'
                  ? [...prev.slice(0, -1), { ...last, plans, planDemand, picked: 0 }]
                  : [...prev, { role: 'assistant' as const, text: '', plans, planDemand, picked: 0 }];
              // ref 必须在函数式更新里同步：下一轮 history 从这里取，
              // 而 setTurns 是异步的，在外部赋值会拿到旧数组
              turnsRef.current = next;
              return next;
            });
          },
          onRevise: (preview) => {
            // 基准取「此刻这一份行程」：确认时再比一次，行程动过就判过期
            const baseline: RevisionBase = {
              tripId,
              planIndex,
              planRef: tripRef.current?.plan as Plan,
            };
            const revision = beginPreview(baseline);
            setTurns((prev) => {
              const last = prev[prev.length - 1];
              // 一轮只留最后一份预览：覆盖时旧 revision 一起换掉，旧 previewId 的动作自然失效
              const next =
                last && last.role === 'assistant'
                  ? [...prev.slice(0, -1), { ...last, preview, revision }]
                  : [...prev, { role: 'assistant' as const, text: '', preview, revision }];
              turnsRef.current = next;
              return next;
            });
          },
        },
        tripRef.current
      );
      slotsRef.current = res.slots;
      persist(tripId, turnsRef.current, res.slots);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '网络异常，请重试';
      setTurns((prev) => {
        const next: Turn[] = [...prev, { role: 'assistant' as const, text: msg }];
        turnsRef.current = next;
        return next;
      });
    } finally {
      setSending(false);
      setHint('');
      // 清空输入框：Lynx 的 input 无受控 value，换 key 重挂载
      setInputKey((k) => k + 1);
    }
  }, [draft, sending, appendDelta, persist, tripId]);

  const onInput = useCallback((e: { detail: { value: string } }) => setDraft(e.detail.value), []);

  /** 只改这一条气泡上的选中项，不动其它轮 */
  const pickPlan = useCallback((turnIndex: number, index: number) => {
    setTurns((prev) => {
      const next = prev.map((t, i) => (i === turnIndex ? { ...t, picked: index } : t));
      turnsRef.current = next;
      return next;
    });
  }, []);

  const applyPlans = useCallback(
    (turnIndex: number) => {
      const turn = turnsRef.current[turnIndex];
      if (!turn?.plans?.length || !turn.planDemand) return;
      const nextId = onApplyPlans(turn.planDemand, turn.plans, turn.picked ?? 0);
      if (!nextId) return;
      const book = parseChatBook(readLocal(CHAT_STORAGE_KEY));
      writeLocal(CHAT_STORAGE_KEY, JSON.stringify(followTrip(book, tripId, nextId)));
      // 建议采纳：对话里选定哪一版是「咕噜的建议有没有用」的唯一证据。
      // 放在 nextId 之后，落行程失败的不算采纳。
      track('plan_adopted', {
        picked: turn.picked ?? 0,
        options: turn.plans.length,
        dayCount: turn.planDemand.dayCount,
        isNewTrip: !tripId
      });
    },
    [onApplyPlans, tripId]
  );

  /**
   * 确认应用。防重与过期都交给状态机，这里只负责「把新状态写回这一轮」。
   *
   * 为什么按 previewId 而不是 turnIndex：对话从本机恢复时只有 role/text，轮次下标
   * 与原始轮次对不上，拿下标定位会点错卡片。previewId 是这一份预览自己的身份。
   */
  const applyRevise = useCallback(
    (turnIndex: number) => {
      const turn = turnsRef.current[turnIndex];
      if (!turn?.preview || !turn.revision) return;

      const current: RevisionBase = {
        tripId,
        planIndex,
        planRef: plan as Plan,
      };
      const nextRevision = confirmPreview(turn.revision, current, () => {
        onApplyRevise(turn.preview!.plan, turn.preview!.impact);
      });
      if (nextRevision === turn.revision) return;

      setTurns((prev) => {
        const next = prev.map((t, i) => (i === turnIndex ? { ...t, revision: nextRevision } : t));
        turnsRef.current = next;
        return next;
      });
    },
    [onApplyRevise, tripId, planIndex, plan]
  );

  /** 取消 = 这一份作废、卡片移除；原行程一个字段都没动过 */
  const dropPreview = useCallback((turnIndex: number) => {
    setTurns((prev) => {
      const next = prev.map((t, i) => {
        if (i !== turnIndex) return t;
        const revision = t.revision ? cancelPreview(t.revision) : undefined;
        return { ...t, preview: undefined, revision };
      });
      turnsRef.current = next;
      return next;
    });
  }, []);

  /**
   * 旧卡片，同时兼任 A2UI 的降级视图。
   *
   * 放在组件内是因为它要用到 applyRevise / dropPreview / onOpenItinerary 这几个
   * 已经带好防重与过期判断的入口 —— 降级路径必须与 A2UI 路径共用同一套入口，
   * 否则「渲染失败」会变成绕开防重的后门（spec FR-4）。
   */
  const legacyCard = (t: Turn, index: number) => {
    if (!t.preview) return null;
    const status = statusOf(t);
    return (
      <view>
        <text className={cls('bubble-title')}>{t.preview.reason}</text>
        {t.preview.affected.map((a) => (
          <text key={`${a.kind}-${a.title}`} className={cls('plan-day')}>
            {a.title}：{a.detail}
          </text>
        ))}
        <text className={cls('plan-day')}>
          时间{fmtDelta(t.preview.impact.minutes, ' 分钟')} · 人均{fmtMoney(t.preview.impact.cost)}
        </text>
        {t.preview.impact.recheck.length ? (
          <text className={cls('plan-day')}>要重新确认：{t.preview.impact.recheck.join('；')}</text>
        ) : null}
        {t.preview.by === 'engine' ? (
          <text className={cls('plan-day')}>这次没连上模型，是按关键词识别的改动</text>
        ) : null}
        {status === 'applied' ? (
          <view>
            <text className={cls('plan-day')}>已写进行程</text>
            <view className={cls('bubble-action')} bindtap={onOpenItinerary}>
              <text className={cls('bubble-action-text')}>去行程页核对</text>
            </view>
          </view>
        ) : status === 'stale' ? (
          <text className={cls('plan-day')}>行程已变化，请让咕噜重新提一次</text>
        ) : (
          <view>
            <view className={cls('bubble-action')} bindtap={() => applyRevise(index)}>
              <text className={cls('bubble-action-text')}>确认应用</text>
            </view>
            <view className={cls('bubble-action')} bindtap={() => dropPreview(index)}>
              <text className={cls('bubble-action-text')}>先不改</text>
            </view>
          </view>
        )}
      </view>
    );
  };

  return (
    <view className={cls('screen-inner')}>
      <scroll-view className={cls('scroll')} scroll-y bounces={false}>
        <view className={cls('page')}>
          <view className={cls('page-head')}>
            <view className={cls('icon-btn')} bindtap={onBack}>
              <IconSvg content={svgIcon('chevronLeft', '#2A3A57')} style={{ width: '18px', height: '18px' }} />
            </view>
            <text className={cls('page-sub-head')}>咕噜</text>
            <view className={cls('head-link')} bindtap={onBack}>
              <text className={cls('head-link-text')}>收起</text>
              <IconSvg content={svgIcon('chevronRight', '#2478F2')} style={{ width: '13px', height: '13px', marginLeft: '2px' }} />
            </view>
          </view>

          {turns.length === 0 ? (
            <view className={cls('card')}>
              <text className={cls('card-note')}>{MOCK.assistant.greeting}</text>
              {plan ? (
                <text className={cls('card-note')}>
                  现在看的是{demand.destination} · {demand.dayCount} 天这份行程，直接说想怎么改就行
                </text>
              ) : null}
              {MOCK.assistant.abilities.map((a) => (
                <view key={a} className={cls('ability-row')}>
                  <view className={cls('ability-dot')} />
                  <text className={cls('ability-text')}>{a}</text>
                </view>
              ))}
            </view>
          ) : null}

          {turns.map((t, i) =>
            t.role === 'user' ? (
              <view key={`u${i}`} className={cls('chat-row chat-right')}>
                <view className={cls('bubble bubble-user')}>
                  <text className={cls('bubble-text bubble-text-user')}>{t.text}</text>
                </view>
              </view>
            ) : (
              <view key={`a${i}`} className={cls('chat-row')}>
                <image
                  src={mascotAi}
                  mode="aspectFit"
                  style={{ width: '32px', height: '38px', marginRight: '8px' }}
                />
                <view className={cls('bubble bubble-ai')}>
                  {/* 只有方案才给标题，普通回复直接出正文，避免每条都挂一个重复的「咕噜」 */}
                  {t.plans?.length ? <text className={cls('bubble-title')}>为你排好了 {t.plans.length} 套方案</text> : null}
                  {t.text ? <text className={cls('bubble-text')}>{t.text}</text> : null}

                  {t.plans?.map((p, pi) => (
                    <view
                      key={p.id}
                      className={(t.picked ?? 0) === pi ? cls('plan-box plan-box-on') : cls('plan-box')}
                      bindtap={() => pickPlan(i, pi)}
                    >
                      <text className={cls('plan-name')}>
                        {(t.picked ?? 0) === pi ? '✓ ' : ''}
                        {p.paceLabel} · {p.days.length} 天
                      </text>
                      {p.days.map((d) => (
                        <text key={d.index} className={cls('plan-day')}>
                          第 {d.index} 天：
                          {d.items
                            .filter((item) => item.kind === 'place')
                            .map((item) => item.title)
                            .join(' · ')}
                        </text>
                      ))}
                      {/* 对话里提到的地点要能看出信不信得过。原来只给名字和人均，
                          用户没法判断「这家几点关门」是官方核验过的还是随口一猜。
                          这里只标未核验的数量，不逐条堆来源——来源在景点页可查 */}
                      <text className={cls('plan-caveat')}>{trustSummary(p)}</text>
                      {/* 预算来自引擎，模型不参与计算。未核实项必须整段列出：
                          原来只取 uncertain[0]，而住宿假设排在未核实票价前面，
                          于是「有 N 个景点票价未核实」永远看不见，用户看到的
                          总额像完整的、实际少算了几个景点 */}
                      <text className={cls('plan-day')}>人均约 ¥{p.budget.perPerson}</text>
                      {p.budget.uncertain.map((u) => (
                        <text key={u} className={cls('plan-caveat')}>
                          {u}
                        </text>
                      ))}
                    </view>
                  ))}
                  {t.plans?.length ? (
                    <view className={cls('bubble-action')} bindtap={() => applyPlans(i)}>
                      <text className={cls('bubble-action-text')}>用这套方案，去行程页</text>
                    </view>
                  ) : null}

                  {t.preview && t.revision ? (
                    statusOf(t) === 'pending' ? (
                      // A2UI 版卡片。fallback 就是下面那段旧卡片，任何环节不认都会回落
                      <RevisionSurface
                        preview={t.preview}
                        previewId={t.revision.previewId}
                        onAction={(action) => {
                          if (action.kind === 'confirm') applyRevise(i);
                          else dropPreview(i);
                        }}
                        fallback={() => legacyCard(t, i)}
                      />
                    ) : (
                      legacyCard(t, i)
                    )
                  ) : null}
                </view>
              </view>
            )
          )}

          {hint ? <text className={cls('mock-note')}>{hint}</text> : null}

          {enabled === false ? (
            <text className={cls('mock-note')}>AI 服务未配置，暂时无法对话（服务端缺 AI_API_KEY）</text>
          ) : null}
        </view>
      </scroll-view>

      <view className={cls('chat-input')}>
        <view className={cls('chat-input-box')}>
          {/* Lynx 的 input 没有受控 value，只能 default-value + 发完换 key 重挂载来清空。
              不改用 value 是运行时不支持，不是没试过 */}
          <input
            key={inputKey}
            className={cls('chat-input-field')}
            placeholder={listening ? '聆听中… 说完再点一下麦克风' : '告诉我你想去哪儿、玩几天'}
            placeholder-class={cls('chat-placeholder')}
            bindinput={onInput}
          />
        </view>
        <view className={listening ? cls('chat-mic chat-mic-on') : cls('chat-mic')} bindtap={toggleListening}>
          <IconSvg content={micSvg(listening ? '#FFFFFF' : '#2478F2')} style={{ width: '17px', height: '17px' }} />
        </view>
        <view className={sending ? cls('chat-send chat-send-busy') : cls('chat-send')} bindtap={send}>
          <IconSvg content={svgIcon('route', '#FFFFFF')} style={{ width: '16px', height: '16px' }} />
        </view>
      </view>
    </view>
  );
}

/** 这一轮预览当前处于什么状态；没有预览就没有卡片 */
function statusOf(t: Turn): PreviewStatus | null {
  return t.preview ? (t.revision?.status ?? 'pending') : null;
}


function fmtDelta(n: number, unit: string): string {
  if (n === 0) return '没变';
  return `${n > 0 ? '+' : ''}${n}${unit}`;
}

function fmtMoney(n: number): string {
  if (n === 0) return '没变';
  return `${n > 0 ? '+' : ''}¥${n}`;
}

/**
 * 方案里的地点有多少条记过核验。
 *
 * 气泡原来只给地点名和人均，用户没法判断「这家几点关门」是官方核验过的
 * 还是随口一猜。这里给一句能判断真假的话，逐条来源在景点页/行程页可查。
 */
function trustSummary(plan: Plan): string {
  const places = plan.days.flatMap((d) => d.items).filter((i) => i.kind === 'place' && i.placeId)
  if (places.length === 0) return ''
  const unverified = places.filter((i) => !placeById(i.placeId!)?.verifiedAt).length
  if (unverified === 0) return '以上地点的营业时间都记有核验时间'
  return `以上地点有 ${unverified} 个未记录核验时间，营业与票价请出发前确认`
}
