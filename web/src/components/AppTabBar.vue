<script setup lang="ts">
import { useRoute } from 'vue-router'

const route = useRoute()

const TABS = [
  { name: 'create', to: '/create', icon: 'add_circle', label: '创建行程' },
  { name: 'compare', to: '/compare', icon: 'compare_arrows', label: '方案比对' },
  { name: 'facts', to: '/facts', icon: 'shield', label: '避坑指南' },
  { name: 'trip', to: '/trip', icon: 'calendar_month', label: '逐日行程' }
]
const left = TABS.slice(0, 2)
const right = TABS.slice(2)

const active = (name: string) => route.name === name
</script>

<template>
  <nav class="tabbar">
    <div class="tabbar-in">
      <router-link v-for="t in left" :key="t.name" :to="t.to" :class="['tab', { on: active(t.name) }]">
        <span class="ms ms-22">{{ t.icon }}</span>
        <span class="t-badge">{{ t.label }}</span>
      </router-link>

      <router-link to="/trip/map" class="tab fab-slot">
        <span class="fab" :class="{ on: active('map') }">
          <span class="ms ms-24">map</span>
        </span>
        <span class="t-badge fab-label" :class="{ on: active('map') }">地图</span>
      </router-link>

      <router-link v-for="t in right" :key="t.name" :to="t.to" :class="['tab', { on: active(t.name) }]">
        <span class="ms ms-22">{{ t.icon }}</span>
        <span class="t-badge">{{ t.label }}</span>
      </router-link>
    </div>
  </nav>
</template>

<style scoped>
.tabbar {
  position: fixed;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 100%;
  max-width: 480px;
  z-index: 50;
  background: color-mix(in srgb, var(--surface-card) 95%, transparent);
  backdrop-filter: blur(12px);
  box-shadow: 0 -4px 20px rgba(15, 23, 42, 0.06);
  border-top: 1px solid var(--surface-container);
  padding-bottom: var(--safe-b);
}
.tabbar-in {
  height: var(--tabbar-h);
  padding: 0 var(--sp-xs);
  display: flex;
  align-items: flex-end;
  justify-content: space-around;
}
.tab {
  flex: 1;
  height: var(--tabbar-h);
  padding-bottom: 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  color: var(--ink-muted);
  transition: color 0.15s ease;
}
.tab.on {
  color: var(--primary);
  font-weight: 700;
}
.fab-slot {
  position: relative;
  top: -14px;
  justify-content: flex-start;
}
.fab {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--grad-tr);
  color: #fff;
  display: grid;
  place-items: center;
  box-shadow: var(--shadow-fab);
  transition: transform 0.15s ease;
}
.fab:active {
  transform: scale(0.94);
}
.fab-label {
  color: var(--ink-muted);
  margin-top: 4px;
}
.fab-label.on {
  color: var(--primary);
  font-weight: 700;
}
</style>
