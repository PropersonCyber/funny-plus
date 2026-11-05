import { useCallback, useEffect, useRef, useState } from '@lynx-js/react';

import { BUDGET_LABEL, planFor } from '../../data.js';
import { warmTravelMinutes } from '../../travel.js';
import { track } from '../../track.js';
import { svgIcon } from '../../icons.js';
import { PickerSheet } from '../PickerSheet/index.js';
import { PlanLoading } from '../PlanLoading/index.js';
import type { PickerOption } from '../PickerSheet/index.js';
import mascotStart from '../../assets/ip/mascot-start.png';
import type { Demand, Plan } from '../../data.js';
import styles from './index.module.scss';
import { makeCls } from '../../styles/cls.js';

const cls = makeCls(styles);

type Props = {
  demand: Demand;
  /** 可选目的地：只给已接入地点池的城市 */
  cities: string[];
  onClose: () => void;
  onPlanned: (demand: Demand, plans: Plan[]) => void;
};

const BUDGETS: Demand['budgetLevel'][] = ['low', 'mid', 'high', 'flexible'];

// 单选维度的选择器配置集中在这里：以后加城市/加预算档只改数据，不动布局
type PickerKey = 'destination' | 'dayCount' | 'budgetLevel' | 'transport';
const PICKER_TITLE: Record<PickerKey, string> = {
  destination: '目的地',
  dayCount: '玩几天',
  budgetLevel: '人均预算',
  transport: '交通方式',
};
// 只放引擎真能映射到地点 tags 的偏好（planner PREF_TAGS），映射不上的选了也是白选
const PREFERENCES = ['美食探店', '经典打卡', '拍照出片', '亲子慢游', '夜景江湖'];
// compare = 同一套需求出公交/包车/自驾三套，这是方案对比唯一入口
const TRANSPORTS: { value: Demand['transport']; label: string }[] = [
  { value: 'public', label: '公共交通' },
  { value: 'car', label: '自驾' },
  { value: 'charter', label: '包车' },
  { value: 'compare', label: '三种对比' },
];

const PICKER_OPTIONS: Record<PickerKey, PickerOption[]> = {
  destination: [],
  dayCount: [1, 2].map((d) => ({ value: String(d), label: `${d} 天` })),
  budgetLevel: BUDGETS.map((b) => ({ value: b, label: BUDGET_LABEL[b] })),
  transport: TRANSPORTS.map((t) => ({
    value: t.value,
    label: t.label,
    ...(t.value === 'compare' ? { note: '同一需求出公交 / 自驾 / 包车三套' } : {}),
  })),
};

/** 底部弹窗：每行一个决策项，行内左图标右控件；只放引擎真吃得下的四维 */
export function PlanSheet({ demand, cities, onClose, onPlanned }: Props) {
  const [draft, setDraft] = useState<Demand>(demand);
  const [error, setError] = useState('');
  // 单选维度走底部选择器：选项加多少都不会把弹窗撑高
  const [picker, setPicker] = useState<PickerKey | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 弹窗被上层关掉时别让计时器继续把结果写进存档
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

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

  // 选择器回填：天数要转回 number，枚举维度按原类型追加
  const onPickValue = useCallback(
    (v: string) => {
      if (picker === 'dayCount') patch({ dayCount: Number(v) });
      else if (picker === 'budgetLevel') patch({ budgetLevel: v as Demand['budgetLevel'] });
      else if (picker === 'transport') patch({ transport: v as Demand['transport'] });
      else if (picker === 'destination') patch({ destination: v });
    },
    [picker, patch],
  );

  const pickerValue =
    picker === 'dayCount'
      ? String(draft.dayCount)
      : picker === 'budgetLevel'
        ? draft.budgetLevel
        : picker === 'transport'
          ? draft.transport
          : draft.destination;
  const submit = useCallback(() => {
    const startedAt = Date.now();
    setError('');
    setSubmitting(true);
    // 先用直线估算跑一遍拿顺序：排序只依赖 distanceKm，第二遍重算顺序不会变
    let firstPass: Plan[] = [];
    try {
      firstPass = planFor(draft);
    } catch (e) {
      // 城市没接入 / 地点池没加载：这时候连顺序都没有，不用去取路线
      const msg = e instanceof Error ? e.message : '这次没生成出来，换个目的地或稍后重试';
      setSubmitting(false);
      setError(msg);
      track('plan_failed', { destination: draft.destination, reason: msg });
      return;
    }
    // 按第一遍的顺序取真实路段耗时（拿不到就退回直线估算，方案照样出）
    warmTravelMinutes(draft, firstPass)
      .catch(() => ({ asked: 0, hit: 0 }))
      .then(() => {
        try {
          // 路上时间换成真实值后重算：顺序不变，到达时刻变准
          const next = planFor(draft);
          track('plan_submitted', {
            destination: draft.destination,
            dayCount: draft.dayCount,
            party: draft.party,
            transport: draft.transport,
            plans: next.length,
          });
          // 取数快的时候也让过渡卡停一下，否则用户看不到「生成」发生过
          const wait = Math.max(0, 700 - (Date.now() - startedAt));
          timer.current = setTimeout(() => {
            setSubmitting(false);
            onPlanned(draft, next);
          }, wait);
        } catch (e) {
          const msg = e instanceof Error ? e.message : '这次没生成出来，换个目的地或稍后重试';
          setSubmitting(false);
          setError(msg);
          track('plan_failed', { destination: draft.destination, reason: msg });
        }
      });
  }, [draft, onPlanned]);

  const cancelSubmit = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setSubmitting(false);
  }, []);

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
              <image src={svgIcon('pin', '#F5A03C')} style={{ width: '16px', height: '16px' }} />
            </view>
            <text className={cls('ps-label')}>目的地</text>
            <view className={cls('ps-select')} bindtap={() => setPicker('destination')}>
              <text className={cls('ps-select-text')}>{draft.destination}</text>
              <image src={svgIcon('chevronRight', '#8A99B3')} style={{ width: '14px', height: '14px' }} />
            </view>
          </view>

          <view className={cls('ps-row')}>
            <view className={cls('ps-icon ps-icon-blue')}>
              <image src={svgIcon('itinerary', '#2478F2')} style={{ width: '16px', height: '16px' }} />
            </view>
            <text className={cls('ps-label')}>天数</text>
            <view className={cls('ps-select')} bindtap={() => setPicker('dayCount')}>
              <text className={cls('ps-select-text')}>{draft.dayCount} 天</text>
              <image src={svgIcon('chevronRight', '#8A99B3')} style={{ width: '14px', height: '14px' }} />
            </view>
          </view>

          <view className={cls('ps-row')}>
            <view className={cls('ps-icon ps-icon-green')}>
              <image src={svgIcon('profile', '#35C08A')} style={{ width: '16px', height: '16px' }} />
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
              <image src={svgIcon('budget', '#8B7CFF')} style={{ width: '16px', height: '16px' }} />
            </view>
            <text className={cls('ps-label')}>人均预算</text>
            <view className={cls('ps-select')} bindtap={() => setPicker('budgetLevel')}>
              <text className={cls('ps-select-text')}>{BUDGET_LABEL[draft.budgetLevel]}</text>
              <image src={svgIcon('chevronRight', '#8A99B3')} style={{ width: '14px', height: '14px' }} />
            </view>
          </view>

          <view className={cls('ps-row')}>
            <view className={cls('ps-icon ps-icon-orange')}>
              <image src={svgIcon('sparkles', '#F5A03C')} style={{ width: '16px', height: '16px' }} />
            </view>
            <text className={cls('ps-label')}>偏好</text>
            {/* 多选用滚轮不直观，保留 chip 但只占一行：横滑，不换行撑高弹窗 */}
            <scroll-view className={cls('ps-pref-scroll')} scroll-x>
              <view className={cls('ps-pref-row')}>
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
            </scroll-view>
          </view>

          <view className={cls('ps-row')}>
            <view className={cls('ps-icon ps-icon-blue')}>
              <image src={svgIcon('transport', '#2478F2')} style={{ width: '16px', height: '16px' }} />
            </view>
            <text className={cls('ps-label')}>交通方式</text>
            <view className={cls('ps-select')} bindtap={() => setPicker('transport')}>
              <text className={cls('ps-select-text')}>{TRANSPORTS.find((t) => t.value === draft.transport)?.label ?? '公共交通'}</text>
              <image src={svgIcon('chevronRight', '#8A99B3')} style={{ width: '14px', height: '14px' }} />
            </view>
          </view>

          <view className={cls('ps-row ps-row-last ps-row-notes')}>
            <view className={cls('ps-icon ps-icon-green')}>
              <image src={svgIcon('more', '#35C08A')} style={{ width: '16px', height: '16px' }} />
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

        {picker ? (
          <PickerSheet
            title={PICKER_TITLE[picker]}
            options={
              picker === 'destination'
                ? cities.map((c) => ({ value: c, label: c }))
                : PICKER_OPTIONS[picker]
            }
            value={pickerValue}
            onClose={() => setPicker(null)}
            onPick={onPickValue}
          />
        ) : null}
      </view>

      {/* 挂在遮罩层上而不是 sheet 里：卡片要按整屏居中，不能被弹窗高度裁掉 */}
      {submitting ? <PlanLoading onCancel={cancelSubmit} /> : null}
    </view>
  );
}
