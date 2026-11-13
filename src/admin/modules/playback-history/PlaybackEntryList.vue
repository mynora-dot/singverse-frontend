<script setup lang="ts">
import { ElButton, ElTag } from 'element-plus'
import SongCover from '../song-management/components/SongCover.vue'
import type { PlaybackEntry } from './api'
import { clientNames, date, duration, inclusionLabel, statusNames, versionLabel } from './presentation'

defineProps<{ items: PlaybackEntry[]; showHistory?: boolean; singleSong?: boolean }>()
defineEmits<{ history: [song: PlaybackEntry] }>()
</script>

<template>
  <div class="playback-entry-list" :class="{ 'single-song': singleSong }">
    <div v-if="!singleSong" class="playback-entry-heading" aria-hidden="true">
      <span>歌曲 / 歌手</span><span>开始 / 结束时间</span><span>实际播放</span><span>设备 / 点歌人</span><span>播放结果</span><span v-if="showHistory">操作</span>
    </div>
    <article v-for="entry in items" :key="entry.id" class="playback-entry">
      <div v-if="!singleSong" class="entry-song">
        <SongCover :song-id="entry.songId" :title="entry.title" />
        <div class="entry-song-copy"><h3>{{ entry.title || '未命名歌曲' }}</h3><p>{{ entry.artists.join(' / ') || '未知歌手' }}</p><small>{{ versionLabel(entry.versionLabel) }}<template v-if="entry.sourceName"> · {{ entry.sourceName }}</template></small></div>
      </div>
      <div class="entry-time"><time :datetime="entry.startedAt">{{ date(entry.startedAt) }}</time><small v-if="entry.endedAt">结束于 {{ date(entry.endedAt) }}</small></div>
      <div class="entry-length"><span class="entry-label">实际播放</span><span>{{ duration(entry.playedMs) }}</span></div>
      <div class="entry-device"><span>{{ entry.deviceName || clientNames[entry.clientType] }}</span><small>点歌人：{{ entry.requestedBy || '未记录' }}</small></div>
      <div class="entry-result"><ElTag :type="entry.status === 'ERROR' ? 'danger' : entry.status === 'COMPLETED' ? 'success' : entry.status === 'PLAYING' ? 'primary' : 'info'">{{ statusNames[entry.status] || entry.status }}</ElTag><small>{{ inclusionLabel(entry) }}</small></div>
      <ElButton v-if="showHistory" class="entry-history" text type="primary" :aria-label="`查看${entry.title}的全部播放历史`" @click="$emit('history', entry)">播放历史</ElButton>
    </article>
  </div>
</template>

<style scoped>
.playback-entry-list { container: playback-entries / inline-size; }
.playback-entry-heading, .playback-entry { display: grid; grid-template-columns: minmax(230px, 1.6fr) minmax(155px, 1.1fr) minmax(100px, .7fr) minmax(125px, .9fr) minmax(112px, .8fr) 88px; gap: 20px; align-items: center; padding: 14px 20px; border-bottom: 1px solid var(--sv-border-subtle); }
.playback-entry-heading { padding-block: 12px; background: var(--sv-surface-1); color: var(--sv-text-secondary); font-size: 12px; }
.playback-entry:last-child { border-bottom: 0; }
.entry-song { display: flex; align-items: center; gap: 12px; min-width: 0; }
.entry-song-copy, .entry-time, .entry-length, .entry-device, .entry-result { display: grid; gap: 4px; min-width: 0; overflow-wrap: anywhere; }
.entry-song h3 { margin: 0; font-size: 16px; font-weight: 600; line-height: 1.5; }
.entry-song p { margin: 0; font-size: 14px; color: var(--sv-text-secondary); }
.playback-entry small { font-size: 12px; color: var(--sv-text-secondary); line-height: 1.6; }
.entry-time, .entry-length, .entry-device { font-size: 14px; line-height: 1.5; }
.entry-time, .entry-length { font-variant-numeric: tabular-nums; }
.entry-result { justify-items: start; }
.entry-result :deep(.el-tag) { height: 26px; font-size: 12px; }
.entry-label { display: none; color: var(--sv-text-secondary); font-size: 12px; }
.entry-history.el-button { margin: 0; min-width: 88px; height: 44px; padding: 0 8px; font-size: 14px; }
.single-song .playback-entry { grid-template-columns: 1fr 1fr; padding: 20px 0; gap: 12px 20px; }
.single-song .entry-time { grid-column: 1 / -1; }
.single-song .entry-label { display: block; }
.single-song .entry-result { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
@container playback-entries (max-width: 1080px) {
  .playback-entry-heading { display: none; }
  .playback-entry { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 112px; gap: 12px 20px; padding: 20px; }
  .entry-song { grid-column: 1; grid-row: 1; }
  .entry-time { grid-column: 2; grid-row: 1; }
  .entry-length { grid-column: 1; grid-row: 2; }
  .entry-device { grid-column: 2; grid-row: 2; }
  .entry-result { grid-column: 3; grid-row: 2; }
  .entry-history { grid-column: 3; grid-row: 1; justify-self: end; }
  .entry-label { display: block; }
  .single-song .entry-time, .single-song .entry-length, .single-song .entry-device, .single-song .entry-result { grid-row: auto; grid-column: auto; }
  .single-song .entry-time, .single-song .entry-result { grid-column: 1 / -1; }
}
@container playback-entries (max-width: 580px) {
  .playback-entry { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px 12px; padding: 20px 16px; }
  .entry-song { grid-column: 1 / -1; }
  .entry-song h3 { font-size: 16px; }
  .entry-time { grid-column: 1 / -1; grid-row: 2; }
  .entry-length { grid-column: 1; grid-row: 3; }
  .entry-device { grid-column: 2; grid-row: 3; }
  .entry-result { grid-column: 1; grid-row: 4; }
  .entry-history { grid-column: 2; grid-row: 4; align-self: center; }
}
</style>
