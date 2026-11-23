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
    /** 登录后的归属账号；null = 匿名写入或历史数据，靠 client_id 兜底 */
    userId: text('user_id'),
    demand: jsonb('demand').$type<Demand>().notNull(),
    /**
     * 用户当前选中的那一套。
     *
     * 与 plans 并存是为了读旧行：0015 之前的行只有这一列。新写会同时更新两处，
     * 读的时候 plans 优先 —— 两处都存看起来冗余，但比让旧行程读不出来强。
     */
    plan: jsonb('plan').$type<Plan>().notNull(),
    /** 全部方案（G5）。null = 0015 之前的旧行，读的时候用 [plan] 兜 */
    plans: jsonb('plans').$type<Plan[]>(),
    /** 选中的是第几套；null = 旧行，按 0 处理 */
    planIndex: integer('plan_index'),
    /** 用户主动结束旅行的时刻；null = 还在进行中 */
    endedAt: timestamp('ended_at', { withTimezone: true }),
    savedAt: timestamp('saved_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index('trips_client_idx').on(t.clientId), index('trips_user_idx').on(t.userId)]
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
    /**
     * 每周固定不开放的日子，0=周日 … 6=周六。
     *
     * 不从 openText 解析：那是给人看的自由文本，同一件事十几种写法，
     * 解析错一次就是把「今天闭馆」说成「今天开放」。空数组 = 没有周几闭馆。
     */
    closedWeekdays: integer('closed_weekdays').array().notNull().default([]),
    /** 整段闭馆的日期区间（MM-DD，不含年份，跨年取模） */
    closedRanges: jsonb('closed_ranges').$type<{ from: string; to: string; note?: string }[]>(),
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
    /** 登录后的归属账号；null = 匿名写入或历史数据，靠 client_id 兜底 */
    userId: text('user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index('fact_feedbacks_fact_id_idx').on(t.factId),
    uniqueIndex('fact_feedbacks_fact_client_uq').on(t.factId, t.clientId),
    index('fact_feedbacks_user_idx').on(t.userId)
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
    /** 登录后的归属账号；null = 匿名写入或历史数据，靠 client_id 兜底 */
    userId: text('user_id'),
    targetType: text('target_type', { enum: ['place', 'fact', 'guide', 'play'] }).notNull(),
    targetId: text('target_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex('collections_client_target_uq').on(t.clientId, t.targetType, t.targetId),
    index('collections_client_idx').on(t.clientId),
    index('collections_user_idx').on(t.userId)
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
    /** 登录后的归属账号；null = 匿名写入或历史数据，靠 client_id 兜底 */
    userId: text('user_id'),
    city: text('city').notNull(),
    placeId: text('place_id').notNull(),
    visitedOn: date('visited_on').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex('footprints_client_place_day_uq').on(t.clientId, t.placeId, t.visitedOn),
    index('footprints_client_idx').on(t.clientId),
    index('footprints_user_idx').on(t.userId)
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
    /** 登录后的归属账号；null = 匿名写入或历史数据，靠 client_id 兜底 */
    userId: text('user_id'),
    /** 核验状态：提交只进池子，不做审核队列；pending 只能让行程 warn，不能判 error */
    status: text('status', { enum: ['pending', 'verified', 'rejected'] }).notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex('data_submissions_uq').on(t.scope, t.targetId, t.field, t.clientId),
    index('data_submissions_target_idx').on(t.targetId),
    index('data_submissions_user_idx').on(t.userId)
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
    /** 登录后的归属账号；null = 匿名写入或历史数据，靠 client_id 兜底 */
    userId: text('user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex('constraint_reports_uq').on(t.issueId, t.clientId),
    index('constraint_reports_rule_idx').on(t.ruleCode),
    index('constraint_reports_user_idx').on(t.userId)
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
    /** 登录后的归属账号；null = 匿名写入或历史数据，靠 client_id 兜底 */
    userId: text('user_id'),
    /** 端标识：排查「只有 iOS 中断」这类问题时第一刀就切它。列一直在，但客户端此前不上报，恒为 null */
    platform: text('platform'),
    /** 本轮归属的验收旅程（plan / revise / share）；null = 日常使用 */
    journey: text('journey'),
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
    index('track_events_client_idx').on(t.clientId),
    index('track_events_user_idx').on(t.userId)
  ]
)

/**
 * 账号（F06）。
 *
 * phone / wechatUnionid / appleSub 三者各自唯一且都可空，理由：首发三通道定案是
 * 「短信全端 + 微信 App + Apple iOS」，但三者的接续时间不同。先上的短信若把 phone
 * 定成非空，后补微信/Apple 时就要改主流程；反过来全可空，则「同一人换通道登录」
 * 能靠后绑定的 phone 合并回同一账号。
 *
 * 不用邮箱做锚点：Apple 有隐藏邮箱中继，同一人不同通道拿到的邮箱不一致。
 */
export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    /** E.164 或纯 11 位国内号；账号合并锚点 */
    phone: text('phone'),
    /** 微信开放平台 unionid：跨应用同一人唯一，openid 只在一个应用内唯一，不能存这个 */
    wechatUnionid: text('wechat_unionid'),
    /** Sign in with Apple 的 sub */
    appleSub: text('apple_sub'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex('users_phone_uq').on(t.phone),
    uniqueIndex('users_wechat_uq').on(t.wechatUnionid),
    uniqueIndex('users_apple_uq').on(t.appleSub)
  ]
)

/**
 * 登录态（F06）。
 *
 * 只存 token 的 sha256，不存明文：库被读走时明文 token 等于把所有人的账号一起交出去。
 * 已选滑动续期（每次校验顺延 expiresAt），所以不用 JWT —— 无状态的好处在这个策略下
 * 不存在，而 opaque token 换来了「登出即时失效」（revokedAt）。
 *
 * clientId 记下签发它的设备：并账、排查「哪台设备还活着」都要它，且能回答
 * 「同一个 clientId 被两个账号用过」这种共享设备问题。
 */
export const authSessions = pgTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    /** sha256(hex)；明文永不落库 */
    tokenHash: text('token_hash').notNull(),
    clientId: text('client_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** 最近一次通过校验的时间，滑动续期的节流依据 */
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    /** 非空 = 已登出/已作废；不删行，留着才能解释「这个 token 为什么失效」 */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex('auth_sessions_token_uq').on(t.tokenHash),
    index('auth_sessions_user_idx').on(t.userId),
    index('auth_sessions_client_idx').on(t.clientId)
  ]
)

/**
 * 短信验证码（F06）。
 *
 * 存哈希而不是明文：验证码是 6 位数字，明文落库等于全表可直接登录。
 * attempts 与 consumedAt 是两条独立的作废路径 —— 试错超限与用过一次都必须失效，
 * 只做其中一条会留下「验证码被暴力枚举」或「同一码可复用」的洞。
 */
export const smsCodes = pgTable(
  'sms_codes',
  {
    id: text('id').primaryKey(),
    phone: text('phone').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** 非空 = 已用于登录，不能二次使用 */
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index('sms_codes_phone_idx').on(t.phone, t.createdAt)]
)

/**
 * 旅行回忆的云端副本（F06）。
 *
 * payload 存整份 TripMemory 而不是拆列：它的最小读写单元就是整份结构（places 是按
 * PlanItem.id 的 map），拆开等于在服务端重写一遍共享类型，且加一个字段就要迁移一次。
 * 代价是没法对内部字段建查询 —— 本期只按 tripId 取整份，不需要。
 */
export const tripMemories = pgTable(
  'trip_memories',
  {
    tripId: text('trip_id').primaryKey(),
    userId: text('user_id').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index('trip_memories_user_idx').on(t.userId)]
)

/**
 * 攻略草稿的云端副本（F06）。与 trip_memories 同构，拆两张表是因为主键语义不同：
 * 回忆与行程一一对应（tripId 做主键），草稿与行程可以一对多（一个行程重生成多次）。
 */
export const guideDrafts = pgTable(
  'guide_drafts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    tripId: text('trip_id').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index('guide_drafts_user_idx').on(t.userId), index('guide_drafts_trip_idx').on(t.tripId)]
)

/**
 * 上传到本机的照片（F08 后半）。
 *
 * 为什么不存 path 而由后端按 id 推导：id 是主键且不可变，路径由 id 分桶算出，
 * 二者只需一处一致。存 path 的话，将来换存储后端（本地磁盘 → S3）就得改所有历史行。
 *
 * sha256 用来做「同图不重复落盘」与内容校验；mime 读回时要用，不能靠文件名后缀猜。
 */
export const photos = pgTable(
  'photos',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    mime: text('mime').notNull(),
    bytes: integer('bytes').notNull(),
    sha256: text('sha256').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index('photos_user_idx').on(t.userId),
    index('photos_sha_idx').on(t.sha256),
    // 同人同图只能有一行。路由是先 select 再 insert，中间有窗口期：
    // 同一张图并发上传会各查一次「没有」然后各插一行，去重形同虚设。
    // 唯一索引是最后一道闸，配合 onConflictDoNothing 把并发收成一行。
    uniqueIndex('photos_user_sha_uq').on(t.userId, t.sha256)
  ]
)

/**
 * 一次发布 = 一条分享。
 *
 * token 是主键且随机生成（不派生自 draftId）：草稿 id 是客户端生成的，可枚举、也泄露
 * 「谁发的」。用随机 token 才能做到「链接不泄露内部标识」。
 *
 * snapshot 存发布那一刻的完整内容，而不是每次读 guide_drafts：草稿会继续被编辑，
 * 实时引用会让「我发出去的是什么」在作者改完之后悄悄变掉。
 *
 * revokedAt 而非删除行：撤回后要能回答「这个 token 曾经存在、现在失效」，
 * 删掉行会让「失效」和「从没存在」无法区分，重新发布也就没法换新 token。
 */
export const guideShares = pgTable(
  'guide_shares',
  {
    token: text('token').primaryKey(),
    draftId: text('draft_id').notNull(),
    userId: text('user_id').notNull(),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index('guide_shares_user_idx').on(t.userId),
    index('guide_shares_draft_idx').on(t.draftId),
    // 查「该草稿当前有效的分享」走这条；revokedAt 为 null 的行极少，索引很小
    index('guide_shares_draft_active_idx').on(t.draftId, t.revokedAt)
  ]
)

/**
 * 一次 AI 调用 = 一行（G7 服务端度量）。
 *
 * 为什么不并进 track_events：track_events 是「用户做了什么」，一行一个客户端动作，
 * 由客户端批量上报；ai_calls 是「服务端这次干了什么」，一行一次模型调用，只可能由服务端写。
 * 混成一张表后「对话次数」既能数客户端事件又能数服务端行，两个口径对不上时没人说得清哪个对。
 *
 * sessionId 是客户端会话 id：同一个 sessionId 下的多行 ai_calls 就是同一轮对话 ——
 * 这是「降级次数能与该轮对话关联」的唯一依据，不能省。
 */
export const aiCalls = pgTable(
  'ai_calls',
  {
    id: text('id').primaryKey(),
    /** 客户端一次会话一个；跨设备续聊（G6）后它同时是会话主键 */
    sessionId: text('session_id'),
    /** 登录后的归属账号；null = 匿名调用 */
    userId: text('user_id'),
    /** chat = /api/ai/chat；revise = /api/ai/revise */
    kind: text('kind').notNull(),
    /** 提示词版本，见 ai/prompt.ts。不改提示词就不改号，否则历史数据没法对比 */
    promptVersion: text('prompt_version').notNull(),
    model: text('model'),
    durationMs: integer('duration_ms').notNull(),
    toolCalls: integer('tool_calls').notNull().default(0),
    toolFailures: integer('tool_failures').notNull().default(0),
    /** 这一轮是否真的产出了方案 */
    planGenerated: boolean('plan_generated').notNull().default(false),
    /** generatePlans 调了几次；>1 说明模型没按 hint 停，是提示词要改的信号 */
    planAttempts: integer('plan_attempts').notNull().default(0),
    /** 模型不可用 / 输出不可解析，落回本地关键词兜底 */
    degraded: boolean('degraded').notNull().default(false),
    degradeReason: text('degrade_reason'),
    /** 本轮归属的验收旅程（plan / revise）；null = 日常使用 */
    journey: text('journey'),
    stream: boolean('stream').notNull().default(false),
    /** 失败时的一句原因；成功为 null */
    error: text('error'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index('ai_calls_at_idx').on(t.at),
    index('ai_calls_session_idx').on(t.sessionId),
    // 按旅程出漏斗走这条：journey 基数极小，和 at 组索引比单独建更省
    index('ai_calls_journey_at_idx').on(t.journey, t.at)
  ]
)

/**
 * 一次对话会话（G6 会话上云）。
 *
 * 为什么要按账号存：对话历史只在本机的话，换设备就等于「没聊过」，
 * 而 F06 已经承诺了跨设备找回，对话是其中最容易丢、也最影响继续聊的一块。
 *
 * 只存 role + 文本，**不存方案卡与预览卡**：
 * 方案卡是可重算的（行程本身已经上云，见 G5），预览卡更是必须消失的 ——
 * 跨设备把「待确认」复活成「可确认」，用户会在不知情的情况下确认一个自己没看过的改动。
 * 这条不是省事，是安全要求（见 G6 验收第二条）。
 */
export const aiSessions = pgTable(
  'ai_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    /** 属于哪趟旅程；从零规划时还没有行程，为 null */
    tripId: text('trip_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index('ai_sessions_user_idx').on(t.userId),
    // 找「这趟旅程最近一次对话」走这条
    index('ai_sessions_user_trip_idx').on(t.userId, t.tripId, t.updatedAt)
  ]
)

/**
 * 会话里的一条消息。
 *
 * 没有 onDelete cascade：删账号是极少发生的操作，为它加一层级联
 * 会让「删一个用户」变成「删六张表」，出错时没法只回滚一张。
 * 清理走单独的定时任务，届时再定策略。
 */
export const aiMessages = pgTable(
  'ai_messages',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    /** user / assistant，与客户端聊天气泡一一对应 */
    role: text('role').notNull(),
    content: text('content').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index('ai_messages_session_idx').on(t.sessionId, t.at)]
)
