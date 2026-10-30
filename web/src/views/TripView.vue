<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { ChangeImpact, ItineraryItem } from '@/types'
import { currentTrip, saveError, updatePlan } from '@/stores/trip'
import { revisePlan } from '@/api/planner'
import { fmt, planStatus } from '@/lib/validate'
import { placeById } from '@/lib/placeIndex'
import BudgetPanel from '@/components/BudgetPanel.vue'

const router = useRouter()
const trip = computed(() => currentTrip())
const plan = computed(() => trip.value?.plan)
const dayNo = ref(1)
const instruction = ref('')
const impact = ref<ChangeImpact | null>(null)
const hint = ref('')
const sheetOpen = ref(false)

const day = computed(() => plan.value?.days.find((d) => d.index === dayNo.value) ?? plan.value?.days[0])
const errors = computed(() => plan.value?.issues.filter((i) => i.level === 'error') ?? [])
const infos = computed(() => plan.value?.issues.filter((i) => i.level !== 'error') ?? [])
const status = computed(() => planStatus(plan.value?.issues ?? []))

const verdict = computed(() => {
  switch (status.value) {
    case 'conflict':
      return `${errors.value.length} 处需要调整才能执行。`
    case 'warn':
      return '没有冲突，但有需要留意的地方。'
    case 'unverified':
      return '没有冲突，但下面这些信息无法在这里核实，出发前要自己确认。'
    default:
      return '路线、时间、人数与预算已通过校验。'
  }
})

// 只列引擎真正支持的意图，避免点了没反应
const QUICK = [
  { text: '这一天少走一点', icon: 'directions_walk' },
  { text: '换掉最贵的景点', icon: 'savings' },
  { text: '再换一个景点看看', icon: 'swap_horiz' }
]

const placeOf = (item: ItineraryItem) => (item.placeId ? placeById(item.placeId) : undefined)

function revise(text: string) {
  hint.value = ''
  const t = trip.value
  if (!t || !text.trim()) return
  const res = revisePlan(t.plan, t.demand, text, dayNo.value)
  if ('supported' in res) {
    hint.value = res.reason
    return
  }
  impact.value = res.impact
  updatePlan(t.id, res.plan, res.impact.note, res.impact)
  instruction.value = ''
  sheetOpen.value = false
}

function openSheet() {
  hint.value = ''
  impact.value = null
  sheetOpen.value = true
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
        <!-- 概要 -->
        <section class="card card-pad col gap-sm">
          <div class="row">
            <div class="row-start gap-sm">
              <span class="t-lg">{{ plan.destination }}</span>
              <span class="badge badge-primary">{{ plan.days.length }} 天</span>
            </div>
            <span class="badge">{{ plan.paceLabel }}</span>
          </div>
          <div class="row">
            <span class="cite">{{ trip.demand.party }} 人 · 人均 ¥{{ plan.budget.perPerson.toLocaleString() }} · 总计 ¥{{ plan.budget.total.toLocaleString() }}</span>
            <button class="row-start gap-1 link" @click="router.push('/trip/map')">
              <span class="ms ms-16">route</span>
              <span class="t-sm strong">路线地图</span>
            </button>
          </div>
        </section>

        <p v-if="saveError" class="t-sm save-err">{{ saveError }}</p>

        <!-- 天切换 -->
        <div class="days">
          <button
            v-for="d in plan.days"
            :key="d.index"
            type="button"
            :class="['day-chip', { on: dayNo === d.index }]"
            @click="dayNo = d.index"
          >
            Day {{ d.index }}
          </button>
        </div>

        <div class="row">
          <div class="row-start gap-xs">
            <span class="t-lg">Day {{ day?.index }} 行程明细</span>
            <span class="badge badge-primary">已就绪</span>
          </div>
          <span class="cite">{{ plan.destination }}</span>
        </div>

        <!-- 时间轴 -->
        <section class="col gap-sm">
          <article v-for="item in day?.items" :key="item.id" class="card card-pad item" :class="item.kind">
            <div class="row-start gap-sm">
              <span class="time t-md">{{ fmt(item.startMin) }}</span>
              <span class="badge badge-source">
                {{ item.kind === 'meal' ? '用餐' : `游玩 ${Math.round((item.stayMin / 60) * 10) / 10}小时` }}
              </span>
            </div>
            <p class="t-md title">{{ item.title }}</p>
            <p class="t-sm muted meta">
              <template v-if="item.transportMin">路上 {{ item.transportMin }} 分钟 · </template>
              停留 {{ item.stayMin }} 分钟
              <template v-if="item.cost"> · ¥{{ item.cost }}/人</template>
              <template v-if="placeOf(item)"> · 开放 {{ fmt(placeOf(item)!.open[0]) }}–{{ fmt(placeOf(item)!.open[1]) }}</template>
            </p>
          </article>
        </section>

        <!-- 智能建议入口：看完行程想整体调一下时的去处 -->
        <button class="card card-pad tweak advice-entry" type="button" @click="router.push('/trip/advice')">
          <span class="row-start gap-sm">
            <span class="tweak-icon ai"><span class="ms ms-20">auto_awesome</span></span>
            <span class="col">
              <span class="t-body strong">智能建议 · 调整这份行程</span>
              <span class="cite">预算分配、出行方式对比、可直接执行的调整</span>
            </span>
          </span>
          <span class="ms ms-18 muted">chevron_right</span>
        </button>

        <!-- 局部微调入口 -->
        <button class="card card-pad tweak" type="button" @click="openSheet">
          <span class="row-start gap-sm">
            <span class="tweak-icon"><span class="ms ms-20">tune</span></span>
            <span class="col">
              <span class="t-body strong">围绕 Day {{ dayNo }} 局部微调</span>
              <span class="cite">仅重算本单日安排，保持其余天完整连贯</span>
            </span>
          </span>
          <span class="ms ms-18 muted">chevron_right</span>
        </button>

        <!-- 变更影响 -->
        <section v-if="impact" class="card card-pad impact col gap-1">
          <div class="row">
            <span class="badge badge-grad">变更影响</span>
            <button class="cite" type="button" @click="impact = null">收起</button>
          </div>
          <p class="t-body strong">{{ impact.note }}</p>
          <p class="t-sm muted">
            {{ impact.minutes >= 0 ? '增加' : '减少' }} {{ Math.abs(impact.minutes) }} 分钟行程 ·
            {{ impact.cost >= 0 ? '增加' : '减少' }} ¥{{ Math.abs(impact.cost) }}/人
          </p>
          <p v-for="r in impact.recheck" :key="r" class="t-sm warn-text">需重新确认：{{ r }}</p>
        </section>

        <!-- 校验 -->
        <section class="card card-pad col gap-sm">
          <div class="row-start gap-xs">
            <span class="ms ms-18" :class="status === 'conflict' ? 'bad-icon' : status === 'ok' ? 'ok-icon' : 'warn-icon'">
              {{ status === 'conflict' ? 'error_outline' : status === 'ok' ? 'verified' : 'report' }}
            </span>
            <span class="t-md">校验结果</span>
          </div>
          <p class="t-sm muted">{{ verdict }}</p>
          <ul v-if="errors.length || infos.length" class="issues">
            <li v-for="i in [...errors, ...infos]" :key="i.code + i.message" :class="i.level">
              {{ i.message }}
            </li>
          </ul>
        </section>

        <BudgetPanel :budget="plan.budget" />

        <section class="card card-pad col gap-xs">
          <div class="row">
            <span class="t-md">变更记录</span>
            <span class="cite">{{ trip.versions.length }} 条</span>
          </div>
          <p v-for="v in [...trip.versions].reverse()" :key="v.at" class="cite">
            {{ v.at.slice(5, 16).replace('T', ' ') }} · {{ v.note }}
          </p>
        </section>
      </div>

      <!-- 微调抽屉 -->
      <div v-if="sheetOpen" class="overlay overlay-bottom" @click.self="sheetOpen = false">
        <div class="sheet col gap-md">
          <div class="grabber" />
          <div class="row">
            <div class="row-start gap-sm">
              <span class="tweak-icon"><span class="ms ms-20">tune</span></span>
              <div class="col gap-1">
                <div class="row-start gap-xs">
                  <span class="t-lg">围绕 Day {{ dayNo }} 局部微调</span>
                  <span class="badge badge-primary">{{ plan.destination }}</span>
                </div>
                <span class="cite">仅重算本单日安排，保持其余天完整连贯</span>
              </div>
            </div>
            <button class="icon-btn" type="button" aria-label="关闭" @click="sheetOpen = false">
              <span class="ms ms-18">close</span>
            </button>
          </div>

          <div class="rule-alert">
            <span class="ms ms-20 warn-icon">info</span>
            <div class="col gap-1">
              <span class="badge badge-warning">保真重算规则</span>
              <p class="t-sm">
                未识别的自然语言指令不会静默改动其他天；本次调整会重新计算关联路线用时与交通/门票预算。
              </p>
            </div>
          </div>

          <div class="col gap-sm">
            <div class="row">
              <span class="t-sm strong">常用敏捷意图（点击直接执行）</span>
              <span class="cite">本期引擎支持这 3 类</span>
            </div>
            <button v-for="q in QUICK" :key="q.text" class="intent" type="button" @click="revise(q.text)">
              <span class="ms ms-18 num-primary">{{ q.icon }}</span>
              <span class="t-md">{{ q.text }}</span>
              <span class="ms ms-18 muted">chevron_right</span>
            </button>
          </div>

          <div class="col gap-1">
            <span class="t-sm strong">自定义自然语言补充</span>
            <textarea
              v-model="instruction"
              class="field"
              rows="3"
              placeholder="例如：第二天轻松一点、换掉最贵的景点"
              @keyup.enter.exact="revise(instruction)"
            />
          </div>

          <p v-if="hint" class="t-sm warn-text">{{ hint }}</p>

          <div class="row gap-sm">
            <button class="btn btn-ghost" type="button" style="width: 34%" @click="sheetOpen = false">放弃修改</button>
            <button class="btn" type="button" :disabled="!instruction.trim()" @click="revise(instruction)">
              <span class="ms ms-20">auto_mode</span>
              确认微调并重新计算
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.empty { display: flex; flex-direction: column; gap: 4px; text-align: center; }
.link { color: var(--primary); }
.save-err { color: var(--danger); }

.days { display: flex; gap: var(--sp-sm); overflow-x: auto; }
.day-chip {
  padding: 7px var(--sp-md);
  border-radius: var(--r-full);
  background: var(--surface-card);
  color: var(--ink-muted);
  font-size: 13px;
  font-weight: 700;
  flex: none;
  box-shadow: var(--shadow-sm);
}
.day-chip.on { background: var(--primary); color: var(--on-primary); }

.item { display: flex; flex-direction: column; gap: 4px; border-radius: var(--r-lg); }
.item.meal { background: var(--surface-container-low); box-shadow: none; }
.time { color: var(--primary); }
.title { color: var(--ink-strong); }
.meta { line-height: 18px; }

.tweak {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-sm);
  text-align: left;
  border-radius: var(--r-lg);
}
.tweak-icon {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--surface-sky);
  color: var(--primary);
  display: grid;
  place-items: center;
  flex: none;
}
.tweak-icon.ai { background: var(--grad); color: var(--on-primary); }

.impact { border-left: 3px solid var(--primary); }
.warn-text { color: var(--warning); }
.bad-icon { color: var(--danger); }
.ok-icon { color: var(--success); }
.warn-icon { color: var(--warning); }
.num-primary { color: var(--primary); }

.issues { margin: 0; padding-left: var(--sp-lg); display: flex; flex-direction: column; gap: 4px; font-size: 12px; line-height: 18px; color: var(--ink-muted); }
.issues li.error { color: var(--danger); }
.issues li.warn { color: var(--warning); }

.rule-alert {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: var(--sp-md);
  border-radius: var(--r-md);
  background: var(--warning-bg);
  color: var(--ink-strong);
}
.intent {
  display: flex;
  align-items: center;
  gap: var(--sp-sm);
  width: 100%;
  padding: 14px;
  border-radius: var(--r-lg);
  background: var(--surface-container-low);
  text-align: left;
}
.intent:active { background: var(--surface-sky); }
.row.gap-sm { gap: var(--sp-sm); }
</style>
