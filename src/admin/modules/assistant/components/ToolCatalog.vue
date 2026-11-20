<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElInput, ElTag } from 'element-plus'
import type { ToolDefinition } from '../types'
const props = defineProps<{ tools: ToolDefinition[] }>()
const query = ref('')
const groups = computed(() => {
  const result = new Map<string, ToolDefinition[]>()
  for (const tool of props.tools.filter(t => `${t.title} ${t.description} ${t.group}`.includes(query.value.trim()))) result.set(tool.group, [...(result.get(tool.group) ?? []), tool])
  return [...result]
})
</script>
<template><div class="tool-catalog"><ElInput v-model="query" placeholder="搜索工具或业务功能" aria-label="搜索工具目录" clearable /><div class="tool-catalog-scroll"><section v-for="([group, entries]) in groups" :key="group"><h3>{{ group }}<small>{{ entries.length }}</small></h3><article v-for="tool in entries" :key="tool.name"><div><strong>{{ tool.title }}</strong><ElTag v-if="tool.write" size="small" type="warning">需要确认</ElTag></div><p>{{ tool.description }}</p><RouterLink :to="tool.page">打开页面</RouterLink></article></section><p v-if="!groups.length">没有符合条件的工具。</p></div></div></template>
<style scoped>
.tool-catalog{font-size:14px;line-height:1.8}.tool-catalog-scroll{max-height:55dvh;overflow:auto}.tool-catalog h3{display:flex;gap:10px;align-items:center;font-size:16px;margin:24px 0 8px}.tool-catalog h3 small{font-size:12px;font-weight:400;color:var(--sv-text-secondary)}.tool-catalog article{border-bottom:1px solid var(--sv-border-subtle);padding:16px 0}.tool-catalog article>div{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.tool-catalog strong{font-weight:550}.tool-catalog article p{margin:8px 0 0;color:var(--sv-text-secondary);font-size:13px}.tool-catalog article a{display:inline-flex;align-items:center;min-height:44px;font-size:13px}
</style>
