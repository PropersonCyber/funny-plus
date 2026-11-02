import { useState } from '@lynx-js/react';

import heroImg from '../../assets/gen/hero.jpg';
import chengdu from '../../assets/gen/chengdu.jpg';
import { MOCK } from '../../mock.js';
import { svgIcon } from '../../icons.js';
import type { Demand, Plan } from '../../data.js';
import styles from './index.module.scss';
import { makeCls } from '../../styles/cls.js';

const cls = makeCls(styles);

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
    <view className={cls('screen-inner')}>
      <scroll-view className={cls('scroll')} scroll-y>
        <view className={cls('page')}>
          <view className={cls('page-head')}>
            <view className={cls('icon-btn')} bindtap={onBack}>
              <svg content={svgIcon('chevronLeft', '#2A3A57')} style={{ width: '18px', height: '18px' }} />
            </view>
            <text className={cls('page-sub-head')}>行程详情</text>
            <view className={cls('icon-btn')}>
              <svg content={svgIcon('share', '#2A3A57')} style={{ width: '17px', height: '17px' }} />
            </view>
          </view>

          <view className={cls('detail-hero')}>
            <image
              src={heroImg}
              mode="aspectFill"
              style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }}
            />
            <view className={cls('detail-hero-mask')} />
            <view className={cls('detail-hero-in')}>
              <text className={cls('detail-title')}>{MOCK.trip.title}</text>
              <view className={cls('tag-row')}>
                {MOCK.trip.style.map((t) => (
                  <text key={t} className={cls('tag tag-inverse')}>{t}</text>
                ))}
                <text className={cls('tag tag-inverse')}>编辑</text>
              </view>
            </view>
          </view>

          <view className={cls('card meta-card')}>
            {MOCK.tripDetail.meta.map((m) => (
              <view key={m.label} className={cls('meta-item')}>
                <svg content={svgIcon(m.icon, '#2478F2')} style={{ width: '18px', height: '18px', marginBottom: '4px' }} />
                <text className={cls('meta-value')}>{m.label}</text>
                <text className={cls('meta-note')}>{m.note}</text>
              </view>
            ))}
          </view>

          <view className={cls('section-head')}>
            <text className={cls('section-title')}>行程概览</text>
            <text className={cls('section-more')}>共 {MOCK.tripDetail.daySummaries.length} 天</text>
          </view>

          <view className={cls('day-tabs')}>
            {MOCK.days.map((d, i) => (
              <view
                key={d.index}
                className={cls(i === dayIdx ? 'day-tab day-tab-card-on' : 'day-tab day-tab-card')}
                bindtap={() => setDayIdx(i)}
              >
                <text className={cls(i === dayIdx ? 'day-tab-text on' : 'day-tab-text')}>{d.date}</text>
              </view>
            ))}
          </view>

          <view className={cls('card')}>
            <view className={cls('summary-row')}>
              <text className={cls('summary-day')}>Day {dayIdx + 1}</text>
              <view className={cls('summary-main')}>
                <text className={cls('summary-title')}>{MOCK.tripDetail.daySummaries[dayIdx].title}</text>
                <text className={cls('summary-meta')}>
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

          <view className={cls('card')}>
            <text className={cls('card-title')}>费用统计</text>
            {plan ? (
              <>
                <view className={cls('budget-row')}>
                  <text className={cls('budget-label')}>合计（{demand.party} 人）</text>
                  <text className={cls('budget-amount')}>¥{plan.budget.total}</text>
                </view>
                <view className={cls('budget-row')}>
                  <text className={cls('budget-label')}>人均</text>
                  <text className={cls('budget-amount')}>¥{plan.budget.perPerson}</text>
                </view>
                <text className={cls('card-note')}>{plan.budget.uncertain[0] ?? ''}</text>
              </>
            ) : (
              <text className={cls('card-note')}>还没有方案金额，先规划一次。</text>
            )}
          </view>

          <text className={cls('mock-note')}>行程概览与费用摘要沿用设计稿示例数据（mock）</text>
        </view>
      </scroll-view>

      <view className={cls('bottom-bar')}>
        <view className={cls('btn-ghost')} bindtap={onEdit}>
          <text className={cls('btn-ghost-text')}>重新规划</text>
        </view>
        <view className={cls('btn-primary btn-primary-grow')} bindtap={onNavigate}>
          <text className={cls('btn-primary-text')}>开始导航</text>
        </view>
      </view>
    </view>
  );
}
