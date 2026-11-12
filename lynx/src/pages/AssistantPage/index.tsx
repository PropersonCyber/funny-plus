import { useCallback, useEffect, useRef, useState } from '@lynx-js/react';

import mascotAi from '../../assets/ip/mascot-ai.png';
import { MOCK } from '../../mock.js';
import { chat, aiStatus } from '../../aiChat.js';
import type { ChatMessage, ChatPlan, ChatSlots } from '../../aiChat.js';
import { svgDataUri } from '../../icon-svg.js';
import { svgIcon } from '../../icons.js';
import styles from './index.module.scss';
import { makeCls } from '../../styles/cls.js';

const cls = makeCls(styles);

type Props = {
  onBack: () => void;
  onApply: () => void;
};

/** 麦克风图表不在 docs/materials/icons 里，只有这一个页面用，就地内联 */
const MIC_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2.6" width="6" height="11" rx="3"/><path d="M5.2 11a6.8 6.8 0 0 0 13.6 0M12 17.8V21"/></svg>`;

const micSvg = (color: string) => svgDataUri(MIC_SVG.split('currentColor').join(color));

/** 工具名 → 等待文案。模型调工具时会有几秒没有文本输出，不给反馈就像卡死 */
const TOOL_HINT: Record<string, string> = {
  updateDemand: '咕噜正在理解你的需求…',
  queryPlaces: '咕噜正在查景点…',
  generatePlans: '咕噜正在排行程…',
};

type Turn = { role: 'user' | 'assistant'; text: string; plans?: ChatPlan[] };

/**
 * AI 助手（设计稿第 7 屏）。
 *
 * 对话历史与槽位都由本组件持有、每轮随请求发给服务端：
 * 目前没有账号体系，服务端存了也分不清是谁的，存了反而制造一份无主的隐私数据。
 * 接上登录后再迁到服务端，接口形状不用变。
 */
export function AssistantPage({ onBack, onApply }: Props) {
  // 只切视觉态：录音没有接，别让按钮看起来像真的在收音
  const [listening, setListening] = useState(false);
  const toggleListening = useCallback(() => setListening((v) => !v), []);

  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [hint, setHint] = useState('');

  // 槽位与历史用 ref：流式回调里要读到最新值，state 的快照会读到旧的
  const slotsRef = useRef<ChatSlots>({});
  const turnsRef = useRef<Turn[]>([]);

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
      const res = await chat(history, slotsRef.current, {
        onDelta: appendDelta,
        onTool: (name) => setHint(TOOL_HINT[name] ?? ''),
        onPlans: (plans) => {
          setTurns((prev) => {
            const last = prev[prev.length - 1];
            const next =
              last && last.role === 'assistant'
                ? [...prev.slice(0, -1), { ...last, plans }]
                : [...prev, { role: 'assistant' as const, text: '', plans }];
            // ref 必须在函数式更新里同步：下一轮 history 从这里取，
            // 而 setTurns 是异步的，在外部赋值会拿到旧数组
            turnsRef.current = next;
            return next;
          });
        },
      });
      slotsRef.current = res.slots;
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
  }, [draft, sending, appendDelta]);

  const onInput = useCallback((e: { detail: { value: string } }) => setDraft(e.detail.value), []);

  return (
    <view className={cls('screen-inner')}>
      <scroll-view className={cls('scroll')} scroll-y bounces={false}>
        <view className={cls('page')}>
          <view className={cls('page-head')}>
            <view className={cls('icon-btn')} bindtap={onBack}>
              <image src={svgIcon('chevronLeft', '#2A3A57')} style={{ width: '18px', height: '18px' }} />
            </view>
            <text className={cls('page-sub-head')}>咕噜</text>
            <view className={cls('head-link')} bindtap={onBack}>
              <text className={cls('head-link-text')}>收起</text>
              <image src={svgIcon('chevronRight', '#2478F2')} style={{ width: '13px', height: '13px', marginLeft: '2px' }} />
            </view>
          </view>

          {turns.length === 0 ? (
            <view className={cls('card')}>
              <text className={cls('card-note')}>{MOCK.assistant.greeting}</text>
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
                  {t.plans?.map((p) => (
                    <view key={p.id} className={cls('plan-box')}>
                      <text className={cls('plan-name')}>
                        {p.paceLabel} · {p.transport}
                      </text>
                      {p.days.map((d) => (
                        <text key={d.index} className={cls('plan-day')}>
                          第 {d.index} 天：{d.items.join(' · ')}
                        </text>
                      ))}
                    </view>
                  ))}
                  {t.plans?.length ? (
                    <view className={cls('bubble-action')} bindtap={onApply}>
                      <text className={cls('bubble-action-text')}>查看完整行程与预算</text>
                    </view>
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
        <view
          className={listening ? cls('chat-mic chat-mic-on') : cls('chat-mic')}
          bindtap={toggleListening}
        >
          <image src={micSvg(listening ? '#FFFFFF' : '#2478F2')} style={{ width: '17px', height: '17px' }} />
        </view>
        <view className={sending ? cls('chat-send chat-send-busy') : cls('chat-send')} bindtap={send}>
          <image src={svgIcon('route', '#FFFFFF')} style={{ width: '16px', height: '16px' }} />
        </view>
      </view>
    </view>
  );
}
