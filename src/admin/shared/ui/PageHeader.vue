<script setup lang="ts">
/** 页面标题只承载对象名称、实际数量和操作；约束与反馈放在对应控件旁。 */
defineProps<{ title: string }>()
</script>

<template>
  <header class="page-heading sv-page-header" :class="{ 'has-controls': !!$slots.actions }">
    <div class="sv-page-header-copy">
      <h1>{{ title }}</h1>
      <slot name="meta" />
    </div>
    <div v-if="$slots.actions" class="sv-page-header-actions">
      <slot name="actions" />
    </div>
  </header>
</template>
