<script setup lang="ts">
import { useId } from 'vue'
import type { Backend, SeparationProfile } from '../api'
import { backendName, profileNames } from '../presentation'
defineProps<{ profile: SeparationProfile; backend: string; backends: Backend[]; disabled?: boolean; cards?: boolean }>()
const emit = defineEmits<{ 'update:profile': [value: SeparationProfile]; 'update:backend': [value: string] }>()
const group = useId()
const descriptions: Record<SeparationProfile, string> = { DSP_FAST: '无需 AI 模型，适合先快速试听效果。', AI_CLEAN: '使用轻量 AI 模型，按节点能力运行。', LEGACY_DEMUCS: '使用 HTDemucs，需要准备对应模型。' }
</script>

<template>
  <div class="separation-controls" :class="{ 'as-cards': cards }">
    <fieldset v-if="cards" class="profile-options" :disabled="disabled"><legend>伴奏方案</legend><label v-for="(label, id) in profileNames" :key="id" class="profile-card" :class="{ 'is-selected': profile === id }"><input type="radio" :checked="profile === id" :value="id" :name="'separation-profile-' + group" @change="emit('update:profile', id as SeparationProfile)"><span><strong>{{ label }}</strong><small>{{ descriptions[id as SeparationProfile] }}</small></span></label></fieldset>
    <label v-else>伴奏方案<select :value="profile" aria-label="伴奏方案" :disabled="disabled" @change="emit('update:profile', ($event.target as HTMLSelectElement).value as SeparationProfile)"><option v-for="(label, id) in profileNames" :key="id" :value="id">{{ label }}</option></select></label>
    <label v-if="profile !== 'DSP_FAST'">使用设备<select :value="backend" aria-label="生成伴奏使用的设备" :disabled="disabled" @change="emit('update:backend', ($event.target as HTMLSelectElement).value)"><option value="">自动选择</option><option v-for="item in backends.filter(device => !['cpu', 'openvino-cpu'].includes(device.id))" :key="item.id" :value="item.id">{{ backendName(item.id) }}</option></select></label>
    <p v-if="profile === 'DSP_FAST'">无需 AI 模型。居中的鼓、贝斯也可能减弱，混响和和声可能残留；请先试听。单声道或左右相同的素材不适用。</p>
    <p v-else-if="profile === 'AI_CLEAN'">优先使用已试跑的加速设备，硬件故障时用同一模型在 CPU 重试；耗时取决于节点。</p>
  </div>
</template>

<style scoped>
.separation-controls{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center}.separation-controls label{display:flex;gap:8px;align-items:center;font-size:var(--sv-font-meta);color:var(--sv-text-secondary)}.separation-controls select{min-height:40px;max-width:100%;padding:4px 8px;border:1px solid var(--sv-border-default);border-radius:8px;background:var(--sv-surface-1);color:var(--sv-text-primary);font:inherit}.separation-controls p{flex-basis:100%;margin:0;font-size:var(--sv-font-meta);line-height:1.6;color:var(--sv-text-secondary)}
.as-cards{display:grid;gap:16px;width:100%}.profile-options{display:grid;gap:8px;margin:0;padding:0;border:0;min-width:0}.profile-options legend{margin-bottom:10px;font-size:14px;font-weight:600;color:var(--sv-text-primary)}.profile-options .profile-card{min-height:76px;padding:12px 14px;border:1px solid var(--sv-border-default);border-radius:8px;cursor:pointer}.profile-card.is-selected{border-color:var(--sv-accent-primary);background:var(--sv-accent-soft)}.profile-card input{width:16px;height:16px;margin:0;accent-color:var(--sv-accent-primary);flex:none}.profile-card strong,.profile-card small{display:block;font-size:14px;color:var(--sv-text-primary)}.profile-card small{margin-top:4px;font-size:13px;font-weight:400;color:var(--sv-text-secondary)}.profile-card:has(input:focus-visible){outline:2px solid var(--sv-accent-primary);outline-offset:2px}.as-cards>label{justify-content:space-between}.as-cards select{min-height:44px}.as-cards p{font-size:14px}
@media(max-width:560px){.as-cards p,.profile-card strong{font-size:16px}.profile-card small{font-size:14px}.profile-options .profile-card{padding:12px}.as-cards>label{flex-wrap:wrap}.as-cards select{flex:1}}
</style>
