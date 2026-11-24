<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElAlert, ElButton, ElDialog, ElProgress } from 'element-plus'
import { embeddedMetadata, type EmbeddedSummary } from '../api/embeddedMetadata'
import { media } from '../api/media'
import type { MediaSource } from '../types'
import { useSourceShare } from '../source-share'
import { useVisiblePolling } from '../../../shared/composables/use-visible-polling'

const props = defineProps<{ source: MediaSource }>()
const emit = defineEmits<{ close: []; songs: []; updated: [] }>()
const { job, download, active, progress, busy, error: shareError, start } = useSourceShare(props.source.id)
const summary = ref<EmbeddedSummary>(), error = ref(''), scanning = ref(false), advanced = ref(false)
function toggle(event: Event) { advanced.value = (event.target as HTMLDetailsElement).open }
const total = computed(() => summary.value?.quality?.songs ?? summary.value?.quality?.total ?? Object.values(summary.value?.counts ?? {}).reduce((a,b) => a + b, 0))
const polling = useVisiblePolling(async () => {
  try { summary.value = await embeddedMetadata.summary(props.source.id); error.value = '' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '读取状态失败' }
}, () => summary.value?.files?.pending ? 2000 : 10000)
async function scan() {
  if (scanning.value) return
  scanning.value = true
  try { await media.scan(props.source.id); await polling.refresh(); emit('updated') }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '扫描失败' }
  finally { scanning.value = false }
}
</script>
<template>
  <ElDialog :model-value="true" :title="source.name + ' · 资料管理'" width="min(640px, calc(100vw - 24px))" class="library-workflow-dialog" :close-on-click-modal="false" @close="emit('close')">
    <ElAlert v-if="error || shareError" :title="error || shareError" type="error" :closable="false" />
    <section class="library-overview"><div class="action-row overview-row">
      <h3>{{ summary ? '共 ' + total.toLocaleString() + ' 首歌曲' : '正在加载…' }}</h3>
      <ElButton v-if="!total" type="primary" :loading="scanning" :disabled="!summary" @click="scan">扫描歌曲</ElButton>
      <ElButton v-else @click="emit('songs')">查看歌曲</ElButton>
    </div>
    <ul v-if="summary?.quality && (summary.quality.informationMissing || summary.quality.pendingVerification || summary.quality.mediaIssues)" class="quality-issues" aria-label="待处理事项">
      <li v-if="summary.quality.informationMissing">{{ summary.quality.informationMissing }} 首信息不足</li>
      <li v-if="summary.quality.pendingVerification">{{ summary.quality.pendingVerification }} 个路径待核验</li>
      <li v-if="summary.quality.mediaIssues">{{ summary.quality.mediaIssues }} 项媒体待处理</li>
    </ul></section>
    <section class="action-section">
      <div class="action-row"><h3>导出曲库资料</h3>
        <ElButton v-if="!job || job.state === 'FAILED'" type="primary" :loading="busy" :disabled="!total" @click="start()">{{ job?.state === 'FAILED' ? '重试' : '导出分享包' }}</ElButton>
        <ElButton v-else-if="active" loading disabled>正在准备</ElButton>
        <a v-else-if="download" class="primary-action" :href="download" download="singverse-share-set.zip">下载分享包</a>
      </div>
      <ElProgress v-if="active" :percentage="progress" :indeterminate="job?.state === 'WAITING'" />
      <p v-if="job?.state === 'FAILED'" role="status">分享包准备失败，请重试。</p>
      <div v-if="job?.state === 'SUCCEEDED'" class="ready-status"><span>分享包已准备好</span><ElButton text :disabled="busy" @click="start()">重新导出</ElButton></div>
    </section>
    <details class="advanced-options" @toggle.self="toggle"><summary>高级选项</summary>
      <div v-if="advanced" class="advanced-content"><div class="advanced-actions">
      <ElButton :loading="scanning" @click="scan">重新扫描歌曲</ElButton>
      <ElButton v-if="job?.state === 'SUCCEEDED'" :disabled="busy || active" @click="start(true)">仅分享新增和变化</ElButton></div>
      <p v-if="summary?.files">衍生文件：{{ summary.files.pending ? '等待处理 ' + summary.files.pending + ' 首' : '已完成' }}<span v-if="summary.files.failed">，{{ summary.files.failed }} 首待重新生成</span><span v-if="summary.files.attachments">，封面待补齐</span>。</p>
      </div>
    </details>
    <template #footer><ElButton @click="emit('close')">关闭</ElButton></template>
  </ElDialog>
</template>
<style scoped>
.library-overview { padding-bottom: 16px; }
.action-section, .action-row { min-width: 0; }
.action-section, .advanced-options { border-top: 1px solid var(--sv-border-subtle); }
.action-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 0; }
.overview-row { padding: 0; }
.action-row > div { min-width: 0; }
.action-row > .el-button, .primary-action { flex-shrink: 0; }
.quality-issues { display: flex; flex-wrap: wrap; gap: 6px 12px; margin: 12px 0 0; padding: 0; list-style: none; color: var(--sv-semantic-warn); font-size: 13px; line-height: 1.7; }
h3 { margin: 0; color: var(--sv-text-primary); font-size: 16px; line-height: 1.5; }
p { margin: 0; color: var(--sv-text-secondary); font-size: 14px; line-height: 1.6; }
h3 + p { margin-top: 4px; }
.primary-action { display: inline-flex; align-items: center; justify-content: center; min-height: 40px; padding: 0 16px; border-radius: var(--el-border-radius-base); background: var(--sv-accent-primary); color: var(--sv-on-accent); font-size: 14px; font-weight: 500; text-decoration: none; }
.primary-action:focus-visible { outline: 2px solid var(--sv-accent-primary); outline-offset: 3px; }
.ready-status { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 12px; }
.advanced-options { padding-top: 12px; color: var(--sv-text-secondary); font-size: 14px; }
summary { min-height: 28px; line-height: 28px; cursor: pointer; }
.advanced-content { padding-top: 8px; }
.advanced-content p { margin: 12px 0; }
.advanced-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.advanced-actions .el-button { margin: 0; }
:global(.library-workflow-dialog.el-dialog) { display: flex; flex-direction: column; max-height: 90dvh; }
:global(.library-workflow-dialog > .el-dialog__header), :global(.library-workflow-dialog > .el-dialog__footer) { flex-shrink: 0; }
:global(.library-workflow-dialog > .el-dialog__body) { min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
@media (max-width: 768px) {
  .action-row > .el-button, .primary-action, summary { min-height: 44px; }
  .ready-status { align-items: flex-start; flex-wrap: wrap; }
}
</style>
