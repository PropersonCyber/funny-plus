/**
 * 云端与本机数据的合并规则（G5）。
 *
 * 单独成文件而不是塞进 sync.ts：合并是纯函数，喂两组数据就能断言，
 * 而 sync.ts 依赖 api.ts —— 它的泛型箭头会让 rstest 当 JSX，整条 import 链上的测试都跑不起来
 * （与 photoData.ts / syncStatus.ts / factsData.ts / device.ts 同一个原因）。
 *
 * 规则只有一条：**按 id 取较新的那份，时间相同则保留本机那份。**
 *
 * 为什么平手要给本机：用户此刻正在看的就是本机这份，云端打平说明两边其实是同一份数据，
 * 此时用云端覆盖等于让「我刚看到的内容」闪一下变样，而没有任何信息增量。
 */
import type { GuideDraft, TripMemory } from './data.js'
import type { GuideBook, MemoryBook, SavedTrip } from './storage.js'

export type RemoteTrip = SavedTrip
export type RemoteMemory = { tripId: string; payload: TripMemory; updatedAt: string }
export type RemoteGuide = {
  id: string
  tripId: string
  payload: GuideDraft
  updatedAt: string
  share: { token: string; url: string } | null
}

const stamp = (iso: string | undefined): number => {
  if (!iso) return 0
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? 0 : t
}

export function mergeTrips(local: SavedTrip[], remote: RemoteTrip[]): SavedTrip[] {
  const byId = new Map<string, SavedTrip>()
  // 先放本机：平手时 map 里留的就是本机这份
  for (const t of local) byId.set(t.id, t)
  for (const r of remote) {
    const cur = byId.get(r.id)
    if (!cur || stamp(r.savedAt) > stamp(cur.savedAt)) byId.set(r.id, r)
  }
  return [...byId.values()]
}

export function mergeMemories(local: MemoryBook, remote: RemoteMemory[]): MemoryBook {
  const out: MemoryBook = { ...local }
  for (const r of remote) {
    const cur = out[r.tripId]
    // 服务端已在写入时剥离 local / dataUri 照片，这里拿到的就是可跨设备的那一份
    if (!cur || stamp(r.updatedAt) > stamp(cur.updatedAt)) out[r.tripId] = r.payload
  }
  return out
}

/**
 * 草稿按 book 的键（tripId）合并，不按草稿自己的 id。
 *
 * 一趟旅程对应一份攻略是产品口径（见 useGuides.putDraft 的注释），
 * 按 draft.id 合并会让同一趟旅程出现两份草稿，用户得自己决定发哪一份。
 */
export function mergeGuides(
  local: GuideBook,
  remote: { tripId: string; payload: GuideDraft }[]
): GuideBook {
  const out: GuideBook = { ...local }
  for (const r of remote) {
    const key = r.tripId || r.payload.tripId
    if (!key) continue
    const cur = out[key]
    if (!cur || stamp(r.payload.updatedAt) > stamp(cur.updatedAt)) out[key] = r.payload
  }
  return out
}

/**
 * 一次同步的汇总，用来决定要不要提示用户。
 *
 * 只在「真的带回了本机没有的东西」时提示：每次登录都弹一句「已同步」是噪音，
 * 用户很快就会当它不存在。
 */
export type PullSummary = { trips: number; memories: number; guides: number }

export function summarizePull(before: PullSummary, after: PullSummary): PullSummary {
  return {
    trips: Math.max(0, after.trips - before.trips),
    memories: Math.max(0, after.memories - before.memories),
    guides: Math.max(0, after.guides - before.guides)
  }
}