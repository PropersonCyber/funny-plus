import { serve } from '@hono/node-server'
import { app } from './app.ts'
import { isDev } from './auth/codes.ts'

/**
 * 进程入口：只负责起端口。路由与中间件全在 app.ts，
 * 这样测试可以 import app 而不触发 serve()。
 */
const port = Number(process.env.PORT ?? 8787)
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`funny-plus api listening on http://127.0.0.1:${info.port}`)
})

// 固定码能用却没人知道，是这类开关最糟的状态：线上出了问题也看不出是它
if (isDev()) {
  console.warn(
    '[auth] ⚠ AUTH_DEV_CODE=1：任意手机号可用固定码 123456 登录，且 /api/auth/dev-code 可读。仅供本机开发，部署前务必去掉'
  )
}
