import { Hono } from 'hono'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { guideShares, photos } from '../db/schema.ts'
import { requireUser, resolveActorQuietly } from '../auth/middleware.ts'
import { media } from '../env.ts'
import { deletePhoto, isAllowedMime, newPhotoId, photoUrl, readPhoto, sha256, storePhoto } from '../sync/storage.ts'
import { referencesPhoto } from '../sync/photos.ts'

/**
 * 照片上传与读回（F08 后半）。
 *
 * 这是全仓第一个往磁盘写用户内容的接口，两个口子都按归属管：
 *   POST   要登录 —— 匿名上传等于给任何人一个免费图床。
 *   GET    匿名只在「这张照片已被一份未撤回的分享引用」时才放行 —— 分享页访客没账号；
 *          只被私人回忆引用的照片，凭 id 也取不走。
 *   DELETE 要登录且是本人 —— 被有效分享引用的照片拒绝删除，否则已发出去的攻略会裂图。
 *
 * 早先 GET 完全不鉴权，理由写的是「id 是 128 bit 随机值，不知道 id 就取不到」。
 * 那个理由只挡住盲猜，挡不住 id 从别处泄漏（日志、转发、截图）后的取回——
 * 私人回忆里的照片不该因为「被谁看到过 id」就变成公开资源。
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

  const digest = sha256(bytes)

  // 同图不重复落盘：同一个用户重新上传一张已有的图（换设备、重试、同一张图配两条回忆）
  // 不该再占一份磁盘。只按本人去重，别人的同一张图不能返回——那是跨账号泄漏 id。
  const [dup] = await db
    .select({ id: photos.id })
    .from(photos)
    .where(and(eq(photos.sha256, digest), eq(photos.userId, actor.userId)))
    .limit(1)
  if (dup) return c.json({ id: dup.id, url: photoUrl(dup.id), reused: true })

  const id = newPhotoId()
  const written = await storePhoto(id, bytes, mime)
  if (!written) {
    return c.json({ error: '照片存储尚未配置', code: 'storage_unavailable' }, 503)
  }

  // 落库失败时文件已经写下了。这里不回头删文件：一个只有文件没有行的孤儿，
  // 比「写了一半行、文件却不在」好处理得多，下次同图上传会命中上面的去重分支。
  await db.insert(photos).values({ id, userId: actor.userId, mime, bytes: bytes.byteLength, sha256: digest })

  return c.json({ id, url: photoUrl(id) })
})

/**
 * 读回。
 *
 * 两类合法读者：照片主人本人（带 token），以及匿名访客——但只在那张照片已被
 * 一份未撤回的分享快照引用时。
 *
 * 缓存策略按是否公开分：公开的用 immutable 长缓存（分享页可反复加载、走 CDN），
 * 私人的一律 private + no-store —— 私人照片要是进了共享缓存，下一个请求的人就绕过了鉴权。
 */
photoRoute.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [row] = await db.select().from(photos).where(eq(photos.id, id)).limit(1)
  if (!row) return c.json({ error: '照片不存在', code: 'not_found' }, 404)

  const publicShared = await isPubliclyShared(row.id)
  if (!publicShared) {
    const actor = await resolveActorQuietly(c.req.header('authorization'))
    if (!actor || actor.userId !== row.userId) {
      // 不存在与无权访问给同一个状态码：403 会告诉探测者「这个 id 是真的」
      return c.json({ error: '照片不存在', code: 'not_found' }, 404)
    }
  }

  const bytes = await readPhoto(row.id, row.mime)
  if (!bytes) return c.json({ error: '照片不存在', code: 'not_found' }, 404)

  return c.body(bytes, 200, {
    'content-type': row.mime,
    'content-length': String(bytes.byteLength),
    'cache-control': publicShared ? 'public, max-age=31536000, immutable' : 'private, no-store'
  })
})

/**
 * 删除本人照片（R3）。
 *
 * 已被有效分享引用的不让删：撤下文件会让别人正在看的攻略裂图，
 * 而用户想撤的是分享本身，那是 unpublish 的事，不是删照片。
 */
photoRoute.delete('/:id', requireUser, async (c) => {
  const actor = c.get('actor')
  if (!actor) return c.json({ error: '请先登录', code: 'unauthorized' }, 401)

  const id = c.req.param('id')
  const [row] = await db.select().from(photos).where(eq(photos.id, id)).limit(1)
  if (!row) return c.json({ error: '照片不存在', code: 'not_found' }, 404)
  // 别人的照片一律 404，不确认它的存在
  if (row.userId !== actor.userId) return c.json({ error: '照片不存在', code: 'not_found' }, 404)

  if (await isPubliclyShared(row.id)) {
    return c.json({ error: '这张照片正在被已发布的攻略引用，请先撤回分享', code: 'in_use' }, 409)
  }

  await db.delete(photos).where(eq(photos.id, row.id))
  await deletePhoto(row.id, row.mime)
  return c.json({ ok: true })
})

/** 这张照片是否被某份未撤回的分享快照引用 */
async function isPubliclyShared(photoId: string): Promise<boolean> {
  const active = await db
    .select({ snapshot: guideShares.snapshot })
    .from(guideShares)
    .where(isNull(guideShares.revokedAt))
  return active.some((s) => referencesPhoto(s.snapshot, photoId))
}
