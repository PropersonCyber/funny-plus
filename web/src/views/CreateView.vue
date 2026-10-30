<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Demand } from '@/types'
import { draft, emptyDemand } from '@/stores/draft'
import { generatePlans, UnsupportedDestination } from '@/api/planner'
import { CITY_ART } from '@/data/images'

const router = useRouter()
const route = useRoute()

const form = reactive<Demand>({
  ...emptyDemand(),
  // 新 UI 默认选中成都；用户可切换
  destination: String(route.query.city ?? '') || '成都'
})
const error = ref('')
const loading = ref(false)

const CITIES = [
  { city: '成都', tag: '热门首选', tags: '大熊猫 · 锦里 · 宽窄巷子', tone: 'warning' },
  { city: '重庆', tag: '山城夜景', tags: '洪崖洞 · 李子坝 · 江湖菜', tone: 'secondary' }
]
const CLOSED = ['大理', '西安', '长沙']

const DAYS = [
  { v: 1, title: '1 天 (特快精炼)', note: '早出晚归 · 2-3个核心景点' },
  { v: 2, title: '2 天 1 晚 (推荐)', note: '经典漫游 · 深度体验' }
]

const BUDGET = [
  { v: 'low', label: '500 元以内', cap: 500 },
  { v: 'mid', label: '500–1000 元', cap: 1000 },
  { v: 'high', label: '1000–2000 元', cap: 2000 },
  { v: 'flexible', label: '预算灵活', cap: null }
] as const

const PREFS = [
  { label: '美食探店', icon: 'restaurant' },
  { label: '经典打卡', icon: 'photo_camera' },
  { label: '拍照出片', icon: 'palette' },
  { label: '亲子慢游', icon: 'family_restroom' },
  { label: '夜景江湖', icon: 'nightlife' }
]

const TRANSPORT = [
  { v: 'public', label: '公共交通为主', note: '地铁+步行 · 经济准时', icon: 'directions_subway' },
  { v: 'charter', label: '打车 + 包车', note: '门对门直达 · 舒适高效', icon: 'local_taxi' },
  { v: 'compare', label: '让 AI 比较', note: '两种都算 · 并排对比', icon: 'compare_arrows' }
] as const

const capOf = (v: Demand['budgetLevel']) => BUDGET.find((b) => b.v === v)?.cap ?? null
const perCapita = computed(() => capOf(form.budgetLevel))

function step(delta: number) {
  form.party = Math.min(8, Math.max(1, form.party + delta))
}

/** CDN 被墙时退化成渐变块，不留破图 */
function onImgError(e: Event) {
  const el = e.target as HTMLImageElement
  el.style.display = 'none'
  el.parentElement?.classList.add('img-fallback')
}

function togglePref(label: string) {
  const i = form.preferences.indexOf(label)
  if (i >= 0) form.preferences.splice(i, 1)
  else form.preferences.push(label)
}

function quickFill() {
  form.destination = '成都'
  form.dayCount = 2
  form.party = 2
  form.budgetLevel = 'mid'
}

function submit() {
  error.value = ''
  if (!form.destination.trim()) {
    error.value = '请先选择目的地'
    return
  }
  loading.value = true
  try {
    draft.demand = { ...form, preferences: [...form.preferences] }
    draft.plans = generatePlans(draft.demand)
    router.push('/compare')
  } catch (e) {
    error.value = e instanceof UnsupportedDestination ? e.message : '生成失败，请重试'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="page">
    <div class="wrap">
      <!-- 沉浸式渐变头 -->
      <section class="hero">
        <div class="hero-glow" />
        <div class="col gap-xs hero-in">
          <div class="row-start gap-xs">
            <span class="ms ms-20 hero-icon">auto_awesome</span>
            <span class="badge hero-badge">A版精准定制引擎</span>
          </div>
          <h1 class="t-lg hero-title">AI 帮你规划下一场旅行</h1>
          <p class="t-sm hero-sub">告诉我想去的目的地、人数与预算，剩下的交给我。</p>
          <button class="quick" @click="quickFill">
            <span class="row-start gap-xs">
              <span class="ms ms-16 hero-icon">lightbulb</span>
              <span class="t-sm">快捷填入：成都 2天 2人 预算 500–1000</span>
            </span>
            <span class="badge quick-badge">填入</span>
          </button>
        </div>
      </section>

      <form class="col gap-md" @submit.prevent="submit">
        <!-- 目的地 -->
        <section class="card card-pad col gap-xs">
          <div class="row">
            <div class="row-start gap-xs">
              <i class="section-bar" />
              <span class="section-label">目的地选择</span>
            </div>
            <span class="cite">A版仅支持川渝核心</span>
          </div>
          <div class="dest-grid">
            <button
              v-for="c in CITIES"
              :key="c.city"
              type="button"
              :class="['dest', { on: form.destination === c.city }]"
              @click="form.destination = c.city"
            >
              <div class="dest-art">
                <img :src="CITY_ART[c.city]" :alt="`${c.city} 插画`" loading="lazy" @error="onImgError" />
                <span :class="['badge', 'dest-tag', c.tone === 'warning' ? 'badge-warning' : '']">{{ c.tag }}</span>
              </div>
              <div class="row dest-name">
                <span class="t-md dest-city">{{ c.city }}</span>
                <span class="ms ms-20" :class="form.destination === c.city ? 'pick-on' : 'pick-off'">
                  {{ form.destination === c.city ? 'check_circle' : 'radio_button_unchecked' }}
                </span>
              </div>
              <span class="cite">{{ c.tags }}</span>
            </button>
          </div>
          <div class="closed">
            <span class="t-sm muted">{{ CLOSED.join(' / ') }}</span>
            <span class="badge badge-source">暂未开放 · 敬请期待</span>
          </div>
        </section>

        <!-- 天数 -->
        <section class="card card-pad col gap-xs">
          <div class="row">
            <div class="row-start gap-xs">
              <i class="section-bar" />
              <span class="section-label">行程天数</span>
            </div>
            <span class="cite">A版限定 1-2 天精品</span>
          </div>
          <div class="two">
            <button
              v-for="d in DAYS"
              :key="d.v"
              type="button"
              :class="['opt', { on: form.dayCount === d.v }]"
              @click="form.dayCount = d.v"
            >
              <span class="t-md">{{ d.title }}</span>
              <span class="cite">{{ d.note }}</span>
            </button>
          </div>
          <div class="row-start gap-xs note-line">
            <span class="ms ms-14">info</span>
            <span class="cite">3-5 天长线跨城路线正在进行景点实测，后续版本推送。</span>
          </div>
        </section>

        <!-- 人数 -->
        <section class="card card-pad col gap-xs">
          <div class="row">
            <div class="row-start gap-xs">
              <i class="section-bar" />
              <span class="section-label">出行人数</span>
            </div>
            <span class="badge badge-primary">高精度算法</span>
          </div>
          <div class="stepper-row">
            <div class="col">
              <div class="row-start gap-xs">
                <span class="t-num num-primary">{{ form.party }}</span>
                <span class="strong">人同行</span>
              </div>
              <span class="cite">按实际 {{ form.party }} 人精确计算人均，非估算区间</span>
            </div>
            <div class="stepper">
              <button type="button" aria-label="减少人数" @click="step(-1)">
                <span class="ms ms-20">remove</span>
              </button>
              <span class="t-md step-val">{{ form.party }}</span>
              <button type="button" class="plus" aria-label="增加人数" @click="step(1)">
                <span class="ms ms-20">add</span>
              </button>
            </div>
          </div>
          <div class="row">
            <span class="cite">最少 1 人单人探索</span>
            <span class="cite">上限 8 人小团队</span>
          </div>
        </section>

        <!-- 预算 -->
        <section class="card card-pad col gap-xs">
          <div class="row">
            <div class="row-start gap-xs">
              <i class="section-bar" />
              <span class="section-label">总体预算控制</span>
            </div>
          <span class="row-start gap-1 per-cap">
            <span class="cite strong">人均约</span>
            <span class="t-md num-primary">{{ perCapita ? `¥${perCapita}` : '不限' }}</span>
            <span class="cite" v-if="perCapita">/人</span>
          </span>
          </div>
          <div class="chips mt-xs">
            <button
              v-for="b in BUDGET"
              :key="b.v"
              type="button"
              :class="['chip', { on: form.budgetLevel === b.v }]"
              @click="form.budgetLevel = b.v"
            >
              {{ b.label }}
            </button>
          </div>
          <p class="cite">不含往返目的地的大交通；上限是人均口径。</p>
        </section>

        <!-- 偏好 -->
        <section class="card card-pad col gap-xs">
          <div class="row">
            <div class="row-start gap-xs">
              <i class="section-bar" />
              <span class="section-label">出行偏好 (多选)</span>
            </div>
            <span class="badge badge-warning">参与排程权重</span>
          </div>
          <div class="two">
            <button
              v-for="p in PREFS"
              :key="p.label"
              type="button"
              :class="['pref', { on: form.preferences.includes(p.label) }]"
              @click="togglePref(p.label)"
            >
              <span class="ms ms-18">{{ p.icon }}</span>
              <span class="t-body">{{ p.label }}</span>
              <span v-if="form.preferences.includes(p.label)" class="ms ms-16 tick">check</span>
            </button>
          </div>
        </section>

        <!-- 交通 -->
        <section class="card card-pad col gap-xs">
          <div class="row-start gap-xs">
            <i class="section-bar" />
            <span class="section-label">交通倾向</span>
          </div>
          <div class="transit">
            <button
              v-for="t in TRANSPORT"
              :key="t.v"
              type="button"
              :class="['transit-item', { on: form.transport === t.v }]"
              @click="form.transport = t.v"
            >
              <span class="ms ms-18">{{ t.icon }}</span>
              <span class="col grow gap-1">
                <span class="t-body">{{ t.label }}</span>
                <span class="cite">{{ t.note }}</span>
              </span>
            </button>
          </div>
        </section>

        <!-- 补充要求 -->
        <section class="card card-pad col gap-xs">
          <div class="row">
            <div class="row-start gap-xs">
              <i class="section-bar" />
              <span class="section-label">补充个性化要求</span>
            </div>
            <span class="cite">选填</span>
          </div>
          <textarea
            v-model="form.notes"
            class="field"
            rows="3"
            maxlength="200"
            placeholder="例如：不想排长队、一定要吃火锅、同行有老人、想住交通方便的区域……"
          />
          <div class="row-start gap-1">
            <span class="ms ms-14 warn-icon">report</span>
            <p class="cite">补充个性化要求明确标注本期仅做备注，暂不参与自动排程算法。</p>
          </div>
        </section>

        <p v-if="error" class="err t-sm">{{ error }}</p>

        <div class="submit">
          <button type="submit" class="btn" :disabled="loading">
            {{ loading ? '规划中…' : '开始智能规划' }}
            <span class="ms ms-20">arrow_forward</span>
          </button>
          <div class="trust">
            <span class="row-start gap-1"><span class="ms ms-14 ok-icon">verified</span><span class="cite">实时票价核验</span></span>
            <i class="dot-sep" />
            <span class="row-start gap-1"><span class="ms ms-14 num-primary">route</span><span class="cite">动线不绕路</span></span>
            <i class="dot-sep" />
            <span class="row-start gap-1"><span class="ms ms-14 warn-icon">shield</span><span class="cite">内置避坑提示</span></span>
          </div>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.hero {
  position: relative;
  overflow: hidden;
  border-radius: var(--r-md);
  background: var(--grad-br);
  color: var(--on-primary);
  padding: var(--sp-lg);
  margin: var(--sp-xs) 0 var(--sp-md);
  box-shadow: var(--shadow-md);
}
.hero-glow {
  position: absolute;
  right: -24px;
  bottom: -32px;
  width: 144px;
  height: 144px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  filter: blur(24px);
  pointer-events: none;
}
.hero-in { position: relative; z-index: 1; }
.hero-icon { color: var(--primary-fixed); }
.hero-badge {
  background: rgba(255, 255, 255, 0.15);
  color: var(--primary-fixed);
  backdrop-filter: blur(6px);
}
.hero-title { color: #fff; font-weight: 800; }
.hero-sub { color: rgba(240, 247, 255, 0.9); }
.quick {
  margin-top: var(--sp-xs);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-sm);
  width: 100%;
  padding: var(--sp-xs) var(--sp-md);
  border-radius: var(--r-sm);
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  text-align: left;
}
.quick > span { min-width: 0; }
.quick .t-sm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.quick-badge { background: rgba(255, 255, 255, 0.2); color: #fff; }

.dest-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-sm); margin-top: var(--sp-xs); }
.dest {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--sp-sm);
  border-radius: var(--r-sm);
  background: var(--surface-container-low);
  border: 1px solid transparent;
  text-align: left;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.dest.on { background: var(--surface-sky); border-color: var(--primary-fixed); box-shadow: var(--shadow-sm); }
.dest-art { position: relative; height: 80px; border-radius: 6px; overflow: hidden; background: var(--surface-container); }
.dest-art img { width: 100%; height: 100%; object-fit: cover; display: block; }
.dest-tag { position: absolute; top: 6px; left: 6px; background: var(--secondary); color: #fff; }
.dest-name { margin-top: 2px; gap: var(--sp-xs); }
.dest-city { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pick-on { color: var(--primary); flex: none; }
.pick-off { color: var(--outline-variant); flex: none; }
.closed {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-sm);
  padding: 8px var(--sp-sm);
  margin-top: var(--sp-xs);
  border-radius: var(--r-sm);
  background: var(--surface-container-low);
}

.two { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-sm); margin-top: var(--sp-xs); }
.opt {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 10px var(--sp-md);
  border-radius: var(--r-sm);
  background: var(--surface-container-low);
  border: 1px solid transparent;
  color: var(--ink-strong);
  text-align: center;
}
.opt.on { background: var(--surface-sky); border-color: var(--primary-fixed); color: var(--primary); box-shadow: var(--shadow-sm); }
.opt.on .cite { color: var(--primary); }
.note-line { margin-top: 4px; }

.stepper-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-md);
  padding: var(--sp-md);
  margin-top: var(--sp-xs);
  border-radius: var(--r-md);
  background: var(--surface-sky);
}
.num-primary { color: var(--primary); }
.stepper {
  display: flex;
  align-items: center;
  gap: var(--sp-sm);
  padding: 4px;
  border-radius: var(--r-full);
  background: var(--surface-card);
  box-shadow: var(--shadow-sm);
  flex: none;
}
.stepper button {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--surface-container);
  color: var(--ink-strong);
  display: grid;
  place-items: center;
}
.stepper button.plus { background: var(--primary); color: var(--on-primary); }
.step-val { width: 24px; text-align: center; }

.per-cap { color: var(--primary); }

.chips { display: flex; flex-wrap: wrap; gap: var(--sp-sm); }
.chip {
  padding: 8px var(--sp-md);
  border-radius: var(--r-full);
  background: var(--surface-container-low);
  border: 1px solid transparent;
  font-size: 14px;
  color: var(--ink-strong);
}
.chip.on { background: var(--surface-sky); border-color: var(--primary); color: var(--primary); font-weight: 700; }

.pref {
  display: flex;
  align-items: center;
  gap: var(--sp-sm);
  padding: var(--sp-sm);
  border-radius: var(--r-sm);
  background: var(--surface-container-low);
  border: 1px solid transparent;
  color: var(--ink-strong);
  text-align: left;
  min-width: 0;
}
.pref .t-body { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pref .ms { flex: none; }
.pref.on { background: var(--surface-sky); border-color: var(--primary-fixed); color: var(--primary); font-weight: 700; box-shadow: var(--shadow-sm); }
.pref.on .tick { margin-left: auto; }

.transit { display: flex; flex-direction: column; gap: var(--sp-sm); margin-top: var(--sp-xs); }
.transit-item {
  display: flex;
  align-items: center;
  gap: var(--sp-sm);
  width: 100%;
  padding: 10px var(--sp-md);
  border-radius: var(--r-sm);
  background: var(--surface-container-low);
  border: 1px solid transparent;
  color: var(--ink-strong);
  text-align: left;
}
.transit-item.on { background: var(--surface-sky); border-color: var(--primary-fixed); color: var(--primary); box-shadow: var(--shadow-sm); }
.transit-item.on .cite { color: var(--primary); }

.warn-icon { color: var(--warning); }
.ok-icon { color: var(--success); }

.err { color: var(--danger); }

.submit { padding-top: var(--sp-xs); }
.trust {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-md);
  margin-top: var(--sp-sm);
  color: var(--ink-muted);
}
</style>
