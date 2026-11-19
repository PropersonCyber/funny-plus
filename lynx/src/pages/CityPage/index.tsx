import { IconSvg } from '../../IconSvg.js';
import { useCallback, useEffect, useMemo, useRef, useState } from '@lynx-js/react';
import type { NodesRef } from '@lynx-js/types';

import { cover } from '../../assets/city-covers.js';
import listHero from '../../assets/gen/list-hero.jpg';
import mascotHero from '../../assets/ip/mascot-hero.png';
import { refreshLocation } from '../../locationFace.js';
import { useLocationFace } from '../../useLocationFace.js';
import { QICON, svgIcon } from '../../icons.js';
import { toast } from '../../toast.js';
import styles from './index.module.scss';
import { makeCls } from '../../styles/cls.js';
import {
  ALL_CITIES,
  HOT_COVERS,
  HOT_IDS,
  REGIONS,
  countByRegion,
  groupByLetter,
  indexLetters,
  matchCities,
  type RegionKey,
  type TabKey,
} from './cityIndex.js';

const cls = makeCls(styles);

/**
 * 列表里固定排在字母分组之前的直接子节点个数：顶部两块（热门+地区）合成一个，加上「全部城市」标题。
 * scrollTo 的 index 数的是 scroll-view 的**直接子节点**，所以每个字母分组必须自己就是一层子节点，
 * 不能套在包裹层里——套一层之后 index 会指到包裹层，A-Z 跳转整体错位。
 */
const LIST_HEAD = 2;

type Props = {
  /** 当前已选的目的地，用来在列表里打「当前」标记 */
  current: string;
  /** 可真正选择的城市 id；不在这里的城市点了只提示，不切换 */
  cities: string[];
  onPick: (city: string) => void;
  onBack: () => void;
  /** 热门城市「查看更多」：复用热门城市列表页 */
  onMore: () => void;
};

export function CityPage({ current, cities, onPick, onBack, onMore }: Props) {
  const [tab, setTab] = useState<TabKey>('domestic');
  const [keyword, setKeyword] = useState('');
  const kw = keyword.trim();
  const isSearching = kw.length > 0;

  /** 列表滚动容器的 ref：右侧 A-Z 索引靠 invoke('scrollTo') 定位 */
  const listRef = useRef<NodesRef>(null);
  /** 搜索框的 ref：清空要同时改原生输入框内容，不然框里留着字、列表却空了 */
  const inputRef = useRef<NodesRef>(null);

  /**
   * 索引是这一版的事实来源，cities（App 传进来的可选项）只用来判断能不能点。
   * 两边不一致时以索引为准并把差异报出来，否则用户会在一张有「成都」的列表里
   * 点出「暂未开放」——这种不一致十有八九是数据没同步，不该由用户承担。
   */
  const cityKey = cities.join(',');
  // 目录按设计稿铺全。cities 只表示「点了能规划」，用来提示暂未开放，不能拿来把列表裁成三座城。
  const indexed = ALL_CITIES;
  useEffect(() => {
    const missing = cities.filter((id) => !ALL_CITIES.some((c) => c.id === id));
    if (missing.length) console.warn('[city] 城市索引缺少：', missing.join('、'));
  }, [cityKey]);

  const onInput = useCallback((e: { detail?: { value?: string } }) => {
    setKeyword(e.detail?.value ?? '');
  }, []);

  /**
   * 清空搜索：状态和原生输入框一起清。
   * 只改状态的话，input 的 default-value 不会跟着回退，会出现「列表空了、框里还留着词」，
   * 用户再点一次搜索框会看到残留内容。
   */
  const clear = useCallback(() => {
    setKeyword('');
    inputRef.current?.invoke({ method: 'setValue', params: { value: '' } }).exec();
  }, []);

  // 文案和首页胶囊是同一份，不在这里再解析一遍城市名
  const loc = useLocationFace();

  /** 搜索态不分地区也不分字母，只给一条平铺结果 */
  const matched = useMemo(() => matchCities(indexed, kw), [indexed, kw]);
  const groups = useMemo(() => groupByLetter(matched), [matched]);
  const letters = useMemo(() => indexLetters(groups), [groups]);

  const pickCity = useCallback(
    (id: string) => {
      if (cities.indexOf(id) < 0) {
        toast(`「${id}」暂未开放，目前支持 ${cities.join('、')}`);
        return;
      }
      onPick(id);
    },
    [cities, onPick],
  );

  /** A-Z 索引：滚到对应分组。分组下标加上前面固定块的数量，才是子节点序号 */
  const jump = useCallback(
    (letter: string) => {
      const at = groups.findIndex((g) => g.letter === letter);
      if (at < 0) return;
      listRef.current?.invoke({ method: 'scrollTo', params: { index: LIST_HEAD + at, smooth: true } }).exec();
    },
    [groups],
  );

  /**
   * 地区点击：滚到该地区的第一个城市，不新开页面。
   * 地区下没有城市时只提示、不滚——宫格上已经写了「即将开放」。
   */
  const onRegion = useCallback(
    (key: RegionKey) => {
      const hit = indexed.filter((c) => c.region === key);
      if (hit.length === 0) {
        toast(`${REGIONS.find((r) => r.key === key)?.label ?? '该地区'}暂未开放`);
        return;
      }
      jump(hit[0].letter);
    },
    [indexed, jump],
  );

  const onLocate = useCallback(() => {
    if (loc.status === 'denied') {
      // 壳没有实现「拉起系统设置」的通道，这里只能给一句可执行的说明。
      // 之前调 openLocationSettings() 恒返 false，等于点了只看到同一句提示，白绕一层
      toast('请到系统设置 → 应用权限里开启定位，再回来重试');
      return;
    }
    refreshLocation();
  }, [loc.status]);

  const onPickLocated = useCallback(() => {
    if (!loc.id) return;
    pickCity(loc.id);
  }, [loc.id, pickCity]);

  return (
    <view className={cls('tc-page')}>
      {/* ---------- 顶部横幅：山水 + 标题 + 吉祥物，吉祥物刻意压出下沿 ---------- */}
      <view className={cls('tc-hero')}>
        <image className={cls('tc-hero-bg')} src={listHero} mode="aspectFill" />
        <view className={cls('tc-back')} bindtap={onBack}>
          <IconSvg content={svgIcon('chevronLeft', '#2A3A57')} style={{ width: '18px', height: '18px' }} />
        </view>
        <view className={cls('tc-hero-text')}>
          <text className={cls('tc-title')}>选择出发城市</text>
          <view className={cls('tc-underline')} />
          <text className={cls('tc-subtitle')}>全国城市随心选，开启你的下一段旅程</text>
        </view>
        <image className={cls('tc-mascot')} src={mascotHero} mode="aspectFit" />
      </view>

      {/* ---------- 搜索框 ---------- */}
      <view className={cls('tc-search')}>
        <IconSvg content={svgIcon('search', '#8A99B3')} style={{ width: '18px', height: '18px' }} />
        <input
          ref={inputRef}
          className={cls('tc-input')}
          placeholder="搜索城市（如：成都、北京、杭州）"
          placeholder-class={cls('tc-input-ph')}
          default-value={keyword}
          bindinput={onInput}
        />
        {isSearching ? (
          <view className={cls('tc-search-clear')} catchtap={clear}>
            <text className={cls('tc-search-clear-icon')}>✕</text>
          </view>
        ) : null}
      </view>

      {/* ---------- 当前定位 ---------- */}
      <view className={cls('tc-loc')}>
        <view className={cls('tc-loc-pin')}>
          <IconSvg content={svgIcon('pin', '#2B7BFF')} style={{ width: '20px', height: '20px' }} />
        </view>
        <view className={cls('tc-loc-text')} bindtap={onPickLocated}>
          <text className={cls('tc-loc-label')}>当前定位</text>
          <text className={cls(loc.status === 'ok' ? 'tc-loc-value' : 'tc-loc-value tc-loc-wait')} text-maxline="1">
            {loc.label}
          </text>
        </view>
        <view className={cls('tc-loc-btn')} bindtap={onLocate}>
          <IconSvg content={svgIcon('locate', '#2B7BFF')} style={{ width: '16px', height: '16px' }} />
        </view>
      </view>

      {/* ---------- 国内 / 境外 ---------- */}
      <view className={cls('tc-tabs')}>
        <view className={cls(tab === 'domestic' ? 'tc-tab tc-tab-on' : 'tc-tab')} bindtap={() => setTab('domestic')}>
          <IconSvg content={svgIcon('bird', tab === 'domestic' ? '#FFFFFF' : '#3C5A85')} style={{ width: '14px', height: '14px', marginRight: '4px' }} />
          <text className={cls(tab === 'domestic' ? 'tc-tab-text on' : 'tc-tab-text')}>国内城市</text>
        </view>
        <view className={cls(tab === 'overseas' ? 'tc-tab tc-tab-on' : 'tc-tab')} bindtap={() => setTab('overseas')}>
          <IconSvg content={svgIcon('globe', tab === 'overseas' ? '#FFFFFF' : '#3C5A85')} style={{ width: '14px', height: '14px', marginRight: '4px' }} />
          <text className={cls(tab === 'overseas' ? 'tc-tab-text on' : 'tc-tab-text')}>境外城市</text>
        </view>
      </view>

      {tab === 'overseas' ? (
        <view className={cls('tc-empty-box')}>
          <text className={cls('tc-empty-title')}>境外城市正在接入</text>
          <text className={cls('tc-empty-note')}>签证与跨境交通还在整理，接入后这里可以直接选</text>
        </view>
      ) : (
        <view className={cls('tc-list-wrap')}>
          <scroll-view ref={listRef} className={cls('tc-body')} scroll-y bounces={false}>
            {/* 子节点 0：热门 + 地区。整块合成一个子节点，搜索时只是里面为空，序号不变 */}
            <view className={cls('tc-top')} flatten={false}>
              {isSearching ? null : (
                <view className={cls('tc-block')}>
                  <view className={cls('tc-block-head')}>
                    <view className={cls('tc-block-title-row')}>
                      <image className={cls('tc-flame')} src={QICON.flame} mode="aspectFit" />
                      <text className={cls('tc-block-title')}>热门城市</text>
                    </view>
                    <view className={cls('tc-more')} bindtap={onMore}>
                      <text className={cls('tc-more-text')}>查看更多</text>
                      <IconSvg content={svgIcon('chevronRight', '#2B7BFF')} style={{ width: '13px', height: '13px' }} />
                    </view>
                  </view>
                  <view className={cls('tc-hot-clip')}>
                    <scroll-view className={cls('tc-hot')} scroll-x bounces={false}>
                      {/* 卡片必须收进一个行容器：散落的子节点会把 scroll-view 撑成内容总宽，裁切层就失效 */}
                      <view className={cls('tc-hot-row')}>
                        {HOT_IDS.map((id, i) => (
                          <view
                            key={id}
                            className={cls(i === HOT_IDS.length - 1 ? 'tc-hot-card tc-hot-card-last' : 'tc-hot-card')}
                            bindtap={() => pickCity(id)}
                          >
                            <image className={cls('tc-hot-img')} src={cover(HOT_COVERS[id])} mode="aspectFill" />
                            <view className={cls('tc-hot-veil')} />
                            <text className={cls('tc-hot-name')}>{id}</text>
                          </view>
                        ))}
                      </view>
                    </scroll-view>
                  </view>
                </view>
              )}

              {isSearching ? null : (
                <view className={cls('tc-block')}>
                  <view className={cls('tc-block-head')}>
                    <view className={cls('tc-block-title-row')}>
                      <view className={cls('tc-title-badge')}>
                        <IconSvg content={svgIcon('map', '#2B7BFF')} style={{ width: '13px', height: '13px' }} />
                      </view>
                      <text className={cls('tc-block-title')}>按地区选择</text>
                    </view>
                  </view>
                  <view className={cls('tc-regions')}>
                    {countByRegion(indexed).map(({ region, count }) => (
                      <view
                        key={region.key}
                        className={cls(count > 0 ? 'tc-region' : 'tc-region tc-region-off')}
                        bindtap={() => onRegion(region.key)}
                      >
                        <text className={cls('tc-region-icon')}>{region.icon}</text>
                        <view className={cls('tc-region-text')}>
                          <text className={cls('tc-region-name')}>{region.label}</text>
                          <text className={cls('tc-region-count')}>{count > 0 ? `${count} 个城市` : '即将开放'}</text>
                        </view>
                        <IconSvg content={svgIcon('chevronRight', '#A9BBD8')} style={{ width: '13px', height: '13px' }} />
                      </view>
                    ))}
                  </view>
                </view>
              )}
            </view>

            {/* 子节点 1：全部城市标题 */}
            <view className={cls('tc-block')} flatten={false}>
              <view className={cls('tc-block-head')}>
                <view className={cls('tc-block-title-row')}>
                  <view className={cls('tc-title-badge')}>
                    <IconSvg content={svgIcon('home', '#2B7BFF')} style={{ width: '13px', height: '13px' }} />
                  </view>
                  <text className={cls('tc-block-title')}>{isSearching ? '搜索结果' : '全部城市'}</text>
                </view>
                {isSearching ? <text className={cls('tc-count')}>{matched.length} 个</text> : null}
              </view>
            </view>

            {/* 子节点 2 起：每个字母分组一个，或空态一个 */}
            {groups.length === 0 ? (
              <view className={cls('tc-empty-box')} flatten={false}>
                <text className={cls('tc-empty-title')}>「{kw}」暂未开放</text>
                <text className={cls('tc-empty-note')}>
                  目前只支持 {cities.join('、')} 的路线规划，其它城市的景点和交通数据还没有
                </text>
              </view>
            ) : (
              groups.map((g) => (
                <view key={g.letter} className={cls('tc-group')} flatten={false}>
                  <view className={cls('tc-letter')}>
                    <text className={cls('tc-letter-text')}>{g.letter}</text>
                  </view>
                  <view className={cls('tc-chips')}>
                    {g.cities.map((c) => (
                      <view
                        key={c.id}
                        className={cls(c.id === current ? 'tc-chip tc-chip-on' : 'tc-chip')}
                        bindtap={() => pickCity(c.id)}
                      >
                        <text className={cls(c.id === current ? 'tc-chip-text on' : 'tc-chip-text')}>{c.id}</text>
                      </view>
                    ))}
                  </view>
                </view>
              ))
            )}

            <view className={cls('tc-bottom')} />
          </scroll-view>

          {/* 索引条浮在滚动区右侧：放外面才不会占掉一个子节点序号。
              设计稿是完整 A-Z，没有城市的字母变灰 */}
          <view className={cls('tc-idx')}>
            {letters.map((item) => (
              <view
                key={item.letter}
                className={cls('tc-idx-item')}
                bindtap={() => {
                  if (item.enabled) jump(item.letter);
                }}
              >
                <text className={cls(item.enabled ? 'tc-idx-text' : 'tc-idx-text off')}>{item.letter}</text>
              </view>
            ))}
          </view>
        </view>
      )}
    </view>
  );
}
