import { useCallback, useState } from '@lynx-js/react';

import { svgDataUri } from '../../icon-svg.js';
import { svgIcon } from '../../icons.js';
import type { Demand, Plan } from '../../data.js';
import styles from './index.module.scss';
import { makeCls } from '../../styles/cls.js';

const cls = makeCls(styles);

type Props = {
  demand: Demand;
  plans: Plan[];
  /** 建议必须按用户选中的那套方案算，否则预算占比和方案金额对不上 */
  planIndex: number;
  onBack: () => void;
  onPlan: () => void;
};

const CATEGORY_LABEL: Record<string, string> = {
  transport: '交通',
  lodging: '住宿',
  tickets: '门票',
  food: '餐饮',
  other: '其他',
};

const CATEGORY_COLOR: Record<string, string> = {
  transport: '#2478F2',
  lodging: '#35C7E8',
  tickets: '#45D6B0',
  food: '#FFBE55',
  other: '#A5B2C7',
};

export function AdvicePage({ demand, plans, planIndex, onBack, onPlan }: Props) {
  const plan = plans[Math.min(planIndex, plans.length - 1)];
  const total = plan ? plan.budget.total : 0;

  // 占比以前是写死的 35/25/20/15/5，跟方案金额无关；现在按真实预算分项折算
  const split = plan
    ? plan.budget.items.map((b) => ({
        label: CATEGORY_LABEL[b.category] ?? b.category,
        percent: total > 0 ? Math.round((b.amount / total) * 100) : 0,
        color: CATEGORY_COLOR[b.category] ?? '#A5B2C7',
      }))
    : [];

  // 以前这三张卡是设计稿里的固定文案（高铁+公交 ¥980 / 春熙路太古里 / 4月19日为周末），
  // 换城市、换方案都不变 —— 和旁边按真实金额算的饼图并排放，等于在冒充数据。
  // 没有数据源的部分（房价、天气、高峰预测）如实标注未接入，不编。
  const transportItem = plan?.budget.items.find((b) => b.category === 'transport');
  const lodgingItem = plan?.budget.items.find((b) => b.category === 'lodging');
  const tripDays = plan?.days.length ?? 0;
  // 交通方式从行程条目里取实际用到的那几种，去重后展示
  const modes = plan
    ? Array.from(new Set(plan.days.flatMap((d) => d.items.map((i) => i.transportMode))))
    : [];
  const MODE_LABEL: Record<string, string> = {
    walk: '步行', bus: '公交', metro: '地铁', taxi: '打车', car: '自驾', train: '高铁',
  };
  const modeLabels = modes.map((m) => MODE_LABEL[m] ?? m);
  // 时间来源：只要有一条是直线折算，就不能说「时间可控」
  const allRouted = plan
    ? plan.days.every((d) => d.items.every((i) => i.transportSource !== 'straight'))
    : false;

  // 提醒全部从方案本身推出来：有依据的才写，没有数据源的（班次、天气、高峰）不写
  const observedTips: string[] = [];
  if (!plan) {
    observedTips.push('还没有方案，先规划一次');
  } else {
    if (!allRouted) observedTips.push('部分路段时长是直线距离折算，到达时刻请留余量');
    if (demand.party >= 4) observedTips.push(`${demand.party} 人同行，中巴/包车需核对核载人数`);
    const ticketItem = plan.budget.items.find((b) => b.category === 'tickets');
    if (ticketItem && ticketItem.evidence === 'price') {
      observedTips.push('门票按公示价估算，以景区当日票价为准');
    }
    const pending = plan.days.flatMap((d) => d.items).filter((i) => !i.placeId).length;
    if (pending > 0) observedTips.push(`有 ${pending} 项是通用安排（用餐/休息），不是收录地点`);
    if (observedTips.length === 0) observedTips.push('暂无需要特别提示的项');
  }

  // 饼图用 SVG 画：按百分比累积 dashoffset
  const donut = (() => {
    let acc = 0;
    const r = 42;
    const c = 2 * Math.PI * r;
    const arcs = split
      .map((b) => {
        const len = (b.percent / 100) * c;
        const seg = `<circle cx="50" cy="50" r="${r}" fill="none" stroke="${b.color}" stroke-width="16" stroke-dasharray="${len} ${
          c - len
        }" stroke-dashoffset="${-acc}" transform="rotate(-90 50 50)"/>`;
        acc += len;
        return seg;
      })
      .join('');
    return svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${arcs}</svg>`);
  })();

  const onOpen = useCallback(() => onPlan(), [onPlan]);
  const [tipsOpen, setTipsOpen] = useState(true);
  const closeTips = useCallback(() => setTipsOpen(false), []);

  return (
    <scroll-view className={cls('scroll')} scroll-y bounces={false}>
      <view className={cls('page')}>
        <view className={cls('page-head')}>
          <view className={cls('icon-btn')} bindtap={onBack}>
            <image src={svgIcon('chevronLeft', '#2A3A57')} style={{ width: '18px', height: '18px' }} />
          </view>
          <text className={cls('page-title')}>智能建议</text>
          <view className={cls('head-link')} bindtap={onBack}>
            <text className={cls('head-link-text')}>收起</text>
            <image src={svgIcon('chevronRight', '#2478F2')} style={{ width: '13px', height: '13px', marginLeft: '2px' }} />
          </view>
        </view>

        {/* 副标题与第一张卡片：card-note 自带 margin-top，紧贴下一张卡像糊在一起 */}
        <text className={cls('card-note advice-sub')}>基于你的需求，提供专业出行建议</text>

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
                <image src={svgIcon('sparkles', '#F5A03C')} style={{ width: '16px', height: '16px' }} />
              </view>
              <view className={cls('tip-hl-main')}>
                <text className={cls('tip-hl-title')}>时间与花费都按方案实算</text>
                <text className={cls('tip-hl-note')}>
                  {plan
                    ? `${tripDays} 天 · 合计 ¥${total}，人均 ¥${plan.budget.perPerson}；路段时间${
                        allRouted ? '全部来自地图服务' : '含直线折算，标「估算」处精度较低'
                      }。`
                    : '还没有方案，先规划一次再来看。'}
                </text>
              </view>
            </view>
            {observedTips.map((t) => (
              <view key={t} className={cls('tip-row')}>
                <view className={cls('tip-check')}>
                  <image src={svgIcon('shield', '#20B98A')} style={{ width: '12px', height: '12px' }} />
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
              <image src={svgIcon('transport', '#FFFFFF')} style={{ width: '20px', height: '20px' }} />
            </view>
            <view className={cls('advice-main')}>
              <text className={cls('advice-title')}>
                {modeLabels.length ? modeLabels.join(' + ') : '尚无方案'}
              </text>
              <text className={cls('advice-price')}>
                {transportItem ? `人均 ¥${transportItem.amount}` : '—'}
              </text>
              <view className={cls('tag-row')}>
                {(transportItem?.basis ? [transportItem.basis] : []).map((t) => (
                  <text key={t} className={cls('tag')}>{t}</text>
                ))}
              </view>
            </view>
          </view>
          <text className={cls('card-note')}>
            {transportItem
              ? `按当前方案实算；${allRouted ? '路段时间来自地图服务' : '部分路段为直线折算，见行程页「估算」标记'}`
              : '先规划一次行程，这里会按你方案里的交通分项展示'}
          </text>
        </view>

        <view className={cls('card')}>
          <view className={cls('advice-head')}>
            <text className={cls('card-title')}>住宿建议</text>
            <text className={cls('badge-soft')}>推荐</text>
          </view>
          <text className={cls('advice-title')}>
            {lodgingItem ? `约 ¥${lodgingItem.amount}（${tripDays} 晚合计，人均）` : '尚无方案'}
          </text>
          <text className={cls('card-note')}>
            {lodgingItem
              ? `${lodgingItem.basis}。具体酒店未接入数据源，这里只给总量估算。`
              : '先规划一次行程，这里会按你方案里的住宿分项展示'}
          </text>
        </view>

        <view className={cls('card')}>
          <text className={cls('card-title')}>预算分配</text>
          <view className={cls('donut-row')}>
            <image src={donut} style={{ width: '108px', height: '108px' }} />
            <view className={cls('legend')}>
              {split.map((b) => (
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

        <text className={cls('mock-note')}>出行方式与住宿为按当前方案实算；具体班次、酒店与天气未接入数据源</text>
      </view>
    </scroll-view>
  );
}
