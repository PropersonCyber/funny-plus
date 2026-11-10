import { useState } from '@lynx-js/react';

import heroImg from '../../assets/gen/hero.jpg';
import chengdu from '../../assets/gen/chengdu.jpg';
import { svgIcon } from '../../icons.js';
import type { Demand, Plan } from '../../data.js';
import styles from './index.module.scss';
import { makeCls } from '../../styles/cls.js';

const cls = makeCls(styles);

type Props = {
  demand: Demand;
  plans: Plan[];
  /** 跟行程页同一套：详情页看到的必须就是用户选中的那套方案 */
  planIndex: number;
  /** 变更记录；空数组表示这趟还没改过 */
  versions: readonly { at: string; note: string }[];
  onBack: () => void;
  onNavigate: () => void;
  onEdit: () => void;
};

/** 行程详情：概览 + 每天的摘要，设计稿第 6 屏 */
export function TripDetailPage({ demand, plans, planIndex, versions, onBack, onNavigate, onEdit }: Props) {
  const [dayIdx, setDayIdx] = useState(0);
  const plan = plans[Math.min(planIndex, plans.length - 1)] ?? plans[0];
  // 日期只有 mock 一份，天数以真实行程为准：写死 3 天时 1 天行程也能点出第 3 天
  const dayCount = plan?.days.length ?? 1;

  return (
    <view className={cls('screen-inner')}>
      <scroll-view className={cls('scroll')} scroll-y>
        <view className={cls('page')}>
          <view className={cls('page-head')}>
            <view className={cls('icon-btn')} bindtap={onBack}>
              <image src={svgIcon('chevronLeft', '#2A3A57')} style={{ width: '18px', height: '18px' }} />
            </view>
            <text className={cls('page-sub-head')}>行程详情</text>
            <view className={cls('icon-btn')} />
          </view>

          <view className={cls('detail-hero')}>
            <image
              src={heroImg}
              mode="aspectFill"
              style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }}
            />
            <view className={cls('detail-hero-mask')} />
            <view className={cls('detail-hero-in')}>
              <text className={cls('detail-title')}>{demand.destination} · {dayCount} 天</text>
              <view className={cls('tag-row')}>
                {(plan?.highlights ?? []).slice(0, 3).map((t) => (
                  <text key={t} className={cls('tag tag-inverse')}>{t}</text>
                ))}
                <text className={cls('tag tag-inverse')} bindtap={onEdit}>编辑</text>
              </view>
            </view>
          </view>

          <view className={cls('card meta-card')}>
            {/* 三格 meta 以前是固定 mock（2 人 / ¥3000 / 高铁+公交），跟真实方案对不上就成假数据 */}
            {metaOf(demand, plan).map((m) => (
              <view key={m.label} className={cls('meta-item')}>
                <image src={svgIcon(m.icon, '#2478F2')} style={{ width: '18px', height: '18px', marginBottom: '4px' }} />
                <text className={cls('meta-value')}>{m.label}</text>
                <text className={cls('meta-note')}>{m.note}</text>
              </view>
            ))}
          </view>

          <view className={cls('section-head')}>
            <text className={cls('section-title')}>行程概览</text>
            <text className={cls('section-more')}>共 {dayCount} 天</text>
          </view>

          <view className={cls('day-tabs')}>
            {plan?.days.map((d, i) => (
              <view
                key={d.index}
                className={cls(i === dayIdx ? 'day-tab day-tab-card-on' : 'day-tab day-tab-card')}
                bindtap={() => setDayIdx(i)}
              >
                <text className={cls(i === dayIdx ? 'day-tab-text on' : 'day-tab-text')}>Day {d.index}</text>
              </view>
            ))}
          </view>

          {/* 每日摘要改成按真实方案渲染：以前读的是设计稿那三天的固定文案，换城市/换天数都对不上 */}
          <view className={cls('card')}>
            {plan ? (
              plan.days.map((d) => (
                <view key={d.index} className={cls('summary-row')}>
                  <text className={cls('summary-day')}>Day {d.index}</text>
                  <view className={cls('summary-main')}>
                    <text className={cls('summary-title')}>{dayTitle(d)}</text>
                    <text className={cls('summary-meta')}>
                      {dayCost(d)} · {dayDuration(d)}
                    </text>
                  </view>
                  <image
                    src={chengdu}
                    mode="aspectFill"
                    style={{ width: '52px', height: '52px', borderRadius: '10px' }}
                  />
                </view>
              ))
            ) : (
              <text className={cls('card-note')}>还没有方案，先规划一次。</text>
            )}
          </view>
          {versions.length > 0 ? (
            <view className={cls('card')}>
              <text className={cls('card-title')}>变更记录</text>
              {versions
                .slice()
                .reverse()
                .map((v) => (
                  <view key={`${v.at}-${v.note}`} className={cls('budget-row')}>
                    <text className={cls('budget-label')}>{v.note}</text>
                    <text className={cls('budget-label')}>{v.at.slice(5, 16).replace('T', ' ')}</text>
                  </view>
                ))}
            </view>
          ) : null}

          <text className={cls('mock-note')}>封面插画为设计稿资源；门票与开放时间来自地点收录，状态见行程页</text>

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

        </view>
      </scroll-view>

      <view className={cls('bottom-bar')}>
        <view className={cls('btn-ghost')} bindtap={onEdit}>
          <text className={cls('btn-ghost-text')}>重新规划</text>
        </view>
        <view className={cls('btn-primary btn-primary-grow')} bindtap={onNavigate}>
          <text className={cls('btn-primary-text')}>查看路线图</text>
        </view>
      </view>
    </view>
  );
}

/** 顶栏三格：人数 / 人均预算 / 交通方式，全部取真实需求与方案 */
function metaOf(demand: Demand, plan: Plan | undefined) {
  const mode: Record<string, string> = { public: '公共交通', car: '自驾', charter: '包车', compare: '待比较' };
  return [
    { icon: 'profile' as const, label: `${demand.party} 人`, note: '同行人数' },
    { icon: 'budget' as const, label: plan ? `¥${plan.budget.perPerson}/人` : '—', note: '人均（方案合计）' },
    { icon: 'transport' as const, label: mode[plan?.transport ?? demand.transport] ?? '—', note: '市内交通' },
  ];
}

const dayPlaces = (day: Plan['days'][number]) => day.items.filter((i) => i.kind === 'place');

const dayTitle = (day: Plan['days'][number]): string => {
  const names = dayPlaces(day).map((i) => i.title);
  return names.length ? names.join(' · ') : '这一天没有安排';
};

/** 当天门票人均，和预算里的 ¥ 口径一致（园区/场馆的公示价） */
const dayCost = (day: Plan['days'][number]): string => `¥${dayPlaces(day).reduce((s, i) => s + i.cost, 0)}/人`;

const dayDuration = (day: Plan['days'][number]): string => {
  if (!day.items.length) return '0 小时';
  const from = day.items[0].startMin;
  const to = day.items[day.items.length - 1].endMin;
  const min = to - from;
  return `${Math.floor(min / 60)} 小时${min % 60 ? ` ${min % 60} 分` : ''}`;
};

