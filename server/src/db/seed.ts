import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { db, pool } from './client.ts'
import { cities, collections, factFeedbacks, facts, footprints, guides, places, playPlaces, plays, tripVersions, trips } from './schema.ts'
import { generatePlans, revisePlan } from '@/engine/planner'
import { setPlaces } from '@/engine/placeIndex'
import { validatePlan } from '@/engine/validate'
import type { Demand, Place, Plan, TravelFact } from '@/types/index.ts'

// 数据在仓库根目录 data/*.json，这个脚本只做「读文件 → 写库」，不含业务数据字面量。
// 重复执行是幂等的：地点/避坑/示例行程按 id upsert，版本与反馈按固定 id / 唯一索引去重。
const readJson = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`../../../data/${name}`, import.meta.url), 'utf8')) as T

const seedPlaces = readJson<(Place & { id: string })[]>('places.json')
const seedFacts = readJson<TravelFact[]>('facts.json')
const seedCities = readJson<{
  id: string; tag: string; coverImage: string; priceFrom: string; rating: string
  visitedText: string; desc: string; days: string
  tips: { icon: string; label: string; text: string }[]
  isOpen: boolean; sortOrder: number
}[]>('cities.json')
const seedGuides = readJson<{
  id: string; city: string; title: string; note: string; coverImage: string
  views: number; dayCount: number; tags: string[]; rating: number
  badges: string[]; placeIds: string[]; body: string
}[]>('guides.json')
const seedPlays = readJson<{
  id: string; city: string; title: string; label: string; note: string; coverImage: string
  days: number; chips: { icon: string; text: string }[]
  sortOrder: number; placeIds: string[]
}[]>('plays.json')
const seedFeedbacks = readJson<
  { factId: string; verdict: 'met' | 'not-applicable'; count: number; note?: string }[]
>('feedbacks.json')

// 示例行程不手写 JSON：用前端同一套确定性引擎生成，改地点或改预算模型后重新 seed 即可保持一致
const demoDemands: Demand[] = [
  { destination: '重庆', dayCount: 1, party: 2, budgetLevel: 'mid', preferences: ['经典打卡'], transport: 'public', notes: '' },
  { destination: '重庆', dayCount: 2, party: 4, budgetLevel: 'low', preferences: ['夜景江湖', '美食探店'], transport: 'public', notes: '' },
  { destination: '成都', dayCount: 1, party: 2, budgetLevel: 'mid', preferences: ['亲子慢游'], transport: 'public', notes: '' }
]

for (const p of seedPlaces) {
  const { id, open, ...rest } = p
  await db
    .insert(places)
    .values({ id, openStart: open[0], openEnd: open[1], ...rest })
    .onConflictDoUpdate({ target: places.id, set: { openStart: open[0], openEnd: open[1], ...rest } })
}

for (const { id, ...rest } of seedFacts) {
  await db.insert(facts).values({ id, ...rest }).onConflictDoUpdate({ target: facts.id, set: rest })
}

let seq = 0
const feedbackRows = seedFeedbacks.flatMap(({ factId, verdict, count, note }) =>
  Array.from({ length: count }, () => ({
    id: crypto.randomUUID(),
    factId,
    verdict,
    note: note ?? null,
    clientId: `seed-dev-${String(++seq).padStart(2, '0')}`
  }))
)
await db.insert(factFeedbacks).values(feedbackRows).onConflictDoNothing()

// 城市 → 攻略 → 玩法：首页这些区块全部从这里来，前端不再内联 mock
for (const c of seedCities) {
  await db.insert(cities).values(c).onConflictDoUpdate({ target: cities.id, set: c })
}
for (const g of seedGuides) {
  await db.insert(guides).values(g).onConflictDoUpdate({ target: guides.id, set: g })
}
for (const { placeIds, ...rest } of seedPlays) {
  await db.insert(plays).values(rest).onConflictDoUpdate({ target: plays.id, set: rest })
  // 玩法与景点的关联整组重写：改了 placeIds 之后旧关联不能留在库里
  await db.delete(playPlaces).where(eq(playPlaces.playId, rest.id))
  if (placeIds.length) {
    await db
      .insert(playPlaces)
      .values(placeIds.map((placeId, i) => ({ playId: rest.id, placeId, sortOrder: i })))
      .onConflictDoNothing()
  }
}

// 引擎是同步纯函数，生成示例行程前必须先灌好地点池
setPlaces(seedPlaces)

let tripCount = 0
let versionCount = 0
for (const [i, demand] of demoDemands.entries()) {
  const id = `demo-trip-${i + 1}`
  const plan = generatePlans(demand)[0]
  await db
    .insert(trips)
    .values({ id, clientId: null, demand, plan })
    .onConflictDoUpdate({ target: trips.id, set: { demand, plan } })
  tripCount++

  const versions: { id: string; note: string; impact?: unknown }[] = [{ id: `${id}-v1`, note: '首次生成' }]

  // 第二条示例带一次局部修改，用来看「变更影响」长什么样
  if (i === 1) {
    const revised = revisePlan(plan, demand, '第二天轻松一点', 2)
    // 失败分支才带 supported: false
    if (!('supported' in revised)) {
      await db.update(trips).set({ plan: revised.plan }).where(eq(trips.id, id))
      versions.push({ id: `${id}-v2`, note: '第二天减少一个景点，节奏放缓', impact: revised.impact })
    }
  }

  for (const v of versions) {
    await db
      .insert(tripVersions)
      .values({ id: v.id, tripId: id, note: v.note, impact: v.impact as never })
      .onConflictDoNothing()
    versionCount++
  }
}

// 测试账号 demo-user：把界面上会遇到的状态各造一条，?demo=1 用这个账号看
const DEMO_CLIENT = 'demo-user'

/** 把某天第一个景点挪到 23:00，制造「开始太晚 / 落在营业时间外」这类硬冲突 */
const makeLate = (plan: Plan) => {
  const items = plan.days[0].items
  const item = items.find((i) => i.kind === 'place')
  if (!item) return
  item.startMin = 23 * 60
  item.endMin = item.startMin + item.stayMin
  items.sort((a, b) => a.startMin - b.startMin)
}

/** 清空第二天，制造「空天」这种硬冲突 */
const makeEmptyDay = (plan: Plan) => {
  if (plan.days[1]) plan.days[1].items = []
}

const demoCases: { id: string; demand: Demand; break?: (plan: Plan) => void; note: string }[] = [
  {
    id: 'demo-user-1',
    demand: { destination: '成都', dayCount: 1, party: 2, budgetLevel: 'mid', preferences: ['经典打卡'], transport: 'public', notes: '' },
    note: '正常行程'
  },
  {
    id: 'demo-user-2',
    demand: { destination: '重庆', dayCount: 2, party: 4, budgetLevel: 'low', preferences: ['夜景江湖', '美食探店'], transport: 'public', notes: '' },
    note: '超预算'
  },
  {
    id: 'demo-user-3',
    demand: { destination: '重庆', dayCount: 1, party: 8, budgetLevel: 'mid', preferences: ['经典打卡'], transport: 'public', notes: '' },
    note: '8 人大团'
  },
  {
    id: 'demo-user-4',
    demand: { destination: '成都', dayCount: 2, party: 2, budgetLevel: 'high', preferences: ['亲子慢游'], transport: 'public', notes: '' },
    break: makeLate,
    note: '时间冲突'
  },
  {
    id: 'demo-user-5',
    demand: { destination: '重庆', dayCount: 2, party: 2, budgetLevel: 'flexible', preferences: ['拍照出片'], transport: 'public', notes: '' },
    break: makeEmptyDay,
    note: '空天'
  },
  {
    id: 'demo-user-6',
    demand: { destination: '成都', dayCount: 1, party: 1, budgetLevel: 'mid', preferences: ['美食探店'], transport: 'public', notes: '' },
    note: '单人出行'
  }
]

let demoCount = 0
for (const c of demoCases) {
  const plan = generatePlans(c.demand)[0]
  c.break?.(plan)
  plan.issues = validatePlan(plan, c.demand)
  await db
    .insert(trips)
    .values({ id: c.id, clientId: DEMO_CLIENT, demand: c.demand, plan })
    .onConflictDoUpdate({ target: trips.id, set: { demand: c.demand, plan } })
  await db
    .insert(tripVersions)
    .values({ id: `${c.id}-v1`, tripId: c.id, note: `预置：${c.note}` })
    .onConflictDoNothing()
  demoCount++
}

// 测试账号的反馈：让避坑卡片出现「你已反馈」与别人的计数
const demoFeedback = [
  { id: 'demo-user-fb-1', factId: 'f-cq-1', verdict: 'met' as const, note: '国庆去的，确实排了很久' },
  { id: 'demo-user-fb-2', factId: 'f-cd-1', verdict: 'not-applicable' as const, note: null }
]
for (const f of demoFeedback) {
  await db
    .insert(factFeedbacks)
    .values({ id: f.id, factId: f.factId, verdict: f.verdict, note: f.note, clientId: DEMO_CLIENT })
    .onConflictDoNothing()
}

// 测试账号的收藏与足迹：让「我的」页一装上就有真数据可看
const demoCollections = [
  { id: 'demo-col-1', targetType: 'place' as const, targetId: 'cd-kuanzhai' },
  { id: 'demo-col-2', targetType: 'place' as const, targetId: 'cq-hongyadong' },
  { id: 'demo-col-3', targetType: 'guide' as const, targetId: 'guide-cd-2d1n' }
]
for (const c of demoCollections) {
  await db
    .insert(collections)
    .values({ ...c, clientId: DEMO_CLIENT })
    .onConflictDoNothing()
}

const demoFootprints = [
  { id: 'demo-fp-1', city: '成都', placeId: 'cd-kuanzhai', visitedOn: '2026-04-18' },
  { id: 'demo-fp-2', city: '成都', placeId: 'cd-panda', visitedOn: '2026-04-19' },
  { id: 'demo-fp-3', city: '重庆', placeId: 'cq-hongyadong', visitedOn: '2026-05-02' }
]
for (const f of demoFootprints) {
  await db
    .insert(footprints)
    .values({ ...f, clientId: DEMO_CLIENT })
    .onConflictDoNothing()
}

console.log(
  `[seed] 城市 ${seedCities.length} 个、攻略 ${seedGuides.length} 条、玩法 ${seedPlays.length} 个、` +
    `演示收藏 ${demoCollections.length} 条、足迹 ${demoFootprints.length} 条、` +
    `地点 ${seedPlaces.length} 条、避坑 ${seedFacts.length} 条、演示反馈 ${feedbackRows.length} 条、` +
    `示例行程 ${tripCount} 条（版本 ${versionCount} 条）、测试账号行程 ${demoCount} 条已写入`
)
await pool.end()
