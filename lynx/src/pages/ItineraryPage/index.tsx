import { IconSvg } from '../../IconSvg.js';
import { useCallback, useEffect, useMemo, useState } from '@lynx-js/react';
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
import { dateRangeLabel } from '../../../../shared/engine/dayDate.js';

const cls = makeCls(styles);

type Props = {
  demand: Demand;
  plans: Plan[];
  /** 当前选中方案由上层持有：详情页/地图/我的看到的是同一套 */
  /** 所在行程 id：修改请求要按行程算，不是按设备算 */
  tripId: string;
  planIndex: number;
  onPickPlan: (index: number) => void;
  onPlan: () => void;
  onMap: () => void;
  onDetail: () => void;
  onRevise: (planIndex: number, plan: Plan, impact: ChangeImpact) => void;
  /** 固定 / 取消固定一条安排：固定的条目不会被 AI 改动或关键词兜底删掉 */
  onTogglePin: (planItemId: string, pinned: boolean) => void;
  /** 上一次局部修改的变更影响；切天不消失，方便对照 */
  impact: ChangeImpact | null;
  onDismissImpact: () => void;
  /**
   * 现场能力（F04/F05）：带着一句话去问咕噜。
   *
   * 不做成「点一下就改行程」：到达判定与下一站都是**读**，改动仍要用户确认。
   * 所以这里只负责把问题交给助理，结果由对话里的确认卡收口。
   */
  onAsk?: (text: string) => void;
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
  tripId,
  planIndex,
  onPickPlan,
  onPlan,
  onMap,
  onDetail,
  onRevise,
  onTogglePin,
  impact,
  onDismissImpact,
  onAsk,
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

  /**
   * 数据缺口（F10）。用户看到「暂无票价」却没人知道——这是最该补的数据缺口，
   * 因此按「哪天有哪些点缺票价/缺核验时间」记一条。不进渲染路径，
   * 靠 plan+day 去重，避免每次刷新都重复上报。
   */
  const gap = useMemo(() => {
    const p = plans[planIndex] ?? plans[0];
    const d = p?.days.find((x) => x.index === dayIndex) ?? p?.days[0];
    if (!d) return null;
    const noTicket: string[] = [];
    const noVerify: string[] = [];
    for (const item of d.items) {
      if (item.kind !== 'place' || !item.placeId) continue;
      if (item.cost === null || item.cost === undefined) noTicket.push(item.placeId);
      const place = placeById(item.placeId);
      if (!place?.verifiedAt) noVerify.push(item.placeId);
    }
    return noTicket.length || noVerify.length ? { noTicket, noVerify } : null;
  }, [plans, planIndex, dayIndex]);

  useEffect(() => {
    if (!gap) return;
    track('data_gap_view', {
      tripId: tripId ?? '',
      day: dayIndex,
      noTicket: gap.noTicket.join(','),
      noVerify: gap.noVerify.join(',')
    });
  }, [gap, tripId, dayIndex]);

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
              <IconSvg content={svgIcon('chevronRight', '#2478F2')} style={{ width: '13px', height: '13px', marginLeft: '2px' }} />
            </view>
          </view>
        </view>
        {/* 日期与预算不能混成一行：日期未定时要明确说「未定」，而预算一直有真数 */}
        <text className={cls('page-sub')}>
          {dateRangeLabel(demand)} · {demand.party} 人 · 人均 ¥{plan.budget.perPerson} · 合计 ¥{plan.budget.total}
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
                      {/* 固定按钮放在标题旁而不是长按菜单里：这是「别动它」的开关，
                          藏起来的开关等于没有，用户不会去长按找 */}
                      {item.kind === 'place' ? (
                        <view
                          className={cls(item.pinned ? 'tl-pin on' : 'tl-pin')}
                          bindtap={() => onTogglePin(item.id, !item.pinned)}
                        >
                          <text className={cls(item.pinned ? 'tl-pin-text on' : 'tl-pin-text')}>
                            {item.pinned ? '已固定' : '固定'}
                          </text>
                        </view>
                      ) : null}
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
                      {/* 现场入口（F04/F05）：只负责把问题交给咕噜，改动仍由对话里的确认卡收口。
                          排进每个景点而不是页脚，是因为「这一站的下一站是哪」只有在这个条目上才说得清 */}
                      {item.kind === 'place' && onAsk ? (
                        <view className={cls('tl-onsite')}>
                          <text className={cls('tl-onsite-link')} bindtap={() => onAsk(`我到了「${item.title}」，附近有什么值得看的？`)}>
                            我在这附近
                          </text>
                          <text className={cls('tl-onsite-link')} bindtap={() => onAsk(`「${item.title}」的下一站去哪，怎么过去？`)}>
                            下一站
                          </text>
                        </view>
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
            <text className={cls('card-note')}>人均 ¥{plan.budget.perPerson}</text>
            {/* 全量列出：只取 uncertain[0] 会让排在前面的住宿假设把
                「有 N 个景点票价未核实」挤掉，总额看着完整、实际少算了景点 */}
            {plan.budget.uncertain.map((u) => (
              <text key={u} className={cls('budget-caveat')}>
                {u}
              </text>
            ))}
          </view>

          {/* 页脚原先把所有门票硬写成「待核实」，与上面逐条的 trust 标签互相矛盾：
              有的点是官方核验过的，页脚一句话把它们全否了。改成只说页脚真能保证的事 */}
          <text className={cls('mock-note')}>门票与开放时间以逐条标注的核验时间为准；天气与具体日期未接入数据源</text>
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
          tripId={tripId}
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
  const body = place.openText ? `${span}（${place.openText}）` : span;
  // 来源必须露出来：只说「核验 11-11」而不说谁核验的，等于让用户自己相信一个无名出处
  const from = place.source ? `来源${place.source} · ` : '';
  return `${body} · ${trustLabel[place.trust]} · ${from}${when}`;
}

/**
 * 路上耗时的说明。route 是问过地图服务的真实路线时长，straight 是直线折算。
 * 不标来源就等于把估算当导航结果给出去——产品明令不许「冒充已核验」的地方。
 */
function legNote(minutes: number, source?: 'route' | 'straight'): string {
  return source === 'route' ? `路上约 ${minutes} 分钟` : `路上约 ${minutes} 分钟（按直线距离估算）`;
}
