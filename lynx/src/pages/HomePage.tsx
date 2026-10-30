import { useCallback } from '@lynx-js/react';

import heroImg from '../assets/gen/hero.jpg';
import chengdu from '../assets/gen/chengdu.jpg';
import chongqing from '../assets/gen/chongqing.jpg';
import dali from '../assets/gen/dali.jpg';
import btnChat from '../assets/ui/btn-chat.png';
import { svgIcon, COLOR } from '../icons.js';
import { filledIcon } from '../icons-filled.js';
import { MOCK } from '../mock.js';

type Props = {
  onPlan: () => void;
  onTab: (tab: 'map' | 'itinerary' | 'guide' | 'profile') => void;
  onAdvice: () => void;
  onAssistant: () => void;
};

const CITY_IMG: Record<string, string> = { chengdu, chongqing, dali };

const QUICK = [
  { id: 'city', title: '热门目的地', glyph: 'pin', color: '#F5A03C', tint: 'rgba(245,160,60,0.14)' },
  { id: 'map', title: '动漫地图', glyph: 'mapBlock', color: '#2478F2', tint: 'rgba(36,120,242,0.12)' },
  { id: 'guide', title: '避坑指南', glyph: 'shield', color: '#35C08A', tint: 'rgba(53,192,138,0.14)' },
  { id: 'advice', title: '智能建议', glyph: 'sparkle', color: '#8B7CFF', tint: 'rgba(139,124,255,0.14)' },
] as const;

export function HomePage({ onPlan, onTab, onAdvice, onAssistant }: Props) {
  const onQuick = useCallback(
    (id: string) => {
      if (id === 'map') onTab('map');
      else if (id === 'guide') onTab('guide');
      else if (id === 'advice') onAdvice();
      else onPlan();
    },
    [onPlan, onTab, onAdvice],
  );

  return (
    <scroll-view className="scroll" scroll-y>
      <view className="home">
        <view className="home-sky" />

        <view className="home-in">
          <view className="searchbar" bindtap={onPlan}>
            <svg content={svgIcon('search', COLOR.idle)} style={{ width: '17px', height: '17px', marginRight: '8px' }} />
            <text className="searchbar-text">搜索目的地、景点、攻略…</text>
            <svg content={svgIcon('scan', '#3F5980')} style={{ width: '21px', height: '21px' }} />
          </view>

          <view className="hero">
            <image
              src={heroImg}
              mode="aspectFill"
              style={{ position: 'absolute', left: 0, top: 0, width: '370px', height: '212px', transform: 'scaleX(-1)' }}
            />
          </view>

          <view className="ai-card" bindtap={onPlan}>
            <view className="ai-icon-box">
              <svg content={filledIcon('sparkle', '#FFFFFF')} style={{ width: '20px', height: '20px' }} />
            </view>
            <view className="ai-text">
              <text className="ai-title">AI 规划你的专属旅行</text>
              <text className="ai-sub">告诉我想法，生成个性化行程</text>
            </view>
            <text className="ai-chevron">›</text>
          </view>

          <view className="quick-card">
            {QUICK.map((q) => (
              <view key={q.id} className="quick-item" bindtap={() => onQuick(q.id)}>
                <view className="quick-icon-box" style={{ backgroundColor: q.tint }}>
                  <svg content={filledIcon(q.glyph, q.color)} style={{ width: '26px', height: '26px' }} />
                </view>
                <text className="quick-title">{q.title}</text>
              </view>
            ))}
          </view>

          <view className="section-head">
            <text className="section-title">热门推荐</text>
            <text className="section-more">查看更多</text>
          </view>

          <view className="city-row">
            {MOCK.cities.map((c) => (
              <view key={c.id} className="city-card" bindtap={onPlan}>
                <image
                  src={CITY_IMG[c.image]}
                  mode="aspectFill"
                  style={{ width: '100%', height: '104px' }}
                />
                <view className="city-body">
                  <text className="city-name">{c.id}</text>
                  <text className="city-tag">{c.tag}</text>
                  <text className="city-price">{c.price}</text>
                </view>
              </view>
            ))}
          </view>
        </view>

        <image
          src={btnChat}
          mode="aspectFit"
          style={{ position: 'absolute', right: '18px', bottom: '16px', width: '52px', height: '52px' }}
          bindtap={onAssistant}
        />
      </view>
    </scroll-view>
  );
}
