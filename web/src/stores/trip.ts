import { reactive, ref, watch } from 'vue'
import type { Plan, SavedTrip } from '@/types'
import { fetchTrips } from '@/api/catalog'

// 单仓单 store，够用就不引 Pinia；localStorage 是首期的「云端档案」替身。
const KEY = 'funny-plus.trips.v1'

/** 写不进去（隐私模式 / 配额满）必须能被界面看到，否则用户以为已经存下了 */
export const saveError = ref('')

interface State {
  trips: SavedTrip[]
  currentId: string | null
}

const state = reactive<State>(load())

function load(): State {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as SavedTrip[]
      return { trips: parsed, currentId: parsed[0]?.id ?? null }
    }
  } catch {
    // 存档损坏时直接丢弃，不让页面白屏
  }
  return { trips: [], currentId: null }
}

watch(
  state,
  (s) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s.trips))
      saveError.value = ''
    } catch {
      saveError.value = '保存到本机失败：浏览器存储不可用或空间已满，刷新后这份行程会丢失'
    }
  },
  { deep: true, flush: 'sync' }
)

export function saveTrip(demand: SavedTrip['demand'], plan: Plan): SavedTrip {
  const trip: SavedTrip = {
    id: `${Date.now()}`,
    demand,
    plan,
    savedAt: new Date().toISOString(),
    versions: [{ at: new Date().toISOString(), note: '首次生成' }]
  }
  state.trips.unshift(trip)
  state.currentId = trip.id
  return trip
}

export function updatePlan(tripId: string, plan: Plan, note: string, impact?: SavedTrip['versions'][number]['impact']) {
  const trip = state.trips.find((t) => t.id === tripId)
  if (!trip) return
  trip.plan = plan
  trip.versions.push({ at: new Date().toISOString(), note, impact })
}

export function removeTrip(id: string) {
  const idx = state.trips.findIndex((t) => t.id === id)
  if (idx >= 0) state.trips.splice(idx, 1)
  if (state.currentId === id) state.currentId = state.trips[0]?.id ?? null
}

export const tripStore = state
export const currentTrip = (): SavedTrip | undefined =>
  state.trips.find((t) => t.id === state.currentId) ?? state.trips[0]

/**
 * 本机没有存档时，把服务端的示例行程导进来（之后就能当自己的行程改）。
 * 取不到也不报错——示例不是必需能力，空列表就好。
 */
export async function importExamples(): Promise<void> {
  if (state.trips.length) return
  try {
    const items = await fetchTrips()
    if (!items.length) return
    state.trips = items
    state.currentId = items[0].id
  } catch {
    /* 忽略：示例行程拉不到不影响本地行程 */
  }
}
