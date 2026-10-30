<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { FactFeedbackSummary, TravelFact } from '@/types'
import { isExpired } from '@/lib/facts'
import { fetchFacts } from '@/api/catalog'
import { fetchFeedback } from '@/api/feedback'
import FactCard from '@/components/FactCard.vue'

const city = ref('成都')
const cat = ref('全部')
const expiredOpen = ref(false)
const all = ref<TravelFact[]>([])
/** 目录取不到时要说出来，不能显示成「这个分类下没有信息」 */
const catalogError = ref(false)

// A2：过期信息默认不展示，收在折叠区里，展开才看得到
const live = computed(() => all.value.filter((f) => !isExpired(f)))
const expired = computed(() => all.value.filter((f) => isExpired(f)))
const cities = computed(() => [...new Set(live.value.map((f) => f.city))])
const cityFacts = computed(() => live.value.filter((f) => f.city === city.value))
const cats = ['全部', ...new Set(cityFacts.value.map((f) => f.category))]
const list = computed(() => (cat.value === '全部' ? cityFacts.value : cityFacts.value.filter((f) => f.category === cat.value)))
const expiredOfCity = computed(() => expired.value.filter((f) => f.city === city.value))

/** 反馈汇总；接口失败才留空，空列表是「还没人反馈」不是不可用 */
const summaries = ref<Record<string, FactFeedbackSummary>>({})
const loaded = ref(false)
const summaryOf = (factId: string): FactFeedbackSummary | undefined =>
  loaded.value ? (summaries.value[factId] ?? { factId, met: 0, notApplicable: 0, mine: null }) : undefined

function apply(item: FactFeedbackSummary) {
  summaries.value = { ...summaries.value, [item.factId]: item }
}

onMounted(async () => {
  try {
    all.value = await fetchFacts()
  } catch {
    catalogError.value = true
  }
  try {
    for (const item of await fetchFeedback()) apply(item)
    loaded.value = true
  } catch {
    loaded.value = false
  }
})
</script>

<template>
  <div class="page">
    <div class="wrap col gap-md">
      <!-- 头卡 -->
      <section class="card card-pad head">
        <div class="head-aura" />
        <div class="row">
          <div class="row-start gap-sm">
            <span class="shield"><span class="ms ms-24">shield</span></span>
            <div class="col gap-1">
              <div class="row-start gap-xs">
                <span class="t-md">真实避坑雷达</span>
                <span class="badge badge-success">动态核验</span>
              </div>
              <span class="cite">出行前必看，避免踩雷少花冤枉钱</span>
            </div>
          </div>
          <div class="city-select">
            <span class="ms ms-16 num-primary">location_on</span>
            <select v-model="city" @change="cat = '全部'">
              <option v-for="c in cities" :key="c" :value="c">{{ c }}</option>
            </select>
            <span class="ms ms-14 muted">expand_more</span>
          </div>
        </div>
      </section>

      <!-- 分类 -->
      <div class="cats">
        <button
          v-for="c in cats"
          :key="c"
          type="button"
          :class="['cat', { on: cat === c }]"
          @click="cat = c"
        >
          {{ c === '全部' ? `全部 (${cityFacts.length})` : c }}
        </button>
      </div>

      <!-- 列表 -->
      <FactCard
        v-for="f in list"
        :key="f.id"
        :fact="f"
        :summary="summaryOf(f.id)"
        @submitted="apply"
      />
      <p v-if="catalogError" class="cite">避坑信息暂时取不到，请稍后再试。</p>
      <p v-else-if="!list.length" class="cite">这个分类下暂时没有信息。</p>

      <!-- 过期折叠（A2：默认不展示） -->
      <section v-if="expiredOfCity.length" class="card expired">
        <button type="button" class="row exp-head" @click="expiredOpen = !expiredOpen">
          <span class="row-start gap-1 cite">
            <span class="ms ms-16">archive</span>
            已按规则默认折叠 {{ expiredOfCity.length }} 条过期提示
          </span>
          <span class="row-start gap-1 cite num-primary strong">
            {{ expiredOpen ? '收起' : '展开' }}
            <span class="ms ms-16">{{ expiredOpen ? 'expand_less' : 'expand_more' }}</span>
          </span>
        </button>
        <div v-if="expiredOpen" class="col gap-sm exp-body">
          <div v-for="f in expiredOfCity" :key="f.id" class="exp-item col gap-1">
            <div class="row">
              <span class="t-badge muted">【{{ f.category }}】{{ f.scope }}</span>
              <span class="badge badge-source">有效期至 {{ f.validUntil }}</span>
            </div>
            <p class="t-sm muted">{{ f.content }}</p>
          </div>
        </div>
      </section>
    </div>
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
.shield {
  width: 40px;
  height: 40px;
  border-radius: var(--r-md);
  background: var(--warning-bg);
  color: var(--warning);
  display: grid;
  place-items: center;
  flex: none;
  box-shadow: var(--shadow-sm);
}
.num-primary { color: var(--primary); }

.city-select {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px var(--sp-sm);
  border-radius: var(--r-full);
  background: var(--surface-container-low);
  flex: none;
}
.city-select select {
  appearance: none;
  border: 0;
  background: transparent;
  font-size: 12px;
  line-height: 18px;
  font-weight: 700;
  color: var(--ink-strong);
  padding-right: 2px;
  outline: none;
}

.cats { display: flex; gap: var(--sp-xs); overflow-x: auto; }
.cat {
  padding: 6px var(--sp-md);
  border-radius: var(--r-full);
  background: var(--surface-card);
  color: var(--ink-muted);
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
  flex: none;
  box-shadow: var(--shadow-sm);
}
.cat.on { background: var(--primary); color: var(--on-primary); font-weight: 700; }

.expired { padding: var(--sp-sm); border-radius: var(--r-md); background: var(--surface-container-low); }
.exp-head { width: 100%; text-align: left; padding: 4px var(--sp-xs); }
.exp-body { padding-top: var(--sp-sm); }
.exp-item {
  padding: var(--sp-sm);
  border-radius: var(--r-sm);
  background: var(--surface-card);
  opacity: 0.7;
}
</style>
