<script setup lang="ts">
import { useId } from 'vue'
import type { Song } from './api'
import PartyIcon from './PartyIcon.vue'
import SongArtwork from './SongArtwork.vue'

defineProps<{ song: Song; token?: string; favorite: boolean; favoriteDisabled?: boolean; addDisabled?: boolean }>()
defineEmits<{ detail: [song: Song]; favorite: [song: Song]; add: [song: Song] }>()
const creditsId = useId()
</script>

<template>
  <article class="song-row" :class="{ unavailable: song.available === false }">
    <button class="song-open" :aria-label="`${song.title}，歌曲详情`" :aria-describedby="creditsId" @click="$emit('detail', song)">
      <SongArtwork :path="song.coverPath" :token="token" />
      <span class="song-meta">
        <span class="song-title">{{ song.title }}</span>
        <span :id="creditsId" class="song-artist">{{ song.artists?.join(' / ') || '歌手未知' }}<template v-if="song.album"> · {{ song.album }}</template></span>
        <span v-if="song.available === false" class="unavailable-note">来源不可用，暂时无法点唱</span>
      </span>
    </button>
    <button class="icon-btn favorite" :class="{ saved: favorite }" :aria-label="`${favorite ? '取消家庭收藏' : '加入家庭收藏'} ${song.title}`"
      :aria-describedby="creditsId" :aria-pressed="favorite" :disabled="favoriteDisabled" @click="$emit('favorite', song)">
      <PartyIcon name="heart" />
    </button>
    <button class="add-song" :aria-label="`点歌 ${song.title}`" :aria-describedby="creditsId"
      :disabled="addDisabled || song.available === false" @click="$emit('add', song)">
      <span><PartyIcon name="plus" />点歌</span>
    </button>
  </article>
</template>
