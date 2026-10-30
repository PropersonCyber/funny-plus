import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }
  },
  server: {
    port: 5273,
    host: true,
    // 前端只认相对路径 /api，跨端部署时换反向代理即可，不用改代码
    proxy: { '/api': 'http://127.0.0.1:8787' }
  }
})
