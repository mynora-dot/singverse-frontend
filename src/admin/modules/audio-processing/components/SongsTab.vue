<script setup lang="ts">
import { Headset as SongPlaceholderIcon } from '@element-plus/icons-vue'
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, reactive, ref, watch } from 'vue'
import { ElIcon, ElAlert, ElButton, ElDialog, ElEmpty, ElInput, ElPagination, ElSkeleton, ElTag } from 'element-plus'
import { Search, Operation } from '@element-plus/icons-vue'
import AudioRolesPanel from '../../song-management/components/AudioRolesPanel.vue'
import { authRequest } from '../../../core/auth/api'
import { base, payload, query, type AudioRow, type Backend, type Batch, type Filter, type SeparationCapabilities, type SeparationProfile } from '../api'
import { audioIssue, executionStage, failure, latestAnalysis, latestJob, profileBackends, profileReady, rolesSummary, type Readiness } from '../presentation'
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
  const audio = row.audio, streams = audio.streams, job = latest(row)
  if (job && ['QUEUED', 'RUNNING'].includes(job.state)) return job.state === 'QUEUED' ? '已加入生成队列' : executionStage(job) || '正在生成，完成后可试听'
  const reading = [latestAnalysis(audio), latestJob(audio, 'PROBE')].find(item => item && ['QUEUED', 'RUNNING'].includes(item.state))
  if (reading) return reading.state === 'QUEUED' ? '等待识别音轨' : '正在识别音轨'
  const issue = audioIssue(audio)
  if (issue) return issue.text
  if (audio.backingResource) return '已生成，可在点歌时切换'
  if (audio.originalSelection?.kind === 'UNIQUE_AUDIO') return '唯一音频作为原唱，按需生成伴奏'
  if (!streams) return '读取后确认原唱与伴奏'
  if (!streams.length) return '原文件没有可用的音频'
  if (streams.length === 1) return '只有原唱，可按需要生成'
  if (streams.length > 2) return '需逐轨试听确认源伴奏'
  return audio.state === 'CONFIRMED' ? '已确认原唱与伴奏' : '试听后选择带人声的音轨'
}
function streamInfo(row: AudioRow) {
  const streams = row.audio.streams || []
  return [...new Set(streams.map(stream => [stream.codec?.toUpperCase(), stream.channels === 2 ? '立体声' : stream.channels === 1 ? '单声道' : stream.channels ? `${stream.channels} 声道` : ''].filter(Boolean).join(' ')).filter(Boolean))].join(' / ')
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
  if (!streams) return row.audio.originalSelection?.kind === 'UNIQUE_AUDIO' ? '唯一原唱音频' : '音轨待识别'
  if (!streams.length) return '没有音轨'
  return `${streams.length} 条音轨`
}
function actionLabel(row: AudioRow) {
  const unique = row.audio.state === 'CONFIRMED' && row.audio.originalSelection?.kind === 'UNIQUE_AUDIO'
  if (!row.audio.streams && !unique) return '读取音轨'
  if (row.category === 'READY') return '试听伴奏'
  if (row.audio.streams?.length === 2) return row.audio.state === 'CONFIRMED' ? '查看标记' : '标记原唱'
  if ((row.audio.streams?.length || 0) > 2) return '逐轨试听'
  if (latest(row)?.state === 'FAILED') return '重新生成'
  if (['QUEUED', 'RUNNING'].includes(latest(row)?.state || '')) return '查看进度'
  if (row.audio.streams?.length === 1 || unique) return '生成伴奏'
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
function closeFilters(restoreFocus = false) {
  const panel = moreFilters.value
  if (!panel?.open) return
  filter.artist = applied.value.artist; filter.state = applied.value.state
  panel.open = false
  if (restoreFocus) panel.querySelector('summary')?.focus()
}
function outsideFilters(event: PointerEvent) {
  if (event.target instanceof Node && !moreFilters.value?.contains(event.target)) closeFilters()
}
function search() { applied.value = { ...filter }; page.value = 0; clear(); closeFilters(!!moreFilters.value?.contains(document.activeElement)); void loadRows() }
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
  } catch (failed) { if (active) sourcesError.value = failure(failed, '歌曲来源读取失败') }
}
watch(() => props.songId, value => { filter.songId = value; opened.value = ''; search() })
// 从歌曲详情跳转过来时，直接打开这首歌的音轨面板。
watch(rows, value => {
  const target = applied.value.songId
  if (target && opened.value !== target) { const row = value.find(item => item.id === target); if (row) { opened.value = target; editor.value = row } }
})
onMounted(() => { void loadSources(); void loadRows(); document.addEventListener('pointerdown', outsideFilters) })
// KeepAlive 首次挂载也会触发 activated；只在切回页签时刷新。
let activations = 0
onActivated(() => { visible = true; if (activations++) void loadRows() })
onDeactivated(() => { visible = false; clearTimeout(retryTimer); closeFilters(); editor.value = undefined; optionsGeneration++; options.value = undefined; target.value = undefined; busy.value = false })
onBeforeUnmount(() => { active = false; sequence++; optionsGeneration++; clearTimeout(retryTimer); document.removeEventListener('pointerdown', outsideFilters) })
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
        <div class="title-search"><ElInput v-model="filter.title" placeholder="搜索歌曲名称" aria-label="歌曲名称" :prefix-icon="Search" clearable maxlength="200" @clear="search" /><ElButton class="mobile-search" native-type="submit" :icon="Search" aria-label="搜索" :loading="loading" /></div>
        <select v-model="filter.sourceId" class="native-select" aria-label="歌曲来源" @change="search"><option value="">全部歌曲来源</option><option v-for="source in sources" :key="source.id" :value="source.id">{{ source.name }}</option></select>
        <select v-model="filter.streams" class="native-select" aria-label="音轨数量" @change="search"><option value="">任意音轨数</option><option value="1">1 条音轨</option><option value="2">2 条音轨</option><option value="0">没有音轨</option></select>
        <details ref="moreFilters" class="more-filters" @keydown.esc.stop.prevent="closeFilters(true)"><summary aria-label="更多筛选"><ElIcon class="more-filter-icon"><Operation /></ElIcon><span class="more-label">更多筛选</span><span v-if="applied.artist || advancedLabel" class="filter-dot" aria-label="已应用更多筛选" /></summary><div class="more-filter-content">
          <label class="field-label">歌手<ElInput v-model="filter.artist" placeholder="搜索歌手" aria-label="歌手" clearable maxlength="200" /></label>
          <label class="field-label">处理状态<select v-model="filter.state" class="native-select" aria-label="更多处理状态"><option v-for="item in states" :key="item.value" :value="item.value">{{ item.label }}</option></select></label>
          <ElButton native-type="submit" type="primary">应用筛选</ElButton>
        </div></details>
        <ElButton class="desktop-search" native-type="submit" :loading="loading">搜索</ElButton>
      </form>
      <div class="filter-bottom">
        <fieldset class="state-chips"><legend class="sr-only">按状态查看</legend>
          <label v-for="item in basicStates" :key="item.value" class="chip" :class="{ 'is-active': filter.state === item.value }"><input v-model="filter.state" type="radio" name="audio-state" :value="item.value" @change="search">{{ item.label }}</label>
        </fieldset>
        <span v-if="advancedLabel" class="applied-state">{{ advancedLabel }}</span>
        <ElButton v-if="filtered" link type="primary" class="reset" @click="reset">清除筛选</ElButton>
        <span class="result-count">本次结果 {{ total }} 首<ElButton v-if="!all && total > rows.length" link type="primary" :disabled="loading" @click="all = true; selected.clear()">选择全部 {{ total }} 首</ElButton><span v-if="all"> · 已选择全部筛选结果</span></span>
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
    <ElEmpty v-else-if="loaded && !rows.length" :description="filtered ? '没有符合条件的歌曲' : '曲库里还没有歌曲'"><ElButton v-if="filtered" @click="reset">清除筛选</ElButton></ElEmpty>
    <div v-else class="song-list-wrap"><table class="song-list" :aria-busy="loading" aria-label="歌曲"><thead><tr class="song-table-header"><th scope="col"><label class="row-selection"><input type="checkbox" aria-label="选择本页歌曲" :checked="pageChecked" :indeterminate.prop="pageMixed" :disabled="!rows.length" @change="pageSelect(($event.target as HTMLInputElement).checked)"></label></th><th scope="col">歌曲 / 歌手</th><th scope="col">媒体来源</th><th scope="col">已有音轨</th><th scope="col">当前状态</th><th scope="col" class="action-heading">操作</th></tr></thead><tbody>
      <tr v-for="row in rows" :key="row.id" class="song-row" :class="{ 'is-selected': all || selected.has(row.id) }">
        <td class="select-cell"><label class="row-selection"><input type="checkbox" class="row-check" :aria-label="'选择' + row.title" :checked="all || selected.has(row.id)" :disabled="all" @change="check(row.id, ($event.target as HTMLInputElement).checked)"></label></td>
        <td class="song-main"><div class="song-identity"><span class="row-cover"><img v-if="row.coverAvailable && !coverErrors.has(row.id)" :src="`/api/v1/metadata/songs/${encodeURIComponent(row.id)}/cover`" :alt="row.title + '封面'" loading="lazy" @error="coverErrors.add(row.id)"><ElIcon v-else :size="20" role="img" aria-label="暂无歌曲封面"><SongPlaceholderIcon /></ElIcon></span><div class="song-copy"><button type="button" class="song-title" @click="editor = row"><strong>{{ row.title }}</strong><span class="song-artist">{{ row.artists?.join(' / ') || '未知歌手' }}<span class="mobile-source"> · {{ row.sourceName }}</span></span></button></div></div></td>
        <td class="song-location"><span>{{ row.sourceName || '未指定歌曲来源' }}</span><p :title="row.relativePath">{{ extension(row) }}</p></td>
        <td class="song-tracks"><span>{{ tracks(row) }}</span><p>{{ streamInfo(row) || '—' }}</p></td>
        <td class="song-state"><ElTag :type="rolesSummary(row.audio).tag === '可生成伴奏' ? 'primary' : rolesSummary(row.audio).tone" effect="light" size="small">{{ rolesSummary(row.audio).tag }}</ElTag><p v-if="stateHint(row)" :class="{ 'task-error': audioIssue(row.audio) && !audioIssue(row.audio)?.historical, 'is-long': stateHint(row).length >= 28 }" :title="stateHint(row)">{{ stateHint(row) }}</p></td>
        <td class="song-actions"><ElButton link type="primary" @click="editor = row">{{ actionLabel(row) }}</ElButton></td>
      </tr>
    </tbody></table></div>
    <div v-if="total" class="pagination"><ElPagination :current-page="page + 1" :page-size="pageSize" :page-sizes="[20, 30, 50, 100]" :total="total" layout="total, sizes, prev, pager, next" :pager-count="5" prev-text="上一页" next-text="下一页" @size-change="resize" @current-change="go($event - 1)" /></div>

    <div v-if="selectedCount" class="selection-bar" role="region" aria-label="批量处理所选歌曲">
      <strong>已选 {{ selectedCount }} 首</strong><ElButton link :disabled="busy" @click="clear">取消选择</ElButton><span class="bar-spacer" />
      <ElButton :disabled="busy || loading" @click="configure('recognize')">识别已有音轨</ElButton><ElButton type="primary" :disabled="busy || loading" @click="configure('generate')">生成伴奏</ElButton>
    </div>
    <BatchOptionsDialog v-model:profile="profile" v-model:backend="preferred" v-model:recognition-kind="recognitionKind" :mode="options" :count="optionsCount" :busy="busy" :error="optionsError" :backends="available" :separation="separation" :readiness="readiness" :ready="ready" :recognition-ready="canRecognize" :fast-ready="fastReady" @confirm="prepare" @close="closeOptions" @setup="closeOptions(); emit('setup')" />
    <ElDialog :model-value="!!editor" title="原唱与伴奏" width="1040px" :append-to-body="true" destroy-on-close class="audio-song-dialog" @close="editor = undefined">
      <template #header><div class="audio-dialog-heading"><img src="/assets/brand/logo-mark.svg" alt="" width="24" height="24"><span>原唱与伴奏</span></div></template>
      <AudioRolesPanel v-if="editor" :key="editor.id" :song-id="editor.id" :song="editor" :can-process="readiness.ready" :separation="separation" :backends="backends" workbench @changed="loadRows" @setup="editor = undefined; emit('setup')" />
    </ElDialog>
  </div>
</template>

<style scoped src="./songs-tab.css"></style>
