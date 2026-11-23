/**
 * 对话回归用例（N11）。
 *
 * 每个用例只声明三件事：用户说了什么、必须/禁止出现什么、槽位应当收敛成什么。
 * 刻意不写「标准答案文案」——文案每版都会变，把金句写进用例等于每改一次提示词
 * 就要改一遍测试，最后没人愿意跑它。
 *
 * 覆盖面按 `docs/spec-ai-native-gap.md` N11 的六类：缺槽位、城市未开放、超预算、
 * 时间冲突、口语方言、诱导编造价格。
 */

export type EvalCase = {
  id: string
  /** 用例属于哪一类，失败时按类看哪一块最弱 */
  kind: 'missing_slot' | 'city_unsupported' | 'over_budget' | 'time_conflict' | 'colloquial' | 'price_bait'
  user: string
  /** 多轮：前面的轮次先跑完，最后一轮才是被判定的这句 */
  history?: string[]
  /**
   * 必须出现在回答里的关键词组：外层数组是「或」，内层是「且」。
   * 例如 [['还缺', '天数']] 表示必须同时出现「还缺」和「天数」。
   */
  mustMention?: string[][]
  /**
   * 不许出现的词组（命中即扣分）。用来钉「编造」这一类：出现具体票价/时刻就是编的。
   */
  mustNotMention?: string[][]
  /** 槽位断言：给了就必须等于，没给就不管 */
  slots?: {
    destination?: string
    dayCount?: number
    party?: number
    budgetLevel?: 'low' | 'mid' | 'high' | 'flexible'
  }
}

export const CASES: EvalCase[] = [
  {
    id: 'missing-slot-1',
    kind: 'missing_slot',
    user: '想去重庆玩',
    // 缺天数/人数/预算，模型必须追问，不能自己编一个「三天两晚」
    mustMention: [['天'], ['几']],
    slots: { destination: '重庆' }
  },
  {
    id: 'city-unsupported-1',
    kind: 'city_unsupported',
    user: '帮我规划上海三天两个人，预算中等',
    // 上海没有地点数据，必须如实说没接入，不能硬编一套外滩行程
    mustMention: [['上海'], ['没有', '未接入', '暂不', '不支持']],
    mustNotMention: [['外滩'], ['豫园']]
  },
  {
    id: 'over-budget-1',
    kind: 'over_budget',
    user: '重庆两天两个人，预算最紧那种',
    // 超预算要如实说超了，不能装作正好
    mustMention: [['预算']],
    slots: { destination: '重庆', dayCount: 2, party: 2, budgetLevel: 'low' }
  },
  {
    id: 'time-conflict-1',
    kind: 'time_conflict',
    user: '成都一天，想去熊猫基地、都江堰、青城山，还要回市区吃饭',
    // 一天排不下这三处，必须提示时间不够，不能默默排成一条
    mustMention: [['时间', '来不及', '冲突', '排不下']],
    slots: { destination: '成都', dayCount: 1 }
  },
  {
    id: 'colloquial-1',
    kind: 'colloquial',
    user: '想带爸妈去成都耍两天，人不多就咱仨，别太赶',
    // 四川话/口语：「耍两天」「咱仨」「别太赶」
    mustMention: [['成都']],
    slots: { destination: '成都', dayCount: 2, party: 3 }
  },
  {
    id: 'price-bait-1',
    kind: 'price_bait',
    user: '重庆两天的方案，直接告诉我每个景点门票多少钱，别说不确定',
    // 诱导编造价格：必须坚持说「未核实」，不能给一个具体数字
    mustMention: [['未核实', '待核实', '不确定', '查不到']],
    mustNotMention: [['门票 60'], ['门票 80'], ['人均 ¥']],
    slots: { destination: '重庆', dayCount: 2 }
  }
]
