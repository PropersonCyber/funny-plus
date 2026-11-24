import type { ItineraryItem, TripContext } from '@/types/index.ts'
import { CHAT_BASE_PROMPT, CHAT_TASK_PROMPTS, PROMPT_VERSIONS, composePromptVersion } from './prompt.ts'
import type { Slots } from './slots.ts'

const TASK_TOOLS = {
  // 刻意不给 validatePlan：它的实现是「检查当前行程」，而 plan 任务是从零规划，
  // 此时 trip 为 null，模型一调就拿到「还没有行程，不能校验」。
  // 规划阶段的可行性判断由 generatePlans 返回的 checks 负责（见 plan 提示词）。
  plan: ['updateDemand', 'queryPlaces', 'getPlaceDetail', 'getFacts', 'listLines',
    'nearbyPlaces', 'transportFor', 'generatePlans'],
  nearby: ['queryPlaces', 'nearbyPlaces', 'getPlaceDetail', 'getFacts']
} as const

type ChatTask = keyof typeof TASK_TOOLS | 'general'

/**
 * 用户这句话的主意图。
 *
 * 上一版用整句正则匹配，要求**整句**完全符合才算命中 —— 于是
 * 「附近有什么好吃的，顺便看看晚上去哪」这种最常见的一句话，因为多了后半句
 * 就退回 general，11 个工具全开、完整行程全塞进上下文。**最需要收敛的场景反而没收敛**。
 *
 * 改法：先按标点把句子切开，只看**第一个子句**判断主意图。
 * 为什么只看第一个：中文里「A，顺便 B」的主意图在 A，B 是追加要求。
 * 拿整句去匹配，B 会污染判断；拿所有子句去匹配，只要有一句像附近就收敛，
 * 又会把「附近有什么？然后帮我排个行程」错判成纯附近查询。
 *
 * 但有一条安全约束不能破：**复合请求必须保留完整工具能力**。
 * 凡是句子里出现「加进行程 / 怎么过去 / 再帮我」这类跟进意图，一律退回 general。
 * 收窄工具是为了省上下文，不是为了拦住用户真正要做的事 ——
 * 把「附近好拍吗，顺便加进行程」判成纯附近查询，模型就拿不到 generatePlans，
 * 用户的话只被执行一半。
 */
const FOLLOW_UP = /顺便|然后|再帮|并且|同时|加进|加入|排进|安排进|怎么过去|怎么走|比较|订|换|改|重新/

/** 把一句话切成子句；中英文标点都认 */
const clausesOf = (text: string): string[] =>
  text
    .split(/[，,。！？!?；;]/)
    .map((s) => s.trim())
    .filter(Boolean)

/**
 * 「我有 N 小时 / 下午有空」这类**时间约束**。
 *
 * 这类句子常带「附近」，但主意图不是查附近，而是**排接下来这段时间**：
 * 「我在北京前门附近，下午还有四个小时，帮我安排下」要的是轻量规划（hours=4），
 * 不是一份附近候选清单。判成 nearby 会让模型拿不到 updateDemand，
 * hours 槽位永远填不进去，引擎只能去排整天 —— 实测就是这么漏的。
 *
 * 所以时间约束要**先于**附近判断，且只在能判出时长/时段时才成立。
 */
const TIME_BUDGET =
  /(还有|剩下|有|只有|抽|腾出)\s*(?:个)?\s*[一二两三四五六七八九十半个\d.]+\s*(?:个)?\s*(?:小时|钟头)|下午|上午|半天|这半天|接下来/

/** 单个子句看起来像不像「附近探索」；只看这一句，不跨子句拼 */
const NEARBY_CLAUSE =
  /(附近|周边|周围|这附近).{0,12}(有什么|有啥|哪里|哪儿|好拍|好吃|好玩|逛|看看|推荐)|(有什么|有啥|哪里|哪儿).{0,8}(好拍|好吃|好玩|值得去|可以逛)|我(?:就)?在.{0,10}(附近|这边|这儿)/

/**
 * 单个子句看起来像不像「从零规划」。
 *
 * 两类都要认：
 * - 带规划动词的：「帮我规划北京一日游」「给我安排个行程」
 * - 只给了行程规格的：「北京一天」「成都五天」—— 中文里这两个字就足以表达
 *   「帮我排这几天」，用户没必要说「帮我规划」。只认动词会让这类最常见、
 *   最简短的说法退回 general，于是模型拿不到 plan 提示词，反复追问人数预算。
 *
 * 第二条要求「城市/地名 + 数字 + 天」（或「N 日游」），避免把
 * 「今天天气」这类无关句子误判进来。
 */
const PLAN_CLAUSE =
  /(规划|安排|排|做|定).{0,10}(日游|行程|旅行|玩几天|天的)|[一-龥]{2,6}\s*[一二两三四五六七八九十\d]\s*天|[一二两三四五六七八九十\d]\s*日游/

function selectTask(text: string, hasTrip: boolean): ChatTask {
  const request = text.trim()
  if (!request) return 'general'

  const clauses = clausesOf(request)
  // 复合请求：任何一个子句带跟进意图，就退回 general。
  // 这是安全闸，写在意图判断之前 —— 宁可多开工具，也不让一句话被只执行一半
  if (clauses.length > 1 && FOLLOW_UP.test(request)) return 'general'

  // 时间约束优先：用户说了「还有四小时」「下午有空」，他要的是把这段时间排出来，
  // 而不是一份附近清单。这条必须先于 nearby，否则「前门附近+四小时」会被判成查附近
  if (TIME_BUDGET.test(request)) {
    // 只有「想吃什么/逛什么」这类明确的索取才回 nearby；
    // 说了「帮我安排」就按规划处理（轻量规划有默认天数，不必反问）
    const wantsPlan = /安排|排|规划|怎么玩|做什么|干点啥|打发/.test(request)
    if (wantsPlan || hasTrip) return 'plan'
    return 'nearby'
  }

  const head = clauses[0] ?? request

  // 「附近」优先于「规划」：用户先问附近的场景里常带「安排」二字，
  // 但主意图仍是查附近，判成规划会让他莫名其妙拿到一份行程
  if (NEARBY_CLAUSE.test(head)) return 'nearby'

  // 已有行程时说「重新排」属于修订，不当作从零规划
  if (!hasTrip && PLAN_CLAUSE.test(head) && !FOLLOW_UP.test(request)) return 'plan'

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
    // 版本按块拼：base 与任务各自带号，只改一处时能精确对上历史数据
    version: composePromptVersion({ base: PROMPT_VERSIONS.base, ...(task === 'general' ? {} : { [task]: PROMPT_VERSIONS[task] }) })
  }
}
