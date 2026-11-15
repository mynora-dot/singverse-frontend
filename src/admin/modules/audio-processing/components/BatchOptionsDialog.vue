<script setup lang="ts">
import { computed } from 'vue'
import { ElAlert, ElButton, ElDialog } from 'element-plus'
import type { Backend, SeparationCapabilities, SeparationProfile } from '../api'
import { backendName, type Readiness } from '../presentation'
import SeparationControls from './SeparationControls.vue'

const props = defineProps<{
  mode?: 'recognize' | 'generate'; count: number; busy: boolean; error: string
  profile: SeparationProfile; backend: string; backends: Backend[]; separation?: SeparationCapabilities
  readiness: Readiness; ready: boolean; recognitionKind: 'FAST' | 'ANALYZE'; recognitionReady: boolean; fastReady?: boolean
}>()
const emit = defineEmits<{
  close: []; confirm: []; setup: []
  'update:profile': [value: SeparationProfile]; 'update:backend': [value: string]; 'update:recognitionKind': [value: 'FAST' | 'ANALYZE']
}>()
const recognizing = computed(() => props.mode === 'recognize')
const devices = computed(() => props.backends.filter(item => !['cpu', 'openvino-cpu'].includes(item.id)))
const available = computed(() => recognizing.value ? props.recognitionReady : props.ready)
const generationHint = computed(() => props.separation?.profiles.find(item => item.id === props.profile)?.reason || [props.readiness.title, props.readiness.hint].filter(Boolean).join('。'))
</script>

<template>
  <ElDialog :model-value="!!mode" :title="recognizing ? '识别已有音轨' : '生成独立伴奏'" width="min(600px, 94vw)" class="audio-options-dialog" :close-on-click-modal="!busy" :close-on-press-escape="!busy" :show-close="!busy" @close="emit('close')">
    <div class="options-content">
      <p class="selection-note">已选 <strong>{{ count }}</strong> 首歌曲<span>下一步检查可处理范围与跳过原因</span></p>
      <template v-if="recognizing">
        <fieldset class="recognition-options" :disabled="busy">
          <legend>选择识别方式</legend>
          <label :class="{ 'is-selected': recognitionKind === 'FAST' }"><input type="radio" name="recognition-kind" value="FAST" :checked="recognitionKind === 'FAST'" @change="emit('update:recognitionKind', 'FAST')"><span><strong>快速识别</strong><small>先检查音轨标签，再按可用模型判断短片段。</small></span><span class="recommendation">推荐</span></label>
          <label :class="{ 'is-selected': recognitionKind === 'ANALYZE' }"><input type="radio" name="recognition-kind" value="ANALYZE" :checked="recognitionKind === 'ANALYZE'" @change="emit('update:recognitionKind', 'ANALYZE')"><span><strong>深度识别</strong><small>分离多个片段进行对比，耗时较长。</small></span></label>
        </fieldset>
        <p class="option-hint">识别用于区分已有的原唱与伴奏。判断不确定的歌曲会保留待人工确认。</p>
        <p v-if="recognitionKind === 'FAST' && fastReady === false" class="option-hint">快速识别模型未就绪，本次仅按音轨标签判断；无明确标签的歌曲会保留待人工确认。</p>
      </template>
      <template v-else>
        <p class="option-hint">单条原唱音轨可生成独立伴奏。已有伴奏、正在处理等歌曲会在预览中说明。</p>
        <SeparationControls v-if="separation" :profile="profile" :backend="backend" :backends="backends" :disabled="busy" cards @update:profile="emit('update:profile', $event)" @update:backend="emit('update:backend', $event)" />
        <label v-else-if="devices.length > 1" class="legacy-device">使用设备<select :value="backend" aria-label="生成伴奏使用的设备" :disabled="busy" @change="emit('update:backend', ($event.target as HTMLSelectElement).value)"><option value="">自动选择</option><option v-for="item in devices" :key="item.id" :value="item.id">{{ backendName(item.id) }}</option></select></label>
        <p v-else class="option-hint">使用已通过试跑的设备生成 AAC 伴奏。可先在单曲面板中生成 12 秒试听。</p>
      </template>
      <ElAlert v-if="!available" type="warning" :closable="false" show-icon title="所选处理方式尚未就绪"><p>{{ recognizing ? recognitionKind === 'ANALYZE' ? '深度识别需要先准备好分离环境。' : '请先连接可用的计算节点。' : generationHint }}</p><ElButton link type="primary" :disabled="busy" @click="emit('setup')">去准备环境</ElButton></ElAlert>
      <ElAlert v-if="error" :title="error" type="error" :closable="false" show-icon role="alert" />
    </div>
    <template #footer><ElButton :disabled="busy" @click="emit('close')">取消</ElButton><ElButton type="primary" :loading="busy" :disabled="busy || !available || !count" @click="emit('confirm')">预览处理范围</ElButton></template>
  </ElDialog>
</template>

<style scoped>
.options-content{display:grid;gap:20px}.selection-note{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:0;color:var(--sv-text-primary);font-size:16px}.selection-note strong{font-size:24px}.selection-note span{flex-basis:100%;font-size:13px;color:var(--sv-text-secondary)}.option-hint{margin:0;color:var(--sv-text-secondary);font-size:14px;line-height:1.7}.recognition-options{display:grid;gap:10px;margin:0;padding:0;border:0}.recognition-options legend{margin-bottom:10px;font-size:14px;font-weight:600;color:var(--sv-text-primary)}.recognition-options label{display:flex;align-items:center;gap:12px;min-height:80px;padding:14px;border:1px solid var(--sv-border-default);border-radius:8px;cursor:pointer}.recognition-options label.is-selected{border-color:var(--sv-accent-primary);background:var(--sv-accent-soft)}.recognition-options input{width:16px;height:16px;margin:0;accent-color:var(--sv-accent-primary);flex:none}.recognition-options label>span:nth-child(2){flex:1}.recognition-options strong,.recognition-options small{display:block;font-size:14px;color:var(--sv-text-primary)}.recognition-options small{margin-top:4px;font-size:13px;color:var(--sv-text-secondary)}.recommendation{font-size:12px;color:var(--sv-accent-primary)}.legacy-device{display:grid;gap:8px}.legacy-device select{min-height:44px;padding:8px;border:1px solid var(--sv-border-default);border-radius:8px;color:var(--sv-text-primary);background:var(--sv-surface-2)}.options-content :deep(.el-alert p){margin:6px 0;font-size:14px}.recognition-options label:has(input:focus-visible){outline:2px solid var(--sv-accent-primary);outline-offset:2px}
@media(max-width:560px){.option-hint,.recognition-options strong,.legacy-device,.options-content :deep(.el-alert p){font-size:16px}.recognition-options small{font-size:14px}.recognition-options label{padding:12px}.selection-note span{font-size:14px}}
.options-content :deep(.el-button){min-height:44px}
:global(.audio-options-dialog .el-dialog__footer .el-button){min-height:44px}
</style>
