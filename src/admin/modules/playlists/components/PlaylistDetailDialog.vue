<script setup lang="ts">
import { ElButton, ElDialog, ElEmpty } from 'element-plus'
import SongCover from '../../song-management/components/SongCover.vue'
import type { Playlist } from '../api'
import { playlistSongSource, playlistSongVersion } from '../presentation'
defineProps<{ playlist: Playlist | null; busy: boolean }>()
const emit = defineEmits<{ close: []; edit: [] }>()
</script>
<template>
  <ElDialog :model-value="!!playlist" :title="playlist?.name || '歌单详情'" width="760px" class="playlist-detail-dialog" @close="emit('close')" destroy-on-close>
    <template v-if="playlist">
      <p v-if="playlist.description" class="playlist-description">{{ playlist.description }}</p>
      <p class="playlist-count">{{ playlist.count }} 首可用歌曲<span v-if="playlist.missingCount"> · {{ playlist.missingCount }} 首歌曲已移除</span></p>
      <ol v-if="playlist.songs.length" class="playlist-detail-songs" aria-label="歌单歌曲">
        <li v-for="song in playlist.songs" :key="song.id">
          <SongCover :song-id="song.id" :title="song.title" :fallback-only="!song.coverPath" />
          <div><RouterLink :to="{ path: '/library/songs', query: { lens: 'songs', detailSongId: song.id } }" @click="emit('close')">{{ song.title }}</RouterLink><p>{{ song.artists.join(' / ') || '歌手未补充' }}</p><small v-if="playlistSongVersion(song)">{{ playlistSongVersion(song) }}</small><small v-if="playlistSongSource(song)" class="song-source">{{ playlistSongSource(song) }}</small></div>
        </li>
      </ol>
      <ElEmpty v-else description="这张歌单还没有可用歌曲" />
    </template>
    <template #footer><ElButton @click="emit('close')">关闭</ElButton><ElButton type="primary" :disabled="busy" @click="emit('edit')">编辑歌单</ElButton></template>
  </ElDialog>
</template>
<style scoped>
.playlist-description { color: var(--sv-text-secondary); white-space: pre-wrap; line-height: 1.7; }
.playlist-count { margin: 12px 0; font-size: 13px; color: var(--sv-text-secondary); }
.playlist-detail-songs { list-style: none; margin: 0; padding: 0; max-height: 56dvh; overflow-y: auto; }
.playlist-detail-songs li { display: flex; align-items: center; gap: 16px; padding: 16px 0; border-bottom: 1px solid var(--sv-border-subtle); }
.playlist-detail-songs li>div { min-width: 0; flex: 1; }
.playlist-detail-songs a { font-weight: 600; color: var(--sv-text-primary); }
.playlist-detail-songs a:hover { color: var(--sv-accent-primary); }
.playlist-detail-songs p, .playlist-detail-songs small { display: block; margin: 4px 0 0; color: var(--sv-text-secondary); line-height: 1.6; overflow-wrap: anywhere; }
.song-source { font-size: 12px; color: var(--sv-text-tertiary) !important; }
</style>
