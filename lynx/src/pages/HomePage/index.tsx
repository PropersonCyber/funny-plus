import { useCallback, useState } from '@lynx-js/react';

import heroBanner from '../../assets/gen/hero-banner.jpg';
import aiBanner from '../../assets/gen/ai-banner.jpg';
import chengdu from '../../assets/gen/chengdu.jpg';
import pandaImg from '../../assets/gen/panda.jpg';
import jinliImg from '../../assets/gen/jinli.jpg';
import beijing from '../../assets/gen/beijing.jpg';
import chongqing from '../../assets/gen/chongqing.jpg';
import dali from '../../assets/gen/dali.jpg';
import mascotAi from '../../assets/ip/mascot-ai.png';
import mascotExplore from '../../assets/ip/mascot-explore.png';
import { MAP_ART } from '../../icons.js';
import { svgIcon, COLOR, QICON } from '../../icons.js';
import { filledIcon } from '../../icons-filled.js';
import type { City, Guide, Play } from '../../../../shared/types/index.js';
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
  /** 热门推荐城市卡：进城市详情页（顶部定位与「查看更多」仍走切换城市） */
  onOpenCity: (city: string) => void;
  /** 首页「精选攻略」卡片：进攻略详情页 */
  onGuide: (id: string) => void;
  /** 「精选攻略」的查看更多：首页只放 3 条，全量去列表页 */
  onAllGuides: () => void;
  /** 玩法卡：进玩法详情 */
  onPlay: (id: string) => void;
  /** 城市 / 攻略 / 玩法三块内容都来自 GET /api/content */
  cities: City[];
  guides: Guide[];
  plays: Play[];
};

const PLAY_IMG = MAP_ART.thumbs;


const CITY_IMG: Record<string, string> = { chengdu, chongqing, dali, beijing, panda: pandaImg, jinli: jinliImg };
/** 后端给的是资源 key，缺图时退回成都封面，别让卡片出现空洞 */
const cover = (key: string) => CITY_IMG[key] ?? chengdu;

/** 123000 → 12.3 万：库里存原始浏览量，展示口径放前端 */
function fmtViews(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 万`;
  return String(n);
}

const QUICK = [
  { id: 'city', title: '热门目的地', img: QICON.pin, tint: 'rgba(245,160,60,0.16)' },
  { id: 'advice', title: '智能建议', img: QICON.spark, tint: 'rgba(139,124,255,0.16)' },
  { id: 'guide', title: '旅行避坑', img: QICON.shield, tint: 'rgba(53,192,138,0.16)' },
  { id: 'itinerary', title: '行程规划', img: QICON.calendar, tint: 'rgba(36,120,242,0.12)' },
] as const;

export function HomePage({ city, onPickCity, onOpenCity, onPlan, onTab, onAdvice, onAssistant, onGuide, onAllGuides, onPlay, cities, guides, plays }: Props) {
  // 当前城市排在最前，帮用户确认「切过去了」
  const cityList = cities.slice().sort((a, b) => (b.id === city ? 1 : 0) - (a.id === city ? 1 : 0));
  // 首页只露出前 3 条：一排放 4 张会把标题挤成两行，剩下的一次性堆上来也不像「精选」
  const topGuides = guides.slice(0, 3);
  // 「本周精选」轮换的是攻略：切一份就是换一批，不做假动画
  const [weeklyIndex, setWeeklyIndex] = useState(0);
  const weekly = guides.length ? guides[weeklyIndex % guides.length] : null;
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
              style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '380px' }}
            />
            <view className={cls('hero-fade')} />
          </view>

        <view className={cls('home-in')}>
          <view className={cls('ai-card')} bindtap={onPlan}>
            <view className={cls('ai-icon-box')}>
              <image src={filledIcon('sparkle', '#FFFFFF')} style={{ width: '20px', height: '20px' }} />
            </view>
            <view className={cls('ai-text')}>
              <text className={cls('ai-title')}>AI 规划你的专属旅行</text>
              <text className={cls('ai-sub')}>告诉我想法，生成最佳行程</text>
            </view>
            <view className={cls('ai-go')}>
              <image src={svgIcon('chevronRight', '#8A99B3')} style={{ width: '14px', height: '14px' }} />
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
            <view className={cls('section-more-row')} bindtap={onPickCity}>
              <text className={cls('section-more')}>查看更多</text>
              <image src={svgIcon('chevronRight', '#A5B2C7')} style={{ width: '12px', height: '12px', marginLeft: '2px' }} />
            </view>
          </view>

          <view className={cls('city-row')}>
            {cityList.map((c, i) => (
              <view
                key={c.id}
                className={cls(i === cityList.length - 1 ? 'city-card city-card-last' : 'city-card')}
                bindtap={() => onOpenCity(c.id)}
              >
                <image
                  src={cover(c.coverImage)}
                  mode="aspectFill"
                  style={{ width: '100%', height: '104px' }}
                />
                <view className={cls('city-body')}>
                  <text className={cls('city-name')}>{c.id}</text>
                  <view className={cls('city-rate-row')}>
                    <image src={QICON.star} mode="aspectFit" style={{ width: '9px', height: '9px', marginRight: '2px' }} />
                    <text className={cls('city-rate')}>{c.rating}</text>
                    <text className={cls('city-visited')}>· {c.visitedText}</text>
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
            <view
              className={cls('section-more-row')}
              bindtap={() => setWeeklyIndex((i) => i + 1)}
            >
              <text className={cls('section-more')}>换一批</text>
              <image src={svgIcon('refresh', '#A5B2C7')} style={{ width: '13px', height: '13px' }} />
            </view>
          </view>

          <view className={cls('weekly')} bindtap={() => weekly && onGuide(weekly.id)}>
            <image src={cover(weekly?.coverImage ?? 'chengdu')} mode="aspectFill" style={{ width: '96px', height: '76px', borderRadius: '12px' }} />
            <view className={cls('weekly-main')}>
              <text className={cls('weekly-title')}>{weekly?.title ?? '还没有精选攻略'}</text>
              <view className={cls('weekly-tags')}>
                {(weekly?.tags ?? []).map((t) => (
                  <view key={t} className={cls('weekly-tag')}>
                    <text className={cls('weekly-tag-text')}>{t}</text>
                  </view>
                ))}
              </view>
              <text className={cls('weekly-desc')}>{weekly?.note ?? ''}</text>
            </view>
            <view className={cls('weekly-go')}>
              <image src={svgIcon('chevronRight', '#8A99B3')} style={{ width: '13px', height: '13px' }} />
            </view>
          </view>

          <view className={cls('section-head')}>
            <view className={cls('sec-title-row')}>
              <image src={QICON.backpack} mode="aspectFit" style={{ width: '16px', height: '16px', marginRight: '5px' }} />
              <text className={cls('section-title')}>爆款玩法</text>
            </view>
            <view className={cls('section-more-row')} bindtap={() => plays[0] && onPlay(plays[0].id)}>
              <text className={cls('section-more')}>更多玩法</text>
              <image src={svgIcon('chevronRight', '#A5B2C7')} style={{ width: '12px', height: '12px', marginLeft: '2px' }} />
            </view>
          </view>
          <view className={cls('play-row')}>
            {plays.map((p, i) => (
              <view
                key={p.id}
                className={cls(i === plays.length - 1 ? 'play-card play-last' : 'play-card')}
                bindtap={() => onPlay(p.id)}
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
            <view className={cls('section-more-row')} bindtap={onAllGuides}>
              <text className={cls('section-more')}>查看更多</text>
              <image src={svgIcon('chevronRight', '#A5B2C7')} style={{ width: '12px', height: '12px', marginLeft: '2px' }} />
            </view>
          </view>
          <view className={cls('guide-row')}>
            {topGuides.map((g, i) => (
              <view
                key={g.id}
                className={cls(i === topGuides.length - 1 ? 'guide-card guide-last' : 'guide-card')}
                bindtap={() => onGuide(g.id)}
              >
                <image src={cover(g.coverImage)} mode="aspectFill" style={{ width: '100%', height: '82px' }} />
                <text className={cls('guide-title')}>{g.title}</text>
                <text className={cls('guide-note')}>{g.note}</text>
                <view className={cls('guide-views-row')}>
                  <image src={QICON.eye} mode="aspectFit" style={{ width: '10px', height: '10px', marginRight: '3px' }} />
                  <text className={cls('guide-views')}>{fmtViews(g.views)}</text>
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
          <image src={svgIcon('pin', '#2478F2')} style={{ width: '14px', height: '14px', marginRight: '5px' }} />
          <text className={cls('loc-city')}>{city}</text>
        </view>
        <view className={cls('loc-tools')}>
          {/* 搜索入口：本期唯一能搜的是城市，直接进城市页那个真搜索框，别再开到规划弹窗 */}
          <view className={cls('loc-scan')} bindtap={onPickCity}>
            <image src={svgIcon('search', '#1B4F8F')} style={{ width: '20px', height: '20px' }} />
          </view>
        </view>
      </view>
    </view>
  );
}
