import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { fetchPlaces } from './api/catalog'
import { setPlaces } from './lib/placeIndex'
import { importExamples } from './stores/trip'
import './styles/base.css'

// 引擎是同步纯函数，必须在挂载前把地点池灌进去；取不到就照样挂载，
// 由 generatePlans 提示「地点数据还没取到」，不能让路由白屏。
async function bootstrap() {
  try {
    setPlaces(await fetchPlaces())
  } catch (e) {
    console.error('[places] 地点池预热失败', e)
  }
  await importExamples()
  createApp(App).use(router).mount('#app')
}

void bootstrap()
