<script setup lang="ts">
import { ArrowDown, ArrowUp, CircleCheck, CollectionTag, Delete, Headset, RefreshRight, Search } from '@element-plus/icons-vue'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute } from 'vue-router'
import { ElIcon, ElButton, ElCheckbox, ElDialog, ElMessageBox, ElPagination } from 'element-plus'
import { ApiError } from '../../core/auth/api'
import PageHeader from '../../shared/ui/PageHeader.vue'
import SongCover from '../song-management/components/SongCover.vue'
import { songCache, type CacheEntry, type CachePage, type CachePin, type CachePins, type CacheSettings, type CleanupJob, type CleanupRequest } from './api'

const gib = 1024 ** 3
const route = useRoute()
const result = ref<CachePage | null>(null), settings = ref<CacheSettings | null>(null)
const draft = reactive({ capacityGiB: '' as string | number, policy: 'HYBRID', high: 90 as string | number, low: 75 as string | number })
const page = ref(1), loading = ref(false), busy = ref(false), error = ref(''), notice = ref(''), conflict = ref(false)
const pins = ref<CachePins | null>(null), pinPage = ref(1), pinsLoading = ref(false), pinError = ref('')
const job = ref<CleanupJob | null>(null), jobError = ref('')
const settingsExpanded = ref(false), jobDetailsExpanded = ref(false)
const activeView = ref<'cache' | 'pins'>('cache'), keyword = ref(''), typeFilter = ref('ALL')
const expandedEntries = ref(new Set<string>())
const cacheTab = ref<HTMLButtonElement>(), pinsTab = ref<HTMLButtonElement>()
const recentEntry = ref<CacheEntry | null>(null), recentConfirmed = ref(false), recentOpen = ref(false)
let active = true, epoch = 0, pinEpoch = 0, jobEpoch = 0
let pollTimer: ReturnType<typeof setTimeout> | undefined
const jobKey = 'singverse.cache.cleanup'
let currentJobId = ''
const policies = [
  { value: 'HYBRID', label: '混合评分' },
  { value: 'MANUAL', label: '手动清理' },
]
const policyValue = (value: string) => value === 'MANUAL' ? 'MANUAL' : 'HYBRID'
const policyLabel = (value: string) => policies.find(p => p.value === value)?.label ?? (['LRU', 'LFU', 'TTL'].includes(value) ? '混合评分（旧策略已迁移）' : '未知策略，请重新读取设置')
const maxBytes = computed(() => Math.round(Number(draft.capacityGiB) * gib))
const dirty = computed(() => !!settings.value && (maxBytes.value !== settings.value.maxBytes || draft.policy !== policyValue(settings.value.policy) || Number(draft.high) !== (settings.value.highWatermarkPercent ?? 90) || Number(draft.low) !== (settings.value.lowWatermarkPercent ?? 75)))
const validation = computed(() => !Number.isSafeInteger(maxBytes.value) || maxBytes.value < 64 * 1024 ** 2 || maxBytes.value > 1024 ** 5
  ? '缓存容量应在 0.0625～1048576 GiB 之间。'
  : !Number.isInteger(Number(draft.high)) || !Number.isInteger(Number(draft.low)) || Number(draft.low) < 1 || Number(draft.high) > 100 || Number(draft.low) >= Number(draft.high)
    ? '水位应为 1～100 的整数，低水位必须小于高水位。' : '')
const usedPercent = computed(() => result.value && result.value.settings.maxBytes > 0 ? Math.min(100, result.value.usageBytes / result.value.settings.maxBytes * 100) : 0)
const usageRatio = computed(() => result.value && result.value.settings.maxBytes > 0 ? (result.value.usageBytes / result.value.settings.maxBytes * 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : '0')
const remainingBytes = computed(() => Math.max(0, (result.value?.settings.maxBytes ?? 0) - (result.value?.usageBytes ?? 0)))
const capacityValidation = computed(() => !Number.isSafeInteger(maxBytes.value) || maxBytes.value < 64 * 1024 ** 2 || maxBytes.value > 1024 ** 5)
const filteredEntries = computed(() => (result.value?.items ?? []).filter(entry => matches(entry) && (typeFilter.value === 'ALL' || (entry.target.mode === 'ORIGINAL' ? 'ORIGINAL' : 'COMPATIBLE') === typeFilter.value)))
const filteredPins = computed(() => (pins.value?.items ?? []).filter(matches))
const statisticsPending = computed(() => result.value?.usageReady === false || result.value?.statisticsReady === false)
const cleanupDisabled = computed(() => busy.value || loading.value || runningJob.value || statisticsPending.value || !result.value || result.value.usageBytes <= 0 && result.value.entryCount <= 0)
const policyDisabledReason = computed(() => result.value?.settings.policy === 'MANUAL' ? '手动策略不执行评分回收，请使用清理缓存。' : statisticsPending.value ? '占用或播放评分统计准备中，暂不能开始清理。' : '')
const policyTarget = computed(() => (result.value?.settings.maxBytes ?? 0) * (result.value?.settings.lowWatermarkPercent ?? 75) / 100)
const runningJob = computed(() => !!job.value && ['QUEUED', 'RUNNING', 'CANCELLING'].includes(job.value.state))
const jobStates: Record<string, string> = { QUEUED: '等待清理', RUNNING: '正在清理', CANCELLING: '正在取消', SUCCEEDED: '清理完成', PARTIAL: '部分清理完成', BLOCKED: '受保护数据阻止继续清理', FAILED: '清理失败', CANCELLED: '清理已取消', INTERRUPTED: '清理被服务重启中断' }
const reasons: Record<string, string> = { PLAYING: '正在播放', DOWNLOADING: '正在下载', PINNED: '已固定', RECENT_PLAY: '近 24 小时播放保护', PREFETCH: '正在预取', DELETING: '正在删除', BUILDING: '正在接收', CHANGED: '缓存状态已变化', STATISTICS_OR_MANUAL: '统计未就绪或当前采用手动策略' }
const lifecycles: Record<string, string> = { HOT: '热门', WARM: '常用', COLD: '冷门', EVICT: '待回收' }
function matches(value: CacheEntry | CachePin) { return !keyword.value.trim() || [value.title, value.artist, value.songId].some(text => text?.toLocaleLowerCase().includes(keyword.value.trim().toLocaleLowerCase())) }
function resetFilters() { keyword.value = ''; typeFilter.value = 'ALL' }
function changeView(value: 'cache' | 'pins') { activeView.value = value; resetFilters() }
async function tabKeydown(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  changeView(event.key === 'Home' ? 'cache' : event.key === 'End' ? 'pins' : activeView.value === 'cache' ? 'pins' : 'cache')
  await nextTick(); (activeView.value === 'cache' ? cacheTab.value : pinsTab.value)?.focus()
}
function toggleDetails(id: string) { const value = new Set(expandedEntries.value); if (value.has(id)) value.delete(id); else value.add(id); expandedEntries.value = value }
async function toggleSettings() {
  if (busy.value) return
  if (settingsExpanded.value && dirty.value) { if (!await discard()) return; if (settings.value) adopt(settings.value) }
  settingsExpanded.value = !settingsExpanded.value
}
async function discardSettings() { if (!busy.value && settings.value && await discard()) adopt(settings.value) }
function protections(entry: CacheEntry) { return (entry.protectionReasons ?? []).map(reason => reasons[reason] ?? reason) }
function deletionBlocked(entry: CacheEntry) { return entry.leased || entry.pinned || entry.state === 'DELETING' || (entry.protectionReasons ?? []).some(reason => ['PLAYING', 'DOWNLOADING', 'PINNED', 'PREFETCH', 'BUILDING', 'DELETING'].includes(reason)) }
function adopt(value: CacheSettings) {
  settings.value = { ...value }
  Object.assign(draft, { capacityGiB: value.maxBytes / gib, policy: policyValue(value.policy), high: value.highWatermarkPercent ?? 90, low: value.lowWatermarkPercent ?? 75 })
  conflict.value = false
}
function failure(value: unknown) { if (active) error.value = value instanceof Error ? value.message : '读取缓存失败，请重试' }
async function load(replaceSettings = false) {
  const seq = ++epoch
  loading.value = true; error.value = ''
  try {
    const data = await songCache.list(page.value - 1, 20)
    if (!active || seq !== epoch) return
    result.value = data
    expandedEntries.value = new Set([...expandedEntries.value].filter(id => data.items.some(entry => entry.id === id)))
    if (!settings.value || replaceSettings || !dirty.value) adopt(data.settings)
    const last = Math.max(1, Math.ceil(data.totalElements / 20))
    if (page.value > last) { page.value = last; await load() }
  } catch (value) { if (seq === epoch) failure(value) }
  finally { if (active && seq === epoch) loading.value = false }
}
async function loadPins() {
  const seq = ++pinEpoch
  pinsLoading.value = true; pinError.value = ''
  try {
    const value = await songCache.pins(pinPage.value - 1, 20)
    if (!active || seq !== pinEpoch || !value) return
    pins.value = value
    const last = Math.max(1, Math.ceil(value.totalElements / 20))
    if (pinPage.value > last) { pinPage.value = last; await loadPins() }
  } catch (value) { if (active && seq === pinEpoch) pinError.value = value instanceof Error ? value.message : '读取固定歌曲失败' }
  finally { if (active && seq === pinEpoch) pinsLoading.value = false }
}
async function discard() {
  if (!dirty.value) return true
  try { await ElMessageBox.confirm('放弃尚未保存的缓存容量、策略和水位修改？', '有未保存的设置', { confirmButtonText: '放弃修改', cancelButtonText: '继续编辑', type: 'warning', autofocus: false }); return true }
  catch { return false }
}
async function reloadSettings() { if (busy.value || loading.value || !await discard()) return; await load(true) }
async function save() {
  if (!settings.value || busy.value || loading.value || runningJob.value || !dirty.value || conflict.value) return
  if (validation.value) { error.value = validation.value; return }
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const saved = await songCache.save({ maxBytes: maxBytes.value, policy: draft.policy, ttlHours: settings.value.ttlHours, revision: settings.value.revision, highWatermarkPercent: Number(draft.high), lowWatermarkPercent: Number(draft.low) })
    if (!active) return
    adopt(saved); notice.value = '缓存设置已保存'; await load()
  } catch (value) { failure(value); if (value instanceof ApiError && value.status === 409) conflict.value = true }
  finally { if (active) busy.value = false }
}
function rememberJob(id?: string) { try { if (id) sessionStorage.setItem(jobKey, id); else sessionStorage.removeItem(jobKey) } catch { /* Polling also works when browser storage is unavailable. */ } }
function applyJob(value: CleanupJob) {
  job.value = value; currentJobId = value.id
  if (value.failed > 0 || ['BLOCKED', 'FAILED', 'INTERRUPTED'].includes(value.state)) jobDetailsExpanded.value = true
  clearTimeout(pollTimer)
  if (['QUEUED', 'RUNNING', 'CANCELLING'].includes(value.state)) { rememberJob(value.id); pollTimer = setTimeout(() => { void pollJob(value.id) }, 1000) }
  else { rememberJob(); void load(); void loadPins() }
}
async function pollJob(id = job.value?.id || currentJobId) {
  if (!id || !active) return
  currentJobId = id
  const seq = ++jobEpoch
  clearTimeout(pollTimer); jobError.value = ''
  try { const value = await songCache.job(id); if (active && seq === jobEpoch) applyJob(value) }
  catch (value) { if (active && seq === jobEpoch) jobError.value = value instanceof Error ? value.message : '读取清理进度失败，请重试' }
}
async function startJob(input: CleanupRequest) {
  if (!active || busy.value || runningJob.value || input.mode === 'POLICY' && policyDisabledReason.value) return
  busy.value = true; error.value = ''; notice.value = ''; jobError.value = ''
  const seq = ++jobEpoch
  try { const value = await songCache.cleanup(input); if (active && seq === jobEpoch) applyJob(value) }
  catch (value) { failure(value) }
  finally { if (active) busy.value = false }
}
async function cancelJob() {
  if (!job.value || busy.value || !runningJob.value || job.value.state === 'CANCELLING') return
  busy.value = true; jobError.value = ''; clearTimeout(pollTimer)
  const id = job.value.id, seq = ++jobEpoch
  try { const value = await songCache.cancelJob(id); if (active && seq === jobEpoch) applyJob(value) }
  catch (value) { if (active && seq === jobEpoch) { jobError.value = value instanceof Error ? value.message : '取消失败，请重试'; pollTimer = setTimeout(() => { void pollJob(id) }, 1000) } }
  finally { if (active) busy.value = false }
}
async function remove(entry: CacheEntry) {
  if (busy.value || loading.value || runningJob.value || statisticsPending.value || deletionBlocked(entry)) return
  const recent = entry.protectionReasons?.includes('RECENT_PLAY') ?? false
  if (recent) { recentEntry.value = entry; recentConfirmed.value = false; recentOpen.value = true; return }
  try {
    const content = entry.target.mode === 'ORIGINAL' ? '删除原片缓存副本？WebDAV 源文件会保留，下次播放将按需重新读取。' : '删除这份兼容缓存？原始歌曲会保留，下次需要时将重新生成。'
    await ElMessageBox.confirm(content, `删除“${entry.title || '未命名歌曲'}”的缓存`, { confirmButtonText: '删除缓存', cancelButtonText: '保留', type: 'warning', autofocus: false })
  } catch { return }
  await startJob({ mode: 'DELETE', entryId: entry.id })
}
async function confirmRecentDelete() {
  if (!recentEntry.value || !recentConfirmed.value || busy.value || loading.value || runningJob.value || statisticsPending.value || deletionBlocked(recentEntry.value)) return
  const entryId = recentEntry.value.id
  recentOpen.value = false
  await startJob({ mode: 'DELETE', entryId, confirmRecent: true })
}
async function clear(mode: 'CLEAR' | 'POLICY' = 'CLEAR') {
  if (cleanupDisabled.value || !result.value || mode === 'POLICY' && policyDisabledReason.value) return
  try {
    const target = `按当前混合评分回收到低水位 ${result.value.settings.lowWatermarkPercent ?? 75}%（${bytes(policyTarget.value)}）？${result.value.usageBytes <= policyTarget.value ? ' 当前占用已低于目标，本次无需删除缓存。' : ''}固定、近期播放和使用中的数据受保护，可能无法达到目标。`
    await ElMessageBox.confirm(mode === 'CLEAR' ? '清理所有未受保护的歌曲缓存，不受低水位目标限制？固定、近 24 小时实际播放、正在播放或下载的条目会跳过，原始歌曲和离线兼容版本会保留。' : target, mode === 'CLEAR' ? '清理缓存' : '按策略回收', { confirmButtonText: mode === 'CLEAR' ? '开始清理' : '开始回收', cancelButtonText: '保留', type: 'warning', autofocus: false })
  } catch { return }
  await startJob({ mode })
}
async function togglePin(value: CacheEntry | CachePin) {
  if (!value.songId || busy.value) return
  const pinned = !value.pinned
  try { await ElMessageBox.confirm(pinned ? '固定此歌曲的所有原片及兼容缓存，包括以后产生的变体。固定不会强制下载整曲，空间不足也不会自动取消固定。' : '取消此歌曲所有现有及未来缓存的固定？取消后仍保留实际播放等保护；删除缓存需要另行确认。', pinned ? '固定歌曲缓存' : '取消固定', { confirmButtonText: pinned ? '固定歌曲' : '取消固定', cancelButtonText: '保留', type: 'warning', autofocus: false }) }
  catch { return }
  if (!active || busy.value) return
  busy.value = true; error.value = ''
  try {
    const saved = await songCache.pin(value.songId, pinned, 'pinRevision' in value ? value.pinRevision ?? 0 : 'revision' in value ? value.revision : 0)
    if (!active) return
    for (const entry of result.value?.items ?? []) if (entry.songId === value.songId) { entry.pinned = saved.pinned; entry.pinRevision = saved.revision }
    notice.value = saved.pinned ? '已固定此歌曲的所有缓存' : '已取消此歌曲的固定'
    await Promise.all([load(), loadPins()])
  } catch (value) { failure(value) }
  finally { if (active) busy.value = false }
}
function bytes(value: number) {
  if (!Number.isFinite(value)) return '未知'
  if (value === 0) return '0 B'
  if (value >= gib) return `${(value / gib).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} GiB`
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} MiB`
  return `${(value / 1024).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} KiB`
}
function date(value?: string | null) { const time = value ? new Date(value) : null; return !time || Number.isNaN(time.getTime()) ? '尚无实际播放' : time.toLocaleString('zh-CN', { hour12: false }) }
function score(value?: number) { return Number.isFinite(value) ? value!.toFixed(3) : '—' }
function shortDate(value?: string) {
  const time = value ? new Date(value) : null
  if (!time || Number.isNaN(time.getTime())) return '暂无访问记录'
  const today = new Date()
  const day = time.toDateString() === today.toDateString() ? '今天' : time.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', ...(time.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) })
  return `${day} ${time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`
}
function completeness(entry: CacheEntry) {
  if (entry.target.mode !== 'ORIGINAL') return ''
  const cached = entry.cachedBytes ?? entry.bytes, total = entry.sourceBytes ?? entry.target.sourceBytes ?? 0
  if (entry.complete === true || total > 0 && cached >= total) return '已完整缓存'
  return `部分已缓存${total > 0 ? ` ${Math.min(100, Math.floor(cached / total * 100))}%` : ''}`
}
function shortFormat(entry: CacheEntry) {
  if (entry.target.mode === 'ORIGINAL') return 'WebDAV 原片'
  if (entry.target.mode === 'REMUX') return '重封装 / 保留源编码'
  if (entry.target.mode === 'AUDIO_TRANSCODE' || entry.mediaType === 'AUDIO') return entry.mediaType === 'VIDEO' ? 'AAC / 保留视频编码' : 'AAC / 音频'
  return `${(entry.target.codec || 'h264').toUpperCase()} / 上限 ${entry.target.width || '—'} × ${entry.target.height || '—'}`
}
function jobFailure(value: CleanupJob['errors'][number]) { return typeof value === 'string' ? value : value.message || value.code || '缓存清理失败' }
function format(entry: CacheEntry) {
  const mode = entry.target.mode
  if (mode === 'ORIGINAL') {
    const cached = entry.cachedBytes ?? entry.bytes, total = entry.sourceBytes ?? entry.target.sourceBytes ?? 0
    return entry.complete === true || total > 0 && cached >= total ? 'WebDAV 原片 / 已完整缓存' : total > 0 ? `WebDAV 原片 / 已缓存 ${bytes(cached)} / ${bytes(total)}` : 'WebDAV 原片 / 按需缓存'
  }
  const output = mode === 'REMUX' ? '重封装，保留源编码' : mode === 'AUDIO_TRANSCODE' ? entry.mediaType === 'VIDEO' ? '音频转 AAC，保留视频编码' : 'AAC 音频' : entry.mediaType === 'VIDEO' ? `${(entry.target.codec || 'h264').toUpperCase()} / 画质上限 ${entry.target.width || '—'} × ${entry.target.height || '—'}` : 'AAC 音频'
  return `${output}${entry.target.start ? ` / 从 ${entry.target.start} 秒起` : ''}`
}
function beforeUnload(event: BeforeUnloadEvent) { if (dirty.value || busy.value) { event.preventDefault(); event.returnValue = '' } }
onBeforeRouteLeave(() => busy.value ? false : discard())
watch(() => route.query.job, id => { if (typeof id === 'string') void pollJob(id) })
onMounted(() => { window.addEventListener('beforeunload', beforeUnload); void load(); void loadPins(); if (typeof route.query.job === 'string') void pollJob(route.query.job); else try { const id = sessionStorage.getItem(jobKey); if (id) void pollJob(id) } catch { /* Storage is optional. */ } })
onBeforeUnmount(() => { active = false; epoch++; pinEpoch++; jobEpoch++; clearTimeout(pollTimer); window.removeEventListener('beforeunload', beforeUnload) })
</script>

<template>
  <section class="song-cache-page">
    <PageHeader title="存储与缓存" />
    <div v-if="error" role="alert" class="cache-feedback cache-error">{{ error }}<ElButton v-if="conflict" text :disabled="busy || loading" @click="reloadSettings">重新读取设置</ElButton></div>
    <p v-if="notice" role="status" class="cache-feedback cache-success">{{ notice }}</p>
    <template v-if="result">
      <section class="cache-storage sv-glass" aria-label="缓存容量概况">
        <div class="cache-storage-top">
          <div class="cache-storage-number"><span class="cache-capacity-label">缓存容量</span><strong>{{ result.usageReady === false ? '正在计算…' : bytes(result.usageBytes) }}</strong><span>/ {{ bytes(result.settings.maxBytes) }}</span></div>
          <div class="cache-cleanup-buttons">
            <ElButton class="cache-refresh" :icon="RefreshRight" :loading="loading" :disabled="busy" aria-label="刷新列表" title="刷新缓存及占用" @click="load()"><span class="sr-only">刷新列表</span></ElButton>
            <ElButton type="primary" :disabled="cleanupDisabled || !!policyDisabledReason" :title="policyDisabledReason || '按已保存策略回收到低水位'" @click="clear('POLICY')">按策略回收</ElButton>
            <ElButton type="danger" plain :disabled="cleanupDisabled" @click="clear('CLEAR')">清理缓存</ElButton>
          </div>
        </div>
        <progress :value="usedPercent" max="100" aria-label="缓存容量使用比例" />
        <div class="cache-capacity-meta">
          <div><span class="cache-used"><i aria-hidden="true" />已用 {{ result.usageReady === false ? '计算中' : `${usageRatio}%` }}</span><span class="cache-remaining">剩余 {{ bytes(remainingBytes) }}</span><span>{{ result.entryCount }} 份歌曲缓存</span></div>
          <div class="cache-reserved"><span v-if="result.reservedBytes !== undefined">预留 {{ bytes(result.reservedBytes) }}</span></div>
        </div>
        <p v-if="statisticsPending" class="cache-statistics-note" role="status">{{ result.usageReady === false ? '正在计算缓存占用，请稍候。' : '正在准备播放评分统计，当前尚未就绪。' }}</p>
        <div class="cache-policy-line">
          <div class="cache-policy-brief"><ElIcon><CircleCheck /></ElIcon><strong>{{ policyLabel(result.settings.policy) }}</strong><span v-if="result.settings.policy === 'MANUAL'">容量不足时停止新增缓存</span><span v-else>{{ result.settings.highWatermarkPercent ?? 90 }}% 触发回收，{{ result.settings.lowWatermarkPercent ?? 75 }}% 为目标</span></div>
          <ElButton text class="cache-settings-toggle" :disabled="busy" :aria-expanded="settingsExpanded" aria-controls="cache-settings" @click="toggleSettings"><span v-if="dirty" class="cache-draft">尚未保存</span>{{ settingsExpanded ? '收起设置' : '调整设置' }}<ElIcon><ArrowUp v-if="settingsExpanded" /><ArrowDown v-else /></ElIcon></ElButton>
        </div>
        <p v-if="result.settings.policy === 'MANUAL'" class="cache-policy-note">{{ policyDisabledReason }}</p>
        <form v-if="settings" v-show="settingsExpanded" id="cache-settings" class="cache-settings" novalidate @submit.prevent="save">
          <div class="cache-section-heading"><div><h2>缓存设置</h2></div></div>
          <div class="cache-fields">
            <label>容量上限<span class="cache-unit">GiB</span><input v-model="draft.capacityGiB" type="number" min="0.0625" max="1048576" step="any" required aria-label="最大缓存容量" :aria-invalid="dirty && capacityValidation" :disabled="busy || loading" /></label>
            <label>回收策略<select v-model="draft.policy" aria-label="缓存策略" :disabled="busy || loading"><option v-for="policy in policies" :key="policy.value" :value="policy.value">{{ policy.label }}</option></select></label>
            <label>混合策略触发占用<span class="cache-unit">%</span><input v-model="draft.high" type="number" min="2" max="100" step="1" required aria-label="缓存高水位" :aria-invalid="dirty && !capacityValidation && !!validation" :disabled="busy || loading || runningJob" /></label>
            <label>混合策略目标占用<span class="cache-unit">%</span><input v-model="draft.low" type="number" min="1" max="99" step="1" required aria-label="缓存低水位" :aria-invalid="dirty && !capacityValidation && !!validation" :disabled="busy || loading || runningJob" /></label>
          </div>
          <div class="cache-settings-footer"><p v-if="dirty && validation" class="cache-validation" role="alert">{{ validation }}</p><div><ElButton :disabled="busy || loading" @click="reloadSettings">重新读取设置</ElButton><ElButton v-if="dirty" :disabled="busy || loading" @click="discardSettings">放弃修改</ElButton><ElButton type="primary" native-type="submit" :loading="busy" :disabled="loading || runningJob || !dirty || !!validation || conflict">保存设置</ElButton></div></div>
        </form>
      </section>

      <section v-if="job || jobError" class="cache-job" aria-label="缓存清理任务" aria-live="polite">
        <div class="cache-job-summary"><div><h2>{{ job ? jobStates[job.state] || job.state : '读取清理任务' }}</h2><p v-if="job">已清理 {{ job.removed }} 份缓存，释放 {{ bytes(job.freedBytes) }}；跳过 {{ job.skipped }} 份，失败 {{ job.failed }} 份。</p></div><div class="cache-job-actions"><ElButton v-if="runningJob" :disabled="busy || job?.state === 'CANCELLING'" @click="cancelJob">取消清理</ElButton><ElButton text :aria-expanded="jobDetailsExpanded" aria-controls="cache-job-details" @click="jobDetailsExpanded = !jobDetailsExpanded">{{ jobDetailsExpanded ? '收起详情' : '任务详情' }}<ElIcon><ArrowUp v-if="jobDetailsExpanded" /><ArrowDown v-else /></ElIcon></ElButton></div></div>
        <p v-if="jobError" role="alert" class="cache-error">{{ jobError }}<ElButton text @click="pollJob()">重试读取进度</ElButton></p>
        <p v-if="job?.spaceInsufficient" role="alert" class="cache-error">清理后空间仍不足，还需 {{ bytes(job.shortfallBytes) }}。请取消不需要的固定、等待使用结束，或增加缓存容量及磁盘空间。</p>
        <div v-show="jobDetailsExpanded" id="cache-job-details" class="cache-job-details"><template v-if="job"><p>占用 {{ bytes(job.usageBeforeBytes) }} → {{ bytes(job.usageAfterBytes) }}，目标 {{ bytes(job.targetBytes) }}</p><p v-if="!job.spaceInsufficient && !runningJob && !job.targetReached" class="cache-hint">未达到目标水位，当前仍有可用缓存空间；受保护条目不会被强制删除。</p><ul v-if="Object.keys(job.skippedByReason ?? {}).length" class="cache-job-reasons"><li v-for="(count, reason) in job.skippedByReason" :key="reason">{{ reasons[reason] || reason }}：{{ count }} 份</li></ul><ul v-if="job.errors?.length" class="cache-error"><li v-for="(item, index) in job.errors" :key="index">{{ jobFailure(item) }}</li></ul></template></div>
      </section>

      <section class="cache-workspace sv-glass" aria-label="缓存管理">
        <div class="cache-workspace-top"><div class="cache-tabs" role="tablist" aria-label="缓存管理视图"><button id="cache-list-tab" ref="cacheTab" type="button" role="tab" :aria-selected="activeView === 'cache'" :tabindex="activeView === 'cache' ? 0 : -1" aria-controls="cache-list-panel" @click="changeView('cache')" @keydown="tabKeydown">缓存明细<span>{{ result.totalElements }}</span></button><button id="cache-pins-tab" ref="pinsTab" type="button" role="tab" :aria-selected="activeView === 'pins'" :tabindex="activeView === 'pins' ? 0 : -1" aria-controls="cache-pins-panel" @click="changeView('pins')" @keydown="tabKeydown">固定歌曲<span>{{ pins?.totalElements ?? '—' }}</span></button></div></div>
        <div class="cache-filter-row"><label class="cache-search"><ElIcon><Search /></ElIcon><input v-model="keyword" type="search" :aria-label="activeView === 'cache' ? '查找当前页歌曲或歌手' : '查找当前页固定歌曲'" :placeholder="activeView === 'cache' ? '查找当前页歌曲或歌手' : '查找当前页固定歌曲'" maxlength="200" :disabled="activeView === 'cache' ? loading : pinsLoading" /></label><select v-if="activeView === 'cache'" v-model="typeFilter" aria-label="筛选当前页缓存类型" :disabled="loading"><option value="ALL">全部类型</option><option value="ORIGINAL">原片</option><option value="COMPATIBLE">兼容缓存</option></select><span class="cache-filter-scope">仅筛选当前页</span><ElButton v-if="activeView === 'pins'" class="cache-pin-refresh" text :icon="RefreshRight" :disabled="pinsLoading || busy" @click="loadPins">刷新固定</ElButton></div>

        <section v-show="activeView === 'cache'" id="cache-list-panel" class="cache-list" role="tabpanel" aria-labelledby="cache-list-tab" aria-label="已缓存的音视频" :aria-busy="loading">
          <p v-if="loading" class="cache-loading" role="status">正在读取缓存…</p>
          <div v-else-if="!result.items.length" class="cache-empty"><ElIcon><Headset /></ElIcon><h3>暂无歌曲缓存</h3></div>
          <div v-else-if="!filteredEntries.length" class="cache-empty"><ElIcon><Search /></ElIcon><h3>当前页没有匹配的缓存</h3><ElButton @click="resetFilters">重置筛选</ElButton></div>
          <div v-else class="cache-table"><div class="cache-table-heading" aria-hidden="true"><span>歌曲与副本</span><span>类型与规格</span><span>已占用</span><span>保护状态</span><span>最近访问</span><span>操作</span></div>
            <article v-for="entry in filteredEntries" :key="entry.id" class="cache-row" :data-cache-id="entry.id" :data-song-id="entry.songId">
              <div class="cache-row-main">
                <div class="cache-song"><SongCover class="cache-song-cover" :song-id="entry.songId" :title="entry.title" /><button type="button" class="cache-song-open" :aria-label="`查看${entry.title || '未命名歌曲'}的缓存详情`" :aria-expanded="expandedEntries.has(entry.id)" :aria-controls="`cache-detail-${entry.id}`" title="展开缓存规格、使用记录与播放评分" @click="toggleDetails(entry.id)"><strong>{{ entry.title || '未命名歌曲' }}</strong><span>{{ entry.artist || entry.songId || '歌曲信息暂不可用' }}</span><ElIcon class="cache-song-chevron"><ArrowUp v-if="expandedEntries.has(entry.id)" /><ArrowDown v-else /></ElIcon></button></div>
                <div class="cache-format"><span>{{ entry.target.mode === 'ORIGINAL' ? '原片' : '兼容缓存' }} {{ entry.mediaType === 'AUDIO' ? '音频' : '视频' }}</span><small>{{ shortFormat(entry) }}</small></div>
                <div class="cache-size"><span>{{ bytes(entry.bytes) }}</span><small v-if="completeness(entry)" :class="{ 'cache-partial': completeness(entry).startsWith('部分') }">{{ completeness(entry) }}</small><small v-if="(entry.residueBytes ?? 0) > 0" title="损坏或待清理的文件仍占磁盘，不计入可播放缓存字节">另有残留占用 {{ bytes(entry.residueBytes ?? 0) }}</small></div>
                <div class="cache-protections"><span v-if="entry.pinned && !entry.protectionReasons?.includes('PINNED')" class="cache-protection is-pinned">固定保护</span><span v-for="(reason, index) in protections(entry)" :key="reason" class="cache-protection" :class="{ 'is-pinned': entry.protectionReasons?.[index] === 'PINNED', 'is-active': entry.protectionReasons?.[index] !== 'PINNED' }">{{ reason }}</span><span v-if="!protections(entry).length && !entry.pinned" class="cache-protection" :class="{ 'is-active': entry.leased || entry.state === 'DELETING' }">{{ entry.state === 'DELETING' ? '正在删除' : entry.leased ? '正在使用' : '可回收' }}</span></div>
                <time class="cache-access" :datetime="entry.lastAccessAt" :title="date(entry.lastAccessAt)">{{ shortDate(entry.lastAccessAt) }}</time>
                <div class="cache-row-actions"><ElButton v-if="entry.songId" text class="cache-icon-button cache-pin-button" :class="{ 'is-pinned': entry.pinned }" :icon="CollectionTag" :disabled="busy || loading || entry.state === 'DELETING'" :aria-pressed="!!entry.pinned" :aria-label="`${entry.pinned ? '取消固定' : '固定'}${entry.title || '未命名歌曲'}的缓存`" :title="entry.pinned ? '取消整首歌的固定' : '固定此歌曲的全部缓存'" @click="togglePin(entry)" /><ElButton text type="danger" class="cache-icon-button cache-delete-button" :icon="Delete" :disabled="deletionBlocked(entry) || busy || loading || runningJob || statisticsPending" :aria-label="`删除${entry.title || '未命名歌曲'}的缓存`" :title="deletionBlocked(entry) ? '固定或使用中的缓存暂不能删除' : entry.protectionReasons?.includes('RECENT_PLAY') ? '单份删除需确认覆盖近期保护' : '删除这一份缓存'" @click="remove(entry)" /></div>
              </div>
              <div v-show="expandedEntries.has(entry.id)" :id="`cache-detail-${entry.id}`" class="cache-entry-details" role="region" :aria-label="`${entry.title || '未命名歌曲'}的缓存详情`"><dl><div><dt>缓存规格</dt><dd>{{ format(entry) }}</dd></div><div><dt>使用记录</dt><dd>命中 {{ entry.hits }} 次<br />最近访问 {{ date(entry.lastAccessAt) }}<br />生成于 {{ date(entry.createdAt) }}</dd></div><div><dt>播放与评分</dt><dd><span v-if="entry.lifecycle">{{ lifecycles[entry.lifecycle] || entry.lifecycle }} / 近 7 天有效 {{ entry.playCount7d ?? 0 }} 次 / 综合 {{ score(entry.score) }}</span><span v-else>近 7 天有效 {{ entry.playCount7d ?? 0 }} 次</span><br /><span v-if="entry.H !== undefined" :title="`保留优先级 ${score(entry.priority)}`">H {{ score(entry.H) }} / R {{ score(entry.R) }} / F {{ score(entry.F) }}<br /></span>实际播放于 {{ date(entry.lastPlayedAt) }}</dd></div></dl></div>
            </article>
          </div>
          <div class="cache-list-footer"><span v-if="result.totalElements">本页 {{ filteredEntries.length }} / {{ result.items.length }} 份<span v-if="keyword.trim() || typeFilter !== 'ALL'">（已筛选）</span></span><span v-else>共 0 份缓存</span><ElPagination v-if="result.totalElements" :current-page="page" :page-size="20" :total="result.totalElements" :disabled="busy || loading" layout="prev, pager, next" @current-change="value => { page = value; load() }" /></div>
        </section>

        <section v-show="activeView === 'pins'" id="cache-pins-panel" class="cache-pins" role="tabpanel" aria-labelledby="cache-pins-tab" aria-label="固定的歌曲缓存" :aria-busy="pinsLoading">
          <p v-if="pinError" role="alert" class="cache-feedback cache-error">{{ pinError }}<ElButton text :disabled="busy || pinsLoading" @click="loadPins">重试读取固定</ElButton></p><p v-else-if="pinsLoading" class="cache-loading" role="status">正在读取固定歌曲…</p>
          <div v-else-if="!pins?.items.length" class="cache-empty"><ElIcon><CollectionTag /></ElIcon><h3>尚未固定歌曲</h3><ElButton @click="changeView('cache')">查看缓存明细</ElButton></div>
          <div v-else-if="!filteredPins.length" class="cache-empty"><ElIcon><Search /></ElIcon><h3>当前页没有匹配的固定歌曲</h3><ElButton @click="resetFilters">重置筛选</ElButton></div>
          <div v-else class="cache-pin-list"><article v-for="pin in filteredPins" :key="pin.songId" class="cache-pin-row" :data-pin-song-id="pin.songId"><SongCover class="cache-song-cover" :song-id="pin.songId" :title="pin.title" /><div><strong>{{ pin.title || pin.songId }}</strong><p>{{ pin.artist || '歌曲信息暂不可用' }}</p></div><span v-if="pin.hasCache === false" class="cache-no-copy">尚无缓存</span><ElButton :disabled="busy" :aria-label="`取消固定${pin.title || pin.songId}`" @click="togglePin(pin)">取消固定</ElButton></article></div>
          <div class="cache-list-footer"><span>本页 {{ filteredPins.length }} / {{ pins?.items.length ?? 0 }} 首</span><ElPagination v-if="pins?.totalElements" :current-page="pinPage" :page-size="20" :total="pins.totalElements" :disabled="busy || pinsLoading" layout="prev, pager, next" @current-change="value => { pinPage = value; loadPins() }" /></div>
        </section>
      </section>
    </template>
    <p v-else-if="loading" role="status" class="cache-loading">正在读取缓存…</p>
    <section v-else class="cache-unavailable"><h2>暂时无法读取歌曲缓存</h2><ElButton @click="load()">重试</ElButton></section>

    <ElDialog v-model="recentOpen" title="覆盖近期保护并删除？" width="min(460px, calc(100vw - 32px))" align-center class="cache-recent-dialog">
      <template v-if="recentEntry"><div class="cache-dialog-song"><strong>{{ recentEntry.title || '未命名歌曲' }}</strong><span>{{ recentEntry.artist || recentEntry.songId }}</span><span>{{ format(recentEntry) }} / {{ bytes(recentEntry.bytes) }}</span></div><p class="cache-dialog-copy">仅删除这一份本地缓存；原始歌曲与离线兼容版本保持不变。</p><p class="cache-dialog-warning">这份缓存近 24 小时内实际播放过，通常受到近期保护。</p><ElCheckbox v-model="recentConfirmed" class="cache-recent-checkbox">我确认覆盖近期播放保护，只删除这一份缓存</ElCheckbox></template>
      <template #footer><div class="cache-recent-actions"><ElButton @click="recentOpen = false">保留缓存</ElButton><ElButton type="danger" :disabled="!recentConfirmed || busy || loading || runningJob || statisticsPending" @click="confirmRecentDelete">覆盖保护并删除</ElButton></div></template>
    </ElDialog>
  </section>
</template>

<style scoped src="./song-cache-workspace.css"></style>
