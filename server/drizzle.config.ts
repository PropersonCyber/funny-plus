import { defineConfig } from 'drizzle-kit'

// drizzle-kit 会自动读 server/.env；没有 PG_URL 就直接报错，不静默连默认库
const url = process.env.PG_URL
if (!url) throw new Error('缺少 PG_URL，参照 server/.env.example 配置')

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url }
})
