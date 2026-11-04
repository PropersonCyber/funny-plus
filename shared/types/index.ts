// 领域模型对齐 PRD 7.3，字段名保持与后端实体同名，方便后续一个文件替换成接口类型。

export type Pace = 'relaxed' | 'balanced' | 'packed'
export type TransportMode = 'public' | 'car' | 'charter' | 'compare'
export type ItemKind = 'place' | 'meal'
export type TrustLevel = 'official' | 'credible' | 'experience' | 'pending'

/** 用户填写的旅行需求 */
export interface Demand {
  destination: string
  dayCount: number
  /** 同行人数，按实际人数参与预算与核载计算，不存区间 */
  party: number
  budgetLevel: 'low' | 'mid' | 'high' | 'flexible'
  preferences: string[]
  transport: TransportMode
  notes: string
}

export interface Place {
  id: string
  name: string
  city: string
  lng: number
  lat: number
  /** 开放时段，当日分钟数 */
  open: [number, number]
  /** 门票人均（元） */
  ticket: number
  /** 建议停留（分钟） */
  stayMin: number
  /** 步行强度 1-3 */
  walk: 1 | 2 | 3
  tags: string[]
  /** 展示用评分；运营口径，不参与排序或校验 */
  rating: number
  /** 展示用「多少万人去过」，单位：万人 */
  visitors: number
  /** 一句话种草（设计稿里景点条目的第二行）；缺省时界面退回营业时间 */
  hype?: string
  /** 营业时间与票价的来源；缺失时视为未核验，界面必须照实说 */
  source: string
  /** 核验日期 YYYY-MM-DD；没有记录就是没核验过，不要用今天顶上 */
  verifiedAt?: string
  /**
   * 可信状态：只有 official 才允许把营业时间冲突判成硬错误。
   * 营业时间与票价共用一档，MVP 不做逐字段分级。
   */
  trust: TrustLevel
}

export interface ItineraryItem {
  id: string
  kind: ItemKind
  title: string
  placeId?: string
  startMin: number
  endMin: number
  stayMin: number
  transportMin: number
  transportMode: TransportMode
  /**
   * 这段路上时间是怎么来的：route = 问过地图服务的真实路线时长，straight = 直线距离折算。
   * 必须随数据走——界面要标「估算」，用户才知道哪个到达时刻能信。
   */
  transportSource?: 'route' | 'straight'
  /** 该项人均花费（元） */
  cost: number
}

export interface TripDay {
  index: number
  items: ItineraryItem[]
}

/**
 * 预算分项的证据等级：每一项都要能回答「这个数字是怎么来的」。
 * estimate 来自集中常数，是估算；price 来自地点收录票价，但票价本身也只是公示价，
 * 所以它仍归到「待确认」，不能和已核验混在一起。
 */
export type Evidence = 'estimate' | 'price'

export interface BudgetItem {
  category: 'transport' | 'lodging' | 'tickets' | 'food' | 'other'
  amount: number
  /** 计算依据，结果页要展示，不能只给一个数字 */
  basis: string
  evidence: Evidence
}

export interface BudgetBreakdown {
  items: BudgetItem[]
  total: number
  perPerson: number
  /** 主要不确定项 */
  uncertain: string[]
}

export interface PlanIssue {
  code: string
  level: 'error' | 'warn' | 'info'
  dayIndex?: number
  message: string
}

export interface Plan {
  id: string
  pace: Pace
  paceLabel: string
  /** 方案实际采用的交通方式；compare 只是需求侧的「待比较」，不会落到这里 */
  transport: TransportMode
  destination: string
  suitableFor: string
  highlights: string[]
  days: TripDay[]
  budget: BudgetBreakdown
  issues: PlanIssue[]
}

export interface TravelFact {
  id: string
  city: string
  category: '预约与门票' | '交通与路线' | '额外消费' | '天气与人流' | '安全与健康' | '老人与小孩'
  content: string
  scope: string
  source: string
  sourceUrl?: string
  verifiedAt: string
  validUntil?: string
  trust: TrustLevel
}

/** 局部修改的变更影响，PRD 5.3 要求改完展示影响 */
export interface ChangeImpact {
  minutes: number
  cost: number
  recheck: string[]
  note: string
}

/** 避坑反馈：只存用户怎么反馈，不是可信度结论 */
export type FeedbackVerdict = 'met' | 'not-applicable'

export interface FactFeedbackSummary {
  factId: string
  met: number
  notApplicable: number
  /** 当前设备已提交的反馈；未提交为 null */
  mine: FeedbackVerdict | null
}

export interface SavedTrip {
  id: string
  demand: Demand
  plan: Plan
  savedAt: string
  versions: { at: string; note: string; impact?: ChangeImpact }[]
}

/** 城市：首页热门推荐 / 城市选择器 */
export interface City {
  id: string
  tag: string
  /** 前端资源 key（图片随包走），不是 URL */
  coverImage: string
  priceFrom: string
  rating: string
  visitedText: string
  desc: string
  /** 常见行程长度，如「1-2天」；详情页标题行直接用 */
  days: string
  /** 详情页「旅行小贴士」三行：图标 + 标签 + 一句建议 */
  tips: { icon: string; label: string; text: string }[]
  /** 已接入地点池，才能切过去生成方案 */
  isOpen: boolean
  sortOrder: number
}

/** 攻略：首页卡片 + 攻略详情页；body 空行分段 */
export interface Guide {
  id: string
  city: string
  title: string
  note: string
  coverImage: string
  views: number
  dayCount: number
  tags: string[]
  /** 攻略评分为运营口径，MVP 未接评价系统时只做展示，不参与任何计算 */
  rating: number
  /** 详情页标题下的一行标签，与 tags（筛选用）分开：这里是给人看的卖点词 */
  badges: string[]
  /** 详情页顶部的串珠，指向 places.json 里的真实景点，坐标与耗时由引擎派生 */
  placeIds: string[]
  body: string
}

/** 玩法：首页「爆款玩法」卡片，详情页按 placeIds 展开 */
export interface Play {
  id: string
  title: string
  note: string
  coverImage: string
  sortOrder: number
  /** 攻略/城市首屏按它筛：详情页只展示同城玩法 */
  city: string
  /** 行程卡右上角的胶囊，如「经典1日游」 */
  label: string
  /** 行程天数，与 label 里的数字同源 */
  days: number
  /** 行程卡底部三个小标：图标名 + 文字 */
  chips: { icon: string; text: string }[]
  /** 关联景点 id，顺序即推荐顺序 */
  placeIds: string[]
}

export type CollectTarget = 'place' | 'fact' | 'guide' | 'play'

/** 收藏：多态目标，一张表收四类对象 */
export interface Collection {
  id: string
  targetType: CollectTarget
  targetId: string
  createdAt: string
}

/** 足迹：一个景点一打卡 */
export interface Footprint {
  id: string
  city: string
  placeId: string
  visitedOn: string
}
