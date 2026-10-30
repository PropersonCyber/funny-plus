import { date, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import type { ChangeImpact, Demand, Plan } from '@/types/index.ts'

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
    /** 门票人均（元） */
    ticket: integer('ticket').notNull(),
    /** 建议停留（分钟） */
    stayMin: integer('stay_min').notNull(),
    /** 步行强度 1-3 */
    walk: integer('walk').notNull(),
    tags: text('tags').array().notNull(),
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
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index('facts_city_idx').on(t.city)]
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
