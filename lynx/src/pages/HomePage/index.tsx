import { useCallback, useState } from '@lynx-js/react';

import heroBanner from '../../assets/gen/hero-banner.jpg';
import aiBanner from '../../assets/gen/ai-banner.jpg';
import chengdu from '../../assets/gen/chengdu.jpg';
import beijing from '../../assets/gen/beijing.jpg';
import chongqing from '../../assets/gen/chongqing.jpg';
import dali from '../../assets/gen/dali.jpg';
import mascotAi from '../../assets/ip/mascot-ai.png';
import mascotExplore from '../../assets/ip/mascot-explore.png';
import { MAP_ART } from '../../icons.js';
import { svgIcon, COLOR, QICON } from '../../icons.js';
import { filledIcon } from '../../icons-filled.js';
import { MOCK } from '../../mock.js';
import { toast } from '../../toast.js';
import styles from './index.module.scss';
import { makeCls } from '../../styles/cls.js';

const cls = makeCls(styles);

type Props = {
  city: string;
  onPickCity: () => void;
  onPlan: () => void;
  onTab: (tab: 'map' | 'itinerary' | 'guide' | 'profile') => void;
  onAdvice: () => void;
  onAssistant: () => void;
  /** 首页「精选攻略」卡片：进攻略详情页 */
  onGuide: (index: number) => void;
};

const PLAY_IMG = MAP_ART.thumbs;


const CITY_IMG: Record<string, string> = { chengdu, chongqing, dali, beijing };

const QUICK = [
  { id: 'city', title: '热门目的地', img: QICON.pin, tint: 'rgba(245,160,60,0.16)' },
  { id: 'advice', title: '智能建议', img: QICON.spark, tint: 'rgba(139,124,255,0.16)' },
  { id: 'guide', title: '旅行避坑', img: QICON.shield, tint: 'rgba(53,192,138,0.16)' },
  { id: 'itinerary', title: '行程规划', img: QICON.calendar, tint: 'rgba(36,120,242,0.12)' },
] as const;

export function HomePage({ city, onPickCity, onPlan, onTab, onAdvice, onAssistant, onGuide }: Props) {
  // 当前城市排在最前，帮用户确认「切过去了」
  const cityList = MOCK.cities.slice().sort((a, b) => (b.id === city ? 1 : 0) - (a.id === city ? 1 : 0));
  // 内容没顶上来到状态栏时，定位条保持透明；滚过一点才显示底衬
  const [stuck, setStuck] = useState(false);
  const onScroll = useCallback((e: any) => {
    const y = (e && e.detail && e.detail.scrollTop) || 0;
    setStuck(y > 8);
  }, []);

  // 「动漫地图」原本占这一格，但底部 tab 已有地图；把死页面「智能建议」接在这
  const onQuick = useCallback(
    (id: string) => {
      if (id === 'city') onPickCity();
      else if (id === 'advice') onAdvice();
      else if (id === 'guide') onTab('guide');
      else onPlan();
    },
    [onAdvice, onPickCity, onPlan, onTab],
  );

  return (
    <view className={cls('home-root')}>
      <scroll-view className={cls('scroll')} scroll-y bindscroll={onScroll}>
        <view className={cls('home')}>
          <view className={cls('hero')}>
            <image
              src={heroBanner}
              mode="aspectFill"
              style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '340px' }}
            />
            <view className={cls('hero-fade')} />
          </view>

        <view className={cls('home-in')}>
          <view className={cls('ai-card')} bindtap={onPlan}>
            <view className={cls('ai-icon-box')}>
              <svg content={filledIcon('sparkle', '#FFFFFF')} style={{ width: '20px', height: '20px' }} />
            </view>
            <view className={cls('ai-text')}>
              <text className={cls('ai-title')}>AI 规划你的专属旅行</text>
              <text className={cls('ai-sub')}>告诉我想法，生成最佳行程</text>
            </view>
            <view className={cls('ai-go')}>
              <svg content={svgIcon('chevronRight', '#8A99B3')} style={{ width: '14px', height: '14px' }} />
            </view>
          </view>

          <view className={cls('quick-card')}>
            {QUICK.map((q) => (
              <view key={q.id} className={cls('quick-item')} bindtap={() => onQuick(q.id)}>
                <view className={cls('quick-icon-box')} style={{ backgroundColor: q.tint }}>
                  <image src={q.img} mode="aspectFit" style={{ width: '30px', height: '30px' }} />
                </view>
                <text className={cls('quick-title')}>{q.title}</text>
              </view>
            ))}
          </view>

          <view className={cls('section-head')}>
            <view className={cls('sec-title-row')}>
              <image src={QICON.flame} mode="aspectFit" style={{ width: '16px', height: '16px', marginRight: '5px' }} />
              <text className={cls('section-title')}>热门推荐</text>
            </view>
            <view className={cls('section-more-row')} bindtap={() => toast('更多城市与推荐本期未开放')}>
              <text className={cls('section-more')}>查看更多</text>
              <svg content={svgIcon('chevronRight', '#A5B2C7')} style={{ width: '12px', height: '12px', marginLeft: '2px' }} />
            </view>
          </view>

          <view className={cls('city-row')}>
            {cityList.map((c, i) => (
              <view
                key={c.id}
                className={cls(i === cityList.length - 1 ? 'city-card city-card-last' : 'city-card')}
                bindtap={onPickCity}
              >
                <image
                  src={CITY_IMG[c.image]}
                  mode="aspectFill"
                  style={{ width: '100%', height: '104px' }}
                />
                <view className={cls('city-body')}>
                  <text className={cls('city-name')}>{c.id}</text>
                  <view className={cls('city-rate-row')}>
                    <image src={QICON.star} mode="aspectFit" style={{ width: '9px', height: '9px', marginRight: '2px' }} />
                    <text className={cls('city-rate')}>{c.rating}</text>
                    <text className={cls('city-visited')}>· {c.visited}</text>
                  </view>
                  <text className={cls('city-desc')}>{c.desc}</text>
                </view>
              </view>
            ))}
          </view>

          <view className={cls('section-head')}>
            <view className={cls('sec-title-row')}>
              <image src={QICON.flame} mode="aspectFit" style={{ width: '16px', height: '16px', marginRight: '5px' }} />
              <text className={cls('section-title')}>本周精选 · 2天1晚短途游</text>
            </view>
            <view className={cls('section-more-row')} bindtap={() => toast('精选只有这一条，换一批本期未开放')}>
              <text className={cls('section-more')}>换一批</text>
              <svg content={svgIcon('refresh', '#A5B2C7')} style={{ width: '13px', height: '13px' }} />
            </view>
          </view>

          <view className={cls('weekly')} bindtap={() => toast('精选行程详情本期未开放，先看下面的行程')}>
            <image src={CITY_IMG[MOCK.weekly.image]} mode="aspectFill" style={{ width: '96px', height: '76px', borderRadius: '12px' }} />
            <view className={cls('weekly-main')}>
              <text className={cls('weekly-title')}>{MOCK.weekly.title}</text>
              <view className={cls('weekly-tags')}>
                {MOCK.weekly.tags.map((t) => (
                  <view key={t} className={cls('weekly-tag')}>
                    <text className={cls('weekly-tag-text')}>{t}</text>
                  </view>
                ))}
              </view>
              <text className={cls('weekly-desc')}>{MOCK.weekly.desc}</text>
            </view>
            <view className={cls('weekly-go')}>
              <svg content={svgIcon('chevronRight', '#8A99B3')} style={{ width: '13px', height: '13px' }} />
            </view>
          </view>

          <view className={cls('section-head')}>
            <view className={cls('sec-title-row')}>
              <image src={QICON.backpack} mode="aspectFit" style={{ width: '16px', height: '16px', marginRight: '5px' }} />
              <text className={cls('section-title')}>爆款玩法</text>
            </view>
            <view className={cls('section-more-row')} bindtap={() => toast('更多玩法本期未开放')}>
              <text className={cls('section-more')}>更多玩法</text>
              <svg content={svgIcon('chevronRight', '#A5B2C7')} style={{ width: '12px', height: '12px', marginLeft: '2px' }} />
            </view>
          </view>
          <view className={cls('play-row')}>
            {MOCK.hotPlays.map((p, i) => (
              <view
                key={p.title}
                className={cls(i === MOCK.hotPlays.length - 1 ? 'play-card play-last' : 'play-card')}
                bindtap={() => toast('玩法详情本期未开放')}
              >
                <image src={PLAY_IMG[i % PLAY_IMG.length]} mode="aspectFit" style={{ width: '100%', height: '56px' }} />
                <text className={cls('play-title')}>{p.title}</text>
                <text className={cls('play-desc')}>{p.note}</text>
              </view>
            ))}
          </view>

          <view className={cls('ai-banner')} bindtap={onAssistant}>
            <image src={aiBanner} mode="aspectFill" style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }} />
            <view className={cls('ai-banner-inner')}>
              <view className={cls('ai-banner-chip')}>
                <image src={QICON.spark} mode="aspectFit" style={{ width: '12px', height: '12px', marginRight: '4px' }} />
                <text className={cls('ai-banner-chip-text')}>AI 智能规划</text>
              </view>
              <text className={cls('ai-banner-title')}>告诉我你的旅行需求</text>
              <text className={cls('ai-banner-title')}>AI 为你定制专属行程</text>
              <view className={cls('ai-banner-btn')}>
                <text className={cls('ai-banner-btn-text')}>立即体验 →</text>
              </view>
            </view>
            <image src={mascotExplore} mode="aspectFit" className={cls('ai-banner-mascot')} />
          </view>

          <view className={cls('section-head')}>
            <view className={cls('sec-title-row')}>
              <image src={QICON.book} mode="aspectFit" style={{ width: '16px', height: '16px', marginRight: '5px' }} />
              <text className={cls('section-title')}>精选攻略</text>
            </view>
            <view className={cls('section-more-row')} bindtap={() => toast('攻略详情本期未开放')}>
              <text className={cls('section-more')}>查看更多</text>
              <svg content={svgIcon('chevronRight', '#A5B2C7')} style={{ width: '12px', height: '12px', marginLeft: '2px' }} />
            </view>
          </view>
          <view className={cls('guide-row')}>
            {MOCK.guides.map((g, i) => (
              <view
                key={g.title}
                className={cls(i === MOCK.guides.length - 1 ? 'guide-card guide-last' : 'guide-card')}
                bindtap={() => onGuide(i)}
              >
                <image src={CITY_IMG[g.image]} mode="aspectFill" style={{ width: '100%', height: '82px' }} />
                <text className={cls('guide-title')}>{g.title}</text>
                <text className={cls('guide-note')}>{g.note}</text>
                <view className={cls('guide-views-row')}>
                  <image src={QICON.eye} mode="aspectFit" style={{ width: '10px', height: '10px', marginRight: '3px' }} />
                  <text className={cls('guide-views')}>{g.views}</text>
                </view>
              </view>
            ))}
          </view>
        </view>

        <view className={cls('ai-fab')} bindtap={onAssistant}>
          <image src={mascotAi} mode="aspectFit" style={{ width: '50px', height: '50px' }} />
        </view>

        </view>
      </scroll-view>

      {/* 定位条压在滚动内容之上：滚动时也要有底色，不然只有两个胶囊浮着像 bug */}
      {stuck ? <view className={cls('loc-bar')} /> : null}
      <view className={cls('loc-row')}>
        <view className={cls('loc-chip')} bindtap={onPickCity}>
          <svg content={svgIcon('pin', '#2478F2')} style={{ width: '14px', height: '14px', marginRight: '5px' }} />
          <text className={cls('loc-city')}>{city}</text>
        </view>
        <view className={cls('loc-tools')}>
          {/* 搜索入口：本期唯一能搜的是城市，直接进城市页那个真搜索框，别再开到规划弹窗 */}
          <view className={cls('loc-scan')} bindtap={onPickCity}>
            <svg content={svgIcon('search', '#1B4F8F')} style={{ width: '20px', height: '20px' }} />
          </view>
        </view>
      </view>
    </view>
  );
}
