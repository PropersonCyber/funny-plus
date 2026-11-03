import { useMemo } from '@lynx-js/react';

import chengdu from '../../assets/gen/chengdu.jpg';
import chongqing from '../../assets/gen/chongqing.jpg';
import beijing from '../../assets/gen/beijing.jpg';
import dali from '../../assets/gen/dali.jpg';
import mascotAi from '../../assets/ip/mascot-ai.png';
import { svgIcon } from '../../icons.js';
import { toast } from '../../toast.js';
import { spotImg } from '../../spot-img.js';
import { factsOf, planFor } from '../../data.js';
import type { Demand, Plan } from '../../data.js';
import styles from './index.module.scss';
import { makeCls } from '../../styles/cls.js';

const cls = makeCls(styles);

type Guide = { title: string; note: string; views: string; image: string };

type Props = {
  guide: Guide;
  onBack: () => void;
  /** 带上攻略的城市：切城市再打开表单，否则生成的是当前城市的方案 */
  onPlan: (city: string) => void;
  onMap: () => void;
};

const CITY_IMG: Record<string, string> = { chengdu, chongqing, beijing, dali };
const CITY_NAME: Record<string, string> = { chengdu: '成都', chongqing: '重庆', beijing: '北京', dali: '大理' };

// 攻略是固定路线，不随用户偏好变：按 2 人、中等预算出一套，页面里标清估算口径
const GUIDE_DEMAND: Demand = {
  destination: '成都',
  dayCount: 2,
  party: 2,
  budgetLevel: 'mid',
  preferences: ['经典打卡'],
  transport: 'public',
  notes: '',
};

const BAR_COLOR: Record<string, string> = {
  transport: '#2478F2',
  lodging: '#35C7E8',
  tickets: '#8B7CFF',
  food: '#FFBE55',
  other: '#C7D2E3',
};

// 预算分类小图标与底色，对齐设计稿里每行左侧的圆角图标
const CAT_ICON: Record<string, string> = {
  transport: 'transport',
  lodging: 'home',
  tickets: 'ticket',
  food: 'food',
  other: 'more',
};

const CAT_TINT: Record<string, string> = {
  transport: 'rgba(36,120,242,0.12)',
  lodging: 'rgba(53,199,232,0.16)',
  tickets: 'rgba(139,124,255,0.16)',
  food: 'rgba(255,190,85,0.18)',
  other: 'rgba(199,210,227,0.24)',
};

const TRUST_TINT: Record<string, string> = {
  official: 'rgba(36,120,242,0.12)',
  credible: 'rgba(53,192,138,0.14)',
  experience: 'rgba(255,190,85,0.18)',
  pending: 'rgba(165,178,199,0.18)',
};

export function GuideDetailPage({ guide, onBack, onPlan, onMap }: Props) {
  const city = CITY_NAME[guide.image] ?? '成都';
  const cover = CITY_IMG[guide.image] ?? chengdu;

  // 引擎是确定性的，直接按攻略城市算一套，不借用当前行程（可能不是同一个城市）
  const plan = useMemo<Plan | null>(() => {
    try {
      return planFor({ ...GUIDE_DEMAND, destination: city })[0] ?? null;
    } catch {
      return null;
    }
  }, [city]);

  const facts = useMemo(() => factsOf(city).slice(0, 3), [city]);
  const stops = plan ? plan.days.reduce((n, d) => n + d.items.filter((i) => i.kind === 'place').length, 0) : 0;

  return (
    <view className={cls('screen-inner')}>
      <scroll-view className={cls('scroll')} scroll-y>
        <view className={cls('gd-root')}>
          <view className={cls('cover')}>
            <image src={cover} mode="aspectFill" style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }} />
            <view className={cls('cover-top')}>
              <view className={cls('cover-btn')} bindtap={onBack}>
                <svg content={svgIcon('chevronLeft', '#2A3A57')} style={{ width: '17px', height: '17px' }} />
              </view>
              <view className={cls('cover-tools')}>
                <view className={cls('cover-btn')} bindtap={() => toast('分享本期未开放')}>
                  <svg content={svgIcon('share', '#2A3A57')} style={{ width: '16px', height: '16px' }} />
                </view>
              </view>
            </view>
          </view>

          {plan === null ? (
            <view className={cls('head-card')}>
              <text className={cls('gd-title')}>{guide.title}</text>
              <text className={cls('card-note')}>{city}还没有接入地点数据，这条攻略暂时只看得到封面，不编内容。</text>
              <view className={cls('btn-primary')} bindtap={onBack}>
                <text className={cls('btn-primary-text')}>回首页看别的</text>
              </view>
            </view>
          ) : (
            <>
              <view className={cls('head-card')}>
                <text className={cls('gd-title')}>{guide.title}</text>
                <view className={cls('tag-row')}>
                  <text className={cls('tag')}>{city}</text>
                  <text className={cls('tag')}>{plan.days.length} 天</text>
                  <text className={cls('tag')}>{plan.paceLabel}</text>
                </view>
                <view className={cls('author-row')}>
                  <image src={mascotAi} mode="aspectFit" style={{ width: '30px', height: '34px', marginRight: '8px' }} />
                  <view className={cls('author-main')}>
                    <text className={cls('author-name')}>趣哪玩儿 · 官方整理</text>
                    {/* 浏览量是设计稿示例，别当真实数据 */}
                    <text className={cls('author-meta')}>{guide.views} 人看过 · {guide.note}</text>
                  </view>
                  <view className={cls('fav-btn')} bindtap={() => toast('收藏本期未开放')}>
                    <text className={cls('fav-text')}>收藏</text>
                  </view>
                </view>
              </view>

              <view className={cls('card')}>
                <text className={cls('card-title')}>这条路线适合谁</text>
                <view className={cls('fit-body')}>
                  <view className={cls('fit-main')}>
                    <view className={cls('fit-row')}>
                      <view className={cls('fit-icon fit-icon-blue')}>
                        <svg content={svgIcon('profile', '#2478F2')} style={{ width: '14px', height: '14px' }} />
                      </view>
                      <view className={cls('fit-text')}>
                        <text className={cls('fit-title')}>{plan.suitableFor}</text>
                        <text className={cls('fit-desc')}>按 {GUIDE_DEMAND.party} 人、中等预算排的一版，时长与花费都是算出来的</text>
                      </view>
                    </view>
                    <view className={cls('fit-row')}>
                      <view className={cls('fit-icon fit-icon-green')}>
                        <svg content={svgIcon('itinerary', '#20B98A')} style={{ width: '14px', height: '14px' }} />
                      </view>
                      <view className={cls('fit-text')}>
                        <text className={cls('fit-title')}>{plan.days.length} 天走了 {stops} 个点</text>
                        <text className={cls('fit-desc')}>节奏是「{plan.paceLabel}」，每天成组排，不来回折返</text>
                      </view>
                    </view>
                    <view className={cls('fit-row')}>
                      <view className={cls('fit-icon fit-icon-violet')}>
                        <svg content={svgIcon('budget', '#8B7CFF')} style={{ width: '14px', height: '14px' }} />
                      </view>
                      <view className={cls('fit-text')}>
                        <text className={cls('fit-title')}>人均 ¥{plan.budget.perPerson}</text>
                        <text className={cls('fit-desc')}>{plan.budget.uncertain[0] ?? '门票与交通是单价常数，出行前建议再核一次'}</text>
                      </view>
                    </view>
                  </view>
                  <image src={mascotAi} mode="aspectFit" className={cls('fit-mascot')} />
                </view>
              </view>

              <view className={cls('card')}>
                <view className={cls('sec-head')}>
                  <text className={cls('card-title')}>路线一览</text>
                  <view className={cls('sec-link')} bindtap={onMap}>
                    <svg content={svgIcon('pin', '#2478F2')} style={{ width: '13px', height: '13px', marginRight: '3px' }} />
                    <text className={cls('sec-link-text')}>看地图</text>
                  </view>
                </view>

                {plan.days.map((d) => (
                  <view key={d.index} className={cls('day-block')}>
                    <view className={cls('day-head')}>
                      <view className={cls('chip chip-on day-chip')}>
                        <text className={cls('chip-text chip-text-on')}>Day {d.index}</text>
                      </view>
                      <text className={cls('day-route')}>{dayTitle(d.items.filter((i) => i.kind === 'place').map((i) => i.title))}</text>
                    </view>
                    {d.items.map((item) => (
                      <view key={item.id} className={cls('gt-row')}>
                        <text className={cls('gt-time')}>{clock(item.startMin)}</text>
                        <view className={cls('gt-rail')}>
                          <view className={cls(item.kind === 'meal' ? 'gt-dot gt-dot-meal' : 'gt-dot')} />
                        </view>
                        {item.kind === 'place' ? (
                          <image className={cls('gt-thumb')} src={spotImg(item.title, cover)} mode="aspectFill" />
                        ) : (
                          <view className={cls('gt-meal')}>
                            <text className={cls('gt-meal-text')}>餐</text>
                          </view>
                        )}
                        <view className={cls('gt-body')}>
                          <text className={cls('gt-name')}>{item.title}</text>
                          <text className={cls('gt-meta')}>
                            停留 {item.stayMin} 分 · {item.cost > 0 ? `¥${item.cost}` : '免费'}
                            {item.transportMin > 0 ? ` · 路上 ${item.transportMin} 分` : ''}
                          </text>
                        </view>
                      </view>
                    ))}
                  </view>
                ))}
              </view>

              <view className={cls('card')}>
                <text className={cls('card-title')}>预算参考 · 人均 ¥{plan.budget.perPerson}</text>
                {plan.budget.items.map((b, i) => (
                  <view
                    key={b.category}
                    className={cls(i === plan.budget.items.length - 1 ? 'bg-row bg-row-last' : 'bg-row')}
                  >
                    <view className={cls('bg-top')}>
                      <view className={cls('bg-icon')} style={{ backgroundColor: CAT_TINT[b.category] ?? CAT_TINT.other }}>
                        <svg
                          content={svgIcon(CAT_ICON[b.category] ?? 'more', BAR_COLOR[b.category] ?? '#7183A2')}
                          style={{ width: '13px', height: '13px' }}
                        />
                      </view>
                      <text className={cls('bg-label')}>{b.basis}</text>
                      <text className={cls('bg-amount')}>¥{b.amount}</text>
                    </view>
                    <view className={cls('bg-track')}>
                      <view
                        className={cls('bg-fill')}
                        style={{
                          width: `${Math.max(4, Math.round((b.amount / plan.budget.total) * 100))}%`,
                          backgroundColor: BAR_COLOR[b.category] ?? '#C7D2E3',
                        }}
                      />
                    </view>
                  </view>
                ))}
                <text className={cls('card-note')}>合计 ¥{plan.budget.total}（{GUIDE_DEMAND.party} 人）· 单价都是常数，不是实时报价</text>
              </view>

              {facts.length > 0 ? (
                <view className={cls('card')}>
                  <text className={cls('card-title')}>出发前注意</text>
                  {facts.map((f, i) => (
                    <view key={f.id} className={cls(i === facts.length - 1 ? 'warn-row warn-row-last' : 'warn-row')}>
                      <view className={cls('warn-badge')} style={{ backgroundColor: TRUST_TINT[f.trust] ?? TRUST_TINT.pending }}>
                        <text className={cls('warn-badge-text')}>{f.category}</text>
                      </view>
                      <text className={cls('warn-text')}>{f.content}</text>
                    </view>
                  ))}
                  <text className={cls('mock-note')}>以上来自已核验的避坑信息，完整清单在「避坑」页</text>
                </view>
              ) : null}

              <text className={cls('mock-note')}>浏览量为设计稿示例（mock）；路线、时长、预算由本机引擎算出</text>
            </>
          )}
        </view>
      </scroll-view>

      {plan ? (
        <view className={cls('bottom-bar')}>
          <view className={cls('btn-ghost')} bindtap={onBack}>
            <text className={cls('btn-ghost-text')}>返回</text>
          </view>
          <view className={cls('btn-primary btn-primary-grow')} bindtap={() => onPlan(city)}>
            <text className={cls('btn-primary-text')}>按这条攻略生成行程</text>
          </view>
        </view>
      ) : null}
    </view>
  );
}

/** 当天路线名只取前三个点，长了会把 Day 徽标挤掉 */
function dayTitle(names: string[]): string {
  const seen = names.slice(0, 3).join(' → ');
  return names.length > 3 ? `${seen} …` : seen;
}

function clock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h < 10 ? '0' : ''}${h}:${m < 10 ? '0' : ''}${m}`;
}
