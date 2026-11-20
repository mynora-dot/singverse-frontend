<script setup lang="ts">
import { ElButton, ElIcon } from 'element-plus'
import { computed } from 'vue'
import { VideoPlay, EditPen, Check } from '@element-plus/icons-vue'
import SongCover from './SongCover.vue'
import { identityReviewed, needsSongReview, songReviewLabel, songVersionSummary, songFileName, songDurationText, songDurationCaption, indexTags, songTags } from '../presentation'
import { songTitle, songArtists } from '../../metadata/utils'
import type { Tag } from '../../classification/types'
import type { MediaSong } from '../../media-library/types'
const props = withDefaults(defineProps<{ song: MediaSong; tags?: Tag[]; tagIndex?: ReadonlyMap<string, Tag>; sourceLabel?: string; selectionMode?: boolean; selected?: boolean }>(), { tags: () => [], selectionMode: false, selected: false })
const tagIndex = computed(() => props.tagIndex ?? indexTags(props.tags))
const classifications = computed(() => songTags(props.song, tagIndex.value))
const reviewed = computed(() => identityReviewed(props.song))
const needsReview = computed(() => !!props.song.metadata?.stale || needsSongReview(props.song))
const reviewLabel = computed(() => props.song.metadata?.stale ? '信息已过期 · 需重审' : songReviewLabel(props.song))
const emit = defineEmits<{ click: []; play: []; edit: []; select: [song: MediaSong, selected: boolean] }>()
</script>
<template>
  <article class="song-card" :class="{ selected }">
    <div class="card-artwork">
      <button type="button" class="artwork-open" :aria-label="`查看 ${songTitle(song)} 的详情`" @click="emit('click')"><SongCover :song="song" variant="original" /></button>
      <label v-if="selectionMode" class="selection-checkbox"><input type="checkbox" :checked="selected" :aria-label="`选择 ${songTitle(song)}`" @change="emit('select', song, ($event.target as HTMLInputElement).checked)"></label>
      <span v-if="songDurationText(song)" class="cover-duration" :title="songDurationCaption(song)">{{ songDurationText(song) }}</span>
      <button type="button" class="cover-play" :aria-label="`播放 ${songTitle(song)}`" @click="emit('play')"><ElIcon><VideoPlay /></ElIcon></button>
    </div>
    <button type="button" class="song-card-title" :aria-label="`查看 ${songTitle(song)} 的详情，${songArtists(song).join('、') || '歌手待补充'}，${reviewLabel}`" @click="emit('click')">
      <span class="title-line">
        <strong :title="songTitle(song)">{{ songTitle(song) }}</strong>
        <span v-if="reviewed" class="reviewed-mark" role="img" :aria-label="reviewLabel" :title="reviewLabel"><ElIcon><Check /></ElIcon></span>
      </span>
      <span class="card-artist" :title="songArtists(song).join('、')">{{ songArtists(song).join('、') || '歌手待补充' }}</span>
    </button>
    <p class="card-version" :title="songVersionSummary(song)">{{ songVersionSummary(song) }}</p>
    <p class="card-file" :title="song.relativePath">{{ songFileName(song) }}</p>
    <p v-if="song.result.needsReview && reviewed" class="card-file">原文件名识别不完整 · 资料已确认</p>
    <p v-if="needsReview" class="song-status review">{{ reviewLabel }}</p>
    <div class="song-card-actions">
      <span v-if="classifications[0]" class="card-tag" :title="classifications[0].name">{{ classifications[0].name }}</span>
      <span class="card-source" :title="sourceLabel || song.sourceName" :aria-label="sourceLabel || song.sourceName">{{ sourceLabel || song.sourceName }}</span>
      <ElButton text :icon="EditPen" :aria-label="`${needsReview ? '复核' : '编辑'} ${songTitle(song)}`" @click="emit('edit')">{{ needsReview ? '复核' : '编辑' }}</ElButton>
    </div>
  </article>
</template>
<style scoped>
.song-card {
  min-width: 0;
  position: relative;
  padding: 0;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 12px;
  transition: border-color .18s, background-color .18s
}

.song-card.selected {
  border-color: var(--sv-accent-primary);
  background: var(--sv-accent-soft)
}

.card-artwork {
  position: relative;
  aspect-ratio: 1;
  isolation: isolate
}

.artwork-open {
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: none;
  display: block;
  border-radius: 12px;
  cursor: pointer;
  overflow: hidden
}

.artwork-open :deep(.song-cover) {
  width: 100%;
  height: 100%;
  border-radius: 0
}

.artwork-open :deep(.song-cover-placeholder) {
  font-size: 40px
}

.cover-play {
  position: absolute;
  right: 10px;
  bottom: 10px;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 1px solid #ffffff75;
  border-radius: 50%;
  background: #fff;
  color: #171717;
  box-shadow: 0 3px 12px rgb(36 31 23 / 18%);
  cursor: pointer;
  font-size: 22px
}

.cover-play:hover {
  background: var(--sv-accent-primary);
  color: var(--sv-on-accent)
}

.selection-checkbox {
  position: absolute;
  left: 10px;
  top: 10px;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 8px;
  background: var(--sv-surface-2);
  box-shadow: var(--sv-shadow-sm)
}

.selection-checkbox input {
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--sv-accent-primary);
  cursor: pointer
}

.artwork-open:focus-visible,
.cover-play:focus-visible,
.song-card-title:focus-visible,
.song-card-actions :deep(.el-button:focus-visible) {
  outline: 2px solid var(--sv-accent-primary);
  outline-offset: 3px
}

.cover-duration {
  position: absolute;
  left: 10px;
  bottom: 12px;
  padding: 1px 4px;
  background: #171717;
  color: white;
  border-radius: 4px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  pointer-events: none
}

.song-card-title {
  display: grid;
  gap: 4px;
  min-width: 0;
  width: 100%;
  text-align: left;
  background: transparent;
  color: inherit;
  border: 0;
  padding: 12px 0 4px;
  border-radius: 4px;
  cursor: pointer
}

.title-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0
}

.song-card-title strong {
  min-width: 0;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.5;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis
}

.card-artist {
  min-width: 0;
  font-size: 14px;
  line-height: 1.5;
  color: var(--sv-text-secondary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis
}

.song-card-title:hover strong {
  color: var(--sv-accent-primary)
}

.reviewed-mark {
  display: inline-flex;
  flex-shrink: 0;
  color: var(--sv-semantic-ok);
  font-size: 16px
}

.song-status {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.5
}

.song-status.review {
  color: var(--sv-semantic-warn)
}

.card-version, .card-file { margin: 3px 0; font-size: 12px; line-height: 1.5; color: var(--sv-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-file { color: var(--sv-text-tertiary); }

.card-tag {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 40%;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--sv-surface-3);
  color: var(--sv-text-secondary);
  font-size: 12px;
  line-height: 20px
}

.song-card-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: 44px;
  margin-top: 4px
}

.card-source {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--sv-text-secondary)
}

.song-card-actions :deep(.el-button) {
  margin: 0;
  flex-shrink: 0;
  padding: 0 2px;
  min-width: 52px;
  min-height: 44px;
  height: auto;
  font-size: 13px;
  color: var(--sv-text-secondary)
}

.song-card-actions :deep(.el-button:hover) {
  color: var(--sv-accent-primary)
}

@media(max-width:480px) {
  .song-card {
    padding: 0;
    border-radius: 8px
  }

  .song-card-title {
    padding-top: 8px
  }

  .song-card-title strong {
    font-size: 16px
  }

  .card-tag {
    max-width: 32%;
    padding: 1px 5px
  }

  .source-suffix {
    display: none
  }

  .cover-play {
    right: 8px;
    bottom: 8px
  }

  .song-card-actions {
    gap: 4px
  }

  .song-card-actions :deep(.el-button) {
    font-size: 12px;
    min-width: 44px;
    padding: 0
  }
}
</style>
