<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElAlert, ElButton, ElCard, ElDialog, ElEmpty, ElForm, ElFormItem, ElInput, ElMessage, ElTabPane, ElTabs } from 'element-plus'
import { FolderOpened, RefreshRight, Search, Setting } from '@element-plus/icons-vue'
import PageHeader from '../../shared/ui/PageHeader.vue'
import { media, type MediaSource } from '../media-library/api/media'
import SourcesDialog from './SourcesDialog.vue'
import TrackPicker from './TrackPicker.vue'
import RecordsPanel from './RecordsPanel.vue'
import PlatformBadge from './PlatformBadge.vue'
import TrackArtwork from './TrackArtwork.vue'
import { navigateRadios } from './radio-navigation'
import { duration, lx, message, platforms, qualities, type Preview, type SearchResult, type Status, type Track } from './api'
import { displayTrack, downloadName, recordingVersion, searchResults, versionNames, type VersionFilter } from './presentation'

const route = useRoute(), router = useRouter()
const status = ref<Status | null>(null), statusError = ref(''), statusLoading = ref(false), sourcesOpen = ref(false), tab = ref(route.query.tab === 'records' || route.query.batch ? 'records' : route.query.tab === 'preview' ? 'preview' : 'search')
const query = ref(typeof route.query.q === 'string' ? route.query.q : ''), platform = ref('all'), result = ref<SearchResult | null>(null), searchTracks = ref<Track[]>([]), searchSelected = ref<string[]>([]), searching = ref(false), searchError = ref('')
const resultFilter = ref(''), version = ref<VersionFilter>('all'), sort = ref('relevance')
const link = ref(''), preview = ref<Preview | null>(null), previewTracks = ref<Track[]>([]), previewSelected = ref<string[]>([]), previewing = ref(false), previewError = ref('')
const confirmOpen = ref(false), chosen = ref<Track[]>([]), quality = ref('auto'), submitting = ref(false), submitError = ref(''), notice = ref(''), records = ref<InstanceType<typeof RecordsPanel>>()
const targetOpen = ref(false), localSources = ref<MediaSource[]>([]), targetId = ref(''), targetError = ref(''), targetLoading = ref(false), targetSaving = ref(false), moreSources = ref(false), sourcePage = ref(0)
let alive = true, statusGeneration = 0, searchGeneration = 0, previewGeneration = 0, targetGeneration = 0, statusPending = false
let statesPending = false
let searchAbort: AbortController | null = null, previewAbort: AbortController | null = null
let searchPages = new Map<string, number>()
const searchProgress = ref({ completed: 0, total: 0 })
const searched = ref({ query: '', platform: 'all' })
let previewedLink = ''
const visibleTracks = computed(() => searchResults(searchTracks.value, searched.value.query, resultFilter.value, version.value, sort.value))
const chosenDisplay = computed(() => chosen.value.map(displayTrack))
const ready = computed(() => !!status.value?.ready)
const supported = computed(() => Object.keys(platforms).filter(p => status.value?.activeSource?.capabilities[p]?.length))
const supportedLabels = computed(() => supported.value.map(code => platforms[code]).join('、'))
const qualityOptions = computed(() => Object.keys(qualities).filter(q => q === 'auto' || chosen.value.every(t => status.value?.activeSource?.capabilities[t.platform]?.includes(q))))
const selectedTarget = computed(() => localSources.value.find(s => s.id === targetId.value))
async function refreshStatus() { if (statusPending) return; statusPending = true; const token = ++statusGeneration; statusLoading.value = true; try { const value = await lx.status(); if (!alive || token !== statusGeneration) return; status.value = value; statusError.value = ''; if (platform.value !== 'all' && !supported.value.includes(platform.value)) platform.value = 'all' } catch (e) { if (alive && token === statusGeneration) statusError.value = message(e) } finally { statusPending = false; if (alive && token === statusGeneration) statusLoading.value = false } }
async function recordsChanged() {
  void refreshStatus()
  if (statesPending) return
  const ids = [...new Set([...searchTracks.value, ...previewTracks.value].filter(t => t.downloading).map(t => t.id))]
  if (!ids.length) return
  statesPending = true
  try {
    const updated: Track[] = []
    for (let i = 0; i < ids.length && alive; i += 1000) updated.push(...await lx.trackStates(ids.slice(i, i + 1000)))
    if (!alive) return
    const states = new Map(updated.map(t => [t.id, t]))
    for (const rows of [searchTracks, previewTracks]) rows.value = rows.value.map(t => { const next = states.get(t.id); return next ? { ...t, inLibrary: next.inLibrary, downloading: next.downloading, songId: next.songId } : t })
  } catch { /* Records retain the actionable error; a later refresh retries track status. */ }
  finally { statesPending = false }
}
async function search(more = false) {
  if (!ready.value || searching.value || !query.value.trim()) return
  const token = ++searchGeneration; searching.value = true; searchError.value = ''
  if (!more) {
    searched.value = { query: query.value.trim(), platform: platform.value }
    searchPages = new Map((searched.value.platform === 'all' ? supported.value : [searched.value.platform]).map(p => [p, 1]))
    resultFilter.value = ''; version.value = 'all'
    searchTracks.value = []; searchSelected.value = []; result.value = null
  }
  const codes = [...searchPages].filter(([, page]) => page > 0).map(([p]) => p)
  const baseTracks = [...searchTracks.value], responses = new Map<string, SearchResult>()
  const controller = new AbortController(); searchAbort?.abort(); searchAbort = controller
  searchProgress.value = { completed: 0, total: codes.length }
  const active = () => alive && token === searchGeneration && !controller.signal.aborted
  try {
    await Promise.all(codes.map(async p => {
      const page = searchPages.get(p) || 1
      try {
        const value = await lx.search(searched.value.query, p, page, controller.signal)
        if (!active()) return
        responses.set(p, value)
        if (!value.errors.some(e => e.platform === p)) searchPages.set(p, value.hasMore ? page + 1 : 0)
      } catch (e) {
        if (!active()) return
        responses.set(p, { tracks: [], errors: [{ platform: p, message: message(e) }], warnings: [], page, hasMore: false })
      }
      if (!active()) return
      const pages = codes.flatMap(code => responses.has(code) ? [responses.get(code)!] : [])
      const current = new Map(searchTracks.value.map(t => [t.id, t]))
      searchTracks.value = merge(baseTracks, pages.flatMap(v => v.tracks)).map(t => {
        const live = current.get(t.id)
        return live ? { ...t, inLibrary: live.inLibrary, downloading: live.downloading, songId: live.songId } : t
      })
      const failures = new Map(pages.flatMap(v => v.errors).map(e => [e.platform, e]))
      result.value = { tracks: searchTracks.value, errors: [...failures.values()], warnings: [...new Set(pages.flatMap(v => v.warnings))], page: Math.max(1, ...pages.map(v => v.page)), hasMore: codes.some(code => responses.has(code) && (searchPages.get(code) || 0) > 0) }
      searchProgress.value = { completed: responses.size, total: codes.length }
    }))
  } finally {
    if (active()) { searching.value = false; searchAbort = null }
  }
}
async function readLink(more = false) {
  if (!ready.value || previewing.value || !link.value.trim()) return
  const token = ++previewGeneration; previewing.value = true; previewError.value = ''; if (!more) previewedLink = link.value.trim()
  previewAbort?.abort(); previewAbort = new AbortController()
  try { const value = await lx.preview(previewedLink, more ? (preview.value?.page || 1) + 1 : 1, previewAbort.signal); if (!alive || token !== previewGeneration) return; if (more && value.tracks.every(t => previewTracks.value.some(old => old.id === t.id))) { previewError.value = '平台未返回新的歌曲，已停止继续读取。当前列表已保留，请在原平台核对完整内容。'; preview.value = { ...value, hasMore: false }; return } preview.value = value; previewTracks.value = more ? merge(previewTracks.value, value.tracks) : value.tracks; if (!more) previewSelected.value = [] }
  catch (e) { if (alive && token === previewGeneration) previewError.value = message(e) }
  finally { if (alive && token === previewGeneration) previewing.value = false }
}
function merge(old: Track[], next: Track[]) { const rows = new Map(old.map(t => [t.id, t])); next.forEach(t => rows.set(t.id, t)); return [...rows.values()] }
function choose(tracks: Track[]) { if (!ready.value || !tracks.length) return; chosen.value = tracks; quality.value = 'auto'; submitError.value = ''; confirmOpen.value = true }
async function download() {
  if (submitting.value || !ready.value) return
  submitting.value = true; submitError.value = ''
  try { const created = await lx.create(chosen.value.map(t => t.id), quality.value, downloadName(chosen.value, tab.value === 'preview' ? preview.value?.name : undefined)); if (!alive) return; confirmOpen.value = false; const ids = new Set(chosen.value.map(t => t.id)); for (const rows of [searchTracks, previewTracks]) rows.value = rows.value.map(t => ids.has(t.id) ? { ...t, downloading: true } : t); searchSelected.value = searchSelected.value.filter(id => !ids.has(id)); previewSelected.value = previewSelected.value.filter(id => !ids.has(id)); notice.value = `已提交 ${chosen.value.length} 首歌曲${created.merged ? `，其中 ${created.merged} 首已在下载队列中` : ''}。正在显示实时进度。`; await router.replace({ query: { ...route.query, tab: 'records', batch: created.batch.id } }); await refreshStatus(); await records.value?.refresh(0) }
  catch (e) { if (alive) submitError.value = message(e) }
  finally { if (alive) submitting.value = false }
}
async function openTarget() { targetOpen.value = true; targetId.value = status.value?.target.id || ''; localSources.value = []; sourcePage.value = 0; targetError.value = ''; await loadTargets() }
async function loadTargets(more = false) { const token = ++targetGeneration; targetLoading.value = true; try { const value = await media.list(more ? sourcePage.value + 1 : 0, 100, { q: '', type: 'LOCAL', profileId: '' }); if (!alive || token !== targetGeneration || !targetOpen.value) return; localSources.value = more ? [...localSources.value, ...value.items] : value.items; sourcePage.value = value.page; moreSources.value = (value.page + 1) * value.size < value.totalElements } catch (e) { if (alive && token === targetGeneration) targetError.value = message(e) } finally { if (alive && token === targetGeneration) targetLoading.value = false } }
async function saveTarget() { const selected = selectedTarget.value; if (!selected || targetSaving.value) return; targetSaving.value = true; targetError.value = ''; try { await media.save({ name: selected.name, type: 'LOCAL', location: selected.location, parserProfileId: selected.parserProfileId, scanEnabled: selected.scanEnabled, scanCron: selected.scanCron || undefined, useForLxDownloads: true }, selected.id); if (!alive) return; targetOpen.value = false; await refreshStatus(); ElMessage.success('下载保存位置已更新') } catch (e) { if (alive) targetError.value = message(e) } finally { if (alive) targetSaving.value = false } }
function addDirectory() { targetOpen.value = false; void router.push('/library/media?add=LOCAL&download=1') }
watch(() => route.query.q, value => { if (typeof value === 'string') query.value = value })
watch(() => [route.query.tab, route.query.batch], ([value, batch]) => { tab.value = batch ? 'records' : value === 'records' || value === 'preview' ? value : 'search' })
watch(() => `${status.value?.activeSource?.id}:${status.value?.target.id}:${status.value?.target.path}:${status.value?.ready}`, (_, old) => { if (!old || old.startsWith('undefined:')) return; searchGeneration++; previewGeneration++; searchAbort?.abort(); previewAbort?.abort(); searching.value = false; previewing.value = false; if (!submitting.value) confirmOpen.value = false })
watch(tab, value => { void router.replace({ query: { ...route.query, tab: value, batch: value === 'records' ? route.query.batch : undefined } }) })
onMounted(() => void refreshStatus())
onBeforeUnmount(() => { alive = false; statusGeneration++; searchGeneration++; previewGeneration++; targetGeneration++; searchAbort?.abort(); previewAbort?.abort() })
</script>
<template>
  <div class="management-page downloads-page">
    <PageHeader title="下载歌曲"><template #actions><ElButton text :icon="RefreshRight" :loading="statusLoading" @click="refreshStatus">刷新状态</ElButton></template></PageHeader>
    <ElAlert v-if="statusError" :title="statusError" type="error" :closable="false" show-icon role="alert" />
    <section class="setup" aria-label="下载配置" :aria-busy="statusLoading">
      <div class="setup-item"><span class="setup-icon"><FolderOpened /></span><div class="setup-copy"><div class="setup-title"><strong>保存位置</strong></div><div class="setup-location"><strong>{{ status?.target.name || '尚未设置下载目录' }}</strong><span class="path" :title="status?.target.path || ''">{{ status?.target.path || '选择可写的本地歌曲来源' }}</span></div><ElAlert v-if="status?.target.id && !status.target.ready" :title="status.target.reason" type="warning" :closable="false" show-icon /></div><ElButton text type="primary" @click="openTarget">{{ status?.target.id ? '更改保存位置' : '设置下载目录' }}</ElButton></div>
      <div class="setup-item"><span class="setup-icon"><Setting /></span><div class="setup-copy"><div class="setup-title"><strong>当前音源</strong></div><p class="setup-value" :title="status?.activeSource?.name">{{ status?.activeSource?.name || '尚未启用音源' }} <span>{{ status?.activeSource?.version }}</span></p><p v-if="status?.activeSource" class="source-support" :title="supportedLabels">支持 {{ supportedLabels }}</p></div><ElButton text type="primary" @click="sourcesOpen = true">{{ status?.activeSource ? '管理音源' : '导入并启用音源' }}</ElButton></div>
    </section>
    <ElAlert v-if="notice" :title="notice" type="success" show-icon closable @close="notice = ''" />
    <ElCard shadow="never" class="download-workspace">
      <ElTabs v-model="tab"><ElTabPane label="搜索歌曲" name="search" /><ElTabPane label="导入歌单 / 专辑" name="preview" /><ElTabPane :label="`下载记录${status?.activeBatches ? ` · ${status.activeBatches} 个进行中` : ''}`" name="records" /></ElTabs>
      <section v-show="tab === 'search'" class="workspace-pane" aria-label="搜索歌曲" :aria-busy="searching">
        <ElForm class="search-form" @submit.prevent="search()"><ElInput v-model="query" aria-label="歌名或歌手" placeholder="歌名或歌手" maxlength="100" clearable :disabled="!ready || searching" :prefix-icon="Search" /><ElButton type="primary" native-type="submit" :loading="searching" :disabled="!ready || !query.trim()">搜索</ElButton></ElForm>
        <div class="platform-filters" role="radiogroup" aria-label="搜索平台" @keydown="navigateRadios($event, ['all', ...supported], platform, value => platform = value)"><button type="button" role="radio" :aria-checked="platform === 'all'" :tabindex="platform === 'all' ? 0 : -1" :disabled="!ready || searching" @click="platform = 'all'">全部平台</button><button v-for="p in supported" :key="p" type="button" role="radio" :aria-checked="platform === p" :tabindex="platform === p ? 0 : -1" :disabled="!ready || searching" @click="platform = p"><PlatformBadge :platform="p" /></button></div>
        <ElAlert v-if="searchError" :title="searchError" type="error" :closable="false" show-icon role="alert" />
        <p v-if="searching" class="help" role="status">已搜索 {{ searchProgress.completed }} / {{ searchProgress.total }} 个平台</p>
        <ElAlert v-for="failure in result?.errors" :key="failure.platform" :title="`${platforms[failure.platform]}：${failure.message}。可以重试或切换其他平台。`" type="warning" :closable="false" show-icon />
        <p v-for="warning in result?.warnings" :key="warning" class="help">{{ warning }}</p>
        <div v-if="searchTracks.length" class="results-heading"><h2>“{{ searched.query }}”的搜索结果</h2><span>显示 {{ visibleTracks.length }} / 已读取 {{ searchTracks.length }} 首</span></div>
        <div v-if="searchTracks.length" class="result-controls" aria-label="筛选已读取的搜索结果">
          <ElInput v-model="resultFilter" aria-label="筛选结果中的歌名歌手或专辑" placeholder="在结果中筛选歌名、歌手或专辑" clearable :prefix-icon="Search" />
          <select v-model="version" class="native-select" aria-label="歌曲版本"><option v-for="(label, key) in versionNames" :key="key" :value="key">{{ label }}</option></select>
          <select v-model="sort" class="native-select" aria-label="搜索结果排序"><option value="relevance">相关度优先</option><option value="platform">平台原始顺序</option></select>
        </div>
        <TrackPicker v-if="searchTracks.length" v-model:selected="searchSelected" :tracks="visibleTracks" :selection-tracks="searchTracks" :disabled="!ready" @download="choose" />
        <ElEmpty v-if="searchTracks.length && !visibleTracks.length" description="没有匹配歌曲"><ElButton @click="resultFilter = ''; version = 'all'">清除结果筛选</ElButton></ElEmpty>
        <ElEmpty v-if="!searchTracks.length && result && !searching && !result.errors.length" description="没有匹配歌曲" />
        <div v-if="result?.hasMore" class="more"><ElButton :loading="searching" :disabled="!ready" @click="search(true)">继续读取搜索结果</ElButton><span class="help">已读取 {{ searchTracks.length }} 首</span></div>
      </section>
      <section v-show="tab === 'preview'" class="workspace-pane" aria-label="导入歌单或专辑" :aria-busy="previewing">
        <ElForm class="link-form" @submit.prevent="readLink()"><ElInput v-model="link" aria-label="歌单或专辑分享链接" placeholder="粘贴歌单或专辑的公开分享链接" maxlength="4096" clearable :disabled="!ready || previewing" /><ElButton type="primary" native-type="submit" :loading="previewing" :disabled="!ready || !link.trim()">读取链接</ElButton></ElForm>
        <div v-if="!preview" class="import-platforms"><span>支持平台</span><PlatformBadge v-for="p in Object.keys(platforms)" :key="p" :platform="p" /></div>
        <ElAlert v-if="previewError" :title="previewError" type="error" :closable="false" show-icon role="alert" />
        <div v-if="preview" class="preview-heading"><TrackArtwork :url="preview.coverUrl" /><div><div class="collection-kind"><PlatformBadge :platform="preview.platform" /><span>{{ preview.kind === 'album' ? '专辑' : '歌单' }}</span></div><h2>{{ preview.name }}</h2><p class="help" role="status">已读取 {{ previewTracks.length }} / {{ preview.total }} 首{{ preview.hasMore ? '，可继续读取' : '' }}</p></div></div>
        <ElAlert v-if="preview?.warning" :title="preview.warning" type="warning" :closable="false" show-icon />
        <TrackPicker v-if="previewTracks.length" v-model:selected="previewSelected" :tracks="previewTracks" :disabled="!ready" @download="choose" />
        <ElEmpty v-else-if="preview && !previewing" description="此目录没有可读取的歌曲，请检查公开权限或换一个链接。" />
        <div v-if="preview?.hasMore" class="more"><ElButton :loading="previewing" :disabled="!ready" @click="readLink(true)">继续读取歌曲</ElButton></div>
      </section>
      <RecordsPanel v-show="tab === 'records'" ref="records" :visible="tab === 'records'" :status="status" @changed="recordsChanged" />
    </ElCard>
    <SourcesDialog v-model="sourcesOpen" @changed="refreshStatus" />
    <ElDialog v-model="confirmOpen" title="确认下载" width="min(520px, calc(100vw - 24px))" :close-on-click-modal="false" :close-on-press-escape="!submitting" :show-close="!submitting">
      <p>下载 <strong>{{ chosen.length }}</strong> 首歌曲</p>
      <ul class="confirm-tracks" aria-label="本次下载歌曲与版本"><li v-for="track in chosenDisplay" :key="track.id"><strong>{{ track.title }}</strong><span>{{ track.artists.join(' / ') || '歌手未知' }}</span><span>{{ track.album || '专辑未知' }} · {{ duration(track.durationMs) }}</span><span><PlatformBadge :platform="track.platform" /> · {{ versionNames[recordingVersion(track)] }}</span></li></ul>
      <p class="help path">保存到：{{ status?.target.path }}</p><p class="help">使用音源：{{ status?.activeSource?.name }} · {{ status?.activeSource?.version }}</p><ElForm label-position="top"><ElFormItem label="下载音质"><select v-model="quality" class="native-select" aria-label="下载音质" :disabled="submitting"><option v-for="q in qualityOptions" :key="q" :value="q">{{ qualities[q] }}</option></select></ElFormItem></ElForm><ElAlert v-if="submitError" :title="submitError" type="error" :closable="false" show-icon role="alert" /><template #footer><ElButton :disabled="submitting" @click="confirmOpen = false">返回</ElButton><ElButton type="primary" :loading="submitting" :disabled="!ready" @click="download">开始下载</ElButton></template>
    </ElDialog>
    <ElDialog v-model="targetOpen" title="选择下载保存位置" width="min(600px, calc(100vw - 24px))" :close-on-click-modal="false" :show-close="!targetSaving" @closed="targetGeneration++">
      <p class="help path">原保存位置：{{ status?.target.path || '尚未设置' }}</p><ElAlert v-if="targetError" :title="targetError" type="error" :closable="false" show-icon role="alert" /><ElForm label-position="top"><ElFormItem label="本地歌曲来源"><select v-model="targetId" class="native-select" aria-label="下载保存来源" :disabled="targetSaving || targetLoading"><option value="" disabled>选择本地歌曲来源</option><option v-for="source in localSources" :key="source.id" :value="source.id">{{ source.name }}</option></select></ElFormItem></ElForm><p v-if="selectedTarget" class="path">新保存位置：{{ selectedTarget.location }}</p><ElButton v-if="moreSources" :loading="targetLoading" @click="loadTargets(true)">读取更多来源</ElButton><p class="help">保存前会检查实际写入能力。若原位置仍有未完成任务，请先完成或取消任务，再更换位置。</p><ElButton link type="primary" :disabled="targetSaving" @click="addDirectory">添加本地歌曲来源 ↗</ElButton><template #footer><ElButton :disabled="targetSaving" @click="targetOpen = false">返回</ElButton><ElButton type="primary" :loading="targetSaving" :disabled="!selectedTarget || targetLoading" @click="saveTarget">保存位置</ElButton></template>
    </ElDialog>
  </div>
</template>
<style scoped>
.downloads-page{display:flex;flex-direction:column;gap:20px;min-width:0}.downloads-page>.page-heading{margin-bottom:0}.native-select{height:44px;max-width:100%;padding:0 12px;border:1px solid var(--el-border-color);border-radius:8px;background:var(--el-fill-color-blank);color:var(--el-text-color-regular);font:inherit;font-size:14px}.native-select:focus-visible{outline:2px solid var(--el-color-primary);outline-offset:2px}.native-select:disabled{opacity:.6}.setup{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.3fr);border:1px solid var(--el-border-color-lighter);border-radius:12px;background:var(--el-bg-color);padding:18px 20px;gap:24px}.setup-item{display:flex;align-items:center;gap:14px;min-width:0}.setup-item+.setup-item{padding-left:24px;border-left:1px solid var(--el-border-color-lighter)}.setup-icon{width:40px;height:40px;display:flex;align-items:center;justify-content:center;flex:none;background:var(--el-color-primary-light-9);color:var(--el-color-primary);border-radius:10px}.setup-icon svg{width:21px;height:21px}.setup-copy{flex:1;min-width:0}.setup-title{display:flex;align-items:center;gap:9px;font-size:12px;color:var(--el-text-color-secondary)}.setup-title strong{font-weight:400}.setup-location{display:flex;align-items:baseline;gap:10px;margin-top:7px;min-width:0}.setup-location>strong{font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0;max-width:50%}.setup-location>.path{font-family:ui-monospace,SFMono-Regular,monospace;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--el-text-color-secondary)}.setup-value{font-weight:600;font-size:14px;margin:7px 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.setup-value>span{font-size:12px;font-weight:400;color:var(--el-text-color-secondary);margin-left:5px}.setup-item>.el-button{flex:none;min-height:40px;font-size:13px;padding:0 8px}.source-support{font-size:12px;margin:5px 0 0;color:var(--el-text-color-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.help{font-size:14px;line-height:1.8;color:var(--el-text-color-secondary);overflow-wrap:anywhere}.setup .help{margin:6px 0 0;font-size:12px}.path{overflow-wrap:anywhere}.download-workspace{min-width:0;border:1px solid var(--el-border-color-lighter);border-radius:16px;background:var(--el-bg-color);--el-card-padding:24px}.download-workspace :deep(.el-card__body){padding:0 24px 8px}.download-workspace :deep(.el-tabs__header){margin:0}.download-workspace :deep(.el-tabs__item){height:62px;padding:0 24px;font-size:15px}.download-workspace :deep(.el-tabs__nav-wrap:after){height:1px;background:var(--el-border-color-lighter)}.download-workspace :deep(.el-tabs__active-bar){height:3px;border-radius:3px}.workspace-pane{padding-top:24px}.search-form,.link-form{display:flex;gap:12px}.search-form>.el-input,.link-form>.el-input{flex:1;min-width:0}.search-form :deep(.el-input__wrapper),.link-form :deep(.el-input__wrapper){min-height:50px;border-radius:10px;padding:0 16px}.search-form :deep(.el-input__inner),.link-form :deep(.el-input__inner){font-size:15px}.search-form>.el-button,.link-form>.el-button{height:50px;min-width:100px;border-radius:10px;font-size:15px}.platform-filters{display:flex;align-items:center;gap:8px;overflow-x:auto;padding:14px 0 22px;scrollbar-width:thin}.platform-filters>button{display:inline-flex;align-items:center;justify-content:center;flex:none;min-height:36px;padding:0 12px;border:1px solid var(--el-border-color-lighter);border-radius:7px;background:var(--el-bg-color);font:inherit;font-size:13px;color:var(--el-text-color-regular);cursor:pointer}.platform-filters>button[aria-checked=true]{border-color:var(--el-color-primary-light-5);background:var(--el-color-primary-light-9);color:var(--el-color-primary)}.platform-filters>button[aria-checked=true] :deep(.platform-badge){color:inherit}.platform-filters>button:disabled{opacity:.55;cursor:not-allowed}.platform-filters>button:focus-visible{outline:2px solid var(--el-color-primary);outline-offset:2px}.results-heading{display:flex;align-items:center;gap:12px;padding:8px 0}.results-heading h2{font-size:17px;font-weight:600;margin:0}.results-heading>span{font-size:12px;color:var(--el-text-color-secondary)}.more{display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;margin:24px 0 8px}.import-platforms{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-top:18px}.import-platforms>span:first-child{font-size:12px;color:var(--el-text-color-secondary)}.preview-heading{display:flex;align-items:center;gap:20px;margin:24px 0}.preview-heading :deep(.artwork){width:88px;height:88px;border-radius:12px}.preview-heading>div{min-width:0}.preview-heading h2{margin:10px 0 6px;font-size:21px;overflow-wrap:anywhere}.preview-heading .help{margin:0;font-size:12px}.collection-kind{display:flex;align-items:center;gap:10px}.collection-kind>span:last-child{font-size:12px;color:var(--el-text-color-secondary);border-left:1px solid var(--el-border-color);padding-left:10px}.el-alert{margin:8px 0}.el-dialog .native-select{width:100%}
.result-controls{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}.result-controls>.el-input{flex:1;min-width:220px}.result-controls .native-select{min-height:40px}.confirm-tracks{list-style:none;margin:16px 0;padding:0 14px;border:1px solid var(--el-border-color-lighter);border-radius:8px;max-height:260px;overflow:auto}.confirm-tracks li{display:flex;flex-direction:column;gap:6px;padding:12px 0;overflow-wrap:anywhere}.confirm-tracks li+li{border-top:1px solid var(--el-border-color-lighter)}.confirm-tracks span{font-size:13px;line-height:1.6;color:var(--el-text-color-secondary)}
@media(max-width:1100px){.setup{grid-template-columns:minmax(0,1fr);gap:16px}.setup-item+.setup-item{padding-left:0;padding-top:16px;border-left:0;border-top:1px solid var(--el-border-color-lighter)}}
@media(max-width:700px){.downloads-page{gap:16px}.setup{padding:14px;border-radius:10px;gap:12px}.setup-item{display:grid;grid-template-columns:30px minmax(0,1fr) auto;align-items:center;gap:10px}.setup-icon{width:30px;height:34px}.setup-copy{min-width:0}.setup-item>.el-button{margin-left:0;min-height:44px;font-size:12px;padding:0 4px}.setup-location{flex-wrap:wrap;gap:5px}.setup-location>strong{max-width:100%}.setup-location>.path{width:100%}.setup-item+.setup-item{padding-top:14px}.source-support{display:none}.setup-value{white-space:nowrap;line-height:1.6}.setup-value>span{display:none}.setup-title{gap:6px;font-size:12px}.setup-icon svg{width:20px;height:20px}.download-workspace{border-radius:12px}.download-workspace :deep(.el-card__body){padding:0 14px 6px}.download-workspace :deep(.el-tabs__item){height:54px;padding:0 12px;font-size:14px}.download-workspace :deep(.el-tabs__nav-scroll){overflow:auto;scrollbar-width:thin}.workspace-pane{padding-top:18px}.search-form,.link-form{gap:8px}.search-form>.el-button,.link-form>.el-button{min-width:68px;padding:0 14px;height:48px;font-size:14px}.search-form :deep(.el-input__wrapper),.link-form :deep(.el-input__wrapper){min-height:48px;padding:0 10px}.search-form :deep(.el-input__inner),.link-form :deep(.el-input__inner){font-size:14px}.platform-filters{padding-bottom:14px;margin-right:-14px;padding-right:14px}.platform-filters>button{min-height:44px}.results-heading{flex-wrap:wrap;gap:6px}.results-heading h2{font-size:15px}.preview-heading{gap:14px}.preview-heading :deep(.artwork){width:68px;height:68px}.preview-heading h2{font-size:18px}.import-platforms{gap:12px}.downloads-page :deep(.el-button){min-height:44px}}
</style>
