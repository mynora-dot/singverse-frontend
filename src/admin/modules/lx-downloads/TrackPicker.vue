<script setup lang="ts">
import { computed } from 'vue'
import { ElButton, ElCheckbox } from 'element-plus'
import { duration, type Track } from './api'
import PlatformBadge from './PlatformBadge.vue'
import TrackArtwork from './TrackArtwork.vue'
const props = defineProps<{ tracks: Track[]; selected: string[]; disabled?: boolean }>()
const emit = defineEmits<{ 'update:selected': [value: string[]]; download: [tracks: Track[]] }>()
const available = computed(() => props.tracks.filter(t => !t.downloading && !t.inLibrary))
const all = computed(() => available.value.length > 0 && available.value.every(t => props.selected.includes(t.id)))
function toggle(id: string, checked: boolean) { emit('update:selected', checked ? [...new Set([...props.selected, id])] : props.selected.filter(v => v !== id)) }
function toggleAll(checked: boolean) { const ids = available.value.map(t => t.id); emit('update:selected', checked ? [...new Set([...props.selected, ...ids])] : props.selected.filter(id => !ids.includes(id))) }
</script>
<template>
  <div class="picker">
    <div class="selection"><ElCheckbox :model-value="all" :indeterminate="!all && selected.some(id => available.some(t => t.id === id))" :disabled="disabled || !available.length" @change="value => toggleAll(!!value)">选择已读取歌曲</ElCheckbox><span aria-live="polite">已选 {{ selected.length }} 首</span><ElButton type="primary" :disabled="disabled || !selected.length" @click="emit('download', tracks.filter(t => selected.includes(t.id)))">下载所选</ElButton></div>
    <div class="list-heading" aria-hidden="true"><span>歌曲 / 歌手</span><span>专辑</span><span>时长</span><span>来源</span><span></span></div>
    <ul class="track-list" aria-label="歌曲列表">
      <li v-for="track in tracks" :key="track.id" class="track">
        <ElCheckbox :model-value="selected.includes(track.id)" :disabled="disabled || track.downloading || track.inLibrary" :aria-label="'选择 ' + track.title" @change="value => toggle(track.id, !!value)" />
        <div class="song"><TrackArtwork :url="track.coverUrl" /><div class="identity"><strong>{{ track.title }}</strong><span>{{ track.artists.join(' / ') }}</span></div></div>
        <span class="album">{{ track.album || '专辑未知' }}</span><span class="duration">{{ duration(track.durationMs) }}</span><PlatformBadge :platform="track.platform" />
        <span v-if="track.downloading" class="state" role="status">下载中</span><a v-else-if="track.inLibrary && track.songId" :href="'#/library/songs?detailSongId=' + encodeURIComponent(track.songId)" class="state">已在曲库 ↗</a><ElButton v-else :disabled="disabled" @click="emit('download', [track])">下载</ElButton>
      </li>
    </ul>
  </div>
</template>
<style scoped>
.selection{display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:14px 0;border-bottom:1px solid var(--el-border-color-lighter)}.selection>span{font-size:14px;color:var(--el-text-color-secondary)}.selection>.el-button{margin-left:auto;min-height:40px;border-radius:8px}.selection :deep(.el-checkbox){min-height:40px}.list-heading{display:grid;grid-template-columns:minmax(220px,2fr) minmax(100px,1fr) 56px 116px 88px;gap:18px;padding:14px 0 12px 44px;background:var(--el-fill-color-lighter);font-size:12px;color:var(--el-text-color-secondary);border-bottom:1px solid var(--el-border-color-lighter)}.track-list{list-style:none;margin:0;padding:0}.track{display:grid;grid-template-columns:26px minmax(220px,2fr) minmax(100px,1fr) 56px 116px 88px;align-items:center;gap:18px;padding:16px 0;border-bottom:1px solid var(--el-border-color-lighter)}.track:last-child{border-bottom:0}.song{display:flex;align-items:center;gap:14px;min-width:0}.identity{display:flex;flex-direction:column;gap:7px;min-width:0}.identity strong{font-size:15px;font-weight:600}.identity strong,.identity span,.album{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.identity span,.album,.duration{font-size:14px;color:var(--el-text-color-secondary)}.duration{font-variant-numeric:tabular-nums}.track>.el-button{height:38px;border-radius:8px}.state{font-size:13px;color:var(--el-color-primary);line-height:1.6}.track>.el-checkbox{min-height:44px}.track :deep(.el-checkbox__input){padding:10px;margin-left:-10px}a:focus-visible{outline:2px solid var(--el-color-primary);outline-offset:4px}
@media(max-width:1000px){.track{grid-template-columns:26px minmax(180px,2fr) minmax(80px,1fr) 48px 100px 72px;gap:12px}.list-heading{grid-template-columns:minmax(180px,2fr) minmax(80px,1fr) 48px 100px 72px;gap:12px;padding-left:38px}.song{gap:10px}.platform-badge{font-size:12px}}
@media(max-width:760px){.list-heading{display:none}.selection{gap:8px;padding:10px 0}.selection>span{font-size:12px}.selection :deep(.el-checkbox){min-height:44px}.selection :deep(.el-checkbox__label){font-size:13px;padding-left:6px}.selection>.el-button{min-height:44px;padding:0 12px}.track{grid-template-columns:22px minmax(0,1fr) 64px;gap:6px 8px;padding:16px 0}.song{grid-column:2;grid-row:1;gap:10px}.song :deep(.artwork){width:46px;height:46px;border-radius:7px}.identity{gap:6px}.identity strong{white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere;font-size:14px;line-height:1.5}.identity{width:100%}.identity span{font-size:12px}.album{display:none}.duration{grid-column:2;grid-row:2;padding-left:56px;font-size:12px}.platform-badge{grid-column:2;grid-row:3;padding-left:56px}.state,.track>.el-button{grid-column:3;grid-row:1/4;min-height:44px;margin:0;padding:0 8px}.track>.el-checkbox{grid-row:1/4;align-self:start}}
</style>
