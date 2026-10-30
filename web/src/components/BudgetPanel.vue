<script setup lang="ts">
import type { BudgetBreakdown } from '@/types'

const props = defineProps<{ budget: BudgetBreakdown }>()

const LABEL: Record<string, string> = {
  transport: '交通',
  lodging: '住宿',
  tickets: '门票',
  food: '餐饮',
  other: '其他'
}
const share = (amount: number) => (props.budget.total ? Math.round((amount / props.budget.total) * 100) : 0)
</script>

<template>
  <section class="card card-pad col gap-sm">
    <div class="row">
      <span class="t-md">预算明细</span>
      <span class="badge badge-primary">人均 ¥{{ budget.perPerson.toLocaleString() }}</span>
    </div>

    <div class="bars">
      <div v-for="b in budget.items" :key="b.category" class="bar-row">
        <span class="cite lab">{{ LABEL[b.category] }}</span>
        <div class="track"><i :style="{ width: share(b.amount) + '%' }" /></div>
        <span class="amt t-sm">¥{{ b.amount.toLocaleString() }}</span>
      </div>
    </div>

    <ul class="basis">
      <li v-for="b in budget.items" :key="b.category + '-basis'">{{ b.basis }}</li>
    </ul>

    <div v-if="budget.uncertain.length" class="uncertain">
      <span class="badge badge-warning">不确定项</span>
      <p v-for="u in budget.uncertain" :key="u" class="cite">{{ u }}</p>
    </div>
  </section>
</template>

<style scoped>
.bars { display: flex; flex-direction: column; gap: 6px; }
.bar-row { display: flex; align-items: center; gap: var(--sp-sm); }
.lab { width: 28px; flex: none; }
.track {
  flex: 1;
  height: 7px;
  border-radius: var(--r-full);
  background: var(--surface-container);
  overflow: hidden;
}
.track i {
  display: block;
  height: 100%;
  border-radius: var(--r-full);
  background: var(--grad);
}
.amt { width: 66px; text-align: right; flex: none; }

.basis { margin: 0; padding-left: var(--sp-lg); color: var(--ink-muted); font-size: 11px; line-height: 16px; }
.uncertain {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: var(--sp-sm);
  border-top: 1px dashed var(--outline-variant);
}
</style>
