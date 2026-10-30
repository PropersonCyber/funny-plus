<script setup lang="ts">
import { useRouter } from 'vue-router'
import { currentTrip, removeTrip, saveError, tripStore } from '@/stores/trip'

const router = useRouter()

function open(id: string) {
  tripStore.currentId = id
  router.push('/trip')
}

// 本机存档删了就没有第二份，先确认
function confirmRemove(id: string, label: string) {
  if (window.confirm(`删除「${label}」？本机存档删掉后无法恢复。`)) removeTrip(id)
}
</script>

<template>
  <div class="page">
    <div class="wrap col gap-md">
      <header class="col gap-1">
        <div class="row">
          <h1 class="t-lg">我的行程</h1>
          <button class="row-start gap-1 cite num-primary" type="button" @click="router.push('/create')">
            <span class="ms ms-16">add_circle</span>
            新建
          </button>
        </div>
        <p class="cite">行程存在本机浏览器，换设备或清缓存会丢。</p>
      </header>

      <p v-if="saveError" class="t-sm bad-text">{{ saveError }}</p>

      <div v-if="!tripStore.trips.length" class="card card-pad empty">
        <p class="t-body">还没有保存的行程。</p>
        <button class="btn" style="margin-top: 16px" @click="router.push('/create')">创建一次旅行</button>
      </div>

      <template v-else>
        <article
          v-for="t in tripStore.trips"
          :key="t.id"
          class="card card-pad trip col gap-sm"
          :class="{ current: t.id === currentTrip()?.id }"
        >
          <div class="row" @click="open(t.id)">
            <div class="row-start gap-sm grow">
              <span class="trip-icon"><span class="ms ms-20">travel_explore</span></span>
              <div class="col gap-1 grow">
                <div class="row-start gap-xs">
                  <span class="t-md">{{ t.plan.destination }}</span>
                  <span class="badge badge-primary">{{ t.plan.days.length }} 天</span>
                  <span v-if="t.id === currentTrip()?.id" class="badge badge-success">当前</span>
                </div>
                <span class="cite">
                  {{ t.demand.party }} 人 · 人均 ¥{{ t.plan.budget.perPerson.toLocaleString() }} · {{ t.versions.length }} 个版本
                </span>
              </div>
            </div>
            <span class="cite">{{ t.savedAt.slice(0, 10) }}</span>
          </div>
          <div class="row">
            <button type="button" class="row-start gap-1 cite num-primary" @click="open(t.id)">
              查看行程
              <span class="ms ms-14">chevron_right</span>
            </button>
            <button
              type="button"
              class="cite del"
              @click="confirmRemove(t.id, `${t.plan.destination} ${t.plan.days.length} 天`)"
            >
              删除
            </button>
          </div>
        </article>
      </template>

      <section class="card card-pad col gap-1">
        <span class="t-md">偏好与同行人</span>
        <p class="cite">首期不单独维护偏好档案，每次创建时按需填写，避免收集用不到的个人信息。</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.num-primary { color: var(--primary); }
.bad-text { color: var(--danger); }
.empty { display: flex; flex-direction: column; text-align: center; }

.trip { border-radius: var(--r-lg); }
.trip.current { outline: 2px solid var(--primary-fixed); }
.trip-icon {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--surface-sky);
  color: var(--primary);
  display: grid;
  place-items: center;
  flex: none;
}
.del { color: var(--danger); padding: 4px 8px; }
</style>
