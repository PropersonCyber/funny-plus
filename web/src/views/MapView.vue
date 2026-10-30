<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { ItineraryItem, Place } from '@/types'
import { currentTrip } from '@/stores/trip'
import { distanceKm, placeById, travelMinutes } from '@/lib/placeIndex'
import { fmt } from '@/lib/validate'
import { MAP_ART, spotArt } from '@/data/images'

const router = useRouter()
const trip = computed(() => currentTrip())
const plan = computed(() => trip.value?.plan)
const dayNo = ref(1)
const view = ref<'map' | 'list'>('map')
const active = ref(0)

const day = computed(() => plan.value?.days.find((d) => d.index === dayNo.value) ?? plan.value?.days[0])

interface Stop {
  item: ItineraryItem
  place: Place
  order: number
  x: number
  y: number
  prev?: Place
}

const stops = computed<Stop[]>(() => {
  // 地点被删或改名时 placeById 查不到，直接跳过，别拿 undefined 的坐标去画
  const list = (day.value?.items ?? [])
    .map((i) => ({ item: i, place: i.placeId ? placeById(i.placeId) : undefined }))
    .filter((s): s is { item: ItineraryItem; place: Place } => !!s.place)
  if (!list.length) return []

  const PAD = 14
  const lngs = list.map((s) => s.place.lng)
  const lats = list.map((s) => s.place.lat)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const spanLng = maxLng - minLng || 0.01
  const spanLat = maxLat - minLat || 0.01

  // 地图 400x233，气泡固定宽度；靠边的针要收进来，否则名字被裁掉
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
  // 景点挨得近时针会叠在一起，按顺序错开，避免看不清是谁
  const placed: { x: number; y: number }[] = []

  return list.map((s, idx) => {
    const x = clamp(PAD + ((s.place.lng - minLng) / spanLng) * (100 - PAD * 2), 22, 78)
    let y = clamp(PAD + ((maxLat - s.place.lat) / spanLat) * (100 - PAD * 2), 16, 88)
    while (placed.some((p) => Math.abs(p.x - x) < 20 && Math.abs(p.y - y) < 13)) {
      y = y + 13 > 90 ? Math.max(16, y - 13) : y + 13
    }
    placed.push({ x, y })
    return {
      ...s,
      order: idx + 1,
      x,
      y,
      prev: idx > 0 ? list[idx - 1].place : undefined
    }
  })
})

const polyline = computed(() => stops.value.map((s) => `${s.x},${s.y}`).join(' '))
const totalTravel = computed(() => stops.value.reduce((sum, s) => sum + s.item.transportMin, 0))
const current = computed(() => stops.value[Math.min(active.value, stops.value.length - 1)])

const legText = computed(() => {
  const c = current.value
  if (!c) return ''
  if (!c.prev) return `首站 · 从住处出发约 ${c.item.transportMin} 分钟`
  return `距上一站 ${distanceKm(c.prev, c.place)} km · 约 ${travelMinutes(c.prev, c.place, c.item.transportMode !== 'public')} 分钟`
})

const mapFailed = ref(false)
const onMapError = () => (mapFailed.value = true)

/** CDN 被墙时退化成渐变块 */
function onImgError(e: Event) {
  const el = e.target as HTMLImageElement
  el.style.display = 'none'
  el.parentElement?.classList.add('img-fallback')
}

const iconOf = (place: Place) => {
  if (place.tags.includes('亲子') || place.tags.includes('动物')) return 'pets'
  if (place.tags.includes('商圈')) return 'shopping_bag'
  if (place.tags.includes('夜景')) return 'local_fire_department'
  if (place.tags.includes('人文')) return 'temple_buddhist'
  if (place.tags.includes('老街') || place.tags.includes('古镇')) return 'cottage'
  return 'place'
}
</script>

<template>
  <div class="page">
    <div v-if="!plan" class="wrap">
      <div class="card card-pad empty">
        <p class="t-body">还没有行程。</p>
        <button class="btn" style="margin-top: 16px" @click="router.push('/create')">去创建行程</button>
      </div>
    </div>

    <template v-else>
      <!-- 顶部概览 -->
      <div class="wrap top">
        <div class="card overview">
          <button class="row-start gap-1 back" type="button" @click="router.push('/trip')">
            <span class="ms ms-18 num-primary">chevron_left</span>
            <span class="t-sm strong">{{ plan.destination }} · {{ plan.days.length }} 天</span>
          </button>
          <div class="row-start gap-1">
            <span class="dot-sep" />
            <span class="t-sm muted">{{ trip?.demand.party }} 人</span>
            <span class="dot-sep" />
            <span class="t-sm num-primary strong">¥{{ plan.budget.perPerson }}/人</span>
          </div>
          <span class="badge badge-success">已保存</span>
        </div>

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
      </div>

      <!-- 地图画布 -->
      <div v-show="view === 'map'" class="canvas" :class="{ 'img-fallback': mapFailed }">
        <div class="canvas-art">
          <img class="map-img" :src="MAP_ART" alt="动漫插画地图" @error="onMapError" />
          <svg class="trail" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <polyline :points="polyline" class="trail-line" vector-effect="non-scaling-stroke" />
          </svg>

          <button
            v-for="(s, i) in stops"
            :key="s.place.id"
            type="button"
            :class="['pin', { on: i === active }]"
            :style="{ left: `${s.x}%`, top: `${s.y}%` }"
            @click="active = i"
          >
            <span class="pin-wrap">
              <span v-if="i === active" class="pin-pulse" />
              <span class="pin-bubble">
                <span :class="['pin-no', { on: i === active }]">{{ s.order }}</span>
                <span class="pin-name">{{ s.place.name }}</span>
              </span>
              <span class="pin-arrow" />
              <span class="pin-icon" :class="{ on: i === active }">
                <span class="ms ms-16">{{ iconOf(s.place) }}</span>
              </span>
            </span>
          </button>

          <div class="route-pill">
            <span class="ms ms-16 route-pill-icon">route</span>
            <span class="t-badge">今日路线：{{ stops.length }} 处景点 · 路上合计 {{ totalTravel }} 分钟</span>
          </div>
        </div>
      </div>

      <!-- 底部页签 -->
      <div class="wrap pills-wrap">
        <div class="pills">
          <button type="button" :class="['pill', { on: view === 'map' }]" @click="view = 'map'">
            <span class="ms ms-16">explore</span> 探索地图
          </button>
          <button type="button" :class="['pill', { on: view === 'list' }]" @click="view = 'list'">
            <span class="ms ms-16">timeline</span> 行程路线
          </button>
        </div>
      </div>

      <!-- 列表 -->
      <div v-show="view === 'list'" class="wrap col gap-sm list">
        <p class="cite">示意路线：按经纬度绘制，距离与耗时来自行程数据，不是导航结果。</p>
        <button
          v-for="(s, i) in stops"
          :key="s.place.id + '-row'"
          type="button"
          :class="['card card-pad stop', { on: i === active }]"
          @click="active = i"
        >
          <span class="pin-no on">{{ s.order }}</span>
          <span class="col grow">
            <span class="t-body strong">{{ s.place.name }}</span>
            <span class="cite">{{ fmt(s.item.startMin) }}–{{ fmt(s.item.endMin) }} · 停留 {{ s.item.stayMin }} 分钟</span>
          </span>
          <span class="t-sm muted">{{ s.item.cost ? `¥${s.item.cost}` : '免费' }}</span>
        </button>
        <p v-if="!stops.length" class="cite">这一天没有景点，回行程页安排一下。</p>
      </div>

      <!-- 选中景点卡 -->
      <div v-if="current && view === 'map'" class="wrap detail-wrap">
        <section class="card detail">
          <div class="detail-bar" />
          <div class="detail-body col gap-sm">
            <div class="row-start gap-md">
              <div class="thumb">
                <img :src="spotArt(current.place.id, current.place.city)" :alt="current.place.name" loading="lazy" @error="onImgError" />
              </div>
              <div class="col grow gap-1">
                <div class="row">
                  <h3 class="t-md">{{ current.place.name }}</h3>
                  <span class="badge badge-source">第 {{ current.order }} 站</span>
                </div>
                <div class="tags">
                  <span v-for="t in current.place.tags.slice(0, 3)" :key="t" class="badge badge-source">{{ t }}</span>
                  <span class="badge badge-primary">{{ current.place.ticket ? `门票 ¥${current.place.ticket}` : '免费' }}</span>
                </div>
              </div>
            </div>

            <div class="leg row">
              <span class="row-start gap-1 t-sm">
                <span class="ms ms-16 num-primary">near_me</span>
                {{ legText }}
              </span>
              <span class="cite">开放 {{ fmt(current.place.open[0]) }}–{{ fmt(current.place.open[1]) }}</span>
            </div>

            <div class="acts">
              <button class="btn btn-ghost" type="button" @click="router.push('/facts')">
                <span class="ms ms-16">info</span>
                景点避坑
              </button>
              <button class="btn" type="button" @click="router.push('/trip')">
                <span class="ms ms-18">calendar_view_day</span>
                查看时间轴
              </button>
            </div>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.empty { display: flex; flex-direction: column; gap: 4px; text-align: center; }

.top { display: flex; flex-direction: column; gap: var(--sp-sm); padding-top: var(--sp-sm); }
.overview {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-sm);
  padding: 8px var(--sp-md);
  border-radius: var(--r-full);
}
.back { flex: none; }
.num-primary { color: var(--primary); }

.days { display: flex; gap: var(--sp-sm); overflow-x: auto; }
.day-chip {
  padding: 6px var(--sp-md);
  border-radius: var(--r-full);
  background: var(--surface-card);
  color: var(--ink-muted);
  font-size: 12px;
  font-weight: 700;
  flex: none;
  box-shadow: var(--shadow-sm);
}
.day-chip.on { background: var(--primary); color: var(--on-primary); }

.canvas {
  position: relative;
  height: 470px;
  margin-top: var(--sp-sm);
  background: var(--surface-sky);
  overflow: hidden;
}
.canvas-art {
  position: absolute;
  inset: 0;
  background: var(--surface-sky);
}
.map-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.canvas-art::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(248, 249, 255, 0.55) 0%, transparent 22%, transparent 78%, rgba(248, 249, 255, 0.75) 100%);
  pointer-events: none;
}
.trail { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.trail-line {
  fill: none;
  stroke: var(--primary);
  stroke-width: 2.5;
  stroke-dasharray: 7 6;
  stroke-linecap: round;
  opacity: 0.65;
}

.pin {
  position: absolute;
  transform: translate(-50%, -100%);
  z-index: 2;
}
.pin.on { z-index: 3; }
.pin-wrap { position: relative; display: flex; flex-direction: column; align-items: center; }
.pin-pulse {
  position: absolute;
  top: -6px;
  width: 46px;
  height: 46px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--primary) 25%, transparent);
  animation: ping 1.6s cubic-bezier(0, 0, 0.2, 1) infinite;
}
@keyframes ping {
  75%, 100% { transform: scale(1.9); opacity: 0; }
}
.pin-bubble {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: var(--r-full);
  background: color-mix(in srgb, var(--surface-card) 95%, transparent);
  box-shadow: var(--shadow-md);
  white-space: nowrap;
  z-index: 1;
}
.pin.on .pin-bubble { transform: scale(1.06); background: var(--surface-card); }
.pin-no {
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: var(--ink-muted);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  display: grid;
  place-items: center;
  flex: none;
}
.pin-no.on { background: var(--primary); width: 17px; height: 17px; }
.pin-name { font-size: 11px; line-height: 14px; font-weight: 700; color: var(--ink-strong); max-width: 108px; overflow: hidden; text-overflow: ellipsis; }
.pin-arrow {
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 6px solid var(--surface-card);
  margin-top: -1px;
}
.pin-icon {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--surface-card);
  color: var(--primary);
  display: grid;
  place-items: center;
  box-shadow: var(--shadow-sm);
  margin-top: 2px;
}
.pin-icon.on { width: 28px; height: 28px; background: var(--grad-tr); color: #fff; }

.route-pill {
  position: absolute;
  left: var(--sp-md);
  bottom: 12px;
  display: flex;
  align-items: center;
  gap: var(--sp-sm);
  padding: 6px 12px;
  border-radius: var(--r-full);
  background: rgba(15, 23, 42, 0.8);
  color: #fff;
}
.route-pill-icon { color: var(--brand-end); }

.pills-wrap { margin-top: -16px; position: relative; z-index: 4; }
.pills {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: var(--r-full);
  background: color-mix(in srgb, var(--surface-card) 95%, transparent);
  box-shadow: var(--shadow-md);
}
.pill {
  flex: 1;
  padding: 6px 12px;
  border-radius: var(--r-full);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 12px;
  line-height: 18px;
  color: var(--ink-muted);
}
.pill.on { background: var(--grad); color: #fff; font-weight: 700; }

.list { padding-top: var(--sp-md); }
.stop {
  display: flex;
  align-items: center;
  gap: var(--sp-sm);
  text-align: left;
  border-radius: var(--r-lg);
}
.stop.on { outline: 2px solid var(--primary-fixed); }

.detail-wrap { margin-top: var(--sp-md); }
.detail { border-radius: var(--r-lg); overflow: hidden; }
.detail-bar { height: 4px; background: var(--grad); }
.detail-body { padding: var(--sp-md); }
.thumb {
  width: 80px;
  height: 80px;
  border-radius: var(--r-md);
  overflow: hidden;
  background: var(--surface-container);
  flex: none;
}
.thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.tags { display: flex; flex-wrap: wrap; gap: 4px; }
.leg {
  padding: 8px var(--sp-md);
  border-radius: var(--r-md);
  background: var(--surface-container-low);
}
.acts { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-sm); }
.acts .btn { padding: 10px var(--sp-md); font-size: 13px; }
</style>
