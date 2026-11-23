import type { Demand } from '@/types/index.ts'
import { isLight } from '@/engine/lightPlan.ts'

/**
 * 对话槽位：模型逐轮往里补，没提到的键就不存在。
 *
 * 与路由分开是因为这里全是纯函数：`routes/ai.ts` 一被 import 就要连库，
 * 「轻量规划只需要目的地和时长」这类判定应该能单独测，不该被数据库拖住。
 */
export type Slots = Partial<Demand>

/** 整趟规划所需的最小槽位；不齐就不允许调 generatePlans */
const REQUIRED = ['destination', 'dayCount', 'party', 'budgetLevel'] as const
type RequiredKey = (typeof REQUIRED)[number]

const LABEL: Record<RequiredKey, string> = {
  destination: '目的地',
  dayCount: '天数',
  party: '人数',
  budgetLevel: '预算'
}

/**
 * 还缺哪些槽位。
 *
 * 轻量规划只排接下来几个小时，天数/人数/预算都有默认值 —— 这时还要求四项齐全，
 * 用户说「我在前门，还有四小时」会被追问一堆与这句话无关的问题。
 */
export function missingOf(s: Slots): string[] {
  const need: readonly RequiredKey[] = isLight(s) ? ['destination'] : REQUIRED
  return need.filter((k) => s[k] === undefined || s[k] === null).map((k) => LABEL[k])
}

/**
 * 槽位 → Demand。
 *
 * 不能直接 `slots as Demand`：Demand 的 preferences 等字段是非可选的，
 * 模型没提到偏好时槽位里就没有这个键，引擎里 `demand.preferences.flatMap` 会直接崩。
 * 类型断言在这里只能骗过编译器，骗不过运行时。
 */
export function toDemand(s: Slots): Demand {
  return {
    destination: s.destination ?? '',
    dayCount: s.dayCount ?? 1,
    // 日期允许未知：没填就是 undefined，不能拿今天充数 —— 一充数，
    // 行程页就会出现一个用户从没定过的出行日，闭馆判断也会按错误的日子跑
    ...(s.dateFrom ? { dateFrom: s.dateFrom } : {}),
    // hours 与 startMin 要一起带过去：漏掉的话「接下来 4 小时」会被当成整天行程，
    // 表单选过的时长在服务端这条路上就白选了
    ...(s.hours ? { hours: s.hours } : {}),
    ...(s.startMin !== undefined ? { startMin: s.startMin } : {}),
    ...(s.returnBy !== undefined ? { returnBy: s.returnBy } : {}),
    ...(s.mustVisit?.length ? { mustVisit: s.mustVisit } : {}),
    ...(s.origin ? { origin: s.origin } : {}),
    party: s.party ?? 1,
    budgetLevel: s.budgetLevel ?? 'flexible',
    preferences: s.preferences ?? [],
    transport: s.transport ?? 'public',
    notes: s.notes ?? ''
  }
}

/**
 * 把工具收到的补丁写进槽位。
 *
 * `hours: null` 是唯一一个「清空」语义：用户从「接下来四小时」改口成按天数规划时，
 * 留着 hours 会让后续每次生成都还是轻量规划，天数怎么改都不生效。
 */
export function applyPatch(slots: Slots, patch: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) {
      if (k === 'hours') delete slots.hours
      continue
    }
    if (v !== undefined) (slots as Record<string, unknown>)[k] = v
  }
}
