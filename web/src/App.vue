<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import AppHeader from '@/components/AppHeader.vue'
import AppTabBar from '@/components/AppTabBar.vue'

const route = useRoute()
// 对比页是从创建页进来的中间步骤，隐藏底部导航保持沉浸
const showTabs = computed(() => String(route.name) !== 'compare')
</script>

<template>
  <AppHeader />
  <router-view v-slot="{ Component }">
    <transition name="fade" mode="out-in">
      <component :is="Component" />
    </transition>
  </router-view>
  <AppTabBar v-if="showTabs" />
</template>
