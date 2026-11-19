import { IconSvg } from '../../IconSvg.js';
import { useCallback, useState } from '@lynx-js/react';

import { revisePlan } from '../../data.js';
import { revise } from '../../aiChat.js';
import { svgIcon } from '../../icons.js';
import { track } from '../../track.js';
import type { ChangeImpact, Demand, Plan } from '../../data.js';
import type { RevisePreview, TripContext } from '../../../../shared/types/index.js';
import styles from './index.module.scss';
import { makeCls } from '../../styles/cls.js';

const cls = makeCls(styles);

type Props = {
  plan: Plan;
  demand: Demand;
  /** 当前正在看的天：指令里没写天数时改这一天 */
  dayIndex: number;
  /** 所在行程；服务端要靠它把修改算在这份行程上 */
  tripId: string;
  onClose: () => void;
  onApplied: (plan: Plan, impact: ChangeImpact) => void;
};

/** 引擎认得的说法，快捷入口直接给原文，省得用户猜 */
const QUICK = ['轻松一点', '省点钱', '换个景点'];

/**
 * 单日局部修改：先说清要改什么，用户确认后才动行程。
 *
 * 分两步而不是「说一句就改」：改行程是有代价的动作（时间、费用、后续安排都要跟着变），
 * 直接生效等于把风险转给用户。所以这里是「生成预览 → 确认 / 取消」，取消时原方案一个字段都不改。
 *
 * 解析顺序是「服务端模型 → 本地关键词」：模型挂了不该等于行程改不动，
 * 但界面必须照实标出这次是哪条路给的结果。
 */
export function ReviseSheet({ plan, demand, dayIndex, tripId, onClose, onApplied }: Props) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<RevisePreview | null>(null);

  // 定义在 ask 之前：ask 在降级分支里调用它，useCallback 的引用要能拿到最新一份
  const fallback = useCallback(
    (said: string) => {
      const result = revisePlan(plan, demand, said, dayIndex);
      if ('reason' in result) {
        setError(result.reason);
        track('revise_unsupported', { day: dayIndex, instruction: said.slice(0, 20), by: 'engine' });
        return;
      }
      setPreview({
        plan: result.plan,
        impact: result.impact,
        affected: result.affected,
        reason: result.impact.note,
        by: 'engine',
      });
      track('revise_preview', { day: dayIndex, by: 'engine' });
    },
    [plan, demand, dayIndex]
  );

  const ask = useCallback(
    async (instruction: string) => {
      const said = instruction.trim();
      if (!said || pending) return;
      setError('');
      setPreview(null);
      setPending(true);
      const trip: TripContext = { tripId, demand, plan };
      try {
        const res = await revise(trip, said, dayIndex);
        if ('supported' in res && res.supported) {
          setPreview(res.preview);
          track('revise_preview', { day: dayIndex, by: res.preview.by });
          return;
        }
        if ('supported' in res) {
          setError(res.reason);
          track('revise_unsupported', { day: dayIndex, instruction: said.slice(0, 20), by: 'model' });
          return;
        }
        // degraded：服务端没给出判断（未配置 / 网络不通），落回本地关键词
        fallback(said);
      } catch {
        fallback(said);
      } finally {
        setPending(false);
      }
    },
    [dayIndex, pending, plan, demand, tripId, fallback]
  );

  const apply = useCallback(() => {
    if (!preview) return;
    track('revise_applied', {
      day: dayIndex,
      by: preview.by,
      minutes: preview.impact.minutes,
      cost: preview.impact.cost,
      recheck: preview.impact.recheck.length,
    });
    onApplied(preview.plan, preview.impact);
  }, [preview, dayIndex, onApplied]);

  const cancelPreview = useCallback(() => {
    track('revise_cancelled', { day: dayIndex, by: preview?.by ?? '' });
    // 取消 = 丢掉预览，原方案从未被改过，不需要任何回滚
    setPreview(null);
  }, [dayIndex, preview]);

  return (
    <view className={cls('sheet-mask')} bindtap={onClose}>
      <view className={cls('sheet')} catchtap={() => {}}>
        <view className={cls('sheet-grabber')} />

        <view className={cls('rs-head')}>
          <IconSvg content={svgIcon('sparkles', '#2478F2')} style={{ width: '20px', height: '20px', marginRight: '8px' }} />
          <view className={cls('rs-head-text')}>
            <text className={cls('sheet-title')}>调整第 {dayIndex} 天</text>
            <text className={cls('rs-sub')}>只改这一天，其它天不动</text>
          </view>
          <view className={cls('sheet-close')} catchtap={onClose}>
            <text className={cls('sheet-close-text')}>✕</text>
          </view>
        </view>

        {preview ? (
          <view>
            <text className={cls('rs-preview-title')}>{preview.reason}</text>

            {preview.affected.length > 0 ? (
              <view className={cls('rs-affected')}>
                {preview.affected.map((a) => (
                  <view key={`${a.kind}-${a.title}`} className={cls('rs-affected-row')}>
                    <text className={cls('rs-affected-title')}>{a.title}</text>
                    <text className={cls('rs-affected-detail')}>{a.detail}</text>
                  </view>
                ))}
              </view>
            ) : null}

            <view className={cls('rs-impact')}>
              <text className={cls('rs-impact-label')}>时间</text>
              <text className={cls('rs-impact-value')}>{fmtDelta(preview.impact.minutes, ' 分钟')}</text>
              <text className={cls('rs-impact-label rs-impact-gap')}>人均</text>
              <text className={cls('rs-impact-value')}>{fmtMoney(preview.impact.cost)}</text>
            </view>

            {preview.impact.recheck.length > 0 ? (
              <text className={cls('rs-error')}>要重新确认：{preview.impact.recheck.join('；')}</text>
            ) : null}

            {preview.by === 'engine' ? (
              <text className={cls('rs-note')}>这次没连上咕噜，是按关键词识别的改动，请确认无误</text>
            ) : null}

            <view className={cls('rs-actions')}>
              <view className={cls('rs-ghost')} bindtap={cancelPreview}>
                <text className={cls('rs-ghost-text')}>取消</text>
              </view>
              <view className={cls('rs-cta rs-cta-grow')} bindtap={apply}>
                <text className={cls('rs-cta-text')}>确认应用</text>
              </view>
            </view>
          </view>
        ) : (
          <view>
            <view className={cls('rs-quick')}>
              {QUICK.map((q) => (
                <view key={q} className={cls('rs-chip')} bindtap={() => ask(q)}>
                  <text className={cls('rs-chip-text')}>{q}</text>
                </view>
              ))}
            </view>

            <view className={cls('rs-input-row')}>
              <input
                className={cls('rs-input')}
                placeholder="或者直接说：第二天下午轻松一点"
                placeholder-class={cls('rs-input-ph')}
                bindinput={(e: { detail: { value: string } }) => setText(e.detail.value)}
              />
            </view>

            {error ? <text className={cls('rs-error')}>{error}</text> : null}

            <view className={pending ? cls('rs-cta rs-cta-busy') : cls('rs-cta')} bindtap={() => ask(text)}>
              <text className={cls('rs-cta-text')}>{pending ? '咕噜正在想怎么改…' : '看看怎么改'}</text>
            </view>
          </view>
        )}
      </view>
    </view>
  );
}

/** 变更影响不带正负号，加号和单位在这里拼，引擎只出数字 */
function fmtDelta(n: number, unit: string): string {
  if (n === 0) return '没变';
  return `${n > 0 ? '+' : ''}${n}${unit}`;
}

function fmtMoney(n: number): string {
  if (n === 0) return '没变';
  return `${n > 0 ? '+' : ''}¥${n}`;
}
