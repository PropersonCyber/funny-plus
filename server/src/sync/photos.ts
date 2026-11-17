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
