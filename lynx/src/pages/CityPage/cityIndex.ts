/**
 * 选择出发城市：索引数据与纯函数。
 *
 * 目录按设计稿铺全（地区数量、A/B 两组的顺序都对得上首屏）。
 * 点得进去的仍然只有地点池里 isOpen 的城市，其余点了提示暂未开放。
 * 组内顺序就是下面这份数据的顺序：设计稿里「北京」排在「保定」前面，
 * 不是拼音序，按 localeCompare 重排会对不上。
 */

export type TabKey = 'domestic' | 'overseas';

export type CityEntry = {
  /** 中文城市名，同时作为选中后回传给 App 的 id */
  id: string;
  /** 拼音首字母：分组的 key，也是右侧 A-Z 索引的顺序 */
  letter: string;
  region: RegionKey;
  /** 封面图资源 key，对应 assets/gen/<cover>.jpg。没有专属图的用成都兜底 */
  cover: string;
};

export type RegionKey = 'north' | 'east' | 'south' | 'central' | 'southwest' | 'northwest' | 'northeast' | 'hmt';

export type Region = {
  key: RegionKey;
  label: string;
  /** 地区图标：用 emoji 而非再画一套图，避免为 8 个宫格新增 8 张资源 */
  icon: string;
};

export const REGIONS: Region[] = [
  { key: 'north', label: '华北地区', icon: '🏯' },
  { key: 'east', label: '华东地区', icon: '🗼' },
  { key: 'south', label: '华南地区', icon: '🌴' },
  { key: 'central', label: '华中地区', icon: '⛰️' },
  { key: 'southwest', label: '西南地区', icon: '🐼' },
  { key: 'northwest', label: '西北地区', icon: '🏜️' },
  { key: 'northeast', label: '东北地区', icon: '❄️' },
  { key: 'hmt', label: '港澳台', icon: '🇭🇰' },
];

/** 有专属封面的城市。其余目录项不单独出图，列表本身是文字胶囊 */
const COVERS: Record<string, string> = {
  成都: 'chengdu',
  重庆: 'chongqing',
  北京: 'beijing',
  大理: 'dali',
  杭州: 'hangzhou',
  丽江: 'lijiang',
  西安: 'xian',
  张家界: 'zhangjiajie',
};

type Spec = [id: string, letter: string, region: RegionKey];

/**
 * 设计稿首屏能对上的两组写在最前面，后面按字母补齐。
 * 地区数量：华北 11、华东 26、华南 16、华中 16、西南 21、西北 12、东北 10、港澳台 3。
 */
const SPECS: Spec[] = [
  ['阿坝', 'A', 'southwest'],
  ['阿克苏', 'A', 'northwest'],
  ['阿勒泰', 'A', 'northwest'],
  ['阿拉善', 'A', 'northwest'],
  ['安康', 'A', 'northwest'],
  ['安庆', 'A', 'east'],
  ['安阳', 'A', 'central'],
  ['鞍山', 'A', 'northeast'],
  ['安顺', 'A', 'southwest'],
  ['澳门', 'A', 'hmt'],
  ['北京', 'B', 'north'],
  ['保定', 'B', 'north'],
  ['包头', 'B', 'north'],
  ['巴中', 'B', 'southwest'],
  ['北海', 'B', 'south'],
  ['白山', 'B', 'northeast'],
  ['滨州', 'B', 'east'],
  ['亳州', 'B', 'east'],
  ['毕节', 'B', 'southwest'],
  ['成都', 'C', 'southwest'],
  ['重庆', 'C', 'southwest'],
  ['承德', 'C', 'north'],
  ['常州', 'C', 'east'],
  ['潮州', 'C', 'south'],
  ['长沙', 'C', 'central'],
  ['长春', 'C', 'northeast'],
  ['大同', 'D', 'north'],
  ['大连', 'D', 'northeast'],
  ['大理', 'D', 'southwest'],
  ['敦煌', 'D', 'northwest'],
  ['东莞', 'D', 'south'],
  ['恩施', 'E', 'central'],
  ['福州', 'F', 'east'],
  ['佛山', 'F', 'south'],
  ['广州', 'G', 'south'],
  ['桂林', 'G', 'south'],
  ['贵阳', 'G', 'southwest'],
  ['呼和浩特', 'H', 'north'],
  ['杭州', 'H', 'east'],
  ['合肥', 'H', 'east'],
  ['黄山', 'H', 'east'],
  ['惠州', 'H', 'south'],
  ['海口', 'H', 'south'],
  ['衡阳', 'H', 'central'],
  ['哈尔滨', 'H', 'northeast'],
  ['嘉兴', 'J', 'east'],
  ['金华', 'J', 'east'],
  ['景德镇', 'J', 'east'],
  ['济南', 'J', 'east'],
  ['嘉峪关', 'J', 'northwest'],
  ['吉林', 'J', 'northeast'],
  ['开封', 'K', 'central'],
  ['昆明', 'K', 'southwest'],
  ['洛阳', 'L', 'central'],
  ['乐山', 'L', 'southwest'],
  ['泸州', 'L', 'southwest'],
  ['丽江', 'L', 'southwest'],
  ['拉萨', 'L', 'southwest'],
  ['林芝', 'L', 'southwest'],
  ['兰州', 'L', 'northwest'],
  ['柳州', 'L', 'south'],
  ['绵阳', 'M', 'southwest'],
  ['牡丹江', 'M', 'northeast'],
  ['南京', 'N', 'east'],
  ['南通', 'N', 'east'],
  ['宁波', 'N', 'east'],
  ['南昌', 'N', 'east'],
  ['南宁', 'N', 'south'],
  ['南阳', 'N', 'central'],
  ['南充', 'N', 'southwest'],
  ['秦皇岛', 'Q', 'north'],
  ['青岛', 'Q', 'east'],
  ['泉州', 'Q', 'east'],
  ['齐齐哈尔', 'Q', 'northeast'],
  ['日喀则', 'R', 'southwest'],
  ['石家庄', 'S', 'north'],
  ['上海', 'S', 'east'],
  ['苏州', 'S', 'east'],
  ['绍兴', 'S', 'east'],
  ['深圳', 'S', 'south'],
  ['汕头', 'S', 'south'],
  ['三亚', 'S', 'south'],
  ['十堰', 'S', 'central'],
  ['沈阳', 'S', 'northeast'],
  ['天津', 'T', 'north'],
  ['太原', 'T', 'north'],
  ['台北', 'T', 'hmt'],
  ['无锡', 'W', 'east'],
  ['温州', 'W', 'east'],
  ['武汉', 'W', 'central'],
  ['乌鲁木齐', 'W', 'northwest'],
  ['厦门', 'X', 'east'],
  ['襄阳', 'X', 'central'],
  ['湘西', 'X', 'central'],
  ['信阳', 'X', 'central'],
  ['西双版纳', 'X', 'southwest'],
  ['香格里拉', 'X', 'southwest'],
  ['西安', 'X', 'northwest'],
  ['西宁', 'X', 'northwest'],
  ['香港', 'X', 'hmt'],
  ['扬州', 'Y', 'east'],
  ['烟台', 'Y', 'east'],
  ['宜昌', 'Y', 'central'],
  ['岳阳', 'Y', 'central'],
  ['宜宾', 'Y', 'southwest'],
  ['延安', 'Y', 'northwest'],
  ['银川', 'Y', 'northwest'],
  ['延边', 'Y', 'northeast'],
  ['张家口', 'Z', 'north'],
  ['珠海', 'Z', 'south'],
  ['中山', 'Z', 'south'],
  ['湛江', 'Z', 'south'],
  ['郑州', 'Z', 'central'],
  ['张家界', 'Z', 'central'],
  ['遵义', 'Z', 'southwest'],
];

export const ALL_CITIES: CityEntry[] = SPECS.map(([id, letter, region]) => ({
  id,
  letter,
  region,
  cover: COVERS[id] ?? 'chengdu',
}));

/** 热门位：横向滑动的 5 张大图，按展示顺序排 */
export const HOT_IDS = ['成都', '重庆', '北京', '杭州', '西安'];

/**
 * 热门位的封面映射。杭州、西安还没有地点池（不在可规划城市里），
 * 所以这里单独给它们一份 key，不依赖「能不能点进去」。
 */
export const HOT_COVERS: Record<string, string> = {
  成都: 'chengdu',
  重庆: 'chongqing',
  北京: 'beijing',
  杭州: 'hangzhou',
  西安: 'xian',
};

export type CityGroup = { letter: string; cities: CityEntry[] };

/**
 * 按首字母分组。字母升序，组内保持数据顺序。
 * 空城市的分组直接不产出——右侧索引用灰色字母表示「这里没有」，而不是藏掉。
 */
export function groupByLetter(cities: CityEntry[]): CityGroup[] {
  const map = new Map<string, CityEntry[]>();
  for (const c of cities) {
    const bucket = map.get(c.letter);
    if (bucket) bucket.push(c);
    else map.set(c.letter, [c]);
  }
  return [...map.keys()]
    .sort()
    .map((letter) => ({ letter, cities: map.get(letter) ?? [] }));
}

/** 地区宫格：数量现算，没有城市的地区返回 0，由调用方决定是否隐藏 */
export function countByRegion(cities: CityEntry[]): { region: Region; count: number }[] {
  return REGIONS.map((region) => ({
    region,
    count: cities.filter((c) => c.region === region.key).length,
  }));
}

/** 关键词过滤：城市名包含即命中，忽略首尾空格 */
export function matchCities(cities: CityEntry[], keyword: string): CityEntry[] {
  const kw = keyword.trim();
  if (!kw) return cities;
  return cities.filter((c) => c.id.indexOf(kw) >= 0);
}

/** 右侧字母索引是完整 A-Z。没有城市的字母 enabled=false，点了不滚 */
export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export function indexLetters(groups: CityGroup[]): { letter: string; enabled: boolean }[] {
  const has = new Set(groups.map((g) => g.letter));
  return LETTERS.map((letter) => ({ letter, enabled: has.has(letter) }));
}
