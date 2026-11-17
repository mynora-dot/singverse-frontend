<script setup lang="ts">
import { Headset as SongPlaceholderIcon } from '@element-plus/icons-vue'
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { ElIcon, ElAlert, ElButton, ElInput, ElMessageBox, ElPagination, ElSkeleton, ElSkeletonItem } from 'element-plus'
import { requestId as newRequestId } from '../../../shared/request-id'
import PageHeader from '../../shared/ui/PageHeader.vue'
import { playlists, type Playlist, type Song, type Draft } from './api'
import { ai } from '../ai-settings/api/ai'
import type { AiService } from '../ai-settings/types'
import type { MediaSong } from '../media-library/types'
import { songArtists, songTitle } from '../metadata/utils'
import SongPicker from '../classification/components/ClassificationSongPicker.vue'
import PlaylistEditorDialog from './components/PlaylistEditorDialog.vue'

const coverFailures = ref(new Set<string>())
const items = ref<Playlist[]>([]), query = ref(''), sort = ref('UPDATED_DESC')
const page = ref(1), total = ref(0), loading = ref(false), busy = ref(false), error = ref('')
const open = ref(false), picker = ref(false), current = ref<Playlist | null>(null)
const songs = ref<Record<string, Song>>({}), models = ref<AiService[]>([])
const proposal = ref<Draft | null>(null), generating = ref(false)
const form = reactive({ requestId: '', name: '', description: '', songIds: [] as string[], revision: 0 })
const generation = reactive({ prompt: '', q: '', limit: 20, modelServiceId: '' })
const originalForm = ref('')
type Editable = Pick<typeof form, 'name' | 'description' | 'songIds'>
const undoSnapshot = ref<(Editable & { label: string }) | null>(null)
const formValue = () => JSON.stringify({ name: form.name, description: form.description, songIds: form.songIds })
const dirty = computed(() => open.value && formValue() !== originalForm.value)

function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value || busy.value || generating.value) { event.preventDefault(); event.returnValue = '' }
}
async function leave() {
  if (busy.value || generating.value) { error.value = '正在处理歌单，请稍候再离开。'; return false }
  if (!dirty.value) return true
  try {
    await ElMessageBox.confirm('离开将放弃尚未保存的歌单编辑。', '有未保存的歌单', { confirmButtonText: '放弃编辑', cancelButtonText: '继续编辑', autofocus: false })
    return true
  } catch { return false }
}
onBeforeRouteLeave(leave)
let active = true, epoch = 0
function failure(e: unknown) { if (active) error.value = e instanceof Error ? e.message : '请求失败，请重试' }
async function load(reset = false) {
  if (reset) page.value = 1
  const seq = ++epoch
  loading.value = true
  try {
    const result = await playlists.list(query.value, page.value - 1, sort.value)
    if (active && seq === epoch) {
      items.value = result.items; total.value = result.totalElements
      const last = Math.max(1, Math.ceil(result.totalElements / 12))
      if (page.value > last) { page.value = last; await load() }
    }
  } catch (e) { if (active && seq === epoch) failure(e) }
  finally { if (active && seq === epoch) loading.value = false }
}
function create() {
  current.value = null; songs.value = {}
  Object.assign(form, { requestId: newRequestId(), name: '', description: '', songIds: [], revision: 0 })
  originalForm.value = formValue(); proposal.value = null; undoSnapshot.value = null; error.value = ''; open.value = true
}
async function edit(id: string) {
  if (busy.value) return
  busy.value = true
  try {
    const result = await playlists.get(id)
    if (!active) return
    current.value = result; songs.value = Object.fromEntries(result.songs.map(song => [song.id, song]))
    Object.assign(form, { requestId: '', name: result.name, description: result.description, songIds: [...result.songIds], revision: result.revision })
    originalForm.value = formValue(); proposal.value = null; undoSnapshot.value = null; error.value = ''; open.value = true
  } catch (e) { failure(e) }
  finally { if (active) busy.value = false }
}
async function close() {
  if (busy.value || generating.value) return
  if (dirty.value) {
    try { await ElMessageBox.confirm('关闭将放弃未保存的歌单编辑。', '关闭编辑', { confirmButtonText: '放弃编辑', cancelButtonText: '继续编辑', autofocus: false }) }
    catch { return }
  }
  open.value = false; picker.value = false; proposal.value = null; undoSnapshot.value = null
}
async function save() {
  if (busy.value || generating.value) return
  busy.value = true; error.value = ''
  try {
    const result = await playlists.save({ ...form, songIds: [...form.songIds] }, current.value?.id)
    if (!active) return
    current.value = result; form.revision = result.revision; open.value = false; undoSnapshot.value = null
    await load()
  } catch (e) { failure(e) }
  finally { if (active) busy.value = false }
}
async function remove(playlist: Playlist) {
  try { await ElMessageBox.confirm(`删除歌单“${playlist.name}”？歌曲文件和聚会队列会保留。`, '删除歌单', { confirmButtonText: '删除歌单', cancelButtonText: '保留', autofocus: false, type: 'warning' }) }
  catch { return }
  if (busy.value) return
  busy.value = true
  try { await playlists.remove(playlist.id, playlist.revision); if (active) await load() }
  catch (e) { failure(e) }
  finally { if (active) busy.value = false }
}
function remember(label: string) { undoSnapshot.value = { name: form.name, description: form.description, songIds: [...form.songIds], label } }
function updateEditor(value: Editable) {
  if (value.name !== form.name || value.description !== form.description) undoSnapshot.value = null
  Object.assign(form, value)
}
function undo() {
  if (!undoSnapshot.value || busy.value || generating.value) return
  const { name, description, songIds } = undoSnapshot.value
  Object.assign(form, { name, description, songIds: [...songIds] }); undoSnapshot.value = null
}
function rememberSongs(selected: MediaSong[]) {
  selected.forEach(song => {
    const metadata = song.metadata
    songs.value[song.id] = {
      id: song.id, title: songTitle(song) || '未知歌曲', artists: songArtists(song),
      coverPath: metadata && !metadata.stale && metadata.fields.includes('cover') && metadata.track.coverUrl ? `/api/v1/metadata/songs/${encodeURIComponent(song.id)}/cover?variant=thumbnail` : undefined,
    }
  })
}
function choose(ids: string[]) { remember('已更新所选歌曲'); form.songIds = [...ids]; picker.value = false }
function reorder(from: number, to: number) {
  if (busy.value || generating.value || from === to || from < 0 || to < 0 || from >= form.songIds.length || to >= form.songIds.length) return
  remember('已调整歌曲顺序')
  const list = [...form.songIds], [id] = list.splice(from, 1)
  list.splice(to, 0, id!); form.songIds = list
}
function move(index: number, direction: number) { reorder(index, index + direction) }
function removeSong(index: number) {
  if (busy.value || generating.value || index < 0 || index >= form.songIds.length) return
  const id = form.songIds[index]!
  remember(`已移除「${songs.value[id]?.title || '歌曲'}」`)
  form.songIds = form.songIds.filter((_, position) => position !== index)
}
async function generate() {
  if (generating.value || busy.value || !generation.prompt.trim() || !generation.modelServiceId) return
  const limit = Number(generation.limit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) { error.value = '推荐首数请输入 1–50 之间的整数。'; return }
  generating.value = true; error.value = ''
  try { const result = await playlists.generate({ ...generation, limit }); if (active) proposal.value = result }
  catch (e) { failure(e) }
  finally { if (active) generating.value = false }
}
function useProposal() {
  if (!proposal.value || busy.value || generating.value) return
  const result = proposal.value
  remember('已使用 AI 歌单建议')
  Object.assign(form, { name: result.name, description: result.description, songIds: [...result.songIds] })
  result.songs.forEach(song => { songs.value[song.id] = song }); proposal.value = null
}
onMounted(() => {
  window.addEventListener('beforeunload', beforeUnload)
  void load()
  void ai.services('MODEL').then(value => {
    if (active) { models.value = value.filter(model => model.enabled); generation.modelServiceId = models.value[0]?.id || '' }
  }).catch(failure)
})
onBeforeUnmount(() => { active = false; epoch++; window.removeEventListener('beforeunload', beforeUnload) })
</script>
<template>
<section class="playlist-page"><PageHeader title="歌单" description="共享歌单会出现在电视和亲友点歌页中。可手动选歌，也可让 AI 从曲库中推荐。"><template #meta><span class="playlist-total" aria-live="polite">{{ total }} 张</span></template><template #actions><ElButton type="primary" @click="create">创建歌单</ElButton></template></PageHeader>
<ElAlert v-if="error&&!open" :title="error" type="error" :closable="false"/>
<form class="toolbar playlist-filters sv-glass" @submit.prevent="load(true)"><ElInput v-model="query" placeholder="搜索歌单名称或简介" aria-label="搜索歌单" clearable @clear="load(true)"/><label>排序<select v-model="sort" aria-label="歌单排序" @change="load(true)"><option value="UPDATED_DESC">最近更新</option><option value="NAME_ASC">名称排序</option><option value="SONGS_DESC">歌曲最多</option></select></label><ElButton native-type="submit" :loading="loading">搜索 / 刷新</ElButton></form>
<p v-if="loading && items.length" role="status">正在刷新歌单…</p>
<div v-if="loading && !items.length" class="grid" role="status" aria-label="正在读取歌单"><ElSkeleton v-for="index in 4" :key="index" class="playlist-skeleton sv-glass" animated><template #template><ElSkeletonItem variant="image" style="width:100%;height:auto;aspect-ratio:1" /><ElSkeletonItem variant="h3" style="width:60%;margin-top:16px" /><ElSkeletonItem variant="text" style="width:40%;margin-top:12px" /></template></ElSkeleton></div>
<div v-else-if="!items.length" class="empty"><span><ElIcon><SongPlaceholderIcon /></ElIcon></span><h2>{{query?'没有找到歌单':'为下一次欢聚准备一张歌单'}}</h2><p>手动选歌，或让 AI 根据你的想法从曲库中推荐。</p><ElButton @click="create">创建第一张歌单</ElButton></div>
<div v-else class="grid"><article v-for="p in items" :key="p.id" class="card sv-glass"><button class="card-open" @click="edit(p.id)"><div class="cover"><img v-if="p.coverPath&&!coverFailures.has(p.id+(p.coverVersion||''))" @error="coverFailures.add(p.id+(p.coverVersion||''))" :src="`${p.coverPath}?v=${encodeURIComponent(p.coverVersion||'')}`" alt=""/><span v-else role="img" aria-label="暂无歌单封面"><ElIcon><SongPlaceholderIcon /></ElIcon></span></div><div class="card-copy"><h2 :title="p.name">{{p.name}}</h2><p>{{p.count}} 首可用歌曲<span v-if="p.missingCount"> · {{p.missingCount}} 首已移除</span></p><small :title="p.description">{{p.description||'打开歌单，选一首想唱的歌'}}</small></div></button><div class="card-actions"><ElButton text @click="edit(p.id)">编辑歌单</ElButton><ElButton text type="danger" :disabled="busy" @click="remove(p)">删除</ElButton></div></article></div>
<ElPagination v-if="total" :current-page="page" :total="total" :page-size="12" layout="total, prev, pager, next" @current-change="v=>{page=v;load()}"/>
<PlaylistEditorDialog :model-value="open" :editing="!!current" :form="form" :songs="songs" :generation="generation" :models="models" :proposal="proposal" :busy="busy" :generating="generating" :dirty="dirty" :error="error" :undo-label="undoSnapshot?.label || ''" @close="close" @save="save" @update:form="updateEditor" @update:generation="Object.assign(generation, $event)" @open-picker="picker=true" @move="move" @reorder="reorder" @remove="removeSong" @generate="generate" @dismiss-proposal="proposal=null" @use-proposal="useProposal" @undo="undo" />
<SongPicker v-if="picker" purpose="playlist" :selected-ids="form.songIds" @close="picker=false" @confirm="choose" @selected-songs="rememberSongs" />
</section>
</template>
<style scoped>
.playlist-page {
  display: grid;
  gap: 12px;
  min-width: 0
}

.playlist-page>.page-heading {
  margin-bottom: 0
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap
}

.playlist-filters {
  padding: 16px 20px;
  margin: 0 0 4px
}

.playlist-filters>.el-input {
  max-width: 360px
}

.playlist-filters label {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  color: var(--sv-text-secondary)
}

.playlist-skeleton { padding: 16px; }

.playlist-total { font-size: 13px; color: var(--sv-text-secondary); }

.playlist-list-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px
}

.playlist-list-heading>strong {
  font-size: 18px;
  font-weight: 500
}

.playlist-list-heading>span {
  font-size: 12px;
  color: var(--sv-text-secondary)
}

.playlist-page>.el-pagination {
  justify-content: flex-end
}

.grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 20px
}

.card {
  overflow: hidden
}

.card:hover {
  box-shadow: var(--sv-shadow-sm)
}

.card-open {
  padding: 0;
  border: 0;
  background: none;
  text-align: left;
  color: inherit;
  width: 100%;
  cursor: pointer
}

.cover {
  --sleeve-paper: var(--sv-surface-3);
  --sleeve-ink: var(--sv-text-tertiary);
  position: relative;
  isolation: isolate;
  aspect-ratio: 1.2;
  background: var(--sleeve-paper);
  display: grid;
  place-items: center;
  overflow: hidden
}

.cover::before {
  content: '';
  position: absolute;
  width: 105%;
  aspect-ratio: 1;
  right: -25%;
  bottom: -48%;
  border-radius: 50%;
  background: repeating-radial-gradient(circle, var(--sleeve-ink) 0 1px, transparent 2px 5px);
  opacity: .4;
  z-index: -1
}



.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover
}

.cover>span {
  display: grid;
  place-items: center;
  width: 84px;
  height: 84px;
  border-radius: 50%;
  background: var(--sv-surface-1);
  color: var(--sv-text-secondary);
  font-size: 28px
}

.card-copy {
  padding: 16px 16px 12px
}

.card-copy h2 {
  font-size: 17px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap
}

.card-copy p {
  font-size: 12px;
  color: var(--sv-text-secondary);
  margin: 8px 0
}

.card-copy small {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  line-height: 1.6;
  color: var(--sv-text-secondary);
  font-size: 12px
}

.card-actions {
  display: flex;
  justify-content: space-between;
  border-top: 1px solid var(--sv-border-subtle);
  margin: 0;
  padding: 8px
}

.card-actions :deep(.el-button) {
  margin: 0;
  font-size: 12px;
  min-height: 40px
}

.empty {
  text-align: center;
  padding: 60px 20px;
  border: 1px dashed var(--sv-border-default);
  border-radius: 16px
}

.empty>span {
  font-size: 44px;
  color: var(--sv-accent-primary)
}

.empty h2 {
  font-size: 20px;
  margin: 16px
}

.empty p {
  margin-bottom: 20px;
  font-size: 14px;
  line-height: 1.8;
  color: var(--sv-text-secondary)
}

@media(max-width:1200px) {
  .grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media(max-width:900px) {
  .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media(max-width:580px) {
  .grid { gap: 12px; }
  .card-copy { padding: 12px 0 8px; }
  .card-copy h2 { font-size: 14px; }
  .card-copy p, .card-copy small { font-size: 12px; }
  .card-actions { margin: 0; }
  .card-actions :deep(.el-button) { font-size: 12px; padding: 4px 2px; min-width: 44px; min-height: 44px; }
  .cover>span { width: 55px; height: 55px; font-size: 24px; }
  .playlist-list-heading>span { font-size: 12px; }
  .playlist-filters { gap: 8px; padding: 0; }
  .playlist-filters>.el-input { max-width: none; flex-basis: 100%; }
  .playlist-filters select { max-width: 150px; }
}
@media(max-width:768px) {
  .playlist-filters :deep(.el-input__inner) { font-size: 16px; }
  .playlist-filters select { min-height: 44px; }
}
</style>
