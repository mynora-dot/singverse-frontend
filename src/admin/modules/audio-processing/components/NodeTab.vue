<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { ElAlert, ElButton, ElTag } from 'element-plus'
import { authRequest } from '../../../core/auth/api'
import { base, importModel, type Model, type Node } from '../api'
import { backendName, backendStates, bytes, failure, modelNames, operationStates, type Readiness } from '../presentation'
import { applicableModels, isDetectedBackend, isRelevantBackend } from '../node-hardware'

const props = defineProps<{ node?: Node; nodeError: string; readiness: Readiness; reload: (refresh?: boolean) => Promise<void>; modelsOnly?: boolean }>()
const emit = defineEmits<{ 'busy-change': [value: boolean] }>()
const busy = ref(false), error = ref('')
const detected = computed(() => props.node?.backends.filter(item => !['cpu', 'xpu'].includes(item.id) && isDetectedBackend(item)) || [])
const visibleBackends = computed(() => props.node?.backends.filter(item => item.id === 'cpu' || detected.value.some(found => found.id === item.id)) || [])
const rknn = (model: Model) => model.id === 'uvr-mdxnet-9482-rknn'
const modelName = (model: Model) => modelNames[model.id]?.name || model.id
const modelState = (model: Model) => model.installed ? '已安装' : !model.writable ? '模型目录不可写' : '未安装'
const downloadForm = ref<{ model: string; url: string; sha256: string }>()
const downloadError = ref('')
const downloadInvalid = ref<'url' | 'sha256'>()
const catalog = computed<Model[]>(() => [
  ...(props.node?.fastClassifier ? [props.node.fastClassifier] : []),
  ...(props.node ? applicableModels(props.node).filter(model => !props.modelsOnly || model.id !== 'uvr-mdxnet-9482') : []),
])
const modelGroups = computed(() => props.modelsOnly ? [
  { title: '伴奏', models: catalog.value.filter(model => model.id !== 'panns-cnn6') },
  { title: '音轨识别', models: catalog.value.filter(model => model.id === 'panns-cnn6') },
].filter(group => group.models.length) : [{ title: '', models: catalog.value }])
const modelBusy = computed(() => ['DOWNLOADING', 'IMPORTING', 'VERIFYING', 'TESTING'].includes(props.node?.operation.state || ''))
const modelLocked = computed(() => busy.value || modelBusy.value || !!props.nodeError)
const auto = computed(() => props.node?.selection === 'auto')
async function run(task: () => Promise<unknown>, refresh = false) {
  if (busy.value) return
  busy.value = true; emit('busy-change', true); error.value = ''
  try { await task(); await props.reload(refresh) } catch (failed) { error.value = failure(failed) }
  finally { busy.value = false; emit('busy-change', false) }
}
async function setFallback(event: Event) {
  const input = event.target as HTMLInputElement, enabled = input.checked
  input.checked = props.node?.cpuFallback !== false
  await run(async () => {
    const current = await authRequest<{ backend: string; revision: number }>('/api/v1/transcoding/hardware-settings')
    await authRequest('/api/v1/transcoding/hardware-settings', 'POST', { backend: current.backend, revision: current.revision, cpuFallback: enabled }, 45000)
  })
}
const recheck = () => run(async () => undefined, true)
const call = (action: string, body?: unknown, suffix = '') => authRequest(`${base}/model/${action}${suffix}`, 'POST', body, 60000)
function download(model: Model) {
  if (rknn(model) || model.downloadSourceRequired) {
    downloadForm.value = { model: model.id, url: '', sha256: '' }; downloadError.value = ''; downloadInvalid.value = undefined
    return
  }
  return run(() => call('download', undefined, model.id === 'htdemucs' ? '' : '?model=' + encodeURIComponent(model.id)))
}
async function downloadZip() {
  const form = downloadForm.value
  if (!form || modelLocked.value) return
  const url = form.url.trim(), sha256 = form.sha256.trim()
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) throw new Error()
  } catch { downloadInvalid.value = 'url'; downloadError.value = '请填写不含账号密码的 HTTPS ZIP 地址'; return }
  if (!/^[0-9a-fA-F]{64}$/.test(sha256)) { downloadInvalid.value = 'sha256'; downloadError.value = '请填写模型 ZIP 的 64 位 SHA-256'; return }
  downloadError.value = ''; downloadInvalid.value = undefined
  await run(() => call('download', { url, sha256: sha256.toLowerCase() }, '?model=' + encodeURIComponent(form.model)))
  if (!error.value) downloadForm.value = undefined
}
const backendAction = (action: 'test' | 'select', backend: string) => run(() => call(action, { backend }))
async function upload(model: Model, event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]
  if (!file) return
  if (file.size > model.maxBytes) { error.value = '模型文件超过所选模型清单的大小限制'; input.value = ''; return }
  await run(() => importModel(file, model.id)); input.value = ''
}
function offlineFiles(model: Model) {
  if (model.files) return model.files.map(file => ({ name: file.name, url: file.url, sha256: file.sha256 }))
  return props.node && model.id === 'htdemucs' ? [{ name: props.node.model.filename, url: props.node.model.downloadUrl, sha256: props.node.model.sha256 }] : []
}
function backendTone(state: string) { return state === 'AVAILABLE' ? 'success' : state === 'FAILED' ? 'danger' : state === 'UNVERIFIED' ? 'warning' : 'info' }
onBeforeUnmount(() => { if (busy.value) emit('busy-change', false) })
</script>

<template>
  <div class="node-tab" :class="{ 'models-only': modelsOnly }" :aria-busy="busy">
    <section v-if="!modelsOnly" class="overview" :class="readiness.ready ? 'is-ready' : 'is-pending'" aria-label="准备情况">
      <span class="sv-status-dot" :class="readiness.ready ? 'ok' : 'warn'" aria-hidden="true" />
      <div class="overview-copy"><h2>{{ readiness.title }}</h2><p v-if="!readiness.ready">{{ readiness.hint }}</p></div>
      <div class="overview-actions"><ElButton :loading="busy" @click="recheck">重新检测</ElButton></div>
    </section>
    <ElAlert v-if="error" :title="error" type="error" show-icon :closable="false" role="alert" />
    <ElAlert v-if="node && nodeError" :title="nodeError" type="error" show-icon :closable="false"><ElButton text :loading="busy" @click="recheck">重新读取</ElButton></ElAlert>

    <ol v-if="node" class="steps">
      <li class="step">
        <header v-if="!modelsOnly"><h3>准备模型</h3><ElTag :type="readiness.modelInstalled ? 'success' : 'warning'" effect="light" size="small">{{ readiness.modelInstalled ? '已安装' : '未安装' }}</ElTag></header>
        <p v-if="modelBusy || node.operation.state === 'FAILED'" class="operation" role="status"><span>{{ operationStates[node.operation.state] || node.operation.state }} · {{ (node.operation.bytes / 1024 ** 2).toFixed(1) }} MiB</span><ElButton v-if="modelBusy" link type="primary" :disabled="busy" aria-label="取消模型操作" @click="run(() => call('cancel'))">取消</ElButton></p>
        <p v-if="node.operation.error" class="inline-error">{{ node.operation.error }}</p>
        <section v-for="group in modelGroups" :key="group.title" class="model-group" :aria-label="group.title || '模型文件'">
          <h3 v-if="modelsOnly" class="model-group-title">{{ group.title }}</h3>
          <div v-for="model in group.models" :key="model.id" class="model-row" :data-model="model.id">
            <div class="model-copy">
              <strong>{{ modelName(model) }}</strong>
              <span class="model-state" :class="{ installed: model.installed, unavailable: !model.installed && !model.writable }">{{ modelState(model) }}</span>
            </div>
            <div v-if="!model.installed" class="model-actions">
              <ElButton type="primary" :aria-label="`下载${modelName(model)}`" :disabled="modelLocked || !model.writable" @click="download(model)">下载到节点</ElButton>
              <label class="upload el-button" :class="{ 'is-disabled': modelLocked || !model.writable }">
                <input type="file" class="file-input" :accept="model.id === 'htdemucs' ? '.th' : '.zip'" :aria-label="`离线导入${modelName(model)}`" :disabled="modelLocked || !model.writable" @change="upload(model, $event)">
                离线导入
              </label>
            </div>
            <form v-if="!model.installed && downloadForm?.model === model.id" class="model-download" :aria-label="`下载${modelName(model)}设置`" @submit.prevent="downloadZip">
              <p :id="`${model.id}-download-hint`" class="muted">填写已转换模型 ZIP 的公网 HTTPS 地址和完整包的 SHA-256。多芯片包会自动选择当前节点对应的模型。</p>
              <label :for="`${model.id}-download-url`">模型 ZIP 地址</label>
              <input :id="`${model.id}-download-url`" v-model="downloadForm.url" type="url" required maxlength="4096" autocomplete="off" :disabled="modelLocked" :aria-invalid="downloadInvalid === 'url'" :aria-describedby="downloadInvalid === 'url' ? `${model.id}-download-hint ${model.id}-download-error` : `${model.id}-download-hint`">
              <label :for="`${model.id}-download-sha256`">ZIP 的 SHA-256</label>
              <input :id="`${model.id}-download-sha256`" v-model="downloadForm.sha256" type="text" required maxlength="64" autocomplete="off" spellcheck="false" :disabled="modelLocked" :aria-invalid="downloadInvalid === 'sha256'" :aria-describedby="downloadInvalid === 'sha256' ? `${model.id}-download-error` : undefined">
              <p v-if="downloadError" :id="`${model.id}-download-error`" class="inline-error" role="alert">{{ downloadError }}</p>
              <div class="model-actions"><ElButton native-type="submit" type="primary" :disabled="modelLocked" :loading="busy">开始下载</ElButton><ElButton :disabled="busy" @click="downloadForm = undefined">收起</ElButton></div>
            </form>
            <details v-if="!model.installed" class="model-files"><summary :aria-label="`${modelName(model)}文件详情`">文件详情</summary>
              <dl class="file-metadata"><div><dt>导入格式</dt><dd>{{ model.id === 'htdemucs' ? '.th' : '.zip' }}</dd></div><div v-if="model.id !== 'htdemucs'"><dt>ZIP 根目录</dt><dd>{{ rknn(model) ? 'manifest.json、uvr.rknn' : offlineFiles(model).map(file => file.name).join('、') }}</dd></div><template v-if="rknn(model)"><div><dt>多芯片包</dt><dd>可分别放在 rk3566/、rk3568/、rk3588/ 目录，自动选择当前芯片。</dd></div><div><dt>当前芯片</dt><dd>{{ model.target || '待节点识别' }}</dd></div></template></dl>
              <div v-for="file in offlineFiles(model)" :key="file.name" class="offline-file"><a :href="file.url" target="_blank" rel="noreferrer">{{ file.name }}</a><dl class="file-metadata"><div><dt>SHA-256</dt><dd class="digest">{{ file.sha256 }}</dd></div></dl></div>
            </details>
          </div>
        </section>
      </li>

      <li v-if="!modelsOnly" class="step">
        <header><h3>处理设备</h3><ElTag :type="readiness.backendSelected ? 'success' : 'warning'" effect="light" size="small">{{ readiness.backendSelected ? `正在使用 ${backendName(node.selected)}` : '尚未通过试跑' }}</ElTag></header>
        <label class="fallback-toggle"><input type="checkbox" :checked="node.cpuFallback !== false" :disabled="busy || modelBusy" @change="setFallback($event)"> 加速不可用时自动降级到 CPU</label>
        <p class="muted">{{ node.cpuFallback !== false ? '允许自动使用 CPU，处理可能较慢；关闭后，加速不可用的任务会失败。' : '已关闭 CPU 降级，加速不可用时停止处理。' }}此设置也用于视频转码。</p>
        <details class="resource-details"><summary>内存与存储</summary><p class="muted">{{ node.environment.processor || node.environment.system }} · {{ node.environment.architecture }}</p><p class="muted">可用内存 {{ bytes(node.memoryAvailableBytes) }} · 工作目录剩余 {{ bytes(node.diskFreeBytes) }}</p></details>
        <div v-for="backend in visibleBackends" :key="backend.id" class="backend-row">
          <div class="backend-copy"><strong>{{ backend.id === 'cpu' ? 'CPU 自动降级' : backendName(backend.id) }}</strong><span class="muted">{{ backend.device?.name || '设备信息未提供' }}<template v-if="backend.reason"> · {{ backend.reason }}</template><template v-if="backend.elapsedMs"> · 试跑 {{ backend.elapsedMs }} ms</template></span></div>
          <ElTag :type="backendTone(backend.state)" effect="light" size="small">{{ node.selected === backend.id ? '使用中' : backendStates[backend.state] || backend.state }}</ElTag>
          <div class="backend-actions">
            <ElButton v-if="['UNVERIFIED', 'FAILED', 'AVAILABLE'].includes(backend.state)" size="small" :disabled="busy || modelBusy" @click="backendAction('test', backend.id)">{{ backend.id === 'cpu' ? '验证自动降级' : backend.state === 'AVAILABLE' ? '重新试跑' : '试跑' }}</ElButton>
            <ElButton v-if="backend.id !== 'cpu' && backend.state === 'AVAILABLE' && node.selection !== backend.id" size="small" :disabled="busy || modelBusy" @click="backendAction('select', backend.id)">选用此设备</ElButton>
          </div>
        </div>
        <p v-if="detected.length && node.selected === 'cpu'" class="muted">加速设备暂不可用，已自动降级到 CPU。</p><p class="selection">{{ auto ? '自动选择可用设备' : '当前使用固定设备设置' }}<ElButton v-if="!auto" link type="primary" :disabled="busy" @click="backendAction('select', 'auto')">改为自动选择</ElButton></p>
      </li>
    </ol>
    <section v-if="node?.separation && !modelsOnly" class="step" aria-label="极速与轻量伴奏">
      <header><h3>极速与轻量伴奏</h3></header>
      <p v-if="node.separation.operation?.state === 'TESTING' || node.separation.operation?.state === 'WAITING'" role="status" class="muted">轻量模型正在等待或进行试跑…</p>
      <p v-if="node.separation.operation?.error" class="inline-error">{{ node.separation.operation.error }}</p>
      <div v-for="backend in node.separation.backends.filter(isRelevantBackend)" :key="backend.id" class="backend-row">
        <div class="backend-copy"><strong>{{ backendName(backend.id) }}</strong><span class="muted">{{ backend.reason }}</span></div>
        <ElTag :type="backendTone(backend.state)" size="small">{{ backendStates[backend.state] || backend.state }}</ElTag>
        <ElButton v-if="['UNVERIFIED', 'FAILED', 'AVAILABLE'].includes(backend.state)" size="small" :disabled="busy || modelBusy || ['TESTING','WAITING'].includes(node.separation.operation?.state || '')" @click="run(() => call('test', { backend: backend.id, separationProfile: 'AI_CLEAN' }))">试跑轻量模型</ElButton>
      </div>
    </section>
    <section v-if="!node" class="empty"><p>{{ nodeError || '正在读取计算节点…' }}</p></section>

  </div>
</template>

<style scoped>
.node-tab { display: grid; gap: 16px; color: var(--sv-text-primary); }
.overview { display: flex; gap: 12px; align-items: center; padding-bottom: 20px; border-bottom: 1px solid var(--sv-border-subtle); }
.overview-copy { flex: 1; min-width: 0; }
.overview-copy h2 { margin: 0; font-size: 15px; }
.overview-copy p { margin: 4px 0 0; font-size: var(--sv-font-meta); color: var(--sv-text-secondary); }
.overview-actions { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.steps { display: grid; margin: 0; padding: 0; list-style: none; }
.step { display: grid; gap: 8px; min-width: 0; padding: 20px 0; border-bottom: 1px solid var(--sv-border-subtle); }
.step header { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.step h3 { margin: 0; font-size: var(--sv-font-body); font-weight: 600; }
.step p { margin: 0; font-size: var(--sv-font-body); line-height: 1.6; }
.models-only .step { padding: 0; border: 0; }
.model-group { min-width: 0; }
.model-group + .model-group { margin-top: 24px; }
.model-group .model-group-title { padding-bottom: 12px; color: var(--sv-text-secondary); font-size: 14px; font-weight: 500; }
.model-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 0 16px; padding: 20px 0 8px; border-top: 1px solid var(--sv-border-subtle); }
.model-copy { display: grid; gap: 6px; min-width: 0; }
.model-copy strong { font-size: 16px; line-height: 1.6; font-weight: 600; overflow-wrap: anywhere; }
.model-state { font-size: 14px; line-height: 1.6; color: var(--sv-text-secondary); }
.model-state.installed { color: var(--sv-semantic-ok); }
.model-state.unavailable { color: var(--sv-semantic-warn); }
.model-actions, .backend-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.model-actions :deep(.el-button), .backend-actions :deep(.el-button) { margin: 0; min-height: 44px; }
.upload { position: relative; min-height: 44px; margin: 0; overflow: hidden; cursor: pointer; }
.upload.is-disabled { cursor: not-allowed; opacity: .5; }
.file-input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: inherit; }
.upload:focus-within { outline: 2px solid var(--sv-accent-primary); outline-offset: 2px; }
.model-files { grid-column: 1 / -1; min-width: 0; margin-top: 4px; font-size: 14px; }
.model-download { grid-column: 1 / -1; display: grid; gap: 8px; min-width: 0; margin: 16px 0 8px; padding: 16px; border: 1px solid var(--sv-border-subtle); border-radius: var(--sv-radius-sm); }
.model-download label { font-size: 14px; font-weight: 500; }
.model-download input { box-sizing: border-box; width: 100%; min-width: 0; min-height: 44px; padding: 8px 12px; border: 1px solid var(--sv-border-subtle); border-radius: var(--sv-radius-sm); color: var(--sv-text-primary); background: var(--sv-surface-3); font: inherit; }
.model-download input:focus-visible { outline: 2px solid var(--sv-accent-primary); outline-offset: 2px; }
.model-download input[aria-invalid="true"] { border-color: var(--sv-semantic-danger); }
.model-download .model-actions { margin-top: 8px; }
.model-files summary { min-height: 44px; align-content: center; cursor: pointer; color: var(--sv-text-secondary); }
.model-files summary:focus-visible, .model-files a:focus-visible { outline: 2px solid var(--sv-accent-primary); outline-offset: 2px; border-radius: 4px; }
.model-files a { display: inline-flex; align-items: center; min-height: 44px; max-width: 100%; color: var(--sv-accent-primary); overflow-wrap: anywhere; }
.file-metadata { display: grid; gap: 12px; margin: 8px 0 16px; font-size: 14px; }
.file-metadata > div { display: grid; grid-template-columns: 88px minmax(0, 1fr); gap: 12px; align-items: baseline; }
.file-metadata dt { color: var(--sv-text-secondary); }
.file-metadata dd { margin: 0; line-height: 1.7; overflow-wrap: anywhere; }
.offline-file { padding: 8px 12px; margin: 8px 0; background: var(--sv-surface-3); border-radius: 8px; }
code, .digest { overflow-wrap: anywhere; font-family: var(--sv-font-mono); font-size: 12px; }
.operation { display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 8px 12px; margin-bottom: 12px !important; border-radius: var(--sv-radius-sm); background: var(--sv-accent-soft); font-size: 14px !important; font-variant-numeric: tabular-nums; }
.operation :deep(.el-button) { min-height: 44px; margin: 0; }
.backend-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 8px 12px; align-items: center; padding: 12px 0; border-top: 1px solid var(--sv-border-subtle); }
.backend-copy { display: grid; gap: 2px; min-width: 0; }
.backend-copy strong { font-size: var(--sv-font-body); font-weight: 600; }
.backend-actions { justify-content: flex-end; }
.fallback-toggle { display: flex; align-items: center; gap: 8px; font-size: 14px; line-height: 1.8; }
.resource-details { font-size: 12px; color: var(--sv-text-secondary); }
.selection { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding-top: 12px; border-top: 1px solid var(--sv-border-subtle); font-size: var(--sv-font-meta) !important; color: var(--sv-text-secondary); }
.empty { padding: 20px 0; }
.empty p { margin: 0 0 8px; }
.muted { font-size: var(--sv-font-meta); color: var(--sv-text-secondary); }
.inline-error { color: var(--sv-semantic-danger); font-size: var(--sv-font-meta); overflow-wrap: anywhere; }
@media (max-width: 640px) {
  .overview { flex-wrap: wrap; padding-bottom: 16px; }
  .model-row, .backend-row { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .model-actions, .backend-actions { justify-content: flex-start; }
  .model-actions { width: 100%; }
  .model-actions > * { flex: 1; }
  .model-files { margin-top: 0; }
  .model-files, .model-state, .file-metadata, .model-group .model-group-title { font-size: 16px; }
  .file-metadata > div { grid-template-columns: minmax(0, 1fr); gap: 4px; }
  .fallback-toggle, .resource-details summary { min-height: 44px; }
}
</style>
