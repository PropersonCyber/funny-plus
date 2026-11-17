import { IconSvg } from '../IconSvg.js';
import { filledIcon } from '../icons-filled.js';
import { tabSvg } from '../icons.js';
import { makeCls } from '../styles/cls.js';
import styles from './index.module.scss';
import { TABS } from './tabs.js';
import type { TabId } from './tabs.js';

const cls = makeCls(styles);

type Props = {
  current: TabId;
  onPick: (id: TabId) => void;
};

/**
 * 底部五栏。
 *
 * 选中态用实心图标、未选中用线性图标：两套字形不是同一套，
 * 所以这里同时依赖 tabSvg（线性）和 filledIcon（实心），别试图统一。
 */
export function TabBar({ current, onPick }: Props) {
  return (
    <view className={cls('tabbar')}>
      {TABS.map((t) => (
        <view key={t.id} className={cls('tab')} catchtap={() => onPick(t.id)}>
          <IconSvg
            content={current === t.id ? filledIcon(t.icon, '#2478F2') : tabSvg(t.icon, false)}
            style={{ width: '23px', height: '23px', marginBottom: '2px' }}
          />
          <text className={cls(current === t.id ? 'tab-label tab-label-on' : 'tab-label')}>{t.title}</text>
        </view>
      ))}
    </view>
  );
}
