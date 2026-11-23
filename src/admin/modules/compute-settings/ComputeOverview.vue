<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute } from 'vue-router'
import { ElAlert, ElButton, ElDrawer, ElIcon, ElMessageBox, ElSkeleton, ElSwitch } from 'element-plus'
import { Monitor, Headset, ArrowRight, TopRight } from '@element-plus/icons-vue'
import { authRequest } from '../../core/auth/api'
import { base } from '../audio-processing/api'
import { backendName, bytes, generationProfileNames, readiness, type GenerationProfile } from '../audio-processing/presentation'
import { detectedAudioBackends } from '../audio-processing/node-hardware'
import NodeTab from '../audio-processing/components/NodeTab.vue'
import HardwareSettings from './HardwareSettings.vue'
import AudioDeviceSettings from './AudioDeviceSettings.vue'
import { currentVideoBackend, videoBackendName } from './hardware'
import { audioPlans, audioPlanStatus } from './presentation'
import { useComputeResources } from './useComputeResources'

const modelReleaseUrl = 'https://github.com/mynora-dot/singverse-model/releases/latest'
const props = defineProps<{ connected: boolean; capabilities: string[] }>()
const emit = defineEmits<{ connect: [] }>()
const videoEnabled = props.connected && props.capabilities.some(item => ['transcode-hls', 'transcode-offline'].includes(item))
const audioEnabled = props.connected && props.capabilities.some(item => ['media-probe', 'audio-role-fast', 'audio-separation'].includes(item))
const { node, hardware, nodeError, hardwareError, actionError, nodeLoading, hardwareLoading, busy, reloadNode, reloadHardware, run, saveFallback } = useComputeResources(videoEnabled, audioEnabled)
const route = useRoute()
const profile = ref<GenerationProfile>('DSP_FAST')
const drawer = ref<'video' | 'audio' | 'models' | 'environment' | ''>('')
const videoBusy = ref(false)
const modelsBusy = ref(false)
const drawerBusy = computed(() => busy.value || videoBusy.value || modelsBusy.value)
const drawerOpen = computed({ get: () => !!drawer.value, set: value => { if (!value && !drawerBusy.value) drawer.value = '' } })
const drawerTitle = computed(() => ({ video: '播放设置', audio: `${audioPlans.find(item => item.id === profile.value)?.label || '伴奏'} · 处理设备`, models: '功能准备', environment: '运行环境', '': '' })[drawer.value])
const plan = computed(() => node.value ? audioPlanStatus(node.value, profile.value) : undefined)
const deploymentProfiles = computed(() => {
  if (!node.value) return []
  const backends = new Set(detectedAudioBackends(node.value).map(item => item.id))
  return node.value.deployment?.profiles.filter(item => backends.has(item.backend)) || []
})
const legacyReadiness = computed(() => readiness(node.value, nodeError.value))
const modelBusy = computed(() => ['DOWNLOADING', 'IMPORTING', 'VERIFYING', 'TESTING'].includes(node.value?.operation.state || '') || plan.value?.running)
const currentVideo = computed(() => {
  if (!videoEnabled) return props.connected ? '此服务未提供视频转码' : '连接后读取播放设置'
  if (!hardware.value) return hardwareLoading.value ? '正在读取播放设置…' : '暂时无法读取播放设置'
  return currentVideoBackend(hardware.value)
})
const videoHint = computed(() => {
  if (hardwareError.value) return hardwareError.value
  if (!videoEnabled || !hardware.value) return ''
  if (!Array.isArray(hardware.value.detectedBackends)) return '硬件待检测'
  const detected = hardware.value?.detectedBackends || []
  if (detected.length && !detected.includes(hardware.value.effectiveBackend)) return detected.map(videoBackendName).join('、')
  return ''
})
const actionLabel = computed(() => profile.value === 'DSP_FAST' && plan.value?.ready ? '重新检测' : plan.value?.ready ? '处理设备' : plan.value?.action === 'models' ? '准备伴奏' : plan.value?.action === 'environment' ? '检查环境' : '验证设备')
const policyDraft = ref(true), policySaved = ref(false)
const policyDirty = computed(() => !!hardware.value && policyDraft.value !== (hardware.value.cpuFallback !== false))
watch(hardware, (value, previous) => {
  if (value && (!previous || policyDraft.value === (previous.cpuFallback !== false))) policyDraft.value = value.cpuFallback !== false
})
watch(policyDraft, () => { policySaved.value = false })
watch(() => route.hash, hash => { if (hash === '#audio-models' && audioEnabled) drawer.value = 'models' }, { immediate: true })
function selectPlan(next: GenerationProfile) { if (!busy.value) { profile.value = next; actionError.value = '' } }
function openAudioAction() {
  if (!props.connected) { emit('connect'); return }
  if (!node.value || nodeError.value) { void reloadNode(true); return }
  if (profile.value === 'DSP_FAST' && plan.value?.ready) { refreshEnvironment(); return }
  drawer.value = plan.value?.action === 'models' ? 'models' : plan.value?.action === 'environment' ? 'environment' : 'audio'
}
function closeDrawer(done: () => void) { if (!drawerBusy.value) { drawer.value = ''; done() } }
function verify(backend: string) {
  void run(() => authRequest(`${base}/model/test`, 'POST', { backend }, 60000), false, '暂时无法验证设备，请检查运行环境后重试。')
}
function refreshEnvironment() { void run(async () => undefined, true) }
function selectBackend(backend: string) {
  void run(() => authRequest(`${base}/model/select`, 'POST', { backend }, 60000), false, '暂时无法切换设备，请重新检测后重试。')
}
async function savePolicy() { if (await saveFallback(policyDraft.value)) policySaved.value = true }
async function refreshHardware() { actionError.value = ''; await reloadHardware() }
async function hardwareChanged() { await reloadHardware(); await reloadNode() }
function rotatePlan(event: KeyboardEvent) {
  if (busy.value || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const index = audioPlans.findIndex(item => item.id === profile.value)
  const count = audioPlans.length
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + count) % count
  selectPlan(audioPlans[next]!.id)
  const target = (event.currentTarget as HTMLElement).querySelector<HTMLButtonElement>(`[data-profile="${profile.value}"]`)
  target?.focus()
}
onBeforeRouteLeave(async () => {
  if (drawerBusy.value) return false
  if (!policyDirty.value) return true
  try { await ElMessageBox.confirm('离开后将放弃尚未保存的共享 CPU 策略。', '有未保存的设置', { confirmButtonText: '放弃修改', cancelButtonText: '继续编辑', type: 'warning' }); return true }
  catch { return false }
})
</script>

<template>
  <div class="compute-overview">
    <div class="capability-grid">
      <section class="capability-card video-card sv-glass" aria-labelledby="video-card-title">
        <header class="card-heading"><h2 id="video-card-title"><ElIcon aria-hidden="true"><Monitor /></ElIcon>播放视频</h2></header>
        <ElSkeleton v-if="hardwareLoading && !hardware && videoEnabled" :rows="2" animated />
        <div v-else class="video-summary"><h3>{{ currentVideo }}</h3><p v-if="videoHint" :class="{ 'pending': hardwareError }">{{ videoHint }}</p></div>
        <div class="video-actions"><ElButton :disabled="busy" @click="videoEnabled ? drawer = 'video' : emit('connect')">{{ videoEnabled ? '查看播放设置' : '查看连接设置' }}</ElButton></div>
      </section>

      <section id="accompaniment-settings" class="capability-card audio-card sv-glass" aria-labelledby="audio-card-title">
        <header class="card-heading"><h2 id="audio-card-title"><ElIcon aria-hidden="true"><Headset /></ElIcon>生成伴奏</h2></header>
        <div class="plan-tabs" role="tablist" aria-label="伴奏档位" @keydown="rotatePlan"><button v-for="item in audioPlans" :id="`plan-${item.id}`" :key="item.id" type="button" role="tab" :data-profile="item.id" :aria-selected="profile === item.id" :tabindex="profile === item.id ? 0 : -1" aria-controls="audio-plan-panel" :disabled="busy" @click="selectPlan(item.id)">{{ item.label }}</button></div>
        <div id="audio-plan-panel" role="tabpanel" :aria-labelledby="`plan-${profile}`">
          <div v-if="!audioEnabled" class="plan-summary"><h3>{{ connected ? '此服务未提供伴奏处理' : '尚未连接' }}</h3><ElButton type="primary" @click="emit('connect')">查看连接设置</ElButton></div>
          <div v-else-if="nodeError" class="plan-summary"><h3>暂时无法读取准备情况</h3><p role="status">{{ nodeError }}</p><ElButton type="primary" :loading="nodeLoading" @click="reloadNode(true)">重新读取</ElButton></div>
          <ElSkeleton v-else-if="!node" :rows="4" animated />
          <template v-else-if="plan">
            <div class="plan-state"><p role="status"><span class="sr-only">{{ generationProfileNames[profile] }}伴奏：</span><span class="sv-status-dot" :class="plan.ready ? 'ok' : 'warn'" aria-hidden="true" />{{ plan.tag }}</p><ElButton :type="plan.ready ? 'default' : 'primary'" :loading="busy" :disabled="modelBusy" @click="openAudioAction">{{ actionLabel }}</ElButton></div>
            <dl v-if="profile === 'LEGACY_DEMUCS' && plan.supported" class="preparation-list"><div><dt>处理设备</dt><dd>{{ backendName(plan.selected || plan.candidate?.id) || '尚未确认' }}</dd></div></dl>
          </template>
        </div>
      </section>
    </div>
    <ElAlert v-if="actionError" class="action-error" :title="actionError" type="error" :closable="false" show-icon />
    <section v-if="videoEnabled || audioEnabled" class="shared-policy" aria-label="视频与伴奏共享的 CPU 策略">
      <div class="policy-copy"><h2>加速不可用时使用 CPU</h2><p v-if="hardwareError" class="policy-error" role="status">{{ hardwareError }}</p></div>
      <div class="policy-controls"><span v-if="policyDirty" class="pending">尚未保存</span><span v-else-if="policySaved" class="positive" role="status">已保存</span><ElButton v-if="policyDirty" type="primary" :loading="busy" @click="savePolicy">保存策略</ElButton><ElButton v-if="!hardware || hardwareError || actionError" text :loading="hardwareLoading" @click="refreshHardware">重新读取</ElButton><ElSwitch v-if="hardware" v-model="policyDraft" aria-label="加速不可用时允许视频与伴奏使用 CPU" :disabled="!hardware || !!hardwareError || busy || !hardware.writable" /></div>
    </section>
    <div class="resource-links">
      <ElButton v-if="audioEnabled" text :disabled="!node || !!nodeError || busy" @click="drawer = 'models'">功能准备<ElIcon aria-hidden="true"><ArrowRight /></ElIcon></ElButton>
      <ElButton tag="a" :href="modelReleaseUrl" target="_blank" rel="noopener noreferrer" aria-label="模型下载（在新标签页打开）" type="primary" text bg>模型下载<ElIcon aria-hidden="true"><TopRight /></ElIcon></ElButton>
      <ElButton v-if="audioEnabled" text :disabled="busy" @click="drawer = 'environment'">运行环境<ElIcon aria-hidden="true"><ArrowRight /></ElIcon></ElButton>
    </div>

    <ElDrawer v-model="drawerOpen" class="compute-capability-drawer" :title="drawerTitle" size="min(600px, 100vw)" :before-close="closeDrawer" :close-on-click-modal="false" :show-close="!drawerBusy" destroy-on-close>
      <div v-if="drawer === 'models'" class="preparation-download">
        <ElButton tag="a" :href="modelReleaseUrl" target="_blank" rel="noopener noreferrer" aria-label="模型下载（在新标签页打开）" type="primary">模型下载<ElIcon aria-hidden="true"><TopRight /></ElIcon></ElButton>
        <p>按用途和设备下载，再选择<span>「离线导入」。</span></p>
      </div>
      <HardwareSettings v-if="drawer === 'video'" hide-fallback @changed="hardwareChanged" @busy-change="videoBusy = $event" />
      <template v-else-if="drawer === 'audio' && node && !nodeError"><AudioDeviceSettings :node="node" :profile="profile" :busy="busy" @verify="verify" @select="selectBackend" @models="drawer = 'models'" @environment="drawer = 'environment'" @refresh="refreshEnvironment" /></template>
      <NodeTab v-else-if="drawer === 'models' && node" models-only :node="node" :node-error="nodeError" :readiness="legacyReadiness" :reload="refresh => reloadNode(refresh, true)" @busy-change="modelsBusy = $event" />
      <section v-else-if="drawer === 'environment'" class="environment-help">
        <template v-if="plan && !plan.ready"><h3>{{ plan.tag }}</h3><p v-if="plan.action === 'environment'">{{ plan.hint }}</p><ElButton v-if="plan.action === 'models'" type="primary" :disabled="busy || !node" @click="drawer = 'models'">准备伴奏</ElButton><ElButton v-else-if="plan.entries.length" :disabled="busy" @click="drawer = 'audio'">处理设备</ElButton></template>
        <dl v-if="node" class="environment-facts"><div><dt>系统</dt><dd>{{ node.environment.system }} / {{ node.environment.architecture }}</dd></div><div v-if="node.environment.processor"><dt>处理器</dt><dd>{{ node.environment.processor }}</dd></div><div><dt>可用内存</dt><dd>{{ bytes(node.memoryAvailableBytes) }}</dd></div><div><dt>剩余存储</dt><dd>{{ bytes(node.diskFreeBytes) }}</dd></div></dl>
        <details v-if="deploymentProfiles.length" class="deployment-guide"><summary>当前设备的部署信息</summary><section v-for="item in deploymentProfiles" :key="item.backend"><h4>{{ backendName(item.backend) }} <span>{{ item.included ? '当前环境已包含' : '当前环境未包含' }}</span></h4><p>镜像：{{ item.image }}</p><code>{{ item.command }}</code></section></details>
        <ElButton :loading="busy" :disabled="!audioEnabled" @click="refreshEnvironment">重新检测运行环境</ElButton>
      </section>
      <section v-else class="drawer-empty"><p>{{ nodeError || '正在读取节点信息…' }}</p><ElButton :loading="nodeLoading" @click="reloadNode(true)">重新读取</ElButton></section>
      <ElAlert v-if="actionError" class="drawer-error" :title="actionError" type="error" :closable="false" />
    </ElDrawer>
  </div>
</template>

<style scoped>
.compute-overview { margin-top: 20px; color: var(--sv-text-primary); }
.capability-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; align-items: start; }
.capability-card { padding: 24px; min-width: 0; }
.card-heading { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
.card-heading h2 { display: flex; align-items: center; gap: 10px; margin: 0; font-size: 18px; font-weight: 600; line-height: 1.5; }
.card-heading .el-icon { color: var(--sv-text-secondary); font-size: 20px; }
.video-summary { margin: 28px 0; }
.video-summary h3 { margin: 0; font-size: 26px; line-height: 1.5; overflow-wrap: anywhere; }
.video-summary p { margin: 12px 0 0; font-size: 14px; line-height: 1.7; color: var(--sv-text-secondary); overflow-wrap: anywhere; }
.video-actions :deep(.el-button), .plan-state :deep(.el-button), .plan-summary :deep(.el-button) { min-height: 44px; margin: 0; }
.plan-tabs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; padding: 4px; margin-bottom: 24px; background: var(--sv-surface-3); border: 1px solid var(--sv-border-subtle); border-radius: 10px; }
.plan-tabs button { min-height: 44px; padding: 8px 12px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--sv-text-secondary); font: inherit; font-weight: 500; cursor: pointer; transition: background-color 150ms, color 150ms, border-color 150ms; }
.plan-tabs button[aria-selected=true] { background: var(--sv-surface-2); border-color: var(--sv-border-default); color: var(--sv-accent-primary); font-weight: 600; }
.plan-tabs button:hover:not(:disabled):not([aria-selected=true]) { background: var(--sv-accent-soft); }
.plan-tabs button:focus-visible { outline: 2px solid var(--sv-accent-primary); outline-offset: 2px; }
.plan-tabs button:disabled { cursor: wait; opacity: .65; }
.plan-summary h3 { font-size: 16px; margin: 0 0 16px; line-height: 1.6; }
.plan-summary p { margin: 0 0 16px; color: var(--sv-text-secondary); line-height: 1.7; overflow-wrap: anywhere; }
.plan-state { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 44px; }
.plan-state p { display: flex; align-items: center; gap: 10px; margin: 0; font-size: 16px; line-height: 1.6; font-weight: 600; }
.plan-state :deep(.el-button) { flex-shrink: 0; }
.preparation-list { margin: 20px 0 0; padding-top: 12px; border-top: 1px solid var(--sv-border-subtle); font-size: 14px; }
.preparation-list > div { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; padding: 8px 0; }
.preparation-list dt { color: var(--sv-text-secondary); line-height: 1.6; overflow-wrap: anywhere; }
.preparation-list dd { margin: 0; max-width: 50%; text-align: right; line-height: 1.6; overflow-wrap: anywhere; }
.positive { color: var(--sv-semantic-ok); }
.pending { color: var(--sv-semantic-warn); }
.shared-policy { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-top: 20px; padding: 16px 24px; background: var(--sv-surface-2); border: 1px solid var(--sv-border-subtle); border-radius: 10px; }
.policy-copy { min-width: 0; }
.policy-copy h2 { margin: 0; font-size: 14px; line-height: 1.6; font-weight: 500; }
.policy-copy .policy-error { margin: 8px 0 0; color: var(--sv-semantic-warn); font-size: 14px; line-height: 1.7; overflow-wrap: anywhere; }
.policy-controls { display: flex; align-items: center; justify-content: flex-end; gap: 12px; flex-wrap: wrap; font-size: 14px; }
.policy-controls :deep(.el-button), .policy-controls :deep(.el-switch) { min-height: 44px; margin: 0; }
.resource-links { display: flex; justify-content: flex-end; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.resource-links :deep(.el-button) { margin: 0; min-height: 44px; font-size: 14px; }
.resource-links .el-icon, .preparation-download .el-icon { margin-left: 8px; }
.preparation-download { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; margin-bottom: 20px; }
.preparation-download :deep(.el-button) { min-height: 44px; margin: 0; }
.preparation-download p { flex: 1 1 160px; margin: 0; color: var(--sv-text-secondary); font-size: 14px; line-height: 1.6; }
.preparation-download p span { white-space: nowrap; }
.action-error, .drawer-error { margin-top: 20px; }
.environment-help h3 { font-size: 18px; line-height: 1.6; margin: 0 0 12px; }
.environment-help p { font-size: 14px; line-height: 1.8; color: var(--sv-text-secondary); margin: 12px 0 16px; overflow-wrap: anywhere; }
.environment-help details { border-top: 1px solid var(--sv-border-subtle); margin: 24px 0; }
.environment-help summary { min-height: 44px; align-content: center; font-size: 14px; cursor: pointer; font-weight: 600; }
.environment-facts { display: grid; gap: 16px; margin: 24px 0; font-size: 14px; }
.environment-facts > div { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 12px; }
.environment-facts dt { color: var(--sv-text-secondary); }
.environment-facts dd { margin: 0; overflow-wrap: anywhere; }
.deployment-guide h4 { font-size: 14px; margin: 16px 0 0; }
.deployment-guide h4 span { font-size: 14px; color: var(--sv-text-secondary); margin-left: 8px; font-weight: 400; }
.deployment-guide code { display: block; overflow-wrap: anywhere; white-space: pre-wrap; user-select: all; font: 12px/1.8 var(--sv-font-mono); padding: 12px; background: var(--sv-surface-3); border-radius: 6px; }
.environment-help > .el-button { margin: 8px 0 0; min-height: 44px; }
.drawer-empty p { font-size: 14px; line-height: 1.8; }
@media (max-width: 1000px) { .capability-card { padding: 20px; } }
@media (max-width: 720px) {
  .capability-grid { grid-template-columns: minmax(0, 1fr); gap: 16px; }
  .capability-card { padding: 20px; }
  .card-heading { margin-bottom: 20px; }
  .video-summary { margin: 20px 0; }
  .plan-tabs button, .preparation-list, .policy-copy h2, .environment-help p, .environment-help summary, .environment-facts { font-size: 16px; }
  .shared-policy { padding: 16px 20px; flex-wrap: wrap; gap: 8px 16px; }
  .policy-controls { margin-left: auto; }
  .resource-links { justify-content: space-between; }
}
@media (prefers-reduced-motion: reduce) { .plan-tabs button { transition: none; } }
</style>
<style>
.compute-capability-drawer .el-drawer__header{margin-bottom:0;padding:24px;border-bottom:1px solid var(--sv-border-subtle);color:var(--sv-text-primary)}.compute-capability-drawer .el-drawer__title{font-size:20px;font-weight:600}.compute-capability-drawer .el-drawer__body{padding:24px}.compute-capability-drawer .el-drawer__close-btn{min-width:44px;min-height:44px}.compute-capability-drawer .hardware-heading{padding-top:0}@media(max-width:640px){.compute-capability-drawer .el-drawer__header{padding:16px 18px}.compute-capability-drawer .el-drawer__body{padding:20px 18px}}
</style>
