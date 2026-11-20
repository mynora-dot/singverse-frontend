<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElAlert, ElButton, ElDialog, ElInput, ElMessage, ElMessageBox, ElProgress } from 'element-plus'
import { authRequest } from '../../../core/auth/api'
import { embeddedMetadata, embeddedState, type EmbeddedSummary, type EmbeddedDetail } from '../api/embeddedMetadata'
import { media } from '../api/media'
import type { MediaSource, ScanTask } from '../types'
import ShareImportPanel from './ShareImportPanel.vue'
import MediaRebindPanel from './MediaRebindPanel.vue'
const props = defineProps<{ source: MediaSource | null; importJobId?: string; initialImportFile?: File }>()
const emit = defineEmits<{ close: []; songs: []; updated: [importJobId?: string]; uploading: [value: boolean]; fileConsumed: [] }>()
interface ShareJob { id: string; state: string; total_count: number; processed_count: number; part_count: number; deletion_count?: number; error?: string }
const summary = ref<EmbeddedSummary>(), shareJob = ref<ShareJob>(), scanTask = ref<ScanTask>()
const advanced = ref(false), error = ref(''), busy = ref(false), loading = ref(false)
const enabled = ref(false), paused = ref(false), accessGroup = ref(''), origins = ref('')
const sampleId = ref(''), sample = ref<EmbeddedDetail>(), sampleName = ref('')
const uploading = ref(false), importing = ref(false)
const reboundImportId = ref<string>()
watch(uploading, value => emit('uploading', value))
const diagnosis = ref<{ directory: string; media: string; directoryMessage: string; mediaMessage: string; relativePath?: string }>()
let generation = 0, timer: ReturnType<typeof setTimeout> | undefined
const shareBase = () => '/api/v1/media-sources/' + encodeURIComponent(props.source!.id) + '/embedded-metadata/share-jobs'
const total = computed(() => summary.value?.quality?.total ?? Object.values(summary.value?.counts ?? {}).reduce((a, b) => a + b, 0))
const qualityIssues = computed(() => {
  const quality = summary.value?.quality
  if (!quality) return []
  return [
    { count: quality.informationMissing, label: '首信息不足' },
    { count: quality.pendingVerification, label: '个路径待核验' },
    { count: quality.mediaIssues, label: '项媒体待处理' },
  ].filter(issue => issue.count > 0)
})
const ready = computed(() => Object.entries(summary.value?.counts ?? {}).filter(([state]) => ['COMPLETE', 'EMPTY', 'PARTIAL', 'IMPORTED'].includes(state)).reduce((a, [, count]) => a + count, 0))
const activeShare = computed(() => ['WAITING', 'QUEUED', 'RUNNING'].includes(shareJob.value?.state ?? ''))
const sharePercent = computed(() => shareJob.value?.state === 'SUCCEEDED' ? 100 : Math.min(99, Math.round((shareJob.value?.processed_count ?? 0) * 100 / Math.max(1, shareJob.value?.total_count ?? 0))))
async function load(initial = false) {
  const source = props.source, token = generation
  if (!source) return
  if (initial) loading.value = true
  try {
    const [value, job, task] = await Promise.all([embeddedMetadata.summary(source.id), authRequest<ShareJob>(shareBase() + '/latest'), source.type === 'WEBDAV' ? media.latestTask(source.id) : Promise.resolve(undefined)])
    if (token !== generation) return
    summary.value = value; shareJob.value = job; scanTask.value = task; error.value = ''
    if (initial) { enabled.value = value.enabled; paused.value = value.paused; accessGroup.value = value.accessGroup; origins.value = value.privateOrigins.join('\n') }
    if (sampleId.value) { const result = await embeddedMetadata.detail(sampleId.value); if (token === generation) sample.value = result }
  } catch (e) { if (token === generation) error.value = e instanceof Error ? e.message : '读取状态失败，请重试' }
  finally { if (token === generation) { loading.value = false; clearTimeout(timer); timer = setTimeout(() => void load(), activeShare.value || !!summary.value?.files?.pending || sample.value?.state === 'RUNNING' || sample.value?.state === 'PENDING' || ['QUEUED', 'RUNNING'].includes(scanTask.value?.status ?? '') ? 2000 : 10000) } }
}
watch(() => props.source?.id, () => { generation++; clearTimeout(timer); reboundImportId.value = undefined; summary.value = undefined; shareJob.value = undefined; sample.value = undefined; sampleId.value = ''; advanced.value = false; error.value = ''; if (props.source) void load(true) }, { immediate: true })
onBeforeUnmount(() => { generation++; clearTimeout(timer); emit('uploading', false) })
function showAdvanced(event: Event) { advanced.value = (event.target as HTMLDetailsElement).open }
async function toggleEnhance() { enabled.value = true; paused.value = !!summary.value?.enabled && !summary.value?.paused; await save() }
async function scan() {
  if (!props.source || busy.value || importing.value) return
  busy.value = true
  try { if (props.source.type === 'LOCAL') await media.scan(props.source.id)
    else scanTask.value = await media.createTask(props.source.id)
    clearTimeout(timer); await load() }
  catch (e) { error.value = e instanceof Error ? e.message : '扫描失败' }
  finally { busy.value = false }
}
async function diagnose() {
  if (!props.source || busy.value) return
  busy.value = true; error.value = ''
  try { diagnosis.value = await authRequest(`/api/v1/media-sources/${encodeURIComponent(props.source.id)}/diagnostics`, 'POST') }
  catch (e) { error.value = e instanceof Error ? e.message : '诊断失败' }
  finally { busy.value = false }
}
async function save() {
  if (!props.source || busy.value) return
  const source = props.source, token = generation
  busy.value = true; error.value = ''
  try {
    const value = await embeddedMetadata.configure(source.id, { enabled: enabled.value, paused: paused.value, accessGroup: accessGroup.value, privateOrigins: origins.value.split('\n').map(v => v.trim()).filter(Boolean) })
    if (token === generation) { summary.value = value; ElMessage.success('已保存') }
  } catch (e) { if (token === generation) error.value = e instanceof Error ? e.message : '保存失败' }
  finally { busy.value = false }
}
async function trial() {
  if (!props.source || busy.value) return
  busy.value = true; error.value = ''
  try {
    const songs = await media.songs(props.source.id, 0, 1)
    const song = songs.items[0]
    if (!song) throw new Error('请先扫描歌曲')
    sampleId.value = song.id; sampleName.value = song.relativePath
    const cached = await embeddedMetadata.detail(song.id)
    if (cached.state === 'PENDING' || cached.state === 'NOT_WEBDAV') await embeddedMetadata.refresh([song.id])
    sample.value = await embeddedMetadata.detail(song.id)
    clearTimeout(timer); await load()
  } catch (e) { error.value = e instanceof Error ? e.message : '试提取失败' }
  finally { busy.value = false }
}
async function createShare(delta = false) {
  if (!props.source || busy.value) return
  const baseId = delta ? shareJob.value?.id : undefined
  busy.value = true
  try { shareJob.value = await authRequest<ShareJob>(shareBase(), 'POST', { baseId }); clearTimeout(timer); await load() }
  catch (e) { error.value = e instanceof Error ? e.message : '创建分享包失败' }
  finally { busy.value = false }
}
async function resumeShare() {
  if (!shareJob.value) return
  try { await authRequest(shareBase() + '/' + shareJob.value.id + '/resume', 'POST'); clearTimeout(timer); await load() }
  catch (e) { error.value = e instanceof Error ? e.message : '恢复失败' }
}
async function confirmEmpty() {
  const source = props.source
  if (!source || busy.value) return
  try { await ElMessageBox.confirm('确认下架此来源的全部歌曲？原始媒体不受影响，索引缓存保留 30 天。', '确认空库同步', { confirmButtonText: '全部下架', cancelButtonText: '取消', type: 'warning' }) } catch { return }
  busy.value = true
  try { await embeddedMetadata.confirmEmpty(source.id); clearTimeout(timer); await load() }
  catch (e) { error.value = e instanceof Error ? e.message : '下架失败' }
  finally { busy.value = false }
}
function close() { if (!uploading.value) emit('close') }
function beforeClose(done: () => void) { if (!uploading.value) done() }
async function updated(importJobId?: string) {
  if (importJobId) reboundImportId.value = importJobId
  clearTimeout(timer); await load(); emit('updated', importJobId)
}
</script>
<template>
  <ElDialog :model-value="!!source" :title="source ? source.name + ' · 分享资料' : '分享资料'" width="min(640px, calc(100vw - 24px))" class="library-workflow-dialog" :close-on-click-modal="false" :before-close="beforeClose" @update:model-value="value => { if (!value) close() }">
    <div class="workflow-content">
    <ElAlert v-if="error" :title="error" type="error" :closable="true" @close="error = ''" />
    <section class="library-overview">
      <div class="action-row overview-row">
      <div><h3 class="library-count">{{ loading ? '正在加载…' : '共 ' + total.toLocaleString() + ' 首歌曲' }}</h3><p v-if="importing" role="status">资料包处理中</p><p v-if="scanTask && ['QUEUED', 'RUNNING'].includes(scanTask.status)" role="status">正在扫描，已发现 {{ scanTask.totalSongs.toLocaleString() }} 首</p></div>
      <ElButton v-if="!total" type="primary" :loading="busy" :disabled="importing || loading || ['QUEUED', 'RUNNING'].includes(scanTask?.status ?? '')" @click="scan">扫描歌曲</ElButton>
      <ElButton v-else :disabled="uploading" @click="emit('songs')">查看歌曲</ElButton>
      </div>
      <ul v-if="qualityIssues.length" class="quality-issues" aria-label="待处理事项"><li v-for="issue in qualityIssues" :key="issue.label">{{ issue.count.toLocaleString() }} {{ issue.label }}</li></ul>
    </section>
    <ShareImportPanel v-if="source?.type === 'WEBDAV'" :key="source.id + source.location" :source="source" :job-id="reboundImportId || importJobId" :initial-file="initialImportFile" @file-consumed="emit('fileConsumed')" @uploading="uploading = $event" @active="importing = $event" @updated="updated" />
    <section v-if="source?.type === 'WEBDAV'" class="action-section embedded-action">
      <div class="action-row"><div><h3>完善歌曲信息</h3><p v-if="summary?.paused">已暂停 · 已处理 {{ ready.toLocaleString() }} 首</p><p v-else-if="summary?.enabled">已处理 {{ ready.toLocaleString() }} / {{ total.toLocaleString() }} 首</p></div><div class="embedded-actions"><ElButton :loading="busy" :disabled="importing || busy || loading || !total" @click="toggleEnhance">{{ summary?.paused ? '继续自动提取' : summary?.enabled ? '暂停自动提取' : '开始自动提取' }}</ElButton><ElButton :disabled="importing || busy || loading || !total || !!summary?.paused" @click="trial">试提取一首</ElButton></div></div>
      <div v-if="sample" class="sample-result" role="status"><strong>{{ embeddedState(sample.state) }}</strong><p class="file-path">{{ sampleName }}</p><div v-if="sample.result" class="sample-preview"><img v-if="sample.result.cover" :src="'/api/v1/media-songs/' + encodeURIComponent(sampleId) + '/embedded-metadata/cover'" alt="样本内嵌封面"><div><h4>{{ sample.result.tags?.title || (sample.result.fields?.title === 'ABSENT' ? '文件未提供内嵌歌名' : '尚未读取到内嵌歌名') }}</h4><p>{{ sample.result.tags?.artists?.join('、') || '尚未读取到内嵌歌手' }}</p><details v-if="sample.result.lyrics"><summary>查看歌词</summary><pre>{{ sample.result.lyrics.text }}</pre></details></div></div></div>
    </section>
    <section class="action-section share-action">
      <div class="action-row"><div><h3>分享曲库</h3><p>仅含资料与附件</p></div><ElButton v-if="!shareJob?.id || shareJob.state === 'FAILED'" type="primary" :loading="busy" :disabled="!total || loading" @click="shareJob?.state === 'FAILED' ? resumeShare() : createShare()">{{ shareJob?.state === 'FAILED' ? '重试' : '导出分享包' }}</ElButton><ElButton v-else-if="activeShare" loading disabled>正在准备</ElButton><a v-else-if="shareJob.state === 'SUCCEEDED' && shareJob.part_count" class="primary-action" :href="shareBase() + '/' + shareJob.id + '/download'" download="singverse-share-set.zip">下载分享包</a></div>
      <div v-if="activeShare" class="task-status" role="status"><ElProgress :percentage="sharePercent" :indeterminate="shareJob?.state === 'WAITING'" /><p>后台准备中，关闭窗口也会继续。</p></div>
      <p v-else-if="shareJob?.state === 'FAILED'" class="task-status" role="status">分享包准备失败，请重试。</p>
      <div v-else-if="shareJob?.state === 'SUCCEEDED'" class="ready-status"><p>{{ shareJob.part_count ? '分享包已准备好' : '暂无新增资料' }}</p><ElButton text :disabled="busy" @click="createShare()">重新导出</ElButton></div>
    </section>
    <details class="advanced-options" @toggle="showAdvanced"><summary>高级选项</summary><div v-if="advanced" class="advanced-content">
      <div class="advanced-actions"><ElButton :disabled="importing || busy || ['QUEUED', 'RUNNING'].includes(scanTask?.status ?? '')" @click="scan">重新扫描歌曲</ElButton><ElButton v-if="shareJob?.state === 'SUCCEEDED'" :disabled="busy || activeShare" @click="createShare(true)">仅分享新增和变化</ElButton></div>
      <p v-if="summary?.files">衍生文件：{{ summary.files.pending ? '等待处理 ' + summary.files.pending + ' 首' : '已完成' }}<span v-if="summary.files.failed">，{{ summary.files.failed }} 首待重新生成</span><span v-if="summary.files.attachments">，封面待补齐</span>。</p>
      <p>每包最多 5000 首，可直接导入整套 ZIP。</p>
      <p>媒体链接需另行分享；接收方绑定自己的 WebDAV 目录。</p>
      <template v-if="source?.type === 'WEBDAV'"><p class="file-path">导入位置：{{ source.location }}</p><ElButton :loading="busy" @click="diagnose">诊断目录与分段读取</ElButton><p v-if="diagnosis" role="status">目录：{{ diagnosis.directoryMessage }}<br>媒体：{{ diagnosis.mediaMessage }}</p><MediaRebindPanel :source="source" @updated="updated" /><label>共享访问组<ElInput v-model="accessGroup" maxlength="64" /></label><label>私有下载代理（每行一个地址）<ElInput v-model="origins" type="textarea" :rows="2" /></label><ElButton :loading="busy" @click="save">保存高级设置</ElButton><p v-if="summary?.blockedReason">{{ embeddedState(summary.blockedReason) }}</p><p v-if="!summary?.remoteReady">{{ summary?.nodeMessage }}</p><p v-if="summary">今日已处理 {{ summary.budget.files_started }} 首，读取 {{ (summary.budget.bytes_read / 1048576).toFixed(1) }} MiB。</p><ElButton v-if="summary?.canConfirmEmpty" type="danger" :disabled="busy" @click="confirmEmpty">确认空库同步</ElButton></template>
      <details v-if="shareJob?.state === 'SUCCEEDED' && shareJob.part_count"><summary>单独下载分包</summary><div class="share-parts"><a v-for="part in shareJob.part_count" :key="part" :href="shareBase() + '/' + shareJob.id + '/parts/' + part" :download="'part-' + String(part).padStart(6, '0') + '.zip'">分包 {{ part }}</a></div></details>
      <p>备份系统需另存数据库、密钥与附件。</p>
    </div></details>
    </div>
    <template #footer><ElButton :disabled="uploading" @click="close">关闭</ElButton></template>
  </ElDialog>
</template>
<style scoped>
.workflow-content > .el-alert { margin-bottom: 16px; }
.library-overview { padding-bottom: 20px; }
.action-section, .action-row { min-width: 0; }
.action-section, .advanced-options { border-top: 1px solid var(--sv-border-subtle); }
.action-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 0; }
.overview-row { padding: 0; }
.action-row > div { min-width: 0; }
.action-row > .el-button, .primary-action { flex-shrink: 0; }
.quality-issues { display: flex; flex-wrap: wrap; gap: 6px 12px; margin: 12px 0 0; padding: 0; list-style: none; color: var(--sv-semantic-warn); font-size: 13px; line-height: 1.7; }
.embedded-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; flex-shrink: 0; }
.embedded-actions .el-button { margin: 0; }
h3 { margin: 0; color: var(--sv-text-primary); font-size: 16px; line-height: 1.5; }
p { margin: 0; color: var(--sv-text-secondary); font-size: 14px; line-height: 1.6; }
h3 + p { margin-top: 4px; }
.primary-action { display: inline-flex; align-items: center; justify-content: center; min-height: 40px; padding: 0 16px; border-radius: var(--el-border-radius-base); background: var(--sv-accent-primary); color: var(--sv-on-accent); font-size: 14px; font-weight: 500; text-decoration: none; }
.primary-action:focus-visible { outline: 2px solid var(--sv-accent-primary); outline-offset: 3px; }
.task-status { padding-bottom: 16px; }
.task-status p { margin-top: 8px; }
.ready-status { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 12px; }
.advanced-options { padding-top: 12px; color: var(--sv-text-secondary); font-size: 14px; }
summary { min-height: 28px; line-height: 28px; cursor: pointer; }
.advanced-content { padding-top: 8px; }
.advanced-content p { margin: 12px 0; }
.advanced-content label { display: block; margin: 16px 0; }
.advanced-content .el-input { margin-top: 8px; }
.advanced-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.advanced-actions .el-button { margin: 0; }
.file-path { overflow-wrap: anywhere; }
.sample-result { margin: 0 0 20px; padding: 12px; border-radius: 8px; background: var(--sv-surface-3); }
.sample-preview { display: flex; gap: 12px; margin-top: 12px; }
.sample-preview img { width: 64px; height: 64px; border-radius: 8px; object-fit: cover; }
.sample-preview h4 { margin: 0; }
.sample-preview pre { white-space: pre-wrap; overflow-wrap: anywhere; }
.share-parts { display: flex; flex-wrap: wrap; gap: 12px; max-height: 180px; margin: 12px 0; overflow: auto; }
.share-parts a { color: var(--sv-accent-primary); }
:global(.library-workflow-dialog.el-dialog) { display: flex; flex-direction: column; max-height: 90dvh; }
:global(.library-workflow-dialog > .el-dialog__header), :global(.library-workflow-dialog > .el-dialog__footer) { flex-shrink: 0; }
:global(.library-workflow-dialog > .el-dialog__body) { min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
@media (max-width: 600px) {
  .embedded-action > .action-row { align-items: flex-start; flex-wrap: wrap; gap: 12px; }
  .embedded-action .embedded-actions { flex-basis: 100%; justify-content: flex-start; }
}
@media (max-width: 768px) {
  .action-row > .el-button, .embedded-actions .el-button, .primary-action, summary { min-height: 44px; }
  .ready-status { align-items: flex-start; flex-wrap: wrap; }
}
</style>
