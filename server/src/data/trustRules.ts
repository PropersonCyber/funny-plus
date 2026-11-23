import type { TrustLevel } from '@/types/index.ts'

/**
 * 反馈与有效期如何影响「可信度」（C1 / C3）。
 *
 * 阈值全部集中在这里：它们是产品口径，不是实现细节。改口径只改这一个文件，
 * 不允许在路由里散落魔法数字。
 *
 * 为什么定得保守：`official` 这个档位只在「官方核验过」时出现，一旦被几条随手点的
 * 反馈拉下来，它就再也不代表任何东西了。所以要求「足够多的人 + 明确的多数」才动。
 */

/** 降档所需的最少反馈票数（不同 clientId / userId 各算一票） */
export const DEMOTE_MIN_VOTES = 3

/** 负面占比达到多少才降档：只要还有相当比例的人说是适用的，就不该被少数人拉下来 */
export const DEMOTE_RATIO = 0.6

/**
 * 降档顺序：每次只往下一级。
 *
 * 不跳档的理由：从「官方已核验」直接掉到「尚待核实」，用户无法判断到底有多不可信；
 * 而多条规则同时命中时连降两级，等于把两条独立的怀疑叠成一个更严重的结论。
 */
export const downgrade = (t: TrustLevel): TrustLevel => {
  if (t === 'official') return 'credible'
  if (t === 'credible') return 'experience'
  return 'pending'
}

/** 可信度高低：数字越大越不可信。只用于比较，不参与展示 */
const RANK: Record<TrustLevel, number> = { official: 0, credible: 1, experience: 2, pending: 3 }

/**
 * 把可信度压到不高可信于 `ceiling`。只降不升。
 *
 * 用在「用户补录被写进线上表」这一刻（C2）：`trust` 是**行级**的，
 * 一行里只要有一个字段来自用户填报，整行就不再满足「每个字段都核验过」，
 * 于是它不该再声称比用户经验更可信。压到 `experience` 同时关掉了 canJudgeHard ——
 * 用户填的末班班次绝不能拿去判硬冲突，那等于让填报数据替用户做决定。
 *
 * 本来就是 pending 的行保持 pending：这里只设上限，不会把更不可信的行往上抬。
 */
export const capTrust = (t: TrustLevel, ceiling: TrustLevel): TrustLevel =>
  RANK[t] >= RANK[ceiling] ? t : ceiling

export type FeedbackStat = { met: number; notApplicable: number }

export type TrustVerdict = { trust: TrustLevel; note?: string }

const todayISO = (): string => new Date().toISOString().slice(0, 10)

/**
 * 算出一条避坑信息当下应当显示的可信度。
 *
 * 两条触发条件（C3 过期、C1 反馈）只降一档，原因全部拼进 note ——
 * 悄悄把「官方已核验」改成「可靠来源」而不说明为什么，用户会以为是数据坏了。
 */
export function resolveTrust(
  fact: { trust: TrustLevel; validUntil?: string },
  stat: FeedbackStat | undefined,
  today = todayISO()
): TrustVerdict {
  const reasons: string[] = []

  // C3：过了有效期就不能再声称已核验。界面已经会把过期条目折叠（splitByFreshness），
  // 这里管的是「用户点开还看得见的那条」——它同样不该顶着旧核验日期说话。
  if (fact.validUntil && fact.validUntil < today) reasons.push('已过有效期')

  const total = (stat?.met ?? 0) + (stat?.notApplicable ?? 0)
  const bad = stat?.notApplicable ?? 0
  // C1：票数不够时一律不动。两条反馈说不对就降官方的档，等于让噪音改数据。
  if (total >= DEMOTE_MIN_VOTES && bad / total >= DEMOTE_RATIO) {
    reasons.push(`${total} 条反馈里 ${bad} 条说不适用`)
  }

  if (!reasons.length) return { trust: fact.trust }
  return { trust: downgrade(fact.trust), note: reasons.join('；') }
}

/**
 * 补录生效（C2）的门槛：多少个**独立设备**提交同一个值才写进线上数据。
 *
 * 定 2 而不是 1：单条补录就是一个人说的，直接写进线上表等于把用户填报当官方数据 ——
 * 而 schema 里那条注释写得很清楚，补录只能进池子，不能升档成 official。
 * 这里只做「填上缺失的值」，trust 一个字都不动，所以行程里它最多提示、不会拦人。
 */
export const SUBMIT_CONFIRM_VOTES = 2

/**
 * 匿名设备票是否算「独立一票」。
 *
 * `clientId` 是客户端自己生成、自己上报的：同一个人换个字符串就能投两票，
 * 所以「两个 clientId 一致」根本不证明「两个人一致」。策划球（C2）要的是
 * 「多个人独立说了同一件事」，而匿名侧没有任何身份可以作证。
 *
 * 因此默认**不认匿名票**：补录只在「登录账号」这一侧攒票，账号身份由 token 绑定、
 * 服务端持有，伪造不了。代价是匿名用户填了不生效 —— 但匿名本来就没有账号可归属，
 * 那些行登录时会被 claimAnonData 认领给账号，下次评价时就算数了。
 *
 * 需要回退旧行为时把环境变量设成 `true`（例如线下多人共用一个演示环境），
 * 但生产环境不要开：开了就等于把「两个人一致」降级成「同一个人敲了两次」。
 */
export const anonymousVotesCount = (): boolean => process.env.SUBMIT_TRUST_ANON_VOTES === 'true'

/**
 * 一个值是否达到「独立来源一致」。
 *
 * 默认只数**登录账号**：`clientId` 是客户端自报的，同一个人换个字符串就是「另一台设备」，
 * 拿它凑门槛等于允许任何人自己给自己背书。账号由 token 绑定、服务端持有，伪造不了，
 * 所以「两个不同账号说了同一件事」才是 C2 想要的那个证据。
 *
 * 匿名票在默认口径下**完全不参与**，不是「权重低」而是「不算」—— 权重低仍然可伪造，
 * 只是把攻击成本提高一点点，却让规则看起来比实际严格。
 *
 * `SUBMIT_TRUST_ANON_VOTES=true` 会把匿名设备票也计入（供线下演示环境）。
 * 打开它就意味着允许单人自证，生产环境不该开。
 */
export function isAgreed(voters: { userIds: Set<string>; clientIds: Set<string> }): boolean {
  if (anonymousVotesCount()) return voters.userIds.size + voters.clientIds.size >= SUBMIT_CONFIRM_VOTES
  return voters.userIds.size >= SUBMIT_CONFIRM_VOTES
}

/** 允许自动生效的字段白名单：只补班次与营业时间这类事实性字段，且只在原值为空时填 */
export const SUBMIT_PROMOTABLE = {
  line: ['firstBus', 'lastBus', 'intervalMin'],
  place: ['openText']
} as const

/**
 * 补录生效后，这一行的可信度上限。
 *
 * `experience` = schema 里的「用户填报 · 未核验」档。写死在这里而不是让调用方传，
 * 是为了让「补录生效 ≠ 数据升档」这条规则只有一处定义 —— 之前 servert 的注释说
 * 「不动 trust」，但不动 trust 恰恰意味着官方行会带着官方身份吸收用户填报。
 */
export const SUBMIT_TRUST_CEILING: TrustLevel = 'experience'

/** `17:00` → 1020；格式不对返回 NaN，交给调用方判 */
const clockToMinutes = (text: string): number => {
  const m = text.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return NaN
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 24 || min > 59) return NaN
  return Math.min(h * 60 + min, 24 * 60)
}

/**
 * 补录值 → 落库值（唯一的口径）。
 * 两个字段类型不同，落库形态也不同：
 * - 班次三件是**当日分钟数**（int 列），`17:00` 与 `1020` 是同一个值的两种写法；
 * - 营业时间是**原始文本**，原样存。
 *
 * 为什么必须在这里归一：vote 是按 `value` 原字符串分组的，不归一时
 * 「17:00」与「1020」各算一票、永远凑不齐 2 个设备；而归一前的 `Number('17:00')`
 * 是 NaN —— 提交时没挡（校验走的是 parseClock 分支），真正写库时才炸。
 * 这就是 C2 上线后一直静默不生效的原因。
 */
export type Promotion = { kind: 'minutes'; value: number; label: string } | { kind: 'text'; label: string }

export function normalizeSubmitValue(field: string, value: string): Promotion | null {
  const text = value.trim()
  if (!text) return null
  if (field === 'firstBus' || field === 'lastBus') {
    const minutes = text.includes(':') ? clockToMinutes(text) : Number(text)
    // 超过 24:00 的值不接受：那既不是一个合法时刻，也无法与另一台设备的写法对齐
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 24 * 60) return null
    return { kind: 'minutes', value: minutes, label: String(minutes) }
  }
  if (field === 'intervalMin') {
    const minutes = Number(text)
    // 间隔 0 没有意义（相邻两班同一时刻），负数更不是时刻；
    // 上限一天：1512 这种值在 int 列里存得下，但它描述的是「25 小时一班」，
    // 一旦写进线上表就会让「等几班车」的推算全部失真，所以在入口挡掉
    if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 24 * 60) return null
    return { kind: 'minutes', value: minutes, label: String(minutes) }
  }
  return { kind: 'text', label: text }
}
