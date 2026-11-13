<script setup lang="ts">
import { Headset as SongPlaceholderIcon } from '@element-plus/icons-vue'
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, reactive, ref, watch } from 'vue'
import { ElIcon, ElAlert, ElButton, ElDrawer, ElEmpty, ElInput, ElPagination, ElSkeleton, ElTag } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import AudioRolesPanel from '../../song-management/components/AudioRolesPanel.vue'
import { authRequest } from '../../../core/auth/api'
import { base, payload, query, type AudioRow, type Backend, type Batch, type Filter, type SeparationCapabilities, type SeparationProfile } from '../api'
import { failure, latestAnalysis, profileBackends, profileReady, rolesSummary, type Readiness } from '../presentation'
import BatchOptionsDialog from './BatchOptionsDialog.vue'

const props = defineProps<{ songId: string; readiness: Readiness; backends: Backend[]; separation?: SeparationCapabilities; recognitionReady?: boolean; fastReady?: boolean }>()
const emit = defineEmits<{ preview: [batch: Batch]; setup: []; showAll: [] }>()
const pageSize = ref(30)
const states = [
  { value: '', label: '全部' }, { value: 'UNRECOGNIZED', label: '识别未完成' }, { value: 'ELIGIBLE', label: '可生成伴奏' }, { value: 'UNCONFIRMED', label: '待标记原唱' }, { value: 'UNPROBED', label: '待识别' },
  { value: 'READY', label: '已有伴奏' }, { value: 'PROCESSING', label: '生成中' }, { value: 'FAILED', label: '生成失败' }, { value: 'INAPPLICABLE', label: '多音轨/无音轨' },
]
const filter = reactive<Filter>({ title: '', artist: '', sourceId: '', streams: '', state: '', songId: props.songId })
const applied = ref<Filter>({ ...filter })
const rows = ref<AudioRow[]>([]), total = ref(0), page = ref(0), loaded = ref(false), loading = ref(false), busy = ref(false)
const selected = reactive(new Set<string>()), all = ref(false), preferred = ref('')
const sources = ref<{ id: string; name: string }[]>([]), error = ref(''), sourcesError = ref('')
const editor = ref<AudioRow>(), opened = ref('')
const moreFilters = ref<HTMLDetailsElement>()
const basicStates = states.filter(item => ['', 'UNRECOGNIZED', 'ELIGIBLE', 'READY'].includes(item.value))
const advancedStates = states.filter(item => !basicStates.includes(item))
const advancedLabel = computed(() => advancedStates.find(item => item.value === applied.value.state)?.label)
const options = ref<'recognize' | 'generate'>(), optionsError = ref(''), optionsCount = ref(0)
const target = ref<{ ids: string[]; all: boolean; filter: ReturnType<typeof payload> }>()
let optionsGeneration = 0
let active = true, visible = true, sequence = 0
let retryTimer: ReturnType<typeof setTimeout> | undefined
const indexPreparing = ref(false), indexBuilding = ref(false)
const profile = ref<SeparationProfile>('LEGACY_DEMUCS')
const recognitionKind = ref<'FAST' | 'ANALYZE'>('FAST')
const canRecognize = computed(() => recognitionKind.value === 'ANALYZE' ? props.readiness.ready : (props.recognitionReady ?? props.readiness.connected))
let profileInitialized = false
watch(() => props.separation, value => { if (value && !profileInitialized) { profile.value = 'DSP_FAST'; profileInitialized = true } }, { immediate: true })
const available = computed(() => profileBackends(props.separation, profile.value, props.backends))
const ready = computed(() => profileReady(props.separation, profile.value, props.readiness.ready))
watch(available, items => { if (!items.some(item => item.id === preferred.value)) preferred.value = '' })
const coverErrors = reactive(new Set<string>())
function latest(row: AudioRow) { return row.audio.jobs.find(job => job.kind === 'SEPARATE') }
function stateHint(row: AudioRow) {
  return latest(row)?.error || latestAnalysis(row.audio)?.error || rolesSummary(row.audio).hint
}
function streamInfo(row: AudioRow) {
  const streams = row.audio.streams || []
  return [...new Set(streams.map(stream => [stream.codec?.toUpperCase(), stream.channels === 2 ? '立体声' : stream.channels === 1 ? '单声道' : stream.channels ? `${stream.channels} 声道` : ''].filter(Boolean).join(' · ')).filter(Boolean))].join(' / ')
}
function extension(row: AudioRow) { return row.relativePath?.split('.').pop()?.toUpperCase() || '媒体文件' }
function resize(size: number) { pageSize.value = size; page.value = 0; void loadRows() }
const selectedCount = computed(() => all.value ? total.value : selected.size)
const pageChecked = computed(() => all.value || (!!rows.value.length && rows.value.every(row => selected.has(row.id))))
const pageMixed = computed(() => !pageChecked.value && rows.value.some(row => selected.has(row.id)))
const filtered = computed(() => Object.entries(applied.value).some(([key, value]) => key !== 'songId' && value !== ''))
const singleTitle = computed(() => rows.value.find(row => row.id === applied.value.songId)?.title || '')

function tracks(row: AudioRow) {
  const streams = row.audio.streams
  if (!streams) return '音轨待识别'
  if (!streams.length) return '没有音轨'
  return `${streams.length} 条音轨`
}
function actionLabel(row: AudioRow) {
  if (!row.audio.streams) return '读取音轨'
  if (row.category === 'READY') return '试听伴奏'
  if (row.audio.streams.length === 2) return row.audio.state === 'CONFIRMED' ? '查看标记' : '标记原唱'
  if (row.audio.streams.length > 2) return '逐轨试听'
  if (latest(row)?.state === 'FAILED') return '重新生成'
  if (['QUEUED', 'RUNNING'].includes(latest(row)?.state || '')) return '查看进度'
  if (row.audio.streams.length === 1) return '生成伴奏'
  return '查看详情'
}
async function loadRows() {
  clearTimeout(retryTimer)
  const turn = ++sequence; loading.value = true
  try {
    const value = await authRequest<{ items: AudioRow[]; totalElements: number; building?: boolean }>(`${base}/songs?${query(applied.value, page.value, pageSize.value)}`, 'GET', undefined, 60000)
    if (active && turn === sequence) { indexPreparing.value = false; indexBuilding.value = !!value.building; total.value = value.totalElements; const last = Math.max(0, Math.ceil(total.value / pageSize.value) - 1); if (page.value > last) { page.value = last; void loadRows(); return } rows.value = value.items; loaded.value = true; error.value = '' }
  } catch (failed) {
    if (active && turn === sequence) {
      indexPreparing.value = typeof failed === 'object' && failed !== null && 'status' in failed && failed.status === 503
      error.value = indexPreparing.value ? '' : failure(failed, '读取歌曲失败')
      if (indexPreparing.value && visible) retryTimer = setTimeout(() => { void loadRows() }, 1000)
    }
  }
  finally { if (active && turn === sequence) loading.value = false }
}
function search() { applied.value = { ...filter }; page.value = 0; clear(); if (moreFilters.value) moreFilters.value.open = false; void loadRows() }
function reset() { Object.assign(filter, { title: '', artist: '', sourceId: '', streams: '', state: '' }); search() }
function go(next: number) { page.value = next; void loadRows() }
function check(id: string, checked: boolean) { all.value = false; checked ? selected.add(id) : selected.delete(id) }
function pageSelect(checked: boolean) { all.value = false; for (const row of rows.value) checked ? selected.add(row.id) : selected.delete(row.id) }
function clear() { all.value = false; selected.clear() }
function configure(mode: 'recognize' | 'generate') {
  if (busy.value || !selectedCount.value) return
  optionsGeneration++; optionsError.value = ''; optionsCount.value = selectedCount.value
  target.value = { ids: [...selected], all: all.value, filter: payload(applied.value) }
  options.value = mode
}
function closeOptions() {
  if (busy.value) return
  optionsGeneration++; options.value = undefined; target.value = undefined; optionsError.value = ''
}
async function prepare() {
  if (busy.value || !options.value || !target.value || !(options.value === 'recognize' ? canRecognize.value : ready.value)) return
  const turn = ++optionsGeneration, recognizing = options.value === 'recognize'
  busy.value = true; optionsError.value = ''
  try {
    const value = await authRequest<Batch>(`${base}/batches/preview`, 'POST', {
      ...target.value,
      ...(recognizing ? { kind: recognitionKind.value } : { backend: preferred.value, ...(props.separation ? { separationProfile: profile.value, outputFormat: 'aac' } : {}) }),
    }, 120000)
    if (active && visible && turn === optionsGeneration) { options.value = undefined; target.value = undefined; emit('preview', value) }
  } catch (failed) { if (active && turn === optionsGeneration) optionsError.value = failure(failed, '无法准备处理范围，请重试') }
  finally { if (active && turn === optionsGeneration) busy.value = false }
}
async function loadSources() {
  sourcesError.value = ''
  try {
    const found: { id: string; name: string }[] = []
    for (let next = 0; active; next++) {
      const value = await authRequest<{ items: { id: string; name: string }[]; totalElements?: number }>(`/api/v1/media-sources?size=100&page=${next}`)
      found.push(...value.items)
      if (value.items.length < 100 || (value.totalElements !== undefined && found.length >= value.totalElements)) break
    }
    if (active) sources.value = found
  } catch (failed) { if (active) sourcesError.value = failure(failed, '媒体库读取失败') }
}
watch(() => props.songId, value => { filter.songId = value; opened.value = ''; search() })
// 从歌曲详情跳转过来时，直接打开这首歌的音轨面板。
watch(rows, value => {
  const target = applied.value.songId
  if (target && opened.value !== target) { const row = value.find(item => item.id === target); if (row) { opened.value = target; editor.value = row } }
})
onMounted(() => { void loadSources(); void loadRows() })
// KeepAlive 首次挂载也会触发 activated；只在切回页签时刷新。
let activations = 0
onActivated(() => { visible = true; if (activations++) void loadRows() })
onDeactivated(() => { visible = false; clearTimeout(retryTimer); editor.value = undefined; optionsGeneration++; options.value = undefined; target.value = undefined; busy.value = false })
onBeforeUnmount(() => { active = false; sequence++; optionsGeneration++; clearTimeout(retryTimer) })
defineExpose({ refresh: loadRows, clear })
</script>

<template>
  <div class="songs-tab" :class="{ 'has-selection': selectedCount }">
    <div v-if="applied.songId" class="single-banner" role="status">
      <span>正在查看单首歌曲{{ singleTitle ? `：${singleTitle}` : '' }}</span>
      <ElButton link type="primary" @click="emit('showAll')">查看全部歌曲</ElButton>
    </div>
    <section v-else class="filter-panel" aria-label="筛选歌曲">
      <form class="filters" role="search" @submit.prevent="search">
        <ElInput v-model="filter.title" placeholder="搜索歌曲名称" aria-label="歌曲名称" :prefix-icon="Search" clearable maxlength="200" @clear="search" />
        <select v-model="filter.sourceId" class="native-select" aria-label="媒体库" @change="search"><option value="">全部媒体库</option><option v-for="source in sources" :key="source.id" :value="source.id">{{ source.name }}</option></select>
        <select v-model="filter.streams" class="native-select" aria-label="音轨数量" @change="search"><option value="">任意音轨数</option><option value="1">1 条音轨</option><option value="2">2 条音轨</option><option value="0">没有音轨</option></select>
        <details ref="moreFilters" class="more-filters"><summary>更多筛选<span v-if="applied.artist || advancedLabel" class="filter-dot" aria-label="已应用更多筛选" /></summary><div class="more-filter-content">
          <label class="field-label">歌手<ElInput v-model="filter.artist" placeholder="搜索歌手" aria-label="歌手" clearable maxlength="200" /></label>
          <label class="field-label">处理状态<select v-model="filter.state" class="native-select" aria-label="更多处理状态"><option v-for="item in states" :key="item.value" :value="item.value">{{ item.label }}</option></select></label>
          <ElButton native-type="submit" type="primary">应用筛选</ElButton>
        </div></details>
        <ElButton native-type="submit" :loading="loading">搜索</ElButton>
      </form>
      <div class="filter-bottom">
        <fieldset class="state-chips"><legend class="sr-only">按状态查看</legend>
          <label v-for="item in basicStates" :key="item.value" class="chip" :class="{ 'is-active': filter.state === item.value }"><input v-model="filter.state" type="radio" name="audio-state" :value="item.value" @change="search">{{ item.label }}</label>
        </fieldset>
        <span v-if="advancedLabel" class="applied-state">{{ advancedLabel }}</span>
        <ElButton v-if="filtered" link type="primary" class="reset" @click="reset">清除筛选</ElButton>
      </div>
      <p v-if="sourcesError" class="inline-error">{{ sourcesError }} <ElButton link @click="loadSources">重试</ElButton></p>
    </section>

    <div class="selection-summary" role="region" aria-label="选择批量处理的歌曲">
      <label class="page-check"><input type="checkbox" aria-label="选择本页歌曲" :checked="pageChecked" :indeterminate.prop="pageMixed" :disabled="!rows.length" @change="pageSelect(($event.target as HTMLInputElement).checked)"><span>共 {{ total }} 首</span></label>
      <span v-if="all" class="muted">已选择全部筛选结果</span>
      <ElButton v-else-if="total > rows.length && total > 0" link type="primary" :disabled="loading" @click="all = true; selected.clear()">选择全部 {{ total }} 首</ElButton>
      <span class="selection-help">选中歌曲后可批量识别或生成伴奏</span>
    </div>
    <p v-if="indexPreparing" class="index-status" role="status">正在准备歌曲列表，稍后自动重试…</p>
    <p v-else-if="indexBuilding" class="index-status" role="status">正在更新歌曲状态…</p>
    <ElAlert v-if="error" :title="error" type="error" show-icon :closable="false" class="list-error"><ElButton link @click="loadRows">重试</ElButton></ElAlert>
    <ElSkeleton v-if="loading && !loaded" :rows="5" animated aria-label="正在读取歌曲" />
    <ElEmpty v-else-if="loaded && !rows.length" :description="filtered ? '没有符合条件的歌曲' : '曲库里还没有歌曲'"><p class="empty-hint">{{ filtered ? '试试其他状态，或清除筛选查看全部歌曲。' : '添加媒体库并扫描后，可在这里检查原唱与伴奏。' }}</p><ElButton v-if="filtered" @click="reset">清除筛选</ElButton></ElEmpty>
    <div v-else class="song-list-wrap"><table class="song-list" :aria-busy="loading" aria-label="歌曲"><thead><tr class="song-table-header"><th scope="col"><span class="sr-only">选择</span></th><th scope="col">歌曲 / 歌手</th><th scope="col">媒体来源</th><th scope="col">已有音轨</th><th scope="col">当前状态</th><th scope="col" class="action-heading">操作</th></tr></thead><tbody>
      <tr v-for="row in rows" :key="row.id" class="song-row" :class="{ 'is-selected': all || selected.has(row.id) }">
        <td class="select-cell"><label class="row-selection"><input type="checkbox" class="row-check" :aria-label="'选择' + row.title" :checked="all || selected.has(row.id)" :disabled="all" @change="check(row.id, ($event.target as HTMLInputElement).checked)"></label></td>
        <td class="song-main"><div class="song-identity"><span class="row-cover"><img v-if="row.coverAvailable && !coverErrors.has(row.id)" :src="`/api/v1/metadata/songs/${encodeURIComponent(row.id)}/cover`" :alt="row.title + '封面'" loading="lazy" @error="coverErrors.add(row.id)"><ElIcon v-else :size="20" role="img" aria-label="暂无歌曲封面"><SongPlaceholderIcon /></ElIcon></span><div class="song-copy"><button type="button" class="song-title" @click="editor = row">{{ row.title }}</button><p>{{ row.artists?.join(' / ') || '未知歌手' }}</p></div></div></td>
        <td class="song-location"><span>{{ row.sourceName || '未指定媒体库' }}</span><p :title="row.relativePath">{{ extension(row) }}</p></td>
        <td class="song-tracks"><span>{{ tracks(row) }}</span><p>{{ streamInfo(row) || '检查原文件中的音轨' }}</p></td>
        <td class="song-state"><ElTag :type="rolesSummary(row.audio).tone" effect="light" size="small">{{ rolesSummary(row.audio).tag }}</ElTag><p v-if="stateHint(row)" :class="{ 'task-error': latest(row)?.state === 'FAILED' }" :title="stateHint(row)">{{ stateHint(row) }}</p></td>
        <td class="song-actions"><ElButton link type="primary" @click="editor = row">{{ actionLabel(row) }}</ElButton></td>
      </tr>
    </tbody></table></div>
    <div v-if="total" class="pagination"><ElPagination :current-page="page + 1" :page-size="pageSize" :page-sizes="[20, 30, 50, 100]" :total="total" layout="total, sizes, prev, pager, next" :pager-count="5" prev-text="上一页" next-text="下一页" @size-change="resize" @current-change="go($event - 1)" /></div>

    <div v-if="selectedCount" class="selection-bar" role="region" aria-label="批量处理所选歌曲">
      <strong>已选 {{ selectedCount }} 首</strong><ElButton link :disabled="busy" @click="clear">取消选择</ElButton><span class="bar-spacer" />
      <ElButton :disabled="busy || loading" @click="configure('recognize')">识别已有音轨</ElButton><ElButton type="primary" :disabled="busy || loading" @click="configure('generate')">生成伴奏</ElButton>
    </div>
    <BatchOptionsDialog v-model:profile="profile" v-model:backend="preferred" v-model:recognition-kind="recognitionKind" :mode="options" :count="optionsCount" :busy="busy" :error="optionsError" :backends="available" :separation="separation" :readiness="readiness" :ready="ready" :recognition-ready="canRecognize" :fast-ready="fastReady" @confirm="prepare" @close="closeOptions" @setup="closeOptions(); emit('setup')" />
    <ElDrawer :model-value="!!editor" :title="editor?.title || '音轨详情'" size="min(600px, 100vw)" :append-to-body="true" class="audio-song-drawer" @close="editor = undefined">
      <template v-if="editor"><div class="drawer-song-meta"><span>{{ editor.artists?.join(' / ') || '未知歌手' }}</span><span>{{ editor.sourceName || '未指定媒体库' }} · {{ extension(editor) }}</span></div><AudioRolesPanel :key="editor.id" :song-id="editor.id" :can-process="readiness.ready" :separation="separation" :backends="backends" workbench @changed="loadRows" @setup="editor = undefined; emit('setup')" /></template>
    </ElDrawer>
  </div>
</template>

<style scoped>
.songs-tab{position:relative;display:grid;gap:0;min-width:0}.single-banner{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;margin:20px;padding:12px 16px;border-radius:8px;background:var(--sv-accent-soft);font-size:14px}.filter-panel{display:grid;gap:16px;padding:20px 24px 16px}.filters{display:grid;grid-template-columns:minmax(200px,1fr) minmax(140px,180px) minmax(130px,160px) auto auto;gap:10px;align-items:start}.filters :deep(.el-input__wrapper){min-height:40px}.filters :deep(.el-button){height:40px;margin:0}.native-select{width:100%;min-height:40px;padding:8px 12px;border:1px solid var(--sv-border-default);border-radius:8px;background:var(--sv-surface-2);color:var(--sv-text-primary);font:inherit;font-size:14px;min-width:0}.more-filters{position:relative}.more-filters summary{display:flex;align-items:center;justify-content:center;gap:6px;min-height:40px;padding:0 12px;list-style:none;border:1px solid var(--sv-border-default);border-radius:8px;color:var(--sv-text-secondary);font-size:14px;cursor:pointer;white-space:nowrap}.more-filters summary::-webkit-details-marker{display:none}.more-filters[open] summary{color:var(--sv-accent-primary);border-color:var(--sv-accent-primary)}.more-filter-content{position:absolute;z-index:10;top:48px;right:0;width:280px;padding:20px;border:1px solid var(--sv-border-default);border-radius:12px;background:var(--sv-surface-2);box-shadow:var(--sv-shadow-md);display:grid;gap:16px}.field-label{display:grid;gap:8px;font-size:14px;color:var(--sv-text-secondary)}.filter-dot{width:6px;height:6px;border-radius:50%;background:var(--sv-accent-primary)}.filter-bottom{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px}.state-chips{display:flex;flex-wrap:wrap;gap:8px;margin:0;padding:0;border:0;min-width:0}.chip{position:relative;display:inline-flex;align-items:center;min-height:32px;padding:0 12px;border:1px solid transparent;border-radius:6px;font-size:14px;color:var(--sv-text-secondary);cursor:pointer}.chip input{position:absolute;opacity:0;inset:0;width:100%;height:100%;margin:0;cursor:pointer}.chip:hover{background:var(--sv-surface-3)}.chip.is-active{background:var(--sv-accent-soft);color:var(--sv-accent-primary);font-weight:600}.chip:focus-within,.more-filters summary:focus-visible{outline:2px solid var(--sv-accent-primary);outline-offset:2px}.applied-state{padding:4px 8px;border-radius:4px;background:var(--sv-surface-3);font-size:13px;color:var(--sv-text-secondary)}.reset{margin-left:auto}.selection-summary{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;min-height:50px;padding:4px 24px;border-top:1px solid var(--sv-border-subtle)}.page-check{display:inline-flex;gap:12px;align-items:center;font-size:13px;color:var(--sv-text-secondary);min-height:40px;cursor:pointer}.page-check input,.row-check{width:16px;height:16px;margin:0;accent-color:var(--sv-accent-primary)}.selection-help{margin-left:auto;color:var(--sv-text-tertiary);font-size:12px}.song-list{width:100%;table-layout:fixed;border-collapse:collapse}.song-table-header{background:var(--sv-surface-1)}.song-table-header th{text-align:left;padding:12px 12px;font-size:12px;font-weight:500;color:var(--sv-text-secondary);border-block:1px solid var(--sv-border-subtle)}.song-table-header th:first-child{width:56px;padding-left:24px}.song-table-header th:nth-child(2){width:30%}.song-table-header th:nth-child(3){width:15%}.song-table-header th:nth-child(4){width:15%}.song-table-header th:last-child{width:108px;padding-right:24px;text-align:right}.song-row td{padding:14px 12px;border-bottom:1px solid var(--sv-border-subtle);vertical-align:middle}.song-row:last-child td{border-bottom:0}.song-row:hover{background:var(--sv-surface-1)}.song-row.is-selected{background:var(--sv-accent-soft)}.song-row .select-cell{padding-left:16px;padding-right:4px}.row-selection{display:grid;place-items:center;width:32px;height:40px;cursor:pointer}.row-selection:focus-within{outline:2px solid var(--sv-accent-primary);border-radius:4px}.song-main{min-width:0}.song-identity{display:flex;gap:12px;align-items:center;min-height:52px}.song-copy{min-width:0}.row-cover{display:grid;place-items:center;width:44px;height:44px;flex-shrink:0;border:1px solid var(--sv-border-subtle);border-radius:6px;background:var(--sv-surface-3);color:var(--sv-text-tertiary);overflow:hidden}.row-cover img{width:100%;height:100%;object-fit:cover}.song-title{display:block;max-width:100%;padding:0;border:0;background:none;color:var(--sv-text-primary);font:inherit;font-size:14px;font-weight:600;text-align:left;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.5}.song-title:hover{color:var(--sv-accent-primary);text-decoration:underline}.song-main p,.song-location p,.song-tracks p,.song-state p{margin:4px 0 0;font-size:12px;color:var(--sv-text-secondary);line-height:1.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.song-location,.song-tracks{font-size:13px;color:var(--sv-text-secondary)}.song-location>span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.song-state{min-width:0}.song-state :deep(.el-tag){border:0;font-weight:500}.song-state p.task-error{color:var(--sv-semantic-danger)}.song-row .song-actions{text-align:right;padding-right:24px}.song-actions :deep(.el-button){min-height:36px;margin:0;font-size:13px}.pagination{display:flex;justify-content:flex-end;padding:16px 24px;border-top:1px solid var(--sv-border-subtle);overflow-x:auto}.selection-bar{position:sticky;bottom:16px;z-index:15;display:flex;gap:12px;align-items:center;justify-self:center;width:calc(100% - 48px);margin:12px 0 16px;padding:12px 16px;border:1px solid var(--sv-border-default);border-radius:10px;background:var(--sv-surface-2);box-shadow:var(--sv-shadow-md)}.selection-bar strong{font-size:14px;color:var(--sv-text-primary)}.selection-bar :deep(.el-button){margin:0;min-height:40px}.bar-spacer{flex:1}.muted,.index-status,.empty-hint{font-size:13px;color:var(--sv-text-secondary)}.index-status{margin:12px 24px}.inline-error{margin:0;font-size:13px;color:var(--sv-semantic-danger);overflow-wrap:anywhere}.list-error{margin:16px 24px;width:auto}.songs-tab :deep(.el-skeleton){padding:24px}.empty-hint{margin:0 0 16px}.drawer-song-meta{display:flex;flex-wrap:wrap;gap:6px 16px;margin:-4px 0 24px;padding-bottom:20px;border-bottom:1px solid var(--sv-border-subtle);color:var(--sv-text-secondary);font-size:13px}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(max-width:1100px){.filters{grid-template-columns:minmax(180px,1fr) minmax(120px,150px) minmax(120px,150px) auto auto}.filter-panel{padding:20px 16px 16px}.selection-summary{padding-inline:16px}.song-table-header th:nth-child(2){width:30%}.song-table-header th:nth-child(3){width:13%}.song-table-header th:nth-child(4){width:15%}.song-state p{max-width:170px}}
@media(max-width:768px){.filter-panel{padding:16px;gap:12px}.filters{grid-template-columns:1fr 1fr;gap:8px}.filters>:first-child{grid-column:1/-1}.filters :deep(.el-input__wrapper),.filters :deep(.el-input__inner),.filters :deep(.el-button),.native-select,.more-filters summary{min-height:44px}.filters>:last-child{grid-column:2;grid-row:3}.more-filters{grid-column:1;grid-row:3}.more-filter-content{left:0;right:auto;width:min(290px,calc(100vw - 64px));top:50px}.state-chips{display:grid;grid-template-columns:1fr 1fr;width:100%;gap:4px}.chip{justify-content:center;min-height:44px;font-size:14px}.filter-bottom{gap:4px}.selection-summary{padding:4px 12px;gap:4px 8px}.page-check{min-height:44px;font-size:14px}.selection-help{display:none}.song-table-header{display:none}.song-list,.song-list tbody{display:block}.song-row{display:grid;grid-template-columns:40px minmax(0,1fr);column-gap:4px;row-gap:0;padding:12px;border-top:1px solid var(--sv-border-subtle)}.song-row td{padding:0;border:0;min-width:0}.song-row .select-cell{grid-column:1;grid-row:1/3;padding:0}.row-selection{width:40px;height:44px}.song-row .song-main{grid-column:2}.song-identity{min-height:48px;gap:10px}.row-cover{width:44px;height:44px}.song-title{font-size:16px;min-height:24px;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.5}.song-main p{font-size:14px;margin-top:2px}.song-row .song-location{grid-column:2;display:flex;gap:8px;margin:6px 0;font-size:12px}.song-location>span{max-width:calc(100% - 42px)}.song-location p{margin:0;font-size:12px}.song-row .song-tracks{grid-column:2;font-size:14px;margin:4px 0}.song-tracks p{display:inline;margin-left:8px;font-size:12px}.song-row .song-state{grid-column:2;margin:8px 0 0}.song-state p{max-width:100%;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:13px}.song-row .song-actions{grid-column:2;text-align:right;padding:0;margin-top:2px}.song-actions :deep(.el-button){min-height:44px;font-size:14px}.pagination{padding:12px;justify-content:center}.pagination :deep(.el-pagination__total),.pagination :deep(.el-pagination__sizes){display:none}.pagination :deep(.el-pager li){min-width:30px}.selection-bar{bottom:8px;width:calc(100% - 16px);display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:12px;margin-bottom:8px}.selection-bar strong{align-self:center}.selection-bar>.el-button--text,.selection-bar>.is-link{justify-self:end}.bar-spacer{display:none}.selection-bar :deep(.el-button){min-height:44px;font-size:14px}.drawer-song-meta{font-size:14px}.empty-hint{padding-inline:16px;font-size:16px}}
</style>
