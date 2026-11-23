import type { ItineraryItem, TripContext } from '@/types/index.ts'
import { CHAT_BASE_PROMPT, CHAT_TASK_PROMPTS, PROMPT_VERSION } from './prompt.ts'
import type { Slots } from './slots.ts'

const TASK_TOOLS = {
  plan: ['updateDemand', 'queryPlaces', 'getPlaceDetail', 'getFacts', 'listLines',
    'nearbyPlaces', 'transportFor', 'generatePlans'],
  nearby: ['queryPlaces', 'nearbyPlaces', 'getPlaceDetail', 'getFacts']
} as const

type ChatTask = keyof typeof TASK_TOOLS | 'general'

// 只收窄容易识别的请求。承接上文和复合意图交给完整对话流程。
function selectTask(text: string, hasTrip: boolean): ChatTask {
  const request = text.trim()
  if (/^(?:请|帮我|咕噜[，, ]*)*附近(?:有什么(?:好吃|好玩|好拍)(?:的)?|有什么|哪里(?:好拍|适合拍照)|有(?:什么|没有)(?:好吃的|好玩的|拍照点))[？?。！!]*$/.test(request)) {
    return 'nearby'
  }
  if (!hasTrip && /^(?:请)?(?:帮我|给我)(?:规划|安排|排)(?:一趟|一下|个)?[^。？！?！!]{1,100}(?:日游|天的行程|旅行|行程)(?:[，,][^。？！?！!]{1,55})?[。！!]*$/.test(request) &&
      !/附近|顺便|然后|再帮|并且|比较|订|换|改/.test(request)) {
    return 'plan'
  }
  return 'general'
}

function demandBrief(demand: Slots, nearby: boolean) {
  const { destination, dateFrom, dateTo, dayCount, party, budgetLevel, preferences, transport, startMin,
    returnBy, hours, mustVisit } = demand
  return nearby
    ? { destination, party, preferences, returnBy, hours }
    : { destination, dateFrom, dateTo, dayCount, party, budgetLevel, preferences, transport, startMin, returnBy,
        hours, mustVisit }
}

function itemBrief(item: ItineraryItem) {
  const { id, title, kind, placeId, startMin, endMin, cost, pinned } = item
  return { id, title, kind, placeId, startMin, endMin, cost, pinned }
}

function tripBrief(trip: TripContext, nearby: boolean) {
  const demand = demandBrief(trip.demand, nearby)
  if (nearby) {
    const fixedItems = trip.plan.days.flatMap((day) =>
      day.items.filter((item) => item.pinned).map((item) => ({ day: day.index, ...itemBrief(item) }))
    )
    return { ...demand, fixedItems }
  }
  return {
    ...demand,
    planTransport: trip.plan.transport,
    days: trip.plan.days.map((day) => ({ day: day.index, items: day.items.map(itemBrief) }))
  }
}

function locationBrief(loc: { accuracy?: number } | null) {
  if (!loc) return { status: 'unavailable' }
  const accuracy = loc.accuracy
  if (typeof accuracy !== 'number' || !Number.isFinite(accuracy) || accuracy <= 0) {
    return { status: 'unknown_accuracy' }
  }
  return { status: accuracy > 500 ? 'coarse' : 'available', accuracyM: Math.round(accuracy) }
}

export function buildChatPrompt({ text, trip, loc, slots }: {
  text: string
  trip: TripContext | null
  loc: { accuracy?: number } | null
  slots: Slots
}) {
  const task = selectTask(text, trip !== null)
  const nearby = task === 'nearby'
  const context = {
    draft: demandBrief(slots, nearby),
    trip: trip ? tripBrief(trip, nearby) : null,
    location: locationBrief(loc)
  }
  // 输入数据保持 JSON 可读，同时避免地点名称中的标签被当作分节。
  const json = JSON.stringify(context).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e')
  const instructions = task === 'general' ? Object.values(CHAT_TASK_PROMPTS) : [CHAT_TASK_PROMPTS[task]]
  const system = [
    CHAT_BASE_PROMPT,
    ...instructions,
    '以下是当前旅行数据。startMin、endMin、returnBy 使用当日分钟数。pinned 表示用户固定的安排。',
    `<travel_context>\n${json}\n</travel_context>`
  ].join('\n\n')
  return {
    task,
    system,
    activeTools: task === 'general' ? undefined : TASK_TOOLS[task],
    version: `${PROMPT_VERSION}:${task}`
  }
}
