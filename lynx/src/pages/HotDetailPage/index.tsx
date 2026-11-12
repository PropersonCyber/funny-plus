import { useCallback, useMemo } from '@lynx-js/react';

import chengdu from '../../assets/gen/chengdu.jpg';
import chongqing from '../../assets/gen/chongqing.jpg';
import beijing from '../../assets/gen/beijing.jpg';
import dali from '../../assets/gen/dali.jpg';
import mascotCheckin from '../../assets/ip/mascot-checkin.png';
import { svgIcon, QICON } from '../../icons.js';
import { filledIcon } from '../../icons-filled.js';
import { spotImg } from '../../spot-img.js';
import artCulture from '../../assets/gen/icon-culture.jpg';
import { placeById } from '../../data.js';
import { toast } from '../../toast.js';
import type { City, Place, Play } from '../../../../shared/types/index.js';
import styles from './index.module.scss';
import { makeCls } from '../../styles/cls.js';

const cls = makeCls(styles);

const CITY_IMG: Record<string, string> = { chengdu, chongqing, beijing, dali };

/** 景点 tag → 卖点词：数据里的 tag 是两个字，直接当胶囊太干 */
const TAG_LABEL: Record<string, string> = {
  人文: '历史人文',
  博物馆: '博物馆',
  园林: '园林',
  古镇: '古镇',
  文创: '文创',
  老街: '老街',
  小吃: '吃货必去',
  茶馆: '茶馆',
  商圈: '逛街',
  打卡: '打卡',
  拍照: '拍照出片',
  夜景: '夜景',
  动物: '看动物',
  亲子: '亲子',
  休闲: '慢生活',
};

/**
 * 图标有两套：3D 那套（QICON）有日历/门票这类实体物，线性那套（svgIcon）有交通/美食这类符号。
 * 数据里只写名字，这里按存在性挑一套，两边都没有时退到线性定位针，不留白。
 */
function TipIcon({ name, size = 13 }: { name: string; size?: number }) {
  const img = (QICON as Record<string, string>)[name];
  const style = { width: `${size}px`, height: `${size}px` };
  if (img) return <image src={img} mode="aspectFit" style={style} />;
  return <image src={svgIcon(name || 'pin', '#4A6699')} style={style} />;
}

/** 首页「热门推荐」卡片上的固定文案，与设计稿一致；不随城市变，避免每城各写一句蹭文案 */
const HOT_TITLE = '热门推荐';
const HOT_NOTE = '精选热门景点，解锁必玩玩法！';

type Props = {
  city: City;
  /** 同城景点，按运营排序（已按评分/人气排好） */
  places: Place[];
  /** 同城玩法，取第一条当「推荐行程」 */
  plays: Play[];
  onBack: () => void;
  /** 查看全部景点：去地图页看这些点的位置 */
  onSeeAllPlaces: () => void;
  /** 推荐行程里的景点名，用于「A → B → C」这一行 */
  onOpenPlay: (id: string) => void;
  /** 加入行程：带上城市打开规划表单 */
  onAddPlan: () => void;
};

/**
 * 热门推荐详情：城市级入口页。
 * 与攻略详情页的区别是它描述的是「一座城市」而不是「一条别人排好的路线」，
 * 所以这里给的是景点集合 + 一条代表行程 + 城市级贴士。
 */
export function HotDetailPage({ city, places, plays, onBack, onSeeAllPlaces, onOpenPlay, onAddPlan }: Props) {
  const cover = CITY_IMG[city.coverImage] ?? chengdu;

  // 分享要靠宿主能力，MVP 没有渠道；按钮保留（设计稿有），点了如实说明
  const onShare = useCallback(() => {
    toast('分享链接要靠宿主能力，MVP 暂未接入');
  }, []);

  // 只展示 4 个：设计稿是横向一排，多了会挤成两行反而不像「精选」
  const spots = useMemo(
    // 按人气降序取前 4 个：接口给的是按 id 排的，直接 slice 会变成「字母序精选」
    () => places
      .filter((p) => p.city === city.id)
      .slice()
      .sort((a, b) => b.visitors - a.visitors)
      .slice(0, 4),
    [places, city.id]
  );

  const play = plays.find((p) => p.city === city.id) ?? plays[0];

  /**
   * 三个卖点胶囊：城市 tag 已经有两段，第三段从「必玩景点里最热的那条标签」补，
   * 而不是重复拼城市描述——那样会出现「美食 / 熊猫 / 美食之都」这种同义重复。
   */
  const badges = useMemo(() => {
    const out: string[] = [];
    const push = (t: string) => {
      const v = t.trim();
      if (v && !out.includes(v)) out.push(v);
    };
    city.tag.split('·').forEach(push);
    // 城市描述里往往藏着 tag 没覆盖到的卖点（如「慢生活」），整条拆开都试一遍
    city.desc.split(/[，,]/).forEach(push);
    for (const p of spots) for (const t of p.tags) push(TAG_LABEL[t] ?? t);
    // 「熊猫 / 看动物」「人文 / 历史人文」是同一个意思，留先来的那个
    return out.filter((t, i, arr) => !arr.some((o, j) => j < i && (o.includes(t) || t.includes(o)))).slice(0, 3);
  }, [city.tag, spots]);

  // 推荐行程的路线行：从 placeIds 取名字，取不到的跳过（下架景点不该在路线里留空箭头）
  const route = (play?.placeIds ?? [])
    .map((id) => placeById(id)?.name)
    .filter((n): n is string => Boolean(n));

  return (
    <view className={cls('hot-page')}>
      <scroll-view className={cls('scroll')} scroll-y bounces={false}>
        <view className={cls('hot-root')}>
          <view className={cls('hot-hero')}>
            <image src={cover} mode="aspectFill" className={cls('hot-hero-img')} />
            <view className={cls('hot-top')}>
              <view className={cls('hot-round-btn')} bindtap={onBack}>
                <image src={svgIcon('chevronLeft', '#2478F2')} style={{ width: '17px', height: '17px' }} />
              </view>
              <view className={cls('hot-round-btn')} catchtap={onShare}>
                <image src={svgIcon('share', '#2478F2')} style={{ width: '17px', height: '17px' }} />
              </view>
            </view>
            {/* 设计稿里吉祥物站在画面右侧、举着糖葫芦；卡片压上来时它不会被裁掉，所以放在 hero 层 */}
            <image src={mascotCheckin} mode="aspectFit" className={cls('hot-mascot')} />
          </view>

          <view className={cls('hot-sheet')}>
            <view className={cls('hot-title-row')}>
              <image src={QICON.flame} mode="aspectFit" className={cls('hot-flame')} />
              <text className={cls('hot-title')}>{HOT_TITLE}</text>
              <view className={cls('hot-city-chip')}>
                <image src={filledIcon('pin', '#2478F2')} style={{ width: '12px', height: '12px', marginRight: '3px' }} />
                <text className={cls('hot-city-text')}>{city.id}</text>
              </view>
            </view>

            <view className={cls('hot-stat-row')}>
              <image src={QICON.star} mode="aspectFit" style={{ width: '13px', height: '13px', marginRight: '4px' }} />
              <text className={cls('hot-stat-strong')}>{city.rating}</text>
              <text className={cls('hot-stat-sep')}>|</text>
              <text className={cls('hot-stat')}>{city.visitedText}</text>
              <text className={cls('hot-stat-sep')}>|</text>
              <image src={svgIcon('clock', '#7183A2')} style={{ width: '13px', height: '13px', marginRight: '4px' }} />
              <text className={cls('hot-stat')}>{city.days}</text>
            </view>

            <text className={cls('hot-desc')}>{HOT_NOTE}</text>

            <view className={cls('hot-badges')}>
              {badges.map((t) => (
                <view key={t} className={cls('hot-badge')}>
                  <text className={cls('hot-badge-text')}>{t}</text>
                </view>
              ))}
            </view>

            <view className={cls('hot-sec-head')}>
              <view className={cls('hot-sec-title-row')}>
                <image src={QICON.star} mode="aspectFit" style={{ width: '16px', height: '16px', marginRight: '5px' }} />
                <text className={cls('hot-sec-title')}>必玩景点</text>
              </view>
              <view className={cls('hot-sec-more')} bindtap={onSeeAllPlaces}>
                <text className={cls('hot-sec-more-text')}>查看更多</text>
                <image src={svgIcon('chevronRight', '#8A99B3')} style={{ width: '12px', height: '12px' }} />
              </view>
            </view>

            <scroll-view className={cls('hot-spots')} scroll-x>
              <view className={cls('hot-spot-row')}>
                {spots.map((p) => (
                  <view key={p.id} className={cls('hot-spot')}>
                    <image src={spotImg(p.name, cover)} mode="aspectFill" className={cls('hot-spot-img')} />
                    <view className={cls('hot-spot-body')}>
                      <text className={cls('hot-spot-name')}>{p.name}</text>
                      <view className={cls('hot-spot-meta')}>
                        <image src={QICON.star} mode="aspectFit" style={{ width: '10px', height: '10px', marginRight: '2px' }} />
                        <text className={cls('hot-spot-rate')}>{(p.rating ?? 0).toFixed(1)}</text>
                        <text className={cls('hot-spot-visitors')}>{p.visitors ?? 0}万人去过</text>
                      </view>
                    </view>
                  </view>
                ))}
              </view>
            </scroll-view>

            <view className={cls('hot-sec-head hot-sec-head-tight')}>
              <view className={cls('hot-sec-title-row')}>
                <image src={filledIcon('pin', '#2478F2')} style={{ width: '16px', height: '16px', marginRight: '5px' }} />
                <text className={cls('hot-sec-title')}>推荐行程</text>
              </view>
            </view>

            {play ? (
              <view className={cls('hot-plan')} bindtap={() => onOpenPlay(play.id)}>
                <image src={spotImg(route[0], cover)} mode="aspectFill" className={cls('hot-plan-img')} />
                <view className={cls('hot-plan-main')}>
                  <view className={cls('hot-plan-label')}>
                    <text className={cls('hot-plan-label-text')}>{play.label}</text>
                  </view>
                  <text className={cls('hot-plan-title')}>{play.title}</text>
                  <text className={cls('hot-plan-route')}>{route.length ? route.join(' → ') : play.note}</text>
                  <view className={cls('hot-plan-chips')}>
                    {(play.chips ?? []).map((c) => (
                      <view key={c.text} className={cls('hot-plan-chip')}>
                        <view className={cls('hot-plan-chip-icon')}>
                          <TipIcon name={c.icon} size={12} />
                        </view>
                        <text className={cls('hot-plan-chip-text')}>{c.text}</text>
                      </view>
                    ))}
                  </view>
                </view>
                <view className={cls('hot-plan-go')}>
                  <image src={svgIcon('arrowRight', '#FFFFFF')} style={{ width: '14px', height: '14px' }} />
                </view>
              </view>
            ) : null}

            {(city.tips?.length ?? 0) > 0 ? (
              <view className={cls('hot-tips')}>
                <view className={cls('hot-tips-head')}>
                  <image src={svgIcon('bulb', '#F5A03C')} style={{ width: '16px', height: '16px', marginRight: '5px' }} />
                  <text className={cls('hot-tips-title')}>旅行小贴士</text>
                </view>
                {(city.tips ?? []).map((t) => (
                  <view key={t.label} className={cls('hot-tip-row')}>
                    <view className={cls('hot-tip-icon')}>
                      <TipIcon name={t.icon} size={13} />
                    </view>
                    <text className={cls('hot-tip-label')}>{t.label}：</text>
                    <text className={cls('hot-tip-text')}>{t.text}</text>
                  </view>
                ))}
                {/* 设计稿右下角是一组建筑剪影，用低透明度图标叠出来，不额外引一张大图 */}
                <view className={cls('hot-tips-art')}>
                  <image src={artCulture} mode="aspectFit" style={{ width: '58px', height: '58px', opacity: 0.3 }} />
                  <image src={artCulture} mode="aspectFit" style={{ width: '38px', height: '38px', opacity: 0.22, marginLeft: '-14px' }} />
                </view>
              </view>
            ) : null}
          </view>
        </view>
      </scroll-view>

      <view className={cls('hot-bar')}>
        <view className={cls('hot-cta')} bindtap={onAddPlan}>
          <image src={filledIcon('navigation', '#FFFFFF')} style={{ width: '17px', height: '17px', marginRight: '7px' }} />
          <text className={cls('hot-cta-text')}>加入行程</text>
        </view>
      </view>
    </view>
  );
}
