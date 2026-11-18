import { Hono } from 'hono'
import { and, eq, isNull } from 'drizzle-orm'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { db } from '../db/client.ts'
import { guideShares, users } from '../db/schema.ts'
import { webAssets } from '../env.ts'
import type { GuideShareSnapshot } from '@/types/index.ts'
import { renderShareShell } from './shareShell.ts'

/**
 * 公开分享面（F08 后半）。
 *
 * 这个文件里的两个路由**都不带鉴权**，是全仓唯一的匿名可访问面，因此两条规矩：
 * 1. 只吐 `snapshot` 里已有的字段 —— 快照在发布时已经过隐私过滤，这里不再二次筛选，
 *    也因此绝不能再补 `userId` / 手机号 / `draftId` 进来。
 * 2. 响应里不出现任何可用于反查作者的东西。`authorLabel` 是从手机号派生的脱敏串，
 *    不是手机号本身；用户没留手机号时为空串而非伪造一个。
 */
export const shareRoute = new Hono()

/** 手机号脱敏：138****8000 之外的信息一律不给，够"认得是自己"就行 */
function authorLabelOf(phone: string | null): string {
  if (!phone || phone.length < 7) return ''
  const head = phone.slice(0, 3)
  const tail = phone.slice(-4)
  return `${head}****${tail}`
}

/**
 * 查一条有效的分享。
 *
 * `revokedAt` 非空的视为不存在：撤回后连「这个 token 曾是谁的」都不该回。
 * 返回 null 让调用方自己决定是 404 还是 200 引导页 —— 两个路由的 HTTP 语义不同。
 */
async function findActive(token: string): Promise<{ snapshot: GuideShareSnapshot; userId: string } | null> {
  const [row] = await db
    .select({ snapshot: guideShares.snapshot, userId: guideShares.userId })
    .from(guideShares)
    .where(and(eq(guideShares.token, token), isNull(guideShares.revokedAt)))
    .limit(1)
  if (!row) return null
  return { snapshot: row.snapshot as unknown as GuideShareSnapshot, userId: row.userId }
}

/**
 * 内容接口：给分享页与原生端拉正文。
 *
 * 无效 token 返回 404 而不是 200 + valid:false —— 这是 JSON 接口，调用方是程序不是人，
 * 200 会让前端以为拿到了数据。人看的那一页走下面的 `/s/:token`，那里才用 200 + 引导页。
 */
shareRoute.get('/:token', async (c) => {
  const token = c.req.param('token')
  const found = await findActive(token)
  if (!found) return c.json({ error: '这份攻略已不再公开', code: 'not_found' }, 404)

  const [author] = await db
    .select({ phone: users.phone })
    .from(users)
    .where(eq(users.id, found.userId))
    .limit(1)

  return c.json({
    snapshot: found.snapshot,
    authorLabel: authorLabelOf(author?.phone ?? null),
    valid: true
  })
})

/**
 * 分享页外壳：浏览器直接打开的那一页。
 *
 * 一律 200。失效链接给引导页，不是 404 —— 链接可能是很久以前发出去的，
 * 一个冷冰冰的 404 既不告诉用户发生了什么，也丢掉了「去 App 里看看」的机会。
 * 这也是国内 UGC 平台的通行做法（调研见 e2e-report）。
 */
export const shareShellRoute = new Hono()

shareShellRoute.get('/:token', async (c) => {
  const token = c.req.param('token')
  const found = await findActive(token)
  const html = renderShareShell({
    token,
    title: found?.snapshot.title ?? '',
    summary: found?.snapshot.summary ?? '',
    coverUrl: found?.snapshot.photos?.find((p) => p.kind === 'remote')?.value ?? '',
    valid: !!found,
    origin: new URL(c.req.url).origin
  })
  return c.html(html, 200)
})


/**
 * 静态产物路由（F08 后半）。
 *
 * 只放行白名单内的几种文件：分享页只用到 bundle、client.js 与 css、wasm。
 * 不做通用静态目录：`/web/../.env` 这类穿越一旦漏掉就等于把服务端文件公开出去，
 * 而分享页根本不需要读任意路径。
 */
const ASSET_TYPES: Record<string, string> = {
  '.bundle': 'application/octet-stream',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8'
}

export const webAssetRoute = new Hono()

webAssetRoute.get('/*', async (c) => {
  const rel = c.req.path.replace(/^\/web\/?/, '')
  if (!rel) return c.json({ error: '缺少资源路径', code: 'bad_param' }, 400)
  // 只接受本目录下的相对路径；含 .. 或绝对路径一律拒掉
  if (rel.includes('..') || path.isAbsolute(rel)) {
    return c.json({ error: '非法路径', code: 'bad_param' }, 400)
  }
  // 白名单校验：不是这几种类型一律当作不存在，避免把源码或配置读出去
  const ext = path.extname(rel)
  const type = ASSET_TYPES[ext]
  if (!type) return c.json({ error: '不支持的资源类型', code: 'not_found' }, 404)

  const full = path.join(webAssets.dir, rel)
  try {
    const bytes = new Uint8Array(await readFile(full))
    /**
     * 用 `大小-mtime` 当 ETag，而不是内容哈希：bundle 有 12MB，每次请求都算哈希
     * 等于把静态资源的开销搬到服务端。mtime 一变 ETag 就变，正是构建产物要的语义。
     *
     * 用协商缓存而不是长缓存：开发期 rebuild 后刷新要立刻看到新页面，长缓存会让人
     * 对着旧界面调半天。生产换 CDN 时再按文件名哈希改成长缓存。
     */
    const info = await stat(full)
    const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`
    if (c.req.header('if-none-match') === etag) {
      return c.body(null, 304, { etag, 'cache-control': 'public, max-age=0, must-revalidate' })
    }
    return c.body(bytes, 200, {
      'content-type': type,
      'content-length': String(bytes.byteLength),
      etag,
      'cache-control': 'public, max-age=0, must-revalidate'
    })
  } catch {
    return c.json({ error: '资源不存在', code: 'not_found' }, 404)
  }
})
