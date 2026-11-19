<script setup lang="ts">
import { ref, watch } from 'vue'
import { Headset } from '@element-plus/icons-vue'
const props = defineProps<{ url?: string }>()
const failed = ref(false)
watch(() => props.url, () => { failed.value = false })
</script>
<template><span class="artwork"><img v-if="url && !failed" :src="url" alt="" referrerpolicy="no-referrer" loading="lazy" @error="failed = true" /><Headset v-else aria-hidden="true" /></span></template>
<style scoped>.artwork{display:flex;align-items:center;justify-content:center;width:56px;height:56px;flex:none;overflow:hidden;border-radius:9px;background:var(--el-fill-color-light);color:var(--el-text-color-secondary)}img{width:100%;height:100%;object-fit:cover}svg{width:23px;height:23px}</style>
