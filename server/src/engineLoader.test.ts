import { afterAll, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db, pool } from './db/client.ts'
import { places } from './db/schema.ts'
import { ensureEngine, engineLoaderHooks } from './engineLoader.ts'
import { placeById } from '@/engine/placeIndex.ts'

const id = 'test-reload-place'
const row = {
  id,
  name: '重载测试点',
  city: '测试城',
  lng: 104.0,
  lat: 30.6,
  openStart: 540,
  openEnd: 1020,
  stayMin: 60,
  walk: 1 as const,
  tags: ['打卡'],
  trust: 'official' as const
}

/**
 * 在不改动任何真实数据的前提下推进数据版本号。
 *
 * `WHERE false` 一行都碰不到，但语句级触发器照样触发 —— 测试需要的是「版本变了」，
 * 不需要真的改一行数据。
 */
const bumpVersion = async (): Promise<void> => {
  await db.execute(sql`update lines set updated_at = updated_at where false`)
}

/**
 * 等到有一条查询正在等 `lines` 上的锁 —— 也就是装载已经走到读表那一步。
 *
 * 不用固定睡眠：机器慢时可能还没发起查询，机器快时又白等，
 * 而且睡不够时测试会静默地什么都没验到。
 */
const waitForBlockedReadOfLines = async (): Promise<void> => {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const result = await db.execute<{ waiting: string }>(sql`
      select count(*)::text as waiting from pg_stat_activity
      where datname = current_database()
        and wait_event_type = 'Lock'
        and query ilike '%from "lines"%'
    `)
    if (Number(result.rows[0]?.waiting ?? 0) > 0) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('装载没有卡在读 lines 上：这个用例的时序假设不成立')
}

afterAll(async () => {
  engineLoaderHooks.afterLoad = undefined
  await db.delete(places).where(eq(places.id, id))
  await pool.end()
})

/**
 * 端到端验证的是「别的进程写进来，本进程的下一次请求能看到新数据」。
 *
 * 只测 `dataVersion()` 会变化是不够的：那证明不了装载逻辑真的用了它。
 */
it('别的进程写进来的地点，下一次装载能看到', async () => {
  await db.delete(places).where(eq(places.id, id))
  await ensureEngine()
  expect(placeById(id)).toBeUndefined()

  // 模拟独立进程（CLI / 迁移 / 手动 psql）：本进程的代次不会动，只有库里的版本号变
  await db.insert(places).values(row)
  await ensureEngine()
  expect(placeById(id)?.name).toBe('重载测试点')
})

it('并发请求同时发现数据变时，不会用旧值盖掉新值', async () => {
  await db.update(places).set({ name: '并发后' }).where(eq(places.id, id))
  // 两个请求同时进来，各自都会看到版本变了；只允许一个装载在跑
  await Promise.all([ensureEngine(), ensureEngine()])
  expect(placeById(id)?.name).toBe('并发后')
})

it('装载到一半数据被改了：旧的那一批必须丢弃，最终拿到新值', async () => {
  await db.delete(places).where(eq(places.id, id))
  await ensureEngine()
  // 先造一次无关写入把缓存变旧。不这样的话 ensureEngine 进来就发现「已是最新」直接返回，
  // 根本不会发生装载，这个用例也就什么都没验到。
  //
  // 必须是 `WHERE false`：**绝不改动真实数据**。测试连的是开发库，
  // 一句 `update lines set updated_at = now()` 会把库里所有线路的「数据更新时间」改成今天，
  // 而这个字段正是 AI 侧判断数据新旧的依据。
  // 0 行也能推进版本号，是因为触发器建成了 FOR EACH STATEMENT —— 语句执行就算一次，
  // 不看影响了几行。
  await bumpVersion()

  // 拿一个表锁把 load() 读 lines 的那一步卡住，制造「旧加载正在跑」的真实时序。
  // 只让两个请求同时发现变化，是证明不了旧结果会不会盖掉新值的。
  const client = await pool.connect()
  let committed = false
  try {
    await client.query('BEGIN')
    await client.query('LOCK TABLE lines IN ACCESS EXCLUSIVE MODE')
    // 失败路径上也要兑现掉，否则这个 Promise 会变成未处理的 rejection
    const pending = ensureEngine()
    pending.catch(() => {})
    // 等真的「卡在读 lines 上」，不靠固定睡眠：机器慢时可能还没走到那条查询，
    // 机器快时又白等，而睡不够时测试会静默地什么都没验到。
    await waitForBlockedReadOfLines()
    // 旧加载卡在读表上，此时「别的进程」写入新数据：版本号变了，但它手里还是旧值
    await db.insert(places).values({ ...row, name: '装载期间写入' })
    await client.query('COMMIT')
    committed = true
    await pending
    expect(placeById(id)?.name).toBe('装载期间写入')
  } finally {
    // 断言失败时也要把锁放下，否则后面的用例全部卡死在这张表上
    if (!committed) await client.query('ROLLBACK').catch(() => {})
    client.release()
  }
})

it('重试用尽时必须报错，不能把没确认过的缓存当成最新返回', async () => {
  // 每次装载完都在「确认前」再改一次数据，让三次重试全部落空。
  // 没有最后那次确认的话，这里会安静地返回 —— 而调用方以为拿到的是最新数据。
  // 先让缓存变旧，否则 ensureEngine 一进来就发现「已是最新」，根本不会装载
  await bumpVersion()
  engineLoaderHooks.afterLoad = bumpVersion
  await expect(ensureEngine()).rejects.toThrow('数据一直在变')
  engineLoaderHooks.afterLoad = undefined
})
