<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useId, watch } from 'vue'
import PartyIcon from './PartyIcon.vue'
const props = defineProps<{ title: string; locked?: boolean; scrollContainer?: HTMLElement }>()
const emit = defineEmits<{ close: [] }>()
const panel = ref<HTMLElement>(), heading = useId()
let previous: HTMLElement | null
const viewportHeight = ref(0), viewportTop = ref(0)
const viewportStyle = computed(() => !props.scrollContainer && viewportHeight.value ? { height: `${viewportHeight.value}px`, top: `${viewportTop.value}px`, bottom: 'auto' } : undefined)
watch(() => props.scrollContainer ?? document.body, (container, _, onCleanup) => {
  const overflow = container.style.overflow
  container.style.overflow = 'hidden'
  onCleanup(() => { container.style.overflow = overflow })
}, { immediate: true })
function resizeViewport() { viewportHeight.value = window.visualViewport?.height ?? window.innerHeight; viewportTop.value = window.visualViewport?.offsetTop ?? 0 }
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && !props.locked) { event.preventDefault(); emit('close') }
  if (event.key !== 'Tab') return
  const nodes = [...panel.value?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]') ?? []].filter(el => el.getClientRects().length)
  const first = nodes[0], last = nodes.at(-1)
  if (!first) { event.preventDefault(); return }
  if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
onMounted(() => { previous = document.activeElement as HTMLElement; panel.value?.focus(); document.addEventListener('keydown', keydown); resizeViewport(); window.visualViewport?.addEventListener('resize', resizeViewport); window.visualViewport?.addEventListener('scroll', resizeViewport); window.addEventListener('resize', resizeViewport) })
onUnmounted(() => { document.removeEventListener('keydown', keydown); window.visualViewport?.removeEventListener('resize', resizeViewport); window.visualViewport?.removeEventListener('scroll', resizeViewport); window.removeEventListener('resize', resizeViewport); previous?.focus() })
</script>
<template><div class="dialog-backdrop" :style="viewportStyle" @click.self="!locked && emit('close')"><section ref="panel" class="sheet" role="dialog" aria-modal="true" :aria-labelledby="heading" tabindex="-1"><header class="sheet-head"><h2 :id="heading">{{ title }}</h2><button class="icon-btn" aria-label="关闭" :disabled="locked" @click="emit('close')"><PartyIcon name="close" /></button></header><div class="sheet-body"><slot /></div></section></div></template>
