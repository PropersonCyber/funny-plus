import type { BudgetBreakdown, BudgetItem, Demand, TripDay } from '@/types'

// PRD 4.4：人均成本按实际人数算，住宿按房间、门票按人群与票种、交通按车辆或票价；
// 不把数字交给模型猜。所有常数集中在这里，方便接真实价格时一处替换。
const UNIT = {
  hotelPerRoom: 350,
  publicPerPersonDay: 60,
  carPerDay: 400,
  charterPerDay: 900,
  mealPerPersonDay: 120,
  otherPerPersonDay: 50
}

export const budgetLevelCap = (level: Demand['budgetLevel']): number | undefined =>
  level === 'low' ? 500 : level === 'mid' ? 1000 : level === 'high' ? 2000 : undefined

export function estimateBudget(demand: Demand, days: TripDay[]): BudgetBreakdown {
  const { party, dayCount, transport } = demand
  const nights = Math.max(0, dayCount - 1)
  const rooms = Math.ceil(party / 2)

  // compare 只是需求侧的「待比较」，生成和修改都会先落到具体交通方式；万一漏传，这里不能静默当公交算
  const transportAmount =
    transport === 'charter'
      ? UNIT.charterPerDay * dayCount
      : transport === 'car'
        ? UNIT.carPerDay * dayCount
        : UNIT.publicPerPersonDay * dayCount * party

  // 票价未核实（cost === null）按 0 参与求和，但要在 uncertain 里单独说明，不能静默当免费
  const ticketTotal = days.reduce(
    (sum, d) => sum + d.items.filter((i) => i.kind === 'place').reduce((s, i) => s + (i.cost ?? 0), 0),
    0
  )
  const unknownTicket = days.reduce(
    (n, d) => n + d.items.filter((i) => i.kind === 'place' && i.cost === null).length,
    0
  )

  const items: BudgetItem[] = [
    {
      category: 'transport',
      amount: Math.round(transportAmount),
      basis:
        transport === 'charter'
          ? `包车 ${UNIT.charterPerDay} 元/天 × ${dayCount} 天（含司机，不含大交通）`
          : transport === 'car'
            ? `自驾 ${UNIT.carPerDay} 元/天（油费+停车估） × ${dayCount} 天`
            : `公共交通 ${UNIT.publicPerPersonDay} 元/人/天 × ${party} 人 × ${dayCount} 天`,
      // 这三档都是产品侧定的单价，不是询价结果
      evidence: 'estimate'
    },
    {
      category: 'lodging',
      amount: Math.round(rooms * nights * UNIT.hotelPerRoom),
      basis: `按 2 人 1 间估 ${rooms} 间 × ${nights} 晚 × ${UNIT.hotelPerRoom} 元`,
      evidence: 'estimate'
    },
    {
      category: 'tickets',
      amount: Math.round(ticketTotal * party),
      // 全部票价未知时不能说「按公示价算的」：那时总额其实是 0，口径必须降级成估算
      basis:
        ticketTotal === 0 && unknownTicket > 0
          ? `门票全部未核实，暂按 0 元计入（${unknownTicket} 个景点待核价）`
          : `景点门票合计 ${ticketTotal} 元/人 × ${party} 人（未含儿童/学生票差异）`,
      // price 的含义是「有门票公示价可依」；一个票价都没核实时只能是估算
      evidence: ticketTotal > 0 ? 'price' : 'estimate'
    },
    {
      category: 'food',
      amount: Math.round(UNIT.mealPerPersonDay * dayCount * party),
      basis: `餐饮 ${UNIT.mealPerPersonDay} 元/人/天 × ${party} 人 × ${dayCount} 天`,
      evidence: 'estimate'
    },
    {
      category: 'other',
      amount: Math.round(UNIT.otherPerPersonDay * dayCount * party),
      basis: `摆渡车、讲解、零花等 ${UNIT.otherPerPersonDay} 元/人/天`,
      evidence: 'estimate'
    }
  ]

  const total = items.reduce((s, i) => s + i.amount, 0)
  const uncertain: string[] = []
  if (nights > 0) uncertain.push('住宿价格未按实际日期询价，旺季可能上浮')
  // 只看 place 类条目：餐费条目也带 cost（60 元），混进来会让这条提示永远成立
  if (days.some((d) => d.items.some((i) => i.kind === 'place' && (i.cost ?? 0) > 0)))
    uncertain.push('门票为公示价，优惠政策需实名核验')
  // 票价拿不到的景点必须先说清楚，否则总额看着完整、实际少算了几个景点
  if (unknownTicket > 0) uncertain.push(`有 ${unknownTicket} 个景点票价未核实，未计入总额`)
  if (transport === 'car') uncertain.push('自驾未计入高速通行费')
  if (transport === 'compare') uncertain.push('交通方式尚未选定，波动最大')

  return { items, total, perPerson: Math.round(total / party), uncertain }
}
