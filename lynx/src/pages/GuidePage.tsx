import { useCallback, useMemo, useState } from '@lynx-js/react';

import mascotCheckin from '../assets/ip/mascot-checkin.png';
import { MOCK } from '../mock.js';
import { factsOf } from '../data.js';

type Props = {
  city: string;
};

// 设计稿的分类名 → facts.swift 里的原始分类（facts 只有这四类）
const CATEGORIES: { label: string; value: string }[] = [
  { label: '全部', value: '全部' },
  { label: '门票预约', value: '预约与门票' },
  { label: '交通与路线', value: '交通与路线' },
  { label: '天气与人流', value: '天气与人流' },
  { label: '价格与消费', value: '额外消费' },
];

const LEVEL: Record<string, { text: string; cls: string }> = {
  official: { text: '重要', cls: 'lv-important' },
  credible: { text: '正常', cls: 'lv-normal' },
  experience: { text: '提醒', cls: 'lv-warn' },
  pending: { text: '待核实', cls: 'lv-pending' },
};

const TRUST_LABEL: Record<string, string> = {
  official: '官方信息',
  credible: '权威可核',
  experience: '用户经验',
  pending: '待核实',
};

export function GuidePage({ city }: Props) {
  const [category, setCategory] = useState<string>('全部');
  const list = useMemo(() => {
    const all = factsOf(city);
    return category === '全部' ? all : all.filter((f) => f.category === category);
  }, [city, category]);

  const onPick = useCallback((c: string) => setCategory(c), []);

  return (
    <scroll-view className="scroll" scroll-y>
      <view className="page">
        <view className="map-head">
          <text className="map-city">避坑指南 · {city}</text>
          <text className="section-more">只展示未过期条目</text>
        </view>

        <scroll-view className="cat-scroll" scroll-x>
          <view className="cat-row">
            {CATEGORIES.map((c) => (
              <view
                key={c.value}
                className={c.value === category ? 'chip chip-on' : 'chip'}
                bindtap={() => onPick(c.value)}
              >
                <text className={c.value === category ? 'chip-text chip-text-on' : 'chip-text'}>{c.label}</text>
              </view>
            ))}
          </view>
        </scroll-view>

        {list.length === 0 ? (
          <view className="card">
            <text className="card-title">这类暂无有效条目</text>
            <text className="card-note">
              A2 规则是过期内容默认不展示；{city} 这一类目前没有未过期的已核验信息，不编造。
            </text>
          </view>
        ) : (
          list.map((f) => (
            <view key={f.id} className="card">
              <view className="fact-head">
                <view className="fact-cat-row">
                  <view className={['fact-cat-badge', LEVEL[f.trust]?.cls ?? ''].join(' ')}>
                    <text className="fact-cat-text">{LEVEL[f.trust]?.text ?? '待核实'}</text>
                  </view>
                  <text className="fact-cat">{f.category}</text>
                </view>
                <text className="fact-trust">{TRUST_LABEL[f.trust] ?? f.trust}</text>
              </view>
              <text className="fact-content">{f.content}</text>
              <text className="fact-scope">{f.scope}</text>
              <view className="fact-foot">
                <text className="fact-meta">来源：{f.source}</text>
                <text className="fact-meta">核验 {f.verifiedAt}</text>
              </view>
              {f.validUntil ? (
                <text className="fact-meta">有效期至 {f.validUntil}</text>
              ) : (
                <text className="fact-meta">未标注有效期</text>
              )}
            </view>
          ))
        )}

        <view className="guid-banner">
          <text className="guide-banner-text">{MOCK.guideBanner}</text>
        </view>

        <view className="guide-foot">
          <text className="map-note guide-foot-note">
            反馈入口（我也遇到了 / 不适用）需要后端计数接口，原生端还没接，先不展示。
          </text>
          <image
            src={mascotCheckin}
            mode="aspectFit"
            style={{ width: '56px', height: '64px' }}
          />
        </view>
      </view>
    </scroll-view>
  );
}
