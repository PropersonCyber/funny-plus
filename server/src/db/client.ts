import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { factFeedbacks, facts } from './schema.ts'

const url = process.env.PG_URL
if (!url) throw new Error('缺少 PG_URL，参照 server/.env.example 配置')

const pool = new Pool({ connectionString: url })

export const db = drizzle(pool, { schema: { factFeedbacks, facts } })
export { pool }
