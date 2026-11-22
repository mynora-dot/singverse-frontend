<script setup lang="ts">
import { Headset as SongPlaceholderIcon } from '@element-plus/icons-vue'
import { computed, onBeforeUnmount, ref } from 'vue'
import { ElIcon, ElAlert, ElButton, ElDialog, ElInput, ElMessage, ElOption, ElOptionGroup, ElPagination, ElSelect, type InputInstance } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import SongCover from '../../song-management/components/SongCover.vue'
import { songs, type SongFilters } from '../../song-management/api/songs'
import { songArtists, songTitle } from '../../metadata/utils'
import type { MediaSong, MediaSource } from '../../media-library/types'
import { classification } from '../api/classification'
import { dimensionNames, type Tag } from '../types'
const props = defineProps<{ selectedIds: string[]; purpose?: string }>()
const emit = defineEmits<{ close: []; confirm: [ids: string[]]; selectedSongs: [songs: MediaSong[]] }>()
const classificationPicker = computed(() => props.purpose !== 'playlist')
const limit=props.purpose==='playlist'?500:5000
const selectedModels=new Map<string,MediaSong>()
const selected = ref(new Set(props.selectedIds)), items = ref<MediaSong[]>([])
const search = ref(''), sourceId = ref(''), status = ref('ALL'), tagIds = ref<string[]>([]), unclassified = ref(classificationPicker.value)
const moreFilters = ref(false)
const applied = ref<SongFilters>({ q: '', search: '', sourceId: '', status: 'ALL', page: 0, size: 20, ...(unclassified.value ? { unclassified: true } : {}) })
const page = ref(0), total = ref(0), loading = ref(false), error = ref('')
const sources = ref<MediaSource[]>([]), tags = ref<Tag[]>([])
const sourcesLoading = ref(false), tagsLoading = ref(false), sourcesError = ref(''), tagsError = ref('')
const filtered = computed(() => !!applied.value.search || !!applied.value.sourceId || applied.value.status !== 'ALL' || !!applied.value.tagIds?.length)
const canReset = computed(() => filtered.value || classificationPicker.value && !applied.value.unclassified)
const unclassifiedEmpty = computed(() => classificationPicker.value && !!applied.value.unclassified && !filtered.value)
const moreFilterCount = computed(() => Number(status.value !== 'ALL') + Number(tagIds.value.length > 0))
const tagGroups = computed(() => Object.entries(dimensionNames).map(([dimension, label]) => ({
  dimension, label, tags: tags.value.filter(tag => tag.active && tag.dimension === dimension),
})).filter(group => group.tags.length))
const searchInput = ref<InputInstance>()
const pageSelected = computed(() => items.value.filter(song => selected.value.has(song.id)).length)
const allOnPage = computed(() => items.value.length > 0 && pageSelected.value === items.value.length)
const partialPage = computed(() => pageSelected.value > 0 && !allOnPage.value)
const rangeStart = computed(() => items.value.length ? page.value * 20 + 1 : 0)
const rangeEnd = computed(() => page.value * 20 + items.value.length)
let active = true, generation = 0
async function load() {
  const token = ++generation; loading.value = true; error.value = ''; items.value = []
  try {
    const result = await songs.list({ ...applied.value, page: page.value })
    if (!active || token !== generation) return
    result.items.forEach(s=>selectedModels.set(s.id,s));items.value = result.items; total.value = result.totalElements
  } catch (e) { if (active && token === generation) error.value = e instanceof Error ? e.message : '歌曲读取失败，请重试' }
  finally { if (active && token === generation) loading.value = false }
}
async function loadSources() {
  sourcesLoading.value = true; sourcesError.value = ''
  try { const result = await songs.sources(); if (active) sources.value = result }
  catch { if (active) sourcesError.value = '媒体库读取失败' }
  finally { if (active) sourcesLoading.value = false }
}
async function loadTags() {
  tagsLoading.value = true; tagsError.value = ''
  try { const result = await classification.tags(); if (active) tags.value = result }
  catch { if (active) tagsError.value = '分类标签读取失败' }
  finally { if (active) tagsLoading.value = false }
}
function query() {
  applied.value = {
    q: '', search: search.value.trim(), sourceId: sourceId.value, status: status.value, page: 0, size: 20,
    ...(tagIds.value.length ? { tagIds: [...tagIds.value] } : {}),
    ...(unclassified.value ? { unclassified: true } : {}),
  }
  page.value = 0; void load()
}
function changeScope(value: boolean) {
  if (unclassified.value === value) return
  unclassified.value = value
  if (value) tagIds.value = []
  query()
}
function filterTags() { if (tagIds.value.length) unclassified.value = false; query() }
function resetFilters() { search.value = ''; sourceId.value = ''; status.value = 'ALL'; tagIds.value = []; unclassified.value = classificationPicker.value; moreFilters.value = false; query() }
function changePage(value: number) { if (value - 1 === page.value) return; page.value = value - 1; void load() }
function toggle(id: string, checked: boolean) {
  const next = new Set(selected.value)
  if (checked && !next.has(id) && next.size >= limit) { ElMessage.warning(`一次最多选择 ${limit} 首歌曲`); return }
  if (checked) next.add(id); else next.delete(id)
  selected.value = next
}
function togglePage(checked: boolean) {
  const next = new Set(selected.value); let limited = false
  for (const song of items.value) {
    if (!checked) next.delete(song.id)
    else if (next.has(song.id) || next.size < limit) next.add(song.id)
    else limited = true
  }
  selected.value = next
  if (limited) ElMessage.warning(`已达到 ${limit} 首上限，其余歌曲未选中`)
}
onBeforeUnmount(() => { active = false; generation++ })
void load()
if (classificationPicker.value) { void loadSources(); void loadTags() }
</script>
<template>
  <ElDialog class="classification-song-picker" :model-value="true" :title="purpose==='playlist'?'选择歌单歌曲':'选择要分类的歌曲'" width="min(820px, calc(100vw - 32px))" :close-on-click-modal="false" @close="emit('close')" @opened="searchInput?.focus()">
    <div class="picker-controls" :class="{ 'classification-controls': classificationPicker }">
      <div v-if="classificationPicker" class="picker-scope-bar">
        <div class="picker-scope-options" role="group" aria-label="分类状态">
          <button type="button" :aria-pressed="unclassified" @click="changeScope(true)">未分类</button>
          <button type="button" :aria-pressed="!unclassified" @click="changeScope(false)">全部歌曲</button>
        </div>
        <ElButton v-if="canReset" text @click="resetFilters">重置筛选</ElButton>
      </div>
      <form class="picker-search" @submit.prevent="query"><ElInput ref="searchInput" v-model="search" aria-label="搜索歌名或歌手" placeholder="搜索歌名、歌手或文件名" maxlength="200" clearable :prefix-icon="Search" @clear="query" /><ElButton native-type="submit" :loading="loading">搜索</ElButton></form>
      <div v-if="classificationPicker" class="picker-primary-filters" aria-label="歌曲筛选">
        <ElSelect v-model="sourceId" class="picker-source-filter" aria-label="媒体库" placeholder="全部媒体库" filterable clearable :loading="sourcesLoading" :disabled="sourcesLoading || !!sourcesError" @change="query"><ElOption label="全部媒体库" value="" /><ElOption v-for="source in sources" :key="source.id" :value="source.id" :label="source.name" /></ElSelect>
        <ElButton text :type="moreFilterCount ? 'primary' : undefined" :aria-expanded="moreFilters" aria-controls="classification-picker-more-filters" @click="moreFilters = !moreFilters">{{ moreFilters ? '收起筛选' : '更多筛选' }}<span v-if="moreFilterCount">（{{ moreFilterCount }}）</span></ElButton>
      </div>
    </div>
    <template v-if="classificationPicker">
      <div v-if="moreFilters" id="classification-picker-more-filters" class="picker-filters" :class="{ 'unclassified-only': unclassified }" aria-label="更多歌曲筛选">
        <ElSelect v-if="!unclassified" v-model="tagIds" class="picker-tag-filter" aria-label="已有分类标签" placeholder="已有分类标签" multiple filterable clearable collapse-tags collapse-tags-tooltip :multiple-limit="40" :loading="tagsLoading" :disabled="tagsLoading || !!tagsError" @change="filterTags"><ElOptionGroup v-for="group in tagGroups" :key="group.dimension" :label="group.label"><ElOption v-for="tag in group.tags" :key="tag.id" :value="tag.id" :label="tag.name" /></ElOptionGroup></ElSelect>
        <ElSelect v-model="status" class="picker-status-filter" aria-label="文件名识别状态" @change="query"><ElOption label="全部识别状态" value="ALL" /><ElOption label="文件名待复核" value="REVIEW" /><ElOption label="无需文件名复核" value="MATCHED" /></ElSelect>
      </div>
      <div v-if="sourcesError || moreFilters && !unclassified && tagsError" class="picker-filter-errors" role="status"><span v-if="sourcesError">{{ sourcesError }}<ElButton link :loading="sourcesLoading" @click="loadSources">重试媒体库</ElButton></span><span v-if="moreFilters && !unclassified && tagsError">{{ tagsError }}<ElButton link :loading="tagsLoading" @click="loadTags">重试标签</ElButton></span></div>
    </template>
    <div class="picker-toolbar"><label><input type="checkbox" aria-label="选择本页歌曲" :checked="allOnPage" :indeterminate="partialPage" :disabled="loading || !items.length" @change="togglePage(($event.target as HTMLInputElement).checked)">选择本页</label><span>已选 {{ selected.size }} 首</span><ElButton v-if="selected.size" text size="small" @click="selected = new Set()">清空已选</ElButton></div>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" show-icon><ElButton text @click="load">重新加载</ElButton></ElAlert>
    <div v-if="loading" class="picker-empty" role="status">正在读取歌曲…</div>
    <div v-else-if="!error && !items.length" class="picker-empty"><span class="empty-note" aria-hidden="true"><ElIcon><SongPlaceholderIcon /></ElIcon></span><h3>{{ unclassifiedEmpty ? '没有未分类的歌曲' : filtered ? '没有找到匹配的歌曲' : '曲库中还没有歌曲' }}</h3><ElButton v-if="unclassifiedEmpty" text @click="changeScope(false)">查看全部歌曲</ElButton><ElButton v-else-if="filtered" text @click="resetFilters">清除筛选</ElButton></div>
    <div v-else-if="!error" class="picker-song-list"><label v-for="song in items" :key="song.id" class="picker-song" :class="{ selected: selected.has(song.id) }"><input type="checkbox" :aria-label="`选择歌曲：${songTitle(song)}`" :checked="selected.has(song.id)" :disabled="!selected.has(song.id) && selected.size >= limit" @change="toggle(song.id, ($event.target as HTMLInputElement).checked)"><SongCover class="picker-song-art" :song="song" /><span class="picker-song-name"><strong>{{ songTitle(song) }}</strong><small>{{ songArtists(song).join('、') || '未知歌手' }}</small></span><span class="picker-song-location"><strong>{{ song.sourceName }}</strong><small :title="song.relativePath">{{ song.relativePath }}</small></span></label></div>
    <div class="picker-pagination"><small v-if="!loading && !error">{{ items.length ? `第 ${rangeStart}–${rangeEnd} 首，共 ${total} 首` : `共 ${total} 首` }}</small><ElPagination :current-page="page + 1" :total="total" :page-size="20" :pager-count="5" :disabled="loading" layout="prev, pager, next" @current-change="changePage" /></div>
    <template #footer><div class="picker-footer"><span>已选择 <strong>{{ selected.size }}</strong> 首 <small>· 最多 {{ limit }} 首</small></span><div><ElButton @click="emit('close')">取消</ElButton><ElButton type="primary" :disabled="!selected.size && !props.selectedIds.length" @click="emit('selectedSongs',[...selected].map(id=>selectedModels.get(id)).filter((s):s is MediaSong=>!!s));emit('confirm', [...selected])">确认选择<span v-if="selected.size">（{{ selected.size }} 首）</span></ElButton></div></div></template>
  </ElDialog>
</template>
<style scoped>
.picker-search {
  flex-shrink: 0;
  display: flex;
  gap: 12px
}

.picker-search .el-input {
  flex: 1;
  min-width: 0
}

.picker-controls { flex-shrink: 0; display: grid; gap: 12px; min-width: 0; }
.classification-controls { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
.classification-controls .picker-search { grid-column: 1 / -1; grid-row: 2; }
.picker-scope-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
.picker-scope-options { display: flex; gap: 8px; }
.picker-scope-options button { min-height: 40px; padding: 8px 20px; border: 1px solid var(--sv-border-default); border-radius: 8px; background: var(--sv-surface-2); color: var(--sv-text-secondary); font: 400 14px var(--sv-font-sans); cursor: pointer; }
.picker-scope-options button[aria-pressed='true'] { border-color: var(--sv-accent-primary); background: var(--sv-accent-soft); color: var(--sv-accent-primary); }
.picker-scope-options button:hover { border-color: var(--sv-accent-primary); color: var(--sv-accent-primary); }
.picker-scope-options button:focus-visible { outline: 2px solid var(--sv-accent-primary); outline-offset: 3px; }
.picker-primary-filters,
.picker-filters {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  gap: 12px;
  margin-top: 12px
}

.picker-primary-filters { grid-template-columns: minmax(0, 1fr) auto; grid-column: 2; grid-row: 1; margin-top: 0; }
.picker-filters.unclassified-only { grid-template-columns: minmax(0, 1fr); }
.picker-primary-filters .el-select, .picker-filters .el-select { width: 100%; min-width: 0; }
.picker-filter-errors { flex-shrink: 0; display: flex; flex-wrap: wrap; gap: 4px 16px; color: var(--sv-semantic-warn); font-size: 12px; }
.picker-filter-errors>span { display: flex; align-items: center; gap: 8px; }

.picker-toolbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: 48px;
  font-size: 12px;
  border-bottom: 1px solid var(--sv-border-subtle)
}

.picker-toolbar>label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer
}

.picker-toolbar>span {
  margin-left: auto;
  color: var(--sv-text-secondary)
}

input[type=checkbox] {
  width: 16px;
  height: 16px;
  accent-color: var(--sv-accent-primary);
  flex-shrink: 0;
  cursor: pointer
}

input:focus-visible {
  outline: 2px solid var(--sv-accent-primary);
  outline-offset: 3px
}

.picker-song-list {
  min-height: 140px;
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain
}

.picker-song {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 12px;
  border-bottom: 1px solid var(--sv-border-subtle);
  cursor: pointer;
  border-radius: 8px
}

.picker-song:hover {
  background: var(--sv-surface-2)
}

.picker-song.selected {
  background: var(--sv-accent-soft)
}

.picker-song-art {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: var(--sv-surface-2);
  color: var(--sv-accent-primary);
  font-size: 21px;
  flex-shrink: 0
}

.picker-song-name {
  flex: 1;
  min-width: 0
}

.picker-song-name strong {
  display: block;
  font-size: 13px;
  font-weight: 500;
  overflow-wrap: anywhere;
  line-height: 1.7
}

.picker-song-name small {
  display: block;
  font-size: 12px;
  color: var(--sv-text-secondary);
  margin-top: 4px;
  overflow-wrap: anywhere
}

.picker-song-location {
  width: 40%;
  min-width: 0;
  text-align: right
}

.picker-song-location strong {
  display: block;
  font-size: 12px;
  font-weight: 400;
  color: var(--sv-text-secondary);
  overflow-wrap: anywhere
}

.picker-song-location small {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  color: var(--sv-text-tertiary);
  margin-top: 4px
}

.picker-pagination {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 20px
}

.picker-pagination>small {
  font-size: 12px;
  color: var(--sv-text-secondary)
}

.picker-pagination :deep(.el-pagination) {
  flex-wrap: wrap
}

.picker-empty {
  flex: 1;
  overflow-y: auto;
  display: grid;
  place-items: center;
  gap: 12px;
  padding: 40px 20px;
  min-height: 180px;
  text-align: center;
  font-size: 13px;
  color: var(--sv-text-secondary)
}

.picker-empty h3 {
  font-size: 15px;
  font-weight: 500;
  color: var(--sv-text-primary)
}

.picker-empty p {
  font-size: 12px;
  line-height: 1.8
}

.empty-note {
  font-size: 32px;
  color: var(--sv-accent-primary)
}

.picker-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  text-align: left
}

.picker-footer>span {
  font-size: 12px;
  color: var(--sv-text-secondary)
}

.picker-footer strong {
  color: var(--sv-accent-primary)
}

.picker-footer small {
  font-size: 12px
}

.picker-footer>div {
  display: flex;
  gap: 12px
}

.picker-footer .el-button+.el-button {
  margin-left: 0
}

:global(.classification-song-picker.el-dialog) {
  display: flex;
  flex-direction: column;
  max-height: 88dvh
}

:global(.classification-song-picker>.el-dialog__body) {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0
}

:global(.classification-song-picker>.el-dialog__header),
:global(.classification-song-picker>.el-dialog__footer) {
  flex-shrink: 0
}

@media(max-width:600px) {
  .picker-song {
    flex-wrap: wrap;
    gap: 8px 12px;
    padding: 12px 8px
  }

  .picker-song-location {
    flex-basis: 100%;
    width: 100%;
    text-align: left;
    padding-left: 28px
  }

  .picker-song-location strong {
    display: inline;
    font-size: 12px
  }

  .picker-song-location small {
    display: inline;
    margin-left: 8px
  }

  .picker-song-art {
    width: 34px;
    height: 34px
  }

  .picker-song-location small {
    display: none
  }

  .picker-footer {
    align-items: stretch;
    flex-direction: column;
    gap: 12px
  }

  .picker-footer>div {
    display: grid;
    grid-template-columns: 1fr 1.5fr
  }

  .picker-pagination {
    margin-top: 12px
  }

  .picker-pagination :deep(.el-pager) { display: none; }
  .picker-pagination :deep(.el-pagination) { gap: 8px; }
  .picker-song-list { min-height: 72px; }

  :global(.classification-song-picker.el-dialog) { max-height: 92dvh; }
  :global(.classification-song-picker>.el-dialog__body) { overflow-y: auto; }
}

@media(max-width:768px) {
  .picker-toolbar > label { min-height: 44px; }
  .picker-scope-options button { min-height: 44px; padding: 8px 12px; }
  .picker-primary-filters :deep(.el-select__wrapper), .picker-filters :deep(.el-select__wrapper) { min-height: 44px; }
}

@media(max-width:600px) {
  .classification-controls { grid-template-columns: minmax(0, 1fr); }
  .classification-controls .picker-search { grid-column: 1; grid-row: 2; }
  .picker-primary-filters { grid-column: 1; grid-row: 3; gap: 8px; }
  .picker-filters { gap: 8px; margin-top: 8px; }
  .picker-filters { grid-template-columns: minmax(0, 1fr); }
}
</style>
