<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Plan } from '@/types'
import { fmt, planStatus } from '@/lib/validate'
import { spotArt } from '@/data/images'

const props = defineProps<{ plan: Plan; party: number; cap?: number | null; recommended?: boolean; active?: boolean }>()
const emit = defineEmits<{ choose: [] }>()

const open = ref(false)

const LABEL: Record<string, string> = {
  transport: '交通',
  lodging: '住宿',
  tickets: '门票',
  food: '餐饮',
  other: '其他'
}
const TRANSPORT: Record<string, string> = {
  public: '公共交通',
  car: '自驾',
  charter: '打车 / 包车',
  compare: '待比较'
}

const status = computed(() => planStatus(props.plan.issues))
const issues = computed(() => props.plan.issues.filter((i) => i.level !== 'info').slice(0, 2))
const balance = computed(() => (props.cap ? props.cap * props.party - props.plan.budget.total : null))

const spots = computed(() =>
  props.plan.days
    .flatMap((d) => d.items.filter((i) => i.kind === 'place'))
    .slice(0, 2)
    .map((i) => ({ id: i.id, title: i.title, art: spotArt(i.placeId, props.plan.destination) }))
)

/** CDN 被墙时退化成渐变块 */
function onImgError(e: Event) {
  const el = e.target as HTMLImageElement
  el.style.display = 'none'
  el.parentElement?.classList.add('img-fallback')
}
const stopsPerDay = computed(() => {
  const total = props.plan.days.reduce((s, d) => s + d.items.filter((i) => i.kind === 'place').length, 0)
  return props.plan.days.length ? Math.round((total / props.plan.days.length) * 10) / 10 : 0
})
const firstStart = computed(() => {
  const first = props.plan.days[0]?.items[0]
  return first ? fmt(first.startMin) : '--:--'
})
</script>

<template>
  <article class="card card-lg plan" :class="{ active }">
    <div class="row head">
      <div class="row-start gap-1 wrap-badges">
        <span v-if="recommended" class="badge badge-grad">
          <span class="ms ms-14">thumb_up</span>
          AI 高性价比推荐
        </span>
        <span v-else class="badge">{{ TRANSPORT[plan.transport] }}</span>
        <span class="badge badge-source">{{ plan.days.length }} 天 · 日均 {{ stopsPerDay }} 处</span>
      </div>
      <span v-if="status === 'conflict'" class="badge badge-danger">{{ plan.issues.filter((i) => i.level === 'error').length }} 处冲突</span>
      <span v-else-if="status === 'warn'" class="badge badge-warning">需留意</span>
      <span v-else-if="status === 'unverified'" class="badge badge-warning">待确认</span>
      <span v-else class="badge badge-success">已通过校验</span>
    </div>

    <div class="title-block">
      <span class="t-lg">{{ plan.paceLabel }}</span>
      <p class="t-sm muted">{{ plan.suitableFor }}</p>
    </div>

    <div class="money">
      <div>
        <span class="cite">总核算预算（{{ party }} 人合计）</span>
        <div class="row-start gap-1">
          <span class="t-md num-primary">¥</span>
          <span class="t-num num-primary">{{ plan.budget.total.toLocaleString() }}</span>
          <span v-if="balance !== null" class="cite">/ 预算结余 ¥{{ balance.toLocaleString() }}</span>
        </div>
      </div>
      <div class="right">
        <span class="cite">人均费用</span>
        <span class="t-lg">¥{{ plan.budget.perPerson.toLocaleString() }}</span>
      </div>
    </div>

    <div class="tags">
      <span class="badge">首日 {{ firstStart }} 出发</span>
      <span class="badge">{{ TRANSPORT[plan.transport] }}</span>
      <span v-if="plan.highlights[0]" class="badge">{{ plan.highlights[0] }}</span>
    </div>

    <div class="spots">
      <span class="t-body-lg strong">精选节点</span>
      <div v-if="spots.length" class="spot-grid">
        <div v-for="s in spots" :key="s.id" class="spot">
          <img :src="s.art" :alt="s.title" loading="lazy" @error="onImgError" />
          <span class="spot-name badge">{{ s.title }}</span>
        </div>
      </div>
      <ul class="checklist">
        <li v-for="h in plan.highlights" :key="h">
          <span class="ms ms-16 check-icon">check</span>
          <span class="t-body">{{ h }}</span>
        </li>
      </ul>
    </div>

    <div v-if="issues.length" class="alert" :class="issues[0].level">
      <span class="ms ms-18">{{ issues[0].level === 'error' ? 'error_outline' : 'warning' }}</span>
      <div class="col gap-1">
        <span class="t-sm strong">{{ issues[0].level === 'error' ? '必须调整' : '出行提示与风险预警' }}</span>
        <span class="cite">{{ issues.map((i) => i.message).join('；') }}</span>
      </div>
    </div>

    <div class="accordion">
      <button class="row acc-head" type="button" @click="open = !open">
        <span class="row-start gap-1 t-sm strong">
          <span class="ms ms-16 sec-icon">receipt_long</span>
          费用依据透明清单
        </span>
        <span class="ms ms-18 muted">{{ open ? 'expand_less' : 'expand_more' }}</span>
      </button>
      <div v-if="open" class="acc-body">
        <div v-for="b in plan.budget.items" :key="b.category" class="acc-row">
          <span class="muted">{{ LABEL[b.category] }}</span>
          <span>¥{{ b.amount.toLocaleString() }}</span>
        </div>
        <p v-for="u in plan.budget.uncertain" :key="u" class="cite">· {{ u }}</p>
        <p class="cite">以上是估算口径，不含往返目的地的大交通。</p>
      </div>
    </div>

    <button :class="['btn', { 'btn-quiet': !recommended }]" type="button" @click="emit('choose')">
      选定此方案并查看逐日行程
      <span class="ms ms-18">arrow_forward</span>
    </button>
  </article>
</template>

<style scoped>
.plan { display: flex; flex-direction: column; gap: var(--sp-md); }
.plan.active { outline: 2px solid var(--primary-fixed); }
.head { align-items: flex-start; }
.wrap-badges { flex-wrap: wrap; }
.title-block { display: flex; flex-direction: column; gap: 2px; }
.num-primary { color: var(--primary); }
.right { text-align: right; }

.money {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-md);
  padding: var(--sp-md);
  border-radius: var(--r-sm);
  background: var(--surface-sky);
}

.tags { display: flex; flex-wrap: wrap; gap: 6px; }

.spots { display: flex; flex-direction: column; gap: var(--sp-sm); }
.spot-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-sm); }
.spot {
  position: relative;
  height: 80px;
  border-radius: var(--r-sm);
  overflow: hidden;
  background: var(--surface-container);
}
.spot img { width: 100%; height: 100%; object-fit: cover; display: block; }
.spot-name {
  position: absolute;
  left: 6px;
  bottom: 6px;
  background: rgba(15, 23, 42, 0.7);
  color: #fff;
  max-width: calc(100% - 12px);
  overflow: hidden;
  text-overflow: ellipsis;
}

.checklist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.checklist li { display: flex; align-items: center; gap: var(--sp-sm); }
.check-icon { color: var(--primary); }

.alert {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: var(--sp-sm);
  border-radius: var(--r-sm);
}
.alert.warn { background: var(--warning-bg); color: var(--tertiary); }
.alert.error { background: var(--danger-bg); color: var(--error); }

.accordion { border-radius: var(--r-sm); background: var(--surface-container-low); padding: var(--sp-sm); }
.acc-head { width: 100%; text-align: left; }
.sec-icon { color: var(--secondary); }
.acc-body {
  margin-top: var(--sp-sm);
  padding-top: var(--sp-sm);
  border-top: 1px solid color-mix(in srgb, var(--outline-variant) 30%, transparent);
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  line-height: 18px;
}
.acc-row { display: flex; align-items: center; justify-content: space-between; }
</style>
