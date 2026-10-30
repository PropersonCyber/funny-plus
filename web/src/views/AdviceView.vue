<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { BudgetItem, ChangeImpact, PlanIssue, TravelFact, TransportMode } from '@/types'
import { currentTrip, updatePlan } from '@/stores/trip'
import { revisePlan } from '@/api/planner'
import { estimateBudget } from '@/lib/budget'
import { isExpired, trustLabel } from '@/lib/facts'
import { fetchFacts } from '@/api/catalog'

const router = useRouter()
const trip = computed(() => currentTrip())
const plan = computed(() => trip.value?.plan)
const demand = computed(() => trip.value?.demand)

const impact = ref<ChangeImpact | null>(null)
const hint = ref('')

/** 三个交通方式都按同一份日程重算，才是同一个口径下的人均对比 */
const TRANSPORT_LABEL: Record<string, string> = { public: '公共交通', car: '自驾', charter: '包车' }
const modes = computed(() => {
  const p = plan.value
  const d = demand.value
  if (!p || !d) return []
  return (['public', 'car', 'charter'] as TransportMode[]).map((m) => {
    const budget = estimateBudget({ ...d, transport: m }, p.days)
    return { mode: m, label: TRANSPORT_LABEL[m], perPerson: budget.perPerson, current: p.transport === m }
  })
})
const cheapest = computed(() => [...modes.value].sort((a, b) => a.perPerson - b.perPerson)[0])

const CAT: Record<string, { label: string; color: string }> = {
  transport: { label: '交通', color: 'var(--primary)' },
  lodging: { label: '住宿', color: 'var(--brand-end)' },
  tickets: { label: '门票', color: 'var(--tertiary)' },
  food: { label: '餐饮', color: 'var(--warning)' },
  other: { label: '其他', color: 'var(--surface-container-high)' }
}
const shares = computed<{ item: BudgetItem; share: number; offset: number }[]>(() => {
  const b = plan.value?.budget
  if (!b?.total) return []
  let acc = 0
  return b.items.map((item) => {
    // 保留小数算偏移，四舍五入只用于展示，否则几段加起来会差 1% 露出缝
    const share = (item.amount / b.total) * 100
    const offset = acc
    acc += share
    return { item, share, offset }
  })
})

interface Advice {
  key: string
  title: string
  why: string
  action?: string
  day?: number
  /** 引擎不接受这个动作时给出原因，界面不能留一个点了没反应的按钮 */
  blocked?: string
}

/** 先问一遍引擎，能执行才给按钮 */
function probe(text: string, day?: number): string | null {
  const t = trip.value
  if (!t) return '还没有行程'
  const r = revisePlan(t.plan, t.demand, text, day ?? 1)
  return 'supported' in r ? r.reason : null
}

/** 建议只从校验结果和已算出的数字来，不新造判断 */
const advice = computed<Advice[]>(() => {
  const p = plan.value
  if (!p) return []
  const out: Advice[] = []
  const byIssue = (code: string) => p.issues.filter((i: PlanIssue) => i.code === code)

  const longDay = [...byIssue('day-too-long'), ...byIssue('too-much-walking')].find((i) => i.dayIndex)
  if (longDay) {
    const action = '这一天少走一点'
    out.push({
      key: 'day-long',
      title: `第 ${longDay.dayIndex} 天安排偏紧`,
      why: longDay.message,
      action,
      day: longDay.dayIndex,
      blocked: probe(action, longDay.dayIndex) ?? undefined
    })
  }

  if (byIssue('over-budget').length) {
    const action = '换掉最贵的景点'
    out.push({
      key: 'budget',
      title: '超出你设的预算档',
      why: `当前人均 ¥${p.budget.perPerson.toLocaleString()}，${byIssue('over-budget')[0].message}`,
      action,
      blocked: probe(action) ?? undefined
    })
  }

  const swap = '再换一个景点看看'
  out.push({
    key: 'swap',
    title: '想换个安排看看',
    why: '保持其余天不动，只替换当天最后一个景点，路线与预算会重算',
    action: swap,
    blocked: probe(swap) ?? undefined
  })
  return out
})

const facts = ref<TravelFact[]>([])
onMounted(async () => {
  const city = plan.value?.destination
  const today = new Date().toISOString().slice(0, 10)
  const all = await fetchFacts().catch(() => [])
  facts.value = all
    .filter((f) => f.city === city && !isExpired(f) && f.trust === 'official' && !!f.validUntil && f.validUntil >= today)
    .slice(0, 2)
})

function run(text: string, day?: number) {
  const t = trip.value
  if (!t) return
  hint.value = ''
  const res = revisePlan(t.plan, t.demand, text, day ?? 1)
  if ('supported' in res) {
    hint.value = res.reason
    return
  }
  impact.value = res.impact
  updatePlan(t.id, res.plan, res.impact.note, res.impact)
}
</script>

<template>
  <div class="page">
    <div v-if="!plan || !trip" class="wrap">
      <div class="card card-pad empty">
        <p class="t-body">还没有行程。</p>
        <p class="cite">先生成一份方案并存档。</p>
        <button class="btn" style="margin-top: 16px" @click="router.push('/create')">去创建行程</button>
      </div>
    </div>

    <template v-else>
      <div class="wrap col gap-md">
        <button class="back row-start gap-1 link" type="button" @click="router.back()">
          <span class="ms ms-16">arrow_back</span>
          <span class="t-sm strong">返回行程</span>
        </button>

        <!-- 头卡 -->
        <section class="card card-pad col gap-sm head">
          <div class="head-aura" />
          <div class="row">
            <div class="row-start gap-sm">
              <span class="advice-icon"><span class="ms ms-22">auto_awesome</span></span>
              <div class="col gap-1">
                <span class="t-lg">智能建议</span>
                <span class="cite">基于当前这版行程算出来的，不是通用攻略</span>
              </div>
            </div>
          </div>
          <div class="row">
            <span class="cite">
              {{ plan.destination }} · {{ plan.days.length }} 天 · {{ demand?.party }} 人 ·
              人均 ¥{{ plan.budget.perPerson.toLocaleString() }}
            </span>
            <span class="badge badge-primary">{{ plan.paceLabel }}</span>
          </div>
        </section>

        <p v-if="hint" class="t-sm hint">{{ hint }}</p>

        <!-- 变更影响 -->
        <section v-if="impact" class="card card-pad impact col gap-1">
          <div class="row">
            <span class="badge badge-grad">已按建议调整</span>
            <button class="cite" type="button" @click="impact = null">收起</button>
          </div>
          <p class="t-body strong">{{ impact.note }}</p>
          <p class="t-sm muted">
            {{ impact.minutes >= 0 ? '增加' : '减少' }} {{ Math.abs(impact.minutes) }} 分钟行程 ·
            {{ impact.cost >= 0 ? '增加' : '减少' }} ¥{{ Math.abs(impact.cost) }}/人
          </p>
          <p v-for="r in impact.recheck" :key="r" class="t-sm warn-text">需重新确认：{{ r }}</p>
        </section>

        <!-- 预算分配 -->
        <section class="card card-pad col gap-sm">
          <div class="row">
            <span class="t-md">预算分配</span>
            <span class="badge badge-primary">总计 ¥{{ plan.budget.total.toLocaleString() }}</span>
          </div>
          <div class="donut-row">
            <svg class="donut" viewBox="0 0 42 42" aria-hidden="true">
              <circle cx="21" cy="21" r="15.915" fill="none" stroke="var(--surface-container)" stroke-width="6" />
              <circle
                v-for="s in shares"
                :key="s.item.category"
                cx="21"
                cy="21"
                r="15.915"
                fill="none"
                :stroke="CAT[s.item.category]?.color"
                stroke-width="6"
                :stroke-dasharray="`${s.share} ${100 - s.share}`"
                :stroke-dashoffset="-s.offset"
              />
            </svg>
            <ul class="legend col gap-1">
              <li v-for="s in shares" :key="s.item.category" class="row">
                <span class="row-start gap-1">
                  <i class="dot" :style="{ background: CAT[s.item.category]?.color }" />
                  <span class="cite">{{ CAT[s.item.category]?.label }}</span>
                </span>
                <span class="t-sm strong">{{ Math.round(s.share) }}%</span>
              </li>
            </ul>
          </div>
          <p v-for="u in plan.budget.uncertain" :key="u" class="cite">· {{ u }}</p>
        </section>

        <!-- 出行方式 -->
        <section class="card card-pad col gap-sm">
          <div class="row">
            <span class="t-md">推荐出行方式</span>
            <span v-if="cheapest" class="badge badge-success">最省：{{ cheapest.label }}</span>
          </div>
          <button
            v-for="m in modes"
            :key="m.mode"
            type="button"
            class="mode row"
            :class="{ on: m.current }"
            @click="m.current ? null : router.push('/create')"
          >
            <span class="row-start gap-1">
              <span class="ms ms-18">{{ m.current ? 'check_circle' : 'radio_button_unchecked' }}</span>
              <span class="t-body strong">{{ m.label }}</span>
              <span v-if="m.current" class="badge badge-primary">当前方案</span>
            </span>
            <span class="t-sm strong">人均 ¥{{ m.perPerson.toLocaleString() }}</span>
          </button>
          <p class="cite">三种方式按同一份日程重算；换方式需要回到创建页重新生成，本页不直接改交通。</p>
        </section>

        <!-- 可执行建议 -->
        <section class="card card-pad col gap-sm">
          <div class="row">
            <span class="t-md">可以这样调整</span>
            <span class="cite">点了就改，只动受影响的当天</span>
          </div>
          <div v-for="a in advice" :key="a.key" class="advice-item col gap-1">
            <p class="t-body strong">{{ a.title }}</p>
            <p class="cite">{{ a.why }}</p>
            <button
              v-if="a.action && !a.blocked"
              class="btn btn-ghost self-start"
              type="button"
              @click="run(a.action, a.day)"
            >
              <span class="ms ms-18">auto_fix_high</span>
              {{ a.action }}
            </button>
            <p v-else-if="a.blocked" class="cite">暂不支持：{{ a.blocked }}</p>
          </div>
        </section>

        <!-- 避坑摘要 -->
        <section v-if="facts.length" class="card card-pad col gap-sm">
          <div class="row">
            <span class="t-md">出行前要确认</span>
            <button class="row-start gap-1 link" type="button" @click="router.push('/facts')">
              <span class="t-sm strong">全部避坑</span>
              <span class="ms ms-14">chevron_right</span>
            </button>
          </div>
          <div v-for="f in facts" :key="f.id" class="col gap-1">
            <div class="row-start gap-1">
              <span class="badge badge-source">{{ f.category }}</span>
              <span class="badge badge-success">{{ trustLabel[f.trust] }}</span>
            </div>
            <p class="t-sm">{{ f.content }}</p>
            <p class="cite">{{ f.scope }} · 来源：{{ f.source }} · 核验 {{ f.verifiedAt }}</p>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.head { position: relative; overflow: hidden; }
.head-aura {
  position: absolute;
  right: -24px;
  bottom: -24px;
  width: 112px;
  height: 112px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--brand-end) 12%, transparent);
  filter: blur(20px);
  pointer-events: none;
}
.advice-icon {
  width: 40px;
  height: 40px;
  border-radius: var(--r-md);
  background: var(--primary-fixed);
  color: var(--primary);
  display: grid;
  place-items: center;
  flex: none;
  box-shadow: var(--shadow-sm);
}
.back { background: none; }
.hint { color: var(--warning); }

.donut-row { display: flex; align-items: center; gap: var(--sp-lg); }
.donut { width: 112px; height: 112px; flex: none; transform: rotate(-90deg); }
.legend { flex: 1; }
.dot { width: 8px; height: 8px; border-radius: 50%; display: block; }
.legend li { justify-content: space-between; }

.mode {
  width: 100%;
  padding: 10px var(--sp-sm);
  border-radius: var(--r-md);
  background: var(--surface-container-low);
  text-align: left;
}
.mode.on { background: var(--surface-sky); box-shadow: var(--shadow-sm); }

.advice-item {
  padding: var(--sp-sm);
  border-radius: var(--r-md);
  background: var(--surface-container-low);
}
.self-start { align-self: flex-start; }

.impact { border: 1px solid var(--primary-container); }
.hint { color: var(--warning); }
</style>
