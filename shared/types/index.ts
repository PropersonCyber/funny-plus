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
  /** 开放时段，当日分钟数。多档营业时间取最保守的交集（见 scripts/verify-amap.ts） */
  open: [number, number]
  /** 高德原始营业时间文本（含季节区间、停止检票、周几闭馆）；有它才能让人复核上面的时段怎么来的 */
  openText?: string
  /**
   * 门票人均（元）；null = 票价未核实，界面必须显示「暂无票价」。
   * 不要用 0 顶替未知：0 的含义是免费，把未知写成 0 等于对外撒谎。
   */
  ticket: number | null
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

/**
 * lineId 为空 = 普通两点移动，时间来自 placeIndex 的路线或直线折算。
 */
export interface TransitLine {
  id: string
  city: string
  name: string
  mode: LineMode
  /** 有序站点，>=2 才算一条线（单站线路视为数据错误，种子时会跳过） */
  stops: LineStop[]
  /** 当日分钟数；null = 未核验，界面走「暂无数据」空态并要求补录，不许拿营业时间顶上 */
  firstBus: number | null
  lastBus: number | null
  intervalMin: number | null
  /** 票种与票价；price=null 表示票种存在但票价未核实 */
  tickets: LineTicket[]
  /** 是否必须提前购票/预约；null = 未核验 */
  needAdvance: boolean | null
  /** 单班核载（人）；null = 未核验，人数结论只能降级为区间 */
  capacity: number | null
  /** 单程乘车耗时（分钟），不含候车；null = 未核验 */
  rideMin: number | null
  /** 季节/停运说明，如「冬季停航」，没有就留空 */
  seasonNote?: string
  /** 行程里排了这个地点，就等于「在这儿乘车」，用来把线路和已有地点池接上 */
  rideAtPlaceId?: string
  source: string
  sourceUrl?: string
  verifiedAt?: string
  trust: TrustLevel
  /**
   * 演示数据：班次与票价为构造值，专供验证「冲突能拦截」，不是真实运营时间。
   * 界面必须显式标注，不能和真实线路混在一起展示。
   */
  isDemo?: boolean
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
  /**
   * 这一段是不是坐线路型交通走的（FR-01）。有它就是「按班次发车」，
   * 到达时刻取决于最近的发车时间，不再是「从上一站开过去多少分钟」。
   */
  lineId?: string
  /** 乘车候车时间（分钟）；普通路段为 null。等太久要提示，但不算冲突 */
  waitMin?: number | null
  /**
   * 该项人均花费（元）；null = 票价未核实（继承 Place.ticket 的 null）。
   * 预算求和按 0 计入并单独提示「未核实」，不能既当免费又不说明。
   */
  cost: number | null
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

/**
 * 一条校验结果。
 * id 让「这条不对」能把误报精确指回某一条，没有 id 就没法统计误报率（PRD 八）。
 */
export interface PlanIssue {
  id: string
  code: string
  level: 'error' | 'warn' | 'info'
  dayIndex?: number
  message: string
  /** 涉及的线路（交通类问题才有），用于跳线路卡 */
  lineId?: string
  /**
   * 出现 error 时必须同时给至少一条出路（FR-02）。
   * 连一条都给不出时，界面要明说「暂无可替代方案，请手动调整」，不能留白。
   */
  alternatives?: IssueAlternative[]
}

/** 硬约束的替代方案：改哪类动作、落到什么值、能省/避免什么 */
export interface IssueAlternative {
  kind: 'advance' | 'switch-mode' | 'change-spot'
  label: string
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

/**
 * 人数 → 交通结论（FR-03）。
 * 钱与时间永远并列，不做「时间折算成钱」的综合分：那需要引入主观时间单价，
 * 等于把不确定包装成精确。数据不全时降级成区间并标清假设。
 */
export interface TransportAdvice {
  party: number
  /** 参与比较的两种方式；switchTo 是建议切换的目标 */
  options: TransportOption[]
  /** 一句话结论；两端都不占优时明确写「两者接近」 */
  verdict: string
  /** 数据不全时的降级说明，例如「按 4 人/车、¥60/车估」 */
  assumptions: string[]
  /** true = 只比了票价或只比了时间，缺另一维数据 */
  partial: boolean
}

export interface TransportOption {
  mode: 'taxi' | 'line' | 'public'
  label: string
  /** 这段行程的合计花费（元）；null = 票价未核实 */
  cost: number | null
  /** 合计时间（含候车/等车，分钟）；null = 时长未核实 */
  minutes: number | null
  /** 计算依据，必须逐项写清，例如「2 辆 × ¥60」「5 张 × ¥25」 */
  basis: string
}

/**
 * 一条事实的三种来路，决定它能不能被写成「已核验」。
 *
 * canonical = 从库里读到的那份（种子 / 已核验数据 / 后来改过的）；bundled = 随包
 * data/*.json 的构建期快照；server = 本次会话从接口拉回来的。
 *
 * 为什么要带在数据上而不是查全局标记：客户端会先用随包副本渲染、接口回来再覆盖，
 * 中间那段时间里界面上就是一份「构建期快照」。把它标成已核验，等于拿旧数据冒充新核验。
 * 这个字段只走内存与本机缓存，不入库、不进接口。
 */
export type FactOrigin = 'canonical' | 'bundled' | 'server'

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
  /**
   * 这条信息挂到哪个 POI（FR-04）。区域级条目（如「渝中半岛」）不填 placeId，
   * 靠 scope 文字说明适用范围——不填就是「不针对某个点」，不能默认人人都适用。
   */
  placeId?: string
  /** POI 详情页的分组；缺省时按 category 推导，避免历史数据全要补一遍 */
  poiGroup?: 'pitfall' | 'access' | 'eat' | 'stay'
  /** 这条是从哪来的（见 FactOrigin）；缺省视为 canonical，保持旧数据与测试不用改 */
  origin?: FactOrigin
}

/** 局部修改的变更影响，PRD 5.3 要求改完展示影响 */
export interface ChangeImpact {
  minutes: number
  cost: number
  recheck: string[]
  note: string
}

/**
 * 模型提议的一次行程修改。
 *
 * 只允许引用既有的 item.id / place.id，**不携带任何时刻、金额**：
 * 改哪个点由模型选，改成几点、花多少钱由引擎按收录数据算。
 * 一旦允许模型自己写数字，它就会给出一个自洽但错误的价格，而用户没有能力分辨。
 */
export type ReviseOp =
  | { op: 'drop'; day: number; targetId: string; reason: string }
  | { op: 'replace'; day: number; targetId: string; withPlaceId: string; reason: string }
  | { op: 'reorder'; day: number; order: string[]; reason: string }

/** 一条受影响的安排：确认前要逐条告诉用户「哪条变了、变成什么」，只给一个总差额不够 */
export interface AffectedChange {
  kind: 'removed' | 'replaced' | 'retimed'
  title: string
  /** 例如「已移出这一天」「换成「某某」」「14:00 → 15:30」 */
  detail: string
}

/**
 * 修改预览：确认前只存在内存里，取消即丢，原方案一个字段都不动。
 * by 用来区分「模型理解的」还是「模型不可用时的本地兜底」，界面上要照实说。
 */
export interface RevisePreview {
  plan: Plan
  impact: ChangeImpact
  affected: AffectedChange[]
  reason: string
  by: 'model' | 'engine'
}

/**
 * 一次旅行在接口里的身份。
 *
 * ownerId 是账号归属，未接登录时为空；设备 id 只做「同一台设备只记一次」的去重，
 * 不是所有者——把 clientId 当账号，换设备就找不回行程，接登录时数据也没法迁移。
 */
export interface TripContext {
  tripId: string
  ownerId?: string
  demand: Demand
  plan: Plan
}

/** 避坑反馈：只存用户怎么反馈，不是可信度结论 */
export type FeedbackVerdict = 'met' | 'not-applicable'

/** 用户能补的字段：每个都对应一个界面上「暂无数据」的位置（FR-05） */
export type SubmitField = 'firstBus' | 'lastBus' | 'intervalMin' | 'ticket' | 'openText' | 'fact'

/**
 * 一条用户补录。
 * status 恒为 pending 起步：用户填报只能让行程 warn，不能判 error（FR-05/06）。
 */
export interface DataSubmission {
  id: string
  scope: 'line' | 'place' | 'fact'
  targetId: string
  field: SubmitField
  value: string
  note?: string
  clientId: string
  status: 'pending' | 'verified' | 'rejected'
  createdAt: string
}

/** 「这条不对」上报；误报率 = 上报数 / 硬提示数 */
export interface ConstraintReport {
  issueId: string
  ruleCode: string
  trustLevel: string
  planId?: string
  note?: string
}

export interface FactFeedbackSummary {
  factId: string
  met: number
  notApplicable: number
  /** 当前设备已提交的反馈；未提交为 null */
  mine: FeedbackVerdict | null
}

/**
 * 云端一条行程的完整形态。
 *
 * 为什么把 `plans` / `planIndex` / `endedAt` 都带上（G5）：
 * 早先只推 `demand + plan`（用户当前选中的那一套），于是「保存了 3 份行程、结束了其中 1 份」
 * 换设备登录后只剩 1 份且状态全丢 —— 这种「承诺了能找回、实际找不回」比不做更伤。
 *
 * 刻意不再有 `plan` 字段：选中的那一套由 `plans[planIndex]` 算出来，
 * 两处都存迟早对不上。服务端库里仍保留 plan 列，那是为了读旧行，不出现在协议里。
 */
export interface SavedTrip {
  id: string
  demand: Demand
  /** 全部方案，至少一套 */
  plans: Plan[]
  /** 选中的是第几套；越界由服务端钳到合法范围 */
  planIndex: number
  savedAt: string
  versions: { at: string; note: string; impact?: ChangeImpact }[]
  /** 用户主动结束旅行的时刻；不传 = 还在进行中 */
  endedAt?: string
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

/** 线路型交通的种类；决定界面文案与图标，不参与计算 */
export type LineMode = 'sightseeing' | 'shuttle' | 'cableway' | 'escalator' | 'ferry'

/** 线路站点：坐标来自 POI 核验（scripts/verify-lines.ts），不是手敲的 */
export interface LineStop {
  name: string
  lng: number
  lat: number
  /** 该站同时是我们收录的地点时挂上，点站点能进 POI 详情 */
  placeId?: string
}

export interface LineTicket {
  kind: string
  /** null = 这个票种存在但票价未核实，界面显示「暂无票价」 */
  price: number | null
  note?: string
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

/**
 * 照片引用。
 *
 * 为什么存 ref 而不是裸路径：照片来源会变（现在只能从 Web 选成 dataUri，
 * 将来是壳层给本地文件、或上传后拿到的远端 URL）。收敛成一个带 kind 的结构后，
 * 换通道只改 photo.ts 的解析，回忆页和存储层不用跟着改第二遍。
 *
 * kind: 'local' 是「壳层已给本地文件、但还没上传」的中间态，只在同一台设备可见；
 * 上传成功后改写成 'remote'。
 */
export type PhotoRef =
  | {
      id: string
      kind: 'remote'
      /** 可直接塞进 <image src> 的地址 */
      value: string
      addedAt: string
    }
  | {
      id: string
      kind: 'local'
      /** 壳层给的本地文件路径；换设备就失效 */
      value: string
      addedAt: string
    }
  | {
      id: string
      kind: 'dataUri'
      /** 内联图片：只用于 Web 预览与小图，本机存储，换设备失效 */
      value: string
      addedAt: string
    }

/**
 * 一条地点记录：用户对某个已排安排的实际经历。
 *
 * planRef 指向 PlanItem.id，不是地点 id —— 同一地点可能在不同天各排一次，
 * 按地点 id 记会把两天的体验混成一条。
 *
 * visited 三态而非布尔：unknown 表示用户没说，绝不能默认当成「去了」。
 * 分享页区分亲历/非亲历就靠它。
 */
export interface PlaceNote {
  /** 对应 PlanItem.id */
  planRef: string
  dayIndex: number
  placeId: string
  /** 地点名快照：方案重算后 planRef 可能失效，名字仍要能显示 */
  placeTitle: string
  visited: 'yes' | 'no' | 'unknown'
  /** 用户写的感受 */
  text: string
  photos: PhotoRef[]
  updatedAt: string
}

/**
 * 一趟旅行的私人回忆。
 *
 * 与 SavedTrip 分开存：行程是「计划」，回忆是「实际发生」。混在一份里会导致
 * 改行程时把已写的回忆一起冲掉，而回忆恰恰是用户最不愿意丢的部分。
 */
export interface TripMemory {
  tripId: string
  /** 整趟旅行的回顾文字 */
  overview: string
  /** 整趟旅行的照片 */
  photos: PhotoRef[]
  /** 按地点的记录，key 为 PlanItem.id */
  places: Record<string, PlaceNote>
  createdAt: string
  updatedAt: string
}

/**
 * 攻略草稿：从私人回忆里挑出一部分，整理成能给人看的版本。
 *
 * 为什么是「草稿」而不是直接生成分享页：攻略要公开发布，草稿阶段的每一步都必须是
 * 用户选的，不能替他决定「哪些内容可以公开」。发布能力（链接、快照、撤回）等账号与
 * 服务端能力就绪后再接，本结构已经能完整承载编辑结果。
 *
 * 三条隐私约束直接写进结构：
 * 1. sections 只收录用户勾选的地点 —— 没选的不进结构，不是「渲染时藏起来」。
 * 2. showCost 默认 false：费用不默认公开。
 * 3. 不带精确位置历史、同行人、私人备注（那些字段压根不在这里）。
 */
export interface GuideDraft {
  id: string
  /** 来源行程；草稿与旅程一一对应，换行程重新生成 */
  tripId: string
  /** 用户可改的标题 */
  title: string
  /** 用户可改的开头概述 */
  summary: string
  /**
   * 用户勾选进攻略的封面照片（从回忆里挑）。默认空 —— 照片是隐私开关，
   * 默认值必须是「不公开」，不能替用户挑好带出去。
   */
  photos: PhotoRef[]
  /** 是否公开费用区间；默认不公开 */
  showCost: boolean
  /**
   * 用户勾选进攻略的条目，key 为 PlanItem.id。
   *
   * 为什么单独一份而不是「sections 里有就是选中」：sections 承载全部候选内容，
   * 用它兼作勾选状态会让「默认只勾去过的」这个规则无处存放 —— 早先的实现就是这么
   * 错的，结果 Day 2 三个没记过的地点全被当成已选中。
   */
  picked: Record<string, boolean>
  sections: GuideSection[]
  createdAt: string
  updatedAt: string
}

/**
 * 攻略里的一天。
 *
 * visited 从 PlaceNote 拷过来原样保留：分享页要把「亲历」和「只是计划过」
 * 分开呈现，不能让读者把没确认到访的地方当成人去过。这里不做过滤 ——
 * 用户选进来就展示，但标签必须如实。
 */
export interface GuideSection {
  dayIndex: number
  items: GuideSectionItem[]
}

export interface GuideSectionItem {
  planRef: string
  placeTitle: string
  /** 从回忆带过来的感受；用户在这里可以再改 */
  text: string
  visited: 'yes' | 'no' | 'unknown'
  photos: PhotoRef[]
}

/**
 * 一次发布的内容快照（F08 后半）。
 *
 * 与 GuideDraft 刻意不同的三处：
 * 1. 没有 id / tripId / picked —— 访客不需要知道内部标识，`picked` 在选择阶段已经用完。
 * 2. `sections` 只含用户勾选的条目；没勾的不在这里，不是渲染时藏起来。
 * 3. `perPerson` 是客户端发布时算好传上来的：费用属于行程而不属于攻略草稿，
 *    服务端不该为了一个展示字段去重跑一遍预算引擎。
 *
 * 照片只留 `kind: 'remote'` —— 由服务端 `stripLocalPhotos` 保证，结构上仍用 PhotoRef
 * 是为了与回忆、草稿共用同一套渲染口径。
 */
export interface GuideShareSnapshot {
  title: string
  summary: string
  /** 用户选的封面照片，按顺序展示 */
  photos: PhotoRef[]
  showCost: boolean
  /** 仅在 showCost 为 true 时有值 */
  perPerson?: number
  sections: GuideSection[]
  /** 发布时刻，ISO 串 */
  publishedAt: string
}

/** 公开分享接口的响应：快照 + 作者公开昵称（不含任何账号标识） */
export interface GuideShareView {
  snapshot: GuideShareSnapshot
  /** 形如 `u***1234`；作者没留手机号时为空串 */
  authorLabel: string
  /** 撤回或不存在时为 false，前端据此显示引导文案 */
  valid: boolean
}
