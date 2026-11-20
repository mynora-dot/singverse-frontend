<script setup lang="ts">
import { ElIcon } from 'element-plus'
import { Headset } from '@element-plus/icons-vue'
</script>
<template>
  <section class="not-found"><span class="not-found-code">404</span><span class="not-found-icon"><ElIcon><Headset /></ElIcon></span><h1>页面不存在</h1><RouterLink to="/overview" class="text-link">返回概览</RouterLink></section>
</template>
<style scoped>
.not-found { display: flex; flex-direction: column; align-items: center; padding: 60px 24px; text-align: center; background: var(--sv-surface-2); border: 1px solid var(--sv-border-subtle); border-radius: var(--sv-radius-lg); }.not-found-code { font: 64px var(--sv-font-mono); color: var(--sv-border-default); letter-spacing: 8px; }.not-found-icon { font-size: 32px; margin: 24px; color: var(--sv-accent-primary); }.not-found h1 { font-size: 24px; }.not-found .text-link { margin-top: 24px; }
</style>
