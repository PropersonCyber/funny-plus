import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { db } from './db/client.ts'
import { factsRoute } from './routes/facts.ts'
import { placesRoute } from './routes/places.ts'
import { tripsRoute } from './routes/trips.ts'

const app = new Hono()

// 健康检查必须探到库，否则库挂了接口还报 ok
app.get('/api/health', async (c) => {
  try {
    await db.execute(sql`select 1`)
    return c.json({ ok: true, db: 'up' })
  } catch {
    return c.json({ ok: false, db: 'down' }, 503)
  }
})
app.route('/api/facts', factsRoute)
app.route('/api/places', placesRoute)
app.route('/api/trips', tripsRoute)

app.onError((err, c) => {
  console.error('[api]', err)
  return c.json({ error: '服务端出错' }, 500)
})

const port = Number(process.env.PORT ?? 8787)
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`funny-plus api listening on http://127.0.0.1:${info.port}`)
})
