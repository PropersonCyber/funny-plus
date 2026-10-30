import { createRouter, createWebHashHistory } from 'vue-router'

// hash 模式：构建产物可以直接丢静态托管打开，不用配 rewrite
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    // 新 UI 没有独立「发现」页，入口即创建行程
    { path: '/', redirect: '/create' },
    { path: '/create', name: 'create', component: () => import('@/views/CreateView.vue') },
    { path: '/compare', name: 'compare', component: () => import('@/views/CompareView.vue') },
    { path: '/trip', name: 'trip', component: () => import('@/views/TripView.vue') },
    { path: '/trip/map', name: 'map', component: () => import('@/views/MapView.vue') },
    { path: '/trip/advice', name: 'advice', component: () => import('@/views/AdviceView.vue') },
    { path: '/facts', name: 'facts', component: () => import('@/views/FactsView.vue') },
    // 「我的」挂右上角头像，底部导航里不再出现
    { path: '/profile', name: 'profile', component: () => import('@/views/ProfileView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/create' }
  ],
  scrollBehavior: () => ({ top: 0 })
})
