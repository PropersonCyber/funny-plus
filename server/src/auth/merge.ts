import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.ts'
import {
  collections,
  constraintReports,
  dataSubmissions,
  factFeedbacks,
  footprints,
  trackEvents,
  trips
} from '../db/schema.ts'

/**
 * 首次登录的静默并账：把本机 clientId 名下还没有归属的数据认领给账号。
 *
 * 为什么逐表 UPDATE 而不是一次 SQL 拼七段：走 drizzle 的 schema 对象，列名与表名漂移时
 * 编译期就能发现；手写字符串则要等运行时报错。
 *
 * 幂等的关键在 `user_id is null` 这个条件：已经归属过的行不会被再次改写，所以重复登录
 * 的结果是 0 行受影响，而不是把别的账号的数据抢过来。
 *
 * `track_events` 也一并认领：埋点是「谁的旅程」的一部分，登录前后分成两半会让
 * 「完成到哪一步」的统计断在登录那一刻。
 */

export type ClaimCounts = {
  trips: number
  collections: number
  footprints: number
  factFeedbacks: number
  dataSubmissions: number
  constraintReports: number
  trackEvents: number
}

const CLAIMERS = [
  { key: 'trips', table: trips },
  { key: 'collections', table: collections },
  { key: 'footprints', table: footprints },
  { key: 'factFeedbacks', table: factFeedbacks },
  { key: 'dataSubmissions', table: dataSubmissions },
  { key: 'constraintReports', table: constraintReports },
  { key: 'trackEvents', table: trackEvents }
] as const

export async function claimAnonData(userId: string, clientId: string | null): Promise<ClaimCounts> {
  const counts: ClaimCounts = {
    trips: 0,
    collections: 0,
    footprints: 0,
    factFeedbacks: 0,
    dataSubmissions: 0,
    constraintReports: 0,
    trackEvents: 0
  }
  // 没有 clientId 就是「新设备直接登录」，没有任何东西可认领
  if (!clientId) return counts

  for (const { key, table } of CLAIMERS) {
    const updated = await db
      .update(table)
      .set({ userId })
      .where(and(eq(table.clientId, clientId), isNull(table.userId)))
      .returning({ id: table.id })
    counts[key] = updated.length
  }
  return counts
}
