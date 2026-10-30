import btnBack from '../assets/ui/btn-back.png';
import { useCallback } from '@lynx-js/react';

import { svgIcon } from '../icons.js';
import { MOCK } from '../mock.js';
import type { Demand, Plan } from '../data.js';

type Props = {
  demand: Demand;
  plans: Plan[];
  onBack: () => void;
  onPlan: () => void;
};

export function AdvicePage({ demand, plans, onBack, onPlan }: Props) {
  const plan = plans[0];
  const total = plan ? plan.budget.total : 0;

  // 饼图用 SVG 画：按百分比累积 dashoffset
  const donut = (() => {
    let acc = 0;
    const r = 42;
    const c = 2 * Math.PI * r;
    const arcs = MOCK.advice.budgetSplit
      .map((b) => {
        const len = (b.percent / 100) * c;
        const seg = `<circle cx="50" cy="50" r="${r}" fill="none" stroke="${b.color}" stroke-width="16" stroke-dasharray="${len} ${
          c - len
        }" stroke-dashoffset="${-acc}" transform="rotate(-90 50 50)"/>`;
        acc += len;
        return seg;
      })
      .join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${arcs}</svg>`;
  })();

  const onOpen = useCallback(() => onPlan(), [onPlan]);

  return (
    <scroll-view className="scroll" scroll-y>
      <view className="page">
        <view className="page-head">
          <view className="back-btn" bindtap={onBack}>
            <text className="back-text">‹</text>
          </view>
          <text className="page-title">智能建议</text>
          <text className="section-more" bindtap={onBack}>收起 ›</text>
        </view>

        <text className="card-note">基于你的需求，提供专业出行建议</text>

        <view className="card">
          <view className="advice-head">
            <text className="card-title">推荐出行方式</text>
            <text className="badge-soft">更省心</text>
          </view>
          <view className="advice-body">
            <view className="advice-icon">
              <svg content={svgIcon('transport', '#FFFFFF')} style={{ width: '20px', height: '20px' }} />
            </view>
            <view className="advice-main">
              <text className="advice-title">{MOCK.advice.transport.title}</text>
              <text className="advice-price">人均 {MOCK.advice.transport.perPerson}</text>
              <view className="tag-row">
                {MOCK.advice.transport.tags.map((t) => (
                  <text key={t} className="tag">{t}</text>
                ))}
              </view>
            </view>
          </view>
          <text className="card-note">对比：{MOCK.advice.transport.crossPrice}（含打车与地铁换乘）</text>
        </view>

        <view className="card">
          <view className="advice-head">
            <text className="card-title">住宿建议</text>
            <text className="badge-soft">推荐</text>
          </view>
          <text className="advice-title">{MOCK.advice.hotel.title}</text>
          <text className="card-note">{MOCK.advice.hotel.note}</text>
          <view className="tag-row">
            {MOCK.advice.hotel.tags.map((t) => (
              <text key={t} className="tag">{t}</text>
            ))}
          </view>
        </view>

        <view className="card">
          <text className="card-title">预算分配</text>
          <view className="donut-row">
            <svg content={donut} style={{ width: '108px', height: '108px' }} />
            <view className="legend">
              {MOCK.advice.budgetSplit.map((b) => (
                <view key={b.label} className="legend-row">
                  <view className="legend-dot" style={{ backgroundColor: b.color }} />
                  <text className="legend-label">{b.label}</text>
                  <text className="legend-num">{b.percent}%</text>
                </view>
              ))}
            </view>
          </view>
          <text className="card-note">
            {plan
              ? `按当前方案合计 ¥${total}（人均 ¥${plan.budget.perPerson}）的比例展示`
              : '先规划一次行程，这里会按你方案的金额展示'}
          </text>
        </view>

        <view className="card">
          <text className="card-title">人数与预算建议</text>
          <text className="card-note">
            {demand.party} 人出行、人均预算 {demand.budgetLevel === 'low' ? '500 元以内' : demand.budgetLevel === 'mid' ? '500–1000 元' : demand.budgetLevel === 'high' ? '1000–2000 元' : '灵活'}：
            {demand.party >= 4 ? '建议包车，整体更省心。' : '两人走公共交通即可，打车做补充。'}
          </text>
        </view>

        <view className="btn-primary" bindtap={onOpen}>
          <text className="btn-primary-text">重新规划一次</text>
        </view>

        <text className="mock-note">出行方式与预算占比为设计稿示例数据（mock）</text>
      </view>
    </scroll-view>
  );
}
