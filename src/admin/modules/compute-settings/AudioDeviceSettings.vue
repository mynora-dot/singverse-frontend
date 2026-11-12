<script setup lang="ts">
import { computed } from 'vue'
import { ElAlert, ElButton, ElTag } from 'element-plus'
import type { Node, SeparationProfile } from '../audio-processing/api'
import { backendName, bytes } from '../audio-processing/presentation'
import { audioPlanStatus, backendStatus, backendTone, canVerify } from './presentation'
const props = defineProps<{ node: Node; profile: SeparationProfile; busy: boolean }>()
const emit = defineEmits<{ verify: [backend: string]; select: [backend: string]; models: []; environment: []; refresh: [] }>()
const status = computed(() => audioPlanStatus(props.node, props.profile))
const locked = computed(() => props.busy || ['DOWNLOADING', 'IMPORTING', 'VERIFYING', 'TESTING'].includes(props.node.operation.state) || status.value.running)
const title = computed(() => props.profile === 'AI_CLEAN' ? '轻量 AI 伴奏' : props.profile === 'DSP_FAST' ? '极速消音' : '高级 AI 伴奏')
</script>
<template>
  <section class="audio-device-settings" :aria-label="title">
    <div class="plan-summary"><ElTag :type="status.ready ? 'success' : 'warning'" effect="light">{{ status.tag }}</ElTag><h3>{{ status.title }}</h3><p v-if="status.hardwareHint && profile !== 'DSP_FAST'">{{ status.hardwareHint }}</p><p>{{ status.hint }}</p></div>
    <template v-if="profile === 'DSP_FAST'">
      <ElAlert title="适合先快速尝试；人声可能仍有残留，也可能削弱鼓和贝斯。单声道素材不适用。" type="info" :closable="false" />
      <div class="details-actions"><ElButton :loading="busy" @click="emit('refresh')">重新检查处理工具</ElButton><ElButton v-if="!status.ready" type="primary" @click="emit('environment')">查看处理方法</ElButton></div>
    </template>
    <template v-else>
      <p class="device-note">只显示当前计算节点检测到的设备。视频加速与伴奏推理各自验证。</p>
      <div v-if="status.running" class="operation-note" role="status">正在等待或验证模型，请稍候…</div>
      <ElAlert v-if="status.operation?.error" :title="status.operation.error" type="error" :closable="false" />
      <div class="device-list">
        <article v-for="backend in status.entries" :key="backend.id" class="device-row">
          <div class="device-heading"><strong>{{ backendName(backend.id) }}</strong><ElTag :type="backendTone(backend)" effect="light" size="small">{{ backendStatus(backend) }}</ElTag></div>
          <p v-if="backend.device?.name" class="device-name">{{ backend.device.name }}</p>
          <p v-if="status.selected === backend.id" class="selected-label">当前使用此设备</p>
          <p v-if="backend.reason">{{ backend.reason }}</p>
          <p v-if="backend.elapsedMs">上次试跑 {{ backend.elapsedMs }} ms</p>
          <div class="device-actions">
            <ElButton v-if="canVerify(backend)" :disabled="locked || (profile === 'AI_CLEAN' && backend.id !== 'cpu' && status.entries.find(item => item.id === 'cpu')?.state !== 'AVAILABLE')" @click="emit('verify', backend.id)">{{ backend.state === 'AVAILABLE' ? '重新验证' : backend.state === 'FAILED' ? '重试验证' : '验证此设备' }}</ElButton>
            <ElButton v-if="profile === 'LEGACY_DEMUCS' && backend.state === 'AVAILABLE' && node.selection !== backend.id" :disabled="locked" @click="emit('select', backend.id)">选用此设备</ElButton>
            <ElButton v-if="['IMAGE_MISSING', 'RUNTIME_MISSING', 'MODEL_UNSUPPORTED'].includes(backend.state)" type="primary" link :disabled="busy" @click="emit('environment')">查看处理方法</ElButton>
            <ElButton v-if="backend.state === 'MODEL_MISSING'" type="primary" link :disabled="busy" @click="emit('models')">准备模型与依赖</ElButton>
          </div>
        </article>
        <p v-if="!status.entries.length" class="empty-note">尚未读取到此方案的处理设备。<ElButton type="primary" link :loading="busy" @click="emit('refresh')">重新检测</ElButton></p>
      </div>
      <p v-if="profile === 'AI_CLEAN'" class="device-note">先验证独立 CPU 环境，再验证加速设备。生成时会自动选择已经验证通过的设备。</p>
      <div v-else class="selection-row"><span>{{ node.selection === 'auto' ? '正在自动选择已验证的设备' : `固定设备：${backendName(node.selection)}` }}</span><ElButton v-if="node.selection !== 'auto'" type="primary" link :disabled="locked" @click="emit('select', 'auto')">恢复自动选择</ElButton></div>
    </template>
    <details class="resources"><summary>内存、存储与节点信息</summary><p>{{ node.environment.system }} / {{ node.environment.architecture }}</p><p v-if="node.environment.processor">{{ node.environment.processor }}</p><p>可用内存 {{ bytes(node.memoryAvailableBytes) }} · 工作目录剩余 {{ bytes(node.diskFreeBytes) }}</p><p v-if="node.limits">运行内存预算 {{ bytes(node.limits.audioProcessBudgetBytes) }} · 至少保留 {{ bytes(node.limits.minimumFreeBytes) }} 磁盘空间</p><p v-if="node.environment.error">{{ node.environment.error }}</p></details>
    <p class="save-scope">验证只检查运行能力；选择设备对后续任务生效，已有伴奏保留。</p>
  </section>
</template>
<style scoped>
.audio-device-settings{color:var(--sv-text-primary)}h3,p{margin:0}.plan-summary h3{font-size:20px;margin:14px 0 8px}.plan-summary p,.device-row p,.device-note,.save-scope,.resources p,.selection-row,.empty-note{font-size:14px;line-height:1.8;color:var(--sv-text-secondary)}.plan-summary{margin-bottom:20px}.device-note{margin:16px 0}.device-row{padding:20px 0;border-top:1px solid var(--sv-border-subtle)}.device-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.device-heading strong{font-size:16px;line-height:1.6}.device-row p{margin-top:7px;overflow-wrap:anywhere}.device-row .selected-label{color:var(--sv-semantic-ok)}.device-actions,.details-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.device-actions :deep(.el-button),.details-actions :deep(.el-button){margin:0;min-height:44px}.resources{margin-top:20px;border-top:1px solid var(--sv-border-subtle)}summary{display:flex;align-items:center;min-height:48px;cursor:pointer;font-size:14px}.resources p{margin:8px 0}.save-scope{margin-top:20px}.operation-note{padding:12px 16px;background:var(--sv-accent-soft);color:var(--sv-accent-primary);font-size:14px;line-height:1.7}.selection-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;border-top:1px solid var(--sv-border-subtle);padding-top:16px}
@media(max-width:640px){.plan-summary p,.device-row p,.device-note,.resources p,.selection-row,.empty-note{font-size:16px}.plan-summary h3{font-size:21px}.device-heading{align-items:flex-start}.save-scope{font-size:14px}.device-actions{gap:8px}}
</style>
