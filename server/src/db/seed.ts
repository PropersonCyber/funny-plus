import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { db, pool } from './client.ts'
import { factFeedbacks, facts, places, tripVersions, trips } from './schema.ts'
import { generatePlans, revisePlan } from '@/api/planner'
import { setPlaces } from '@/lib/placeIndex'
import type { Demand, Place, TravelFact } from '@/types/index.ts'

// 数据在仓库根目录 data/*.json，这个脚本只做「读文件 → 写库」，不含业务数据字面量。
// 重复执行是幂等的：地点/避坑/示例行程按 id upsert，版本与反馈按固定 id / 唯一索引去重。
const readJson = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`../../../data/${name}`, import.meta.url), 'utf8')) as T

const seedPlaces = readJson<(Place & { id: string })[]>('places.json')
const seedFacts = readJson<TravelFact[]>('facts.json')
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

console.log(
  `[seed] 地点 ${seedPlaces.length} 条、避坑 ${seedFacts.length} 条、演示反馈 ${feedbackRows.length} 条、` +
    `示例行程 ${tripCount} 条（版本 ${versionCount} 条）已写入`
)
await pool.end()
