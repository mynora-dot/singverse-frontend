<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElAlert, ElButton } from 'element-plus'
import { authRequest } from '../../core/auth/api'
import { currentVideoBackend, videoChoices as choices, videoBackendName as label, type HardwareSettingsValue as Settings, type HardwareTestResult as Result, type EncoderCapability as Capability } from './hardware'
const props = defineProps<{ hideFallback?: boolean }>()
const emit = defineEmits<{ changed: []; busyChange: [busy: boolean] }>()
const cpuFallback = ref(true)
const settings = ref<Settings | null>(null), backend = ref('deployment'), busy = ref(false), error = ref(''), saved = ref(false)
const result = ref<Result | null>(null), capabilities = ref<Capability[]>([])
const visibleChoices = computed(() => choices.filter(item => ['deployment', 'auto'].includes(item.value) || (item.value === 'software' ? !settings.value?.detectedBackends?.length : settings.value?.detectedBackends?.includes(item.value))))
const unavailableSelection = computed(() => !visibleChoices.value.some(item => item.value === backend.value))
const available = computed(() => capabilities.value.filter(item => item.backend === 'software' ? !settings.value?.detectedBackends?.length : settings.value?.detectedBackends?.includes(item.backend)).sort((a, b) => Number(b.backend === settings.value?.effectiveBackend) - Number(a.backend === settings.value?.effectiveBackend)))
const codecs = (item: Capability) => Object.entries(item.codecs).filter(([, codec]) => codec.samplePassed).map(([codec]) => codec.toUpperCase())
const stages = (item: Capability) => [
  { label: '硬解', verified: item.decodeAcceleration },
  { label: '零拷贝', verified: item.zeroCopy },
  { label: 'GPU 色调映射', verified: item.toneMappingAcceleration },
]
watch(busy, value => emit('busyChange', value), { flush: 'sync' })
let active = true
async function load() {
  busy.value = true; error.value = ''; saved.value = false; result.value = null
  try { const value = await authRequest<Settings>('/api/v1/transcoding/hardware-settings'); if (active) { settings.value = value; backend.value = value.backend; cpuFallback.value = value.cpuFallback !== false } }
  catch (e) { if (active) error.value = e instanceof Error ? e.message : '读取失败' }
  finally { if (active) busy.value = false }
}
async function test() {
  busy.value = true; error.value = ''; result.value = null; saved.value = false
  try {
    const value = await authRequest<Result>('/api/v1/transcoding/hardware-settings/test', 'POST', { backend: backend.value }, 45000)
    if (active) result.value = value
  } catch (e) { if (active) error.value = e instanceof Error ? e.message : '测试失败' }
  finally { if (active) busy.value = false }
}
async function save() {
  if (!settings.value) return
  busy.value = true; error.value = ''; saved.value = false
  try {
    const value = await authRequest<Settings>('/api/v1/transcoding/hardware-settings', 'POST', { backend: backend.value, revision: settings.value.revision, cpuFallback: cpuFallback.value }, 45000)
    if (active) { settings.value = value; cpuFallback.value = value.cpuFallback !== false; saved.value = true; emit('changed') }
  } catch (e) { if (active) error.value = e instanceof Error ? e.message : '保存失败' }
  finally { if (active) busy.value = false }
}
async function inspect() {
  busy.value = true; error.value = ''
  try { const value = await authRequest<{ backends: Capability[] }>('/api/v1/transcoding/capabilities', 'GET', undefined, 60000); const current = await authRequest<Settings>('/api/v1/transcoding/hardware-settings'); if (active) { capabilities.value = value.backends; settings.value = current; cpuFallback.value = current.cpuFallback !== false; emit('changed') } }
  catch (e) { if (active) error.value = e instanceof Error ? e.message : '探测失败' }
  finally { if (active) busy.value = false }
}
onMounted(load)
onBeforeUnmount(() => { active = false; emit('busyChange', false) })
</script>
<template>
  <section class="hardware-settings" aria-label="转码与硬件加速" :aria-busy="busy">
    <header class="hardware-heading">
      <div class="heading-copy"><div><h2>转码与硬件加速</h2></div></div>
      <ElButton v-if="settings" text :disabled="busy" @click="load">重新读取设置</ElButton>
    </header>
    <div v-if="!settings" class="hardware-empty"><ElButton :loading="busy" @click="load">读取硬件加速设置</ElButton></div>
    <template v-else>
      <div class="hardware-config">
        <div class="backend-field"><label for="hardware-backend">硬件加速方式</label><select id="hardware-backend" v-model="backend" aria-label="硬件加速方式" :disabled="busy" @change="result = null; saved = false"><option v-if="unavailableSelection" :value="backend" disabled>{{ backend === 'software' ? '原 CPU 设置（请重新选择）' : '已配置方式未检测到' }}</option><option v-for="choice in visibleChoices" :key="choice.value" :value="choice.value">{{ choice.label }}</option></select></div>
        <aside class="current-backend"><span class="current-caption"><span class="status-dot" aria-hidden="true"></span>当前生效：</span><strong>{{ currentVideoBackend(settings) }}</strong><small>{{ !settings.detectedBackends ? '尚未确认硬件，请展开编码能力详情检测' : settings.detectedBackends.length ? `检测到：${settings.detectedBackends.map(label).join('、')}` : '未检测到加速硬件' }}</small></aside>
      </div>
      <div v-if="!props.hideFallback" class="fallback-policy"><label><input v-model="cpuFallback" type="checkbox" :disabled="busy || !settings.writable" @change="saved = false"> 视频与伴奏加速不可用时使用 CPU</label></div><div class="hardware-actions"><div><ElButton type="primary" :disabled="busy || !settings.writable || unavailableSelection" @click="save">保存硬件加速设置</ElButton><ElButton :disabled="busy || unavailableSelection" @click="test">测试所选方式</ElButton></div></div>
      <ElAlert v-if="!settings.writable" title="计算服务尚未配置转码缓存目录，请先完成部署配置。" type="warning" :closable="false" />
      <p v-if="result" role="status" class="feedback" :class="{ 'feedback-error': !result.passed }">{{ result.passed ? `测试通过：${label(result.backend)}` : '测试未通过，请检查驱动、系统支持及设备权限' }}{{ result.passed && !result.hardware ? ' · 当前使用 CPU 软件编码' : '' }} · {{ result.elapsedMs }} ms</p>
      <p v-if="saved" role="status" class="feedback">硬件加速设置已保存。</p>
      <details class="encoder-section" aria-label="节点编码能力">
        <summary>编码能力详情</summary>
        <div class="encoder-heading"><ElButton :disabled="busy" @click="inspect">检测当前硬件</ElButton></div>
        <div v-if="capabilities.length" class="encoder-results">
          <div v-if="available.length" class="encoder-table-wrap"><table class="encoder-table"><thead><tr><th scope="col">加速方式</th><th scope="col">编码测试通过</th><th scope="col">素材验证</th></tr></thead><tbody><tr v-for="item in available" :key="item.backend"><th scope="row"><div class="encoder-name">{{ label(item.backend) }}<span v-if="item.backend === settings.effectiveBackend" class="current-tag">当前使用</span></div><small>{{ codecs(item).length ? '可用' : '已安装 · 测试未通过' }}</small></th><td><div class="codec-tags"><span v-for="codec in codecs(item)" :key="codec" class="codec-tag">{{ codec }}</span><span v-if="!codecs(item).length" class="muted">暂无通过的编码</span></div></td><td><span v-if="item.backend === 'software'" class="muted">CPU 软件处理</span><div v-else class="stage-tags"><span v-for="stage in stages(item)" :key="stage.label" class="stage-tag" :class="{ verified: stage.verified }">{{ stage.label }}<span>{{ stage.verified ? '已验证' : '待验证' }}</span></span></div></td></tr></tbody></table></div>
          <p v-else class="no-encoders">当前节点没有通过安装检查的编码方式，请检查媒体工具与驱动。</p>

        </div>
      </details>
    </template>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />

  </section>
</template>
<style scoped>
.hardware-settings{--sv-font-meta:14px}.hardware-settings :deep(.el-button){min-height:44px}.hardware-settings .hardware-heading p,.hardware-settings .backend-field p,.hardware-settings .encoder-heading p,.hardware-settings .feedback{font-size:14px}@media(max-width:640px){.hardware-settings .hardware-heading p,.hardware-settings .backend-field p,.hardware-settings .encoder-heading p,.hardware-settings .feedback{font-size:16px}}
.hardware-settings{min-width:0;color:var(--sv-text-primary)}
.hardware-heading,.hardware-config,.hardware-actions,.encoder-section{padding:20px 0}.hardware-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;border-bottom:1px solid var(--sv-border-subtle)}
.heading-copy{display:flex;gap:16px;align-items:center;min-width:0}
h2,h3,p{margin:0}h2{font-size:15px;line-height:1.5}.hardware-heading p,.encoder-heading p,.backend-field p{font-size:13px;line-height:1.7;color:var(--sv-text-secondary);margin-top:4px}
.hardware-config{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:36px;padding-bottom:20px}.backend-field{min-width:0}.backend-field label{display:block;font-size:13px;font-weight:600;margin-bottom:12px}select{width:100%;height:44px;padding:0 12px;border:1px solid var(--sv-border-default);border-radius:8px;background:var(--sv-surface-2);color:var(--sv-text-primary);font:inherit;font-size:14px;cursor:pointer}select:focus-visible{outline:2px solid var(--sv-accent-primary);outline-offset:3px}select:disabled{cursor:wait;opacity:.6}.backend-field p{margin-top:12px}
.current-backend{display:flex;flex-direction:column;gap:8px;padding:0 0 0 20px;align-self:start;border-left:1px solid var(--sv-border-subtle);min-width:0}.current-caption{display:flex;align-items:center;gap:8px;color:var(--sv-text-secondary);font-size:12px}.status-dot{width:6px;height:6px;border-radius:50%;background:var(--sv-accent-primary)}.current-backend strong{font-size:14px;line-height:1.5;overflow-wrap:anywhere}.current-backend small{color:var(--sv-text-secondary);font-size:12px;line-height:1.6}
.hardware-actions{padding-top:0;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px}.hardware-actions>div{display:flex;flex-wrap:wrap;gap:12px}.hardware-actions :deep(.el-button){margin-left:0}
.encoder-section{border-top:1px solid var(--sv-border-subtle);padding-top:0}.encoder-section>summary{font-size:14px;font-weight:600;line-height:1.6;min-height:48px;align-content:center;cursor:pointer}.encoder-heading{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-top:8px}.encoder-results{margin-top:20px}.encoder-table-wrap{overflow-x:auto}.encoder-table{width:100%;border-collapse:collapse;text-align:left;font-size:13px}.encoder-table thead{background:var(--sv-surface-3);color:var(--sv-text-secondary)}.encoder-table thead th{padding:12px 16px;font-size:12px;font-weight:500;white-space:nowrap}.encoder-table tbody th,.encoder-table td{padding:20px 16px;vertical-align:middle;border-bottom:1px solid var(--sv-border-subtle)}.encoder-table tbody th{font-weight:500;min-width:180px}.encoder-table tbody th small{display:block;margin-top:8px;color:var(--sv-text-secondary);font-weight:400;font-size:12px}.encoder-name{display:flex;align-items:center;flex-wrap:wrap;gap:8px;line-height:1.6}.current-tag{font-size:12px;color:var(--sv-accent-primary);background:var(--sv-accent-soft);border-radius:8px;padding:2px 8px;white-space:nowrap}.codec-tags,.stage-tags{display:flex;gap:8px;flex-wrap:wrap}.codec-tag{padding:4px 8px;border:1px solid var(--sv-border-subtle);border-radius:8px;font-size:12px;background:var(--sv-surface-2);white-space:nowrap}.stage-tag{display:flex;gap:4px;align-items:center;font-size:12px;line-height:1.5;color:var(--sv-text-secondary);background:var(--sv-surface-3);padding:4px 8px;border-radius:8px;white-space:nowrap}.stage-tag>span{font-size:12px}.stage-tag.verified{color:var(--sv-semantic-ok);background:var(--sv-semantic-ok-soft)}.muted,.no-encoders{font-size:12px;color:var(--sv-text-secondary);line-height:1.7}
.hardware-empty{padding:20px 0;display:flex;align-items:center;flex-wrap:wrap;gap:16px}.feedback{margin:0 0 20px;border-radius:8px;padding:12px 16px;font-size:13px;line-height:1.7;color:var(--sv-semantic-ok);background:var(--sv-semantic-ok-soft)}.feedback-error{color:var(--sv-semantic-warn);background:var(--sv-semantic-warn-soft)}.hardware-settings>:deep(.el-alert){width:auto;margin:0 0 20px}
@media(max-width:960px){.hardware-config{gap:20px;grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.encoder-table th,.encoder-table td{min-width:140px}.stage-tags{min-width:160px}}
@media(max-width:640px){.hardware-heading,.hardware-config,.hardware-actions,.encoder-section{padding-left:0;padding-right:0}.hardware-heading{align-items:flex-start;flex-wrap:wrap;gap:12px}.hardware-heading>.el-button{margin-left:0}.hardware-config{grid-template-columns:minmax(0,1fr);gap:20px}.current-backend{padding:0;border-left:0}.encoder-heading{align-items:flex-start;flex-direction:column;gap:12px}.hardware-empty{padding:20px 0}.feedback{margin-left:0;margin-right:0}}
.fallback-policy{padding:0 0 20px;font-size:13px}

@media(max-width:768px) {
  .hardware-settings :deep(.el-button) { min-height:44px; }
  .fallback-policy > label { display: flex; align-items: center; gap: 8px; min-height: 44px; }
}
</style>
