import chengdu from '../../assets/gen/chengdu.jpg';
import chongqing from '../../assets/gen/chongqing.jpg';
import beijing from '../../assets/gen/beijing.jpg';
import dali from '../../assets/gen/dali.jpg';
import { svgIcon } from '../../icons.js';
import { filledIcon } from '../../icons-filled.js';
import type { Guide } from '../../../../shared/types/index.js';
import styles from './index.module.scss';
import { makeCls } from '../../styles/cls.js';

const cls = makeCls(styles);

const CITY_IMG: Record<string, string> = { chengdu, chongqing, beijing, dali };
/** 后端给的是资源 key，缺图退回成都封面，别让列表出现空洞 */
const cover = (key: string) => CITY_IMG[key] ?? chengdu;

type Props = {
  guides: Guide[];
  onBack: () => void;
  onOpen: (id: string) => void;
};

/** 精选攻略列表：首页只放前 3 条，其余的从这里进 */
export function GuideListPage({ guides, onBack, onOpen }: Props) {
  return (
    <view className={cls('gl-page')}>
      <view className={cls('gl-head')}>
        <view className={cls('gl-back')} bindtap={onBack}>
          <svg content={svgIcon('chevronLeft', '#2A3A57')} style={{ width: '18px', height: '18px' }} />
        </view>
        <view className={cls('gl-head-main')}>
          <text className={cls('gl-title')}>精选攻略</text>
          <text className={cls('gl-sub')}>共 {guides.length} 条，按运营排序</text>
        </view>
      </view>

      <scroll-view className={cls('scroll')} scroll-y>
        {guides.map((g) => (
          <view key={g.id} className={cls('gl-row')} bindtap={() => onOpen(g.id)}>
            <image className={cls('gl-img')} src={cover(g.coverImage)} mode="aspectFill" />
            <view className={cls('gl-main')}>
              <text className={cls('gl-row-title')}>{g.title}</text>
              <view className={cls('gl-meta')}>
                <svg content={filledIcon('star', '#FFB020')} style={{ width: '11px', height: '11px', marginRight: '3px' }} />
                <text className={cls('gl-rate')}>{(g.rating ?? 0).toFixed(1)}</text>
                <text className={cls('gl-dot')}>·</text>
                <text className={cls('gl-dim')}>{fmtViews(g.views)}人去过</text>
                <text className={cls('gl-dot')}>·</text>
                <text className={cls('gl-dim')}>{g.dayCount} 天</text>
              </view>
              <view className={cls('gl-badges')}>
                {g.badges.slice(0, 3).map((b) => (
                  <view key={b} className={cls('gl-badge')}>
                    <text className={cls('gl-badge-text')}>{b}</text>
                  </view>
                ))}
              </view>
            </view>
            <svg content={svgIcon('chevronRight', '#C3CFE2')} style={{ width: '16px', height: '16px' }} />
          </view>
        ))}
      </scroll-view>
    </view>
  );
}

/** 浏览量上万折成「万」：列表里空间更紧，只保留一位小数 */
function fmtViews(n: number): string {
  return n >= 10000 ? `${(n / 10000).toFixed(1)}万` : String(n);
}
