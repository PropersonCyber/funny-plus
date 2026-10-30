<script setup lang="ts">
import { computed, ref } from 'vue'
import type { FactFeedbackSummary, FeedbackVerdict, TravelFact } from '@/types'
import { trustLabel } from '@/lib/facts'
import { submitFeedback } from '@/api/feedback'

const props = defineProps<{ fact: TravelFact; summary?: FactFeedbackSummary }>()
const emit = defineEmits<{ submitted: [FactFeedbackSummary] }>()

const open = ref(false)
const note = ref('')
const busy = ref(false)
const error = ref('')
const picked = ref<FeedbackVerdict>('met')

/** 可信度决定卡片的严重级别配色：官方=提示级，待核实=警示级 */
const tone = computed(() => {
  if (props.fact.trust === 'official') return 'danger'
  if (props.fact.trust === 'pending') return 'primary'
  return 'warning'
})
const toneLabel = computed(() => {
  if (props.fact.trust === 'official') return '必看警示'
  if (props.fact.trust === 'pending') return '额外提示'
  return '注意避坑'
})
const CAT_ICON: Record<string, string> = {
  预约与门票: 'priority_high',
  交通与路线: 'directions_car',
  天气与人流: 'wb_sunny',
  额外消费: 'storefront',
  安全与健康: 'health_and_safety',
  老人与小孩: 'family_restroom'
}

function openSheet(verdict: FeedbackVerdict) {
  picked.value = verdict
  note.value = ''
  error.value = ''
  open.value = true
}

async function send() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    emit('submitted', await submitFeedback(props.fact.id, picked.value, note.value))
    open.value = false
  } catch (e) {
    error.value = e instanceof Error ? e.message : '提交失败'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <article class="card tip" :class="tone">
    <div class="tip-bar" />
    <div class="tip-body col gap-sm">
      <div class="row">
        <div class="row-start gap-xs">
          <span class="cat-icon" :class="tone"><span class="ms ms-16">{{ CAT_ICON[fact.category] ?? 'report' }}</span></span>
          <span class="t-md">{{ fact.category }}</span>
        </div>
        <div class="row-start gap-1">
          <span class="badge" :class="`badge-${tone}`">{{ toneLabel }}</span>
          <span class="badge" :class="fact.trust === 'official' ? 'badge-success' : 'badge-source'">
            <span class="ms ms-14">{{ fact.trust === 'official' ? 'verified' : 'sensors' }}</span>
            {{ trustLabel[fact.trust] }}
          </span>
        </div>
      </div>

      <p class="t-body content">{{ fact.content }}</p>

      <div class="src col gap-1">
        <div class="row">
          <span class="row-start gap-1 cite">
            <span class="ms ms-14 num-primary">link</span>
            来源：{{ fact.source }}
          </span>
          <span class="cite">核验 {{ fact.verifiedAt }}</span>
        </div>
        <span class="cite">适用：{{ fact.scope }}</span>
      </div>

      <div class="row feedback">
        <div class="row-start gap-sm">
          <button
            class="fb on-met"
            type="button"
            :disabled="!summary || !!summary.mine"
            @click="openSheet('met')"
          >
            <span class="ms ms-16">thumb_up</span>
            我也遇到了{{ summary ? ` (${summary.met})` : '' }}
          </button>
          <button
            class="fb not-met"
            type="button"
            :disabled="!summary || !!summary.mine"
            @click="openSheet('not-applicable')"
          >
            <span class="ms ms-16">thumb_down</span>
            不适用{{ summary ? ` (${summary.notApplicable})` : '' }}
          </button>
        </div>
        <span v-if="summary?.mine" class="cite">你已反馈</span>
        <!-- 接口不可用时说清楚，不能显示成 0 条反馈 -->
        <span v-else-if="!summary" class="cite">反馈暂不可用</span>
      </div>
    </div>

    <!-- 反馈弹窗 -->
    <div v-if="open" class="overlay overlay-center" @click.self="open = false">
      <div class="dialog col gap-md">
        <div class="aura" />
        <div class="row">
          <div class="row-start gap-sm">
            <span class="aura-icon"><span class="ms ms-18">verified</span></span>
            <div class="col gap-1">
              <span class="t-md">提交真实避坑反馈</span>
              <span class="cite">匿名沉淀真实旅者情报</span>
            </div>
          </div>
          <button class="icon-btn" type="button" aria-label="关闭" @click="open = false">
            <span class="ms ms-18">close</span>
          </button>
        </div>

        <div class="target col gap-1">
          <div class="row-start gap-1">
            <i class="dot-sep" style="background: var(--warning)" />
            <span class="t-badge warn-text">针对避坑条目</span>
          </div>
          <p class="t-sm strong">{{ fact.content }}</p>
        </div>

        <div class="col gap-sm">
          <span class="t-badge muted">反馈态度（单选）</span>
          <button type="button" :class="['opt', { on: picked === 'met' }]" @click="picked = 'met'">
            <span class="opt-emoji">👍</span>
            <span class="col grow">
              <span class="t-body strong" :class="{ 'num-primary': picked === 'met' }">我也遇到了</span>
              <span class="cite">{{ summary ? `已有 ${summary.met} 位旅友验证` : '—' }}</span>
            </span>
            <span class="radio" :class="{ on: picked === 'met' }">
              <span v-if="picked === 'met'" class="ms ms-14">check</span>
            </span>
          </button>
          <button type="button" :class="['opt', { on: picked === 'not-applicable' }]" @click="picked = 'not-applicable'">
            <span class="opt-emoji">👎</span>
            <span class="col grow">
              <span class="t-body strong" :class="{ 'num-primary': picked === 'not-applicable' }">不适用 / 信息有误</span>
              <span class="cite">{{ summary ? `已有 ${summary.notApplicable} 人反馈异常` : '—' }}</span>
            </span>
            <span class="radio" :class="{ on: picked === 'not-applicable' }">
              <span v-if="picked === 'not-applicable'" class="ms ms-14">check</span>
            </span>
          </button>
        </div>

        <div class="col gap-1">
          <div class="row">
            <span class="t-badge muted">补充一句话经验（选填）</span>
            <span class="cite">{{ note.length }}/40</span>
          </div>
          <textarea v-model="note" class="field" rows="3" maxlength="40" placeholder="例如：我周六去的，现场确实没有售票窗口" />
        </div>

        <div class="rule row-start gap-1">
          <span class="ms ms-14 num-primary">info</span>
          <p class="cite">
            同一浏览器仅可提交一次；本期反馈计入热度指标，暂不自动修改可信状态。
          </p>
        </div>

        <p v-if="error" class="t-sm bad-text">{{ error }}</p>

        <div class="row" style="gap: 12px">
          <button class="btn btn-ghost" type="button" style="width: 80px" @click="open = false">取消</button>
          <button class="btn" type="button" :disabled="busy" @click="send">
            <span class="ms ms-18">send</span>
            匿名提交反馈
          </button>
        </div>
      </div>
    </div>
  </article>
</template>

<style scoped>
.tip {
  display: flex;
  border-radius: var(--r-md);
  overflow: hidden;
}
.tip-bar { width: 6px; flex: none; }
.tip.danger .tip-bar { background: var(--danger); }
.tip.warning .tip-bar { background: var(--warning); }
.tip.primary .tip-bar { background: var(--primary); }
.tip-body { padding: var(--sp-md); flex: 1; }

.cat-icon {
  width: 24px;
  height: 24px;
  border-radius: var(--r-sm);
  display: grid;
  place-items: center;
  flex: none;
}
.cat-icon.danger { background: var(--danger-bg); color: var(--danger); }
.cat-icon.warning { background: var(--warning-bg); color: var(--warning); }
.cat-icon.primary { background: var(--surface-sky); color: var(--primary); }

.content { line-height: 22px; color: var(--ink-strong); }

.src {
  padding: var(--sp-sm);
  border-radius: var(--r-sm);
  background: var(--surface-container-low);
}
.num-primary { color: var(--primary); }
.warn-text { color: var(--warning); }
.bad-text { color: var(--danger); }

.feedback { padding-top: var(--sp-xs); }
.fb {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px var(--sp-sm);
  border-radius: var(--r-full);
  font-size: 12px;
  line-height: 18px;
}
.fb.on-met { background: var(--surface-sky); color: var(--primary); }
.fb.not-met { background: var(--surface-container-high); color: var(--ink-muted); }
.fb:disabled { opacity: 0.6; }

.aura {
  position: absolute;
  top: -48px;
  right: -48px;
  width: 128px;
  height: 128px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--primary-fixed) 40%, transparent);
  filter: blur(24px);
  pointer-events: none;
}
.aura-icon {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--primary-fixed);
  color: var(--primary);
  display: grid;
  place-items: center;
  flex: none;
}
.target {
  padding: var(--sp-md);
  border-radius: var(--r-md);
  background: var(--surface-container-low);
}

.opt {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: var(--sp-md);
  border-radius: var(--r-lg);
  background: var(--surface-container-low);
  text-align: left;
}
.opt.on { background: var(--surface-sky); box-shadow: var(--shadow-sm); }
.opt-emoji { font-size: 18px; }
.radio {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--surface-container-high);
  display: grid;
  place-items: center;
  flex: none;
}
.radio.on { background: var(--primary); color: var(--on-primary); }

.rule {
  padding: 10px;
  border-radius: var(--r-md);
  background: var(--surface-container-low);
}
</style>
