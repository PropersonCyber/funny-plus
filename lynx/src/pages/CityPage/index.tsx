import { useCallback, useState } from '@lynx-js/react';

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

const HOT = ['丽江', '三亚', '西安', '杭州'];

export function CityPage({ city, cities, onPick, onBack }: Props) {
  const [keyword, setKeyword] = useState('');
  const kw = keyword.trim();
  const list = kw ? cities.filter((c) => c.indexOf(kw) >= 0) : cities;

  const onChange = useCallback((e: any) => setKeyword(e.detail?.value ?? ''), []);

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
        <text className={cls('city-cur-value')}>{city}</text>
        <text className={cls('city-cur-note')}>接定位能力后由宿主动态获取</text>
      </view>

      <text className={cls('city-sec')}>{kw ? '搜索结果' : '可选城市'}</text>
      {list.length === 0 ? (
        <text className={cls('city-empty')}>没有匹配的城市</text>
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
          <view key={h} className={cls('city-hot-chip')} bindtap={() => toast(`${h} 还没有地点数据`)}>
            <text className={cls('city-hot-text')}>{h}</text>
          </view>
        ))}
      </view>
      <text className={cls('city-tip')}>热门城市还没有地点数据，切过去会没有方案，先灰着</text>
    </view>
  );
}
