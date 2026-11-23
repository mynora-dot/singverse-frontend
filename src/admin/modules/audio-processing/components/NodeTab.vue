<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { ElAlert, ElButton, ElTag } from 'element-plus'
import { authRequest } from '../../../core/auth/api'
import { base, importModel, type Model, type Node } from '../api'
import { backendName, backendStates, bytes, failure, operationStates, type Readiness } from '../presentation'
import { applicableModels, isDetectedBackend, isRelevantBackend } from '../node-hardware'

const props = defineProps<{ node?: Node; nodeError: string; readiness: Readiness; reload: (refresh?: boolean) => Promise<void>; modelsOnly?: boolean }>()
const emit = defineEmits<{ 'busy-change': [value: boolean] }>()
const busy = ref(false), error = ref('')
const detected = computed(() => props.node?.backends.filter(item => !['cpu', 'xpu'].includes(item.id) && isDetectedBackend(item)) || [])
const visibleBackends = computed(() => props.node?.backends.filter(item => item.id === 'cpu' || detected.value.some(found => found.id === item.id)) || [])
const preparationNames: Record<string, string> = {
  htdemucs: '通用版',
  'htdemucs-openvino': 'Intel 显卡版',
  'uvr-mdxnet-9482-rknn': '瑞芯微版',
  'uvr-mdxnet-9482': '轻量版',
  'panns-cnn6': '通用版',
}
const preparationName = (model: Model) => preparationNames[model.id] || '其他设备'
const actionName = (model: Model) => model.id === 'panns-cnn6' ? '原唱与伴奏识别' : `伴奏${preparationName(model)}`
const modelState = (model: Model) => model.installed ? '已安装' : !model.writable ? '安装目录不可写' : '未安装'
const canInstallAutomatically = (model: Model) => !model.downloadSourceRequired && model.id !== 'uvr-mdxnet-9482-rknn'
const catalog = computed<Model[]>(() => [
  ...(props.node?.fastClassifier ? [props.node.fastClassifier] : []),
  ...(props.node ? applicableModels(props.node).filter(model => !props.modelsOnly || model.id !== 'uvr-mdxnet-9482') : []),
])
const modelGroups = computed(() => props.modelsOnly ? [
  { title: '生成伴奏', models: catalog.value.filter(model => model.id !== 'panns-cnn6') },
  { title: '识别原唱与伴奏', models: catalog.value.filter(model => model.id === 'panns-cnn6') },
].filter(group => group.models.length) : [{ title: '准备项目', models: catalog.value }])
const modelBusy = computed(() => ['DOWNLOADING', 'IMPORTING', 'VERIFYING', 'TESTING'].includes(props.node?.operation.state || ''))
const modelLocked = computed(() => busy.value || modelBusy.value || !!props.nodeError)
const operationError = computed(() => error.value || (props.node?.operation.state === 'FAILED' && !modelLocked.value
  ? '上次准备失败，请检查节点的网络、存储和安装权限。'
  : ''))
const auto = computed(() => props.node?.selection === 'auto')
async function run(task: () => Promise<unknown>, refresh = false, errorMessage?: string) {
  if (busy.value) return
  busy.value = true; emit('busy-change', true); error.value = ''
  try { await task(); await props.reload(refresh) } catch (failed) { error.value = errorMessage || failure(failed) }
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
  if (modelLocked.value || !model.writable || !canInstallAutomatically(model)) return
  const query = model.id === 'htdemucs' ? '' : '?model=' + encodeURIComponent(model.id)
  return run(() => call('download', undefined, query), false, '自动安装未能开始，请检查计算节点后重试，或下载后离线导入。')
}
const backendAction = (action: 'test' | 'select', backend: string) => run(() => call(action, { backend }))
async function upload(model: Model, event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]
  if (!file) return
  input.value = ''
  if (modelLocked.value || !model.writable) return
  if (file.size > model.maxBytes) { error.value = '文件超过大小限制，请选择发布页中对应的下载文件。'; return }
  await run(() => importModel(file, model.id), false, '离线导入失败，请核对文件对应的功能和设备后重试。')
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
    <ElAlert v-if="operationError" :title="operationError" type="error" show-icon :closable="false" role="alert" />
    <ElAlert v-if="node && nodeError" :title="nodeError" type="error" show-icon :closable="false"><ElButton text :loading="busy" @click="recheck">重新读取</ElButton></ElAlert>

    <ol v-if="node" class="steps">
      <li class="step">
        <header v-if="!modelsOnly"><h3>准备模型</h3><ElTag :type="readiness.modelInstalled ? 'success' : 'warning'" effect="light" size="small">{{ readiness.modelInstalled ? '已安装' : '未安装' }}</ElTag></header>
        <div v-if="modelBusy" class="operation">
          <span role="status">{{ operationStates[node.operation.state] }}</span>
          <ElButton link type="primary" :disabled="busy" aria-label="取消当前操作" @click="run(() => call('cancel'), false, '暂时无法取消，请稍后重试。')">取消</ElButton>
        </div>
        <p v-if="!catalog.length">当前节点暂无可安装项目。</p>
        <section v-for="group in modelGroups" :key="group.title" class="model-group" :aria-label="group.title">
          <h3 v-if="modelsOnly" class="model-group-title">{{ group.title }}</h3>
          <div v-for="model in group.models" :key="model.id" class="model-row" :data-model="model.id">
            <div class="model-copy">
              <strong>{{ modelsOnly ? preparationName(model) : actionName(model) }}</strong>
              <span class="model-state" :class="{ installed: model.installed, unavailable: !model.installed && !model.writable }">{{ modelState(model) }}</span>
            </div>
            <div v-if="!model.installed" class="model-actions">
              <ElButton v-if="canInstallAutomatically(model)" :aria-label="`自动安装${actionName(model)}`" :disabled="modelLocked || !model.writable" @click="download(model)">自动安装</ElButton>
              <label class="upload el-button" :class="{ 'is-disabled': modelLocked || !model.writable }">
                <input type="file" class="file-input" :accept="model.id === 'htdemucs' ? '.th' : '.zip'" :aria-label="`离线导入${actionName(model)}`" :disabled="modelLocked || !model.writable" @change="upload(model, $event)">
                离线导入
              </label>
            </div>
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
.step { display: grid; gap: 12px; min-width: 0; padding: 20px 0; border-bottom: 1px solid var(--sv-border-subtle); }
.step header { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.step h3 { margin: 0; font-size: var(--sv-font-body); font-weight: 600; }
.step p { margin: 0; font-size: var(--sv-font-body); line-height: 1.6; }
.models-only .step { padding: 0; border: 0; }
.model-group { min-width: 0; }
.model-group + .model-group { margin-top: 8px; }
.model-group .model-group-title { padding-bottom: 12px; font-size: 16px; font-weight: 600; }
.model-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px 16px; padding: 12px 0; border-top: 1px solid var(--sv-border-subtle); }
.model-copy { display: grid; gap: 2px; min-width: 0; }
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
.operation { display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 4px 12px; border-radius: var(--sv-radius-sm); background: var(--sv-accent-soft); font-size: 14px; }
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
.node-tab :deep(.el-alert__title) { font-size: 14px; line-height: 1.6; }
@media (max-width: 640px) {
  .overview { flex-wrap: wrap; padding-bottom: 16px; }
  .model-row { column-gap: 8px; }
  .model-actions :deep(.el-button) { padding-inline: 12px; }
  .backend-row { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .backend-actions { justify-content: flex-start; }
  .fallback-toggle, .resource-details summary { min-height: 44px; }
}
</style>
