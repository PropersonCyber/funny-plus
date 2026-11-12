import { useCallback, useMemo, useState } from '@lynx-js/react';

// 这一版的城市封面是新生成的 AI 插画（gpt-image-2.5），和首页老图分开命名，
// 不动首页正在用的 chengdu/chongqing/beijing/dali，避免改一处影响两个页面。
import chengdu from '../../assets/gen/chengdu_new.jpg';
import chongqing from '../../assets/gen/chongqing_new.jpg';
import beijing from '../../assets/gen/beijing_new.jpg';
import dali from '../../assets/gen/dali_new.jpg';
import hangzhou from '../../assets/gen/hangzhou.jpg';
import lijiang from '../../assets/gen/lijiang.jpg';
import xian from '../../assets/gen/xian.jpg';
import zhangjiajie from '../../assets/gen/zhangjiajie.jpg';
import listHero from '../../assets/gen/list-hero.jpg';
import iconCamera from '../../assets/gen/icon-camera.jpg';
import iconCulture from '../../assets/gen/icon-culture.jpg';
import iconEat from '../../assets/gen/icon-eat.jpg';
import iconPanda from '../../assets/gen/icon-panda.jpg';
import mascotHero from '../../assets/ip/mascot-hero.png';
import { svgIcon, QICON } from '../../icons.js';
import { toast } from '../../toast.js';
import styles from './index.module.scss';
import { makeCls } from '../../styles/cls.js';
import {
  CATEGORIES,
  CROWDS,
  DAY_FILTERS,
  HOT_CITIES,
  MONTH_FILTERS,
  filterCities,
  type CategoryKey,
  type CrowdKey,
  type FilterState,
} from './hotCities.js';

const cls = makeCls(styles);

/**
 * 封面图映射。新城市的图还没生成时**必须**有兜底：
 * 缺一张图就让整页白屏，比缺图本身严重得多。
 */
const CITY_IMG: Record<string, string> = {
  chengdu,
  chongqing,
  beijing,
  dali,
  hangzhou,
  lijiang,
  xian,
  zhangjiajie,
};
const cover = (key: string) => CITY_IMG[key] ?? chengdu;

/** chips 的图标：走已有的小图，不为这版新画一套 */
const CAT_ICON: Record<CategoryKey, string> = {
  hot: QICON.flame,
  nature: iconCamera,
  history: iconCulture,
  food: iconEat,
  family: iconPanda,
};

type Props = {
  onBack: () => void;
  onOpen: (id: string) => void;
};

type Dropdown = 'days' | 'crowd' | 'month' | 'sort' | null;

export function CityListPage({ onBack, onOpen }: Props) {
  const [category, setCategory] = useState<CategoryKey | 'all'>('all');
  const [maxDays, setMaxDays] = useState(0);
  const [crowd, setCrowd] = useState<CrowdKey | 'all'>('all');
  const [month, setMonth] = useState(0);
  const [open, setOpen] = useState<Dropdown>(null);
  const [listMode, setListMode] = useState(false);
  // 收藏是本地态：这一版没有接服务端，刷新会丢，先不假装它持久化了
  const [favs, setFavs] = useState<string[]>([]);

  const filters: FilterState = { category, maxDays, crowd, month };
  const list = useMemo(() => filterCities(HOT_CITIES, filters), [category, maxDays, crowd, month]);

  const toggleFav = useCallback((id: string) => {
    setFavs((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const openCity = useCallback(
    (id: string, isOpen: boolean) => {
      if (!isOpen) {
        toast(`「${id}」暂未开放，正在接入`);
        return;
      }
      onOpen(id);
    },
    [onOpen],
  );

  /** 下拉面板：四个筛选项共用一套开合，同时只开一个 */
  const pick = useCallback((which: Dropdown, apply: () => void) => {
    apply();
    setOpen(which);
  }, []);

  const dayLabel = DAY_FILTERS.find((d) => d.key === maxDays)?.label ?? '不限';

  return (
    <view className={cls('hc-page')}>
      {/* ---------- 顶部：山水横幅 + 标题 + 吉祥物 ---------- */}
      <view className={cls('hc-hero')}>
        <image className={cls('hc-hero-bg')} src={listHero} mode="aspectFill" />
        <view className={cls('hc-hero-veil')} />
        <view className={cls('hc-hero-top')}>
          <view className={cls('hc-round')} bindtap={onBack}>
            <image src={svgIcon('chevronLeft', '#2A3A57')} style={{ width: '18px', height: '18px' }} />
          </view>
          <view className={cls('hc-round')} catchtap={() => toast('搜索即将上线')}>
            <image src={svgIcon('search', '#2A3A57')} style={{ width: '17px', height: '17px' }} />
          </view>
        </view>
        <view className={cls('hc-hero-text')}>
          <view className={cls('hc-title-row')}>
            <image className={cls('hc-flame')} src={QICON.flame} mode="aspectFit" />
            <text className={cls('hc-title')}>热门推荐</text>
          </view>
          <text className={cls('hc-subtitle')}>精选热门目的地，发现下一次旅途灵感</text>
        </view>
        <image className={cls('hc-mascot')} src={mascotHero} mode="aspectFit" />
      </view>

      {/* ---------- 分类 chips：白底圆角容器，横向可滑 ---------- */}
      <view className={cls('hc-chips-wrap')}>
        <scroll-view className={cls('hc-chips')} scroll-x bounces={false}>
          <view
            className={cls(category === 'all' ? 'hc-chip hc-chip-on' : 'hc-chip')}
            bindtap={() => setCategory('all')}
          >
            <text className={cls(category === 'all' ? 'hc-chip-text on' : 'hc-chip-text')}>全部</text>
          </view>
          {CATEGORIES.map((c) => (
            <view
              key={c.key}
              className={cls(category === c.key ? 'hc-chip hc-chip-on' : 'hc-chip')}
              bindtap={() => setCategory(c.key)}
            >
              <image className={cls('hc-chip-icon')} src={CAT_ICON[c.key]} mode="aspectFit" />
              <text className={cls(category === c.key ? 'hc-chip-text on' : 'hc-chip-text')}>{c.label}</text>
            </view>
          ))}
        </scroll-view>
      </view>

      {/* ---------- 筛选行：四个下拉 + 视图切换 ---------- */}
      <view className={cls('hc-filters')}>
        <view className={cls('hc-filter')} bindtap={() => setOpen(open === 'sort' ? null : 'sort')}>
          <text className={cls('hc-filter-text on')}>综合推荐</text>
          <text className={cls('hc-filter-caret')}>▾</text>
        </view>
        <view className={cls('hc-filter')} bindtap={() => setOpen(open === 'days' ? null : 'days')}>
          <text className={cls(isMaxDaysPicked(maxDays) ? 'hc-filter-text on' : 'hc-filter-text')}>
            {isMaxDaysPicked(maxDays) ? dayLabel : '旅行天数'}
          </text>
          <text className={cls('hc-filter-caret')}>▾</text>
        </view>
        <view className={cls('hc-filter')} bindtap={() => setOpen(open === 'crowd' ? null : 'crowd')}>
          <text className={cls(crowd !== 'all' ? 'hc-filter-text on' : 'hc-filter-text')}>
            {crowd === 'all' ? '适合人群' : (CROWDS.find((c) => c.key === crowd)?.label ?? '适合人群')}
          </text>
          <text className={cls('hc-filter-caret')}>▾</text>
        </view>
        <view className={cls('hc-filter')} bindtap={() => setOpen(open === 'month' ? null : 'month')}>
          <text className={cls(month !== 0 ? 'hc-filter-text on' : 'hc-filter-text')}>
            {month === 0 ? '出发时间' : (MONTH_FILTERS.find((m) => m.key === month)?.label ?? '出发时间')}
          </text>
          <text className={cls('hc-filter-caret')}>▾</text>
        </view>
        <view className={cls('hc-mode')} bindtap={() => setListMode((v) => !v)}>
          <image
            src={svgIcon(listMode ? 'more' : 'map', '#3F5980')}
            style={{ width: '16px', height: '16px' }}
          />
        </view>
      </view>

      {/* 下拉面板浮在内容上方，点空白不关闭（Lynx 没有全局点击事件，选完自动关） */}
      {open ? (
        <view className={cls('hc-panel')}>
          {open === 'days'
            ? DAY_FILTERS.map((d) => (
                <view
                  key={d.key}
                  className={cls(maxDays === d.key ? 'hc-panel-item on' : 'hc-panel-item')}
                  bindtap={() => pick(null, () => setMaxDays(d.key))}
                >
                  <text className={cls('hc-panel-text')}>{d.label}</text>
                  {maxDays === d.key ? <text className={cls('hc-panel-tick')}>✓</text> : null}
                </view>
              ))
            : null}
          {open === 'crowd'
            ? [{ key: 'all' as const, label: '不限' }, ...CROWDS].map((c) => (
                <view
                  key={c.key}
                  className={cls(crowd === c.key ? 'hc-panel-item on' : 'hc-panel-item')}
                  bindtap={() => pick(null, () => setCrowd(c.key as CrowdKey | 'all'))}
                >
                  <text className={cls('hc-panel-text')}>{c.label}</text>
                  {crowd === c.key ? <text className={cls('hc-panel-tick')}>✓</text> : null}
                </view>
              ))
            : null}
          {open === 'month'
            ? MONTH_FILTERS.map((m) => (
                <view
                  key={m.key}
                  className={cls(month === m.key ? 'hc-panel-item on' : 'hc-panel-item')}
                  bindtap={() => pick(null, () => setMonth(m.key))}
                >
                  <text className={cls('hc-panel-text')}>{m.label}</text>
                  {month === m.key ? <text className={cls('hc-panel-tick')}>✓</text> : null}
                </view>
              ))
            : null}
          {open === 'sort' ? (
            <view className={cls('hc-panel-item on')} bindtap={() => setOpen(null)}>
              <text className={cls('hc-panel-text')}>综合推荐</text>
              <text className={cls('hc-panel-tick')}>✓</text>
            </view>
          ) : null}
        </view>
      ) : null}

      {/* ---------- 城市卡片 ---------- */}
      <scroll-view className={cls('scroll')} scroll-y bounces={false}>
        {list.length === 0 ? (
          <view className={cls('hc-empty')}>
            <text className={cls('hc-empty-title')}>没有符合条件的城市</text>
            <text className={cls('hc-empty-note')}>放宽天数或人群再试试</text>
          </view>
        ) : (
          <view className={cls(listMode ? 'hc-grid hc-grid-list' : 'hc-grid')}>
            {list.map((c, i) => {
              const rank = HOT_CITIES.indexOf(c) + 1;
              const fav = favs.includes(c.id);
              return (
                <view
                  key={c.id}
                  className={cls(listMode ? 'hc-card hc-card-wide' : 'hc-card')}
                  bindtap={() => openCity(c.id, c.isOpen)}
                >
                  <view className={cls('hc-cover-wrap')}>
                    <image className={cls('hc-cover')} src={cover(c.cover)} mode="aspectFill" />
                    {rank <= 3 ? (
                      <view className={cls('hc-rank')}>
                        <text className={cls('hc-rank-text')}>TOP {rank}</text>
                      </view>
                    ) : null}
                    <view
                      className={cls(fav ? 'hc-fav hc-fav-on' : 'hc-fav')}
                      catchtap={() => toggleFav(c.id)}
                    >
                      <text className={cls('hc-fav-icon')}>{fav ? '♥' : '♡'}</text>
                    </view>
                    <view className={cls('hc-cover-foot')}>
                      <text className={cls('hc-city')}>{c.id}</text>
                      <view className={cls('hc-meta')}>
                        <image src={QICON.star} mode="aspectFit" style={{ width: '11px', height: '11px', marginRight: '3px' }} />
                        <text className={cls('hc-rate')}>{c.rating}</text>
                        <text className={cls('hc-pipe')}>|</text>
                        <text className={cls('hc-visited')}>{c.visited}</text>
                      </view>
                    </view>
                  </view>
                  <view className={cls('hc-body')}>
                    <text className={cls('hc-desc')} text-maxline="1">{c.desc}</text>
                    <view className={cls('hc-tags')}>
                      <text className={cls('hc-tag hc-tag-days')}>{c.days}</text>
                      {c.tags.map((t) => (
                        <text key={t} className={cls('hc-tag')}>{t}</text>
                      ))}
                    </view>
                  </view>
                </view>
              );
            })}
          </view>
        )}
        <view className={cls('hc-bottom-space')} />
      </scroll-view>
    </view>
  );
}

/** 0 是「不限」，其余是用户选过的值 */
function isMaxDaysPicked(v: number): boolean {
  return v !== 0;
}
