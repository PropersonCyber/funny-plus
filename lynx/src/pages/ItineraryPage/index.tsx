import { useCallback, useState } from '@lynx-js/react';
import { trustLabel } from '../../../../shared/engine/facts.js';

import chengdu from '../../assets/gen/chengdu.jpg';
import chongqing from '../../assets/gen/chongqing.jpg';
import beijing from '../../assets/gen/beijing.jpg';
import { spotImg } from '../../spot-img.js';
import { svgIcon } from '../../icons.js';
import type { ChangeImpact, Demand, Plan } from '../../data.js';
import { placeById } from '../../data.js';
import { ReviseSheet } from '../ReviseSheet/index.js';
import { CompareSheet } from '../CompareSheet/index.js';
import { track } from '../../track.js';
import styles from './index.module.scss';
import { makeCls } from '../../styles/cls.js';
import { ticketText } from '../../ticketText.js';

const cls = makeCls(styles);

type Props = {
  demand: Demand;
  plans: Plan[];
  /** 当前选中方案由上层持有：详情页/地图/我的看到的是同一套 */
  planIndex: number;
  onPickPlan: (index: number) => void;
  onPlan: () => void;
  onMap: () => void;
  onDetail: () => void;
  onRevise: (planIndex: number, plan: Plan, impact: ChangeImpact) => void;
  /** 上一次局部修改的变更影响；切天不消失，方便对照 */
  impact: ChangeImpact | null;
  onDismissImpact: () => void;
};

const CITY_IMG: Record<string, string> = { 成都: chengdu, 重庆: chongqing, 北京: beijing };

// 校验结果分三档，error 是用户必须改的，info 只是「数据没核验过」
const ISSUE_ORDER: Record<string, number> = { error: 0, warn: 1, info: 2 };
const ISSUE_LABEL: Record<string, string> = { error: '冲突', warn: '注意', info: '待确认' };
const ISSUE_CLASS: Record<string, string> = {
  error: 'issue-badge issue-badge-error',
  warn: 'issue-badge issue-badge-warn',
  info: 'issue-badge issue-badge-info',
};

// 有专属插画的景点用专属图，其它退回城市图（映射在 spot-img.ts，攻略页也用同一份）

export function ItineraryPage({
  demand,
  plans,
  planIndex,
  onPickPlan,
  onPlan,
  onMap,
  onDetail,
  onRevise,
  impact,
  onDismissImpact,
}: Props) {
  const [dayIndex, setDayIndex] = useState(1);
  const [revising, setRevising] = useState(false);
  const [comparing, setComparing] = useState(false);

  const pickPlan = useCallback(
    (i: number) => {
      onPickPlan(i);
      // 换方案后天数可能变少，停在越界的天上会渲染成空白
      setDayIndex(1);
    },
    [onPickPlan]
  );

  if (plans.length === 0) {
    return (
      <view className={cls('page')}>
        <view className={cls('card')}>
          <text className={cls('card-title')}>还没有行程</text>
          <text className={cls('card-note')}>点首页「AI 规划你的专属旅行」，填完需求就会出现在这里。</text>
          <view className={cls('btn-primary')} bindtap={onPlan}>
            <text className={cls('btn-primary-text')}>开始规划</text>
          </view>
        </view>
      </view>
    );
  }

  const plan = plans[planIndex] ?? plans[0];
  const day = plan.days.find((d) => d.index === dayIndex) ?? plan.days[0];
  // 按天核过的看当天；跨天的（超预算、大团核载）每天都该看到
  const dayIssues = plan.issues
    .filter((i) => i.dayIndex === undefined || i.dayIndex === dayIndex)
    .sort((a, b) => ISSUE_ORDER[a.level] - ISSUE_ORDER[b.level]);
  const cityCover = CITY_IMG[demand.destination] ?? chengdu;

  return (
    <view className={cls('screen-inner')}>
      <view className={cls('page page-shell itn-page')}>
        <view className={cls('page-head')}>
          <text className={cls('page-title')}>
            {demand.destination} · {plan.days.length} 天{plan.days.length > 1 ? `${plan.days.length - 1} 晚` : ''}
          </text>
          <view className={cls('head-links')}>
            {plans.length > 1 ? (
              <text
                className={cls('head-link-text head-compare')}
                bindtap={() => {
                  setComparing(true);
                  track('compare_open', { plans: plans.length });
                }}
              >
                对比
              </text>
            ) : null}
            <view className={cls('head-link')} bindtap={onDetail}>
              <text className={cls('head-link-text')}>详情</text>
              <image src={svgIcon('chevronRight', '#2478F2')} style={{ width: '13px', height: '13px', marginLeft: '2px' }} />
            </view>
          </view>
        </view>
        {/* 日期是设计稿示例，不能跟真实预算数字并排放在同一行冒充数据 */}
        <text className={cls('page-sub')}>
          {demand.party} 人 · 人均 ¥{plan.budget.perPerson} · 合计 ¥{plan.budget.total}
        </text>

        {plans.length > 1 ? (
          <view className={cls('chips')}>
            {plans.map((p, i) => (
              <view
                key={p.id}
                className={cls(i === planIndex ? 'chip chip-on' : 'chip')}
                bindtap={() => pickPlan(i)}
              >
                <text className={cls(i === planIndex ? 'chip-text chip-text-on' : 'chip-text')}>{p.paceLabel}</text>
              </view>
            ))}
          </view>
        ) : null}

        <view className={cls('day-tabs')}>
          {plan.days.map((d) => (
            <view
              key={d.index}
              className={cls(d.index === dayIndex ? 'day-tab day-tab-card-on' : 'day-tab day-tab-card')}
              bindtap={() => setDayIndex(d.index)}
            >
              <text className={cls(d.index === dayIndex ? 'day-tab-text on' : 'day-tab-text')}>Day {d.index}</text>
              <text className={cls(d.index === dayIndex ? 'day-tab-date on' : 'day-tab-date')}>
                {dayPlaces(d).length} 个地点
              </text>
            </view>
          ))}
        </view>

        <scroll-view className={cls('scroll')} scroll-y bounces={false}>
          {impact ? (
            <view className={cls('card impact-card')}>
              <view className={cls('impact-head')}>
                <text className={cls('card-title')}>{impact.note}</text>
                <view className={cls('impact-close')} bindtap={onDismissImpact}>
                  <text className={cls('impact-close-text')}>✕</text>
                </view>
              </view>
              <view className={cls('impact-row')}>
                <text className={cls('impact-label')}>时间</text>
                <text className={cls('impact-value')}>{fmtDelta(impact.minutes, ' 分钟')}</text>
                <text className={cls('impact-label impact-label-gap')}>人均</text>
                <text className={cls('impact-value')}>{fmtMoney(impact.cost)}</text>
              </view>
              {impact.recheck.length > 0 ? (
                <text className={cls('card-note')}>要重新确认：{impact.recheck.join('；')}</text>
              ) : (
                <text className={cls('card-note')}>没有新增冲突</text>
              )}
            </view>
          ) : null}

          {dayIssues.length > 0 ? (
            <view className={cls('card issue-card')}>
              <text className={cls('card-title')}>出发前要确认的 {dayIssues.length} 条</text>
              {dayIssues.map((i, k) => (
                <view key={`${i.code}-${k}`} className={cls('issue-row')}>
                  <text className={cls(ISSUE_CLASS[i.level])}>{ISSUE_LABEL[i.level]}</text>
                  <text className={cls('issue-text')}>{i.message}</text>
                </view>
              ))}
            </view>
          ) : null}

          <view className={cls('timeline')}>
            {day.items.map((item) => (
              <view key={item.id} className={cls('tl-row')}>
                <text className={cls('tl-time')}>{clock(item.startMin)}</text>
                <view className={cls('tl-rail')}>
                  <view className={cls(item.kind === 'meal' ? 'tl-dot tl-dot-meal' : 'tl-dot')} />
                </view>
                <view className={cls('tl-body')}>
                  <view className={cls('tl-main')}>
                    {item.kind === 'place' ? (
                      <image
                        src={spotImg(item.title, cityCover)}
                        mode="aspectFill"
                        style={{ width: '56px', height: '56px', borderRadius: '10px', marginRight: '10px' }}
                      />
                    ) : (
                      <view className={cls('tl-meal-icon')}>
                        <text className={cls('tl-meal-text')}>餐</text>
                      </view>
                    )}
                    <view className={cls('tl-text')}>
                      <text className={cls('tl-title')}>{item.title}</text>
                      <text className={cls('tl-meta')}>
                        {/* 「立即入园」是设计稿的固定文案，票种还没接；这里只说能确定的事 */}
                        {item.kind === 'meal'
                          ? `用餐 · 约 ${Math.round((item.stayMin / 60) * 10) / 10} 小时`
                          : `门票 ${ticketText(item.cost)} · 停留约 ${Math.round((item.stayMin / 60) * 10) / 10} 小时`}
                      </text>
                      {/* 营业时段与可信状态必须跟票价挨着，页脚一句「待核实」盖不住逐条数字 */}
                      {item.kind === 'place' ? <text className={cls('tl-meta')}>{placeNote(item.placeId)}</text> : null}
                      {/* 路上时间必须带来源：直线折算和真实路线混着显示，等于让用户信错那个到达时刻 */}
                      {item.transportMin > 0 ? (
                        <text className={cls('tl-meta')}>{legNote(item.transportMin, item.transportSource)}</text>
                      ) : null}
                    </view>
                  </view>
                </view>
              </view>
            ))}
          </view>

          <view className={cls('card')}>
            <text className={cls('card-title')}>预算依据（{demand.party} 人合计 ¥{plan.budget.total}）</text>
            {plan.budget.items.map((b) => (
              <view key={b.category} className={cls('budget-row')}>
                <text className={cls('budget-label')}>{b.basis}</text>
                <text className={cls('budget-amount')}>¥{b.amount}</text>
              </view>
            ))}
            <text className={cls('card-note')}>人均 ¥{plan.budget.perPerson}。{plan.budget.uncertain[0] ?? ''}</text>
          </view>

          <text className={cls('mock-note')}>门票与开放时间来自地点收录（{trustLabel.pending}），出发前请自行核验；天气与日期未接入数据源</text>
        </scroll-view>
      </view>

      <view className={cls('bottom-bar')}>
        <view className={cls('btn-ghost')} bindtap={onMap}>
          <text className={cls('btn-ghost-text')}>查看地图</text>
        </view>
        <view
          className={cls('btn-primary btn-primary-grow')}
          bindtap={() => {
            setRevising(true);
            track('revise_open', { day: dayIndex });
          }}
        >
          <text className={cls('btn-primary-text')}>调整这一天</text>
        </view>
      </view>

      {comparing ? (
        <CompareSheet
          plans={plans}
          party={demand.party}
          onClose={() => setComparing(false)}
          onPick={(i) => {
            setComparing(false);
            onPickPlan(i);
            track('compare_pick', { plan: plans[i]?.paceLabel ?? '' });
          }}
        />
      ) : null}

      {revising ? (
        <ReviseSheet
          plan={plan}
          demand={demand}
          dayIndex={dayIndex}
          onClose={() => setRevising(false)}
          onApplied={(nextPlan, nextImpact) => {
            setRevising(false);
            onRevise(planIndex, nextPlan, nextImpact);
          }}
        />
      ) : null}
    </view>
  );
}

/** 变更影响不带正负号，加号和单位在这里拼，引擎只出数字 */
function fmtDelta(n: number, unit: string): string {
  if (n === 0) return '没变';
  return `${n > 0 ? '+' : ''}${n}${unit}`;
}

function fmtMoney(n: number): string {
  if (n === 0) return '没变';
  return `${n > 0 ? '+' : ''}¥${n}`;
}

function clock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h < 10 ? '0' : ''}${h}:${m < 10 ? '0' : ''}${m}`;
}

/** 一天里的景点条目（餐不算地点，别再当景点数） */
const dayPlaces = (day: Plan['days'][number]) => day.items.filter((i) => i.kind === 'place');

/** 地点的开放时段 + 可信状态；查不到地点就空着，不编 */
function placeNote(placeId?: string): string {
  if (!placeId) return '';
  const place = placeById(placeId);
  if (!place) return '';
  const when = place.verifiedAt ? `核验 ${place.verifiedAt}` : '未记录核验时间';
  // 规划时段是从 openText 收紧算出来的（多档取交集、关灯时刻封顶），把原文带上，
  // 用户才能判断「周一闭馆」「16:00 停止检票」这类约束有没有被吃掉
  const span = `开放 ${clock(place.open[0])}-${clock(place.open[1])}`;
  return place.openText
    ? `${span}（${place.openText}）· ${trustLabel[place.trust]} · ${when}`
    : `${span} · ${trustLabel[place.trust]} · ${when}`;
}

/**
 * 路上耗时的说明。route 是问过地图服务的真实路线时长，straight 是直线折算。
 * 不标来源就等于把估算当导航结果给出去——产品明令不许「冒充已核验」的地方。
 */
function legNote(minutes: number, source?: 'route' | 'straight'): string {
  return source === 'route' ? `路上约 ${minutes} 分钟` : `路上约 ${minutes} 分钟（按直线距离估算）`;
}
