<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { draft } from '@/stores/draft'
import { saveTrip } from '@/stores/trip'
import PlanCompareCard from '@/components/PlanCompareCard.vue'

const router = useRouter()

const plans = computed(() => draft.plans)
const demand = computed(() => draft.demand)
const picked = ref(0)
const current = computed(() => plans.value[picked.value])

// 重新生成方案后旧的选中下标可能越界
watch(plans, () => {
  picked.value = 0
})

const CAP: Record<string, number | null> = { low: 500, mid: 1000, high: 2000, flexible: null }
const cap = computed(() => (demand.value ? CAP[demand.value.budgetLevel] : null))
const BUDGET_SHORT: Record<string, string> = {
  low: '≤¥500',
  mid: '≤¥1k',
  high: '≤¥2k',
  flexible: '不限'
}

/** 推荐规则：先看有没有硬冲突，冲突少的优先；并列时人均低的优先 */
const recommendedIndex = computed(() => {
  const score = (i: number) => {
    const p = plans.value[i]
    return p.issues.filter((x) => x.level === 'error').length * 100000 + p.budget.perPerson
  }
  let best = 0
  plans.value.forEach((_, i) => {
    if (score(i) < score(best)) best = i
  })
  return best
})

const compareRows = computed(() => {
  if (plans.value.length < 2) return []
  const spots = (i: number) => {
    const p = plans.value[i]
    const total = p.days.reduce((s, d) => s + d.items.filter((x) => x.kind === 'place').length, 0)
    return p.days.length ? `${Math.round((total / p.days.length) * 10) / 10} 处/天` : '—'
  }
  return [
    { label: '人均费用', cells: plans.value.map((p) => `¥${p.budget.perPerson.toLocaleString()}`) },
    { label: '总核算预算', cells: plans.value.map((p) => `¥${p.budget.total.toLocaleString()}`) },
    { label: '每日景点数', cells: plans.value.map((_, i) => spots(i)) },
    {
      label: '校验结果',
      cells: plans.value.map((p) => {
        const err = p.issues.filter((i) => i.level === 'error').length
        return err ? `${err} 处冲突` : '无冲突'
      })
    }
  ]
})

function choose() {
  const plan = current.value
  if (!plan || !demand.value) return
  saveTrip(demand.value, plan)
  router.push('/trip')
}

function back() {
  router.push('/create')
}
</script>

<template>
  <div class="page no-tabs">
    <!-- 顶部基准 -->
    <div class="bench">
      <div class="row head">
        <div class="row-start gap-xs">
          <span class="ms ms-20 num-primary">tune</span>
          <span class="t-md">方案比对与智能推荐</span>
        </div>
        <span class="badge badge-success">
          <span class="ms ms-14">verified</span>
          真实数据验算
        </span>
      </div>

      <div v-if="demand" class="card card-pad basis">
        <div class="row">
          <span class="badge badge-primary">当前输入基准</span>
          <span class="cite">共 {{ plans.length }} 套方案</span>
        </div>
        <div class="grid4">
          <div class="cell">
            <span class="cite">目的地</span>
            <span class="t-body-lg">{{ demand.destination }}</span>
          </div>
          <div class="cell">
            <span class="cite">行程时长</span>
            <span class="t-body-lg">{{ demand.dayCount }} 天</span>
          </div>
          <div class="cell">
            <span class="cite">出行人数</span>
            <span class="t-body-lg">{{ demand.party }} 人</span>
          </div>
          <div class="cell">
            <span class="cite">人均预算</span>
            <span class="t-body-lg ok-text">{{ BUDGET_SHORT[demand.budgetLevel] }}</span>
          </div>
        </div>
      </div>
    </div>

    <div v-if="!plans.length" class="wrap">
      <div class="card card-pad empty">
        <p class="t-body">还没有可比对的方案。</p>
        <p class="cite">先回创建页填一次旅行需求。</p>
        <button class="btn" style="margin-top: 16px" @click="back">去创建行程</button>
      </div>
    </div>

    <template v-else>
      <!-- 方案切换 -->
      <div class="wrap tabs">
        <div class="tab-track">
          <button
            v-for="(p, i) in plans"
            :key="p.id"
            type="button"
            :class="['tab', { on: picked === i }]"
            @click="picked = i"
          >
            <span class="ms ms-16">{{ p.transport === 'public' ? 'directions_subway' : p.transport === 'charter' ? 'local_taxi' : 'directions_car' }}</span>
            方案{{ '一二三四五'[i] }} · {{ p.paceLabel }}
          </button>
        </div>
      </div>

      <div class="wrap col gap-lg body">
        <PlanCompareCard
          v-if="current"
          :plan="current"
          :party="demand?.party ?? 1"
          :cap="cap"
          :recommended="picked === recommendedIndex"
          :active="true"
          @choose="choose"
        />

        <!-- 对标 -->
        <section v-if="compareRows.length" class="card card-pad col gap-sm">
          <div class="row-start gap-1">
            <span class="ms ms-18 num-primary">balance</span>
            <span class="t-md">关键参数差异对标</span>
          </div>
          <div class="matrix" :style="{ '--cols': String(plans.length) }">
            <div v-for="r in compareRows" :key="r.label" class="mrow">
              <span class="cite mlab">{{ r.label }}</span>
              <span
                v-for="(c, i) in r.cells"
                :key="i"
                :class="['mcell', { hl: i === picked }]"
              >{{ c }}</span>
            </div>
          </div>
        </section>

        <button class="link-back" type="button" @click="back">← 修改需求重新生成</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.bench {
  background: linear-gradient(180deg, var(--surface-sky), color-mix(in srgb, var(--surface-sky) 60%, transparent), var(--surface));
  padding: var(--sp-md) var(--sp-lg) var(--sp-lg);
  display: flex;
  flex-direction: column;
  gap: var(--sp-sm);
}
.head { margin-top: 4px; }
.num-primary { color: var(--primary); }
.ok-text { color: var(--success); }

.basis { display: flex; flex-direction: column; gap: var(--sp-sm); }
.grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; text-align: center; }
.cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 4px;
  border-radius: var(--r-sm);
  background: var(--surface-container-low);
  min-width: 0;
}
.cell .t-body-lg { font-size: 13px; line-height: 18px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cell .cite { white-space: nowrap; }

.tabs { margin-bottom: var(--sp-md); }
.tab-track {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: var(--r-full);
  background: var(--surface-container-high);
}
.tab {
  flex: 1;
  padding: 6px 8px;
  border-radius: var(--r-full);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 12px;
  line-height: 18px;
  color: var(--ink-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tab.on {
  background: var(--surface-card);
  color: var(--primary);
  font-weight: 700;
  box-shadow: var(--shadow-sm);
}

.body { padding-bottom: var(--sp-xl); }

.matrix { display: flex; flex-direction: column; gap: 6px; font-size: 12px; line-height: 18px; }
.mrow {
  display: grid;
  grid-template-columns: 1.1fr repeat(var(--cols, 2), 1fr);
  align-items: center;
  gap: 4px;
  padding: var(--sp-sm);
  border-radius: var(--r-sm);
  background: var(--surface-container-low);
  text-align: center;
}
.mlab { text-align: left; }
.mcell { color: var(--ink-strong); }
.mcell.hl { color: var(--primary); font-weight: 700; }

.link-back {
  align-self: center;
  font-size: 13px;
  color: var(--primary);
  padding: 8px;
}

.empty { display: flex; flex-direction: column; gap: 4px; text-align: center; }
</style>
