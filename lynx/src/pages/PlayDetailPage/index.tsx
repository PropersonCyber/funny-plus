import { useCallback } from '@lynx-js/react';

import chengdu from '../../assets/gen/chengdu.jpg';
import chongqing from '../../assets/gen/chongqing.jpg';
import beijing from '../../assets/gen/beijing.jpg';
import dali from '../../assets/gen/dali.jpg';
import pandaImg from '../../assets/gen/panda.jpg';
import jinliImg from '../../assets/gen/jinli.jpg';
import { svgIcon } from '../../icons.js';
import { spotImg } from '../../spot-img.js';
import styles from './index.module.scss';
import { makeCls } from '../../styles/cls.js';

const cls = makeCls(styles);

const COVER: Record<string, string> = {
  chengdu,
  chongqing,
  beijing,
  dali,
  panda: pandaImg,
  jinli: jinliImg,
};

type Props = {
  play: { id: string; title: string; note: string; coverImage: string };
  /** 关联景点，顺序就是玩法的推荐顺序 */
  places: { id: string; name: string; city: string; ticket: number; stayMin: number; tags: string[] }[];
  collected: boolean;
  visitedIds: string[];
  onToggleCollect: () => void;
  onCheckIn: (placeId: string) => void;
  onBack: () => void;
};

/** 玩法详情：一个玩法 = 一组景点，可直接收藏玩法或对单个景点打卡 */
export function PlayDetailPage({ play, places, collected, visitedIds, onToggleCollect, onCheckIn, onBack }: Props) {
  const onFav = useCallback(() => onToggleCollect(), [onToggleCollect]);

  return (
    <view className={cls('play-page')}>
      <view className={cls('play-cover')}>
        <image src={COVER[play.coverImage] ?? chengdu} mode="aspectFill" style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }} />
        <view className={cls('play-cover-mask')} />
        <view className={cls('play-head')}>
          <view className={cls('play-back')} bindtap={onBack}>
            <svg content={svgIcon('chevronLeft', '#FFFFFF')} style={{ width: '18px', height: '18px' }} />
          </view>
          <view className={cls(collected ? 'play-fav play-fav-on' : 'play-fav')} bindtap={onFav}>
            <svg content={svgIcon(collected ? 'check' : 'sparkles', '#FFFFFF')} style={{ width: '16px', height: '16px' }} />
            <text className={cls('play-fav-text')}>{collected ? '已收藏' : '收藏'}</text>
          </view>
        </view>
        <view className={cls('play-cover-text')}>
          <text className={cls('play-title')}>{play.title}</text>
          <text className={cls('play-note')}>{play.note}</text>
        </view>
      </view>

      <view className={cls('play-body')}>
        <text className={cls('play-section')}>玩法包含 {places.length} 个景点</text>
        {places.map((p) => {
          const done = visitedIds.includes(p.id);
          return (
            <view key={p.id} className={cls('spot-row')}>
              <image src={spotImg(p.name, COVER[play.coverImage] ?? chengdu)} mode="aspectFill" style={{ width: '56px', height: '56px', borderRadius: '12px' }} />
              <view className={cls('spot-main')}>
                <text className={cls('spot-name')}>{p.name}</text>
                <text className={cls('spot-meta')}>
                  {p.city} · ¥{p.ticket} · 建议 {p.stayMin} 分钟
                </text>
              </view>
              <view
                className={cls(done ? 'spot-check spot-check-on' : 'spot-check')}
                bindtap={() => onCheckIn(p.id)}
              >
                <text className={cls(done ? 'spot-check-text on' : 'spot-check-text')}>
                  {done ? '已打卡' : '打卡'}
                </text>
              </view>
            </view>
          );
        })}
      </view>
    </view>
  );
}
