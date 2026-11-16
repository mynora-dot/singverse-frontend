<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute } from 'vue-router'
import { ElAlert, ElButton, ElDrawer, ElIcon, ElMessageBox, ElSkeleton, ElSwitch, ElTag } from 'element-plus'
import { Monitor, Headset, ArrowRight } from '@element-plus/icons-vue'
import { authRequest } from '../../core/auth/api'
import { base, type SeparationProfile } from '../audio-processing/api'
import { backendName, readiness } from '../audio-processing/presentation'
import { detectedAudioBackends } from '../audio-processing/node-hardware'
import NodeTab from '../audio-processing/components/NodeTab.vue'
import HardwareSettings from './HardwareSettings.vue'
import AudioDeviceSettings from './AudioDeviceSettings.vue'
import { currentVideoBackend, videoBackendName } from './hardware'
import { audioPlans, audioPlanStatus, backendStatus } from './presentation'
import { useComputeResources } from './useComputeResources'

const props = defineProps<{ connected: boolean; capabilities: string[] }>()
const emit = defineEmits<{ connect: [] }>()
const videoEnabled = props.connected && props.capabilities.some(item => ['transcode-hls', 'transcode-offline'].includes(item))
const audioEnabled = props.connected && props.capabilities.some(item => ['media-probe', 'audio-role-fast', 'audio-separation'].includes(item))
const { node, hardware, nodeError, hardwareError, actionError, nodeLoading, hardwareLoading, busy, reloadNode, reloadHardware, run, saveFallback } = useComputeResources(videoEnabled, audioEnabled)
const route = useRoute()
const profile = ref<SeparationProfile>('AI_CLEAN')
const drawer = ref<'video' | 'audio' | 'models' | 'environment' | ''>('')
const videoBusy = ref(false)
const drawerBusy = computed(() => busy.value || videoBusy.value)
const drawerOpen = computed({ get: () => !!drawer.value, set: value => { if (!value && !drawerBusy.value) drawer.value = '' } })
const drawerTitle = computed(() => ({ video: '播放设置', audio: `${audioPlans.find(item => item.id === profile.value)?.label || '伴奏'} · 处理设备`, models: '模型管理', environment: '运行环境与硬件说明', '': '' })[drawer.value])
const plan = computed(() => node.value ? audioPlanStatus(node.value, profile.value) : undefined)
const nativeMac = computed(() => node.value?.environment.system === 'Darwin')
const macSetup = computed(() => [
  'make compute-separation-cpu-setup',
  ...(node.value && detectedAudioBackends(node.value).some(item => item.id === 'mlx') ? ['make compute-separation-mlx-setup'] : []),
  '.venv/bin/python scripts/macos-compute.py restart',
].join('\n'))
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
  if (!videoEnabled) return props.connected ? '需要节点提供转码功能，才能配置兼容播放。' : '先连接计算服务，再查看实际可用的硬件。'
  if (hardwareError.value) return hardwareError.value
  if (hardware.value && !Array.isArray(hardware.value.detectedBackends)) return '硬件检测结果尚未确认，可打开播放设置重新检测。'
  const detected = hardware.value?.detectedBackends || []
  if (detected.length) return `检测到：${detected.map(videoBackendName).join('、')}`
  return hardware.value?.cpuFallback === false ? '未检测到加速硬件，且共享 CPU 回退已关闭。' : '未检测到视频加速硬件，按当前设置使用 CPU。'
})
const actionLabel = computed(() => plan.value?.ready ? '查看处理设备' : plan.value?.action === 'models' ? '准备模型' : plan.value?.action === 'environment' ? '查看处理方法' : profile.value === 'AI_CLEAN' ? '验证轻量伴奏' : '验证高级伴奏')
const policyDraft = ref(true), policySaved = ref(false)
const policyDirty = computed(() => !!hardware.value && policyDraft.value !== (hardware.value.cpuFallback !== false))
watch(hardware, (value, previous) => {
  if (value && (!previous || policyDraft.value === (previous.cpuFallback !== false))) policyDraft.value = value.cpuFallback !== false
})
watch(policyDraft, () => { policySaved.value = false })
watch(() => route.hash, hash => { if (hash === '#audio-models' && audioEnabled) drawer.value = 'models' }, { immediate: true })
function selectPlan(next: SeparationProfile) { profile.value = next; actionError.value = '' }
function planTag(id: SeparationProfile) {
  if (!audioEnabled) return props.connected ? '服务未提供' : '尚未连接'
  if (nodeError.value) return '待重新读取'
  if (!node.value) return nodeLoading.value ? '读取中' : '读取失败'
  const tag = audioPlanStatus(node.value, id).tag
  return ({ '缺少运行环境': '缺少环境', '缺少模型或依赖': '待补齐依赖', '此节点未提供': '未提供', '验证未通过': '未通过' } as Record<string, string>)[tag] || tag
}
function openAudioAction() {
  if (!props.connected) { emit('connect'); return }
  if (!node.value || nodeError.value) { void reloadNode(true); return }
  drawer.value = plan.value?.action === 'models' ? 'models' : plan.value?.action === 'environment' ? 'environment' : 'audio'
}
function closeDrawer(done: () => void) { if (!drawerBusy.value) { drawer.value = ''; done() } }
function verify(backend: string) {
  void run(() => authRequest(`${base}/model/test`, 'POST', { backend, ...(profile.value === 'AI_CLEAN' ? { separationProfile: 'AI_CLEAN' } : {}) }, 60000))
}
function refreshEnvironment() { void run(async () => undefined, true) }
function selectBackend(backend: string) { void run(() => authRequest(`${base}/model/select`, 'POST', { backend }, 60000)) }
async function savePolicy() { if (await saveFallback(policyDraft.value)) policySaved.value = true }
async function refreshHardware() { actionError.value = ''; await reloadHardware() }
async function hardwareChanged() { await reloadHardware(); await reloadNode() }
function rotatePlan(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const index = audioPlans.findIndex(item => item.id === profile.value)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : -1) + 3) % 3
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
      <section class="capability-card video-card" aria-labelledby="video-card-title">
        <header class="card-heading"><h2 id="video-card-title"><ElIcon><Monitor /></ElIcon>播放视频</h2><ElTag type="info" effect="light">{{ videoEnabled ? '按当前设置' : '尚未配置' }}</ElTag></header>
        <div class="video-summary"><span class="minor-label">当前处理方式</span><h3>{{ currentVideo }}</h3><p>{{ videoHint }}</p></div>
        <ElSkeleton v-if="hardwareLoading && !hardware && videoEnabled" :rows="2" animated />
        <div class="video-actions"><ElButton :disabled="busy" @click="videoEnabled ? drawer = 'video' : emit('connect')">{{ videoEnabled ? '查看播放设置' : '查看连接设置' }}</ElButton></div>
      </section>

      <section id="accompaniment-settings" class="capability-card audio-card" aria-labelledby="audio-card-title">
        <header class="card-heading"><h2 id="audio-card-title"><ElIcon><Headset /></ElIcon>生成伴奏</h2><ElTag :type="nodeError ? 'warning' : plan?.ready ? 'success' : 'warning'" effect="light">{{ nodeError ? '读取失败' : plan?.tag || (audioEnabled ? '读取中' : '尚未配置') }}</ElTag></header>
        <div class="plan-tabs" role="tablist" aria-label="伴奏处理方案" @keydown="rotatePlan"><button v-for="item in audioPlans" :id="`plan-${item.id}`" :key="item.id" type="button" role="tab" :data-profile="item.id" :aria-selected="profile === item.id" :tabindex="profile === item.id ? 0 : -1" aria-controls="audio-plan-panel" :disabled="busy" @click="selectPlan(item.id)"><strong>{{ item.label }}</strong><small>{{ planTag(item.id) }}</small></button></div>
        <div id="audio-plan-panel" role="tabpanel" :aria-labelledby="`plan-${profile}`">
          <div v-if="!audioEnabled" class="plan-summary"><h3>{{ connected ? '此服务尚未提供伴奏处理' : '连接后准备伴奏' }}</h3><p>{{ connected ? '请确认节点已经启用音频处理并配置工作目录，再重新检查连接。' : '连接计算服务后，按所选方案准备模型和设备。' }}</p><ElButton type="primary" @click="emit('connect')">查看连接设置</ElButton></div>
          <div v-else-if="nodeError" class="plan-summary"><h3>暂时无法读取准备情况</h3><p role="status">{{ nodeError }}</p><ElButton type="primary" :loading="nodeLoading" @click="reloadNode(true)">重新读取</ElButton></div>
          <ElSkeleton v-else-if="!node" :rows="4" animated />
          <template v-else-if="plan">
            <div class="plan-summary"><h3>{{ plan.title }}</h3><p v-if="plan.hardwareHint && profile !== 'DSP_FAST'">{{ plan.hardwareHint }}</p><p>{{ plan.hint }}</p></div>
            <div class="plan-action"><ElButton type="primary" :disabled="busy || modelBusy" @click="openAudioAction">{{ actionLabel }}</ElButton><span>{{ plan.ready ? '只使用通过验证的设备' : profile === 'DSP_FAST' ? '无需分离模型' : '通过试跑后才可使用' }}</span></div>
            <dl v-if="profile !== 'DSP_FAST' && plan.supported" class="preparation-list"><div><dt><span class="check-symbol" :class="{ ok: plan.installed }" aria-hidden="true">{{ plan.installed ? '✓' : '·' }}</span>模型文件</dt><dd :class="plan.installed ? 'positive' : 'pending'">{{ plan.installed ? '已安装' : plan.model ? '未安装' : '尚未提供' }}</dd></div><div><dt><span class="check-symbol" :class="{ ok: plan.ready }" aria-hidden="true">{{ plan.ready ? '✓' : '·' }}</span>{{ plan.selected ? backendName(plan.selected) : plan.candidate ? backendName(plan.candidate.id) : '运行环境' }}</dt><dd>{{ plan.ready ? '已通过验证' : backendStatus(plan.candidate) }}</dd></div><div><dt><span class="check-symbol" :class="{ ok: plan.ready }" aria-hidden="true">{{ plan.ready ? '✓' : '!' }}</span>片段试跑</dt><dd :class="plan.ready ? 'positive' : 'pending'">{{ plan.ready ? '已通过' : plan.running ? '进行中' : plan.candidate?.state === 'FAILED' ? '未通过' : '待验证' }}</dd></div></dl>
            <p v-else-if="profile === 'DSP_FAST' && plan.supported" class="fast-note">极速消音通过声道处理削弱人声，效果因歌曲混音方式而异。</p>
          </template>
        </div>
      </section>
    </div>
    <ElAlert v-if="actionError" class="action-error" :title="actionError" type="error" :closable="false" show-icon />
    <section v-if="videoEnabled || audioEnabled" class="shared-policy" aria-label="视频与伴奏共享的 CPU 策略">
      <div class="policy-copy"><div><h2>加速不可用时，允许使用 CPU</h2><span>共享策略</span></div><p>同时用于视频转码与伴奏生成；对应的 CPU 运行环境仍需可用。</p><p v-if="hardwareError" class="policy-error" role="status">{{ hardwareError }}</p></div>
      <div class="policy-controls"><span v-if="policyDirty" class="pending">尚未保存</span><span v-else-if="policySaved" class="positive" role="status">已保存</span><ElButton v-if="policyDirty" type="primary" :loading="busy" @click="savePolicy">保存策略</ElButton><ElButton v-if="!hardware || hardwareError || actionError" text :loading="hardwareLoading" @click="refreshHardware">重新读取</ElButton><span>{{ !hardware ? (hardwareLoading ? '读取中' : '待确认') : policyDraft ? '已开启' : '已关闭' }}{{ policyDirty ? '（草稿）' : '' }}</span><ElSwitch v-if="hardware" v-model="policyDraft" aria-label="加速不可用时允许视频与伴奏使用 CPU" :disabled="!hardware || !!hardwareError || busy || !hardware.writable" /></div>
    </section>
    <div v-if="audioEnabled" class="resource-links"><div><ElButton text :disabled="!node || !!nodeError || busy" @click="drawer = 'models'">模型管理<ElIcon><ArrowRight /></ElIcon></ElButton><ElButton text :disabled="busy" @click="drawer = 'environment'">运行环境说明<ElIcon><ArrowRight /></ElIcon></ElButton></div></div>

    <ElDrawer v-model="drawerOpen" class="compute-capability-drawer" :title="drawerTitle" size="min(600px, 100vw)" :before-close="closeDrawer" :close-on-click-modal="false" :show-close="!drawerBusy" destroy-on-close>
      <HardwareSettings v-if="drawer === 'video'" hide-fallback @changed="hardwareChanged" @busy-change="videoBusy = $event" />
      <template v-else-if="drawer === 'audio' && node && !nodeError"><AudioDeviceSettings :node="node" :profile="profile" :busy="busy" @verify="verify" @select="selectBackend" @models="drawer = 'models'" @environment="drawer = 'environment'" @refresh="refreshEnvironment" /></template>
      <NodeTab v-else-if="drawer === 'models' && node && !nodeError" models-only :node="node" :node-error="nodeError" :readiness="legacyReadiness" :reload="reloadNode" />
      <section v-else-if="drawer === 'environment'" class="environment-help">
        <template v-if="plan && !plan.ready"><h3>{{ plan.title }}</h3><p v-if="plan.hardwareHint">{{ plan.hardwareHint }}</p><p>{{ plan.hint }}</p><p v-if="plan.candidate?.reason">{{ backendName(plan.candidate.id) }}：{{ plan.candidate.reason }}</p><ElButton v-if="plan.action === 'models'" type="primary" :disabled="busy || !node" @click="drawer = 'models'">前往准备模型</ElButton><ElButton v-else-if="plan.entries.length" type="primary" :disabled="busy" @click="drawer = 'audio'">查看处理设备</ElButton></template>
        <h3>下一步怎么处理</h3><ol><li>在当前计算节点准备所选方案对应的模型、运行环境和设备驱动。</li><li>保留模型数据目录，按节点部署方式补齐依赖或使用对应运行环境。</li><li>重新检测节点，再对准备好的设备进行试跑。</li></ol><p class="environment-note">CPU 回退决定处理方式，无法补齐缺失的运行环境。显示的硬件属于计算节点，与你打开页面所用的电脑无关。</p>
        <details v-if="nativeMac && profile === 'AI_CLEAN'" class="deployment-guide"><summary>Mac 原生节点如何准备轻量 AI？</summary><p>在当前 compute 仓库安装所需运行环境，再重启节点。</p><code>{{ macSetup }}</code><p>随后安装轻量模型，先验证 CPU，再验证检测到的加速设备。</p></details>
        <details v-if="deploymentProfiles.length" class="deployment-guide"><summary>当前设备的部署信息</summary><section v-for="item in deploymentProfiles" :key="item.backend"><h4>{{ backendName(item.backend) }} <span>{{ item.included ? '当前环境已包含' : '当前环境未包含' }}</span></h4><p>镜像：{{ item.image }}</p><code>{{ item.command }}</code></section></details>
        <ElButton :loading="busy" :disabled="!audioEnabled" @click="refreshEnvironment">重新检测运行环境</ElButton>
      </section>
      <section v-else class="drawer-empty"><p>{{ nodeError || '正在读取节点信息…' }}</p><ElButton :loading="nodeLoading" @click="reloadNode(true)">重新读取</ElButton></section>
      <ElAlert v-if="actionError" class="drawer-error" :title="actionError" type="error" :closable="false" />
    </ElDrawer>
  </div>
</template>

<style scoped>
.compute-overview{margin-top:18px;color:var(--sv-text-primary)}.capability-grid{display:grid;grid-template-columns:minmax(0,.88fr) minmax(0,1.12fr);gap:20px;align-items:stretch}.capability-card{background:var(--sv-surface-2);border:1px solid var(--sv-border-subtle);border-radius:12px;padding:20px 24px;min-width:0}.card-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}.card-heading h2{display:flex;align-items:center;gap:10px;margin:0;font-size:18px;font-weight:650;line-height:1.5}.card-heading .el-icon{color:var(--sv-text-secondary);font-size:20px}.card-heading :deep(.el-tag){font-size:12px;border:0;white-space:nowrap}.video-summary{margin:18px 0}.minor-label{font-size:12px;color:var(--sv-text-secondary)}.video-summary h3{margin:7px 0 9px;font-size:24px;line-height:1.5;overflow-wrap:anywhere}.video-summary p,.plan-summary p,.fast-note{margin:0;font-size:14px;line-height:1.8;color:var(--sv-text-secondary)}.video-actions :deep(.el-button){min-height:44px}.plan-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;background:var(--sv-surface-3);padding:4px;border:1px solid var(--sv-border-subtle);border-radius:8px;margin-bottom:18px}.plan-tabs button{border:1px solid transparent;border-radius:6px;min-height:62px;padding:8px 6px;background:transparent;cursor:pointer;color:var(--sv-text-secondary);font:inherit}.plan-tabs strong{display:block;font-size:14px;font-weight:500}.plan-tabs small{display:block;margin-top:5px;font-size:12px;line-height:1.5}.plan-tabs button[aria-selected=true]{background:var(--sv-surface-2);border-color:var(--sv-accent-soft);color:var(--sv-accent-primary)}.plan-tabs button[aria-selected=true] strong{font-weight:600}.plan-tabs button:focus-visible{outline:2px solid var(--sv-accent-primary);outline-offset:2px}.plan-tabs button:disabled{cursor:wait;opacity:.65}.plan-summary h3{font-size:16px;margin:0 0 5px;line-height:1.6}.plan-summary>.el-button{margin-top:16px}.plan-action{display:flex;align-items:center;gap:12px;margin:16px 0 14px;flex-wrap:wrap}.plan-action :deep(.el-button){min-height:44px;margin:0}.plan-action>span{font-size:12px;color:var(--sv-text-secondary)}.preparation-list{margin:0;border-top:1px solid var(--sv-border-subtle);padding-top:10px;font-size:14px}.preparation-list>div{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 0}.preparation-list dt{display:flex;align-items:center;gap:9px;color:var(--sv-text-secondary)}.preparation-list dd{margin:0;font-size:12px;text-align:right;max-width:46%;line-height:1.5;overflow-wrap:anywhere}.check-symbol{display:grid;place-items:center;flex-shrink:0;width:17px;height:17px;border:1px solid var(--sv-border-default);border-radius:50%;font-size:11px;line-height:1;color:var(--sv-semantic-warn)}.check-symbol.ok{border-color:var(--sv-semantic-ok);color:var(--sv-semantic-ok)}.positive{color:var(--sv-semantic-ok)}.pending{color:var(--sv-semantic-warn)}.fast-note{border-top:1px solid var(--sv-border-subtle);padding-top:14px}.shared-policy{display:flex;align-items:center;justify-content:space-between;gap:20px;background:var(--sv-surface-2);border:1px solid var(--sv-border-subtle);border-radius:10px;padding:16px 20px;margin-top:18px}.policy-copy>div{display:flex;align-items:center;flex-wrap:wrap;gap:12px}.policy-copy h2{margin:0;font-size:14px;line-height:1.6;font-weight:600}.policy-copy>div>span{font-size:12px;color:var(--sv-text-secondary);border-left:1px solid var(--sv-border-default);padding-left:12px}.policy-copy p{margin:5px 0 0;font-size:14px;color:var(--sv-text-secondary);line-height:1.7}.policy-copy .policy-error{color:var(--sv-semantic-warn)}.policy-controls{display:flex;align-items:center;justify-content:flex-end;gap:10px;flex-wrap:wrap;flex:none;font-size:12px}.policy-controls :deep(.el-button){min-height:44px;margin:0}.policy-controls :deep(.el-switch){min-height:44px}.resource-links{display:flex;align-items:center;justify-content:flex-end;gap:16px;margin-top:10px;font-size:14px;color:var(--sv-text-secondary)}.resource-links>div{display:flex;align-items:center;gap:12px}.resource-links :deep(.el-button){margin:0;min-height:44px;font-size:14px}.resource-links .el-icon{margin-left:8px}.action-error{margin-top:18px}.environment-help h3{font-size:18px;line-height:1.6;margin:0 0 12px}.environment-help h3:not(:first-child){margin-top:26px}.environment-help p,.environment-help ol{font-size:14px;line-height:1.85;color:var(--sv-text-secondary);margin:10px 0 16px}.environment-help ol{padding-left:22px}.environment-help li{padding-left:2px;margin:10px 0}.environment-note{padding:14px;background:var(--sv-semantic-warn-soft);border-radius:8px;color:var(--sv-semantic-warn)!important}.environment-help details{border-top:1px solid var(--sv-border-subtle);margin:20px 0}.environment-help summary{display:flex;align-items:center;min-height:48px;font-size:14px;cursor:pointer;font-weight:600}.deployment-guide h4{font-size:14px;margin:16px 0 0}.deployment-guide h4 span{font-size:12px;color:var(--sv-text-secondary);margin-left:8px;font-weight:400}.deployment-guide code{display:block;overflow-wrap:anywhere;white-space:pre-wrap;user-select:all;font:12px/1.8 var(--sv-font-mono);padding:12px;background:var(--sv-surface-3);border-radius:6px}.environment-help>.el-button{margin:8px 0 0;min-height:44px}.drawer-empty p{font-size:14px;line-height:1.8}.drawer-error{margin-top:18px}
@media(max-width:1000px){.capability-grid{grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);gap:16px}.capability-card{padding:20px}.shared-policy{align-items:flex-start}.policy-controls{max-width:240px}.preparation-list dt{font-size:13px}}
@media(max-width:360px){.plan-tabs button{padding-inline:4px}.compute-overview .plan-tabs strong{font-size:14px}}
@media(max-width:720px){.capability-grid{grid-template-columns:minmax(0,1fr)}.audio-card{order:-1}.capability-card{padding:20px 18px}.card-heading{margin-bottom:18px}.video-summary{margin:22px 0}.card-heading h2{font-size:18px}.plan-tabs strong{font-size:16px}.plan-summary h3{font-size:18px}.video-summary p,.plan-summary p,.fast-note,.preparation-list dt{font-size:16px}.preparation-list dd{font-size:14px}.video-summary h3{font-size:24px}.plan-action{gap:10px}.shared-policy{flex-direction:column;gap:10px;padding:18px}.policy-copy h2,.policy-copy p{font-size:16px}.policy-controls{justify-content:flex-start;max-width:none;width:100%;font-size:14px}.resource-links{align-items:flex-start;flex-direction:column;gap:4px;font-size:14px}.resource-links>div{width:100%;justify-content:space-between}.environment-help p,.environment-help ol,.drawer-empty p{font-size:16px}.environment-help summary{font-size:16px}.plan-action :deep(.el-button){font-size:16px}.plan-action>span{font-size:12px}}
</style>
<style>
.compute-capability-drawer .el-drawer__header{margin-bottom:0;padding:24px;border-bottom:1px solid var(--sv-border-subtle);color:var(--sv-text-primary)}.compute-capability-drawer .el-drawer__title{font-size:20px;font-weight:600}.compute-capability-drawer .el-drawer__body{padding:24px}.compute-capability-drawer .el-drawer__close-btn{min-width:44px;min-height:44px}.compute-capability-drawer .hardware-heading{padding-top:0}@media(max-width:640px){.compute-capability-drawer .el-drawer__header{padding:16px 18px}.compute-capability-drawer .el-drawer__body{padding:20px 18px}}
</style>
