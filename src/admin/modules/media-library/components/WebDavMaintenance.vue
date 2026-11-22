<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElAlert, ElButton, ElInput, ElMessage, ElMessageBox } from 'element-plus'
import { authRequest } from '../../../core/auth/api'
import { useVisiblePolling } from '../../../shared/composables/use-visible-polling'
import { embeddedMetadata, embeddedState, type EmbeddedSummary, type EmbeddedDetail } from '../api/embeddedMetadata'
import { media } from '../api/media'
import type { MediaSource, ScanTask } from '../types'
import MediaRebindPanel from './MediaRebindPanel.vue'

const props = defineProps<{
  source: MediaSource; summary?: EmbeddedSummary; task?: ScanTask; importing: boolean
  scanDisabled?: boolean; cancelling?: boolean; profileName?: string; profileLoading?: boolean
}>()
const emit = defineEmits<{
  close: []; scan: []; cancelScan: []; edit: []; remove: []; recognition: []
  configured: [value: EmbeddedSummary]; updated: [jobId?: string]
}>()
const heading = ref<HTMLElement>(), busy = ref(false), error = ref('')
const accessGroup = ref(''), origins = ref('')
const sampleId = ref(''), sampleName = ref(''), sample = ref<EmbeddedDetail>()
const diagnosis = ref<{ directoryMessage: string; mediaMessage: string }>()
const activeScan = computed(() => ['QUEUED', 'RUNNING'].includes(props.task?.status ?? ''))
const extractionDisabled = computed(() => props.importing || !props.summary || busy.value ||
  (props.summary.quality?.songs ?? props.summary.quality?.total) === 0)
watch(() => !!props.summary, ready => {
  if (ready) { accessGroup.value = props.summary!.accessGroup; origins.value = (props.summary!.privateOrigins ?? []).join('\n') }
}, { immediate: true })
onMounted(() => heading.value?.focus({ preventScroll: true }))

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
      ? { enabled: true, paused: saved.enabled && !saved.paused, accessGroup: saved.accessGroup, privateOrigins: saved.privateOrigins }
      : { enabled: saved.enabled, paused: saved.paused, accessGroup: accessGroup.value, privateOrigins: origins.value.split('\n').map(v => v.trim()).filter(Boolean) }
    emit('configured', await embeddedMetadata.configure(props.source.id, settings))
    ElMessage.success('已保存')
  })
}
const samplePolling = useVisiblePolling(async () => {
  if (!sampleId.value) return
  try { sample.value = await embeddedMetadata.detail(sampleId.value) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '读取样本失败' }
}, () => ['QUEUED','PENDING','RUNNING'].includes(sample.value?.state ?? '') ? 2000 : undefined, { immediate: false })
function trial() {
  if (extractionDisabled.value || props.summary?.paused) return
  void perform(async () => {
    const song = (await media.songs(props.source.id, 0, 1)).items[0]
    if (!song) throw new Error('请先扫描歌曲')
    sampleId.value = song.id; sampleName.value = song.relativePath
    const cached = await embeddedMetadata.detail(song.id)
    if (cached.state === 'PENDING' || cached.state === 'NOT_WEBDAV') await embeddedMetadata.refresh([song.id])
    await samplePolling.refresh()
  })
}
function diagnose() {
  void perform(async () => {
    diagnosis.value = await authRequest('/api/v1/media-sources/' + encodeURIComponent(props.source.id) + '/diagnostics', 'POST')
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
  <section class="maintenance" :aria-labelledby="'maintenance-' + source.id">
    <div class="section-heading"><h3 ref="heading" :id="'maintenance-' + source.id" tabindex="-1">维护与设置</h3><ElButton text @click="emit('close')">收起设置</ElButton></div>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <div class="embedded-action">
      <h4>完善歌曲信息</h4>
      <div class="controls">
        <ElButton :disabled="extractionDisabled" @click="save(true)">{{ summary?.paused ? '继续自动提取' : summary?.enabled ? '暂停自动提取' : '开始自动提取' }}</ElButton>
        <ElButton :disabled="extractionDisabled || !!summary?.paused" @click="trial">试提取一首</ElButton>
      </div>
      <div v-if="sample" class="sample-result" role="status"><strong>{{ embeddedState(sample.state) }}</strong><p>{{ sampleName }}</p>
        <div v-if="sample.result">
          <img v-if="sample.result.cover" :src="'/api/v1/media-songs/' + encodeURIComponent(sampleId) + '/embedded-metadata/cover'" alt="样本内嵌封面">
          <strong>{{ sample.result.tags?.title || (sample.result.fields?.title === 'ABSENT' ? '文件未提供内嵌歌名' : '尚未读取到内嵌歌名') }}</strong>
          <p>{{ sample.result.tags?.artists?.join('、') || '尚未读取到内嵌歌手' }}</p>
          <details v-if="sample.result.lyrics"><summary>查看歌词</summary><pre>{{ sample.result.lyrics.text }}</pre></details>
        </div>
      </div>
      <p v-if="summary?.blockedReason">{{ embeddedState(summary.blockedReason) }}</p>
      <p v-if="summary?.enabled && !summary.paused && !summary.remoteReady && summary.nodeMessage">{{ summary.nodeMessage }}</p>
      <p v-if="summary?.budget && (summary.budget.files_started || summary.budget.bytes_read)">今日已处理 {{ summary.budget.files_started }} 首，读取 {{ (summary.budget.bytes_read / 1048576).toFixed(1) }} MiB。</p>
    </div>
    <div class="controls">
      <ElButton :disabled="scanDisabled || importing || activeScan || busy" @click="emit('scan')">重新扫描歌曲</ElButton>
      <ElButton :disabled="busy" @click="diagnose">诊断目录与分段读取</ElButton>
      <ElButton :disabled="profileLoading" @click="emit('recognition')">文件名识别<span v-if="profileName"> · {{ profileName }}</span></ElButton>
    </div>
    <p v-if="diagnosis" role="status">目录：{{ diagnosis.directoryMessage }}<br>媒体：{{ diagnosis.mediaMessage }}</p>
    <p>{{ source.scanEnabled ? '自动扫描已开启' : '自动扫描未开启' }}<template v-if="source.nextScanAt"> · 下次 {{ new Date(source.nextScanAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) }}</template></p>
    <p v-if="summary?.quality">{{ summary.quality.variants ?? summary.quality.total }} 个版本 · {{ summary.quality.files ?? summary.quality.total }} 个媒体文件 · {{ summary.quality.identityComplete }} 首歌名和歌手齐全</p>
    <p v-if="summary?.files && (summary.files.pending || summary.files.failed || summary.files.attachments)"><span v-if="summary.files.pending">{{ summary.files.pending }} 项衍生文件生成中　</span><span v-if="summary.files.failed">{{ summary.files.failed }} 项衍生文件待重试　</span><span v-if="summary.files.attachments">封面待补齐</span></p>
    <div v-if="task" class="scan-progress">
      <p v-if="task.status === 'CANCELLED'">扫描已取消</p>
      <p>已处理 {{ task.directories }} 个目录、{{ task.entries }} 个条目；{{ task.totalSongs }} 首，{{ task.needsReviewSongs }} 首文件名识别不完整</p>
      <p v-if="task.status === 'SUCCEEDED'">扫描完成 · 新增 {{ task.addedSongs ?? 0 }} · 复用 {{ task.reusedSongs ?? 0 }} · 待确认删除 {{ task.missingSongs ?? 0 }} · 下架 {{ task.removedSongs ?? 0 }}</p>
      <ElButton v-if="activeScan && task.phase === 'SCANNING'" :loading="cancelling" :disabled="task.cancelRequested" @click="emit('cancelScan')">取消扫描</ElButton>
    </div>
    <MediaRebindPanel :source="source" :disabled="importing" @updated="id => emit('updated', id)" />
    <details><summary>访问组与代理</summary>
      <label>共享访问组<ElInput v-model="accessGroup" maxlength="64" /></label>
      <label>私有下载代理（每行一个地址）<ElInput v-model="origins" type="textarea" :rows="2" /></label>
      <ElButton :disabled="busy || !summary" @click="save(false)">保存高级设置</ElButton>
    </details>
    <slot />
    <div class="controls source-settings">
      <ElButton @click="emit('edit')">编辑</ElButton>
      <ElButton v-if="summary?.canConfirmEmpty" type="danger" plain :disabled="busy || importing" @click="confirmEmpty">确认空库同步</ElButton>
      <ElButton type="danger" text @click="emit('remove')">移除</ElButton>
    </div>
  </section>
</template>
<style scoped>
.maintenance { min-width:0; border-top:1px solid var(--sv-border-subtle); margin-top:16px; padding-top:10px; }
.section-heading,.controls { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
.section-heading { justify-content:space-between; }
h3,h4 { margin:0; color:var(--sv-text-primary); }
h3 { font-size:17px; } h3:focus { outline:none; } h4 { margin:10px 0; font-size:15px; }
p,label,summary { font-size:14px; line-height:1.65; }
p { color:var(--sv-text-secondary); margin:8px 0; overflow-wrap:anywhere; }
.controls .el-button { margin:0; }
.sample-result { margin:10px 0; } .sample-result img { width:72px; height:72px; object-fit:cover; }
.sample-result pre { white-space:pre-wrap; }
summary { cursor:pointer; padding:10px 0; } label { display:block; margin:10px 0; }
.source-settings { margin-top:12px; }
@media(max-width:768px){ .controls .el-button,summary { min-height:44px; } }
</style>
