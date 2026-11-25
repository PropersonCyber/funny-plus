import { sql } from 'drizzle-orm'
import { db } from '../db/client.ts'

/**
 * 数据版本号：`places` / `lines` / `field_evidence` 三个表任何增、改、删都会推进它。
 *
 * **为什么需要它**：`ensureEngine` 把地点池、线路和字段依据灌进 `shared/engine` 的模块级单例，
 * 之后整个进程不再刷新。但数据可以从**别的进程**改进来 —— `npm run add:field-evidence`、
 * `npm run db:seed`、甚至手动 psql。那些进程没有本进程的 `invalidateEngine()`，
 * 只靠进程内代次的话，AI 侧会一直拿旧值，而 `/api/places` 是实时查库的，
 * 于是同一个营业时间在页面和对话里说法不同（见 spec §4.2）。
 *
 * **为什么计数器而不是比各表的 `max(updated_at)`**：最大值对两类写入瞎 ——
 * 删掉一条非最新记录（最大值不变）、手动 UPDATE 没写 `updated_at`（列默认值只在 insert 生效）。
 * 计数器由触发器维护（迁移 0023），写入方**不需要记得做任何事**。
 *
 * **为什么不做成「谁改了谁 +1」的应用层约定**：那要求每一个写入方都记得加，
 * 包括将来的脚本、迁移和临时修数据。漏一处就是永久不同步，而且没有报错。
 */
export async function dataVersion(): Promise<string> {
  const result = await db.execute<{ version: string }>(sql`select "version"::text as version from "data_version" where "id" = 'global'`)
  return result.rows[0]?.version ?? '0'
}
