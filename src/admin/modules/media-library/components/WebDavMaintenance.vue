<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { ElAlert, ElButton, ElIcon, ElInput, ElMessage, ElMessageBox } from 'element-plus'
import { ArrowRight } from '@element-plus/icons-vue'
import { embeddedMetadata, embeddedState, type EmbeddedSummary } from '../api/embeddedMetadata'
import type { MediaSource, ScanTask } from '../types'

const props = defineProps<{
  source: MediaSource; summary?: EmbeddedSummary; task?: ScanTask; importing: boolean
  activeScan: boolean; scanStatus: string; scanError?: string; scanDisabled?: boolean; cancelling?: boolean
  profileName?: string; profileLoading?: boolean
}>()
const emit = defineEmits<{
  scan: []; cancelScan: []; edit: []; remove: []; recognition: []
  configured: [value: EmbeddedSummary]; updated: []
}>()
const busy = ref(false), error = ref('')
const origins = ref('')
const proxyId = useId()
const detailsId = useId()
const extractionDisabled = computed(() => props.importing || !props.summary || busy.value ||
  (props.summary.quality?.songs ?? props.summary.quality?.total) === 0)
const nodeIssue = computed(() => {
  const summary = props.summary
  if (summary?.enabled && !summary.paused && !summary.remoteReady && summary.nodeStatus !== 'NOT_CHECKED') return summary.nodeMessage
})
const metrics = computed(() => {
  const { summary, task } = props
  const items: { label: string; value: string | number }[] = []
  const quality = summary?.quality
  if (quality) items.push(
    { label: '版本', value: quality.variants ?? quality.total },
    { label: '媒体文件', value: quality.files ?? quality.total },
    { label: '歌名和歌手齐全', value: `${quality.identityComplete} 首` },
  )
  if (task) items.push(
    { label: '已扫描目录', value: task.directories },
    { label: '已扫描条目', value: task.entries },
    { label: '已扫描歌曲', value: `${task.totalSongs} 首` },
    { label: '文件名待复核', value: `${task.needsReviewSongs} 首` },
  )
  if (task?.status === 'SUCCEEDED') items.push(
    { label: '新增', value: task.addedSongs ?? 0 },
    { label: '复用', value: task.reusedSongs ?? 0 },
    { label: '待确认删除', value: task.missingSongs ?? 0 },
    { label: '下架', value: task.removedSongs ?? 0 },
  )
  const files = summary?.files
  if (files?.pending) items.push({ label: '衍生文件生成中', value: files.pending })
  if (files?.failed) items.push({ label: '衍生文件待重试', value: files.failed })
  if (files?.attachments) items.push({ label: '封面待补齐', value: files.attachments })
  const budget = summary?.budget
  if (budget && (budget.files_started || budget.bytes_read)) items.push(
    { label: '今日提取', value: `${budget.files_started} 首` },
    { label: '今日读取', value: `${(budget.bytes_read / 1048576).toFixed(1)} MiB` },
  )
  return items
})
watch(() => !!props.summary, ready => {
  if (ready) origins.value = (props.summary!.privateOrigins ?? []).join('\n')
}, { immediate: true })

async function perform(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true; error.value = ''
  try { await action() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '操作失败，请重试' }
  finally { busy.value = false }
}
function save(toggle: boolean) {
  const saved = props.summary
  if (!saved || toggle && extractionDisabled.value) return
  void perform(async () => {
    const settings = toggle
      ? { enabled: true, paused: saved.enabled && !saved.paused }
      : { enabled: saved.enabled, paused: saved.paused, privateOrigins: origins.value.split('\n').map(v => v.trim()).filter(Boolean) }
    emit('configured', await embeddedMetadata.configure(props.source.id, settings))
    ElMessage.success('已保存')
  })
}
async function confirmEmpty() {
  if (busy.value) return
  try {
    await ElMessageBox.confirm('确认下架此来源的全部歌曲？原始媒体不受影响，索引缓存保留 30 天。', '确认空库同步', { confirmButtonText: '全部下架', cancelButtonText: '取消', type: 'warning' })
  } catch { return }
  await perform(async () => { await embeddedMetadata.confirmEmpty(props.source.id); emit('updated') })
}
</script>
<template>
  <div class="maintenance">
    <div class="controls task-actions" role="group" aria-label="曲库操作">
      <ElButton type="primary" :disabled="scanDisabled || importing || activeScan || busy" @click="emit('scan')">重新扫描歌曲</ElButton>
      <ElButton :disabled="extractionDisabled" @click="save(true)">{{ summary?.paused ? '继续自动提取' : summary?.enabled ? '暂停自动提取' : '开始自动提取' }}</ElButton>
      <ElButton v-if="activeScan && task?.phase === 'SCANNING'" :loading="cancelling" :disabled="task.cancelRequested" @click="emit('cancelScan')">取消扫描</ElButton>
    </div>
    <div v-if="error || scanError || summary?.blockedReason || nodeIssue" class="alerts">
      <ElAlert v-if="error" :title="error" type="error" :closable="false" />
      <ElAlert v-if="scanError" :title="scanError" type="error" :closable="false" />
      <ElAlert v-if="summary?.blockedReason" :title="embeddedState(summary.blockedReason)" type="warning" :closable="false" />
      <ElAlert v-if="nodeIssue" :title="nodeIssue" type="warning" :closable="false" />
    </div>
    <div class="maintenance-options">
      <details class="maintenance-option">
        <summary :aria-labelledby="detailsId" :aria-describedby="detailsId + '-status'">
          <span :id="detailsId">运行详情</span>
          <span :id="detailsId + '-status'" class="scan-status" role="status">
            <span v-if="scanStatus">{{ scanStatus }}</span>
            <span v-if="activeScan && task?.totalSongs">{{ task.totalSongs }} 首</span>
          </span>
          <ElIcon aria-hidden="true"><ArrowRight /></ElIcon>
        </summary>
        <dl class="metrics" aria-label="曲库运行数据">
          <div>
            <dt>{{ source.nextScanAt ? '下次扫描' : '定时扫描' }}</dt>
            <dd>
              <time v-if="source.nextScanAt" :datetime="source.nextScanAt">{{ new Date(source.nextScanAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'short' }) }}</time>
              <template v-else>{{ source.scanEnabled ? '开启' : '关闭' }}</template>
            </dd>
          </div>
          <div v-if="profileName && !profileLoading"><dt>解析方案</dt><dd>{{ profileName }}</dd></div>
          <div v-for="{ label, value } in metrics" :key="label"><dt>{{ label }}</dt><dd>{{ value }}</dd></div>
        </dl>
      </details>
      <ElButton class="setting-link" text :disabled="profileLoading" @click="emit('recognition')">
        文件名识别<ElIcon aria-hidden="true"><ArrowRight /></ElIcon>
      </ElButton>
      <details class="maintenance-option">
        <summary>私有下载代理<ElIcon aria-hidden="true"><ArrowRight /></ElIcon></summary>
        <form class="proxy-form" @submit.prevent="save(false)">
          <label :for="proxyId">代理地址（每行一个）</label>
          <ElInput :id="proxyId" v-model="origins" type="textarea" :rows="2" />
          <ElButton native-type="submit" :disabled="busy || !summary">保存代理设置</ElButton>
        </form>
      </details>
    </div>
    <div class="controls source-settings" role="group" aria-label="来源操作">
      <ElButton text aria-label="编辑来源" @click="emit('edit')">编辑</ElButton>
      <ElButton v-if="summary?.canConfirmEmpty" type="danger" plain :disabled="busy || importing" @click="confirmEmpty">确认空库同步</ElButton>
      <ElButton class="remove-source" type="danger" text aria-label="移除来源" @click="emit('remove')">移除</ElButton>
    </div>
  </div>
</template>
<style scoped>
.maintenance { display:grid; gap:16px; }
.alerts { display:grid; gap:8px; }
.controls { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
.controls .el-button, .proxy-form .el-button {
  max-width:100%; min-height:44px; height:auto; margin:0; white-space:normal; line-height:1.5;
}
.maintenance-options { border-block:1px solid var(--sv-border-subtle); }
.maintenance-options > * + * { border-top:1px solid var(--sv-border-subtle); }
.maintenance-option > summary, .setting-link.el-button {
  display:flex; align-items:center; justify-content:space-between; gap:8px;
  width:100%; min-height:48px; margin:0; padding:8px 4px;
  color:var(--sv-text-primary); font-size:14px; font-weight:500; cursor:pointer;
}
.maintenance-option > summary { list-style:none; }
.maintenance-option > summary::-webkit-details-marker { display:none; }
.maintenance-option[open] > summary .el-icon { transform:rotate(90deg); }
.maintenance-option > summary:focus-visible { outline:2px solid var(--sv-accent-primary); outline-offset:-2px; }
.maintenance-option > summary:hover { background:var(--sv-surface-3); }
.setting-link.el-button { border-inline:0; border-bottom:0; border-radius:0; }
.setting-link :deep(span) { display:flex; width:100%; align-items:center; justify-content:space-between; }
.maintenance-option .el-icon, .setting-link .el-icon { flex:none; color:var(--sv-text-secondary); }
.scan-status { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:0 8px; margin-inline-start:auto; color:var(--sv-text-secondary); font-weight:400; }
.metrics { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:0 20px; margin:0; padding:4px 4px 12px; }
.metrics > div { display:flex; align-items:baseline; justify-content:space-between; gap:8px; padding-block:4px; }
.metrics dt { color:var(--sv-text-secondary); }
.metrics dd { margin:0; text-align:end; color:var(--sv-text-primary); font-variant-numeric:tabular-nums; }
.proxy-form { display:grid; justify-items:start; gap:8px; padding:8px 4px 16px; }
.source-settings .remove-source { margin-inline-start:auto; }
@media(max-width:480px) { .metrics { grid-template-columns:minmax(0, 1fr); } }
@media(max-width:420px) {
  .maintenance { gap:12px; }
  .task-actions .el-button { flex:1 1 auto; padding-inline:12px; }
}
</style>
