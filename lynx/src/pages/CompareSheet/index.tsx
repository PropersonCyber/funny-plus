import { useCallback } from '@lynx-js/react';

import { planStatus } from '../../../../shared/engine/validate.js';
import type { Plan } from '../../data.js';
import styles from './index.module.scss';
import { makeCls } from '../../styles/cls.js';

const cls = makeCls(styles);

type Props = {
  plans: Plan[];
  party: number;
  onClose: () => void;
  onPick: (index: number) => void;
};

const STATUS_TEXT: Record<string, string> = {
  conflict: '有冲突',
  warn: '需注意',
  unverified: '待确认',
  ok: '无待确认项',
};

/** 方案并排对比：PRD 要求「主要差异、费用、风险」三项放在一起看，不做综合评分 */
export function CompareSheet({ plans, party, onClose, onPick }: Props) {
  const totalMinutes = useCallback(
    (p: Plan) => p.days.reduce((s, d) => s + d.items.reduce((x, i) => x + i.stayMin + i.transportMin, 0), 0),
    [],
  );

  return (
    <view className={cls('sheet-mask')} bindtap={onClose}>
      <view className={cls('sheet')} catchtap={() => {}}>
        <view className={cls('cp-head')}>
          <view className={cls('cp-head-text')}>
            <text className={cls('sheet-title')}>方案对比</text>
            <text className={cls('cp-sub')}>{party} 人 · 钱和时间并列看，不合成综合分</text>
          </view>
          <view className={cls('sheet-close')} catchtap={onClose}>
            <text className={cls('sheet-close-text')}>✕</text>
          </view>
        </view>

        <view className={cls('cp-row cp-row-first')}>
          <text className={cls('cp-label')} />
          {plans.map((p) => (
            <text key={p.id} className={cls('cp-col-head')}>{p.paceLabel}</text>
          ))}
        </view>

        <view className={cls('cp-row')}>
          <text className={cls('cp-label')}>合计</text>
          {plans.map((p) => (
            <text key={p.id} className={cls('cp-value')}>¥{p.budget.total}</text>
          ))}
        </view>

        <view className={cls('cp-row')}>
          <text className={cls('cp-label')}>人均</text>
          {plans.map((p) => (
            <text key={p.id} className={cls('cp-value cp-value-strong')}>¥{p.budget.perPerson}</text>
          ))}
        </view>

        <view className={cls('cp-row')}>
          <text className={cls('cp-label')}>总时长</text>
          {plans.map((p) => (
            <text key={p.id} className={cls('cp-value')}>{hours(totalMinutes(p))}</text>
          ))}
        </view>

        <view className={cls('cp-row')}>
          <text className={cls('cp-label')}>风险</text>
          {plans.map((p) => {
            const s = planStatus(p.issues);
            return (
              <text key={p.id} className={cls(`cp-value ${s === 'conflict' ? 'cp-value-error' : ''}`)}>
                {STATUS_TEXT[s] ?? s}
              </text>
            );
          })}
        </view>

        <view className={cls('cp-row cp-row-last')}>
          <text className={cls('cp-label')}>适合</text>
          {plans.map((p) => (
            <text key={p.id} className={cls('cp-note')}>{p.suitableFor}</text>
          ))}
        </view>

        <view className={cls('cp-actions')}>
          {plans.map((p, i) => (
            <view key={p.id} className={cls('cp-btn')} bindtap={() => onPick(i)}>
              <text className={cls('cp-btn-text')}>用 {p.paceLabel}</text>
            </view>
          ))}
        </view>
      </view>
    </view>
  );
}

function hours(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h} 小时${m > 0 ? ` ${m} 分` : ''}`;
}
