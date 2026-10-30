import type { Place, SavedTrip, TravelFact } from '@/types'
import { readError } from './http'

/** 避坑目录 */
export async function fetchFacts(city?: string): Promise<TravelFact[]> {
  const query = city ? `?city=${encodeURIComponent(city)}` : ''
  const res = await fetch(`/api/facts${query}`)
  if (!res.ok) throw new Error(await readError(res))
  const body = (await res.json()) as { items: TravelFact[] }
  return body.items
}

/** 地点池：启动时一次拉全量，前端自己建索引 */
export async function fetchPlaces(city?: string): Promise<Place[]> {
  const query = city ? `?city=${encodeURIComponent(city)}` : ''
  const res = await fetch(`/api/places${query}`)
  if (!res.ok) throw new Error(await readError(res))
  const body = (await res.json()) as { items: Place[] }
  return body.items
}

/** 示例行程（服务端 client_id 为空的记录），首次打开时导入本机 */
export async function fetchTrips(): Promise<SavedTrip[]> {
  const res = await fetch('/api/trips')
  if (!res.ok) throw new Error(await readError(res))
  const body = (await res.json()) as { items: SavedTrip[] }
  return body.items
}
