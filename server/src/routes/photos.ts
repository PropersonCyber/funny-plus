import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { photos } from '../db/schema.ts'
import { requireUser } from '../auth/middleware.ts'
import { media } from '../env.ts'
import { isAllowedMime, newPhotoId, photoUrl, readPhoto, sha256, storePhoto } from '../sync/storage.ts'

/**
 * 照片上传与读回（F08 后半）。
 *
 * 这是全仓第一个往磁盘写用户内容的接口，两条口子分开管：
 *   POST 要登录 —— 匿名上传等于给任何人一个免费图床。
 *   GET  不要登录 —— 分享页的访客没账号，照片必须能直接加载。
 *
 * GET 不鉴权是可接受的：id 是 128 bit 随机值，不知道 id 就取不到；
 * 内容本身就是用户主动要发出去的照片。
 */
export const photoRoute = new Hono()

photoRoute.post('/', requireUser, async (c) => {
  const actor = c.get('actor')
  if (!actor) return c.json({ error: '请先登录', code: 'unauthorized' }, 401)

  // 未配置存储时先返回：别让用户等完成上传才发现无处可写
  if (!media.configured()) {
    return c.json({ error: '照片存储尚未配置', code: 'storage_unavailable' }, 503)
  }

  let form: FormData
  try {
    form = await c.req.formData()
  } catch {
    return c.json({ error: '请求体不是合法的表单', code: 'bad_param' }, 400)
  }

  const file = form.get('file')
  if (!file || typeof file === 'string') {
    return c.json({ error: '缺少文件字段 file', code: 'bad_param' }, 400)
  }

  const mime = file.type
  if (!isAllowedMime(mime)) {
    return c.json({ error: '只支持 JPEG / PNG / WebP / GIF', code: 'unsupported_type' }, 415)
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  // 先看实际字节数再写盘：File.size 由客户端提供，可能骗人
  if (bytes.byteLength === 0) {
    return c.json({ error: '文件是空的', code: 'bad_param' }, 400)
  }
  if (bytes.byteLength > media.maxBytes) {
    return c.json(
      { error: `图片超过 ${Math.round(media.maxBytes / 1024 / 1024)}MB 上限`, code: 'too_large' },
      413
    )
  }

  const id = newPhotoId()
  const digest = sha256(bytes)
  const written = await storePhoto(id, bytes, mime)
  if (!written) {
    return c.json({ error: '照片存储尚未配置', code: 'storage_unavailable' }, 503)
  }

  // 落库失败时文件已经写下了。这里不回头删文件：一个只有文件没有行的孤儿，
  // 比「写了一半行、文件却不在」好处理得多，且下次同图上传会得到新 id、不受影响。
  await db.insert(photos).values({ id, userId: actor.userId, mime, bytes: bytes.byteLength, sha256: digest })

  return c.json({ id, url: photoUrl(id) })
})

/**
 * 公开读回。
 *
 * 用 immutable 长缓存：id 与内容一一对应且永不改写，同一 URL 的字节不会变，
 * 让浏览器和 CDN 放心长期缓存。这也是「不给照片做版本号」的底气。
 */
photoRoute.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [row] = await db.select().from(photos).where(eq(photos.id, id)).limit(1)
  if (!row) return c.json({ error: '照片不存在', code: 'not_found' }, 404)

  const bytes = await readPhoto(row.id, row.mime)
  if (!bytes) return c.json({ error: '照片不存在', code: 'not_found' }, 404)

  return c.body(bytes, 200, {
    'content-type': row.mime,
    'content-length': String(bytes.byteLength),
    'cache-control': 'public, max-age=31536000, immutable'
  })
})
