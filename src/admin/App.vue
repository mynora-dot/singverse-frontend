<script setup lang="ts">
import { ElConfigProvider } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { useRoute } from 'vue-router'
import AdminLayout from './app/layouts/AdminLayout.vue'

const route = useRoute()
</script>

<template>
  <ElConfigProvider :locale="zhCn">
    <RouterView v-if="route.meta.public" />
    <AdminLayout v-else-if="route.matched.length" />
  </ElConfigProvider>
</template>
