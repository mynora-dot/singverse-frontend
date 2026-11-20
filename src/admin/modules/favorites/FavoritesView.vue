<script setup lang="ts">
import PageHeader from '../../shared/ui/PageHeader.vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElAlert, ElButton, ElDialog, ElIcon, ElInput, ElPagination, ElSkeleton } from 'element-plus'
import { Plus, Refresh, Search, Star, Delete } from '@element-plus/icons-vue'
import SongCover from '../song-management/components/SongCover.vue'
import { favoritesApi, type FavoriteSong } from './api'

const items = ref<FavoriteSong[]>([]), query = ref(''), availability = ref('ALL'), order = ref('RECENT')
const page = ref(1), total = ref(0), totalFavorites = ref(0), loaded = ref(false), loading = ref(false)
const readError = ref(''), mutationError = ref(''), notice = ref(''), busy = ref(false), lastRead = ref('')
const selected = ref(new Set<string>()), bulk = ref(false), detail = ref<FavoriteSong | null>(null)
const removing = ref<FavoriteSong[]>([]), addOpen = ref(false), addQuery = ref(''), addPage = ref(1)
const candidates = ref<FavoriteSong[]>([]), candidateTotal = ref(0), addLoading = ref(false), addError = ref('')
const added = ref(new Set<string>()), addSelected = ref(new Set<string>())
const allSelected = computed(() => items.value.length > 0 && items.value.every(song => selected.value.has(song.id)))
let active = true, readSequence = 0, addSequence = 0, timer: ReturnType<typeof setInterval> | undefined
const message = (e: unknown) => e instanceof Error ? e.message : '连接失败，请重试'
const artist = (song: FavoriteSong) => song.artists?.join(' / ') || '歌手未知'
function date(value: string) { return value ? new Date(value).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '—' }
function select(id: string, value: boolean, candidate = false) {
  const target = candidate ? addSelected : selected
  const next = new Set(target.value)
  if (value) next.add(id); else next.delete(id)
  target.value = next
}
function selectPage(value: boolean) { selected.value = value ? new Set(items.value.map(song => song.id)) : new Set() }
async function load(reset = false) {
  if (reset) { page.value = 1; selected.value = new Set() }
  const sequence = ++readSequence
  loading.value = true
  try {
    const result = await favoritesApi.list(query.value.trim(), availability.value, order.value, page.value - 1)
    if (!active || sequence !== readSequence) return
    items.value = result.items; total.value = result.totalElements; totalFavorites.value = result.totalFavorites
    readError.value = ''; loaded.value = true; lastRead.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    selected.value = new Set([...selected.value].filter(id => result.items.some(song => song.id === id)))
    const lastPage = Math.max(1, Math.ceil(result.totalElements / 20))
    if (page.value > lastPage) { page.value = lastPage; await load() }
  } catch (e) { if (active && sequence === readSequence) readError.value = message(e) }
  finally { if (active && sequence === readSequence) loading.value = false }
}
async function loadCandidates(reset = false) {
  if (reset) addPage.value = 1
  const sequence = ++addSequence
  addLoading.value = true; addError.value = ''
  try {
    const [library, state] = await Promise.all([favoritesApi.library(addQuery.value.trim(), addPage.value - 1), favoritesApi.ids()])
    if (!active || !addOpen.value || sequence !== addSequence) return
    candidates.value = library.items; candidateTotal.value = library.totalElements; added.value = new Set(state.songIds)
    addSelected.value = new Set([...addSelected.value].filter(id => !added.value.has(id)))
    const lastPage = Math.max(1, Math.ceil(library.totalElements / 20))
    if (addPage.value > lastPage) { addPage.value = lastPage; await loadCandidates() }
  } catch (e) { if (active && sequence === addSequence) addError.value = message(e) }
  finally { if (active && sequence === addSequence) addLoading.value = false }
}
function openAdd() {
  addOpen.value = true; addQuery.value = ''; candidates.value = []; addSelected.value = new Set(); notice.value = ''; mutationError.value = ''
  void loadCandidates(true)
}
function closeAdd(done?: () => void) { if (busy.value) return; addSequence++; addOpen.value = false; done?.() }
function confirmRemove(songs: FavoriteSong[]) { if (!songs.length || busy.value) return; removing.value = [...songs]; mutationError.value = ''; notice.value = '' }
async function save(selectedState: boolean) {
  if (busy.value) return
  const ids = selectedState ? [...addSelected.value] : removing.value.map(song => song.id)
  if (!ids.length) return
  busy.value = true; mutationError.value = ''; addError.value = ''
  try {
    const result = await favoritesApi.set(ids, selectedState)
    if (!active) return
    added.value = new Set(result.songIds)
    addOpen.value = false; removing.value = []; selected.value = new Set()
    notice.value = selectedState ? `已添加 ${ids.length} 首收藏` : `已取消 ${ids.length} 首收藏`
    await load()
  } catch (e) { if (active) mutationError.value = message(e) }
  finally { if (active) busy.value = false }
}
function refreshVisible() { if (document.visibilityState === 'visible' && !busy.value && !loading.value) void load() }
onMounted(() => { void load(); timer = setInterval(refreshVisible, 30000); window.addEventListener('focus', refreshVisible); document.addEventListener('visibilitychange', refreshVisible) })
onBeforeUnmount(() => { active = false; readSequence++; addSequence++; clearInterval(timer); window.removeEventListener('focus', refreshVisible); document.removeEventListener('visibilitychange', refreshVisible) })
</script>

<template>
  <section class="favorites-page">
    <PageHeader title="收藏管理">
      <template #actions><ElButton type="primary" :icon="Plus" :disabled="busy" @click="openAdd">添加歌曲</ElButton></template>
    </PageHeader>
    <ElAlert v-if="readError" type="error" :closable="false" class="read-error"><template #title>收藏读取失败：{{ readError }}</template><p>{{ loaded ? '当前显示上次成功读取的内容。' : '请检查连接后重试。' }}<ElButton text @click="load()">重新读取</ElButton></p></ElAlert>
    <p v-if="notice" class="success-notice" role="status">{{ notice }}</p>
    <form class="favorites-toolbar sv-glass" @submit.prevent="load(true)">
      <ElInput v-model="query" :prefix-icon="Search" placeholder="搜索歌名或歌手" aria-label="搜索收藏" maxlength="200" clearable @clear="load(true)" />
      <select v-model="availability" aria-label="收藏可用状态" @change="load(true)"><option value="ALL">全部状态</option><option value="AVAILABLE">可用歌曲</option><option value="UNAVAILABLE">暂不可用</option></select>
      <select v-model="order" aria-label="收藏排序" @change="load(true)"><option value="RECENT">最近收藏</option><option value="TITLE">歌名排序</option><option value="ARTIST">歌手排序</option></select>
      <ElButton native-type="submit" :loading="loading">搜索</ElButton>
      <ElButton class="desktop-refresh" :icon="Refresh" :disabled="busy || loading" aria-label="刷新收藏" @click="load()">刷新</ElButton>
    </form>
    <div class="result-bar" :class="{ bulk }">
      <strong v-if="bulk">已选 {{ selected.size }} 首<span class="selection-scope">（仅当前页）</span></strong>
      <template v-else><strong>{{ loaded ? `${totalFavorites} 首收藏` : loading ? '正在读取收藏…' : '收藏尚未读取' }}</strong><span v-if="loaded && (query || availability !== 'ALL')">找到 {{ total }} 首</span></template>
      <div class="result-actions">
        <ElButton v-if="bulk" type="danger" plain :disabled="!selected.size || busy || !!readError" @click="confirmRemove(items.filter(song => selected.has(song.id)))">取消所选收藏</ElButton>
        <ElButton :disabled="busy" @click="bulk = !bulk; selected = new Set()">{{ bulk ? '完成' : '批量管理' }}</ElButton>
        <ElButton class="mobile-refresh" :icon="Refresh" :disabled="busy || loading" aria-label="刷新收藏" @click="load()" />
      </div>
    </div>
    <div class="favorites-list sv-glass" :aria-busy="loading">
      <div v-if="items.length" class="list-head">
        <label v-if="bulk" class="check-target"><input type="checkbox" :checked="allSelected" :indeterminate="selected.size > 0 && !allSelected" aria-label="选择当前页全部收藏" :disabled="busy || !!readError" @change="selectPage(($event.target as HTMLInputElement).checked)"></label><span v-else />
        <span class="head-song">歌曲</span><span>专辑</span><span>收藏时间</span><span class="head-action">操作</span>
      </div>
      <article v-for="song in items" :key="song.id" class="favorite-row" :class="{ selected: selected.has(song.id) }">
        <label v-if="bulk" class="check-target"><input type="checkbox" :checked="selected.has(song.id)" :aria-label="`选择 ${song.title}`" :disabled="busy || !!readError" @change="select(song.id, ($event.target as HTMLInputElement).checked)"></label><span v-else class="row-spacer" />
        <button class="song-content" :aria-label="`查看 ${song.title} 的详情`" @click="detail = song">
          <SongCover :song-id="song.id" :title="song.title" :fallback-only="!song.available" />
          <span class="song-copy"><span class="song-title"><strong :title="song.title">{{ song.title }}</strong><span v-if="!song.available" class="unavailable">暂不可用</span></span><span class="song-artist">{{ artist(song) }}</span><span class="mobile-meta"><span class="mobile-album">{{ song.album || '专辑未知' }}</span><time :datetime="song.addedAt">{{ date(song.addedAt) }}</time></span></span>
        </button>
        <span class="album-cell" :title="song.album || ''">{{ song.album || '—' }}</span><time class="date-cell" :datetime="song.addedAt">{{ date(song.addedAt) }}</time>
        <button class="row-remove" :disabled="busy || !!readError" :aria-label="`取消收藏 ${song.title}`" @click="confirmRemove([song])"><span>取消收藏</span><ElIcon><Delete /></ElIcon></button>
      </article>
      <ElSkeleton v-if="loading && !loaded" :rows="8" animated class="favorites-skeleton" aria-label="正在读取收藏" />
      <div v-if="!items.length && !loading" class="list-state" role="status">
        <ElIcon><Star /></ElIcon>
        <h2>{{ loading ? '正在读取收藏…' : readError ? '暂时无法读取收藏' : query || availability !== 'ALL' ? '没有找到匹配的收藏' : '把想唱的歌留在一起' }}</h2>
        <ElButton v-if="!loading && !readError && !query && availability === 'ALL'" :icon="Plus" @click="openAdd">添加第一首歌</ElButton>
        <ElButton v-else-if="!loading && !readError" @click="query = ''; availability = 'ALL'; load(true)">查看全部收藏</ElButton>
      </div>
    </div>
    <footer class="favorites-footer"><span>{{ loading ? '正在刷新…' : lastRead ? `最近读取 ${lastRead}` : '等待服务器响应' }}</span><ElPagination v-if="total > 20" :current-page="page" :total="total" :page-size="20" layout="prev, pager, next" @current-change="value => { page = value; selected = new Set(); load() }" /></footer>
    <ElDialog v-model="addOpen" title="添加收藏歌曲" class="favorites-dialog" width="min(720px, calc(100vw - 32px))" :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy" :before-close="closeAdd">
      <ElAlert v-if="addOpen && (addError || mutationError)" :title="addError || mutationError" type="error" :closable="false" />
      <form class="add-search" @submit.prevent="loadCandidates(true)"><ElInput v-model="addQuery" aria-label="搜索曲库" placeholder="搜索歌名或歌手" maxlength="200" clearable @clear="loadCandidates(true)" /><ElButton native-type="submit" :loading="addLoading" :disabled="busy">搜索</ElButton></form>
      <p v-if="addLoading" role="status">正在读取曲库与收藏状态…</p>
      <div class="candidate-list" :aria-busy="addLoading">
        <label v-for="song in candidates" :key="song.id" class="candidate-row" :class="{ added: added.has(song.id) }">
          <span class="check-target"><input type="checkbox" :checked="added.has(song.id) || addSelected.has(song.id)" :disabled="busy || addLoading || !!addError || added.has(song.id) || (addSelected.size >= 500 && !addSelected.has(song.id))" :aria-label="`添加 ${song.title}`" @change="select(song.id, ($event.target as HTMLInputElement).checked, true)"></span>
          <SongCover :song-id="song.id" :title="song.title" /><span class="song-copy"><strong>{{ song.title }}</strong><span class="song-artist">{{ artist(song) }}</span></span><span v-if="added.has(song.id)" class="added-label">已收藏</span>
        </label>
        <p v-if="!addLoading && !addError && !candidates.length" class="candidate-empty">{{ addQuery ? '没有匹配的歌曲' : '曲库暂无歌曲' }}</p>
      </div>
      <ElPagination v-if="candidateTotal > 20" :current-page="addPage" :total="candidateTotal" :page-size="20" layout="prev, pager, next" :disabled="busy || addLoading" @current-change="value => { addPage = value; loadCandidates() }" />
      <template #footer><span class="selection-count">已选 {{ addSelected.size }} / 500 首</span><ElButton :disabled="busy" @click="closeAdd()">取消</ElButton><ElButton type="primary" :loading="busy" :disabled="!addSelected.size || addLoading || !!addError" @click="save(true)">添加所选</ElButton></template>
    </ElDialog>
    <ElDialog :model-value="!!removing.length" :title="removing.length === 1 ? '取消这首收藏？' : `取消 ${removing.length} 首收藏？`" width="min(480px, calc(100vw - 32px))" :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy" :before-close="done => { if (!busy) { removing = []; done() } }">
      <p>此 NAS 的手机和电视也会取消这些收藏，歌曲文件和练唱记录会保留。</p><ul class="remove-preview"><li v-for="song in removing" :key="song.id">{{ song.title }}（{{ artist(song) }}）</li></ul>
      <ElAlert v-if="mutationError" :title="mutationError" type="error" :closable="false" />
      <template #footer><ElButton :disabled="busy" @click="removing = []">保留收藏</ElButton><ElButton type="danger" :loading="busy" @click="save(false)">确认取消</ElButton></template>
    </ElDialog>
    <ElDialog :model-value="!!detail" title="收藏歌曲详情" width="min(480px, calc(100vw - 32px))" @close="detail = null">
      <template v-if="detail"><div class="detail-song"><SongCover :song-id="detail.id" :title="detail.title" :fallback-only="!detail.available" /><div><h2>{{ detail.title }}</h2><p>{{ artist(detail) }}</p></div></div><dl><dt>专辑</dt><dd>{{ detail.album || '未知' }}</dd><dt>收藏时间</dt><dd>{{ date(detail.addedAt) }}</dd><dt>歌曲状态</dt><dd>{{ detail.available ? '曲库内歌曲' : '暂不可用，仍可取消收藏' }}</dd></dl></template>
      <template #footer><ElButton @click="detail = null">关闭</ElButton></template>
    </ElDialog>
  </section>
</template>
<style scoped>
.favorites-page { min-width:0; }
.favorites-page :deep(.el-button) { min-height:44px; }
.favorites-toolbar { display:flex; gap:12px; align-items:center; margin-bottom:12px; padding:16px 20px; flex-wrap:wrap; }
.favorites-toolbar .el-input { max-width:400px; flex:1; min-width:160px; }
.favorites-page :deep(.el-input__wrapper) { min-height:44px; box-sizing:border-box; }
select { height:44px; padding:0 12px; border:1px solid var(--sv-border-default); border-radius:7px; background:var(--sv-surface-2); color:var(--sv-text-secondary); font:inherit; min-width:144px; }
.desktop-refresh { margin-left:auto; }.mobile-refresh { display:none; }
.read-error { margin-bottom:16px; }.read-error p { margin:0; }.success-notice { color:var(--sv-semantic-ok); font-size:14px; }
.result-bar { min-height:52px; display:flex; align-items:center; gap:12px; color:var(--sv-text-secondary); font-size:14px; margin-bottom:4px; }
.result-bar strong { font-weight:550; }.result-bar.bulk { padding:4px 12px; border-radius:7px; background:var(--sv-accent-soft); color:var(--sv-accent-primary); }
.selection-scope { font-size:12px; font-weight:400; }.result-actions { display:flex; margin-left:auto; gap:8px; }.result-actions .el-button + .el-button { margin-left:0; }
.favorites-list { overflow:hidden; }
.favorites-skeleton { padding:24px; }
.list-head,.favorite-row { display:grid; grid-template-columns:44px minmax(260px,1.6fr) minmax(120px,1fr) 140px 100px; gap:8px; align-items:center; }
.list-head { height:46px; background:var(--sv-surface-1); color:var(--sv-text-tertiary); font-size:12px; border-bottom:1px solid var(--sv-border-subtle); }.head-song { padding-left:60px; }.head-action { text-align:center; }
.favorite-row { min-height:84px; border-bottom:1px solid var(--sv-border-subtle); }.favorite-row:last-child { border:0; }.favorite-row:hover { background:var(--sv-surface-0); }.favorite-row.selected { background:var(--sv-accent-soft); }
button:not(.el-button) { font:inherit; color:inherit; cursor:pointer; }button:not(.el-button):disabled { cursor:default; color:var(--sv-text-tertiary); }
.song-content { display:flex; align-items:center; gap:12px; padding:12px 0; min-height:72px; min-width:0; text-align:left; background:none; border:0; }
.song-copy { display:flex; flex-direction:column; gap:4px; min-width:0; }.song-title { display:flex; gap:8px; align-items:center; }.song-copy strong { font-size:16px; line-height:22px; font-weight:550; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.song-artist { font-size:14px; color:var(--sv-text-tertiary); line-height:20px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.unavailable { color:var(--sv-semantic-warn); background:var(--sv-semantic-warn-soft); padding:1px 6px; border-radius:4px; font-size:12px; white-space:nowrap; }
.album-cell { color:var(--sv-text-secondary); padding-right:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:14px; }.date-cell { color:var(--sv-text-tertiary); font-size:14px; }.row-remove { justify-self:center; min-width:44px; min-height:44px; background:none; border:0; border-radius:6px; color:var(--sv-text-secondary); }.row-remove:hover:enabled { background:var(--sv-semantic-danger-soft); color:var(--sv-semantic-danger); }.row-remove .el-icon,.mobile-meta { display:none; }
.check-target { display:flex; width:44px; height:44px; align-items:center; justify-content:center; cursor:pointer; flex-shrink:0; }.check-target input { width:18px; height:18px; margin:0; accent-color:var(--sv-accent-primary); cursor:inherit; }
.list-state { display:flex; min-height:340px; padding:48px 20px; flex-direction:column; align-items:center; justify-content:center; text-align:center; color:var(--sv-text-secondary); }.list-state>.el-icon { font-size:36px; color:var(--sv-text-tertiary); margin-bottom:16px; }.list-state h2 { font-size:18px; font-weight:550; margin:0 0 10px; }.list-state p { line-height:24px; margin:0 0 22px; }
.favorites-footer { display:flex; align-items:center; justify-content:space-between; gap:12px; padding-top:12px; font-size:12px; color:var(--sv-text-tertiary); }.add-search { display:flex; gap:12px; margin:16px 0; }.candidate-list { max-height:420px; overflow:auto; border-top:1px solid var(--sv-border-subtle); }.candidate-row { display:flex; gap:12px; align-items:center; min-height:80px; border-bottom:1px solid var(--sv-border-subtle); padding-right:8px; cursor:pointer; }.candidate-row.added { color:var(--sv-text-secondary); }.added-label { margin-left:auto; flex-shrink:0; color:var(--sv-text-tertiary); font-size:12px; }.candidate-empty { padding:40px 12px; text-align:center; color:var(--sv-text-secondary); }.selection-count { margin-right:auto; font-size:14px; color:var(--sv-text-secondary); }.favorites-page :deep(.el-dialog__footer) { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }.favorites-page :deep(.el-dialog__footer .el-button + .el-button) { margin:0; }.remove-preview { max-height:200px; overflow:auto; padding-left:20px; color:var(--sv-text-secondary); line-height:26px; }.detail-song { display:flex; align-items:center; gap:16px; }.detail-song h2 { margin:0; font-size:20px; overflow-wrap:anywhere; }.detail-song p { color:var(--sv-text-secondary); margin:6px 0 0; }dl { display:grid; grid-template-columns:80px minmax(0,1fr); gap:12px; margin-top:24px; }dt { color:var(--sv-text-tertiary); }dd { margin:0; overflow-wrap:anywhere; }
button:focus-visible,select:focus-visible,input:focus-visible { outline:3px solid var(--sv-accent-primary); outline-offset:3px; }
@media(max-width:1100px) { .list-head,.favorite-row { grid-template-columns:36px minmax(230px,1.5fr) minmax(100px,1fr) 105px 90px; }.favorites-toolbar { gap:8px; }select { min-width:120px; } }
@media(max-width:760px) {.favorites-toolbar { flex-wrap:wrap; }.favorites-toolbar .el-input { flex-basis:calc(100% - 76px); max-width:none; order:0; }.favorites-toolbar>.el-button:not(.desktop-refresh) { order:1; }.favorites-toolbar select { order:2; flex:1; min-width:0; font-size:16px; }.desktop-refresh { display:none; }.mobile-refresh { display:inline-flex; width:44px; padding:0; }.result-bar { font-size:14px; gap:8px; flex-wrap:wrap; padding:4px 0; }.result-bar.bulk { padding:8px; }.selection-scope { display:block; }.result-actions { gap:4px; }.result-actions .el-button { padding:0 10px; }.list-head { display:none; }.favorite-row { grid-template-columns:0 minmax(0,1fr) 44px; gap:0; padding:0 4px 0 12px; min-height:96px; }.favorite-row:has(.check-target) { grid-template-columns:36px minmax(0,1fr) 44px; padding-left:0; }.favorite-row .check-target { width:36px; }.song-content { gap:12px; min-width:0; }.song-copy strong { font-size:16px; }.song-title { flex-wrap:wrap; gap:4px; }.unavailable { font-size:12px; }.mobile-meta { display:block; color:var(--sv-text-tertiary); font-size:12px; line-height:18px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }.album-cell,.date-cell,.row-remove>span { display:none; }.row-remove .el-icon { display:inline-flex; font-size:18px; }.row-remove { width:44px; }.song-artist { font-size:14px; }.favorites-footer { flex-wrap:wrap; }.favorites-page :deep(.el-input__inner) { font-size:16px; }.candidate-row { gap:8px; }.candidate-row .check-target { width:32px; }.candidate-row .song-copy { flex:1; }.selection-count { width:100%; text-align:left; margin-bottom:8px; }.detail-song h2 { font-size:18px; } }

/* Second polish pass: full-size controls and readable mobile scope/dialog copy. */
.check-target input { appearance:none; width:44px; height:44px; position:relative; border:0; background:none; border-radius:5px; }
.check-target input::before { content:''; position:absolute; left:13px; top:13px; width:16px; height:16px; border:1px solid var(--sv-border-strong); border-radius:4px; background:var(--sv-surface-2); }
.check-target input:checked::before,.check-target input:indeterminate::before { background:var(--sv-accent-primary); border-color:var(--sv-accent-primary); }
.check-target input:checked::after { content:''; position:absolute; left:18px; top:15px; width:6px; height:10px; border:solid var(--sv-on-accent); border-width:0 2px 2px 0; transform:rotate(45deg); }
.check-target input:indeterminate::after { content:''; position:absolute; left:17px; top:21px; width:10px; height:2px; background:var(--sv-on-accent); }
.check-target input:disabled { opacity:.5; cursor:default; }
.favorites-page :deep(.el-dialog__headerbtn) { width:44px; height:44px; top:8px; right:8px; }
@media(max-width:760px) {
  .favorite-row:has(.check-target) { grid-template-columns:44px minmax(0,1fr) 44px; }
  .favorite-row .check-target,.candidate-row .check-target { width:44px; }
  .mobile-meta { display:flex; gap:10px; }
  .mobile-album { overflow:hidden; text-overflow:ellipsis; }
  .mobile-meta time { flex-shrink:0; }
  .favorites-page :deep(.el-dialog__body) { font-size:16px; line-height:26px; }
}
</style>
