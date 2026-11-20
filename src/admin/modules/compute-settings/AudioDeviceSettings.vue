<script setup lang="ts">
import { computed } from 'vue'
import { ElAlert, ElButton } from 'element-plus'
import type { Node } from '../audio-processing/api'
import { backendName, bytes, generationProfileNames, type GenerationProfile } from '../audio-processing/presentation'
import { audioPlanStatus, backendStatus, backendTone, canVerify } from './presentation'
const props = defineProps<{ node: Node; profile: GenerationProfile; busy: boolean }>()
const emit = defineEmits<{ verify: [backend: string]; select: [backend: string]; models: []; environment: []; refresh: [] }>()
const status = computed(() => audioPlanStatus(props.node, props.profile))
const locked = computed(() => props.busy || ['DOWNLOADING', 'IMPORTING', 'VERIFYING', 'TESTING'].includes(props.node.operation.state) || status.value.running)
const title = computed(() => `${generationProfileNames[props.profile]}伴奏`)
</script>
<template>
  <section class="audio-device-settings" :aria-label="title">
    <div class="plan-summary"><h3 role="status">{{ status.tag }}</h3></div>
    <template v-if="profile === 'DSP_FAST'">
      <div class="details-actions"><ElButton :loading="busy" @click="emit('refresh')">重新检查处理工具</ElButton><ElButton v-if="!status.ready" type="primary" @click="emit('environment')">查看处理方法</ElButton></div>
    </template>
    <template v-else>
      <div v-if="status.running" class="operation-note" role="status">正在等待或验证模型，请稍候…</div>
      <ElAlert v-if="status.operation?.error" :title="status.operation.error" type="error" :closable="false" />
      <div class="device-list">
        <article v-for="backend in status.entries" :key="backend.id" class="device-row">
          <div class="device-heading"><strong>{{ backendName(backend.id) }}</strong><span class="device-state" :class="backendTone(backend)">{{ status.selected === backend.id && backend.state === 'AVAILABLE' ? '使用中' : backendStatus(backend) }}</span></div>
          <p v-if="backend.device?.name" class="device-name">{{ backend.device.name }}</p>
          <p v-if="backend.reason">{{ backend.reason }}</p>
          <p v-if="backend.elapsedMs">上次试跑 {{ backend.elapsedMs }} ms</p>
          <div class="device-actions">
            <ElButton v-if="canVerify(backend)" :disabled="locked" :aria-label="`验证${backendName(backend.id)}`" @click="emit('verify', backend.id)">{{ backend.state === 'AVAILABLE' ? '重新验证' : backend.state === 'FAILED' ? '重试验证' : '验证此设备' }}</ElButton>
            <ElButton v-if="profile === 'LEGACY_DEMUCS' && backend.state === 'AVAILABLE' && node.selection !== backend.id" :disabled="locked" @click="emit('select', backend.id)">选用此设备</ElButton>
            <ElButton v-if="['IMAGE_MISSING', 'RUNTIME_MISSING', 'MODEL_UNSUPPORTED'].includes(backend.state)" type="primary" link :disabled="busy" @click="emit('environment')">查看处理方法</ElButton>
            <ElButton v-if="backend.state === 'MODEL_MISSING'" type="primary" link :disabled="busy" @click="emit('models')">准备模型与依赖</ElButton>
          </div>
        </article>
        <p v-if="!status.entries.length" class="empty-note">尚未读取到此方案的处理设备。<ElButton type="primary" link :loading="busy" @click="emit('refresh')">重新检测</ElButton></p>
      </div>
      <div class="selection-row"><span>{{ node.selection === 'auto' ? '自动选择设备' : `固定设备：${backendName(node.selection)}` }}</span><ElButton v-if="node.selection !== 'auto'" type="primary" link :disabled="locked" @click="emit('select', 'auto')">恢复自动选择</ElButton></div>
    </template>
    <details class="resources"><summary>内存、存储与节点信息</summary><p>{{ node.environment.system }} / {{ node.environment.architecture }}</p><p v-if="node.environment.processor">{{ node.environment.processor }}</p><p>可用内存 {{ bytes(node.memoryAvailableBytes) }} · 工作目录剩余 {{ bytes(node.diskFreeBytes) }}</p><p v-if="node.limits">运行内存预算 {{ bytes(node.limits.audioProcessBudgetBytes) }} · 至少保留 {{ bytes(node.limits.minimumFreeBytes) }} 磁盘空间</p><p v-if="node.environment.error">{{ node.environment.error }}</p></details>
  </section>
</template>
<style scoped>
.audio-device-settings{color:var(--sv-text-primary)}h3,p{margin:0}.plan-summary h3{font-size:20px;margin:14px 0 8px}.plan-summary p,.device-row p,.resources p,.selection-row,.empty-note{font-size:14px;line-height:1.8;color:var(--sv-text-secondary)}.plan-summary{margin-bottom:20px}.device-row{padding:20px 0;border-top:1px solid var(--sv-border-subtle)}.device-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.device-heading strong{font-size:16px;line-height:1.6}.device-row p{margin-top:7px;overflow-wrap:anywhere}.device-state{font-size:14px;line-height:1.6;color:var(--sv-text-secondary);text-align:right}.device-state.success{color:var(--sv-semantic-ok)}.device-state.danger{color:var(--sv-semantic-danger)}.device-state.warning{color:var(--sv-semantic-warn)}.device-actions,.details-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.device-actions :deep(.el-button),.details-actions :deep(.el-button){margin:0;min-height:44px}.resources{margin-top:20px;border-top:1px solid var(--sv-border-subtle)}summary{display:flex;align-items:center;min-height:48px;cursor:pointer;font-size:14px}.resources p{margin:8px 0}.operation-note{padding:12px 16px;background:var(--sv-accent-soft);color:var(--sv-accent-primary);font-size:14px;line-height:1.7}.selection-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;border-top:1px solid var(--sv-border-subtle);padding-top:16px}
@media(max-width:640px){.plan-summary p,.device-row p,.resources p,.selection-row,.empty-note{font-size:16px}.plan-summary h3{font-size:21px}.device-heading{align-items:flex-start}.device-actions{gap:8px}}
</style>
