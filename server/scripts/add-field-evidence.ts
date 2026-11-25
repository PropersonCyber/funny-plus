import { eq } from 'drizzle-orm'
import { db, pool } from '../src/db/client.ts'
import { fieldEvidence, lines, places } from '../src/db/schema.ts'

async function main() {
  const [scope, targetId, field, value, source, verifiedBy, sourceUrl] = process.argv.slice(2)
  if ((scope !== 'place' && scope !== 'line') || !targetId?.trim() || !field?.trim() || !value?.trim() || !source?.trim() || !verifiedBy?.trim()) {
    throw new Error('用法：add:field-evidence -- place|line 对象ID 字段 值 来源 核验人 [来源网址]')
  }
  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) throw new Error('来源网址必须以 http 或 https 开头')
  const target = scope === 'place'
    ? await db.select({ id: places.id }).from(places).where(eq(places.id, targetId)).limit(1)
    : await db.select({ id: lines.id }).from(lines).where(eq(lines.id, targetId)).limit(1)
  if (!target.length) throw new Error('对象不存在')
  const id = crypto.randomUUID()
  await db.insert(fieldEvidence).values({ id, scope, targetId, field, value, source, verifiedBy, sourceUrl: sourceUrl || null, verifiedAt: new Date() })
  console.log(JSON.stringify({ id }))
}
main().catch((err: unknown) => { console.error(err); process.exitCode = 1 }).finally(() => pool.end())
