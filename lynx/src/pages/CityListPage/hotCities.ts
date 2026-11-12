/**
 * 热门城市列表页的数据与筛选口径。
 *
 * 这一版是设计稿还原：城市清单、评分、人数都是**假数据**，用来把 UI 跑通。
 * 真实数据要等 cities 表补齐分类字段（category / crowd / months / minDays）之后
 * 从 /api/content 拿，届时只需把 HOT_CITIES 换成后端返回值，页面代码不用动。
 */

export type HotCity = {
  id: string;
  /** 封面图资源 key，对应 assets/gen/<key>.jpg */
  cover: string;
  /** 一句卖点，卡片标题下那行 */
  desc: string;
  rating: string;
  visited: string;
  /** 行程长度标签，如「2-3天」 */
  days: string;
  /** 卡片底部三个标签 */
  tags: string[];
  /** 分类归属，对应顶部 chips */
  categories: CategoryKey[];
  /** 适合人群，对应「适合人群」筛选 */
  crowds: CrowdKey[];
  /** 最佳出行月份，对应「出发时间」筛选 */
  months: number[];
  /** 最少需要几天，对应「旅行天数」筛选 */
  minDays: number;
  /** 已接入地点池才能真的点进去规划 */
  isOpen: boolean;
};

export type CategoryKey = 'hot' | 'nature' | 'history' | 'food' | 'family';
export type CrowdKey = 'solo' | 'couple' | 'family' | 'friends';

export const CATEGORIES: { key: CategoryKey; label: string }[] = [
  { key: 'hot', label: '热门城市' },
  { key: 'nature', label: '自然风光' },
  { key: 'history', label: '人文历史' },
  { key: 'food', label: '美食打卡' },
  { key: 'family', label: '亲子出游' },
];

export const CROWDS: { key: CrowdKey; label: string }[] = [
  { key: 'solo', label: '独自旅行' },
  { key: 'couple', label: '情侣出行' },
  { key: 'family', label: '带娃家庭' },
  { key: 'friends', label: '朋友结伴' },
];

export const DAY_FILTERS = [
  { key: 0, label: '不限' },
  { key: 2, label: '2天内' },
  { key: 3, label: '3天内' },
  { key: 4, label: '4天以上' },
];

export const MONTH_FILTERS = [
  { key: 0, label: '不限' },
  { key: 3, label: '春季 3-5月' },
  { key: 6, label: '夏季 6-8月' },
  { key: 9, label: '秋季 9-11月' },
  { key: 12, label: '冬季 12-2月' },
];

export const HOT_CITIES: HotCity[] = [
  {
    id: '成都',
    cover: 'chengdu',
    desc: '美食之都，慢享生活',
    rating: '4.8',
    visited: '23.5万人去过',
    days: '2-3天',
    tags: ['美食', '熊猫', '古街'],
    categories: ['hot', 'food', 'family'],
    crowds: ['couple', 'family', 'friends'],
    months: [3, 4, 5, 9, 10, 11],
    minDays: 2,
    isOpen: true,
  },
  {
    id: '重庆',
    cover: 'chongqing',
    desc: '山城奇观，夜景迷人',
    rating: '4.8',
    visited: '18.7万人去过',
    days: '2-3天',
    tags: ['夜景', '火锅', '江景'],
    categories: ['hot', 'food'],
    crowds: ['friends', 'couple'],
    months: [4, 5, 6, 9, 10],
    minDays: 2,
    isOpen: true,
  },
  {
    id: '北京',
    cover: 'beijing',
    desc: '红墙金瓦，胡同烟火',
    rating: '4.8',
    visited: '20.1万人去过',
    days: '3-4天',
    tags: ['历史', '古建筑', '京味'],
    categories: ['hot', 'history', 'family'],
    crowds: ['family', 'solo'],
    months: [4, 5, 9, 10],
    minDays: 3,
    isOpen: true,
  },
  {
    id: '杭州',
    cover: 'hangzhou',
    desc: '西湖如画，诗意江南',
    rating: '4.7',
    visited: '16.9万人去过',
    days: '2-3天',
    tags: ['西湖', '古镇', '园林'],
    categories: ['hot', 'nature', 'history'],
    crowds: ['couple', 'family'],
    months: [3, 4, 5, 9, 10],
    minDays: 2,
    isOpen: false,
  },
  {
    id: '大理',
    cover: 'dali',
    desc: '风花雪月，洱海慢生活',
    rating: '4.7',
    visited: '14.2万人去过',
    days: '3-4天',
    tags: ['洱海', '古城', '骑行'],
    categories: ['hot', 'nature'],
    crowds: ['couple', 'solo', 'friends'],
    months: [3, 4, 5, 6, 9, 10, 11],
    minDays: 3,
    isOpen: false,
  },
  {
    id: '丽江',
    cover: 'lijiang',
    desc: '古城雪山，浪漫惬意',
    rating: '4.7',
    visited: '13.8万人去过',
    days: '3-4天',
    tags: ['古城', '雪山', '民族风'],
    categories: ['hot', 'nature', 'history'],
    crowds: ['couple', 'friends'],
    months: [4, 5, 6, 9, 10, 11],
    minDays: 3,
    isOpen: false,
  },
  {
    id: '西安',
    cover: 'xian',
    desc: '千年古都，秦风唐韵',
    rating: '4.8',
    visited: '19.5万人去过',
    days: '2-3天',
    tags: ['历史', '兵马俑', '美食'],
    categories: ['hot', 'history', 'food', 'family'],
    crowds: ['family', 'solo', 'friends'],
    months: [3, 4, 5, 9, 10, 11],
    minDays: 2,
    isOpen: false,
  },
  {
    id: '张家界',
    cover: 'zhangjiajie',
    desc: '峰林云海，山水秘境',
    rating: '4.7',
    visited: '11.6万人去过',
    days: '3-4天',
    tags: ['峰林', '云海', '徒步'],
    categories: ['hot', 'nature'],
    crowds: ['friends', 'solo'],
    months: [4, 5, 6, 9, 10],
    minDays: 3,
    isOpen: false,
  },
];

/** 季节筛选的 key 是起始月：12 表示跨年（12、1、2） */
function monthMatches(months: number[], filterKey: number): boolean {
  if (filterKey === 0) return true;
  if (filterKey === 12) return months.some((m) => m === 12 || m === 1 || m === 2);
  if (filterKey === 3) return months.some((m) => m >= 3 && m <= 5);
  if (filterKey === 6) return months.some((m) => m >= 6 && m <= 8);
  if (filterKey === 9) return months.some((m) => m >= 9 && m <= 11);
  return true;
}

export type FilterState = {
  category: CategoryKey | 'all';
  maxDays: number;
  crowd: CrowdKey | 'all';
  month: number;
};

/** 四个筛选口径同时生效，任一不满足即剔除 */
export function filterCities(list: HotCity[], f: FilterState): HotCity[] {
  return list.filter((c) => {
    if (f.category !== 'all' && !c.categories.includes(f.category)) return false;
    // 4 表示「4天以上」，不是「4天内」，这里要反着比
    if (f.maxDays === 4 && c.minDays < 4) return false;
    if (f.maxDays > 0 && f.maxDays < 4 && c.minDays > f.maxDays) return false;
    if (f.crowd !== 'all' && !c.crowds.includes(f.crowd)) return false;
    if (!monthMatches(c.months, f.month)) return false;
    return true;
  });
}
