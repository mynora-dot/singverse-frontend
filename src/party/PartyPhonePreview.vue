<script setup lang="ts">
import { computed, ref, watch, watchPostEffect } from 'vue'

const props = defineProps<{ enabled: boolean; dialogOpen: boolean }>()
const presets = [
  { id: 'iqoo-z9-turbo-plus', label: 'iQOO Z9 Turbo+ · 20:9', height: 2800, width: 1260 },
  { id: '19.5-9', label: '19.5:9', height: 19.5, width: 9 },
  { id: '18-9', label: '18:9', height: 18, width: 9 },
  { id: '16-9', label: '16:9', height: 16, width: 9 },
  { id: '21-9', label: '21:9', height: 21, width: 9 },
]
const storageKey = 'singverse-party:phone-preview:v1'
type Ratio = { height: number; width: number }
type Preference = { preset: string; custom: Ratio }

function isPhoneRatio({ height, width }: Ratio) {
  const ratio = height / width
  return Number.isFinite(height) && Number.isFinite(width) && height > 0 && width > 0 && ratio >= 1 / 3 && ratio <= 3
}

function readPreference(): Partial<Preference> {
  try { return JSON.parse(localStorage.getItem(storageKey) ?? '{}') ?? {} }
  catch { return {} }
}

const saved = readPreference()
const initialCustom = saved.custom && isPhoneRatio(saved.custom) ? saved.custom : { height: 20, width: 9 }
const preset = ref(saved.preset === 'custom' || presets.some(option => option.id === saved.preset) ? saved.preset! : presets[0]!.id)
const custom = ref(initialCustom)
const customHeight = ref<number | string>(initialCustom.height)
const customWidth = ref<number | string>(initialCustom.width)
const ratioError = ref(false)

function applyRatio() {
  const next = { height: Number(customHeight.value), width: Number(customWidth.value) }
  ratioError.value = !isPhoneRatio(next)
  if (!ratioError.value) custom.value = next
}

watch([preset, custom], ([preset, custom]) => {
  ratioError.value = false
  try { localStorage.setItem(storageKey, JSON.stringify({ preset, custom })) }
  catch { /* The preview is usable with browser storage disabled. */ }
})

const stage = ref<HTMLElement>()
const available = ref({ width: 0, height: 0 })
watchPostEffect(onCleanup => {
  if (!props.enabled || !stage.value || typeof ResizeObserver === 'undefined') return
  const observer = new ResizeObserver(([entry]) => {
    if (entry) available.value = entry.contentRect
  })
  observer.observe(stage.value)
  onCleanup(() => observer.disconnect())
})

const size = computed(() => {
  const aspect = preset.value === 'custom' ? custom.value : presets.find(option => option.id === preset.value) ?? presets[0]!
  const ratio = aspect.height / aspect.width
  const width = Math.max(400, 400 / ratio)
  const height = width * ratio
  const scale = Math.min(1, (available.value.width || window.innerWidth - 48) / width, (available.value.height || Math.max(1, window.innerHeight - 96)) / height)
  return { width, height, scale }
})
const frameStyle = computed(() => ({ width: `${size.value.width * size.value.scale}px`, height: `${size.value.height * size.value.scale}px` }))
const screenStyle = computed(() => ({ width: `${size.value.width}px`, height: `${size.value.height}px`, transform: `scale(${size.value.scale})` }))
</script>

<template>
  <div :class="{ 'phone-preview': enabled }">
    <div v-if="enabled" class="phone-controls" :inert="dialogOpen">
      <label>手机比例
        <select v-model="preset">
          <option v-for="option in presets" :key="option.id" :value="option.id">{{ option.label }}</option>
          <option value="custom">自定义</option>
        </select>
      </label>
      <form v-if="preset === 'custom'" class="phone-ratio" novalidate @submit.prevent="applyRatio" @input="ratioError = false">
        <label>高 <input v-model="customHeight" name="height" type="number" step="any" inputmode="decimal" :aria-invalid="ratioError || undefined"></label>
        <label>宽 <input v-model="customWidth" name="width" type="number" step="any" inputmode="decimal" :aria-invalid="ratioError || undefined"></label>
        <button type="submit" class="primary">应用</button>
      </form>
      <p v-if="ratioError" class="phone-ratio-error" role="alert">请输入正数，高宽比需在 1:3 到 3:1 之间。</p>
    </div>
    <div ref="stage" :class="{ 'phone-stage': enabled }">
      <div :class="{ 'phone-device': enabled }" :style="enabled ? frameStyle : undefined">
        <div :class="{ 'phone-screen': enabled }" :style="enabled ? screenStyle : undefined">
          <slot />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.phone-preview {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
  height: 100vh;
  height: 100dvh;
  min-height: 460px;
  padding: 12px 24px 16px;
  background: var(--soft);
}
.phone-controls, .phone-ratio {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 8px 12px;
}
.phone-controls label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
}
.phone-controls :is(select, input) {
  min-height: 44px;
  padding: 0 10px;
  border: 1px solid #b8c5d7;
  border-radius: 8px;
  color: var(--ink);
  background: #fff;
}
.phone-ratio input { width: 86px; }
.phone-ratio-error { width: 100%; color: var(--danger); text-align: center; font-size: 14px; }
.phone-stage { display: grid; place-items: center; min-width: 0; padding: 6px; }
.phone-device {
  position: relative;
  border-radius: 22px;
  overflow: hidden;
  background: #fff;
  box-shadow: 0 0 0 5px var(--ink), 0 12px 32px #14203924;
}
.phone-screen { position: absolute; top: 0; left: 0; transform-origin: top left; }
</style>
