import { serve } from '@hono/node-server'
import { app } from './app.ts'

/**
 * 进程入口：只负责起端口。路由与中间件全在 app.ts，
 * 这样测试可以 import app 而不触发 serve()。
 */
const port = Number(process.env.PORT ?? 8787)
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`funny-plus api listening on http://127.0.0.1:${info.port}`)
})
