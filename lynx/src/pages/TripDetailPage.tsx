import btnBack from '../assets/ui/btn-back.png';
import btnShare from '../assets/ui/btn-share.png';
import { useState } from '@lynx-js/react';

import heroImg from '../assets/gen/hero.jpg';
import chengdu from '../assets/gen/chengdu.jpg';
import { MOCK } from '../mock.js';
import { svgIcon } from '../icons.js';
import type { Demand, Plan } from '../data.js';

type Props = {
  demand: Demand;
  plans: Plan[];
  onBack: () => void;
  onNavigate: () => void;
  onEdit: () => void;
};

/** 行程详情：概览 + 每天的摘要，设计稿第 6 屏 */
export function TripDetailPage({ demand, plans, onBack, onNavigate, onEdit }: Props) {
  const [dayIdx, setDayIdx] = useState(0);
  const plan = plans[0];

  return (
    <view className="screen-inner">
      <scroll-view className="scroll" scroll-y>
        <view className="page">
          <view className="page-head">
            <image src={btnBack} mode="aspectFit" style={{ width: '28px', height: '28px' }} bindtap={onBack} />
            <text className="page-sub-head">行程详情</text>
            <image src={btnShare} mode="aspectFit" style={{ width: '26px', height: '26px' }} />
          </view>

          <view className="detail-hero">
            <image
              src={heroImg}
              mode="aspectFill"
              style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }}
            />
            <view className="detail-hero-mask" />
            <view className="detail-hero-in">
              <text className="detail-title">{MOCK.trip.title}</text>
              <view className="tag-row">
                {MOCK.trip.style.map((t) => (
                  <text key={t} className="tag tag-inverse">{t}</text>
                ))}
                <text className="tag tag-inverse">编辑</text>
              </view>
            </view>
          </view>

          <view className="card meta-card">
            {MOCK.tripDetail.meta.map((m) => (
              <view key={m.label} className="meta-item">
                <svg content={svgIcon(m.icon, '#2478F2')} style={{ width: '18px', height: '18px', marginBottom: '4px' }} />
                <text className="meta-value">{m.label}</text>
                <text className="meta-note">{m.note}</text>
              </view>
            ))}
          </view>

          <view className="section-head">
            <text className="section-title">行程概览</text>
            <text className="section-more">共 {MOCK.tripDetail.daySummaries.length} 天</text>
          </view>

          <view className="day-tabs">
            {MOCK.days.map((d, i) => (
              <view
                key={d.index}
                className={i === dayIdx ? 'day-tab day-tab-card-on' : 'day-tab day-tab-card'}
                bindtap={() => setDayIdx(i)}
              >
                <text className={i === dayIdx ? 'day-tab-text on' : 'day-tab-text'}>{d.date}</text>
              </view>
            ))}
          </view>

          <view className="card">
            <view className="summary-row">
              <text className="summary-day">Day {dayIdx + 1}</text>
              <view className="summary-main">
                <text className="summary-title">{MOCK.tripDetail.daySummaries[dayIdx].title}</text>
                <text className="summary-meta">
                  {MOCK.tripDetail.daySummaries[dayIdx].price} · {MOCK.tripDetail.daySummaries[dayIdx].duration}
                </text>
              </view>
              <image
                src={chengdu}
                mode="aspectFill"
                style={{ width: '52px', height: '52px', borderRadius: '10px' }}
              />
            </view>
          </view>

          <view className="card">
            <text className="card-title">费用统计</text>
            {plan ? (
              <>
                <view className="budget-row">
                  <text className="budget-label">合计（{demand.party} 人）</text>
                  <text className="budget-amount">¥{plan.budget.total}</text>
                </view>
                <view className="budget-row">
                  <text className="budget-label">人均</text>
                  <text className="budget-amount">¥{plan.budget.perPerson}</text>
                </view>
                <text className="card-note">{plan.budget.uncertain[0] ?? ''}</text>
              </>
            ) : (
              <text className="card-note">还没有方案金额，先规划一次。</text>
            )}
          </view>

          <text className="mock-note">行程概览与费用摘要沿用设计稿示例数据（mock）</text>
        </view>
      </scroll-view>

      <view className="bottom-bar">
        <view className="btn-ghost" bindtap={onEdit}>
          <text className="btn-ghost-text">编辑行程</text>
        </view>
        <view className="btn-primary btn-primary-grow" bindtap={onNavigate}>
          <text className="btn-primary-text">开始导航</text>
        </view>
      </view>
    </view>
  );
}
