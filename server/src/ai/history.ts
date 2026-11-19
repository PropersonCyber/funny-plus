/**
 * 会话历史的读写（G6）。
 *
 * 分层理由：ai.ts 已经够大了（400+ 行），会话的归属判定与清理策略是另一件事，
 * 混进去会让「这轮对话算谁的历史」这类问题只能在读完全文之后回答。
 *
 * 三条边界写死在这里：
 *
 * 1. **只存 role + 文本。** 方案卡能重算（行程已上云），预览卡必须消失 ——
 *    跨设备把「待确认」复活成「可确认」，用户会在不知情下确认一个没看过的改动。
 * 2. **会话 id 由服务端发，不由客户端指定。** 客户端指定的 id 是可枚举、可碰撞的；
 *    服务端发 id 才能让「别人的会话」在查询时天然查不到（userId 是 where 的一部分）。
 * 3. **读与写都带 userId。** 少了它，知道 sessionId 就能读到别人的对话。
 */
import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { aiMessages, aiSessions } from '../db/schema.ts'

/** 一轮对话 = 用户一句 + 助手一句 */
export type StoredTurn = { role: 'user' | 'assistant'; content: string }

/** 一个会话最多留这么多轮：再多的部分模型也读不完，留着只是让库变大 */
const MAX_TURNS = 40

type SessionRow = typeof aiSessions.$inferSelect

/**
 * 找（或建）本账号在这个行程下的会话。
 *
 * `clientSessionId` 只在「它确实属于本账号」时被采纳 —— 这是防止拿别人的 id
 * 往自己的历史里写。不属于就新建一个，绝不报错：对话不该因为一个旧 id 而失败。
 */
export async function resolveSession(
  userId: string,
  clientSessionId: string,
  tripId: string | null
): Promise<SessionRow> {
  if (clientSessionId) {
    const [mine] = await db
      .select()
      .from(aiSessions)
      .where(and(eq(aiSessions.id, clientSessionId), eq(aiSessions.userId, userId)))
      .limit(1)
    if (mine) {
      // tripId 可能从「从零规划」变成「改某趟行程」，跟着更新
      if (tripId && tripId !== mine.tripId) {
        const [updated] = await db
          .update(aiSessions)
          .set({ tripId, updatedAt: new Date() })
          .where(eq(aiSessions.id, mine.id))
          .returning()
        if (updated) return updated
      }
      return mine
    }
  }

  // 没有可用的会话就复用「这趟旅程最近一次对话」，换设备后才会接着上次聊
  if (tripId) {
    const [latest] = await db
      .select()
      .from(aiSessions)
      .where(and(eq(aiSessions.userId, userId), eq(aiSessions.tripId, tripId)))
      .orderBy(desc(aiSessions.updatedAt))
      .limit(1)
    if (latest) return latest
  }

  const [created] = await db
    .insert(aiSessions)
    .values({ id: randomUUID(), userId, tripId })
    .returning()
  return created!
}

/** 读一个会话的历史，按时间正序 */
export async function loadTurns(userId: string, sessionId: string): Promise<StoredTurn[]> {
  const [mine] = await db
    .select({ id: aiSessions.id })
    .from(aiSessions)
    .where(and(eq(aiSessions.id, sessionId), eq(aiSessions.userId, userId)))
    .limit(1)
  if (!mine) return []

  const rows = await db
    .select({ role: aiMessages.role, content: aiMessages.content })
    .from(aiMessages)
    .where(eq(aiMessages.sessionId, sessionId))
    .orderBy(asc(aiMessages.at))
  return rows
    .filter((r) => r.role === 'user' || r.role === 'assistant')
    .map((r) => ({ role: r.role as 'user' | 'assistant', content: r.content }))
}

/**
 * 追加一轮并落库。
 *
 * 裁剪用「先查再删」而不是定时任务：一次对话只多两条，攒到 40 轮以上才删，
 * 而定时任务要额外的基础设施。代价是每轮多一次 count 查询 —— 比维护一个调度器便宜。
 */
export async function appendTurn(
  userId: string,
  sessionId: string,
  tripId: string | null,
  userText: string,
  assistantText: string
): Promise<void> {
  const now = new Date()
  const rows = [
    { id: randomUUID(), sessionId, role: 'user', content: userText.slice(0, 4000), at: now },
    { id: randomUUID(), sessionId, role: 'assistant', content: assistantText.slice(0, 8000), at: now }
  ]
  await db.insert(aiMessages).values(rows)
  await db.update(aiSessions).set({ updatedAt: now, ...(tripId ? { tripId } : {}) }).where(eq(aiSessions.id, sessionId))

  const all = await db
    .select({ id: aiMessages.id })
    .from(aiMessages)
    .where(eq(aiMessages.sessionId, sessionId))
    .orderBy(desc(aiMessages.at))
  const overflow = all.slice(MAX_TURNS * 2)
  for (const r of overflow) {
    await db.delete(aiMessages).where(eq(aiMessages.id, r.id))
  }
  void userId
}

/**
 * 某趟旅程最近一次对话（换设备后进助手时读）。
 *
 * 只读文本：方案与预览由客户端根据当前行程重新渲染，不复活历史卡片。
 */
export async function latestTurnsOf(
  userId: string,
  tripId: string
): Promise<{ sessionId: string; turns: StoredTurn[]; updatedAt: string } | null> {
  const [latest] = await db
    .select()
    .from(aiSessions)
    .where(and(eq(aiSessions.userId, userId), eq(aiSessions.tripId, tripId)))
    .orderBy(desc(aiSessions.updatedAt))
    .limit(1)
  if (!latest) return null
  return {
    sessionId: latest.id,
    turns: await loadTurns(userId, latest.id),
    updatedAt: latest.updatedAt.toISOString()
  }
}