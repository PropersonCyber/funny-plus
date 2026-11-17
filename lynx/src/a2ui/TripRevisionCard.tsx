import { makeCls } from '../styles/cls.js';
import type { TripRevisionCardProps } from './catalog.js';
import styles from '../pages/AssistantPage/index.module.scss';

const cls = makeCls(styles);

/** 协议字段是 unknown，逐项收窄；缺字段就当空串，不猜内容 */
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function lines(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * A2UI 版的行程修改预览卡片。
 *
 * 只负责摆放：所有文案（含正负号、单位、兜底提示）都由 revisionMessages 在转换时定好，
 * 这里不再计算任何东西 —— 否则旧卡片和新卡片迟早各算一套，用户会看到两个数。
 *
 * 样式类沿用 AssistantPage 现有卡片，不引 genui 主题 CSS。
 */
export function TripRevisionCard(props: TripRevisionCardProps) {
  const previewId = str(props.previewId);
  const reason = str(props.reason);
  const impactLine = str(props.impactLine);
  const recheckLine = str(props.recheckLine);
  const engineNote = str(props.engineNote);
  const affected = lines(props.affectedLines);

  /** 动作只带 previewId：真正要应用的数据由业务层按 id 找回原始预览 */
  const fire = (name: 'confirm' | 'cancel') => () => {
    props.sendAction?.({ event: { name, context: { previewId } } });
  };

  return (
    <view>
      <text className={cls('bubble-title')}>{reason}</text>
      {affected.map((line) => (
        <text key={line} className={cls('plan-day')}>
          {line}
        </text>
      ))}
      <text className={cls('plan-day')}>{impactLine}</text>
      {recheckLine ? <text className={cls('plan-day')}>{recheckLine}</text> : null}
      {engineNote ? <text className={cls('plan-day')}>{engineNote}</text> : null}
      <view className={cls('bubble-action')} bindtap={fire('confirm')}>
        <text className={cls('bubble-action-text')}>确认应用</text>
      </view>
      <view className={cls('bubble-action')} bindtap={fire('cancel')}>
        <text className={cls('bubble-action-text')}>先不改</text>
      </view>
    </view>
  );
}

TripRevisionCard.displayName = 'TripRevisionCard';