import { useCallback } from '@lynx-js/react';

import { svgIcon } from '../../icons.js';
import styles from './index.module.scss';
import { makeCls } from '../../styles/cls.js';

const cls = makeCls(styles);

export type PickerOption = { value: string; label: string; note?: string };

type Props = {
  title: string;
  options: PickerOption[];
  value: string;
  onClose: () => void;
  onPick: (value: string) => void;
};

/**
 * 通用底部选择器。
 * 为什么不用滚轮：Lynx 没有小程序那种原生 picker，滚轮的吸附要自己按滚动距离算索引，
 * 原生端表现未验证；选项个位数直接列出来更快，点一下就选中并关掉。
 */
export function PickerSheet({ title, options, value, onClose, onPick }: Props) {
  const pick = useCallback(
    (next: string) => {
      onPick(next);
      onClose();
    },
    [onPick, onClose],
  );

  return (
    // catchtap：关掉选择器时不能把底下的规划弹窗一起关掉
    <view className={cls('pk-mask')} catchtap={onClose}>
      <view className={cls('pk-sheet')} catchtap={() => {}}>
        <view className={cls('pk-grabber')} />
        <view className={cls('pk-head')}>
          <text className={cls('pk-title')}>{title}</text>
          <view className={cls('pk-close')} catchtap={onClose}>
            <text className={cls('pk-close-text')}>✕</text>
          </view>
        </view>

        <scroll-view className={cls('pk-list')} scroll-y bounces={false}>
          {options.map((o) => {
            const on = o.value === value;
            return (
              <view key={o.value} className={cls(on ? 'pk-row pk-row-on' : 'pk-row')} bindtap={() => pick(o.value)}>
                <view className={cls('pk-main')}>
                  <text className={cls(on ? 'pk-label pk-label-on' : 'pk-label')}>{o.label}</text>
                  {o.note ? <text className={cls('pk-note')}>{o.note}</text> : null}
                </view>
                {on ? <image src={svgIcon('check', '#2478F2')} style={{ width: '16px', height: '16px' }} /> : null}
              </view>
            );
          })}
        </scroll-view>
      </view>
    </view>
  );
}
