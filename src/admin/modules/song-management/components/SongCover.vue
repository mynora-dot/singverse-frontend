<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { MediaSong } from '../../media-library/types'
import { songCoverUrl, songTitle } from '../../metadata/utils'
// Playback records carry a song ID rather than the complete library metadata.
const props = withDefaults(defineProps<{ song?: MediaSong; songId?: string; title?: string; fallbackOnly?: boolean; variant?: 'thumbnail' | 'original' }>(), { variant: 'thumbnail' })
const failed = ref(false)
const refreshVersion = ref(0)
watch(() => props.song?.metadata, () => { refreshVersion.value++ })
const id = computed(() => props.song?.id ?? props.songId ?? '')
const title = computed(() => props.song ? songTitle(props.song) : props.title || '未命名歌曲')
const artwork = computed(() => {
  if (!id.value) return ''
  const metadata = props.song?.metadata
  const available = !props.song || (metadata && !metadata.stale && metadata.fields.includes('cover') && metadata.track.coverUrl)
  if (!available) return ''
  const url = songCoverUrl(props.song ?? { id: id.value }, props.variant)
  // A fresh snapshot can precede the background cover attachment. Revalidate
  // even when its formal cover reference has not advanced yet.
  return refreshVersion.value ? `${url}${url.includes('?') ? '&' : '?'}refresh=${refreshVersion.value}` : url
})
watch(() => [id.value, props.song?.metadata, artwork.value], () => { failed.value = false })
</script>
<template>
  <span class="song-cover">
    <img v-if="artwork && !failed && !fallbackOnly" :src="artwork" :alt="`${title}的封面`" loading="lazy" decoding="async" width="48" height="48" @error="failed = true">
    <span v-else class="song-cover-placeholder" role="img" aria-label="暂无歌曲封面"><span class="record-grooves"><span>{{ title.slice(0, 1) }}</span></span></span>
  </span>
</template>
<style scoped>
.song-cover {
  display: block;
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  overflow: hidden;
  border-radius: 8px;
  background: var(--sv-surface-3)
}

.song-cover img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover
}

.song-cover-placeholder {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  background: var(--sv-surface-3);
  position: relative;
  overflow: hidden
}

.record-grooves {
  width: 83%;
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--sv-record-groove), var(--sv-surface-3);
  transform: translate(15%, 9%);
  opacity: 1
}

.record-grooves>span {
  width: 35%;
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--sv-surface-3);
  color: var(--sv-text-tertiary);
  font: 500 clamp(12px, 2vw, 20px) var(--sv-font-editorial);
  border: 1px solid var(--sv-border-default)
}
</style>
