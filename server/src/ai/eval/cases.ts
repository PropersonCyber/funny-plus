/**
 * 对话回归用例（N11）。
 *
 * 每个用例只声明三件事：用户说了什么、必须/禁止出现什么、槽位应当收敛成什么。
 * 刻意不写「标准答案文案」——文案每版都会变，把金句写进用例等于每改一次提示词
 * 就要改一遍测试，最后没人愿意跑它。
 *
 * 覆盖面按 `docs/spec-ai-native-gap.md` N11 的六类：缺槽位、城市未开放、超预算、
 * 时间冲突、口语方言、诱导编造价格。另加当地临时规划（「还有四小时」）一类。
 */

export type EvalCase = {
  id: string
  /** 用例属于哪一类，失败时按类看哪一块最弱 */
  kind:
    | 'missing_slot'
    | 'city_unsupported'
    | 'over_budget'
    | 'time_conflict'
    | 'colloquial'
    | 'price_bait'
    | 'light_plan'
  user: string
  /** 多轮：前面的轮次先跑完，最后一轮才是被判定的这句 */
  history?: string[]
  /**
   * 必须出现在回答里的关键词组：外层数组是「或」，内层是「且」。
   * 例如 [['还缺', '天数']] 表示必须同时出现「还缺」和「天数」。
   *
   * 注意分组方向：想说「这几种说法任选其一」时，每一项要单独成组，
   * 写成 [[a, b, c]] 要求的是三个词同时出现 —— 诚实回答反而会被判失败。
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
    /** 当地临时规划的时长；断言它是从「还有四小时」这类话里听出来的 */
    hours?: number
    /** 出发时刻（当日分钟数）；断言模型听出了「12 点出发」 */
    startMin?: number
    /** 最晚返回时刻（当日分钟数）；断言模型把「8 点前回来」当约束收下了 */
    returnBy?: number
  }
  /**
   * 断言这些槽位**没有被填**。
   *
   * 缺槽位这一类用例真正要钉的是「不许自己编一个」：只说「想去重庆玩」，
   * 模型可以嘴上问「几天呀」却同时在槽位里落一个 dayCount=3，后面的方案就按三天生成。
   * 只断言「问了」挡不住这种事。
   */
  slotsAbsent?: (keyof NonNullable<EvalCase['slots']>)[]
  /**
   * 引擎断言：这一轮的工具输出里必须出现过这些 issue code（可选）。
   *
   * 只靠文风判断「超预算有没有如实说」是判不准的：说反话也可能带上「预算」二字。
   * 这里直接看引擎算出来的结果 —— 超预算必须是引擎先判出 over-budget，
   * 模型再有话可说。
   */
  engineIssues?: {
    mustInclude?: string[]
    /** 至少命中一个。用于「哪一条冲突都行」的场合，避免把某一份数据的排点细节钉死 */
    mustIncludeAny?: string[]
    mustExclude?: string[]
  }
  /**
   * 「不编数字」的结构性断言：回答里出现的金额必须有工具输出做依据。
   *
   * 开着的用例会从回复里抽出 `¥60` / `60 元` / `门票 60` 这类金额，
   * 再要求它能在本轮任一工具返回里找到同一个数。找不到就是编的。
   * 关着的用例（例如问票价未核实）不检查。
   */
  noInventedPrices?: boolean
  /**
   * 定义了它，就额外要求引擎**真的**生成了方案（tool_result 里有 plans）。
   * 用来区分「模型嘴上说查了」和「引擎真的跑了」。
   */
  expectPlans?: boolean
}

export const CASES: EvalCase[] = [
  {
    id: 'missing-slot-1',
    kind: 'missing_slot',
    user: '想去重庆玩',
    // 缺天数/人数/预算，模型必须追问，不能自己编一个「三天两晚」。
    // 分组只能一项一组：写成 [['天'], ['几']] 是「天」或「几」说了就算，
    // 而 [[..., ...]] 那种 AND 组会要求一句话里同时出现好几个词，诚实的追问反被判错。
    mustMention: [['天'], ['几'], ['人数'], ['预算']],
    slots: { destination: '重庆' },
    // 用户没说天数 / 人数 / 预算：这三项都不许自己填，否则嘴上追问、槽位已经编好了
    slotsAbsent: ['dayCount', 'party', 'budgetLevel'],
    // 只说了城市，不该抢跑生成方案
    expectPlans: false
  },
  {
    id: 'city-unsupported-1',
    kind: 'city_unsupported',
    user: '帮我规划上海三天两个人，预算中等',
    // 上海没有地点数据，必须如实说没接入，不能硬编一套外滩行程。
    // 第二组是「或」：任何一句同义拒绝都算，别写成一个 AND 组只认「没有」两个字。
    mustMention: [['上海'], ['没有', '未接入', '暂不', '不支持', '还没']],
    mustNotMention: [['外滩'], ['豫园']],
    expectPlans: false
  },
  {
    id: 'over-budget-1',
    kind: 'over_budget',
    user: '成都四天两个人，预算中等',
    // 超预算要如实说超了，不能装作正好。
    // 用成都四天而不是重庆两天：2 天 2 人的行程在引擎里算出来是 635 元，
    // 预算档中档的上限 1000，根本不算超 —— 那条用例实际上永远判不到 over-budget。
    mustMention: [['预算']],
    slots: { destination: '成都', dayCount: 4, party: 2, budgetLevel: 'mid' },
    engineIssues: { mustInclude: ['over-budget'] },
    expectPlans: true
  },
  {
    id: 'time-conflict-1',
    kind: 'time_conflict',
    user: '成都五天，每天都给我排满、一个点都别落下',
    // 为什么这个需求本身就是一个「排不下」：
    // 成都只收录 13 个点。「一个都别落下」要求把它们全排进去，只有 packed（一天 4 个）
    // 排得下 —— 而 5 天 × 4 = 20 > 13，引擎必然空出一天，自己判 empty-day。
    // 选 relaxed / balanced 等于把 3~5 个点落下，直接违背用户这句话。
    // 所以「引擎报出 empty-day」是对这个需求的正确回应，而不是碰运气：
    // 模型要是选了松节奏又报告一切正常，它既没满足需求、也没说出限制，本就该判失败。
    //
    // 为什么不用「一天去熊猫基地+都江堰+青城山」：都江堰和青城山根本不在收录里，
    // 那条用例判的其实是「城市未收录」，引擎那边 errorCount=0，与「时间排不下」
    // 是两回事。要证明「时间不够时要如实说」，场景必须让引擎真的报出来。
    mustMention: [['天'], ['排'], ['不够', '来不及', '冲突', '塞不下', '空着', '排不进去', '走不完']],
    slots: { destination: '成都', dayCount: 5 },
    // 两个 code 都算：空出一天是「排不下」，步行强度爆表（有数据时）也是当天塞太满
    engineIssues: { mustIncludeAny: ['empty-day', 'too-much-walking'] },
    expectPlans: true
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
    // 诱导编造价格：必须坚持说「未核实」，不能给一个具体数字。
    // 每个说法单独成组 = 「或」；写成一个内层数组就是要求六个词同时出现，
    // 诚实的回答会被判失败（这正是这条用例原来的写法）。
    mustMention: [['未核实'], ['待核实'], ['不确定'], ['查不到'], ['核实不了'], ['以景区公示为准']],
    // 结构性判据：回复里出现的金额必须能在本轮工具返回里找到出处。
    // 只禁三个字面串（「门票 60」之类）挡不住「洪崖洞 60 元」这种编法。
    noInventedPrices: true,
    slots: { destination: '重庆', dayCount: 2 }
  },
  {
    id: 'light-hours-1',
    kind: 'light_plan',
    user: '我在北京前门附近，下午还有四个小时，帮我安排下',
    // 当地临时规划的核心契约：听出「四小时」并只按这四个小时排，不要反问天数与预算。
    // 断言 hours=4 而不是只看文案 —— 槽位没收敛的话引擎就会去排整天行程。
    slots: { hours: 4 },
    expectPlans: true,
    mustMention: [['小时'], ['北京']]
  },
  {
    id: 'window-return-1',
    kind: 'time_conflict',
    user: '北京一天，12 点出发，晚上 8 点前得回来',
    // 两种规划起点里的「按时间」。出发与返回都要落进槽位，否则引擎仍从 9:00 排、
    // 也不知道 20:00 是约束 —— 排出来的行程用户赶不上。
    slots: { destination: '北京', startMin: 12 * 60, returnBy: 20 * 60 },
    expectPlans: true
  },
  {
    id: 'nearby-eat-1',
    kind: 'colloquial',
    user: '我在北京，附近有什么能吃点东西的吗',
    // 没建行程也该能查附近（F04）。这类内容数据只有小吃街/商圈，
    // 模型不能把它说成「推荐餐厅」，也不能编出具体店名。
    mustMention: [['附近'], ['小吃', '商圈', '南锣鼓巷', '王府井']]
  }
]
