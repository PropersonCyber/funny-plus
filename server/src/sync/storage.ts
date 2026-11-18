import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { media } from '../env.ts'

/**
 * 照片存储的唯一落点（F08 后半）。
 *
 * 为什么单独成文件：存储后端会换（本地磁盘 → S3 兼容对象存储），而这是全仓唯一
 * 需要跟着改的地方。路由层只认 `storePhoto` / `readPhoto` / `photoUrl` 三个函数，
 * 不关心文件到底在磁盘还是对象存储里。
 *
 * 为什么路径由 id 推导而不是存进库里：id 是主键、不可变，路径随 id 唯一确定，
 * 二者不会不一致。存 path 的话换后端要改所有历史行。
 */

/** 受支持的图片类型。白名单而非黑名单：文件后缀能被随便改，mime 也要靠调用方声明 */
export const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
export type AllowedMime = (typeof ALLOWED_MIME)[number]

export function isAllowedMime(mime: string): mime is AllowedMime {
  return (ALLOWED_MIME as readonly string[]).includes(mime)
}

/**
 * 扩展名只影响磁盘上好不好认，不参与任何判断 —— 读回时用库里存的 mime。
 * 不按 mime 之外的信息推断类型，避免「内容与声明不符」时出现两套口径。
 */
const EXT: Record<AllowedMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
}

/** 新 id：128 bit 随机，base64url 无特殊字符，可直接进 URL 与文件名 */
export function newPhotoId(): string {
  return randomBytes(16).toString('base64url')
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * 分桶：按 id 前两位建子目录。
 *
 * 单目录堆几万个文件后，`ls` 与某些文件系统都会变慢；按前两位分 4096 个桶，
 * 每个桶的文件数下降三个量级。id 是随机的，分桶天然均匀。
 */
function photoPath(id: string, mime: AllowedMime): string | null {
  // id 只允许 base64url 字符：它来自我们自己的 newPhotoId，但读路径也会被外部传参，
  // 这里挡一道 path traversal，不依赖调用方先校验
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) return null
  return path.join(media.dir, id.slice(0, 2), `${id}.${EXT[mime]}`)
}

/**
 * 写入一张照片。存储未配置时返回 null，由路由翻译成 503。
 *
 * 先 mkdir 再写：分桶目录按需创建，不在启动时预建 4096 个空目录。
 */
export async function storePhoto(
  id: string,
  bytes: Uint8Array,
  mime: AllowedMime
): Promise<boolean> {
  if (!media.configured()) return false
  const target = photoPath(id, mime)
  if (!target) return false
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, bytes)
  return true
}

/**
 * 读回一张照片。文件不存在返回 null（路由据此 404），存储未配置也返回 null。
 *
 * 不在这里校验 mime 白名单：库里存的 mime 写入时已校验过，读路径只接受
 * `isAllowedMime` 为真的值，其余当作不存在。
 */
export async function readPhoto(id: string, mime: string): Promise<Uint8Array | null> {
  if (!media.configured()) return null
  if (!isAllowedMime(mime)) return null
  const target = photoPath(id, mime)
  if (!target) return null
  try {
    return new Uint8Array(await readFile(target))
  } catch {
    return null
  }
}

/**
 * 照片的对外地址。
 *
 * 配了 `MEDIA_PUBLIC_BASE` 就拼绝对地址（原生端没有 origin，只能靠它）；
 * 没配就走相对路径，由 web 预览的 dev 代理或同源部署兜住。
 */
export function photoUrl(id: string): string {
  const base = media.publicBase
  return base ? `${base}/api/photos/${id}` : `/api/photos/${id}`
}
