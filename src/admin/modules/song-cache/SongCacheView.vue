<script setup lang="ts">
import { ArrowDown, CollectionTag, Delete, RefreshRight, Search } from '@element-plus/icons-vue'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute } from 'vue-router'
import { ElIcon, ElButton, ElCheckbox, ElDialog, ElMessageBox, ElPagination } from 'element-plus'
import { ApiError } from '../../core/auth/api'
import PageHeader from '../../shared/ui/PageHeader.vue'
import SongCover from '../song-management/components/SongCover.vue'
import { songCache, type CacheEntry, type CachePage, type CachePin, type CachePins, type CacheSettings, type CleanupJob, type CleanupRequest } from './api'

const gib = 1024 ** 3
const pageSize = 20
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
const capacityInvalid = computed(() => !Number.isSafeInteger(maxBytes.value) || maxBytes.value < 64 * 1024 ** 2 || maxBytes.value > 1024 ** 5)
const validation = computed(() => capacityInvalid.value
  ? '缓存容量应在 0.0625～1048576 GiB 之间。'
  : !Number.isInteger(Number(draft.high)) || !Number.isInteger(Number(draft.low)) || Number(draft.low) < 1 || Number(draft.high) > 100 || Number(draft.low) >= Number(draft.high)
    ? '水位应为 1～100 的整数，低水位必须小于高水位。' : '')
const usedPercent = computed(() => result.value && result.value.settings.maxBytes > 0 ? Math.min(100, result.value.usageBytes / result.value.settings.maxBytes * 100) : 0)
const usageRatio = computed(() => result.value && result.value.settings.maxBytes > 0 ? (result.value.usageBytes / result.value.settings.maxBytes * 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : '0')
const remainingBytes = computed(() => Math.max(0, (result.value?.settings.maxBytes ?? 0) - (result.value?.usageBytes ?? 0)))
const filteringEntries = computed(() => !!keyword.value.trim() || typeFilter.value !== 'ALL')
const filteredEntries = computed(() => (result.value?.items ?? []).filter(entry => matches(entry) && (typeFilter.value === 'ALL' || (entry.target.mode === 'ORIGINAL' ? 'ORIGINAL' : 'COMPATIBLE') === typeFilter.value)))
const filteredPins = computed(() => (pins.value?.items ?? []).filter(matches))
const searchLabel = computed(() => activeView.value === 'cache' ? '查找当前页歌曲或歌手' : '查找当前页固定歌曲')
const usagePending = computed(() => result.value?.usageReady === false)
const statisticsPending = computed(() => usagePending.value || result.value?.statisticsReady === false)
const cleanupDisabled = computed(() => busy.value || loading.value || runningJob.value || statisticsPending.value || !result.value || result.value.usageBytes <= 0 && result.value.entryCount <= 0)
const policyDisabledReason = computed(() => result.value?.settings.policy === 'MANUAL' ? '当前策略为手动清理' : statisticsPending.value ? '占用或播放评分统计准备中' : '')
const policyTarget = computed(() => (result.value?.settings.maxBytes ?? 0) * (result.value?.settings.lowWatermarkPercent ?? 75) / 100)
const runningJob = computed(() => !!job.value && ['QUEUED', 'RUNNING', 'CANCELLING'].includes(job.value.state))
const jobStates: Record<string, string> = { QUEUED: '等待清理', RUNNING: '正在清理', CANCELLING: '正在取消', SUCCEEDED: '清理完成', PARTIAL: '部分清理完成', BLOCKED: '受保护数据阻止继续清理', FAILED: '清理失败', CANCELLED: '清理已取消', INTERRUPTED: '清理被服务重启中断' }
const reasons: Record<string, string> = { PLAYING: '正在播放', DOWNLOADING: '正在下载', PINNED: '已固定', RECENT_PLAY: '近 24 小时播放保护', PREFETCH: '正在预取', DELETING: '正在删除', BUILDING: '正在接收', CHANGED: '缓存状态已变化', STATISTICS_OR_MANUAL: '统计未就绪或当前采用手动策略' }
const lifecycles: Record<string, string> = { HOT: '热门', WARM: '常用', COLD: '冷门', EVICT: '待回收' }
function matches(value: CacheEntry | CachePin) { return !keyword.value.trim() || [value.title, value.artist, value.songId].some(text => text?.toLocaleLowerCase().includes(keyword.value.trim().toLocaleLowerCase())) }
function resetFilters() { keyword.value = ''; typeFilter.value = 'ALL' }
function changeView(value: 'cache' | 'pins') { activeView.value = value; resetFilters() }
async function focusView(value: 'cache' | 'pins') {
  changeView(value)
  await nextTick()
  const tab = value === 'cache' ? cacheTab.value : pinsTab.value
  tab?.focus()
}
async function tabKeydown(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  await focusView(event.key === 'Home' ? 'cache' : event.key === 'End' ? 'pins' : activeView.value === 'cache' ? 'pins' : 'cache')
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
    const data = await songCache.list(page.value - 1, pageSize)
    if (!active || seq !== epoch) return
    result.value = data
    expandedEntries.value = new Set([...expandedEntries.value].filter(id => data.items.some(entry => entry.id === id)))
    if (!settings.value || replaceSettings || !dirty.value) adopt(data.settings)
    const last = Math.max(1, Math.ceil(data.totalElements / pageSize))
    if (page.value > last) { page.value = last; await load() }
  } catch (value) { if (seq === epoch) failure(value) }
  finally { if (active && seq === epoch) loading.value = false }
}
async function loadPins() {
  const seq = ++pinEpoch
  pinsLoading.value = true; pinError.value = ''
  try {
    const value = await songCache.pins(pinPage.value - 1, pageSize)
    if (!active || seq !== pinEpoch || !value) return
    pins.value = value
    const last = Math.max(1, Math.ceil(value.totalElements / pageSize))
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
  if (!settings.value || busy.value || loading.value || runningJob.value || !dirty.value || conflict.value || validation.value) return
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
  if (entry.target.mode === 'REMUX') return '重封装'
  if (entry.target.mode === 'AUDIO_TRANSCODE' || entry.mediaType === 'AUDIO') return 'AAC'
  return `${(entry.target.codec || 'h264').toUpperCase()} · ≤ ${entry.target.width || '—'} × ${entry.target.height || '—'}`
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
    <p v-if="error" role="alert" class="cache-feedback cache-error">{{ error }}</p>
    <p v-if="notice" role="status" class="cache-feedback cache-success">{{ notice }}</p>

    <template v-if="result">
      <div class="cache-overview sv-glass">
        <section class="cache-storage" aria-labelledby="cache-storage-title">
          <header class="cache-summary-heading">
            <h2 id="cache-storage-title">缓存占用</h2>
            <ElButton
              text class="cache-icon-button" :icon="RefreshRight" :loading="loading" :disabled="busy"
              aria-label="刷新列表" title="刷新列表" @click="load()"
            />
          </header>
          <p class="cache-storage-number">
            <strong v-if="usagePending" role="status">正在计算…</strong>
            <strong v-else>{{ bytes(result.usageBytes) }}</strong>
            <span>/ {{ bytes(result.settings.maxBytes) }}</span>
          </p>
          <progress :value="usagePending ? undefined : usedPercent" max="100" aria-label="缓存容量使用比例" />
          <div class="cache-capacity-meta">
            <span v-if="!usagePending && result.settings.maxBytes > 0">已用 {{ usageRatio }}%</span>
            <span v-if="!usagePending">剩余 {{ bytes(remainingBytes) }}</span>
            <span v-if="(result.reservedBytes ?? 0) > 0">预留 {{ bytes(result.reservedBytes ?? 0) }}</span>
          </div>
        </section>

        <section class="cache-policy" aria-labelledby="cache-policy-title">
          <header class="cache-summary-heading cache-policy-heading">
            <h2 id="cache-policy-title">回收策略</h2>
            <p class="cache-policy-value">{{ policyLabel(result.settings.policy) }}</p>
            <ElButton
              text class="cache-settings-toggle" :disabled="busy"
              :aria-expanded="settingsExpanded" aria-controls="cache-settings" @click="toggleSettings"
            >
              缓存设置
              <ElIcon class="cache-chevron" aria-hidden="true"><ArrowDown /></ElIcon>
            </ElButton>
          </header>
          <div class="cache-actions">
            <ElButton
              type="primary" :disabled="cleanupDisabled || !!policyDisabledReason"
              :title="policyDisabledReason || undefined" @click="clear('POLICY')"
            >按策略回收</ElButton>
            <ElButton type="danger" plain :disabled="cleanupDisabled" @click="clear('CLEAR')">清理缓存</ElButton>
          </div>
          <p v-if="!usagePending && statisticsPending" class="cache-statistics-status" role="status">正在准备播放评分统计…</p>
        </section>

        <form
          v-if="settings" v-show="settingsExpanded" id="cache-settings" class="cache-settings"
          aria-label="缓存设置" novalidate @submit.prevent="save"
        >
          <div class="cache-fields">
            <div class="cache-field">
              <label for="cache-capacity">容量上限（GiB）</label>
              <input
                id="cache-capacity" v-model="draft.capacityGiB" type="number" min="0.0625" max="1048576" step="any" required
                :aria-invalid="dirty && capacityInvalid"
                :aria-describedby="dirty && capacityInvalid ? 'cache-settings-validation' : undefined"
                :disabled="busy || loading"
              />
            </div>
            <div class="cache-field">
              <label for="cache-policy-select">回收策略</label>
              <select id="cache-policy-select" v-model="draft.policy" :disabled="busy || loading">
                <option v-for="policy in policies" :key="policy.value" :value="policy.value">{{ policy.label }}</option>
              </select>
            </div>
            <div class="cache-field">
              <label for="cache-high-watermark">触发水位（%）</label>
              <input
                id="cache-high-watermark" v-model="draft.high" type="number" min="2" max="100" step="1" required
                :aria-invalid="dirty && !capacityInvalid && !!validation"
                :aria-describedby="dirty && !capacityInvalid && validation ? 'cache-settings-validation' : undefined"
                :disabled="busy || loading || runningJob"
              />
            </div>
            <div class="cache-field">
              <label for="cache-low-watermark">目标水位（%）</label>
              <input
                id="cache-low-watermark" v-model="draft.low" type="number" min="1" max="99" step="1" required
                :aria-invalid="dirty && !capacityInvalid && !!validation"
                :aria-describedby="dirty && !capacityInvalid && validation ? 'cache-settings-validation' : undefined"
                :disabled="busy || loading || runningJob"
              />
            </div>
          </div>
          <div class="cache-settings-footer">
            <p v-if="dirty && validation" id="cache-settings-validation" class="cache-validation" role="alert">{{ validation }}</p>
            <div class="cache-actions">
              <ElButton :disabled="busy || loading" @click="reloadSettings">重新读取设置</ElButton>
              <ElButton v-if="dirty" :disabled="busy || loading" @click="discardSettings">放弃修改</ElButton>
              <ElButton
                type="primary" native-type="submit" :loading="busy"
                :disabled="loading || runningJob || !dirty || !!validation || conflict"
              >保存设置</ElButton>
            </div>
          </div>
        </form>
      </div>

      <section v-if="job || jobError" class="cache-job sv-glass" aria-label="缓存清理任务">
        <div class="cache-job-summary">
          <div role="status">
            <h2>{{ job ? jobStates[job.state] || job.state : '读取清理任务' }}</h2>
            <p v-if="job">已清理 {{ job.removed }} 份缓存，释放 {{ bytes(job.freedBytes) }}，跳过 {{ job.skipped }} 份，失败 {{ job.failed }} 份。</p>
          </div>
          <div v-if="job" class="cache-actions">
            <ElButton v-if="runningJob" :disabled="busy || job.state === 'CANCELLING'" @click="cancelJob">取消清理</ElButton>
            <ElButton
              text :aria-expanded="jobDetailsExpanded" aria-controls="cache-job-details"
              @click="jobDetailsExpanded = !jobDetailsExpanded"
            >
              任务详情
              <ElIcon class="cache-chevron" aria-hidden="true"><ArrowDown /></ElIcon>
            </ElButton>
          </div>
        </div>
        <p v-if="jobError" role="alert" class="cache-error">
          {{ jobError }}
          <ElButton text @click="pollJob()">重试读取进度</ElButton>
        </p>
        <p v-if="job?.spaceInsufficient" role="alert" class="cache-error">清理后空间仍不足，还需 {{ bytes(job.shortfallBytes) }}。</p>
        <div v-if="job" v-show="jobDetailsExpanded" id="cache-job-details" class="cache-job-details">
          <p>占用 {{ bytes(job.usageBeforeBytes) }} → {{ bytes(job.usageAfterBytes) }}，目标 {{ bytes(job.targetBytes) }}</p>
          <p v-if="!job.spaceInsufficient && !runningJob && !job.targetReached">未达到目标水位，当前仍有可用缓存空间。</p>
          <ul v-if="Object.keys(job.skippedByReason ?? {}).length" class="cache-job-reasons">
            <li v-for="(count, reason) in job.skippedByReason" :key="reason">{{ reasons[reason] || reason }}：{{ count }} 份</li>
          </ul>
          <ul v-if="job.errors?.length" class="cache-error">
            <li v-for="(item, index) in job.errors" :key="index">{{ jobFailure(item) }}</li>
          </ul>
        </div>
      </section>

      <section class="cache-workspace sv-glass" aria-label="缓存管理">
        <header class="cache-workspace-toolbar">
          <div class="cache-tabs" role="tablist" aria-label="缓存管理视图">
            <button
              id="cache-list-tab" ref="cacheTab" type="button" role="tab" aria-labelledby="cache-list-label"
              :aria-selected="activeView === 'cache'" :tabindex="activeView === 'cache' ? 0 : -1"
              aria-controls="cache-list-panel" aria-describedby="cache-list-count"
              @click="changeView('cache')" @keydown="tabKeydown"
            >
              <span id="cache-list-label">缓存明细</span>
              <span id="cache-list-count" class="cache-tab-count">{{ result.totalElements }}<span class="sr-only"> 份</span></span>
            </button>
            <button
              id="cache-pins-tab" ref="pinsTab" type="button" role="tab" aria-labelledby="cache-pins-label"
              :aria-selected="activeView === 'pins'" :tabindex="activeView === 'pins' ? 0 : -1"
              aria-controls="cache-pins-panel" :aria-describedby="pins ? 'cache-pins-count' : undefined"
              @click="changeView('pins')" @keydown="tabKeydown"
            >
              <span id="cache-pins-label">固定歌曲</span>
              <span v-if="pins" id="cache-pins-count" class="cache-tab-count">{{ pins.totalElements }}<span class="sr-only"> 首</span></span>
            </button>
          </div>
          <div class="cache-filters">
            <label class="cache-search">
              <ElIcon aria-hidden="true"><Search /></ElIcon>
              <input
                v-model="keyword" type="search" :aria-label="searchLabel" placeholder="搜索本页" maxlength="200"
                :aria-controls="activeView === 'cache' ? 'cache-list-panel' : 'cache-pins-panel'"
                :disabled="activeView === 'cache' ? loading : pinsLoading"
              />
            </label>
            <select
              v-if="activeView === 'cache'" v-model="typeFilter" aria-label="筛选当前页缓存类型"
              aria-controls="cache-list-panel" :disabled="loading"
            >
              <option value="ALL">全部类型</option>
              <option value="ORIGINAL">原片</option>
              <option value="COMPATIBLE">兼容缓存</option>
            </select>
            <ElButton
              v-else text class="cache-icon-button" :icon="RefreshRight" :disabled="pinsLoading || busy"
              aria-label="刷新固定歌曲" title="刷新固定歌曲" @click="loadPins"
            />
          </div>
        </header>

        <section
          v-show="activeView === 'cache'" id="cache-list-panel" role="tabpanel"
          aria-labelledby="cache-list-tab" :aria-busy="loading"
        >
          <p v-if="loading" class="cache-loading" role="status">正在读取缓存…</p>
          <div v-else-if="!result.items.length" class="cache-empty">暂无歌曲缓存</div>
          <div v-else-if="!filteredEntries.length" class="cache-empty">
            <p>当前页没有匹配的缓存</p>
            <ElButton @click="resetFilters">重置筛选</ElButton>
          </div>
          <table v-else class="cache-table" role="table" aria-label="歌曲缓存副本">
            <thead role="rowgroup">
              <tr role="row">
                <th scope="col" role="columnheader">歌曲</th>
                <th scope="col" role="columnheader" class="cache-format-heading">缓存版本</th>
                <th scope="col" role="columnheader" class="cache-size-heading">占用</th>
                <th scope="col" role="columnheader" class="cache-protection-heading">保护</th>
                <th scope="col" role="columnheader" class="cache-access">最近访问</th>
                <th scope="col" role="columnheader" class="cache-actions-heading">操作</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              <template v-for="entry in filteredEntries" :key="entry.id">
                <tr class="cache-row" role="row" :data-cache-id="entry.id" :data-song-id="entry.songId">
                  <th scope="row" role="rowheader" class="cache-song-cell">
                    <div class="cache-song">
                      <SongCover class="cache-song-cover" :song-id="entry.songId" :title="entry.title" aria-hidden="true" />
                      <button
                        type="button" class="cache-song-open" :aria-label="'查看' + (entry.title || '未命名歌曲') + '的缓存详情'"
                        :aria-describedby="entry.artist || entry.songId ? 'cache-artist-' + entry.id : undefined"
                        :aria-expanded="expandedEntries.has(entry.id)" :aria-controls="'cache-detail-' + entry.id"
                        @click="toggleDetails(entry.id)"
                      >
                        <strong>{{ entry.title || '未命名歌曲' }}</strong>
                        <span v-if="entry.artist || entry.songId" :id="'cache-artist-' + entry.id">{{ entry.artist || entry.songId }}</span>
                        <ElIcon class="cache-chevron" aria-hidden="true"><ArrowDown /></ElIcon>
                      </button>
                    </div>
                  </th>
                  <td class="cache-format" role="cell">
                    {{ entry.target.mode === 'ORIGINAL' ? '原片' : '兼容缓存' }} · {{ entry.mediaType === 'AUDIO' ? '音频' : '视频' }}
                    <small v-if="entry.target.mode !== 'ORIGINAL'">{{ shortFormat(entry) }}</small>
                  </td>
                  <td class="cache-size" role="cell">
                    {{ bytes(entry.bytes) }}
                    <small v-if="completeness(entry).startsWith('部分')" class="cache-partial">{{ completeness(entry) }}</small>
                    <small v-if="(entry.residueBytes ?? 0) > 0">另有残留占用 {{ bytes(entry.residueBytes ?? 0) }}</small>
                  </td>
                  <td class="cache-protections" role="cell">
                    <span v-if="entry.pinned && !entry.protectionReasons?.includes('PINNED')" class="is-pinned">固定保护</span>
                    <span
                      v-for="(reason, index) in protections(entry)" :key="reason"
                      :class="entry.protectionReasons?.[index] === 'PINNED' ? 'is-pinned' : 'is-active'"
                    >{{ reason }}</span>
                    <span v-if="!entry.protectionReasons?.length && !entry.pinned" :class="{ 'is-active': entry.leased || entry.state === 'DELETING' }">
                      {{ entry.state === 'DELETING' ? '正在删除' : entry.leased ? '正在使用' : '可回收' }}
                    </span>
                  </td>
                  <td class="cache-access" role="cell">
                    <time :datetime="entry.lastAccessAt" :title="date(entry.lastAccessAt)">{{ shortDate(entry.lastAccessAt) }}</time>
                  </td>
                  <td class="cache-actions-cell" role="cell">
                    <div class="cache-row-actions">
                      <ElButton
                        v-if="entry.songId" text class="cache-icon-button cache-pin-button" :class="{ 'is-pinned': entry.pinned }"
                        :icon="CollectionTag" :disabled="busy || loading || entry.state === 'DELETING'"
                        :aria-pressed="!!entry.pinned" :aria-label="'固定' + (entry.title || '未命名歌曲') + '的缓存'"
                        :title="entry.pinned ? '取消整首歌的固定' : '固定此歌曲的全部缓存'" @click="togglePin(entry)"
                      />
                      <ElButton
                        text type="danger" class="cache-icon-button cache-delete-button" :icon="Delete"
                        :disabled="deletionBlocked(entry) || busy || loading || runningJob || statisticsPending"
                        :aria-label="'删除' + (entry.title || '未命名歌曲') + '的缓存'"
                        :title="deletionBlocked(entry) ? '固定或使用中的缓存暂不能删除' : entry.protectionReasons?.includes('RECENT_PLAY') ? '单份删除需确认覆盖近期保护' : '删除这一份缓存'"
                        @click="remove(entry)"
                      />
                    </div>
                  </td>
                </tr>
                <tr v-show="expandedEntries.has(entry.id)" class="cache-detail-row" role="row">
                  <td colspan="6" role="cell">
                    <div
                      :id="'cache-detail-' + entry.id" class="cache-entry-details" role="region"
                      :aria-label="(entry.title || '未命名歌曲') + '的缓存详情'"
                    >
                      <dl>
                        <div>
                          <dt>缓存规格</dt>
                          <dd>{{ format(entry) }}</dd>
                        </div>
                        <div>
                          <dt>使用记录</dt>
                          <dd>命中 {{ entry.hits }} 次<br />最近访问 {{ date(entry.lastAccessAt) }}<br />生成于 {{ date(entry.createdAt) }}</dd>
                        </div>
                        <div>
                          <dt>播放与评分</dt>
                          <dd>
                            <span v-if="entry.lifecycle">{{ lifecycles[entry.lifecycle] || entry.lifecycle }} / </span>近 7 天有效 {{ entry.playCount7d ?? 0 }} 次<span v-if="entry.lifecycle"> / 综合 {{ score(entry.score) }}</span><br />
                            <template v-if="entry.H !== undefined">
                              H {{ score(entry.H) }} / R {{ score(entry.R) }} / F {{ score(entry.F) }} / 保留优先级 {{ score(entry.priority) }}<br />
                            </template>
                            实际播放于 {{ date(entry.lastPlayedAt) }}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
          <div v-if="result.totalElements" v-show="result.totalElements > pageSize || filteringEntries" class="cache-list-footer">
            <span v-if="filteringEntries">本页 {{ filteredEntries.length }} / {{ result.items.length }} 份</span>
            <ElPagination
              :current-page="page" :page-size="pageSize" :total="result.totalElements" :pager-count="5"
              :disabled="busy || loading" hide-on-single-page layout="prev, pager, next"
              @current-change="value => { page = value; load() }"
            />
          </div>
        </section>

        <section
          v-show="activeView === 'pins'" id="cache-pins-panel" role="tabpanel"
          aria-labelledby="cache-pins-tab" :aria-busy="pinsLoading"
        >
          <p v-if="pinError" role="alert" class="cache-feedback cache-error">
            {{ pinError }}
            <ElButton text :disabled="busy || pinsLoading" @click="loadPins">重试读取固定</ElButton>
          </p>
          <p v-else-if="pinsLoading" class="cache-loading" role="status">正在读取固定歌曲…</p>
          <div v-else-if="!pins?.items.length" class="cache-empty">
            <p>尚未固定歌曲</p>
            <ElButton @click="focusView('cache')">查看缓存明细</ElButton>
          </div>
          <div v-else-if="!filteredPins.length" class="cache-empty">
            <p>当前页没有匹配的固定歌曲</p>
            <ElButton @click="resetFilters">重置筛选</ElButton>
          </div>
          <ul v-else class="cache-pin-list" role="list">
            <li v-for="pin in filteredPins" :key="pin.songId" class="cache-pin-row" :data-pin-song-id="pin.songId">
              <SongCover class="cache-song-cover" :song-id="pin.songId" :title="pin.title" aria-hidden="true" />
              <div class="cache-pin-song">
                <strong>{{ pin.title || pin.songId }}</strong>
                <p v-if="pin.artist">{{ pin.artist }}</p>
              </div>
              <span v-if="pin.hasCache === false" class="cache-no-copy">尚无缓存</span>
              <ElButton :disabled="busy" :aria-label="'取消固定' + (pin.title || pin.songId)" @click="togglePin(pin)">取消固定</ElButton>
            </li>
          </ul>
          <div v-if="pins?.totalElements" v-show="pins.totalElements > pageSize || keyword.trim()" class="cache-list-footer">
            <span v-if="keyword.trim()">本页 {{ filteredPins.length }} / {{ pins.items.length }} 首</span>
            <ElPagination
              :current-page="pinPage" :page-size="pageSize" :total="pins.totalElements" :pager-count="5"
              :disabled="busy || pinsLoading" hide-on-single-page layout="prev, pager, next"
              @current-change="value => { pinPage = value; loadPins() }"
            />
          </div>
        </section>
      </section>
    </template>

    <p v-else-if="loading" role="status" class="cache-loading">正在读取缓存…</p>
    <section v-else class="cache-unavailable sv-glass">
      <h2>暂时无法读取歌曲缓存</h2>
      <ElButton @click="load()">重试</ElButton>
    </section>

    <ElDialog v-model="recentOpen" title="覆盖近期保护并删除？" width="min(460px, calc(100vw - 32px))" align-center class="cache-recent-dialog">
      <template v-if="recentEntry">
        <div class="cache-dialog-song">
          <strong>{{ recentEntry.title || '未命名歌曲' }}</strong>
          <span>{{ recentEntry.artist || recentEntry.songId }}</span>
          <span>{{ format(recentEntry) }} / {{ bytes(recentEntry.bytes) }}</span>
        </div>
        <p class="cache-dialog-warning">这份缓存近 24 小时内播放过。原始歌曲与离线兼容版本会保留。</p>
        <ElCheckbox v-model="recentConfirmed" class="cache-recent-checkbox">我确认覆盖近期播放保护，只删除这一份缓存</ElCheckbox>
      </template>
      <template #footer>
        <div class="cache-recent-actions">
          <ElButton @click="recentOpen = false">保留缓存</ElButton>
          <ElButton type="danger" :disabled="!recentConfirmed || busy || loading || runningJob || statisticsPending" @click="confirmRecentDelete">
            覆盖保护并删除
          </ElButton>
        </div>
      </template>
    </ElDialog>
  </section>
</template>

<style scoped src="./song-cache-workspace.css"></style>
