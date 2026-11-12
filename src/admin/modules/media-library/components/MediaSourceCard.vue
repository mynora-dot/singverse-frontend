<script setup lang="ts">
import { computed } from 'vue'
import { ElButton, ElCard, ElDropdown, ElDropdownItem, ElDropdownMenu, ElIcon, ElTag } from 'element-plus'
import { ArrowRight, Clock, Delete, Edit, FolderOpened, Loading, MoreFilled, RefreshRight, Share, Warning } from '@element-plus/icons-vue'
import StatusBadge from '../../../shared/ui/StatusBadge.vue'
import type { EmbeddedSummary } from '../api/embeddedMetadata'
import type { MediaSource, ScanTask } from '../types'

const props = defineProps<{
  source: MediaSource
  summary?: EmbeddedSummary
  ingest?: { state: string; error?: string }
  task?: ScanTask
  taskError?: string
  localResult?: { totalSongs: number; needsReviewSongs: number }
  scanDisabled?: boolean
  cancelling?: boolean
  profileLoading?: boolean
  profileName: string
}>()
const menuPopperOptions = { modifiers: [
  { name: 'flip', options: { fallbackPlacements: ['top-end', 'bottom-end'], padding: 12 } },
  { name: 'preventOverflow', options: { padding: 12 } },
] }
defineEmits<{
  songs: []
  metadata: []
  recognition: []
  scan: []
  cancelScan: []
  edit: []
  remove: []
}>()

const location = computed(() => {
  if (props.source.type !== 'WEBDAV') return props.source.location
  try { return decodeURI(props.source.location) } catch { return props.source.location }
})
const activeScan = computed(() => !!props.task && ['QUEUED', 'RUNNING'].includes(props.task.status))
const activeIngest = computed(() => ['QUEUED', 'RUNNING'].includes(props.ingest?.state ?? ''))
const status = computed<{ label: string; tone: 'ok' | 'warn' | 'danger' | 'busy' | 'neutral' }>(() => {
  if (activeIngest.value) return { label: props.ingest?.state === 'QUEUED' ? '等待后台入库' : '正在后台入库', tone: 'busy' }
  const task = props.task
  if (task) {
    if (activeScan.value && task.cancelRequested) return { label: '正在取消', tone: 'busy' }
    if (activeScan.value && task.phase === 'COMMITTING') return { label: '正在提交索引', tone: 'busy' }
    return ({
      QUEUED: { label: '排队中', tone: 'busy' },
      RUNNING: { label: '正在扫描目录', tone: 'busy' },
      SUCCEEDED: { label: '扫描完成', tone: 'ok' },
      FAILED: { label: '扫描失败', tone: 'danger' },
      CANCELLED: { label: '已取消', tone: 'neutral' },
      INTERRUPTED: { label: '已中断', tone: 'warn' },
    } as const)[task.status]
  }
  if (props.localResult) return { label: '扫描完成', tone: 'ok' }
  return { label: props.source.type === 'WEBDAV' ? '已配置 · 按需连接' : '已配置 · 可扫描歌曲', tone: 'neutral' }
})
const quality = computed(() => props.summary?.quality)
const metrics = computed(() => {
  const value = quality.value
  if (!value) return []
  return [
    { label: '已入库歌曲', value: value.songs ?? value.total },
    { label: '歌曲版本', value: value.variants ?? value.total },
    { label: '媒体文件', value: value.files ?? value.total },
    { label: '歌名和歌手齐全', value: value.identityComplete },
  ]
})
const issues = computed(() => {
  const value = quality.value
  if (!value) return []
  return [
    { count: value.informationMissing, label: '首歌曲信息不足' },
    { count: value.pendingVerification, label: '个路径待核验' },
    { count: value.mediaIssues, label: '项媒体待处理' },
  ].filter(issue => issue.count > 0)
})
const enhancingCount = computed(() => (props.summary?.counts.RUNNING ?? 0) + (props.summary?.counts.QUEUED ?? 0))
const nextScan = computed(() => props.source.nextScanAt ? new Date(props.source.nextScanAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '')
const scanErrors = computed(() => [...new Set([props.ingest?.error, props.task?.error, props.source.lastScanError].filter((error): error is string => !!error))])
</script>

<template>
  <ElCard shadow="never" class="source-card">
    <header class="source-header">
      <span class="source-icon" aria-hidden="true"><ElIcon><FolderOpened /></ElIcon></span>
      <div class="source-info">
        <div class="source-title">
          <h2>{{ source.name }}</h2>
          <ElTag type="info" effect="plain" size="small">{{ source.type === 'LOCAL' ? '本地目录' : 'WebDAV' }}</ElTag>
          <ElTag v-if="source.useForLxDownloads" type="success" effect="plain" size="small">下载保存位置</ElTag>
          <StatusBadge class="source-status" :tone="status.tone" :label="status.label" role="status" />
        </div>
        <p class="source-location">{{ location }}</p>
        <ElButton class="source-profile-link" link type="primary" :disabled="profileLoading" @click="$emit('recognition')">文件名识别：{{ profileLoading ? '读取中…' : profileName }}<ElIcon aria-hidden="true"><ArrowRight /></ElIcon></ElButton>
      </div>
    </header>

    <dl v-if="quality" class="source-metrics" aria-label="歌曲与资料统计">
      <div v-for="metric in metrics" :key="metric.label"><dt>{{ metric.label }}</dt><dd>{{ metric.value.toLocaleString('zh-CN') }}</dd></div>
    </dl>

    <div v-if="issues.length" class="source-attention">
      <ElIcon aria-hidden="true"><Warning /></ElIcon>
      <div class="source-issues"><span v-for="issue in issues" :key="issue.label"><strong>{{ issue.count.toLocaleString('zh-CN') }}</strong> {{ issue.label }}</span></div>
      <ElButton link type="primary" @click="$emit('metadata')">去完善<ElIcon aria-hidden="true"><ArrowRight /></ElIcon></ElButton>
    </div>
    <p v-if="enhancingCount" class="source-activity" role="status"><ElIcon class="is-loading" aria-hidden="true"><Loading /></ElIcon>正在完善 {{ enhancingCount.toLocaleString('zh-CN') }} 项资料</p>
    <p v-if="activeIngest" class="source-activity" role="status">{{ ingest?.state === 'QUEUED' ? '已保存，等待后台扫描入库' : '正在后台扫描入库，可以离开页面' }}</p>
    <p v-for="message in scanErrors" :key="message" class="scan-error" role="alert">{{ message }}</p>
    <p v-if="taskError" class="scan-error" role="alert">状态读取失败：{{ taskError }}，正在重试</p>

    <details v-if="task" class="source-scan-details" :open="activeScan">
      <summary><ElIcon class="scan-chevron" aria-hidden="true"><ArrowRight /></ElIcon><span>扫描详情</span><span class="scan-brief">已处理 {{ task.directories }} 个目录 · {{ task.entries }} 个条目<span v-if="task.needsReviewSongs"> · {{ task.needsReviewSongs }} 首需复核</span></span></summary>
      <div class="scan-progress" aria-live="polite">
        <span>已处理 {{ task.directories }} 个目录、{{ task.entries }} 个条目；{{ task.totalSongs }} 首，{{ task.needsReviewSongs }} 首需复核</span>
        <span v-if="task.status === 'SUCCEEDED'">新增 {{ task.addedSongs ?? 0 }} · 复用 {{ task.reusedSongs ?? 0 }} · 待确认删除 {{ task.missingSongs ?? 0 }} · 下架 {{ task.removedSongs ?? 0 }}</span>
        <ElButton v-if="activeScan && task.phase === 'SCANNING'" link type="warning" :loading="cancelling" :disabled="task.cancelRequested" @click="$emit('cancelScan')">取消扫描</ElButton>
      </div>
    </details>
    <p v-else-if="localResult" class="source-scan-result" aria-live="polite">扫描完成：{{ localResult.totalSongs }} 首，{{ localResult.needsReviewSongs }} 首需复核</p>

    <footer class="source-footer">
      <p class="source-schedule"><ElIcon aria-hidden="true"><Clock /></ElIcon><span>{{ source.scanEnabled ? '自动扫描已开启' : '自动扫描未开启' }}<span v-if="nextScan" class="next-scan">下次：{{ nextScan }}</span></span></p>
      <div class="source-actions">
        <ElButton type="primary" @click="$emit('songs')">查看歌曲</ElButton>
        <ElButton @click="$emit('metadata')">完善信息</ElButton>
        <ElDropdown trigger="click" placement="top-end" :popper-options="menuPopperOptions" :teleported="true" :show-arrow="false" popper-class="source-actions-dropdown">
          <ElButton :icon="MoreFilled" :aria-label="`${source.name}的更多操作`" title="更多操作" />
          <template #dropdown>
            <ElDropdownMenu>
              <ElDropdownItem :icon="Share" @click="$emit('metadata')">分享资料</ElDropdownItem>
              <ElDropdownItem :icon="RefreshRight" :disabled="scanDisabled || activeIngest || activeScan" @click="$emit('scan')">扫描歌曲</ElDropdownItem>
              <ElDropdownItem :icon="Edit" @click="$emit('edit')">编辑</ElDropdownItem>
              <ElDropdownItem class="source-remove-action" :icon="Delete" divided @click="$emit('remove')">移除</ElDropdownItem>
            </ElDropdownMenu>
          </template>
        </ElDropdown>
      </div>
    </footer>
  </ElCard>
</template>

<style scoped>
.source-card { min-width: 0; }
.source-card :deep(.el-card__body) { display: flex; flex-direction: column; gap: 16px; }
.source-header { display: flex; align-items: flex-start; gap: 16px; }
.source-icon { display: grid; place-items: center; flex-shrink: 0; width: 48px; height: 48px; border-radius: var(--sv-radius-md); background: var(--sv-surface-3); color: var(--sv-text-secondary); font-size: 24px; }
.source-info { flex: 1; min-width: 0; }
.source-title { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; }
.source-title h2 { margin: 0; color: var(--sv-text-primary); font-size: 17px; line-height: 1.5; overflow-wrap: anywhere; }
.source-title > .el-tag { flex-shrink: 0; }
.source-status { margin-left: auto; }
.source-location { margin: 6px 0 8px; color: var(--sv-text-secondary); font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }
.source-profile-link { max-width: 100%; height: auto; white-space: normal; text-align: left; font-size: 12px; }
.source-profile-link :deep(span) { white-space: normal; overflow-wrap: anywhere; line-height: 1.7; }
.source-profile-link .el-icon { flex-shrink: 0; margin-left: 6px; }
.source-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 0; padding: 12px 0; border-radius: var(--sv-radius-md); background: var(--sv-surface-1); }
.source-metrics > div { display: flex; flex-direction: column-reverse; align-items: center; gap: 4px; min-width: 0; padding: 0 12px; text-align: center; }
.source-metrics > div + div { border-left: 1px solid var(--sv-border-subtle); }
.source-metrics dt { color: var(--sv-text-secondary); font-size: 12px; line-height: 1.6; }
.source-metrics dd { margin: 0; color: var(--sv-text-primary); font-size: 26px; font-weight: 600; line-height: 1.3; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.source-attention { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: var(--sv-radius-md); color: var(--sv-semantic-warn); background: var(--sv-semantic-warn-soft); }
.source-attention > .el-icon { flex-shrink: 0; font-size: 18px; }
.source-issues { display: flex; flex: 1; flex-wrap: wrap; gap: 4px 16px; min-width: 0; font-size: 13px; line-height: 1.7; }
.source-issues strong { font-variant-numeric: tabular-nums; }
.source-attention .el-button { flex-shrink: 0; margin: 0; font-size: 12px; }
.source-attention .el-button .el-icon { margin-left: 6px; }
.source-activity { display: flex; align-items: center; gap: 8px; margin: 0; color: var(--sv-accent-primary); font-size: 13px; line-height: 1.7; }
.scan-error { margin: 0; color: var(--sv-semantic-danger); font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }
.source-scan-details { border-top: 1px solid var(--sv-border-subtle); padding-top: 4px; }
.source-scan-details summary { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-height: 36px; list-style: none; cursor: pointer; color: var(--sv-text-primary); font-size: 13px; }
.source-scan-details summary::-webkit-details-marker { display: none; }
.source-scan-details summary:focus-visible { outline: 2px solid var(--sv-accent-primary); outline-offset: 3px; border-radius: var(--sv-radius-sm); }
.scan-chevron { color: var(--sv-text-secondary); }
.source-scan-details[open] .scan-chevron { transform: rotate(90deg); }
.scan-brief { margin-left: 8px; color: var(--sv-text-secondary); font-size: 12px; }
.scan-progress { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 8px 0 4px 21px; color: var(--sv-text-secondary); font-size: 12px; line-height: 1.8; overflow-wrap: anywhere; }
.scan-progress .el-button { margin-left: 0; }
.source-scan-result { margin: 0; color: var(--sv-text-secondary); font-size: 13px; line-height: 1.7; }
.source-footer { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding-top: 12px; border-top: 1px solid var(--sv-border-subtle); }
.source-schedule { display: flex; flex: 1; align-items: flex-start; gap: 8px; min-width: 160px; margin: 0; color: var(--sv-text-secondary); font-size: 12px; line-height: 1.8; }
.source-schedule > .el-icon { flex-shrink: 0; margin-top: 3px; font-size: 16px; }
.next-scan { display: block; }
.source-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.source-actions .el-button { margin: 0; }
.source-actions .el-dropdown > .el-button { width: 40px; padding: 0; }
:global(.source-actions-dropdown .el-dropdown-menu__item) { min-height: 36px; min-width: 144px; }
:global(.source-actions-dropdown .source-remove-action) { color: var(--sv-semantic-danger); }
@media (max-width: 768px) {
  .source-card :deep(.el-card__body) { gap: 12px; }
  .source-attention { padding: 4px 12px; }
  .source-actions .el-button, .source-profile-link, .source-scan-details summary, .scan-progress .el-button, .source-attention .el-button { min-height: 44px; }
  .source-actions .el-dropdown > .el-button { width: 44px; }
  :global(.source-actions-dropdown .el-dropdown-menu__item) { min-height: 44px; }
}
@media (max-width: 560px) {
  .source-card :deep(.el-card__body) { gap: 16px; padding: 16px; }
  .source-header { gap: 12px; }
  .source-icon { width: 40px; height: 40px; font-size: 22px; }
  .source-status { flex-basis: 100%; margin-left: 0; }
  .source-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 0; }
  .source-metrics > div { padding: 14px 8px; }
  .source-metrics > div:nth-child(3) { border-left: 0; }
  .source-metrics > div:nth-child(n + 3) { border-top: 1px solid var(--sv-border-subtle); }
  .source-metrics dd { font-size: 24px; }
  .source-attention { flex-wrap: wrap; gap: 8px; }
  .scan-brief { flex-basis: 100%; margin: 0 0 4px 21px; }
  .source-schedule { flex-basis: 100%; }
  .source-actions { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 44px; width: 100%; }
  .source-actions > .el-button { min-width: 0; padding: 0 8px; }
}
@media (prefers-reduced-motion: reduce) {
  .source-activity .is-loading { animation: none; }
}
</style>
