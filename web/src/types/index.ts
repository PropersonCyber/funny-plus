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
  /** 该项人均花费（元） */
  cost: number
}

export interface TripDay {
  index: number
  items: ItineraryItem[]
}

export interface BudgetItem {
  category: 'transport' | 'lodging' | 'tickets' | 'food' | 'other'
  amount: number
  /** 计算依据，结果页要展示，不能只给一个数字 */
  basis: string
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
  category: '预约与门票' | '交通与路线' | '额外消费' | '天气与人流'
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
