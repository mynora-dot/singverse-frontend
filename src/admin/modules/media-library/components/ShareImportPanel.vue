<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElAlert, ElButton, ElInput, ElProgress } from 'element-plus'
import { shareImports, mediaVerification, validateSharePackage, type ImportApplyMode, type ShareImportJob, type ImportDifference } from '../api/shareImports'
import type { MediaSource } from '../types'
import type { EmbeddedSummary } from '../api/embeddedMetadata'
import { displayWebDavLocation } from '../webdav-location'
import { acceptedUpload, packageUploads, uploadPackage } from '../package-uploads'

const props = withDefaults(defineProps<{ source: MediaSource; jobId?: string; summary?: EmbeddedSummary; activity?: string; loadJobs?: boolean }>(), { loadJobs: true })
const emit = defineEmits<{ updated: []; active: [value: boolean]; songs: []; maintenance: [event: MouseEvent] }>()
const job = ref<ShareImportJob>(), error = ref(''), busy = ref(false), detailsOpen = ref(false)
const selectedFile = ref<File>()
const picker = ref<HTMLInputElement>(), confirmButton = ref<InstanceType<typeof ElButton>>()
const statusLine = ref<HTMLElement>()
let pickerTrigger: HTMLButtonElement | undefined
const transfer = computed(() => packageUploads.get(props.source.id))
const uploading = computed(() => !!transfer.value?.controller)
const remove = ref(''), add = ref(''), differences = ref<ImportDifference[]>([])
const cursor = ref(0), more = ref(false), showingDifferences = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined, generation = 0, readVersion = 0
let followSubmittedUpload = false
const working = computed(() => ['PARSING', 'QUEUED', 'RUNNING', 'VERIFYING', 'PREVIEW'].includes(job.value?.state ?? ''))
watch(() => uploading.value || working.value, value => emit('active', value), { immediate: true })
const legacyPendingVerification = computed(() => props.source.type === 'WEBDAV' && job.value?.state === 'SUCCEEDED' && job.value.phase === 'IMPORTED' && job.value.totalCount > job.value.verifiedCount)
const stage = computed(() => ({
  PARSING: '正在解析资料包', PREVIEW: '请核对自己的媒体目录', QUEUED: '等待导入',
  RUNNING: '正在保存歌曲资料', VERIFYING: '正在核验文件路径', FAILED: '导入需要处理', CANCELLED: '导入已取消',
}[job.value?.state ?? ''] ?? ''))
const progress = computed(() => job.value?.phase === 'VERIFYING' ? job.value.verifiedCount : job.value?.processedCount ?? 0)
const percent = computed(() => Math.min(100, Math.round(progress.value * 100 / Math.max(1, job.value?.totalCount ?? 0))))
const supersededCount = computed(() => {
  const current = job.value
  if (!current) return 0
  return Math.max(0, current.verifiedCount - current.presentCount - current.missingCount - current.mismatchCount - current.unreachableCount)
})
const jobDifferences = computed(() => !!(job.value?.preservedCount || job.value?.missingCount || job.value?.mismatchCount || job.value?.unreachableCount || supersededCount.value))
const issues = computed(() => {
  const quality = props.summary?.quality
  const current = job.value
  const missing = quality?.missingFiles ?? current?.missingCount ?? 0
  const mismatched = quality?.sizeMismatches ?? current?.mismatchCount ?? 0
  const unreachable = quality?.unreachableFiles ?? current?.unreachableCount ?? 0
  const other = Math.max(0, (quality?.mediaIssues ?? 0) - missing - mismatched - unreachable)
  return [
    [quality?.informationMissing, '首歌曲资料待补齐'], [missing, '个文件未找到'], [mismatched, '个文件大小不符'],
    [unreachable, '个文件无法访问'], [other, '个媒体文件待处理'], [quality?.pendingVerification, '个路径待核验'],
    [props.summary?.files?.failed, '项衍生文件待重试'],
  ].filter(([count]) => count).map(([count, label]) => count + ' ' + label).join(' · ')
})
const status = computed(() => {
  if (transfer.value) return transfer.value.error || '正在上传 ' + transfer.value.file.name
  return stage.value || (legacyPendingVerification.value ? '有文件路径待核验' : '') || issues.value || props.activity ||
    (supersededCount.value ? '已跳过 ' + supersededCount.value + ' 个已变更的位置' : '')
})
const statusTarget = computed(() => {
  const quality = props.summary?.quality
  const current = job.value
  const recordedIssues = current ? current.missingCount + current.mismatchCount + current.unreachableCount : 0
  const inspectReceipt = props.jobId || stage.value || legacyPendingVerification.value || supersededCount.value ||
    (recordedIssues > 0 && (!quality || quality.mediaIssues === recordedIssues))
  if (current?.id && inspectReceipt) return 'receipt'
  if (props.summary?.files?.failed || props.activity) return 'maintenance'
  return 'songs'
})
function inspect(event: MouseEvent) {
  if (statusTarget.value === 'receipt') {
    detailsOpen.value = !detailsOpen.value
    if (detailsOpen.value && jobDifferences.value && !showingDifferences.value) void showDifferences()
  } else if (statusTarget.value === 'maintenance') emit('maintenance', event)
  else emit('songs')
}
function accept(value: ShareImportJob, notify = true) {
  const changed = job.value?.state !== value.state || job.value?.id !== value.id
  job.value = value
  const receipt = acceptedUpload.value
  if (changed && value.state === 'PREVIEW' && (followSubmittedUpload ||
    receipt?.sourceId === props.source.id && receipt.job.id === value.id)) detailsOpen.value = true
  if (changed && value.state === 'SUCCEEDED' && !props.jobId && !legacyPendingVerification.value &&
    !value.missingCount && !value.mismatchCount && !value.unreachableCount && !supersededCount.value) detailsOpen.value = false
  if (notify && changed && ['VERIFYING', 'SUCCEEDED', 'FAILED', 'CANCELLED'].includes(value.state)) emit('updated')
}
async function load(initial = false, latest = false) {
  const token = generation, version = ++readVersion
  let failed = false
  try {
    const requested = latest ? undefined : job.value?.id || props.jobId
    const value = requested ? await shareImports.get(props.source.id, requested) : await shareImports.latest(props.source.id)
    if (token !== generation || version !== readVersion || !value) return
    const different = value.id !== job.value?.id
    if (different) {
      differences.value = []; showingDifferences.value = false; detailsOpen.value = !!props.jobId
    }
    accept(value, !initial)
    if (different || initial) { remove.value = value.removePrefix ?? ''; add.value = value.addPrefix ?? '' }
    error.value = ''
  } catch (e) {
    failed = true
    if (token === generation && version === readVersion) error.value = e instanceof Error ? e.message : '读取导入任务失败'
  }
  finally {
    if (token === generation && version === readVersion) {
      clearTimeout(timer)
      if (!document.hidden) {
        if (failed) timer = setTimeout(() => void load(initial, latest), 10000)
        else if (job.value?.id && (working.value && job.value.state !== 'PREVIEW' || detailsOpen.value && job.value.inputState === 'PENDING')) timer = setTimeout(() => void load(), 2000)
      }
    }
  }
}
watch([() => props.source.id, () => props.jobId], () => {
  generation++; clearTimeout(timer); followSubmittedUpload = false
  busy.value = false; job.value = undefined; selectedFile.value = undefined; detailsOpen.value = !!props.jobId
  differences.value = []; showingDifferences.value = false; error.value = ''
  if (props.jobId || props.loadJobs && !uploading.value) void load(true)
}, { immediate: true })
function refreshLatest() {
  if ((!props.loadJobs && !props.jobId) || uploading.value || busy.value || document.hidden) return
  void load(false, !props.jobId && !working.value)
}
watch(() => props.loadJobs, enabled => { if (enabled && !props.jobId && !uploading.value && !job.value?.id) void load(true) })
watch(() => props.summary?.importProcessing, (active, previous) => {
  if (active && previous === false && !props.jobId && !working.value) refreshLatest()
})
function visibilityChanged() {
  clearTimeout(timer)
  if (!document.hidden) refreshLatest()
}
watch(uploading, active => {
  if (!active || (props.jobId && !followSubmittedUpload)) return
  generation++; clearTimeout(timer); busy.value = false; detailsOpen.value = false
  selectedFile.value = undefined; differences.value = []; showingDifferences.value = false; error.value = ''; job.value = undefined
}, { flush: 'sync' })
watch(acceptedUpload, receipt => {
  if (receipt?.sourceId !== props.source.id || (props.jobId && !followSubmittedUpload && props.jobId !== receipt.job.id)) return
  generation++; clearTimeout(timer); remove.value = ''; add.value = ''; followSubmittedUpload = true
  accept(receipt.job); void load()
}, { flush: 'sync' })
function choose(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    validateSharePackage(file)
    selectedFile.value = file; error.value = ''
    void nextTick(() => confirmButton.value?.$el.focus())
  } catch (e) {
    selectedFile.value = undefined; error.value = e instanceof Error ? e.message : '无法读取资料包'
  }
}
function openPicker(event: MouseEvent) {
  if (working.value || uploading.value) return
  if (event.currentTarget instanceof HTMLButtonElement) pickerTrigger = event.currentTarget
  picker.value?.click()
}
function cancelSelection() {
  selectedFile.value = undefined
  void nextTick(() => pickerTrigger?.focus())
}
function submit(mode: ImportApplyMode) {
  if (!selectedFile.value || uploading.value || working.value) return
  followSubmittedUpload = true
  void uploadPackage(props.source, selectedFile.value, mode)
  void nextTick(() => statusLine.value?.focus({ preventScroll: true }))
}
async function action(value: 'apply' | 'cancel' | 'retry') {
  if (!job.value?.id || busy.value) return
  const token = ++generation
  clearTimeout(timer)
  busy.value = true; error.value = ''
  try {
    const result = await shareImports.action(props.source.id, job.value.id, value)
    if (token !== generation) return
    if (value === 'retry') { differences.value = []; showingDifferences.value = false }
    if (value === 'apply' && !props.jobId) detailsOpen.value = false
    accept(result); void load()
  }
  catch (e) { if (token === generation) error.value = e instanceof Error ? e.message : '操作失败' }
  finally {
    if (token === generation) {
      busy.value = false
      if (error.value && (working.value || detailsOpen.value && job.value?.inputState === 'PENDING')) timer = setTimeout(() => void load(), 2000)
    }
  }
}
async function map() {
  if (!job.value?.id || busy.value) return
  const token = ++generation
  clearTimeout(timer)
  busy.value = true; error.value = ''
  try {
    const result = await shareImports.mapping(props.source.id, job.value.id, remove.value.trim(), add.value.trim())
    if (token === generation) accept(result)
  }
  catch (e) { if (token === generation) error.value = e instanceof Error ? e.message : '目录映射失败' }
  finally { if (token === generation) busy.value = false }
}
const mappingChanged = computed(() => remove.value.trim() !== (job.value?.removePrefix ?? '') || add.value.trim() !== (job.value?.addPrefix ?? ''))
async function showDifferences(append = false) {
  if (!job.value?.id || busy.value) return
  const token = generation
  busy.value = true
  try {
    const value = await shareImports.differences(props.source.id, job.value.id, append ? cursor.value : 0)
    if (token !== generation) return
    differences.value = append ? [...differences.value, ...value.items] : value.items
    more.value = value.hasMore; cursor.value = value.nextCursor; showingDifferences.value = true
  } catch (e) { if (token === generation) error.value = e instanceof Error ? e.message : '读取差异失败' }
  finally { if (token === generation) busy.value = false }
}
const fieldName = (field: string) => ({ title: '歌名', artists: '歌手', album: '专辑', releaseDate: '发行日期', cover: '封面' }[field] ?? field)
function display(value: unknown) { return Array.isArray(value) ? value.join('、') : typeof value === 'string' ? value : '—' }
onMounted(() => document.addEventListener('visibilitychange', visibilityChanged))
onBeforeUnmount(() => { generation++; clearTimeout(timer); document.removeEventListener('visibilitychange', visibilityChanged) })
</script>
<template>
  <div class="share-import">
    <input ref="picker" type="file" accept=".zip,application/zip" aria-label="选择资料包" hidden :disabled="uploading || working" @change="choose">
    <slot name="toolbar" :choose="openPicker" :selected="!!selectedFile" :disabled="uploading || working">
      <ElButton :type="selectedFile ? 'default' : 'primary'" :disabled="uploading || working" @click="openPicker">{{ selectedFile ? '更换资料包' : '导入资料包' }}</ElButton>
    </slot>
    <div v-if="selectedFile" class="selection">
      <strong>{{ selectedFile.name }}</strong>
      <div class="import-actions">
        <ElButton ref="confirmButton" type="primary" :disabled="working || uploading" @click="submit('auto')">导入</ElButton>
        <ElButton :disabled="working || uploading" @click="submit('preview')">预览并调整目录</ElButton>
        <ElButton text @click="cancelSelection">取消</ElButton>
      </div>
    </div>
    <div v-if="status" ref="statusLine" class="status-line" role="status" tabindex="-1">
      <span>{{ status }}</span>
      <ElButton v-if="uploading" text @click="transfer?.controller?.abort()">取消上传</ElButton>
      <ElButton v-else-if="transfer" link type="primary" @click="uploadPackage(source, transfer.file, transfer.mode)">重试上传资料包</ElButton>
      <ElButton v-else link type="primary" :aria-expanded="statusTarget === 'receipt' ? detailsOpen : undefined" :aria-controls="statusTarget === 'receipt' && detailsOpen ? 'import-details-' + source.id : undefined" :aria-haspopup="statusTarget === 'maintenance' ? 'dialog' : undefined" @click="inspect">{{ detailsOpen && statusTarget === 'receipt' ? '收起' : job?.state === 'PREVIEW' ? '核对目录' : '查看' }}</ElButton>
    </div>
    <ElButton v-else-if="jobId && job?.id" class="history-toggle" link type="primary" :aria-expanded="detailsOpen" @click="detailsOpen = !detailsOpen">{{ detailsOpen ? '收起详情' : '查看任务详情' }}</ElButton>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <div v-if="job?.id && detailsOpen" :id="'import-details-' + source.id" class="job" role="region" aria-label="导入详情">
      <p v-if="job.deletionCount">共享方提示移除了 {{ job.deletionCount }} 首歌曲，仅供核对，本机资料会保留。</p>
      <p v-if="job.error">{{ job.error }}</p>
      <template v-if="job.state === 'PREVIEW'">
        <p>共 {{ job.totalCount }} 首 · 预计新增 {{ job.preview?.newSongs ?? 0 }} 首 · 为已有 {{ job.preview?.existingSongs ?? 0 }} 首合并资料</p>
        <ul class="samples"><li v-for="sample in job.samples" :key="sample.originalPath"><span>包内：{{ sample.originalPath }}</span><span>自己的地址：{{ displayWebDavLocation(sample.mediaURL) }}</span><span v-if="sample.incoming">资料预览：{{ display(sample.incoming.title) }} / {{ display(sample.incoming.artists) }}<template v-if="sample.local">；本机现有：{{ display(sample.local.title) }} / {{ display(sample.local.artists) }}</template></span></li></ul>
        <details><summary>目录前缀</summary><label>移除包内前缀<ElInput v-model="remove" placeholder="如 原曲库/华语，不填表示保留" /></label><label>添加自己的目录前缀<ElInput v-model="add" placeholder="如 KTV/华语，不填表示不添加" /></label><ElButton :loading="busy" @click="map">更新路径预览</ElButton></details>
        <ElButton type="primary" :loading="busy" :disabled="mappingChanged" @click="action('apply')">确认导入资料</ElButton>
      </template>
      <template v-else>
        <ElProgress v-if="working" :percentage="percent" :indeterminate="job.state === 'PARSING'" />
        <ElButton v-if="legacyPendingVerification" :loading="busy" @click="action('retry')">核验 WebDAV 路径</ElButton>
        <ElButton v-else-if="['FAILED', 'CANCELLED'].includes(job.state) || job.state === 'SUCCEEDED' && (job.missingCount || job.mismatchCount || job.unreachableCount)" :loading="busy" @click="action('retry')">{{ job.phase === 'VERIFYING' ? '重试未通过的核验' : '继续处理' }}</ElButton>
        <ElButton v-if="jobDifferences && !showingDifferences" :loading="busy" @click="showDifferences()">查看差异与待处理项</ElButton>
        <div v-if="showingDifferences" class="differences">
          <ul v-if="differences.length" aria-label="待处理文件">
            <li v-for="item in differences" :key="item.ordinal">
              <strong>{{ item.relativePath }}</strong>
              <span v-if="item.verification">{{ mediaVerification(item.verification) }}<template v-if="item.verificationError"> · {{ item.verificationError }}</template></span>
              <p v-for="field in item.fields" :key="field"><template v-if="field === 'cover'">封面：本地封面已保留，共享封面已另存。</template><template v-else>{{ fieldName(field) }}：保留本地「{{ display(item.local?.[field]) }}」；共享「{{ display(item.incoming?.[field]) }}」</template></p>
            </li>
          </ul>
          <p v-else>没有需要处理的差异。</p>
          <ElButton v-if="more" :loading="busy" @click="showDifferences(true)">显示更多差异</ElButton>
        </div>
        <details class="receipt" :open="!jobDifferences">
          <summary>导入记录</summary>
          <p>新增 {{ job.addedCount }} · 更新 {{ job.updatedCount }} · 保留本地修改 {{ job.preservedCount }} · 未变化 {{ job.unchangedCount }}</p>
          <p>已核对 {{ job.presentCount }} · 待核验 {{ Math.max(0, job.totalCount - job.verifiedCount) }} · 缺失 {{ job.missingCount }} · 大小不符 {{ job.mismatchCount }} · 连接问题 {{ job.unreachableCount }}</p>
          <p v-if="supersededCount">已跳过 {{ supersededCount }} 个位置或文件信息发生变更的条目。</p>
          <p v-if="job.pathOnlyCount">已核对路径，{{ job.pathOnlyCount }} 个文件大小未知。</p>
          <p v-if="job.inputState === 'PENDING'">临时资料包待清理<span v-if="job.inputCleanupError"> · {{ job.inputCleanupError }}</span></p>
          <p v-else-if="job.inputState === 'RELEASED'">临时资料包已清理</p>
        </details>
      </template>
      <ElButton v-if="working" :loading="busy" @click="action('cancel')">取消任务</ElButton>
    </div>
  </div>
</template>
<style scoped>
.share-import { min-width: 0; }
.import-actions, .status-line { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; }
.import-actions .el-button { margin: 0; }
.status-line { margin-top: 12px; color: var(--sv-text-secondary); font-size: 14px; overflow-wrap: anywhere; }
.selection, .job { margin-top: 12px; }
.history-toggle { margin-top: 12px; }
.selection { display:flex; align-items:center; flex-wrap:wrap; gap:8px 20px; border-top:1px solid var(--sv-border-subtle); padding-top:12px; }
.selection strong { flex:1 1 12em; min-width:0; overflow-wrap:anywhere; font-size:14px; }
.job { padding: 12px; background: var(--sv-surface-3); border-radius: 8px; }
.job > .el-button { margin: 4px 8px 4px 0; }
p { margin: 8px 0; color: var(--sv-text-secondary); font-size: 14px; line-height: 1.65; }
.samples, .differences { overflow-wrap: anywhere; }
.samples { padding-left: 20px; font-size: 14px; }
.samples li { margin: 12px 0; }
.samples span, label { display: block; }
details { margin: 16px 0; }
.receipt { margin:10px 0 0; }
summary { cursor: pointer; font-size: 14px; }
label { margin: 12px 0; font-size: 14px; }
label .el-input { margin-top: 8px; }
.differences ul { list-style:none; padding:0; margin:8px 0; }
.differences li { display:flex; align-items:baseline; justify-content:space-between; flex-wrap:wrap; gap:4px 12px; border-bottom:1px solid var(--sv-border-subtle); padding:10px 0; font-size:14px; }
.differences li span { color:var(--sv-text-secondary); font-size:13px; }
.differences li p { flex-basis:100%; margin:0; }
@media (max-width: 768px) {
  .import-actions :deep(.el-button), .job > .el-button, summary { min-height: 44px; }
  summary { padding: 12px 0; box-sizing: border-box; }
}
</style>
