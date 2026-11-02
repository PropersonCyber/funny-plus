import { useCallback, useState } from '@lynx-js/react';

import { svgIcon } from '../../icons.js';
import { MOCK } from '../../mock.js';
import type { Demand, Plan } from '../../data.js';
import styles from './index.module.scss';
import { makeCls } from '../../styles/cls.js';

const cls = makeCls(styles);

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
  const [tipsOpen, setTipsOpen] = useState(true);
  const closeTips = useCallback(() => setTipsOpen(false), []);

  return (
    <scroll-view className={cls('scroll')} scroll-y>
      <view className={cls('page')}>
        <view className={cls('page-head')}>
          <view className={cls('icon-btn')} bindtap={onBack}>
            <svg content={svgIcon('chevronLeft', '#2A3A57')} style={{ width: '18px', height: '18px' }} />
          </view>
          <text className={cls('page-title')}>智能建议</text>
          <view className={cls('head-link')} bindtap={onBack}>
            <text className={cls('head-link-text')}>收起</text>
            <svg content={svgIcon('chevronRight', '#2478F2')} style={{ width: '13px', height: '13px', marginLeft: '2px' }} />
          </view>
        </view>

        <text className={cls('card-note')}>基于你的需求，提供专业出行建议</text>

        {tipsOpen ? (
          <view className={cls('card')}>
            <view className={cls('advice-head')}>
              <text className={cls('card-title')}>这些值得留意</text>
              <view className={cls('tip-close')} bindtap={closeTips}>
                <text className={cls('tip-close-text')}>×</text>
              </view>
            </view>
            <view className={cls('tip-hl')}>
              <view className={cls('tip-hl-icon')}>
                <svg content={svgIcon('sparkles', '#F5A03C')} style={{ width: '16px', height: '16px' }} />
              </view>
              <view className={cls('tip-hl-main')}>
                <text className={cls('tip-hl-title')}>{MOCK.advice.tips.highlight.title}</text>
                <text className={cls('tip-hl-note')}>{MOCK.advice.tips.highlight.note}</text>
              </view>
            </view>
            {MOCK.advice.tips.items.map((t) => (
              <view key={t} className={cls('tip-row')}>
                <view className={cls('tip-check')}>
                  <svg content={svgIcon('shield', '#20B98A')} style={{ width: '12px', height: '12px' }} />
                </view>
                <text className={cls('tip-text')}>{t}</text>
              </view>
            ))}
          </view>
        ) : null}

        <view className={cls('card')}>
          <view className={cls('advice-head')}>
            <text className={cls('card-title')}>推荐出行方式</text>
            <text className={cls('badge-soft')}>更省心</text>
          </view>
          <view className={cls('advice-body')}>
            <view className={cls('advice-icon')}>
              <svg content={svgIcon('transport', '#FFFFFF')} style={{ width: '20px', height: '20px' }} />
            </view>
            <view className={cls('advice-main')}>
              <text className={cls('advice-title')}>{MOCK.advice.transport.title}</text>
              <text className={cls('advice-price')}>人均 {MOCK.advice.transport.perPerson}</text>
              <view className={cls('tag-row')}>
                {MOCK.advice.transport.tags.map((t) => (
                  <text key={t} className={cls('tag')}>{t}</text>
                ))}
              </view>
            </view>
          </view>
          <text className={cls('card-note')}>对比：{MOCK.advice.transport.crossPrice}（含打车与地铁换乘）</text>
        </view>

        <view className={cls('card')}>
          <view className={cls('advice-head')}>
            <text className={cls('card-title')}>住宿建议</text>
            <text className={cls('badge-soft')}>推荐</text>
          </view>
          <text className={cls('advice-title')}>{MOCK.advice.hotel.title}</text>
          <text className={cls('card-note')}>{MOCK.advice.hotel.note}</text>
          <view className={cls('tag-row')}>
            {MOCK.advice.hotel.tags.map((t) => (
              <text key={t} className={cls('tag')}>{t}</text>
            ))}
          </view>
        </view>

        <view className={cls('card')}>
          <text className={cls('card-title')}>预算分配</text>
          <view className={cls('donut-row')}>
            <svg content={donut} style={{ width: '108px', height: '108px' }} />
            <view className={cls('legend')}>
              {MOCK.advice.budgetSplit.map((b) => (
                <view key={b.label} className={cls('legend-row')}>
                  <view className={cls('legend-dot')} style={{ backgroundColor: b.color }} />
                  <text className={cls('legend-label')}>{b.label}</text>
                  <text className={cls('legend-num')}>{b.percent}%</text>
                </view>
              ))}
            </view>
          </view>
          <text className={cls('card-note')}>
            {plan
              ? `按当前方案合计 ¥${total}（人均 ¥${plan.budget.perPerson}）的比例展示`
              : '先规划一次行程，这里会按你方案的金额展示'}
          </text>
        </view>

        <view className={cls('card')}>
          <text className={cls('card-title')}>人数与预算建议</text>
          <text className={cls('card-note')}>
            {demand.party} 人出行、人均预算 {demand.budgetLevel === 'low' ? '500 元以内' : demand.budgetLevel === 'mid' ? '500–1000 元' : demand.budgetLevel === 'high' ? '1000–2000 元' : '灵活'}：
            {demand.party >= 4 ? '建议包车，整体更省心。' : '两人走公共交通即可，打车做补充。'}
          </text>
        </view>

        <view className={cls('btn-primary')} bindtap={onOpen}>
          <text className={cls('btn-primary-text')}>重新规划一次</text>
        </view>

        <text className={cls('mock-note')}>出行方式与预算占比为设计稿示例数据（mock）</text>
      </view>
    </scroll-view>
  );
}
