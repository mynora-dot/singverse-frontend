<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElButton, ElDropdown, ElDropdownItem, ElDropdownMenu, ElIcon, ElProgress } from 'element-plus'
import { ArrowRight, Download, FolderOpened, MoreFilled, Setting, Upload } from '@element-plus/icons-vue'
import type { EmbeddedSummary } from '../api/embeddedMetadata'
import type { MediaSource, ScanTask } from '../types'
import { useSourceShare } from '../source-share'
import { displayWebDavLocation } from '../webdav-location'
import ShareImportPanel from './ShareImportPanel.vue'
import WebDavMaintenance from './WebDavMaintenance.vue'

const props = defineProps<{
  source: MediaSource; summary?: EmbeddedSummary; task?: ScanTask; taskError?: string; importJobId?: string
  ingest?: { state: string; error?: string }; scanDisabled?: boolean; cancelling?: boolean
  profileLoading?: boolean; profileName?: string
}>()
const emit = defineEmits<{
  songs: []; scan: []; cancelScan: []; edit: []; remove: []; recognition: []
  updated: [jobId?: string]; configured: [value: EmbeddedSummary]
}>()
const row = ref<HTMLElement>(), seen = ref(typeof IntersectionObserver === 'undefined')
const loadJobs = computed(() => seen.value || !!props.importJobId)
let observer: IntersectionObserver | undefined
onMounted(() => {
  if (seen.value || !row.value) return
  observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) { seen.value = true; observer?.disconnect() }
  }, { rootMargin: '160px' })
  observer.observe(row.value)
})
onBeforeUnmount(() => observer?.disconnect())
const { base, job, busy, error, active, progress, download, start } = useSourceShare(props.source.id, () => loadJobs.value)
const advanced = ref(false), importing = ref(false), rebound = ref<string>(), moreButton = ref<InstanceType<typeof ElButton>>()
const count = computed(() => props.summary?.quality?.songs)
const directory = computed(() => {
  const display = displayWebDavLocation(props.source.location)
  const [, origin = '', path = display] = /^(https?:\/\/[^/?#]*\/?)([\s\S]*)$/i.exec(display) ?? []
  return { origin, segments: path.match(/[^/]*\/|[^/]+$/g) ?? [] }
})
const ingestActive = computed(() => ['QUEUED', 'RUNNING'].includes(props.ingest?.state ?? ''))
const scanErrors = computed(() => [...new Set([props.ingest?.error, props.task?.error, props.source.lastScanError].filter(Boolean))].join(' · '))
const activity = computed(() => {
  if (props.taskError) return '状态读取失败：' + props.taskError + '，正在重试'
  const task = props.task
  if (task && ['QUEUED', 'RUNNING'].includes(task.status)) {
    if (task.cancelRequested) return '正在取消扫描'
    if (task.phase === 'COMMITTING') return '正在提交索引'
    return task.status === 'QUEUED' ? '扫描排队中' : '正在扫描目录'
  }
  if (ingestActive.value) return props.ingest?.state === 'QUEUED' ? '等待后台入库' : '正在后台入库'
  if (scanErrors.value) return scanErrors.value
  if (task?.status === 'FAILED' || task?.status === 'INTERRUPTED') return task.status === 'FAILED' ? '扫描失败' : '扫描已中断'
  if (props.summary?.importProcessing) return '正在处理曲库资料'
  if (props.summary?.enabled && !props.summary.paused && (props.summary.counts.RUNNING || props.summary.counts.QUEUED)) return '正在完善歌曲信息'
  return props.summary?.files?.pending ? '正在生成曲库文件' : ''
})
watch(() => props.importJobId, () => { rebound.value = undefined; advanced.value = false })
function reloaded(id?: string) {
  if (id) { rebound.value = id; advanced.value = false }
  emit('updated', id)
}
function closeSettings() {
  advanced.value = false
  void nextTick(() => moreButton.value?.$el.focus())
}
</script>
<template>
  <article ref="row" :id="'webdav-source-' + source.id" class="webdav-source" :aria-labelledby="'webdav-name-' + source.id" tabindex="-1" @focusin.once="seen = true">
    <ShareImportPanel :key="source.location" :source="source" :summary="summary" :activity="activity" :load-jobs="loadJobs" :job-id="rebound || importJobId" @active="importing = $event" @updated="emit('updated')" @songs="emit('songs')" @maintenance="advanced = true">
      <template #toolbar="{ choose, selected, disabled }">
        <div class="record">
          <ElIcon class="folder" aria-hidden="true"><FolderOpened /></ElIcon>
          <h2 :id="'webdav-name-' + source.id">{{ source.name }}</h2>
          <p class="source-location" role="group" aria-label="媒体目录"><span class="origin">{{ directory.origin }}</span><wbr><template v-for="(segment, index) in directory.segments" :key="index"><span class="path-segment">{{ segment }}</span><wbr></template></p>
          <div class="source-actions">
            <ElButton class="view-songs" text aria-label="查看歌曲" :aria-describedby="count == null ? undefined : 'webdav-count-' + source.id" @click="emit('songs')">
              查看歌曲<span v-if="count != null" :id="'webdav-count-' + source.id" class="song-count">{{ count.toLocaleString('zh-CN') }} 首</span><ElIcon aria-hidden="true"><ArrowRight /></ElIcon>
            </ElButton>
            <ElButton class="import-button" :type="selected ? 'default' : 'primary'" :icon="Upload" :disabled="disabled" @click="choose">{{ selected ? '更换资料包' : '导入资料包' }}</ElButton>
          </div>
          <ElDropdown class="record-menu" trigger="click" placement="bottom-end" :teleported="true" :show-arrow="false" popper-class="source-actions-dropdown">
            <ElButton ref="moreButton" class="more-button" text :icon="MoreFilled" :aria-label="source.name + '的更多操作'" title="更多" />
            <template #dropdown><ElDropdownMenu>
              <ElDropdownItem :icon="Download" :disabled="count === 0 || active || busy" @click="start()">{{ job?.state === 'FAILED' ? '重试导出资料包' : '导出资料包' }}</ElDropdownItem>
              <ElDropdownItem :icon="Setting" @click="advanced = true">维护与设置</ElDropdownItem>
            </ElDropdownMenu></template>
          </ElDropdown>
        </div>
      </template>
    </ShareImportPanel>
    <div v-if="active" class="export-status" role="status"><span>正在准备资料包</span><ElProgress :percentage="progress" :indeterminate="job?.state === 'WAITING'" /></div>
    <a v-else-if="download" class="download" :href="download" download="singverse-share-set.zip"><ElIcon aria-hidden="true"><Download /></ElIcon>下载资料包</a>
    <p v-else-if="job?.state === 'FAILED'" class="export-status" role="status">资料包导出失败 <ElButton link type="primary" :disabled="busy" @click="start()">重试导出</ElButton></p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <WebDavMaintenance v-if="advanced" :key="source.location" :source="source" :summary="summary" :task="task" :importing="importing || !!summary?.importProcessing" :scan-disabled="scanDisabled || ingestActive" :cancelling="cancelling" :profile-name="profileName" :profile-loading="profileLoading"
      @close="closeSettings" @scan="emit('scan')" @cancel-scan="emit('cancelScan')" @edit="emit('edit')" @remove="emit('remove')" @recognition="emit('recognition')" @configured="value => emit('configured', value)" @updated="reloaded">
      <p v-if="scanErrors">{{ scanErrors }}</p>
      <details v-if="job?.state === 'SUCCEEDED'"><summary>导出选项</summary>
        <ElButton :disabled="busy || active" @click="start(true)">仅分享新增和变化</ElButton>
        <span v-if="!job.part_count">暂无新增资料</span>
        <div v-else class="share-parts"><a v-for="part in job.part_count" :key="part" :href="base + '/' + job.id + '/parts/' + part" :download="'part-' + String(part).padStart(6, '0') + '.zip'">分包 {{ part }}</a></div>
      </details>
    </WebDavMaintenance>
  </article>
</template>
<style scoped>
.webdav-source { min-width:0; align-self:start; padding:20px 24px; color:var(--sv-text-primary); border:1px solid var(--sv-border-subtle); border-radius:var(--sv-radius-lg); background:var(--sv-surface-2); scroll-margin-block:85px 18px; }
.webdav-source:focus-visible { outline:2px solid var(--sv-accent-primary); outline-offset:2px; }
.record { display:grid; grid-template-columns:44px minmax(0,1fr) auto 44px; grid-template-areas:"folder name actions more" "folder location actions more"; align-items:center; gap:3px 16px; }
.folder { grid-area:folder; width:44px; height:44px; font-size:44px; color:var(--sv-accent-primary); }
h2 { grid-area:name; margin:0; font-size:20px; line-height:1.4; overflow-wrap:anywhere; }
.source-location { grid-area:location; margin:0; font-size:14px; line-height:1.65; color:var(--sv-text-secondary); overflow-wrap:anywhere; }
.path-segment { color:var(--sv-text-primary); display:inline-block; max-width:100%; vertical-align:bottom; }
.source-actions { grid-area:actions; display:flex; align-items:center; gap:12px; }
.source-actions .el-button { min-height:44px; margin:0; font-size:14px; }
.view-songs { padding:0 8px; }
.view-songs :deep(> span) { gap:7px; }
.song-count { font-weight:400; font-variant-numeric:tabular-nums; color:var(--sv-text-secondary); }
.record-menu { grid-area:more; }
.more-button { width:44px; min-height:44px; padding:0; }
.export-status,.download,.share-parts { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin:12px 0 0; font-size:14px; }
.export-status .el-progress { width:min(160px,100%); }
.download { width:fit-content; min-height:40px; }
a { color:var(--sv-accent-primary); } .error { color:var(--sv-semantic-danger); overflow-wrap:anywhere; }
summary { cursor:pointer; padding:10px 0; }
@media(max-width:900px) {
 .record { grid-template-columns:40px minmax(0,1fr) 44px; grid-template-areas:"folder name more" "folder location more" "actions actions actions"; }
 .source-actions { padding-top:10px; margin-top:10px; border-top:1px solid var(--sv-border-subtle); justify-content:space-between; }
}
@media(max-width:560px) {
 .webdav-source { padding:12px 15px; }
 .record { grid-template-columns:28px minmax(0,1fr) 44px; grid-template-areas:"folder name more" "location location location" "actions actions actions"; column-gap:9px; }
 .folder { width:28px; height:28px; font-size:28px; } h2 { font-size:18px; }
 .origin { display:block; }
 .source-actions { flex-wrap:wrap; gap:4px; margin-top:6px; }
 .view-songs { padding:0; } .view-songs :deep(> span) { gap:4px; }
 .import-button { padding-inline:10px; }
}
</style>
