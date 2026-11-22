<script setup lang="ts">
import { computed } from 'vue'
import { lyricText } from '../lyrics'
import type { FormalLyrics } from '../types'

const props = defineProps<{ value?: FormalLyrics | null; label: string }>()
const text = computed(() => lyricText(props.value))
const format = computed(() => props.value?.timing === 'none' ? '纯文本歌词' : '同步歌词')
</script>

<template>
  <details v-if="text" class="lyric-preview">
    <summary :aria-label="`${label}，${format}`">{{ format }}</summary>
    <div class="lyric-text" role="region" :aria-label="label" tabindex="0">{{ text }}</div>
  </details>
</template>

<style scoped>
.lyric-preview summary {
  width: fit-content;
  padding-block: 10px;
  color: var(--sv-accent-muted);
  cursor: pointer;
}

.lyric-text {
  max-block-size: 12rem;
  overflow: auto;
  padding: 8px;
  border-radius: var(--sv-radius-sm);
  background: var(--sv-surface-3);
  color: var(--sv-text-primary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.lyric-preview summary:focus-visible, .lyric-text:focus-visible {
  outline: 2px solid var(--sv-accent-primary);
  outline-offset: 1px;
}
</style>
