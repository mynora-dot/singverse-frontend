<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { ElButton } from 'element-plus'
import { backgroundTasks, type BackgroundTask } from '../../background-tasks/api'
import { statusNames, progressText, stageName, activeTask } from '../../background-tasks/presentation'
const props = defineProps<{ ids: string[] }>()
const tasks = ref<BackgroundTask[]>([]), errors = ref<string[]>([])
let generation = 0, timer: ReturnType<typeof setTimeout> | undefined
async function refresh(token = generation) {
  clearTimeout(timer)
  const result = await Promise.allSettled(props.ids.map(id => backgroundTasks.detail(id)))
  if (token !== generation) return
  tasks.value = result.flatMap(r => r.status === 'fulfilled' ? [r.value] : [])
  errors.value = result.flatMap((r, i) => r.status === 'rejected' ? [props.ids[i]!] : [])
  if (tasks.value.some(t => activeTask(t.status)) || errors.value.length) timer = setTimeout(() => { if (!document.hidden) void refresh(token); else timer = setTimeout(() => void refresh(token), 5000) }, 5000)
}
watch(() => props.ids.join(','), () => { const token = ++generation; tasks.value = []; errors.value = []; clearTimeout(timer); if (props.ids.length) void refresh(token) }, { immediate: true })
onBeforeUnmount(() => { generation++; clearTimeout(timer) })
function percent(task: BackgroundTask) { return task.progress.percent == null ? undefined : Math.max(0, Math.min(100, task.progress.percent)) }
function page(task: BackgroundTask) { return /^\/(library|system)(\/|$)/.test(task.relatedPath) ? task.relatedPath : '/system/tasks' }
</script>
<template>
  <section v-if="ids.length" class="assistant-tasks" aria-label="业务任务进度">
    <header><h3>业务任务进度</h3><span>停止对话后仍继续</span></header>
    <article v-for="task in tasks" :key="task.id" class="assistant-task">
      <div class="task-title"><strong>{{ task.name }}</strong><span>{{ statusNames[task.status] || task.status }}</span></div>
      <p>{{ stageName(task.stage) }} · {{ progressText(task) }}</p>
      <progress v-if="percent(task) !== undefined" :value="percent(task)" max="100" :aria-label="`${task.name}进度`" />
      <p v-if="task.waitingReason || task.error" role="status">{{ task.error || task.waitingReason }}</p>
      <RouterLink :to="page(task)">查看任务与逐项结果</RouterLink>
      <details><summary>查看任务标识</summary><code>{{ task.id }}</code></details>
    </article>
    <p v-if="errors.length" class="task-error" role="status">{{ errors.length }} 项任务进度暂时无法读取。<ElButton text @click="refresh()">重新读取</ElButton><RouterLink to="/system/tasks">打开任务中心</RouterLink></p>
  </section>
</template>
<style scoped>
.assistant-tasks{padding:20px 24px;margin-bottom:20px;background:var(--sv-surface-1);border:1px solid var(--sv-border-default);border-radius:12px}.assistant-tasks header,.task-title{display:flex;align-items:center;justify-content:space-between;gap:12px}.assistant-tasks h3{font-size:15px;margin:0}.assistant-tasks header>span,.task-title>span{font-size:12px;color:var(--sv-text-secondary)}.assistant-task{padding:18px 0 4px}.assistant-task+.assistant-task{border-top:1px solid var(--sv-border-subtle);margin-top:14px}.task-title{font-size:14px}.task-title strong{font-weight:550}.assistant-task p,.task-error{font-size:14px;color:var(--sv-text-secondary);line-height:1.7;margin:10px 0}.assistant-task progress{display:block;width:100%;height:6px;accent-color:var(--sv-accent-primary)}.assistant-task a,.task-error a{display:inline-flex;align-items:center;font-size:13px;min-height:44px}.assistant-task details{font-size:12px;color:var(--sv-text-secondary)}.assistant-task summary{display:flex;align-items:center;min-height:44px;cursor:pointer}.assistant-task code{display:block;overflow-wrap:anywhere}.task-error .el-button{min-height:44px}@media(max-width:600px){.assistant-tasks{padding:18px}.assistant-tasks header{align-items:flex-start;flex-direction:column;gap:8px}}
</style>
