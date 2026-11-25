import type { FieldEvidence, Place, TrustLevel } from '@/types'

/**
 * 字段级依据的读取与过期判定。
 *
 * 与行级 `trust` 的关系：行级档位说「这条信息整体多可信」，字段级依据说
 * 「这一格怎么来的」。两者会不一致 —— 一条 `credible` 地点的票价可能压根没核过。
 * 所以这里的函数只回答字段级的那一半，不回头去改 `trust`。
 */

const todayISO = (): string => new Date().toISOString().slice(0, 10)

/**
 * 取某字段的依据。
 *
 * 同一字段可能有多条（重新核验过），取 `verifiedAt` 最新的那条：
 * 旧记录是审计用的，不该拿来支撑当前的展示。
 *
 * **次序不能依赖数组顺序** —— 那个顺序取决于数据库返回，而升级、迁移、
 * 相同时间戳的记录都会让顺序变。所以：先比核验时刻，完全相同时再比 `id`。
 * 同毫秒的两条谁算「新」本身没有正确答案，但必须**每次答同一个**。
 */
export function evidenceFor(list: FieldEvidence[] | undefined, field: string): FieldEvidence | undefined {
  let best: FieldEvidence | undefined
  for (const e of list ?? []) {
    if (e.field !== field) continue
    if (!best || e.verifiedAt > best.verifiedAt || (e.verifiedAt === best.verifiedAt && e.id > best.id)) best = e
  }
  return best
}

/**
 * 依据是否已过有效期。
 *
 * **没有 `validUntil` 一律按「未知」处理，不判过期、也不当成永久有效**：
 * 营业时间这类事实本身会变，把「没设有效期」读成「永远有效」，
 * 等于替运营承诺了一件没人承诺过的事。
 */
export const isEvidenceExpired = (e: Pick<FieldEvidence, 'validUntil'>, today = todayISO()): boolean =>
  !!e.validUntil && e.validUntil < today

/**
 * 某个字段当下算不算「有可用的核验依据」。
 *
 * **只看字段名和有效期是不够的**：依据存的是「核验时那个值」，而该字段之后可能被改过。
 * 依据说末班 17:00、线路现在是 18:00 时，这条依据什么也没证明，却能把 18:00 当成已核验。
 * 所以必须拿**当前实际用于计算的值**去比。
 *
 * `expected` 就是那个值：时刻传分钟数（如 1020），文本传原文（如 `openText`）。
 * 传 `null` / `undefined` = 这一格本来就没值（如 `openText` 为空），**无基准可比 → 不算核验过**。
 *
 * 返回细分的状态而不是布尔：`stale` 与 `mismatch` 要告诉运营去补不同东西（见 §4.5）。
 */
export type FieldVerdict =
  | 'ok' // 可参与硬约束
  | 'missing' // 这一格没有依据（可能只有别的字段有）
  | 'expired' // 依据在，但过了有效期
  | 'mismatch' // 依据在，但值已不是当前用的那个
  | 'noBaseline' // 依据在，但当前没有可比对的原值
  | 'untrustedRow' // 行级档位就不够，字段依据再新也不配拦人

export function judgeField(
  list: FieldEvidence[] | undefined,
  field: string,
  expected: FieldExpected,
  rowTrust: TrustLevel,
  today = todayISO()
): FieldVerdict {
  // 行级档位是必要条件：非官方数据哪怕附了一条很新的依据，也不能兜底成官方
  if (rowTrust !== 'official') return 'untrustedRow'
  // 老数据压根没有任何字段依据：退回行级，不许因为新表是空的就集体降级
  if (!list?.length) return 'ok'
  const e = evidenceFor(list, field)
  if (!e) return 'missing'
  if (isEvidenceExpired(e, today)) return 'expired'
  if (expected === null || expected === undefined || expected === '') return 'noBaseline'
  return sameFieldValue(expected, e.value) ? 'ok' : 'mismatch'
}

/**
 * 当前值。形态取于字段本身：时刻是分钟数，文本是原文，**开放时段是分钟对**。
 *
 * 时段用分钟对而不是 float 原文：判行程用的是 `openingForDay` 算出来的那个窗口，
 * 而原文只是它的来源。拿原文当基准，就变成「核过一句话，却用另一份数字拦人」。
 */
export type FieldExpected = string | number | [number, number] | null | undefined

/**
 * 解析 `17:00` 这类时刻。
 *
 * 没复用 `validate.ts` 的 `fmt` 反向版：那个方向反过来写就是改一个正在被 20 多个
 * 断言钉着的模块，为了三行解析不值得。`fieldEvidence` 自己解析也避免
 * `validate ↔ fieldEvidence` 循环引用。
 */
const clockMinutes = (text: string): number | null => {
  const m = /^(\d{1,2})\s*[:：]\s*(\d{2})$/.exec(text.trim())
  if (!m) return null
  const min = Number(m[1]) * 60 + Number(m[2])
  return min >= 0 && min <= 24 * 60 ? min : null
}

/** 文本比较前把空白拉平：多一个空格不代表数据变了 */
const squeeze = (v: string): string => v.trim().replace(/\s+/g, ' ')

/** 把 `09:00-17:00` 和 `540-1020` 两种写法都拉平成分钟对 */
export const parseWindow = (text: string): [number, number] | null => {
  const clock = /^(\d{1,2})\s*[:：]\s*(\d{2})\s*[-~—]\s*(\d{1,2})\s*[:：]\s*(\d{2})$/.exec(text.trim())
  if (clock) {
    return [Number(clock[1]) * 60 + Number(clock[2]), Number(clock[3]) * 60 + Number(clock[4])]
  }
  const raw = /^(\d{1,4})\s*[-~]\s*(\d{1,4})$/.exec(text.trim())
  return raw ? [Number(raw[1]), Number(raw[2])] : null
}

/**
 * 依据里的值与当前实际值是不是同一个。
 *
 * 时刻字段兼容两种写法：`1020` 和 `17:00` —— 命令行录入时两种都有人用，
 * 不兼容就等于把「写法不同」误判成「数据变了」，运营会看到一堆假的「依据不一致」。
 * 时段同理。
 */
export function sameFieldValue(expected: string | number | [number, number], evidenceValue: string): boolean {
  if (Array.isArray(expected)) {
    const w = parseWindow(evidenceValue)
    return !!w && w[0] === expected[0] && w[1] === expected[1]
  }
  if (typeof expected === 'number') {
    const clock = clockMinutes(evidenceValue)
    if (clock !== null) return clock === expected
    const text = evidenceValue.trim()
    if (!text) return false
    const n = Number(text)
    return Number.isFinite(n) && n === expected
  }
  return squeeze(expected) === squeeze(evidenceValue)
}

/** 给界面的一句话依据说明；没有依据时返回空串，调用方据此不渲染整行 */
export function evidenceNote(e: FieldEvidence | undefined, today = todayISO()): string {
  if (!e) return ''
  // verifiedAt 是完整时间戳，界面上只要日期
  const parts = [`依据 ${e.source}`, `核验于 ${e.verifiedAt.slice(0, 10)}`]
  if (isEvidenceExpired(e, today)) parts.push('已过有效期')
  return parts.join(' · ')
}

/**
 * 「开放时段」这一行的可信说明。
 *
 * 优先用字段级依据：行级 `source` / `verifiedAt` 说的是「这个地点整体」，
 * 而这一行讲的是开放时间 —— 两者可能来自不同来源、分别过期。
 * 没有依据时退回行级，原文照旧（不能因为新表是空的就把已有说明抹掉）。
 *
 * 抽成函数而不是留在页面里：以后景点详情页、对话工具面接进来时走同一处，
 * 不然「有依据用依据」这条口径会被各写一遍，早晚有一处忘了判过期。
 */
export function openNote(
  place: Pick<Place, 'fieldEvidence' | 'source' | 'verifiedAt'>,
  today = todayISO()
): string {
  // 时段（`openWindow`）优先：行程就是按它判能不能排进去的，展示也应先说它；
  // 没有时段依据才退回原文依据
  const ev = evidenceFor(place.fieldEvidence, 'openWindow') ?? evidenceFor(place.fieldEvidence, 'openText')
  if (ev) return evidenceNote(ev, today)
  const when = place.verifiedAt ? `核验 ${place.verifiedAt}` : '未记录核验时间'
  const from = place.source ? `来源${place.source} · ` : ''
  return `${from}${when}`
}
