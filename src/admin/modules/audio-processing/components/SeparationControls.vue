<script setup lang="ts">
import { useId } from 'vue'
import type { Backend, SeparationProfile } from '../api'
import { backendName, generationProfiles, generationProfileNames } from '../presentation'
defineProps<{ profile: SeparationProfile; backend: string; backends: Backend[]; disabled?: boolean; cards?: boolean }>()
const emit = defineEmits<{ 'update:profile': [value: SeparationProfile]; 'update:backend': [value: string] }>()
const group = useId()
</script>

<template>
  <div class="separation-controls" :class="{ 'as-cards': cards }">
    <fieldset v-if="cards" class="profile-options" :disabled="disabled"><legend class="sr-only">伴奏方案</legend><label v-for="id in generationProfiles" :key="id" class="profile-card" :class="{ 'is-selected': profile === id }"><input type="radio" :checked="profile === id" :value="id" :name="'separation-profile-' + group" @change="emit('update:profile', id)"><span><strong>{{ generationProfileNames[id] }}</strong></span></label></fieldset>
    <label v-else>伴奏方案<select :value="profile" aria-label="伴奏方案" :disabled="disabled" @change="emit('update:profile', ($event.target as HTMLSelectElement).value as SeparationProfile)"><option v-for="id in generationProfiles" :key="id" :value="id">{{ generationProfileNames[id] }}</option></select></label>
    <label v-if="profile !== 'DSP_FAST'">使用设备<select :value="backend" aria-label="生成伴奏使用的设备" :disabled="disabled" @change="emit('update:backend', ($event.target as HTMLSelectElement).value)"><option value="">自动选择</option><option v-for="item in backends.filter(device => !['cpu', 'openvino-cpu'].includes(device.id))" :key="item.id" :value="item.id">{{ backendName(item.id) }}</option></select></label>
    <p v-if="profile === 'DSP_FAST'">无需 AI 模型。居中的鼓、贝斯也可能减弱，混响和和声可能残留；请先试听。单声道或左右相同的素材不适用。</p>
  </div>
</template>

<style scoped>
.separation-controls{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center}.separation-controls label{display:flex;gap:8px;align-items:center;font-size:var(--sv-font-meta);color:var(--sv-text-secondary)}.separation-controls select{min-height:40px;max-width:100%;padding:4px 8px;border:1px solid var(--sv-border-default);border-radius:8px;background:var(--sv-surface-1);color:var(--sv-text-primary);font:inherit}.separation-controls p{flex-basis:100%;margin:0;font-size:var(--sv-font-meta);line-height:1.6;color:var(--sv-text-secondary)}
.as-cards{display:grid;gap:12px;width:100%}.profile-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:0;padding:0;border:0;min-width:0}.profile-options .profile-card{align-items:flex-start;min-height:48px;padding:14px 16px;border:1px solid var(--sv-border-default);border-radius:10px;cursor:pointer}.profile-card.is-selected{border-color:var(--sv-accent-primary);background:var(--sv-accent-soft)}.profile-card input{width:16px;height:16px;margin:3px 0 0;accent-color:var(--sv-accent-primary);flex:none}.profile-card:has(input:focus-visible){outline:2px solid var(--sv-accent-primary);outline-offset:2px}.profile-options:disabled .profile-card{cursor:not-allowed}.as-cards>label{justify-content:space-between}.as-cards select{min-height:44px}.as-cards p{font-size:14px}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(max-width:560px){.profile-options{grid-template-columns:minmax(0,1fr);gap:10px}.as-cards p,.profile-card strong{font-size:16px}.profile-options .profile-card{padding:14px}.as-cards>label{flex-wrap:wrap}.as-cards select{flex:1}}
</style>
