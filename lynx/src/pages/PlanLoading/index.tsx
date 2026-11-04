import { useEffect, useState } from '@lynx-js/react';

import planMascot from '../../assets/gen/plan-loading.png';
import styles from './index.module.scss';
import { makeCls } from '../../styles/cls.js';

const cls = makeCls(styles);

type Props = {
  /** 关掉遮罩 = 放弃这次生成，不写存档 */
  onCancel: () => void;
};

/** 生成中的过渡卡：进度条是纯展示，真实规划是本地同步算完的 */
export function PlanLoading({ onCancel }: Props) {
  const [pct, setPct] = useState(8);

  useEffect(() => {
    const id = setInterval(() => setPct((p) => (p >= 92 ? 92 : p + 6)), 90);
    return () => clearInterval(id);
  }, []);

  return (
    <view className={cls('pl-mask')} catchtap={() => {}}>
      <view className={cls('pl-card')}>
        <view className={cls('pl-close')} catchtap={onCancel}>
          <text className={cls('pl-close-text')}>✕</text>
        </view>
        <text className={cls('pl-title')}>智能规划中...</text>
        <image src={planMascot} mode="aspectFit" style={{ width: '160px', height: '160px' }} />
        <text className={cls('pl-sub')}>正在为你生成专属行程</text>
        <text className={cls('pl-sub')}>请稍候～</text>
        <view className={cls('pl-bar')}>
          <view className={cls('pl-bar-fill')} style={{ width: `${pct}%` }} />
        </view>
      </view>
    </view>
  );
}
