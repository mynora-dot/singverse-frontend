<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
const props = defineProps<{ path?: string; token?: string; alt?: string; fallback?: string }>()
const image = ref('')
let controller: AbortController | undefined
function clear() { controller?.abort(); if (image.value) URL.revokeObjectURL(image.value); image.value = '' }
watch(() => [props.path, props.token], async () => {
  clear()
  if (!props.path || !/^\/api\/v1\/(tv|party)\/library\/(songs\/[^/?#]+\/cover|artists\/[^/?#]+\/images\/(portrait|background))(\?[^#]*)?$/.test(props.path) || !props.token) return
  controller = new AbortController(); const current = controller
  try {
    const response = await fetch(props.path, { headers: { Authorization: `Bearer ${props.token}` }, credentials: 'omit', cache: 'no-store', redirect: 'error', signal: current.signal })
    if (!response.ok) return
    const blob = await response.blob()
    if (!current.signal.aborted && blob.size <= 2_000_000 && ['image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) image.value = URL.createObjectURL(blob)
  } catch { /* Keep the artwork placeholder when a source has no cover. */ }
}, { immediate: true })
onUnmounted(clear)
</script>
<template><img v-if="image" :src="image" class="cover" :alt="alt ?? '歌曲封面'"><span v-else class="cover artwork-placeholder" aria-hidden="true"><strong v-if="fallback" class="artist-initial">{{ [...fallback].slice(0, 2).join('') }}</strong><svg v-else viewBox="0 0 48 48"><circle cx="24" cy="24" r="17"/><circle cx="24" cy="24" r="5"/><path d="M10 25a14 14 0 0 1 15-15M23 38a14 14 0 0 0 15-15"/></svg></span></template>
