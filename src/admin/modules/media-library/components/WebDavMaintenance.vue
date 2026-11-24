<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElAlert, ElButton, ElInput, ElMessage, ElMessageBox } from 'element-plus'
import { embeddedMetadata, embeddedState, type EmbeddedSummary } from '../api/embeddedMetadata'
import type { MediaSource, ScanTask } from '../types'

const props = defineProps<{
  source: MediaSource; summary?: EmbeddedSummary; task?: ScanTask; importing: boolean
  scanDisabled?: boolean; cancelling?: boolean; profileName?: string; profileLoading?: boolean
}>()
const emit = defineEmits<{
  scan: []; cancelScan: []; edit: []; remove: []; recognition: []
  configured: [value: EmbeddedSummary]; updated: []
}>()
const busy = ref(false), error = ref('')
const origins = ref('')
const activeScan = computed(() => ['QUEUED', 'RUNNING'].includes(props.task?.status ?? ''))
const extractionDisabled = computed(() => props.importing || !props.summary || busy.value ||
  (props.summary.quality?.songs ?? props.summary.quality?.total) === 0)
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
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <div class="embedded-action">
      <h3>完善歌曲信息</h3>
      <div class="controls">
        <ElButton :disabled="extractionDisabled" @click="save(true)">{{ summary?.paused ? '继续自动提取' : summary?.enabled ? '暂停自动提取' : '开始自动提取' }}</ElButton>
      </div>
      <p v-if="summary?.blockedReason">{{ embeddedState(summary.blockedReason) }}</p>
      <p v-if="summary?.enabled && !summary.paused && !summary.remoteReady && summary.nodeMessage">{{ summary.nodeMessage }}</p>
      <p v-if="summary?.budget && (summary.budget.files_started || summary.budget.bytes_read)">今日已处理 {{ summary.budget.files_started }} 首，读取 {{ (summary.budget.bytes_read / 1048576).toFixed(1) }} MiB。</p>
    </div>
    <div class="controls">
      <ElButton :disabled="scanDisabled || importing || activeScan || busy" @click="emit('scan')">重新扫描歌曲</ElButton>
      <ElButton :disabled="profileLoading" @click="emit('recognition')">文件名识别<template v-if="profileName"> · {{ profileName }}</template></ElButton>
    </div>
    <p>{{ source.scanEnabled ? '自动扫描已开启' : '自动扫描未开启' }}<template v-if="source.nextScanAt"> · 下次 {{ new Date(source.nextScanAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) }}</template></p>
    <p v-if="summary?.quality">{{ summary.quality.variants ?? summary.quality.total }} 个版本 · {{ summary.quality.files ?? summary.quality.total }} 个媒体文件 · {{ summary.quality.identityComplete }} 首歌名和歌手齐全</p>
    <p v-if="summary?.files && (summary.files.pending || summary.files.failed || summary.files.attachments)"><span v-if="summary.files.pending">{{ summary.files.pending }} 项衍生文件生成中　</span><span v-if="summary.files.failed">{{ summary.files.failed }} 项衍生文件待重试　</span><span v-if="summary.files.attachments">封面待补齐</span></p>
    <div v-if="task" class="scan-progress">
      <p v-if="task.status === 'CANCELLED'">扫描已取消</p>
      <p>已处理 {{ task.directories }} 个目录、{{ task.entries }} 个条目；{{ task.totalSongs }} 首，{{ task.needsReviewSongs }} 首文件名识别不完整</p>
      <p v-if="task.status === 'SUCCEEDED'">扫描完成 · 新增 {{ task.addedSongs ?? 0 }} · 复用 {{ task.reusedSongs ?? 0 }} · 待确认删除 {{ task.missingSongs ?? 0 }} · 下架 {{ task.removedSongs ?? 0 }}</p>
      <ElButton v-if="activeScan && task.phase === 'SCANNING'" :loading="cancelling" :disabled="task.cancelRequested" @click="emit('cancelScan')">取消扫描</ElButton>
    </div>
    <details><summary>私有下载代理</summary>
      <label>代理地址（每行一个）<ElInput v-model="origins" type="textarea" :rows="2" /></label>
      <ElButton :disabled="busy || !summary" @click="save(false)">保存代理设置</ElButton>
    </details>
    <slot />
    <div class="controls source-settings">
      <ElButton @click="emit('edit')">编辑</ElButton>
      <ElButton v-if="summary?.canConfirmEmpty" type="danger" plain :disabled="busy || importing" @click="confirmEmpty">确认空库同步</ElButton>
      <ElButton type="danger" text @click="emit('remove')">移除</ElButton>
    </div>
  </div>
</template>
<style scoped>
.controls { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
.embedded-action + .controls { margin-top:12px; }
h3 { margin:0 0 10px; font-size:15px; color:var(--sv-text-primary); }
p,label { font-size:14px; line-height:1.65; }
p { color:var(--sv-text-secondary); margin:8px 0; overflow-wrap:anywhere; }
.controls .el-button { max-width:100%; min-height:44px; height:auto; margin:0; white-space:normal; line-height:1.5; }
.maintenance :deep(summary) { min-height:44px; padding:10px 0; font-size:14px; line-height:1.65; cursor:pointer; }
label { display:block; margin:10px 0; }
.source-settings { margin-top:12px; }
</style>
