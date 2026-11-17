import { boolean, date, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import type { ChangeImpact, Demand, LineStop, LineTicket, Plan } from '@/types/index.ts'

const TRUST = ['official', 'credible', 'experience', 'pending'] as const

/**
 * 行程：client_id 为 null 的是内置示例行程，所有设备都能读到；
 * 用户自己保存的行程仍在本机 localStorage，做云端档案时再往这里写。
 */
export const trips = pgTable(
  'trips',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id'),
    demand: jsonb('demand').$type<Demand>().notNull(),
    plan: jsonb('plan').$type<Plan>().notNull(),
    savedAt: timestamp('saved_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index('trips_client_idx').on(t.clientId)]
)

/** 每次局部修改记一版，impact 由服务端算好存下，不靠前端回显 */
export const tripVersions = pgTable(
  'trip_versions',
  {
    id: text('id').primaryKey(),
    tripId: text('trip_id').notNull(),
    note: text('note').notNull(),
    impact: jsonb('impact').$type<ChangeImpact>(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index('trip_versions_trip_idx').on(t.tripId)]
)

/**
 * 地点池：原来是前端 fixture，落库后前端启动时预热一次拿全量，接口是唯一来源。
 * open 是当日分钟数区间（例：[540, 1380] = 9:00-23:00），拆成两列避免依赖 PG 数组下标。
 */
export const places = pgTable(
  'places',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    city: text('city').notNull(),
    lng: doublePrecision('lng').notNull(),
    lat: doublePrecision('lat').notNull(),
    openStart: integer('open_start').notNull(),
    openEnd: integer('open_end').notNull(),
    /** 高德原始营业时间文本；可追溯「时段是怎么来的」，没有就是没核验过 */
    openText: text('open_text'),
    /** 门票人均（元）；null = 票价未核实，不能用 0 冒充免费 */
    ticket: integer('ticket'),
    /** 建议停留（分钟） */
    stayMin: integer('stay_min').notNull(),
    /** 步行强度 1-3 */
    walk: integer('walk').notNull(),
    tags: text('tags').array().notNull(),
    /** 展示用评分，运营录入；不参与行程计算或校验 */
    rating: doublePrecision('rating').notNull().default(0),
    /** 展示用「多少万人去过」，单位万人 */
    visitors: doublePrecision('visitors').notNull().default(0),
    /** 一句话种草，详情页条目第二行；没有就用营业时间兜底 */
    hype: text('hype'),
    /**
     * 营业时间与票价的出处。缺了这三个字段，界面就只能把整理口径当事实展示，
     * 等于把「我们没核过」写在用户脸上。
     */
    source: text('source').notNull().default('产品组按公开信息整理（未做官方核验）'),
    verifiedAt: date('verified_at'),
    trust: text('trust', { enum: TRUST }).notNull().default('pending'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index('places_city_idx').on(t.city)]
)

/**
 * 避坑信息：人工核验内容，种子数据在 src/db/seed.ts。
 * 服务端不做过期过滤 —— A2 要求「默认折叠并告知还有 N 条」，这得前端拿到全量才分得清。
 * 过期判断依据 valid_until 与当天日期比较，没有有效期的条目视为无法判过期、保持可见。
 */
export const facts = pgTable(
  'facts',
  {
    id: text('id').primaryKey(),
    city: text('city').notNull(),
    category: text('category').notNull(),
    content: text('content').notNull(),
    scope: text('scope').notNull(),
    source: text('source').notNull(),
    sourceUrl: text('source_url'),
    verifiedAt: date('verified_at').notNull(),
    validUntil: date('valid_until'),
    trust: text('trust', { enum: TRUST }).notNull(),
    /** FR-04：挂到具体 POI；区域级条目不填，靠 scope 说明适用范围 */
    placeId: text('place_id'),
    /** POI 详情页分组：坑 / 进出 / 吃 / 住，缺省按 category 推导 */
    poiGroup: text('poi_group', { enum: ['pitfall', 'access', 'eat', 'stay'] }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index('facts_city_idx').on(t.city), index('facts_place_idx').on(t.placeId)]
)

/**
 * 避坑反馈：匿名，靠浏览器本地生成的 clientId 去重，不引入账号。
 * 只存「用户怎么反馈」，不存可信度结论 —— 是否根据反馈调整 trust 是产品规则，服务端不擅自判。
 */
export const factFeedbacks = pgTable(
  'fact_feedbacks',
  {
    id: text('id').primaryKey(),
    factId: text('fact_id').notNull(),
    verdict: text('verdict', { enum: ['met', 'not-applicable'] }).notNull(),
    /** 一句话补充，有长度上限，服务端再校验一次 */
    note: text('note'),
    clientId: text('client_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index('fact_feedbacks_fact_id_idx').on(t.factId),
    uniqueIndex('fact_feedbacks_fact_client_uq').on(t.factId, t.clientId)
  ]
)

/**
 * 城市：首页「热门推荐」、城市选择器、地图空态都读它。
 * places.city / facts.city / guides.city 都指向这里（文本主键用城市名，前端直接展示，不做二次映射）。
 * is_open = 该城市已接入地点池，没接入的只能展示、不能切过去生成方案。
 */
export const cities = pgTable('cities', {
  id: text('id').primaryKey(),
  tag: text('tag').notNull(),
  /** 前端资源 key，不是 URL：图片随包走，避免首屏多一轮请求 */
  coverImage: text('cover_image').notNull(),
  priceFrom: text('price_from').notNull(),
  rating: text('rating').notNull(),
  visitedText: text('visited_text').notNull(),
  desc: text('desc').notNull(),
  /** 常见行程长度，如「1-2天」 */
  days: text('days').notNull().default(''),
  /** 详情页「旅行小贴士」：图标 + 标签 + 一句建议，固定三行 */
  tips: jsonb('tips').$type<{ icon: string; label: string; text: string }[]>().notNull().default([]),
  isOpen: boolean('is_open').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0)
})

/** 攻略：首页「精选攻略」卡片 + 攻略详情页；body 用空行分段，前端不解析富文本 */
export const guides = pgTable(
  'guides',
  {
    id: text('id').primaryKey(),
    city: text('city').notNull(),
    title: text('title').notNull(),
    note: text('note').notNull(),
    coverImage: text('cover_image').notNull(),
    /** 原始浏览数，格式化（12.3 万）放前端，服务端不存展示字符串 */
    views: integer('views').notNull().default(0),
    dayCount: integer('day_count').notNull(),
    tags: text('tags').array().notNull(),
    /** 攻略评分：运营录入的展示值，不参与任何计算 */
    rating: doublePrecision('rating').notNull().default(0),
    /** 标题下的卖点词，与 tags（筛选用）分开 */
    badges: text('badges').array().notNull().default([]),
    /** 详情页串珠指向的景点，只被整组读取，所以不入 join 表 */
    placeIds: text('place_ids').array().notNull().default([]),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index('guides_city_idx').on(t.city)]
)

/** 玩法：首页「爆款玩法」四张卡，详情页按 play_places 列出该玩法包含哪些景点 */
export const plays = pgTable('plays', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  note: text('note').notNull(),
  coverImage: text('cover_image').notNull(),
  /** 玩法归属城市：城市详情页只展示同城玩法 */
  city: text('city').notNull().default(''),
  /** 行程卡右上角胶囊，如「经典1日游」 */
  label: text('label').notNull().default(''),
  days: integer('days').notNull().default(1),
  /** 行程卡底部小标：图标名 + 文字 */
  chips: jsonb('chips').$type<{ icon: string; text: string }[]>().notNull().default([]),
  sortOrder: integer('sort_order').notNull().default(0)
})

/** 玩法 ↔ 地点：多对多，sort_order 决定详情页里的推荐顺序 */
export const playPlaces = pgTable(
  'play_places',
  {
    playId: text('play_id').notNull(),
    placeId: text('place_id').notNull(),
    sortOrder: integer('sort_order').notNull().default(0)
  },
  (t) => [primaryKey({ columns: [t.playId, t.placeId] })]
)

/**
 * 收藏：多态目标（place / fact / guide / play），所以不建外键 ——
 * 一张表收四类对象，用 target_type 区分；写入前服务端校验目标存在。
 */
export const collections = pgTable(
  'collections',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull(),
    targetType: text('target_type', { enum: ['place', 'fact', 'guide', 'play'] }).notNull(),
    targetId: text('target_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex('collections_client_target_uq').on(t.clientId, t.targetType, t.targetId),
    index('collections_client_idx').on(t.clientId)
  ]
)

/**
 * 足迹：一次「打卡」一条。city 冗余存一份，是为了「去过几个城市」这类聚合不用连表。
 * 同一天同一景点重复点 = 幂等，不叠加。
 */
export const footprints = pgTable(
  'footprints',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull(),
    city: text('city').notNull(),
    placeId: text('place_id').notNull(),
    visitedOn: date('visited_on').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex('footprints_client_place_day_uq').on(t.clientId, t.placeId, t.visitedOn),
    index('footprints_client_idx').on(t.clientId)
  ]
)

/**
 * 线路（FR-01）：观光车 / 摆渡车 / 索道 / 大扶梯 / 游船。
 *
 * 独立成表而不是给 places 加字段：一条线把几个点连起来，末班和票种属于「线」，
 * 挂到单个站点上，换个站就查不到了。
 * first_bus / last_bus / interval_min / ride_min 允许为 null —— null 的含义是「未核验」，
 * 界面据此走「暂无数据 + 补录入口」，不能用营业时间或估算值顶上。
 */
export const lines = pgTable(
  'lines',
  {
    id: text('id').primaryKey(),
    city: text('city').notNull(),
    name: text('name').notNull(),
    mode: text('mode', { enum: ['sightseeing', 'shuttle', 'cableway', 'escalator', 'ferry'] }).notNull(),
    /** 有序站点 [{name,lng,lat,placeId?}]；站点坐标来自 POI 核验，不手敲 */
    stops: jsonb('stops').$type<LineStop[]>().notNull(),
    firstBus: integer('first_bus'),
    lastBus: integer('last_bus'),
    intervalMin: integer('interval_min'),
    tickets: jsonb('tickets').$type<LineTicket[]>().notNull().default([]),
    needAdvance: boolean('need_advance'),
    capacity: integer('capacity'),
    rideMin: integer('ride_min'),
    seasonNote: text('season_note'),
    /** 行程排到这个地点 = 在这儿乘车，用来把线路接进已有地点池 */
    rideAtPlaceId: text('ride_at_place_id'),
    source: text('source').notNull(),
    sourceUrl: text('source_url'),
    verifiedAt: date('verified_at'),
    trust: text('trust', { enum: TRUST }).notNull().default('pending'),
    /** 演示数据：班次/票价为构造值，只能用来验冲突拦截，界面必须标注 */
    isDemo: boolean('is_demo').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index('lines_city_idx').on(t.city), index('lines_ride_place_idx').on(t.rideAtPlaceId)]
)

/**
 * 用户补录（FR-05）：空态的唯一出路。
 * 一条 = 一次「补什么 / 补的值 / 可选来源」，天然只覆盖一个字段，不存整份对象。
 * 同设备同目标同字段只能提交一次（唯一索引），不加验证码。
 */
export const dataSubmissions = pgTable(
  'data_submissions',
  {
    id: text('id').primaryKey(),
    scope: text('scope', { enum: ['line', 'place', 'fact'] }).notNull(),
    targetId: text('target_id').notNull(),
    /** 补的是哪个字段：lastBus / firstBus / intervalMin / ticket / openText / fact */
    field: text('field').notNull(),
    value: text('value').notNull(),
    note: text('note'),
    clientId: text('client_id').notNull(),
    /** 核验状态：提交只进池子，不做审核队列；pending 只能让行程 warn，不能判 error */
    status: text('status', { enum: ['pending', 'verified', 'rejected'] }).notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex('data_submissions_uq').on(t.scope, t.targetId, t.field, t.clientId),
    index('data_submissions_target_idx').on(t.targetId)
  ]
)

/**
 * 「这条不对」（FR-02）：每个硬提示都必须带它，否则误报率无法测量。
 * 只记「用户说这条不对」，不直接改数据可信度——加权规则未定，服务端不擅自判。
 */
export const constraintReports = pgTable(
  'constraint_reports',
  {
    id: text('id').primaryKey(),
    /** 对应 PlanIssue.id，能精确指回是哪条提示 */
    issueId: text('issue_id').notNull(),
    ruleCode: text('rule_code').notNull(),
    trustLevel: text('trust_level').notNull(),
    planId: text('plan_id'),
    note: text('note'),
    clientId: text('client_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex('constraint_reports_uq').on(t.issueId, t.clientId),
    index('constraint_reports_rule_idx').on(t.ruleCode)
  ]
)

/**
 * 埋点事件（F10 评估）。
 *
 * 为什么落库而不是只打 console：MVP 要按两条验收旅程统计「完成到哪一步、在哪中断」，
 * 数据不出设备就等于没测。表只承载「谁在什么时候做了什么」，不放全量行程内容。
 *
 * 三个刻意的选择：
 * 1. `session_id` 由客户端生成并随事件带上。没有账号体系时，它是把一次旅程串起来的
 *    唯一依据；同一设备的两次测试靠它区分，靠时间戳猜会把并发测试搅在一起。
 * 2. `at` 与 `received_at` 双记：`at` 是客户端时间（可能被改或时区错），`received_at`
 *    是服务端落库时间。排查「事件顺序反了」时必须能对照这两个。
 * 3. `props` 用 jsonb 而不是拆列：事件属性随功能演进，拆列等于每加一个字段都要迁移。
 *    代价是没法对 props 内部建索引，本期也不需要。
 *
 * 不存 IP、不存设备型号：本期只回答「流程走到哪一步断了」，不做用户画像。
 */
export const trackEvents = pgTable(
  'track_events',
  {
    id: text('id').primaryKey(),
    /** 客户端一次会话一个；同设备多次测试靠它区分 */
    sessionId: text('session_id').notNull(),
    clientId: text('client_id').notNull(),
    /** 端标识：排查「只有 iOS 中断」这类问题时第一刀就切它 */
    platform: text('platform'),
    event: text('event').notNull(),
    props: jsonb('props').$type<Record<string, string | number | boolean>>().notNull().default({}),
    /** 客户端记录时间 */
    at: timestamp('at', { withTimezone: true }).notNull(),
    /** 服务端接收时间 */
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index('track_events_session_idx').on(t.sessionId),
    index('track_events_event_at_idx').on(t.event, t.at),
    index('track_events_client_idx').on(t.clientId)
  ]
)
