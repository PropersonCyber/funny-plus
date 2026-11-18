import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { db } from './db/client.ts'
import { aiRoute } from './routes/ai.ts'
import { authRoute } from './routes/auth.ts'
import { contentRoute } from './routes/content.ts'
import { eventsRoute } from './routes/events.ts'
import { factsRoute } from './routes/facts.ts'
import { geoRoute } from './routes/geo.ts'
import { guideRoute } from './routes/guides.ts'
import { linesRoute } from './routes/lines.ts'
import { meRoute } from './routes/me.ts'
import { memoryRoute } from './routes/memories.ts'
import { placesRoute } from './routes/places.ts'
import { reportRoute, submitRoute } from './routes/submit.ts'
import { photoRoute } from './routes/photos.ts'
import { tripsRoute } from './routes/trips.ts'
import { shareRoute, shareShellRoute, webAssetRoute } from './routes/share.ts'

/**
 * Hono 应用本体。从 index.ts 拆出来是为了能在测试里用 `app.request()` 直接打路由：
 * index.ts 一被 import 就 `serve()` 起端口，测试会互相抢端口且无法断言响应。
 */
export const app = new Hono()

// 健康检查必须探到库，否则库挂了接口还报 ok
app.get('/api/health', async (c) => {
  try {
    await db.execute(sql`select 1`)
    return c.json({ ok: true, db: 'up' })
  } catch {
    return c.json({ ok: false, db: 'down' }, 503)
  }
})
app.route('/api/auth', authRoute)
app.route('/api/content', contentRoute)
app.route('/api/me', meRoute)
app.route('/api/facts', factsRoute)
app.route('/api/places', placesRoute)
app.route('/api/lines', linesRoute)
// 用户补录走 /api/submissions；「这条不对」单独一个路径，方便按规则统计误报率
app.route('/api/submissions', submitRoute)
app.route('/api/constraints', reportRoute)
app.route('/api/trips', tripsRoute)
// 回忆与攻略草稿：账号私有数据，读写都要求登录
app.route('/api/memories', memoryRoute)
app.route('/api/guides', guideRoute)
app.route('/api/geo', geoRoute)
app.route('/api/ai', aiRoute)
// 埋点批量上报（F10）：独立路径，与业务接口分开，便于单独限流或关停
app.route('/api/events', eventsRoute)
// 照片：POST 要登录（防匿名图床），GET 不要登录（分享页访客没有账号）
app.route('/api/photos', photoRoute)
// 公开分享面：/api/share 给程序拉正文，/s 给人看的 HTML 外壳（注入 og 标签）
app.route('/api/share', shareRoute)
app.route('/s', shareShellRoute)
// 分享页的前端静态产物：访客浏览器里没有壳层，bundle 与运行时只能由服务端吐
app.route('/web', webAssetRoute)

app.onError((err, c) => {
  console.error('[api]', err)
  return c.json({ error: '服务端出错' }, 500)
})
