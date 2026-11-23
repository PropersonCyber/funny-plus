import { Hono } from 'hono'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { constraintReports, dataSubmissions, facts, lines, places } from '../db/schema.ts'
import { resolveActorQuietly } from '../auth/middleware.ts'
import {
  SUBMIT_PROMOTABLE,
  SUBMIT_TRUST_CEILING,
  capTrust,
  isAgreed,
  normalizeSubmitValue
} from '../data/trustRules.ts'
import type { Promotion } from '../data/trustRules.ts'
import type { DataSubmission, SubmitField } from '@/types/index.ts'

/**
 * 用户补录与误报上报（FR-05 / FR-02）。
 *
 * 两条硬规则：
 * 1. **只进池子，不直接改数据**。补录的 status 一律 pending，误报只是记账；
 *    把用户填报直接写成 official 会让「官方核验」这个唯一可信档位失效。
 * 2. **同设备同目标同字段只收一次**，靠唯一索引兜底，不做验证码。
 */
const CLIENT_MAX = 64
const VALUE_MAX = 120
const NOTE_MAX = 120

const FIELDS: SubmitField[] = ['firstBus', 'lastBus', 'intervalMin', 'ticket', 'openText', 'fact']

const toApi = (r: typeof dataSubmissions.$inferSelect): DataSubmission => ({
  id: r.id,
  scope: r.scope,
  targetId: r.targetId,
  field: r.field as SubmitField,
  value: r.value,
  note: r.note ?? undefined,
  clientId: r.clientId,
  status: r.status,
  createdAt: r.createdAt.toISOString()
})

export const submitRoute = new Hono()

/**
 * 拉当前设备提交过的补录：前端启动时用它把「你提交的 · 待核验」回填进本人视图。
 * 这是 FR-05「先回填自己的视图，再入库」里「再入库」之后的那一半——
 * 刷新页面还能看到自己补的值，不然用户会以为白填了一次。
 */
submitRoute.get('/', async (c) => {
  const clientId = (c.req.query('clientId') ?? '').slice(0, CLIENT_MAX)
  const actor = await resolveActorQuietly(c.req.header('authorization'))
  // 登录后换设备来查：只按 clientId 查不到已并账的记录（userId 换了、clientId 不同），
  // 所以登录时按 userId 查，并带上本机尚未并账的行；未登录仍只按 clientId。
  const scope = actor
    ? or(
        eq(dataSubmissions.userId, actor.userId),
        clientId ? and(isNull(dataSubmissions.userId), eq(dataSubmissions.clientId, clientId)) : undefined
      )
    : clientId
      ? eq(dataSubmissions.clientId, clientId)
      : null
  if (!scope) return c.json({ items: [] })
  const rows = await db
    .select()
    .from(dataSubmissions)
    .where(scope)
    .orderBy(dataSubmissions.createdAt)
  return c.json({ items: rows.map(toApi) })
})

submitRoute.post('/', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object') return c.json({ error: '请求体不是合法 JSON' }, 400)

  const { scope, targetId, field, value, note, clientId } = body as Record<string, unknown>
  if (scope !== 'line' && scope !== 'place' && scope !== 'fact') return c.json({ error: '补录对象不合法' }, 400)
  if (typeof targetId !== 'string' || !targetId) return c.json({ error: '缺少补录对象 id' }, 400)
  if (typeof field !== 'string' || !FIELDS.includes(field as SubmitField)) return c.json({ error: '补录字段不合法' }, 400)
  if (typeof value !== 'string' || !value.trim()) return c.json({ error: '补的值不能为空' }, 400)
  if (typeof clientId !== 'string' || !clientId || clientId.length > CLIENT_MAX) {
    return c.json({ error: '缺少设备标识' }, 400)
  }

  const trimmed = value.trim().slice(0, VALUE_MAX)
  // 数值型字段先在这里挡掉明显的脏值：界面回填时会直接拿它算时长，脏值会变成 NaN 显示。
  // 归一化放在 trustRules 里做一次，写库与 vote 分组共用同一个结果 —— 两处各算各的，
  // 就会出现「提交时认 17:00、写库时 Number('17:00') 是 NaN」这种半截生效。
  if (field === 'lastBus' || field === 'firstBus' || field === 'intervalMin' || field === 'ticket') {
    const num = Number(trimmed)
    const isClock = (field === 'firstBus' || field === 'lastBus') && trimmed.includes(':')
    if (!isClock && (!Number.isFinite(num) || num < 0)) return c.json({ error: '这个字段需要填数字' }, 400)
    if (field === 'firstBus' || field === 'lastBus') {
      // 支持 17:00 和 1020 两种写法，存成当日分钟数
      const minutes = trimmed.includes(':') ? parseClock(trimmed) : num
      if (minutes === null || minutes > 24 * 60) return c.json({ error: '时间要写成 17:00 这样的格式' }, 400)
    }
    if (field === 'intervalMin' && !Number.isInteger(num)) return c.json({ error: '间隔要填整分钟' }, 400)
    if (field === 'ticket' && !Number.isInteger(num)) return c.json({ error: '票价要填整数' }, 400)
  }

  // 目标必须真实存在，否则池子里会攒一堆指向不存在对象的补录
  const exists = await targetExists(scope, targetId)
  if (!exists) return c.json({ error: '补录的对象不存在' }, 400)

  const dupe = await db
    .select({ id: dataSubmissions.id })
    .from(dataSubmissions)
    .where(
      and(
        eq(dataSubmissions.scope, scope),
        eq(dataSubmissions.targetId, targetId),
        eq(dataSubmissions.field, field),
        eq(dataSubmissions.clientId, clientId)
      )
    )
    .limit(1)
  if (dupe.length) return c.json({ error: '这条你已经补过了，感谢' }, 409)

  const row = {
    id: crypto.randomUUID(),
    scope: scope as DataSubmission['scope'],
    targetId,
    field,
    value: trimmed,
    note: typeof note === 'string' && note.trim() ? note.trim().slice(0, NOTE_MAX) : null,
    clientId,
    status: 'pending' as const
  }
  // 登录了就记归属，没登录留空：这两类数据匿名可用，登录只是让它跟账号走
  const actor = await resolveActorQuietly(c.req.header('authorization'))
  await db.insert(dataSubmissions).values({ ...row, userId: actor?.userId ?? null })

  // C2 补录生效：同一字段两个独立设备填了同一个值就写进线上表。
  // 生效的前提是「原本是空」，且这一刻必须把行降到用户填报档（见 capTrust）：
  // 不动 trust 等于让官方行带着官方身份吸收用户填报，那份数据随后会去判硬冲突。
  const promoted = await promoteIfAgreed(scope, targetId, field)
  if (promoted) {
    // 按归一化后的值挑出「真的生效了」的那些行。原字符串是 "17:00" 还是 "1020" 都算，
    // 因为 vote 已经按归一化归过了；只按原字符串匹配会让本次这台设备的记录漏标。
    const pending = await db
      .select({ id: dataSubmissions.id, value: dataSubmissions.value })
      .from(dataSubmissions)
      .where(
        and(
          eq(dataSubmissions.scope, scope),
          eq(dataSubmissions.targetId, targetId),
          eq(dataSubmissions.field, field),
          eq(dataSubmissions.status, 'pending')
        )
      )
    const ids = pending
      .filter((r) => normalizeSubmitValue(field, r.value)?.label === promoted.stored.label)
      .map((r) => r.id)
    if (ids.length) {
      await db
        .update(dataSubmissions)
        .set({ status: 'verified' })
        .where(inArray(dataSubmissions.id, ids))
    }
  }
  return c.json(
    {
      item: toApi({ ...row, createdAt: new Date() } as typeof dataSubmissions.$inferSelect),
      // promoted 只对本次调用方表示「你这一票让数据生效了」，值本身不参与任何判定
      promoted: promoted !== null
    },
    201
  )
})

/** 「这条不对」：每个硬提示都能点一次，用于统计误报率 */
/**
 * 补录是否已达生效门槛，达到就写进线上表。
 *
 * 四个刻意的限制：
 * 1. 只认白名单字段（班次三件 + 营业时间）。「避坑正文」这类文本被两个设备写进去，
 *    就等于把用户填报当成了官方描述。
 * 2. 只在原列为空时写。补录是补缺，不是改写已核验过的值 —— 后者必须有人工审核。
 * 3. **写进去的同时把这一行压到「用户填报」档**（capTrust）。以前这里写着「不动 trust」，
 *    而那正是漏洞：trust 是行级字段，官方行吸收一条用户填报之后仍顶着 official，
 *    再经 canJudgeHard 就能用用户填的末班去判硬冲突。压到 experience 之后，
 *    行程里它最多提示、不拦人，界面也不再替它宣称「官方已核验」。
 * 4. **匿名设备票不凑数**（见 `isAgreed`）。`clientId` 是客户端自报的，
 *    同一个人换两个字符串就能自导自演「两个设备一致」，把一条未经核验的班次
 *    写进线上表。生效必须至少有一个登录账号背书。
 *
 * 返回值是**真正写进线上表的那组值**（含归一化后的落库值），不参与任何判定；
 * 没生效返回 null。返回归一化值，是因为调用方要按它去标记「哪些条才算已核验」。
 */
async function promoteIfAgreed(
  scope: DataSubmission['scope'],
  targetId: string,
  field: string
): Promise<{ value: string; stored: Promotion } | null> {
  const allowed = scope === 'line' ? SUBMIT_PROMOTABLE.line : scope === 'place' ? SUBMIT_PROMOTABLE.place : []
  if (!(allowed as readonly string[]).includes(field)) return null

  const rows = await db
    .select({
      value: dataSubmissions.value,
      clientId: dataSubmissions.clientId,
      userId: dataSubmissions.userId
    })
    .from(dataSubmissions)
    .where(
      and(
        eq(dataSubmissions.scope, scope),
        eq(dataSubmissions.targetId, targetId),
        eq(dataSubmissions.field, field),
        eq(dataSubmissions.status, 'pending')
      )
    )

  // 按**归一化后**的值归；一票 = 一个独立来源。
  // 不归一的话「17:00」与「1020」会各算一票，两个设备说的明明是同一件事却凑不齐门槛。
  //
  // 来源分成账号与匿名两类分别去重：账号由 token 绑定，换设备重投也是同一个 user_id，
  // 只算一票；匿名设备只有自报的 clientId，本身不可信，默认不计入门槛（见 isAgreed）。
  const votes = new Map<string, { userIds: Set<string>; clientIds: Set<string>; stored: Promotion }>()
  for (const r of rows) {
    const stored = normalizeSubmitValue(field, r.value)
    if (!stored) continue
    const entry = votes.get(stored.label) ?? {
      userIds: new Set<string>(),
      clientIds: new Set<string>(),
      stored
    }
    if (r.userId) entry.userIds.add(r.userId)
    else entry.clientIds.add(r.clientId)
    votes.set(stored.label, entry)
  }
  const agreed = [...votes.entries()].find(([, v]) => isAgreed(v))
  if (!agreed) return null
  const [value, { stored }] = agreed
  if (scope === 'line') {
    if (stored.kind !== 'minutes') return null
    const column = { firstBus: lines.firstBus, lastBus: lines.lastBus, intervalMin: lines.intervalMin }[
      field as 'firstBus' | 'lastBus' | 'intervalMin'
    ]
    const [cur] = await db
      .select({
        firstBus: lines.firstBus,
        lastBus: lines.lastBus,
        intervalMin: lines.intervalMin,
        trust: lines.trust
      })
      .from(lines)
      .where(eq(lines.id, targetId))
      .limit(1)
    if (!cur) return null
    const existing = cur[field as 'firstBus' | 'lastBus' | 'intervalMin']
    if (existing !== null) return null
    // isNull 再挡一次并发：两个请求同时判定为空时，只有一个能写进去。
    // 写成功才算生效 —— 空判定之后、写之前被别的请求抢先，这条补录就只是「记了一票」，
    // 不能对调用方撒谎说自己让数据生效了。
    // trust 按这一行原本的档位压上限：本来就是 pending 的保持 pending，不能因为补录反而升档。
    const written = await db
      .update(lines)
      .set({
        [field]: stored.value,
        trust: capTrust(cur.trust, SUBMIT_TRUST_CEILING),
        updatedAt: new Date()
      } as Partial<typeof lines.$inferInsert>)
      .where(and(eq(lines.id, targetId), isNull(column)))
      .returning({ id: lines.id })
    if (!written.length) return null
    return { value, stored }
  }

  if (stored.kind !== 'text') return null
  const [cur] = await db
    .select({ openText: places.openText, trust: places.trust })
    .from(places)
    .where(eq(places.id, targetId))
    .limit(1)
  if (!cur || cur.openText !== null) return null
  const written = await db
    .update(places)
    .set({ openText: stored.label, trust: capTrust(cur.trust, SUBMIT_TRUST_CEILING) })
    .where(and(eq(places.id, targetId), isNull(places.openText)))
    .returning({ id: places.id })
  if (!written.length) return null
  return { value, stored }
}

export const reportRoute = new Hono()

reportRoute.post('/', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object') return c.json({ error: '请求体不是合法 JSON' }, 400)
  const { issueId, ruleCode, trustLevel, planId, note, clientId } = body as Record<string, unknown>
  if (typeof issueId !== 'string' || !issueId) return c.json({ error: '缺少提示 id' }, 400)
  if (typeof ruleCode !== 'string' || !ruleCode) return c.json({ error: '缺少规则标识' }, 400)
  if (typeof clientId !== 'string' || !clientId || clientId.length > CLIENT_MAX) {
    return c.json({ error: '缺少设备标识' }, 400)
  }

  const dupe = await db
    .select({ id: constraintReports.id })
    .from(constraintReports)
    .where(and(eq(constraintReports.issueId, issueId), eq(constraintReports.clientId, clientId)))
    .limit(1)
  if (dupe.length) return c.json({ error: '这条你已经反馈过了' }, 409)

  const actor = await resolveActorQuietly(c.req.header('authorization'))
  await db.insert(constraintReports).values({
    id: crypto.randomUUID(),
    userId: actor?.userId ?? null,
    issueId,
    ruleCode,
    trustLevel: typeof trustLevel === 'string' ? trustLevel.slice(0, 32) : 'unknown',
    planId: typeof planId === 'string' ? planId.slice(0, 120) : null,
    note: typeof note === 'string' && note.trim() ? note.trim().slice(0, NOTE_MAX) : null,
    clientId
  })
  return c.json({ ok: true }, 201)
})

const parseClock = (text: string): number | null => {
  const m = text.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 24 || min > 59) return null
  return Math.min(h * 60 + min, 24 * 60)
}

async function targetExists(scope: string, id: string): Promise<boolean> {
  if (scope === 'line') return (await db.select({ id: lines.id }).from(lines).where(eq(lines.id, id)).limit(1)).length > 0
  if (scope === 'place') return (await db.select({ id: places.id }).from(places).where(eq(places.id, id)).limit(1)).length > 0
  return (await db.select({ id: facts.id }).from(facts).where(eq(facts.id, id)).limit(1)).length > 0
}
