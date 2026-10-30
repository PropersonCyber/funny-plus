import { useCallback, useState } from '@lynx-js/react';

import { BUDGET_LABEL, planFor } from '../data.js';
import type { Demand, Plan } from '../data.js';

type Props = {
  demand: Demand;
  onClose: () => void;
  onPlanned: (demand: Demand, plans: Plan[]) => void;
};

const CITIES = ['成都', '重庆'];
const BUDGETS: Demand['budgetLevel'][] = ['low', 'mid', 'high', 'flexible'];

/** 底部 Sheet：只放引擎真正吃得下的四个维度，其它（偏好/备注）等接了模型再加 */
export function PlanSheet({ demand, onClose, onPlanned }: Props) {
  const [draft, setDraft] = useState<Demand>(demand);

  const patch = useCallback((next: Partial<Demand>) => {
    setDraft((prev) => ({ ...prev, ...next }));
  }, []);

  const submit = useCallback(() => {
    'background only';
    onPlanned(draft, planFor(draft));
  }, [draft, onPlanned]);

  return (
    <view className="sheet-mask" bindtap={onClose}>
      <view className="sheet" catchtap={() => {}}>
        <view className="sheet-grabber" />
        <text className="sheet-title">规划一次旅行</text>

        <text className="field-label">目的地</text>
        <view className="chips">
          {CITIES.map((c) => (
            <view
              key={c}
              className={draft.destination === c ? 'chip chip-on' : 'chip'}
              bindtap={() => patch({ destination: c })}
            >
              <text className={draft.destination === c ? 'chip-text chip-text-on' : 'chip-text'}>{c}</text>
            </view>
          ))}
        </view>

        <text className="field-label">天数</text>
        <view className="chips">
          {[1, 2].map((d) => (
            <view
              key={d}
              className={draft.dayCount === d ? 'chip chip-on' : 'chip'}
              bindtap={() => patch({ dayCount: d })}
            >
              <text className={draft.dayCount === d ? 'chip-text chip-text-on' : 'chip-text'}>
                {d} 天
              </text>
            </view>
          ))}
        </view>

        <text className="field-label">人数</text>
        <view className="stepper">
          <view className="stepper-btn" bindtap={() => patch({ party: Math.max(1, draft.party - 1) })}>
            <text className="stepper-btn-text">–</text>
          </view>
          <text className="stepper-value">{draft.party}</text>
          <view
            className="stepper-btn stepper-btn-on"
            bindtap={() => patch({ party: Math.min(8, draft.party + 1) })}
          >
            <text className="stepper-btn-text stepper-btn-text-on">+</text>
          </view>
        </view>

        <text className="field-label">人均预算</text>
        <view className="chips">
          {BUDGETS.map((b) => (
            <view
              key={b}
              className={draft.budgetLevel === b ? 'chip chip-on' : 'chip'}
              bindtap={() => patch({ budgetLevel: b })}
            >
              <text className={draft.budgetLevel === b ? 'chip-text chip-text-on' : 'chip-text'}>
                {BUDGET_LABEL[b]}
              </text>
            </view>
          ))}
        </view>

        <view className="sheet-actions">
          <view className="btn-ghost" bindtap={onClose}>
            <text className="btn-ghost-text">取消</text>
          </view>
          <view className="btn-primary btn-primary-grow" bindtap={submit}>
            <text className="btn-primary-text">生成方案</text>
          </view>
        </view>
      </view>
    </view>
  );
}
