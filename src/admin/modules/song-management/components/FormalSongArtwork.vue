<script setup lang="ts">
import { computed, ref } from 'vue'
import { Headset } from '@element-plus/icons-vue'

const props = defineProps<{ cover: unknown }>()
const brokenUrl = ref('')
const url = computed(() => {
  const cover = props.cover
  if (!cover || typeof cover !== 'object' || !('assetId' in cover)) return ''
  return typeof cover.assetId === 'string' && cover.assetId
    ? '/api/v1/metadata/assets/' + encodeURIComponent(cover.assetId)
    : ''
})
</script>

<template>
  <span class="formal-artwork" aria-hidden="true">
    <img v-if="url && url !== brokenUrl" :key="url" :src="url" alt="" loading="lazy" decoding="async" @error="brokenUrl = url">
    <Headset v-else />
  </span>
</template>

<style scoped>
.formal-artwork {
  display: grid;
  flex: none;
  place-items: center;
  width: var(--formal-artwork-size, 42px);
  height: var(--formal-artwork-size, 42px);
  overflow: hidden;
  border-radius: var(--sv-radius-md);
  background: var(--sv-accent-soft);
  color: var(--sv-accent-muted);
}
.formal-artwork img { width: 100%; height: 100%; object-fit: cover; }
.formal-artwork svg { width: 18px; height: 18px; }
</style>
