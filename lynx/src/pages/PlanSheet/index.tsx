import { useCallback, useState } from '@lynx-js/react';

import { BUDGET_LABEL, CITIES, planFor } from '../../data.js';
import { track } from '../../track.js';
import { svgIcon } from '../../icons.js';
import mascotStart from '../../assets/ip/mascot-start.png';
import type { Demand, Plan } from '../../data.js';
import styles from './index.module.scss';
import { makeCls } from '../../styles/cls.js';

const cls = makeCls(styles);

type Props = {
  demand: Demand;
  onClose: () => void;
  onPlanned: (demand: Demand, plans: Plan[]) => void;
};

const BUDGETS: Demand['budgetLevel'][] = ['low', 'mid', 'high', 'flexible'];
// 只放引擎真能映射到地点 tags 的偏好（planner PREF_TAGS），映射不上的选了也是白选
const PREFERENCES = ['美食探店', '经典打卡', '拍照出片', '亲子慢游', '夜景江湖'];
// compare = 同一套需求出公交/包车/自驾三套，这是方案对比唯一入口
const TRANSPORTS: { value: Demand['transport']; label: string }[] = [
  { value: 'public', label: '公共交通' },
  { value: 'car', label: '自驾' },
  { value: 'charter', label: '包车' },
  { value: 'compare', label: '三种对比' },
];

/** 底部弹窗：每行一个决策项，行内左图标右控件；只放引擎真吃得下的四维 */
export function PlanSheet({ demand, onClose, onPlanned }: Props) {
  const [draft, setDraft] = useState<Demand>(demand);
  const [error, setError] = useState('');

  const patch = useCallback((next: Partial<Demand>) => {
    setDraft((prev) => ({ ...prev, ...next }));
  }, []);

  const togglePref = useCallback((p: string) => {
    setDraft((prev) => ({
      ...prev,
      preferences: prev.preferences.includes(p)
        ? prev.preferences.filter((x) => x !== p)
        : [...prev.preferences, p],
    }));
  }, []);

  const submit = useCallback(() => {
    'background only';
    try {
      const next = planFor(draft);
      setError('');
      track('plan_submitted', {
        destination: draft.destination,
        dayCount: draft.dayCount,
        party: draft.party,
        transport: draft.transport,
        plans: next.length,
      });
      onPlanned(draft, next);
    } catch (e) {
      // 引擎抛的是「城市没接入 / 地点池没加载」，别让弹窗直接崩掉
      const msg = e instanceof Error ? e.message : '这次没生成出来，换个目的地或稍后重试';
      setError(msg);
      track('plan_failed', { destination: draft.destination, reason: msg });
    }
  }, [draft, onPlanned]);

  return (
    <view className={cls('sheet-mask')} bindtap={onClose}>
      <view className={cls('sheet')} catchtap={() => {}}>
        <view className={cls('sheet-grabber')} />

        <view className={cls('ps-head')}>
          <image src={mascotStart} mode="aspectFit" style={{ width: '52px', height: '52px' }} />
          <view className={cls('ps-head-text')}>
            <text className={cls('sheet-title')}>规划一次旅行</text>
            <text className={cls('ps-sub')}>选好这四项，立刻生成三套方案</text>
          </view>
          <view className={cls('sheet-close')} catchtap={onClose}>
            <text className={cls('sheet-close-text')}>✕</text>
          </view>
        </view>

        <view className={cls('ps-card')}>
          <view className={cls('ps-row')}>
            <view className={cls('ps-icon ps-icon-orange')}>
              <svg content={svgIcon('pin', '#F5A03C')} style={{ width: '16px', height: '16px' }} />
            </view>
            <text className={cls('ps-label')}>目的地</text>
            <view className={cls('ps-chips')}>
              {CITIES.map((c) => (
                <view
                  key={c}
                  className={cls(draft.destination === c ? 'ps-chip ps-chip-on' : 'ps-chip')}
                  bindtap={() => patch({ destination: c })}
                >
                  <text className={cls(draft.destination === c ? 'ps-chip-text on' : 'ps-chip-text')}>{c}</text>
                </view>
              ))}
            </view>
          </view>

          <view className={cls('ps-row')}>
            <view className={cls('ps-icon ps-icon-blue')}>
              <svg content={svgIcon('itinerary', '#2478F2')} style={{ width: '16px', height: '16px' }} />
            </view>
            <text className={cls('ps-label')}>天数</text>
            <view className={cls('ps-chips')}>
              {[1, 2].map((d) => (
                <view
                  key={d}
                  className={cls(draft.dayCount === d ? 'ps-chip ps-chip-on' : 'ps-chip')}
                  bindtap={() => patch({ dayCount: d })}
                >
                  <text className={cls(draft.dayCount === d ? 'ps-chip-text on' : 'ps-chip-text')}>{d} 天</text>
                </view>
              ))}
            </view>
          </view>

          <view className={cls('ps-row')}>
            <view className={cls('ps-icon ps-icon-green')}>
              <svg content={svgIcon('profile', '#35C08A')} style={{ width: '16px', height: '16px' }} />
            </view>
            <text className={cls('ps-label')}>人数</text>
            <view className={cls('ps-stepper')}>
              <view className={cls('ps-step-btn')} bindtap={() => patch({ party: Math.max(1, draft.party - 1) })}>
                <text className={cls('ps-step-text')}>–</text>
              </view>
              <text className={cls('ps-step-value')}>{draft.party}</text>
              <view className={cls('ps-step-btn ps-step-btn-on')} bindtap={() => patch({ party: Math.min(8, draft.party + 1) })}>
                <text className={cls('ps-step-text on')}>+</text>
              </view>
            </view>
          </view>

          <view className={cls('ps-row')}>
            <view className={cls('ps-icon ps-icon-violet')}>
              <svg content={svgIcon('budget', '#8B7CFF')} style={{ width: '16px', height: '16px' }} />
            </view>
            <text className={cls('ps-label')}>人均预算</text>
            <view className={cls('ps-chips ps-chips-wrap')}>
              {BUDGETS.map((b) => (
                <view
                  key={b}
                  className={cls(draft.budgetLevel === b ? 'ps-chip ps-chip-on' : 'ps-chip')}
                  bindtap={() => patch({ budgetLevel: b })}
                >
                  <text className={cls(draft.budgetLevel === b ? 'ps-chip-text on' : 'ps-chip-text')}>
                    {BUDGET_LABEL[b]}
                  </text>
                </view>
              ))}
            </view>
          </view>

          <view className={cls('ps-row')}>
            <view className={cls('ps-icon ps-icon-orange')}>
              <svg content={svgIcon('sparkles', '#F5A03C')} style={{ width: '16px', height: '16px' }} />
            </view>
            <text className={cls('ps-label')}>偏好</text>
            <view className={cls('ps-chips ps-chips-wrap')}>
              {PREFERENCES.map((p) => (
                <view
                  key={p}
                  className={cls(draft.preferences.includes(p) ? 'ps-chip ps-chip-on' : 'ps-chip')}
                  bindtap={() => togglePref(p)}
                >
                  <text className={cls(draft.preferences.includes(p) ? 'ps-chip-text on' : 'ps-chip-text')}>{p}</text>
                </view>
              ))}
            </view>
          </view>

          <view className={cls('ps-row')}>
            <view className={cls('ps-icon ps-icon-blue')}>
              <svg content={svgIcon('transport', '#2478F2')} style={{ width: '16px', height: '16px' }} />
            </view>
            <text className={cls('ps-label')}>交通方式</text>
            <view className={cls('ps-chips ps-chips-wrap')}>
              {TRANSPORTS.map((t) => (
                <view
                  key={t.value}
                  className={cls(draft.transport === t.value ? 'ps-chip ps-chip-on' : 'ps-chip')}
                  bindtap={() => patch({ transport: t.value })}
                >
                  <text className={cls(draft.transport === t.value ? 'ps-chip-text on' : 'ps-chip-text')}>{t.label}</text>
                </view>
              ))}
            </view>
          </view>

          <view className={cls('ps-row ps-row-last ps-row-notes')}>
            <view className={cls('ps-icon ps-icon-green')}>
              <svg content={svgIcon('more', '#35C08A')} style={{ width: '16px', height: '16px' }} />
            </view>
            <text className={cls('ps-label')}>补充要求</text>
            <view className={cls('ps-notes')}>
              <input
                className={cls('ps-input')}
                placeholder="例：带老人、想吃本地小吃"
                placeholder-class={cls('ps-input-ph')}
                default-value={draft.notes}
                bindinput={(e: { detail: { value: string } }) => patch({ notes: e.detail.value })}
              />
              <text className={cls('ps-notes-hint')}>本期只随行程存档，不参与排程</text>
            </view>
          </view>
        </view>

        {error ? <text className={cls('ps-error')}>{error}</text> : null}

        <view className={cls('ps-cta')} bindtap={submit}>
          <text className={cls('ps-cta-text')}>生成方案</text>
        </view>
      </view>
    </view>
  );
}
