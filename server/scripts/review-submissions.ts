import { eq } from 'drizzle-orm'
import { db, pool } from '../src/db/client.ts'
import { dataSubmissions } from '../src/db/schema.ts'
import { publishSubmission } from '../src/data/publishSubmission.ts'
import { reviewSubmission } from '../src/data/reviewSubmission.ts'

/** 本地审核队列：只读，避免未经核验的用户输入直接成为平台事实。 */
async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.length) {
    const [decision, id, reviewer, ...reason] = args
    if (decision === 'publish') {
      if (!id || !reviewer || reason.length !== 1) throw new Error('用法：review:submissions -- publish 编号 来源名称 来源网址')
      await publishSubmission(id, reviewer, reason[0])
      console.log('已发布并记录来源')
      return
    }
    if ((decision !== 'verified' && decision !== 'rejected') || !id || !reviewer || !reason.join(' ').trim()) {
      throw new Error('用法：review:submissions -- verified|rejected 编号 审核人 核验依据')
    }
    if (!await reviewSubmission(id, decision, reviewer, reason.join(' '))) throw new Error('记录不存在或已处理')
    console.log('审核结果已记录；平台事实未修改')
    return
  }
  const rows = await db.select({
    id: dataSubmissions.id,
    scope: dataSubmissions.scope,
    targetId: dataSubmissions.targetId,
    field: dataSubmissions.field,
    value: dataSubmissions.value,
    note: dataSubmissions.note,
    createdAt: dataSubmissions.createdAt
  }).from(dataSubmissions).where(eq(dataSubmissions.status, 'pending')).orderBy(dataSubmissions.createdAt)
  console.log(JSON.stringify({ total: rows.length, items: rows }, null, 2))
}

main().catch((err: unknown) => {
  console.error('读取待核验补录失败', err)
  process.exitCode = 1
}).finally(() => pool.end())
