<script setup lang="ts">
import PageHeader from '../../../shared/ui/PageHeader.vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElAlert, ElButton, ElDialog, ElIcon, ElMessage, ElMessageBox, ElPagination } from 'element-plus'
import { ArrowRight, Check, Clock, RefreshRight, Search, Setting, VideoPlay } from '@element-plus/icons-vue'
import { metadata } from '../api/metadata'
import { media, type MediaSource } from '../../media-library/api/media'
import { metadataDefaults, providerNames, itemStatusNames } from '../types'
import type { MetadataBatch, MetadataItem, MetadataSettings } from '../types'
import SingleSongScrapeDialog from '../components/SingleSongScrapeDialog.vue'
import BatchSongTable from '../components/BatchSongTable.vue'
const route = useRoute(), router = useRouter()
const validStatuses = new Set(['', 'APPLIED', ...Object.keys(itemStatusNames)])
function routeStatus(value: unknown) { return typeof value === 'string' && validStatuses.has(value) ? value : '' }
const config = ref<MetadataSettings>({ enabled: false, providers: [], autoApply: false, ...metadataDefaults })
const saved = ref(false), busy = ref(false), loading = ref(false), refreshing = ref(false)
const error = ref(''), progressError = ref(''), lastRefresh = ref('')
const batch = ref<MetadataBatch | null>(null), page = ref(1), filter = ref(routeStatus(route.query.status)), reviewItem = ref<MetadataItem | null>(null)
const keyword = ref(''), appliedKeyword = ref(''), sort = ref('DEFAULT')
const sourceId = ref(''), sources = ref<MediaSource[]>([]), sourcesLoading = ref(false), sourcesError = ref('')
const startOpen = ref(false), startScope = ref<'source' | 'selected'>('source')
const selectedIds = computed(() => typeof route.query.songIds === 'string' ? [...new Set(route.query.songIds.split(',').filter(Boolean))] : [])
const selectionPreview = computed(() => selectedIds.value.length > 0 && typeof route.query.batch !== 'string')
const showPreviousBatch = ref(false)
const showBatch = computed(() => !!batch.value && (!selectionPreview.value || showPreviousBatch.value))
const batchDate = computed(() => batch.value?.createdAt ? new Date(batch.value.createdAt).toLocaleString('zh-CN', { hour12: false }) : '时间未记录')
const activeBatch = computed(() => !!batch.value && ['RUNNING', 'PAUSED'].includes(batch.value.status))
const canStart = computed(() => saved.value && config.value.enabled && !!config.value.providers.length && !activeBatch.value && !busy.value && !loading.value)
const canStartScope = computed(() => canStart.value && (!sourceId.value || sources.value.some(source => source.id === sourceId.value)))
const selectedSourceName = computed(() => sources.value.find(source => source.id === sourceId.value)?.name ?? '')
const startReason = computed(() => !saved.value ? '请先成功读取并保存平台设置' : activeBatch.value ? '已有运行或暂停的批次，请先完成或终止' : !config.value.enabled || !config.value.providers.length ? '请到设置 → 音乐平台启用并选择平台' : '')
const retryReason = computed(() => batch.value?.status === 'CANCELLED' ? '已终止批次不能重试，请新建批次' : !saved.value || !config.value.enabled ? '请到设置 → 音乐平台启用查询' : '')
const percentage = computed(() => batch.value?.total ? Math.min(100, Math.round(batch.value.completed / batch.value.total * 100)) : 0)
const batchNames: Record<string, string> = { RUNNING: '正在匹配', PAUSED: '已暂停', COMPLETED: '匹配完成', CANCELLED: '已终止' }
const primaryStats = computed(() => [
  { status: '', label: '全部', value: batch.value?.total ?? 0 },
  { status: 'REVIEW', label: '待审核', value: batch.value?.review ?? 0 },
  { status: 'APPLIED', label: '已应用', value: batch.value?.applied ?? 0 },
  { status: 'FAILED', label: '失败', value: batch.value?.failed ?? 0 },
])
const extraStats = computed(() => [
  { status: 'PENDING', label: batch.value?.status === 'CANCELLED' ? '终止未处理' : '待处理', value: batch.value?.pending ?? 0 },
  { status: 'PROCESSING', label: '处理中', value: batch.value?.processing ?? 0 },
  { status: 'SKIPPED_EXISTING', label: '已跳过', value: batch.value?.skippedExisting ?? 0 },
  { status: 'AUTO_APPLIED', label: '已自动应用' },
  { status: 'MANUAL_APPLIED', label: '已确认应用' },
])
const extraFilter = computed({ get: () => primaryStats.value.some(stat => stat.status === filter.value) ? '' : filter.value, set: (value: string) => { void selectStatus(value) } })
const settingsSummary = computed(() => config.value.enabled ? config.value.providers.map(provider => providerNames[provider]).join('、') || '尚未选择平台' : '平台查询未启用')
const intervalSummary = computed(() => `${config.value.minIntervalSeconds ?? metadataDefaults.minIntervalSeconds}～${config.value.maxIntervalSeconds ?? metadataDefaults.maxIntervalSeconds} 秒`)
const emptyTitle = computed(() => appliedKeyword.value ? '未找到歌曲' : filter.value === 'REVIEW' ? '当前没有待审核歌曲' : filter.value === 'FAILED' ? '没有匹配失败的歌曲' : '当前状态下没有歌曲')
let active = true, generation = 0, loadGeneration = 0, timer: ReturnType<typeof setTimeout> | undefined
function schedule() {
  if (timer) clearTimeout(timer)
  if (active && !busy.value && !reviewItem.value && batch.value?.status === 'RUNNING') timer = setTimeout(() => { void refreshBatch() }, progressError.value ? 5000 : 2000)
}
function accept(result: MetadataBatch) { batch.value = result; lastRefresh.value = result.observedAt || new Date().toISOString() }
async function refreshBatch() {
  if (!batch.value) return
  const id = batch.value.id, token = ++generation
  refreshing.value = true
  try {
    const result = await metadata.batch(id, page.value - 1, filter.value, appliedKeyword.value, sort.value)
    if (active && token === generation) {
      accept(result); progressError.value = ''
      const max = Math.max(1, Math.ceil(result.totalElements / 20))
      if (page.value > max) { page.value = max; await refreshBatch() }
    }
  } catch (failure) { if (active && token === generation) progressError.value = failure instanceof Error ? failure.message : '读取进度失败' }
  finally { if (active && token === generation) { refreshing.value = false; schedule() } }
}
async function load() {
  const token = ++loadGeneration; generation++; clearTimeout(timer); loading.value = true; error.value = ''; progressError.value = ''
  const id = route.query.batch
  const [settings, latest] = await Promise.allSettled([metadata.settings(), typeof id === 'string' ? metadata.batch(id, 0, filter.value, appliedKeyword.value, sort.value) : metadata.latest()])
  if (!active || token !== loadGeneration) return
  if (settings.status === 'fulfilled') { config.value = settings.value; saved.value = true }
  else { saved.value = false; error.value = settings.reason instanceof Error ? settings.reason.message : '设置读取失败' }
  if (latest.status === 'fulfilled') { batch.value = latest.value ?? null; if (latest.value) { accept(latest.value); if (typeof id !== 'string' && filter.value) await refreshBatch() } }
  else progressError.value = latest.reason instanceof Error ? latest.reason.message : '读取批次失败'
  loading.value = false; schedule()
}
async function loadSources() {
  sourcesLoading.value = true; sourcesError.value = ''
  try {
    const found: MediaSource[] = []
    for (let page = 0; ; page++) {
      const result = await media.list(page, 100)
      if (!active) return
      found.push(...result.items)
      if (found.length >= result.totalElements || !result.items.length) break
    }
    sources.value = found
  } catch (failure) { if (active) sourcesError.value = failure instanceof Error ? failure.message : '读取媒体来源失败' }
  finally { if (active) sourcesLoading.value = false }
}
async function chooseSources() { sourceId.value = ''; await router.replace({ query: { ...route.query, songIds: undefined } }) }
function openStart() { startScope.value = selectedIds.value.length && !sourceId.value ? 'selected' : 'source'; startOpen.value = true }
async function start() {
  const all = startScope.value === 'source'
  if (!canStart.value || (all ? !canStartScope.value : !selectedIds.value.length)) return
  const scopeId = all ? sourceId.value : ''
  await action(async () => { accept(await (scopeId ? metadata.start(true, [], scopeId) : metadata.start(all, all ? [] : selectedIds.value))); page.value = 1; filter.value = ''; keyword.value = ''; appliedKeyword.value = ''; sort.value = 'DEFAULT'; startOpen.value = false; await router.replace({ query: { ...route.query, batch: batch.value!.id, status: undefined, songIds: undefined } }) })
}
async function action(operation: () => Promise<void>) {
  if (busy.value) return
  busy.value = true; error.value = ''; generation++; refreshing.value = false; clearTimeout(timer)
  try { await operation() }
  catch (failure) { if (active) error.value = failure instanceof Error ? failure.message : '操作失败' }
  finally { if (active) { busy.value = false; schedule() } }
}
async function control(kind: 'pause' | 'resume' | 'cancel') {
  if (!batch.value) return
  await action(async () => { accept(await metadata[kind](batch.value!.id)); await refreshBatch(); ElMessage.success(`批次${batchNames[batch.value!.status]}`) })
}
async function retry(itemId: string) {
  if (retryReason.value || !batch.value) return
  if (batch.value.autoApply) { try { await ElMessageBox.confirm('重新匹配不是人工确认，但本批次已启用自动写入；匹配仍遵循本批次快照及当前全局开关/阈值限制。', '重新匹配', { confirmButtonText: '按现有规则匹配', cancelButtonText: '取消' }) } catch { return } }
  await action(async () => { accept(await metadata.retry(batch.value!.id, itemId)); await refreshBatch(); ElMessage.success('已进入等待处理；尚未完成匹配或写入') })
}
async function cancel() {
  try { await ElMessageBox.confirm('终止后，未处理歌曲不再继续，不能恢复或重试本批次；已获取候选保留，已完成的歌曲资料写入不会自动撤销。在途平台请求可能仍需结束。之后可新建批次。', '终止批次', { confirmButtonText: '终止批次', cancelButtonText: '继续处理' }) } catch { return }
  await control('cancel')
}
async function changeFilter() { page.value = 1; await refreshBatch() }
async function selectStatus(status: string) { filter.value = status; page.value = 1; await router.replace({ query: { ...route.query, status: status || undefined } }); await refreshBatch() }
async function searchItems() { appliedKeyword.value = keyword.value.trim(); await changeFilter() }
async function clearSearch() { keyword.value = ''; appliedKeyword.value = ''; await changeFilter() }
async function resetFilters() { keyword.value = ''; appliedKeyword.value = ''; await selectStatus('') }
function openPlatforms() { void router.push({ path: '/system/music-platforms', query: { returnTo: route.fullPath } }) }
function openReview(item: MetadataItem) { reviewItem.value = item; clearTimeout(timer) }
function closeReview() { reviewItem.value = null; schedule() }
async function manual(item: MetadataItem) { await router.push({ path: '/library/songs', query: { lens: 'songs', reviewSongId: item.songId, returnBatch: batch.value!.id } }) }
async function reason(item: MetadataItem) { await ElMessageBox.alert(item.error || (item.status === 'SKIPPED_EXISTING' ? '已有确认歌曲资料且文件未变化，本批次保留原结果。' : item.status === 'AUTO_APPLIED' ? '本批次已按自动写入条件完成应用。具体当前字段可在歌曲详情查看。' : '该项已确认或在查询期间获得确认，已有歌曲资料保留。具体字段可在歌曲详情查看。'), item.status === 'FAILED' ? '失败原因' : '处理结果', { confirmButtonText: '知道了' }).catch(() => {}) }
onMounted(() => { void load(); void loadSources() })
watch(() => route.query.songIds, () => { showPreviousBatch.value = false; if (selectionPreview.value) sourceId.value = '' })
watch(() => route.query.batch, id => { if (id !== batch.value?.id) { page.value = 1; filter.value = routeStatus(route.query.status); appliedKeyword.value = ''; keyword.value = ''; batch.value = null; void load() } })
watch(() => route.query.status, status => { const value = routeStatus(status); if (value !== filter.value) { filter.value = value; page.value = 1; if (batch.value) void refreshBatch() } })
onBeforeUnmount(() => { active = false; generation++; loadGeneration++; clearTimeout(timer) })
</script>

<template>
  <section class="metadata-page management-page">
    <PageHeader title="歌曲信息">
      <template #actions><ElButton type="primary" :icon="VideoPlay" :disabled="!canStart" :title="startReason" @click="openStart">开始匹配</ElButton></template>
    </PageHeader>
    <ElAlert v-if="error && !startOpen" :title="error" type="error" :closable="false" show-icon />
    <ElAlert v-if="progressError" :title="progressError" type="error" :closable="false" show-icon><ElButton text :disabled="busy" @click="batch ? refreshBatch() : load()">重新读取进度</ElButton></ElAlert>
    <div class="source-toolbar">
      <div v-if="selectionPreview" class="source-scope"><span>下一次匹配范围</span><strong>曲库所选 {{ selectedIds.length }} 首歌曲</strong><ElButton text :disabled="busy" @click="chooseSources">改为选择来源</ElButton></div><label v-else class="source-scope"><span>下一次匹配范围</span><select v-model="sourceId" aria-label="匹配歌曲来源" title="用于下一次匹配，不改变当前批次" :disabled="sourcesLoading || busy"><option value="">全部媒体来源</option><option v-for="source in sources" :key="source.id" :value="source.id">{{ source.name }}</option></select></label>
      <ElButton class="platform-entry" text :icon="Setting" :title="`${settingsSummary}，间隔 ${intervalSummary}`" @click="openPlatforms">{{ saved ? config.enabled ? `已启用 ${config.providers.length} 个平台` : '平台未启用' : '音乐平台设置' }}<ElIcon><ArrowRight /></ElIcon></ElButton>
      <span v-if="saved" class="global-apply">全局自动写入 <strong :class="{ enabled: config.autoApply }">{{ config.autoApply ? '已开启' : '已关闭' }}</strong></span>

    </div>
    <p v-if="sourcesError" class="inline-notice" role="alert">媒体来源读取失败：{{ sourcesError }} <ElButton text @click="loadSources">重试</ElButton></p>
    <p v-if="startReason && !loading" class="inline-notice">{{ startReason }} <ElButton v-if="!saved" text @click="load">重新读取配置</ElButton></p>
    <p v-if="loading" role="status" class="loading-note">正在读取配置与进度…</p>

    <section v-if="selectionPreview && !loading" class="selection-preview" aria-label="本次选择">
      <div><h2>已选择 {{ selectedIds.length }} 首歌曲，尚未开始本次匹配</h2></div>
      <ElButton v-if="batch" text :aria-expanded="showPreviousBatch" @click="showPreviousBatch = !showPreviousBatch">{{ showPreviousBatch ? '收起历史批次' : '查看上一次匹配结果' }}</ElButton>
      <RouterLink to="/library/songs">返回曲库重新选择</RouterLink>
    </section>
    <div v-if="showBatch" class="batch-context" :class="{ historical: selectionPreview }"><strong>{{ selectionPreview ? '上一次匹配结果' : '当前查看的匹配批次' }}</strong><span>创建于 {{ batchDate }} · {{ batch?.total }} 首歌曲</span></div>
    <section v-if="showBatch && batch" class="batch-summary" :class="{ complete: batch.status === 'COMPLETED', paused: batch.status === 'PAUSED', cancelled: batch.status === 'CANCELLED' }" aria-label="匹配批次">
      <div class="batch-summary-line">
        <span class="batch-state"><ElIcon><Check v-if="batch.status === 'COMPLETED'" /><Clock v-else /></ElIcon><strong>{{ batchNames[batch.status] || batch.status }}</strong></span>
        <div class="progress-caption"><strong>{{ batch.completed }} / {{ batch.total }}</strong><span>首已处理</span></div>
        <div class="batch-totals"><span><strong>{{ batch.applied }}</strong> 已应用</span><span class="review-total"><strong>{{ batch.review }}</strong> 待审核</span><span v-if="batch.failed" class="failed-total"><strong>{{ batch.failed }}</strong> 失败</span></div>
        <span class="batch-auto-apply">本批次自动写入：<strong>{{ batch.autoApply ? '开启' : '关闭' }}</strong></span>
        <div class="batch-actions">
          <ElButton v-if="batch.status === 'RUNNING'" text :disabled="busy" @click="control('pause')">暂停</ElButton>
          <ElButton v-if="batch.status === 'PAUSED'" text :disabled="busy || !config.enabled || !saved" :title="!config.enabled ? '请在设置 → 音乐平台启用平台查询' : ''" @click="control('resume')">继续</ElButton>
          <ElButton v-if="activeBatch" text :disabled="busy" @click="cancel">终止</ElButton>
          <ElButton class="batch-refresh" text :icon="RefreshRight" :loading="refreshing" :disabled="busy || loading" title="刷新进度" aria-label="刷新进度" @click="refreshBatch" />
        </div>
      </div>
      <div class="batch-progress" role="progressbar" aria-label="歌曲匹配处理进度" :aria-valuenow="percentage" aria-valuemin="0" aria-valuemax="100"><span :style="{ transform: `scaleX(${percentage / 100})` }" /></div>
    </section>
    <p v-if="showBatch && batch?.status === 'CANCELLED'" class="status-notice">批次已终止，未处理歌曲不会继续匹配；已获得的候选与应用结果保留。</p>
    <p v-if="showBatch && batch?.status === 'PAUSED'" class="status-notice">批次已暂停，在途请求可能仍在结束；确认平台及设置后可继续。</p>

    <section v-if="showBatch && batch" class="batch-list-card sv-glass" aria-label="批次歌曲" :aria-busy="refreshing || loading">
      <div class="list-toolbar">
        <div class="status-filters" role="group" aria-label="歌曲处理状态">
          <button v-for="stat in primaryStats" :key="stat.status" type="button" class="status-filter" :class="{ selected: filter === stat.status }" :data-status="stat.status || 'ALL'" :aria-pressed="filter === stat.status" :disabled="busy || loading" @click="selectStatus(stat.status)">{{ stat.label }} <span>{{ stat.value }}</span></button>
          <select v-model="extraFilter" :class="['more-statuses', { 'has-value': extraFilter }]" aria-label="更多歌曲状态" :disabled="busy || loading"><option value="" disabled>更多</option><option v-for="stat in extraStats" :key="stat.status" :value="stat.status">{{ stat.label }}{{ 'value' in stat ? `（${stat.value}）` : '' }}</option></select>
        </div>
        <form class="batch-filter" aria-label="批次歌曲筛选" @submit.prevent="searchItems">
          <div class="keyword-filter"><ElIcon><Search /></ElIcon><input v-model="keyword" type="search" aria-label="搜索批次歌名或歌手" placeholder="原始歌名或歌手" maxlength="200" :disabled="busy || loading" @input="!keyword.trim() && appliedKeyword && clearSearch()" /><button type="submit" :disabled="busy || loading">查询</button></div>
          <select v-model="sort" aria-label="批次排序" :disabled="busy || loading" @change="changeFilter"><option value="DEFAULT">默认顺序</option><option value="TITLE">原始歌名</option><option value="SCORE_DESC">相似度从高到低</option><option value="UPDATED_DESC">最近处理优先</option></select>
        </form>
      </div>
      <p v-if="batch.legacySkipped" class="status-notice">此历史批次有 {{ batch.legacySkipped }} 首跳过项仅保存汇总，计入整体进度；没有原始歌曲明细可供搜索和展示。</p>
      <p v-if="retryReason" class="inline-notice">重新匹配 / 重试不可用：{{ retryReason }}</p>
      <BatchSongTable :batch="batch" :busy="busy || loading" :retry-disabled-reason="retryReason" :empty-title="emptyTitle" @review="openReview" @retry="retry" @manual="manual" @reason="reason" @reset="resetFilters" />
      <div class="list-footer"><span>共 {{ batch.total }} 首歌曲<span v-if="filter || appliedKeyword">，当前筛选 {{ batch.totalElements }} 首</span></span><ElPagination v-if="batch.totalElements > 20" v-model:current-page="page" :total="batch.totalElements" :page-size="20" layout="prev, pager, next" :disabled="busy || loading" @current-change="refreshBatch" /><span v-else>显示 {{ batch.items.length }} 首</span></div>
      <div class="list-note"><RouterLink to="/library/songs">返回全部歌曲</RouterLink></div>
      <details class="batch-explanation"><summary>批次详情</summary><dl class="batch-details"><div><dt>待处理</dt><dd>{{ batch.pending }}</dd></div><div><dt>处理中</dt><dd>{{ batch.processing }}</dd></div><div><dt>已跳过</dt><dd>{{ batch.skippedExisting }}</dd></div><div v-if="lastRefresh"><dt>最近读取</dt><dd>{{ new Date(lastRefresh).toLocaleTimeString() }}</dd></div></dl></details>
    </section>
    <section v-else-if="!selectionPreview && !loading && !progressError" class="metadata-empty"><ElIcon><Search /></ElIcon><h2>暂无匹配批次</h2><ElButton type="primary" :disabled="!canStart" @click="openStart">开始匹配</ElButton><RouterLink to="/library/songs">返回全部歌曲</RouterLink></section>

    <ElDialog v-model="startOpen" title="开始匹配歌曲资料" width="min(480px, calc(100vw - 32px))" :close-on-click-modal="!busy" :close-on-press-escape="!busy" :show-close="!busy" class="metadata-start-dialog">
      <ElAlert v-if="error" :title="error" type="error" :closable="false" show-icon />
      <div class="start-scope-options" role="radiogroup" aria-label="匹配范围"><label><input v-model="startScope" type="radio" value="source" :disabled="busy" /><span><strong>{{ sourceId ? selectedSourceName : '全部媒体来源' }}</strong><small>已有有效确认结果会自动跳过。</small></span></label><label v-if="selectedIds.length && !sourceId"><input v-model="startScope" type="radio" value="selected" :disabled="busy" /><span><strong>从曲库选择的 {{ selectedIds.length }} 首歌曲</strong></span></label></div>
      <p class="start-platforms">查询平台：{{ settingsSummary }}</p><p class="start-write-rule">{{ config.autoApply ? '全局自动写入已开启。最高候选达到有效阈值且无相近候选时才自动写入；同分、相近候选及其他结果等待人工确认。' : '自动写入已关闭。匹配完成后，候选均等待人工审核。' }}</p><p class="start-privacy">查询间隔 {{ intervalSummary }}。歌名与歌手将发送至启用的平台。匹配不会修改媒体文件。</p>
      <template #footer><ElButton :disabled="busy" @click="startOpen = false">取消</ElButton><ElButton type="primary" :loading="busy" :disabled="startScope === 'source' ? !canStartScope : !canStart || !selectedIds.length" @click="start">确认开始匹配</ElButton></template>
    </ElDialog>
    <SingleSongScrapeDialog presentation="drawer" :song-id="reviewItem?.songId ?? null" :initial-candidates="reviewItem?.candidates" :batch-id="batch?.id" :item-id="reviewItem?.id" :auto-select-threshold="batch?.threshold" @close="closeReview" @applied="refreshBatch" />
  </section>
</template>

<style scoped src="./metadata-workspace.css" />
