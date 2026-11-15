<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElAlert, ElButton, ElPopover } from 'element-plus'
import TaskGuide from '../../shared/ui/TaskGuide.vue'
import PageHeader from '../../shared/ui/PageHeader.vue'
import { useVisiblePolling } from '../../shared/composables/use-visible-polling'
import { authRequest } from '../../core/auth/api'
import { base, type Batch, type Node } from './api'
import { backendName, failure, isRecognition, nodeWorking, profileName, profileReady, readiness as evaluate } from './presentation'
import SongsTab from './components/SongsTab.vue'
import BatchesTab from './components/BatchesTab.vue'
import BatchConfirmDialog from './components/BatchConfirmDialog.vue'

type Tab = 'songs' | 'recognition' | 'tasks'
const route = useRoute(), router = useRouter()
const tabs: { id: Tab; name: string }[] = [{ id: 'songs', name: '歌曲' }, { id: 'recognition', name: '识别任务' }, { id: 'tasks', name: '生成任务' }]
const tab = computed<Tab>(() => tabs.some(item => item.id === route.query.tab) ? route.query.tab as Tab : 'songs')
const songId = computed(() => typeof route.query.song === 'string' ? route.query.song : '')
const node = ref<Node>(), nodeError = ref(''), error = ref('')
const batches = ref<Batch[]>([]), batchPage = ref(0), batchTotal = ref(0)
const focus = computed(() => typeof route.query.batch === 'string' ? route.query.batch : '')
const recognitionBatches = ref<Batch[]>([]), recognitionPage = ref(0), recognitionTotal = ref(0)
const preview = ref<Batch>(), starting = ref(false)
const songsTab = ref<InstanceType<typeof SongsTab>>(), batchesTab = ref<InstanceType<typeof BatchesTab>>()
const recognitionTab = ref<InstanceType<typeof BatchesTab>>()
const tabButtons = ref<HTMLButtonElement[]>([])
const readiness = computed(() => evaluate(node.value, nodeError.value))
const anyReady = computed(() => readiness.value.ready || node.value?.separation?.profiles.some(item => item.ready))
const previewReady = computed(() => preview.value?.kind === 'FAST' ? readiness.value.connected : preview.value?.kind === 'ANALYZE' ? readiness.value.ready : profileReady(node.value?.separation, preview.value?.separationProfile || 'LEGACY_DEMUCS', readiness.value.ready))
const activeBatches = computed(() => batches.value.filter(batch => ['PREPARING', 'QUEUED'].includes(batch.state)).length)
const activeRecognitions = computed(() => recognitionBatches.value.filter(batch => ['PREPARING', 'QUEUED'].includes(batch.state)).length)
let active = true, batchRequest = 0, recognitionRequest = 0, previewGeneration = 0
let firstRefresh = true
const polling = useVisiblePolling(async () => {
  const first = firstRefresh; firstRefresh = false
  await refresh(first)
}, () => activeBatches.value || activeRecognitions.value || preview.value?.state === 'PREPARING' || nodeWorking(node.value)
  ? 4000 : nodeError.value || error.value ? 10000 : 30000)

function setup() { void router.push('/system/compute#audio-models') }
watch(() => route.query.tab, value => { if (value === 'setup') void router.replace('/system/compute#audio-models') }, { immediate: true })
function navigate(next: Tab, extra: Record<string, string> = {}) {
  const query: Record<string, string> = { ...extra }
  if (next !== 'songs') query.tab = next
  void router.replace({ path: route.path, query })
}
function keyNav(event: KeyboardEvent, index: number) {
  const step = { ArrowRight: 1, ArrowLeft: -1, Home: -index, End: tabs.length - 1 - index }[event.key]
  if (step === undefined) return
  event.preventDefault()
  const next = (index + step + tabs.length) % tabs.length
  navigate(tabs[next]!.id); void nextTick(() => tabButtons.value[next]?.focus())
}
async function loadNode(refresh = false) {
  try { const value = await authRequest<Node>(`${base}/node${refresh ? '?refresh=true' : ''}`, 'GET', undefined, 60000); if (active) { node.value = value; nodeError.value = '' } }
  catch (failed) { if (active) nodeError.value = failure(failed, '无法连接计算节点') }
}
async function loadBatches() {
  const turn = ++batchRequest
  const value = await authRequest<{ items: Batch[]; totalElements: number }>(`${base}/batches?kind=SEPARATE&page=${batchPage.value}`)
  if (active && turn === batchRequest) { batches.value = value.items; batchTotal.value = value.totalElements; polling.schedule() }
}
async function loadRecognitions() {
  const turn = ++recognitionRequest
  const value = await authRequest<{ items: Batch[]; totalElements: number }>(`${base}/batches?kind=RECOGNIZE&page=${recognitionPage.value}`)
  if (active && turn === recognitionRequest) { recognitionBatches.value = value.items; recognitionTotal.value = value.totalElements; polling.schedule() }
}
async function refresh(first = false) {
  const work: Promise<unknown>[] = [loadNode(), loadBatches(), loadRecognitions()]
  if (preview.value?.state === 'PREPARING' && !starting.value) work.push(loadPreview())
  if (!first) work.push(tab.value === 'songs' ? songsTab.value?.refresh() ?? Promise.resolve() : tab.value === 'tasks' ? batchesTab.value?.refresh() ?? Promise.resolve() : recognitionTab.value?.refresh() ?? Promise.resolve())
  const results = await Promise.allSettled(work)
  if (!active) return
  const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult | undefined
  error.value = rejected ? failure(rejected.reason, '读取失败') : ''
}
function changeBatchPage(next: number) { batchPage.value = next; void loadBatches().catch(failed => { if (active) error.value = failure(failed) }) }
function changeRecognitionPage(next: number) { recognitionPage.value = next; void loadRecognitions().catch(failed => { if (active) error.value = failure(failed) }) }
function showPreview(value: Batch) { previewGeneration++; error.value = ''; preview.value = value; polling.schedule() }
async function start() {
  if (!active || starting.value || preview.value?.state !== 'PREVIEW') return
  const id = preview.value.id, turn = ++previewGeneration
  starting.value = true; error.value = ''
  try {
    const value = await authRequest<Batch>(`${base}/batches/${encodeURIComponent(id)}/submit`, 'POST')
    if (!active || turn !== previewGeneration) return
    preview.value = undefined; songsTab.value?.clear()
    const recognizing = isRecognition(value)
    if (recognizing) recognitionPage.value = 0
    else batchPage.value = 0
    await (recognizing ? loadRecognitions() : loadBatches()); if (!active) return
    navigate(recognizing ? 'recognition' : 'tasks', { batch: value.id })
  } catch (failed) { if (active) error.value = failure(failed, isRecognition(preview.value) ? '无法开始识别' : '无法开始生成') }
  finally { if (active) starting.value = false }
}
async function closePreview() { if (starting.value) return; previewGeneration++; const recognizing = isRecognition(preview.value); preview.value = undefined; await (recognizing ? loadRecognitions() : loadBatches()).catch(() => undefined) }
async function loadPreview() {
  const id = preview.value?.id, turn = previewGeneration
  if (!id) return
  const value = await authRequest<Batch>(`${base}/batches/${encodeURIComponent(id)}?page=0`)
  if (active && turn === previewGeneration && preview.value?.id === id) preview.value = value
}
async function cancelPreparation() {
  const id = preview.value?.id
  if (!active || !id || starting.value) return
  const turn = ++previewGeneration
  starting.value = true
  try {
    const value = await authRequest<Batch>(`${base}/batches/${encodeURIComponent(id)}/cancel`, 'POST')
    if (!active || turn !== previewGeneration || preview.value?.id !== id) return
    preview.value = value; await (isRecognition(value) ? loadRecognitions() : loadBatches())
  } catch (failed) { if (active) error.value = failure(failed, '取消准备失败') }
  finally { if (active) starting.value = false }
}
onBeforeUnmount(() => { active = false })
</script>

<template>
  <section class="audio-processing">
    <PageHeader title="原唱与伴奏">
      <template #actions>
        <ElPopover trigger="click" placement="bottom-end" :width="320" popper-class="audio-environment-popover" title="音轨处理环境">
          <template #reference><button type="button" class="ready-pill" :class="anyReady && !nodeError ? 'is-ready' : 'is-pending'"><span class="sv-status-dot" :class="anyReady && !nodeError ? 'ok' : 'warn'" aria-hidden="true" />{{ nodeError ? node ? '节点状态待确认' : '节点暂不可用' : anyReady ? '生成环境已就绪' : node ? '生成环境待准备' : '正在连接计算节点' }}<span aria-hidden="true">⌄</span></button></template>
          <div class="environment-details"><p v-if="nodeError" role="status">{{ nodeError }}{{ node ? '，下方显示上次读取的环境信息。' : '' }}</p><p>{{ readiness.title }}</p><p v-if="readiness.hint">{{ readiness.hint }}</p><dl v-if="node"><div><dt>设备</dt><dd>{{ node.selected ? backendName(node.selected) : '尚未选定' }}</dd></div><div><dt>快速识别</dt><dd>{{ node.fastClassifier?.ready ? '模型已就绪' : '按可用音轨标签判断' }}</dd></div><div v-for="item in node.separation?.profiles" :key="item.id"><dt>{{ profileName(item.id) }}</dt><dd>{{ item.ready ? '已就绪' : '待准备' }}</dd></div></dl><ElButton @click="setup()">管理模型与设备</ElButton></div>
        </ElPopover>
      </template>
      <template #meta><p class="page-subtitle">先检查已有音轨，没有伴奏时再生成。</p></template>
      <template #description>
        <p>扫描未完成的歌曲可批量重新识别原唱与伴奏；没有自带伴奏时，再按需要生成独立伴奏。</p>
        <TaskGuide v-if="tab === 'songs'" label="原唱与伴奏准备流程" :steps="[{ title: '先检查音轨', description: '识别已有原唱与伴奏，试听后标记。' }, { title: '按需要生成', description: '没有伴奏时，先试片段再生成整曲。' }, { title: '核对成果版本', description: '试听处理结果，保留原始媒体。' }]" />
      </template>
    </PageHeader>
    <div class="audio-workbench">
    <div class="tabs" role="tablist" aria-label="原唱与伴奏功能">
      <button v-for="(item, index) in tabs" :id="'audio-tab-' + item.id" :key="item.id" ref="tabButtons" type="button" role="tab" class="tab" :class="{ 'is-active': tab === item.id }" :aria-selected="tab === item.id" :aria-controls="'audio-panel-' + item.id" :tabindex="tab === item.id ? 0 : -1" @click="navigate(item.id)" @keydown="keyNav($event, index)">
        {{ item.name }}<span v-if="(item.id === 'tasks' && activeBatches) || (item.id === 'recognition' && activeRecognitions)" class="sv-count-pill" :aria-label="`${item.id === 'recognition' ? activeRecognitions : activeBatches} 个进行中`">{{ item.id === 'recognition' ? activeRecognitions : activeBatches }}</span>
      </button>
    </div>
    <ElAlert v-if="error" :title="error" type="error" show-icon :closable="false" role="alert" class="page-error" />
    <section :id="'audio-panel-' + tab" role="tabpanel" :aria-labelledby="'audio-tab-' + tab" class="panel">
      <KeepAlive>
        <SongsTab v-if="tab === 'songs'" ref="songsTab" :song-id="songId" :readiness="readiness" :backends="node?.backends || []" :separation="node?.separation" :recognition-ready="readiness.connected" :fast-ready="node?.fastClassifier?.ready" @preview="showPreview" @setup="setup()" @show-all="navigate('songs')" />
        <BatchesTab v-else-if="tab === 'recognition'" key="recognition" ref="recognitionTab" recognition :can-analyze="readiness.ready" :batches="recognitionBatches" :total="recognitionTotal" :page="recognitionPage" :focus="focus" :backends="node?.backends || []" @preview="showPreview" @page="changeRecognitionPage" @changed="loadRecognitions" @songs="navigate('songs')" @song="navigate('songs', { song: $event })" />
        <BatchesTab v-else-if="tab === 'tasks'" key="generation" ref="batchesTab" :batches="batches" :total="batchTotal" :page="batchPage" :focus="focus" :backends="node?.backends || []" @preview="showPreview" @page="changeBatchPage" @changed="loadBatches" @songs="navigate('songs')" @song="navigate('songs', { song: $event })" />
      </KeepAlive>
    </section>
    </div>
    <BatchConfirmDialog :batch="preview" :ready="previewReady" :busy="starting" :error="error" @start="start" @close="closePreview" @cancel="cancelPreparation" />
  </section>
</template>

<style scoped>
.audio-processing{min-width:0}.audio-processing :deep(.sv-page-header){margin-bottom:24px;align-items:center}.audio-processing :deep(.sv-page-header h1){font-size:28px;line-height:1.3;letter-spacing:-.4px}.page-subtitle{margin:8px 0 0;color:var(--sv-text-secondary);font-size:14px;line-height:1.6}.ready-pill{display:inline-flex;gap:8px;align-items:center;min-height:36px;padding:0 12px;border:1px solid var(--sv-border-subtle);border-radius:6px;background:var(--sv-surface-2);color:var(--sv-text-secondary);font:inherit;font-size:12px;cursor:pointer}.ready-pill:hover{border-color:var(--sv-border-default)}.audio-workbench{min-width:0;border:1px solid var(--sv-border-default);border-radius:12px;background:var(--sv-surface-2)}.tabs{display:flex;gap:16px;margin:0;padding:0 24px;border-bottom:1px solid var(--sv-border-subtle);overflow-x:auto}.tab{display:inline-flex;gap:8px;align-items:center;min-height:54px;padding:0 4px;border:0;border-bottom:2px solid transparent;margin-bottom:-1px;background:none;color:var(--sv-text-secondary);font:inherit;font-size:14px;cursor:pointer;white-space:nowrap}.tab:hover{color:var(--sv-text-primary)}.tab.is-active{border-bottom-color:var(--sv-accent-primary);color:var(--sv-accent-primary);font-weight:600}.tab:focus-visible,.ready-pill:focus-visible{outline:2px solid var(--sv-accent-primary);outline-offset:-4px}.page-error{margin:16px 24px;width:auto}.panel{min-width:0}.panel :deep(.batches-tab){padding:20px 24px}.environment-details{display:grid;gap:12px;color:var(--sv-text-secondary);font-size:13px;line-height:1.6}.environment-details p{margin:0}.environment-details dl{display:grid;gap:8px;margin:0;padding:12px 0;border-block:1px solid var(--sv-border-subtle)}.environment-details dl>div{display:flex;justify-content:space-between;gap:16px}.environment-details dt{font-size:12px}.environment-details dd{margin:0;color:var(--sv-text-primary);text-align:right}.environment-details :deep(.el-button){margin:0;min-height:40px}
@media(max-width:768px){.audio-processing :deep(.sv-page-header){margin-bottom:20px;align-items:flex-start;gap:16px}.audio-processing :deep(.sv-page-header h1){font-size:26px}.page-subtitle{font-size:16px;max-width:30em}.tab,.ready-pill{min-height:44px}.tabs{padding:0 16px;gap:20px}.tab{font-size:16px}.panel :deep(.batches-tab){padding:16px}.ready-pill{font-size:13px}.audio-processing :deep(.sv-page-header-actions){justify-content:flex-start}.environment-details{font-size:14px}}
@media(max-width:560px){.audio-processing :deep(.sv-page-header){flex-direction:column;gap:12px}.audio-workbench{border-radius:10px}.page-error{margin:12px}.tabs{gap:16px}.tab{font-size:14px;min-height:48px}}

.audio-processing :deep(.sv-page-header-copy){display:block;min-width:0}.ready-pill{min-height:44px}.tab{min-width:44px}.audio-processing :deep(.sv-page-header-help){min-width:44px;min-height:44px}
@media(max-width:560px){.audio-processing :deep(.sv-page-header){position:relative;display:block}.audio-processing :deep(.sv-page-header h1){white-space:nowrap;padding-right:190px;font-size:26px}.audio-processing :deep(.sv-page-header-actions){position:absolute;right:0;top:-5px;gap:0}.ready-pill{font-size:12px;padding:0 8px}.page-subtitle{margin-top:12px;font-size:16px;max-width:none;width:100%;line-height:1.6}}
@media(max-width:360px){.audio-processing :deep(.sv-page-header h1){padding-right:0}.audio-processing :deep(.sv-page-header-actions){position:static;margin-top:12px}}
</style>
