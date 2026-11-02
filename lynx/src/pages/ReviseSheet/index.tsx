import { useCallback, useState } from '@lynx-js/react';

import { revisePlan } from '../../data.js';
import { svgIcon } from '../../icons.js';
import { track } from '../../track.js';
import type { ChangeImpact, Demand, Plan } from '../../data.js';
import styles from './index.module.scss';
import { makeCls } from '../../styles/cls.js';

const cls = makeCls(styles);

type Props = {
  plan: Plan;
  demand: Demand;
  /** 当前正在看的天：指令里没写天数时改这一天 */
  dayIndex: number;
  onClose: () => void;
  onApplied: (plan: Plan, impact: ChangeImpact) => void;
};

/** 引擎认得的说法只有这三类，快捷入口直接给原文，省得用户猜 */
const QUICK = ['轻松一点', '省点钱', '换个景点'];

/** 单日局部修改：只动这一天，改完给变更影响，不改整份行程 */
export function ReviseSheet({ plan, demand, dayIndex, onClose, onApplied }: Props) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  const apply = useCallback(
    (instruction: string) => {
      const said = instruction.trim();
      if (!said) return;
      const result = revisePlan(plan, demand, said, dayIndex);
      if ('reason' in result) {
        setError(result.reason);
        track('revise_unsupported', { day: dayIndex, instruction: said.slice(0, 20) });
        return;
      }
      setError('');
      track('revise_applied', {
        day: dayIndex,
        minutes: result.impact.minutes,
        cost: result.impact.cost,
        recheck: result.impact.recheck.length,
      });
      onApplied(result.plan, result.impact);
    },
    [plan, demand, dayIndex, onApplied]
  );

  return (
    <view className={cls('sheet-mask')} bindtap={onClose}>
      <view className={cls('sheet')} catchtap={() => {}}>
        <view className={cls('sheet-grabber')} />

        <view className={cls('rs-head')}>
          <svg content={svgIcon('sparkles', '#2478F2')} style={{ width: '20px', height: '20px', marginRight: '8px' }} />
          <view className={cls('rs-head-text')}>
            <text className={cls('sheet-title')}>调整第 {dayIndex} 天</text>
            <text className={cls('rs-sub')}>只改这一天，其它天不动</text>
          </view>
          <view className={cls('sheet-close')} catchtap={onClose}>
            <text className={cls('sheet-close-text')}>✕</text>
          </view>
        </view>

        <view className={cls('rs-quick')}>
          {QUICK.map((q) => (
            <view key={q} className={cls('rs-chip')} bindtap={() => apply(q)}>
              <text className={cls('rs-chip-text')}>{q}</text>
            </view>
          ))}
        </view>

        <view className={cls('rs-input-row')}>
          <input
            className={cls('rs-input')}
            placeholder="或者直接说：第二天轻松一点"
            placeholder-class={cls('rs-input-ph')}
            bindinput={(e: { detail: { value: string } }) => setText(e.detail.value)}
          />
        </view>

        {error ? <text className={cls('rs-error')}>{error}</text> : null}

        <view className={cls('rs-cta')} bindtap={() => apply(text)}>
          <text className={cls('rs-cta-text')}>应用修改</text>
        </view>
      </view>
    </view>
  );
}
