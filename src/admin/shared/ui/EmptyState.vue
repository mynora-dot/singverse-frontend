<script setup lang="ts">
import type { Component } from 'vue'
import { ElIcon } from 'element-plus'
/** 空态保留对象状态和可执行的下一步。 */
defineProps<{ title: string; icon?: Component }>()
</script>

<template>
  <div class="empty-state">
    <div class="empty-disc" aria-hidden="true"><span class="empty-disc-label"><ElIcon v-if="icon" :size="26"><component :is="icon" /></ElIcon></span></div>
    <h3 class="empty-title">{{ title }}</h3>
    <div v-if="$slots.action" class="empty-action"><slot name="action" /></div>
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 48px 24px;
  gap: 4px;
}

.empty-disc {
  display: grid;
  place-items: center;
  width: 96px;
  height: 96px;
  margin-bottom: 16px;
  border-radius: 50%;
  background: var(--sv-record-groove), var(--sv-surface-3);
  border: 1px solid var(--sv-border-subtle);
}

.empty-disc-label {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--sv-surface-2);
  border: 1px solid var(--sv-border-default);
  color: var(--sv-accent-primary);
}

.empty-title {
  font: 600 17px/1.5 var(--sv-font-sans);
  color: var(--sv-text-primary);
}

.empty-action {
  margin-top: 20px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: center;
}
</style>