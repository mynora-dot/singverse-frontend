<script setup lang="ts">
import { ref } from 'vue'
import { ElButton, ElIcon } from 'element-plus'
import { Check, Warning, Close } from '@element-plus/icons-vue'
import { assistantApi } from '../api'
import { assistantState, decideOperation, activeRun } from '../state'
import type { Operation } from '../types'
import ResultContent from './ResultContent.vue'
const props = defineProps<{ operation: Operation }>()
const labels: Record<string, string> = { PENDING: '等待你确认', APPROVED: '已确认，等待执行', EXECUTING: '正在执行', SUCCEEDED: '执行完成', FAILED: '执行失败', STALE: '原确认已失效', REJECTED: '已拒绝', UNCERTAIN: '执行结果需要核对' }
const evidence = ref<unknown>(), checking = ref(false), error = ref('')
async function reconcile() { checking.value = true; error.value = ''; try { evidence.value = await assistantApi.reconcile(props.operation.runId, props.operation.id) } catch (e) { error.value = e instanceof Error ? e.message : '核对失败' } finally { checking.value = false } }
</script>
<template>
  <article class="operation-card" :class="operation.state.toLowerCase()" :aria-label="operation.preview.summary">
    <header><span class="operation-icon"><ElIcon><Check v-if="operation.state === 'SUCCEEDED'" /><Close v-else-if="operation.state === 'REJECTED'" /><Warning v-else /></ElIcon></span><div><span class="operation-state">{{ labels[operation.state] ?? operation.state }}</span><h3>{{ operation.preview.summary }}</h3></div></header>
    <div class="operation-section changes"><h4>将进行的改动</h4><ResultContent :value="operation.preview.changes" /></div>
    <p class="operation-impact">{{ operation.preview.impact }}</p>
    <div class="operation-section target-heading"><h4>操作对象</h4></div>
    <div class="operation-body" tabindex="0" aria-label="操作对象详情，可滚动查看"><ResultContent :value="operation.preview.targets" /></div>
    <p v-if="operation.error" class="operation-error" role="status">{{ operation.error }}</p>
    <div v-if="operation.state === 'PENDING'" class="operation-actions"><ElButton type="primary" :disabled="assistantState.busy || activeRun?.status !== 'WAITING'" @click="decideOperation(operation, true)">确认执行</ElButton><ElButton :disabled="assistantState.busy || activeRun?.status !== 'WAITING'" @click="decideOperation(operation, false)">拒绝</ElButton><small v-if="activeRun?.status === 'RUNNING'" role="status">正在保存确认内容…</small></div>
    <ResultContent v-if="operation.result != null" :value="operation.result" />
    <div class="operation-footer"><RouterLink v-if="operation.preview.page" :to="operation.preview.page">打开业务页面</RouterLink><ElButton v-if="operation.state === 'UNCERTAIN'" text :loading="checking" @click="reconcile">核对业务结果</ElButton></div>
    <p v-if="error" role="alert">{{ error }}</p><ResultContent v-if="evidence" :value="evidence" />
  </article>
</template>
<style scoped>
.pending .operation-actions{position:sticky;bottom:0;z-index:1;padding:12px 0 6px;background:var(--sv-surface-1);border-top:1px solid var(--sv-border-subtle)}
.operation-body{margin-top:4px}.pending .operation-body{max-height:160px;overflow:auto;overscroll-behavior:contain;padding-right:10px;scrollbar-gutter:stable;border-bottom:1px solid var(--sv-border-subtle)}.operation-body:focus-visible{outline:2px solid var(--sv-accent-primary);outline-offset:4px}.operation-card .changes{margin-top:16px;padding:10px 14px}.changes :deep(dl){grid-template-columns:56px minmax(0,1fr);margin:6px 0;gap:3px 12px}.operation-body :deep(.result-items li){padding:8px 0}.target-heading h4{display:flex;justify-content:space-between;gap:12px}.operation-card .operation-impact{margin:10px 0;line-height:1.6}.operation-card .operation-section{margin-top:12px}.operation-card .operation-footer{margin-top:4px}.operation-card .operation-actions{margin-top:14px}
.operation-card{border:1px solid var(--sv-border-default);background:var(--sv-surface-1);border-radius:12px;padding:24px;margin-bottom:20px}.operation-card.pending{border-color:var(--sv-accent-primary)}header{display:flex;align-items:center;gap:12px}.operation-icon{width:40px;height:40px;display:grid;place-items:center;flex-shrink:0;background:var(--sv-accent-soft);color:var(--sv-accent-primary);border-radius:10px}.operation-icon .el-icon{font-size:20px}.operation-state{font-size:12px;color:var(--sv-text-secondary)}h3{font-size:17px;line-height:1.5;margin:4px 0 0;overflow-wrap:anywhere}.operation-section{margin-top:22px}.operation-section h4{margin:0 0 4px;font-size:12px;font-weight:600;color:var(--sv-text-secondary)}.changes{padding:16px;background:var(--sv-surface-2);border-radius:8px}.operation-impact{font-size:13px;color:var(--sv-text-secondary);line-height:1.8;margin-top:16px}.operation-error{color:var(--sv-text-primary);font-size:14px;padding:12px;background:var(--sv-surface-2);border-radius:8px}.operation-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:20px}.operation-actions .el-button{margin:0;min-height:44px}.operation-actions small{width:100%;font-size:12px;color:var(--sv-text-secondary);line-height:1.6}.operation-footer{display:flex;gap:16px;align-items:center;margin-top:16px;font-size:13px}.operation-footer a{display:inline-flex;align-items:center;min-height:44px}@media(max-width:600px){.operation-card{padding:18px}.operation-actions>.el-button{flex:1}}
</style>
