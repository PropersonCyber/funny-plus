import { useCallback, useEffect, useState } from '@lynx-js/react';

import { diagnostic, locateCity } from '../../geo.js';

import { svgIcon } from '../../icons.js';
import { toast } from '../../toast.js';
import styles from './index.module.scss';
import { makeCls } from '../../styles/cls.js';

const cls = makeCls(styles);

type Props = {
  city: string;
  cities: string[];
  onPick: (city: string) => void;
  onBack: () => void;
};

/**
 * 热门推荐：全是当前还没有地点数据的城市，点了只提示、不切。
 * 放它们的目的是让用户知道「我们没覆盖到这儿」，而不是让搜索框显得空。
 */
const HOT = ['丽江', '三亚', '西安', '杭州'];

export function CityPage({ city, cities, onPick, onBack }: Props) {
  const [keyword, setKeyword] = useState('');
  const kw = keyword.trim();

  /**
   * 有数据的城市只有 cities 这几个（目前成都/重庆/北京）。
   * 搜索框放开输入任意城市，但**只有这几个能真正选中**：
   * 让用户切到没有地点数据的城市，规划页会直接空掉，比不支持更糟。
   */
  const list = kw ? cities.filter((c) => c.indexOf(kw) >= 0) : cities;
  /** 用户搜了一个我们没覆盖的城市：给明确结论，不留一个空列表让人猜 */
  const uncovered = kw.length > 0 && list.length === 0;

  const onChange = useCallback((e: any) => setKeyword(e.detail?.value ?? ''), []);

  /**
   * 定位状态。四种呈现分开，用户才知道下一步该干什么：
   *   ok      拿到城市名
   *   pending 还在等系统回调 —— 「定位中…」
   *   denied  权限被拒 —— 提示去系统设置
   *   其余    无壳能力（浏览器预览）/ 逆地理没配 key / 查不到 —— 保持原占位，不编城市
   *
   * 绝不退回 city：那是用户选的目的地，不是定位。
   */
  const [loc, setLoc] = useState<{ city: string; note: string }>({ city: '', note: '' });
  useEffect(() => {
    let alive = true;
    locateCity()
      .then((r) => {
        if (!alive) return;
        if (r.status === 'ok' && r.city) return setLoc({ city: r.city, note: '按设备定位' });
        if (r.status === 'offline' && r.reason === 'denied') {
          return setLoc({ city: '', note: '未授权定位，去系统设置里开启' });
        }
        if (r.status === 'offline' && r.reason === 'pending') {
          // 区分「等的还不够久」和「宿主压根没注入」：前者继续转圈，后者要报出来
          const noChannel = diagnostic === 'no-channel';
          return setLoc({ city: '', note: noChannel ? '定位未接入（宿主没注入）' : '定位中…' });
        }
        setLoc({ city: '', note: '' });
      })
      // 定位是锦上添花，失败不打断选城市
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <view className={cls('city-page')}>
      <view className={cls('city-head')}>
        <view className={cls('city-back')} bindtap={onBack}>
          <svg content={svgIcon('chevronLeft', '#2A3A57')} style={{ width: '18px', height: '18px' }} />
        </view>
        <view className={cls('city-search')}>
          <svg content={svgIcon('search', '#8A99B3')} style={{ width: '15px', height: '15px', marginRight: '6px' }} />
          <input
            className={cls('city-input')}
            placeholder="城市名称"
            default-value={keyword}
            bindinput={onChange}
          />
        </view>
      </view>

      <view className={cls('city-cur')}>
        <text className={cls('city-cur-label')}>当前定位</text>
        <text className={cls('city-cur-value')}>{loc.city || city}</text>
        <text className={cls('city-cur-note')}>{loc.note || '接定位能力后由宿主动态获取'}</text>
      </view>

      <text className={cls('city-sec')}>{kw ? '搜索结果' : '可选城市'}</text>
      {uncovered ? (
        <view className={cls('city-miss')}>
          <text className={cls('city-miss-title')}>「{kw}」暂未开放</text>
          <text className={cls('city-miss-note')}>
            目前只支持 {cities.join('、')} 的路线规划，其它城市的景点和交通数据还没有
          </text>
        </view>
      ) : (
        list.map((c) => (
          <view key={c} className={cls('city-item')} bindtap={() => onPick(c)}>
            <text className={c === city ? 'city-item-text city-item-on' : 'city-item-text'}>{c}</text>
            {c === city ? <text className={cls('city-item-tick')}>当前</text> : null}
          </view>
        ))
      )}

      <text className={cls('city-sec')}>热门城市</text>
      <view className={cls('city-hot')}>
        {HOT.map((h) => (
          <view key={h} className={cls('city-hot-chip')} bindtap={() => toast(`${h} 暂未开放，目前只支持 ${cities.join('、')}`)}>
            <text className={cls('city-hot-text')}>{h}</text>
          </view>
        ))}
      </view>
      <text className={cls('city-tip')}>热门城市暂未开放：没有景点和交通数据，切过去规划不出路线</text>
    </view>
  );
}
