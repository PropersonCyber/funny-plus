/**
 * 上云前剥掉不可跨设备的照片。
 *
 * `PhotoRef` 有三态：`remote` 是可跨设备的地址；`local` 是壳层给的文件路径；`dataUri`
 * 是内联数据。后两者换设备即失效 —— 把它们存进云端不会让照片「找回」，只会让新设备
 * 拿到一堆打不开的路径，比缺失更糟。
 *
 * 为什么按 key 递归而不是给 TripMemory / GuideDraft 各写一份：两者都有 `photos`，
 * 且回忆的 `places` 是按 PlanItem.id 的 map，下一层还有照片。按结构递归一次覆盖，
 * 加字段时不需要再改这里。
 *
 * 返回新对象，不修改入参：调用方可能还要用原负载做本机存储。
 */
export function stripLocalPhotos<T>(input: T): T {
  return walk(input) as T
}

function walk(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(walk)
  if (!value || typeof value !== 'object') return value

  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'photos' && Array.isArray(val)) {
      out[key] = val.filter((p) => isRemotePhoto(p)).map(walk)
    } else {
      out[key] = walk(val)
    }
  }
  return out
}

function isRemotePhoto(p: unknown): boolean {
  return !!p && typeof p === 'object' && (p as { kind?: unknown }).kind === 'remote'
}

/**
 * 快照树里是否引用了这张照片（R3）。
 *
 * 照片一旦被一份未撤回的分享快照引用，匿名访客就必须能读到——分享页没有账号。
 * 反过来，只被私人回忆引用的照片不能让任何人凭 id 取走。
 *
 * 按 id 匹配而不是 URL：URL 含 `MEDIA_PUBLIC_BASE`，换域名后历史快照里的地址
 * 就不再相等，那会让已发布的分享页在换域名后集体裂图。
 */
export function referencesPhoto(snapshot: unknown, photoId: string): boolean {
  const seen = new Set<unknown>()
  const walk = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return false
    if (seen.has(value)) return false
    seen.add(value)
    if (Array.isArray(value)) return value.some(walk)
    const obj = value as Record<string, unknown>
    if (obj.kind === 'remote' && obj.id === photoId) return true
    return Object.values(obj).some(walk)
  }
  return walk(snapshot)
}
