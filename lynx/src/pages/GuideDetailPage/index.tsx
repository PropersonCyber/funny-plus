import { useCallback, useMemo } from '@lynx-js/react';

// 举相机的那张（设计稿里攻略封面用的就是它）
import mascotShot from '../../assets/ip/mascot-checkin.png';
import artEat from '../../assets/gen/icon-eat.jpg';
import artPanda from '../../assets/gen/icon-panda.jpg';
import artCulture from '../../assets/gen/icon-culture.jpg';
import artCamera from '../../assets/gen/icon-camera.jpg';

import chengdu from '../../assets/gen/chengdu.jpg';
import chongqing from '../../assets/gen/chongqing.jpg';
import beijing from '../../assets/gen/beijing.jpg';
import dali from '../../assets/gen/dali.jpg';
import { svgIcon, QICON } from '../../icons.js';
import { filledIcon } from '../../icons-filled.js';
import { spotImg } from '../../spot-img.js';
import { factsOf, placeById, planFor } from '../../data.js';
import type { Demand, Plan } from '../../data.js';
import type { Place } from '../../../../shared/types/index.js';
import { toast } from '../../toast.js';
import styles from './index.module.scss';
import { makeCls } from '../../styles/cls.js';

const cls = makeCls(styles);

type Guide = {
  id: string;
  city: string;
  title: string;
  note: string;
  coverImage: string;
  views: number;
  dayCount: number;
  tags: string[];
  rating: number;
  badges: string[];
  placeIds: string[];
  body: string;
};

type Props = {
  guide: Guide;
  onBack: () => void;
  collected: boolean;
  onToggleCollect: () => void;
};

const CITY_IMG: Record<string, string> = { chengdu, chongqing, beijing, dali };
const CITY_NAME: Record<string, string> = { chengdu: '成都', chongqing: '重庆', beijing: '北京', dali: '大理' };

// 攻略档位固定：2 人、中等预算。攻略是「别人排好的路线」，不该跟着当前用户行程的偏好漂移
const party = 2;
const GUIDE_DEMAND: Demand = {
  destination: '成都',
  dayCount: 2,
  party,
  budgetLevel: 'mid',
  preferences: ['经典打卡'],
  transport: 'public',
  notes: '',
};

/** 顶部按钮的固定形态：设计稿是白色圆底 + 蓝线图标，两处都用它 */
function RoundBtn({ icon, onTap }: { icon: string; onTap: () => void }) {
  return (
    <view className={cls('gd-round-btn')} catchtap={onTap}>
      <image src={svgIcon(icon, '#2478F2')} style={{ width: '17px', height: '17px' }} />
    </view>
  );
}

/**
 * 顶部串珠的四格主题。攻略没写 placeIds 时按这个顺序取当天排到的前几个点，
 * 顺序固定，用户两次打开看到的是同一组。
 */
const THEMES: { key: string; title: string; art: string }[] = [
  { key: 'eat', title: '必吃美食', art: artEat },
  { key: 'must', title: '网红打卡', art: artPanda },
  { key: 'culture', title: '历史文化', art: artCulture },
  { key: 'night', title: '城市夜景', art: artCamera },
];

/** 景点 tag → 主题词：标题给「哪一类」，小字给「哪一个点」 */
const TAG_THEME: [string, string][] = [
  ['小吃', 'eat'],
  ['老街', 'eat'],
  ['茶馆', 'eat'],
  ['商圈', 'night'],
  ['夜景', 'night'],
  ['打卡', 'must'],
  ['拍照', 'must'],
  ['亲子', 'must'],
  ['动物', 'must'],
  ['文创', 'must'],
  ['人文', 'culture'],
  ['博物馆', 'culture'],
  ['园林', 'culture'],
  ['古镇', 'culture'],
  ['休闲', 'culture'],
];

// 兜底格（四主题凑不满时）的标题：数据里的 tag 多是两个字，直接当标题太干
const TAG_LABEL: Record<string, string> = {
  人文: '历史文化',
  博物馆: '博物馆',
  园林: '园林景观',
  古镇: '古镇漫步',
  文创: '文创园区',
  老街: '老街烟火',
  小吃: '必吃美食',
  茶馆: '茶馆文化',
  商圈: '商圈逛街',
  打卡: '网红打卡',
  拍照: '拍照出片',
  夜景: '城市夜景',
  动物: '看动物',
  亲子: '亲子友好',
  休闲: '慢生活',
};

const TRUST_TINT: Record<string, string> = {
  official: 'rgba(36,120,242,0.12)',
  credible: 'rgba(53,192,138,0.14)',
  experience: 'rgba(255,190,85,0.18)',
  pending: 'rgba(165,178,199,0.18)',
};

type Highlight = { key: string; title: string; spot: string; art: string };

export function GuideDetailPage({ guide, onBack, collected, onToggleCollect }: Props) {
  // 攻略自带城市字段，图片用资源 key 映射，缺图退回成都封面
  const city = guide.city || CITY_NAME[guide.coverImage] || '成都';
  const cover = CITY_IMG[guide.coverImage] ?? chengdu;

  // 引擎是确定性的，直接按攻略城市算一套，不借用用户当前行程（可能不是同一个城市）
  const plan = useMemo<Plan | null>(() => {
    try {
      // 攻略自己写了几天就排几天：写 1 天的美食地图不该被排成 2 天
      return planFor({ ...GUIDE_DEMAND, destination: city, dayCount: clampDays(guide.dayCount) })[0] ?? null;
    } catch {
      return null;
    }
  }, [city]);

  // 串珠优先用攻略自己写的 placeIds（编辑口径），缺了才用路线派生
  const spots = useMemo<Place[]>(() => {
    const picked = (guide.placeIds ?? [])
      .map((id) => placeById(id))
      .filter((p): p is Place => Boolean(p));
    if (picked.length) return picked.slice(0, 4);
    if (!plan) return [];
    const seen = new Set<string>();
    const out: Place[] = [];
    for (const day of plan.days) {
      for (const item of day.items) {
        const place = item.placeId ? placeById(item.placeId) : undefined;
        if (!place || seen.has(place.id)) continue;
        seen.add(place.id);
        out.push(place);
        if (out.length === 4) return out;
      }
    }
    return out;
  }, [guide.placeIds, plan]);

  const highlights = useMemo<Highlight[]>(() => buildHighlights(spots), [spots]);

  // 没有「查看全部」的去处，所以四格仅做展示，不做成假按钮
  const onShare = useCallback(() => {
    toast('复制分享链接要靠宿主能力，MVP 暂未接入');
  }, []);

  return (
    <view className={cls('gd-page')}>
      <scroll-view className={cls('scroll')} scroll-y bounces={false}>
        <view className={cls('gd-root')}>
          <view className={cls('gd-hero')}>
            <image src={cover} mode="aspectFill" className={cls('gd-hero-img')} />
            <view className={cls('gd-top')}>
              <RoundBtn icon="chevronLeft" onTap={onBack} />
              <RoundBtn icon="share" onTap={onShare} />
            </view>
            {/* 设计稿里咕噜举着相机站在画面右侧，脚踩在白卡上沿 */}
            <image src={mascotShot} mode="aspectFit" className={cls('gd-mascot')} />
          </view>

          {/* 白色大卡压在封面上：设计稿里卡片顶边是弧形的，用大圆角 + 负 margin 做出来 */}
          <view className={cls('gd-sheet')}>
            <view className={cls('gd-title-row')}>
              <text className={cls('gd-title')}>{guide.title}</text>
              <view className={cls('gd-slogan')}>
                <text className={cls('gd-slogan-line')}>去哪里玩儿</text>
                <text className={cls('gd-slogan-line')}>让趣哪玩儿告诉你~</text>
              </view>
            </view>

            <view className={cls('gd-stat-row')}>
              <image src={filledIcon('star', '#FFB020')} style={{ width: '14px', height: '14px', marginRight: '4px' }} />
              <text className={cls('gd-stat-strong')}>{guide.rating.toFixed(1)}</text>
              <text className={cls('gd-stat-sep')}>|</text>
              <text className={cls('gd-stat')}>{fmtViews(guide.views)}人去过</text>
              <text className={cls('gd-stat-sep')}>|</text>
              <image src={svgIcon('clock', '#7183A2')} style={{ width: '13px', height: '13px', marginRight: '4px' }} />
              <text className={cls('gd-stat')}>{plan ? spanText(plan.days.length) : spanText(guide.dayCount)}</text>
            </view>

            <text className={cls('gd-desc')}>{guide.note}</text>

            <view className={cls('gd-badges')}>
              {guide.badges.map((b) => (
                <view key={b} className={cls('gd-badge')}>
                  <text className={cls('gd-badge-text')}>{b}</text>
                </view>
              ))}
            </view>

            {plan === null ? (
              <view className={cls('gd-empty')}>
                <text className={cls('card-note')}>
                  {city}还没有接入地点数据，这条攻略暂时只看得到封面，不编内容。
                </text>
                <view className={cls('btn-primary')} bindtap={onBack}>
                  <text className={cls('btn-primary-text')}>回首页看别的</text>
                </view>
              </view>
            ) : (
              <>
                {highlights.length ? (
                  <view className={cls('gd-card')}>
                    <view className={cls('gd-card-head gd-card-head-between')}>
                      <view className={cls('gd-card-head')}>
                        <image src={filledIcon('calendarStar', '#2478F2')} style={{ width: '16px', height: '16px', marginRight: '6px' }} />
                        <text className={cls('gd-card-title')}>行程亮点</text>
                      </view>
                      <view className={cls('gd-hl-more')} bindtap={onShare}>
                        <text className={cls('gd-hl-more-text')}>查看更多</text>
                        <image src={svgIcon('chevronRight', '#8A99B3')} style={{ width: '12px', height: '12px' }} />
                      </view>
                    </view>
                    <view className={cls('gd-hl-row')}>
                      {highlights.map((h) => (
                        <view key={h.key} className={cls('gd-hl')}>
                          <view className={cls('gd-hl-icon')}>
                            <image src={h.art} mode="aspectFit" className={cls('gd-hl-img')} />
                          </view>
                          <text className={cls('gd-hl-title')}>{h.title}</text>
                          <text className={cls('gd-hl-spot')}>{h.spot}</text>
                        </view>
                      ))}
                    </view>
                  </view>
                ) : null}

                <view className={cls('gd-card')}>
                  <view className={cls('gd-card-head')}>
                    <image src={filledIcon('itinerary', '#2478F2')} style={{ width: '16px', height: '16px', marginRight: '6px' }} />
                    <text className={cls('gd-card-title')}>行程安排</text>
                  </view>

                  {/* 每天纵向连在一条轨道上：天头有圆点，条目不再各挂一个点。
                      不做 Day 切换——切了反而看不到完整路线，设计稿也是连着画的 */}
                  <view className={cls('gd-tl')}>
                    <view className={cls('gd-tl-rail')} />
                    {plan.days.map((d) => (
                      <view key={d.index} className={cls('gd-day')}>
                        <view className={cls('gd-day-head')}>
                          <view className={cls('gd-day-dot')} />
                          <view className={cls('gd-day-chip')}>
                            <text className={cls('gd-day-chip-text')}>Day{d.index}</text>
                          </view>
                          <text className={cls('gd-day-title')}>{dayHeadline(d, city)}</text>
                        </view>

                        {d.items.map((item) => {
                          const place = item.placeId ? placeById(item.placeId) : undefined;
                          return (
                            <view key={item.id} className={cls('gd-tl-row')}>
                              {place ? (
                                <>
                                  <image className={cls('gd-tl-thumb')} src={spotImg(place.name, cover)} mode="aspectFill" />
                                  <view className={cls('gd-tl-body')}>
                                    <view className={cls('gd-tl-name-row')}>
                                      <image src={filledIcon('pin', '#2478F2')} style={{ width: '13px', height: '13px', marginRight: '4px' }} />
                                      <text className={cls('gd-tl-name')}>{place.name}</text>
                                    </view>
                                    <view className={cls('gd-tl-meta-row')}>
                                      <image src={svgIcon(place.hype ? 'sparkles' : 'clock', '#A5B2C7')} style={{ width: '11px', height: '11px', marginRight: '4px' }} />
                                      <text className={cls('gd-tl-meta')}>{place.hype ?? placeNote(place)}</text>
                                    </view>
                                  </view>
                                  <image src={svgIcon('chevronRight', '#C3CFE2')} style={{ width: '15px', height: '15px' }} />
                                </>
                              ) : (
                                <view className={cls('gd-tl-meal')}>
                                  <text className={cls('gd-tl-meal-text')}>{item.title}</text>
                                  <text className={cls('gd-tl-meta')}>停留 {item.stayMin} 分</text>
                                </view>
                              )}
                            </view>
                          );
                        })}
                      </view>
                    ))}
                  </view>
                </view>

                <view className={cls('gd-card')}>
                  <text className={cls('gd-card-title')}>这条路线适合谁</text>
                  <view className={cls('gd-fit')}>
                    <view className={cls('gd-fit-row')}>
                      <view className={cls('gd-fit-icon', )} style={{ backgroundColor: 'rgba(36,120,242,0.12)' }}>
                        <image src={filledIcon('profile', '#2478F2')} style={{ width: '14px', height: '14px' }} />
                      </view>
                      <view className={cls('gd-fit-main')}>
                        <text className={cls('gd-fit-title')}>{plan.suitableFor}</text>
                        <text className={cls('gd-fit-desc')}>按 {party} 人、中等预算排的一版，时长与花费都是算出来的</text>
                      </view>
                    </view>
                    <view className={cls('gd-fit-row')}>
                      <view className={cls('gd-fit-icon')} style={{ backgroundColor: 'rgba(32,185,138,0.14)' }}>
                        <image src={filledIcon('itinerary', '#20B98A')} style={{ width: '14px', height: '14px' }} />
                      </view>
                      <view className={cls('gd-fit-main')}>
                        <text className={cls('gd-fit-title')}>{plan.days.length} 天走了 {countStops(plan)} 个点</text>
                        <text className={cls('gd-fit-desc')}>节奏是「{plan.paceLabel}」，每天成组排，不来回折返</text>
                      </view>
                    </view>
                    <view className={cls('gd-fit-row')}>
                      <view className={cls('gd-fit-icon')} style={{ backgroundColor: 'rgba(139,124,255,0.16)' }}>
                        <image src={filledIcon('shield', '#8B7CFF')} style={{ width: '14px', height: '14px' }} />
                      </view>
                      <view className={cls('gd-fit-main')}>
                        <text className={cls('gd-fit-title')}>人均 ¥{plan.budget.perPerson}</text>
                        <text className={cls('gd-fit-desc')}>{plan.budget.uncertain[0] ?? '门票与交通是单价常数，出行前建议再核一次'}</text>
                      </view>
                    </view>
                  </view>
                </view>

                <WarnCard city={city} />
              </>
            )}
          </view>
        </view>
      </scroll-view>

      {plan ? (
        <view className={cls('gd-bar')}>
          <view className={cls(collected ? 'gd-cta gd-cta-on' : 'gd-cta')} bindtap={onToggleCollect}>
            <image src={filledIcon('navigation', '#FFFFFF')} style={{ width: '17px', height: '17px', marginRight: '7px' }} />
            <text className={cls('gd-cta-text')}>{collected ? '已收藏' : '收藏行程'}</text>
          </view>
        </view>
      ) : null}
    </view>
  );
}

/** 景点 tag 优先归到四个主题，归不进去的点直接跳过，不硬塞 */
function buildHighlights(spots: Place[]): Highlight[] {
  const used = new Set<string>();
  const out: Highlight[] = [];
  for (const theme of THEMES) {
    const spot = spots.find((s) => {
      if (used.has(s.id)) return false;
      return s.tags.some((t) => TAG_THEME.some(([tag, key]) => tag === t && key === theme.key));
    });
    if (!spot) continue;
    used.add(spot.id);
    out.push({ key: theme.key, title: theme.title, spot: shortName(spot.name), art: theme.art });
    if (out.length === THEMES.length) break;
  }
  // 主题凑不满时用剩下的点补，标题退回它自己的首要标签，不编话题
  for (const spot of spots) {
    if (out.length >= 4) break;
    if (used.has(spot.id)) continue;
    used.add(spot.id);
    out.push({
      key: spot.id,
      title: TAG_LABEL[spot.tags[0]] ?? spot.tags[0] ?? '顺路一看',
      spot: shortName(spot.name),
      art: artCulture,
    });
  }
  return out;
}

/** 「成都大熊猫繁育研究基地」在四宫格里放不下，去掉城市前缀 */
function shortName(name: string): string {
  return name.startsWith('成都') ? name.slice(2) : name;
}

/** 当天标题：取第二个点做「主玩法」，一个点都不剩时退回第一天描述 */
/**
 * 天标题：设计稿是「抵达成都 · 品味慢生活」这类人文标题。
 * 这里不编文案，改成「第 N 天 + 当天主打景点」，第二天起用「继续逛」区分。
 * 只有一个点时不写成「A · A」。
 */
function dayHeadline(day: { index: number; items: { kind: string; title: string }[] }, city: string): string {
  const names = day.items.filter((i) => i.kind === 'place').map((i) => i.title);
  const lead = day.index === 1 ? `抵达${city}` : `继续逛${city}`;
  if (!names.length) return lead;
  return `${lead} · ${names.slice(0, 2).join(' / ')}`;
}

/**
 * 条目的第二行：设计稿是「一句种草文案」。这里不编文案，改成「开放时段 + 待核实」，
 * 恰好也是用户真正需要的东西（几点关门、信息信不信得过）。
 */
function placeNote(place: Place): string {
  const [open, close] = place.open;
  const when = open === 0 && close >= 1440 ? '全天开放' : `开放 ${clock(open)}-${clock(close)}`;
  return place.trust === 'pending' || !place.verifiedAt ? `${when} · 尚待核实` : when;
}

function countStops(plan: Plan): number {
  return plan.days.reduce((n, d) => n + d.items.filter((i) => i.kind === 'place').length, 0);
}

/** 浏览量上万折成「万」，一位小数够用，读者只关心量级 */
function fmtViews(n: number): string {
  return n >= 10000 ? `${(n / 10000).toFixed(1)}万` : String(n);
}

/** 一天不写「1天0晚」，那不是人话 */
function spanText(days: number): string {
  return days > 1 ? `${days}天${days - 1}晚` : `${days}天`;
}

/** 引擎只支持 1-3 天；攻略写了别的值就夹到区间里，不要让整页因为超范围变成空态 */
function clampDays(n: number): number {
  return Math.min(3, Math.max(1, Math.round(n) || 1));
}

function clock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h < 10 ? '0' : ''}${h}:${m < 10 ? '0' : ''}${m}`;
}

/** 出发前注意：只展示未过期条目，并如实标注来源等级，不冒充官方 */
function WarnCard({ city }: { city: string }) {
  const facts = useMemo(() => factsOf(city).slice(0, 3), [city]);
  if (!facts.length) return null;
  return (
    <view className={cls('gd-card')}>
      <view className={cls('gd-card-head')}>
        <image src={filledIcon('shield', '#1E9E6A')} style={{ width: '16px', height: '16px', marginRight: '6px' }} />
        <text className={cls('gd-card-title')}>出发前注意</text>
      </view>
      {facts.map((f, i) => (
        <view key={f.id} className={cls(i === facts.length - 1 ? 'gd-warn-row gd-warn-row-last' : 'gd-warn-row')}>
          <view className={cls('gd-warn-badge')} style={{ backgroundColor: TRUST_TINT[f.trust] ?? TRUST_TINT.pending }}>
            <text className={cls('gd-warn-badge-text')}>{f.category}</text>
          </view>
          <text className={cls('gd-warn-text')}>{f.content}</text>
        </view>
      ))}
    </view>
  );
}
