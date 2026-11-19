<script setup lang="ts">
import { platforms } from './api'
defineProps<{ platform: string; compact?: boolean }>()
const icons: Record<string, string> = { wy: 'netease', tx: 'qq', kg: 'kugou', kw: 'kuwo', mg: 'migu', qs: 'qishui' }
</script>
<template><span class="platform-badge"><img v-if="icons[platform]" :src="`/assets/music-platforms/${icons[platform]}.png`" alt="" width="18" height="18" /><span v-if="!compact">{{ platforms[platform] || platform }}</span></span></template>
<style scoped>.platform-badge{display:inline-flex;align-items:center;gap:7px;min-width:0;white-space:nowrap;font-size:12px;color:var(--el-text-color-regular)}img{flex:none;object-fit:contain;border-radius:4px}</style>
