<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<template>
  <header class="hdr">
    <div class="hdr-in">
      <div class="row-start gap-sm grow">
        <span class="mark"><span class="ms ms-18">auto_awesome</span></span>
        <div class="col grow">
          <div class="row-start gap-xs">
            <span class="t-md brand-name">趣哪玩儿 Funny+</span>
            <span class="badge badge-primary">AI</span>
          </div>
          <span class="cite">AI 旅行规划·动漫地图·真实避坑</span>
        </div>
      </div>
      <button class="avatar" aria-label="我的行程" @click="router.push('/profile')">
        <span class="ms ms-18">person</span>
      </button>
    </div>
  </header>
</template>

<style scoped>
.hdr {
  position: fixed;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 100%;
  max-width: 480px;
  z-index: 50;
  background: color-mix(in srgb, var(--surface) 85%, transparent);
  backdrop-filter: blur(18px);
  box-shadow: 0 1px 12px rgba(0, 0, 0, 0.03);
  padding-top: var(--safe-t);
}
.hdr-in {
  height: var(--header-h);
  padding: 0 var(--sp-lg);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-sm);
}
.logo {
  height: 32px;
  width: auto;
  object-fit: contain;
  flex: none;
}
/* Stitch 稿里的 logo 图是带鉴权的临时链接，取不到，改成同尺寸渐变标记 */
.mark {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: var(--grad-tr);
  color: #fff;
  display: grid;
  place-items: center;
  flex: none;
  box-shadow: var(--shadow-sm);
}
.brand-name {
  color: var(--ink-strong);
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
