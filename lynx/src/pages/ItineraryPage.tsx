import { useCallback, useState } from '@lynx-js/react';

import chengdu from '../assets/gen/chengdu.jpg';
import chongqing from '../assets/gen/chongqing.jpg';
import spotKuanzhai from '../assets/gen/spot-kuanzhai.jpg';
import spotWuhou from '../assets/gen/spot-wuhou.jpg';
import spotPanda from '../assets/gen/panda.jpg';
import spotJinli from '../assets/gen/jinli.jpg';
import spotChunxi from '../assets/gen/chunxi.jpg';
import { MOCK } from '../mock.js';
import type { Demand, Plan } from '../data.js';

type Props = {
  demand: Demand;
  plans: Plan[];
  onPlan: () => void;
  onMap: () => void;
  onDetail: () => void;
};

const CITY_IMG: Record<string, string> = { 成都: chengdu, 重庆: chongqing };

// 有专属插画的景点用专属图，其它退回城市图
const SPOT_IMG: Record<string, string> = {
  宽窄巷子: spotKuanzhai,
  武侯祠: spotWuhou,
  大熊猫繁育研究基地: spotPanda,
  锦里: spotJinli,
  太古里: spotChunxi,
  人民公园: spotChunxi,
};

export function ItineraryPage({ demand, plans, onPlan, onMap, onDetail }: Props) {
  const [planIndex, setPlanIndex] = useState(0);
  const [dayIndex, setDayIndex] = useState(1);

  const onPickPlan = useCallback((i: number) => {
    setPlanIndex(i);
    setDayIndex(1);
  }, []);

  if (plans.length === 0) {
    return (
      <view className="page">
        <view className="card">
          <text className="card-title">还没有行程</text>
          <text className="card-note">点首页「AI 规划你的专属旅行」，填完需求就会出现在这里。</text>
          <view className="btn-primary" bindtap={onPlan}>
            <text className="btn-primary-text">开始规划</text>
          </view>
        </view>
      </view>
    );
  }

  const plan = plans[planIndex] ?? plans[0];
  const day = plan.days.find((d) => d.index === dayIndex) ?? plan.days[0];
  const cityCover = CITY_IMG[demand.destination] ?? chengdu;
  const meta = MOCK.days.find((d) => d.index === dayIndex);

  return (
    <view className="screen-inner">
      <scroll-view className="scroll" scroll-y>
        <view className="page">
          <view className="page-head">
            <text className="page-title">{demand.destination} · {demand.dayCount} 天{demand.dayCount > 1 ? '2 晚' : ''}</text>
            <text className="section-more" bindtap={onDetail}>详情 ›</text>
          </view>
          <text className="page-sub">
            {MOCK.trip.dateRange} · {demand.party} 人 · 人均 ¥{plan.budget.perPerson}
          </text>

          {plans.length > 1 ? (
            <view className="chips">
              {plans.map((p, i) => (
                <view
                  key={p.id}
                  className={i === planIndex ? 'chip chip-on' : 'chip'}
                  bindtap={() => onPickPlan(i)}
                >
                  <text className={i === planIndex ? 'chip-text chip-text-on' : 'chip-text'}>{p.paceLabel}</text>
                </view>
              ))}
            </view>
          ) : null}

          <view className="day-tabs">
            {plan.days.map((d) => {
              const m = MOCK.days.find((x) => x.index === d.index);
              return (
                <view
                  key={d.index}
                  className={d.index === dayIndex ? 'day-tab day-tab-card-on' : 'day-tab day-tab-card'}
                  bindtap={() => setDayIndex(d.index)}
                >
                  <text className={d.index === dayIndex ? 'day-tab-text on' : 'day-tab-text'}>Day {d.index}</text>
                  <text className={d.index === dayIndex ? 'day-tab-date on' : 'day-tab-date'}>{m?.date ?? ''}</text>
                </view>
              );
            })}
          </view>

          <view className="timeline">
            {/* 设计稿首行是「抵达 · 酒店入住」，引擎不产生这类条目，按 mock 补一条展示 */}
            {dayIndex === 1 ? (
              <view className="tl-row">
                <text className="tl-time">08:00</text>
                <view className="tl-rail"><view className="tl-dot tl-dot-arrive" /></view>
                <view className="tl-body">
                  <view className="tl-main">
                    <view className="tl-meal-icon tl-arrive-icon">
                      <text className="tl-meal-text">住</text>
                    </view>
                    <view className="tl-text">
                      <text className="tl-title">{MOCK.tripDetail.arrive.title}</text>
                      <text className="tl-meta">约 {MOCK.tripDetail.arrive.hours} 小时 · ¥{MOCK.tripDetail.arrive.cost}</text>
                    </view>
                  </view>
                </view>
              </view>
            ) : null}
            {day.items.map((item) => (
              <view key={item.id} className="tl-row">
                <text className="tl-time">{clock(item.startMin)}</text>
                <view className="tl-rail">
                  <view className={item.kind === 'meal' ? 'tl-dot tl-dot-meal' : 'tl-dot'} />
                </view>
                <view className="tl-body">
                  <view className="tl-main">
                    {item.kind === 'place' ? (
                      <image
                        src={SPOT_IMG[item.title] ?? cityCover}
                        mode="aspectFill"
                        style={{ width: '56px', height: '56px', borderRadius: '10px', marginRight: '10px' }}
                      />
                    ) : (
                      <view className="tl-meal-icon">
                        <text className="tl-meal-text">餐</text>
                      </view>
                    )}
                    <view className="tl-text">
                      <text className="tl-title">{item.title}</text>
                      <text className="tl-meta">
                        {item.kind === 'meal' ? `餐` : `立即入园`} · {item.cost > 0 ? `¥${item.cost}` : '免费'} · 约 {Math.round(item.stayMin / 60 * 10) / 10} 小时
                      </text>
                    </view>
                  </view>
                </view>
              </view>
            ))}
          </view>

          <view className="card">
            <text className="card-title">预算依据（{demand.party} 人合计 ¥{plan.budget.total}）</text>
            {plan.budget.items.map((b) => (
              <view key={b.category} className="budget-row">
                <text className="budget-label">{b.basis}</text>
                <text className="budget-amount">¥{b.amount}</text>
              </view>
            ))}
            <text className="card-note">人均 ¥{plan.budget.perPerson}。{plan.budget.uncertain[0] ?? ''}</text>
          </view>

          <text className="mock-note">日期与天气沿用设计稿示例（mock）· 当前位置 {meta?.weekday ?? ''}</text>
        </view>
      </scroll-view>

      <view className="bottom-bar">
        <view className="btn-ghost" bindtap={onMap}>
          <text className="btn-ghost-text">查看地图</text>
        </view>
        <view className="btn-primary btn-primary-grow" bindtap={onPlan}>
          <text className="btn-primary-text">编辑行程</text>
        </view>
      </view>
    </view>
  );
}

function clock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h < 10 ? '0' : ''}${h}:${m < 10 ? '0' : ''}${m}`;
}
