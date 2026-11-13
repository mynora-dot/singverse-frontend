<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElButton, ElDrawer, ElInput, ElPagination } from 'element-plus'
import { ArrowDown, InfoFilled, Refresh, Search } from '@element-plus/icons-vue'
import PageHeader from '../../shared/ui/PageHeader.vue'
import SongCover from '../song-management/components/SongCover.vue'
import PlaybackEntryList from './PlaybackEntryList.vue'
import { playbackHistory, type Page, type Period, type PlaybackEntry, type PlaybackSummary, type PopularSong } from './api'
import { date, duration, versionLabel } from './presentation'

type SongIdentity = Pick<PopularSong, 'songId' | 'title' | 'artists' | 'versionLabel' | 'sourceName'>
type View = 'popular' | 'records'
const periods: { value: Period; label: string }[] = [{ value: '7d', label: '近 7 天' }, { value: '30d', label: '近 30 天' }, { value: 'all', label: '全部时间' }]
const tab = ref<View>('popular'), period = ref<Period>('30d'), query = ref(''), appliedQuery = ref(''), page = ref(1)
const popular = ref<PopularSong[]>([]), records = ref<PlaybackEntry[]>([]), total = ref(0), summary = ref<PlaybackSummary | null>(null)
const loading = ref(false), error = ref(''), rulesOpen = ref(false), coverRevision = ref(0)
const drawerOpen = ref(false), selectedSong = ref<SongIdentity | null>(null)
const detail = ref<Page<PlaybackEntry> | null>(null), detailPage = ref(1), detailLoading = ref(false), detailError = ref('')
let active = true, epoch = 0, detailEpoch = 0
function message(value: unknown) { return value instanceof Error ? value.message : '读取失败，请重试' }
async function load() {
  const seq = ++epoch, selectedTab = tab.value
  loading.value = true; error.value = ''
  const filter = { q: appliedQuery.value, period: period.value }
  try {
    const [stats, result] = await Promise.all([
      playbackHistory.summary(filter),
      selectedTab === 'popular' ? playbackHistory.popular({ ...filter, page: page.value - 1, size: 20 }) : playbackHistory.list({ ...filter, page: page.value - 1, size: 20 }),
    ])
    if (!active || seq !== epoch) return
    summary.value = stats; total.value = result.totalElements
    if (selectedTab === 'popular') popular.value = result.items as PopularSong[]
    else records.value = result.items as PlaybackEntry[]
    const last = Math.max(1, Math.ceil(total.value / 20))
    if (page.value > last) { page.value = last; await load() }
  } catch (value) {
    if (active && seq === epoch) { error.value = message(value); summary.value = null; popular.value = []; records.value = []; total.value = 0 }
  } finally { if (active && seq === epoch) loading.value = false }
}
function search() { appliedQuery.value = query.value.trim(); page.value = 1; void load() }
function resetFilters() { query.value = ''; appliedQuery.value = ''; period.value = '30d'; page.value = 1; void load() }
function refresh() { coverRevision.value++; void load() }
function changePeriod(value: Period) { if (period.value === value) return; period.value = value; page.value = 1; void load() }
function changeTab(value: View) { if (tab.value === value) return; tab.value = value; page.value = 1; void load() }
async function navigateTabs(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  changeTab(event.key === 'Home' ? 'popular' : event.key === 'End' ? 'records' : tab.value === 'popular' ? 'records' : 'popular')
  await nextTick()
  document.getElementById(`history-${tab.value}-tab`)?.focus()
}
async function loadDetail() {
  if (!selectedSong.value) return
  const seq = ++detailEpoch
  detailLoading.value = true; detailError.value = ''
  try {
    const result = await playbackHistory.list({ songId: selectedSong.value.songId, period: 'all', page: detailPage.value - 1, size: 20 })
    if (!active || seq !== detailEpoch) return
    detail.value = result
    const last = Math.max(1, Math.ceil(result.totalElements / 20))
    if (detailPage.value > last) { detailPage.value = last; await loadDetail() }
  } catch (value) { if (active && seq === detailEpoch) { detailError.value = message(value); detail.value = null } }
  finally { if (active && seq === detailEpoch) detailLoading.value = false }
}
function openHistory(song: SongIdentity) { selectedSong.value = { songId: song.songId, title: song.title, artists: song.artists, versionLabel: song.versionLabel, sourceName: song.sourceName }; detailPage.value = 1; detail.value = null; drawerOpen.value = true; void loadDetail() }
function closeHistory() { drawerOpen.value = false; detailEpoch++; detailLoading.value = false }
onMounted(() => { void load() })
onBeforeUnmount(() => { active = false; epoch++; detailEpoch++ })
</script>

<template>
  <section class="playback-history-page">
    <PageHeader title="播放与热门"><template #actions><ElButton :icon="Refresh" :loading="loading" @click="refresh">刷新</ElButton></template></PageHeader>
    <form class="history-filters" @submit.prevent="search">
      <div class="history-search"><ElInput v-model="query" :prefix-icon="Search" placeholder="搜索歌曲或歌手" aria-label="搜索播放记录" maxlength="200" clearable @clear="search" /><ElButton native-type="submit" type="primary" :loading="loading">搜索</ElButton></div>
      <fieldset class="history-periods"><legend class="sr-only">播放统计时间</legend><button v-for="option in periods" :key="option.value" type="button" :aria-pressed="period === option.value" @click="changePeriod(option.value)">{{ option.label }}</button></fieldset>
    </form>
    <dl class="history-stats" aria-label="当前筛选下的播放统计" :aria-busy="loading">
      <div><dt>有效播放</dt><dd>{{ summary && !loading ? summary.effectivePlays.toLocaleString('zh-CN') : '—' }}<small v-if="summary && !loading"> 次</small></dd></div>
      <div><dt>有效播放歌曲</dt><dd>{{ summary && !loading ? summary.playedSongs.toLocaleString('zh-CN') : '—' }}<small v-if="summary && !loading"> 首</small></dd></div>
      <div><dt>全部播放记录</dt><dd>{{ summary && !loading ? summary.totalPlays.toLocaleString('zh-CN') : '—' }}<small v-if="summary && !loading"> 条</small></dd></div>
      <div><dt>实际播放时长</dt><dd class="history-time-stat">{{ summary && !loading ? duration(summary.playedMs) : '—' }}</dd></div>
    </dl>
    <section class="history-results" aria-label="歌曲播放查询结果">
      <div class="history-results-top">
        <div class="history-tabs" role="tablist" aria-label="播放记录视图" @keydown="navigateTabs">
          <button id="history-popular-tab" type="button" role="tab" aria-controls="history-result-panel" :aria-selected="tab === 'popular'" :tabindex="tab === 'popular' ? 0 : -1" @click="changeTab('popular')">热门排行</button>
          <button id="history-records-tab" type="button" role="tab" aria-controls="history-result-panel" :aria-selected="tab === 'records'" :tabindex="tab === 'records' ? 0 : -1" @click="changeTab('records')">播放记录</button>
        </div>
        <p class="history-result-count" role="status" aria-live="polite">{{ loading ? '正在读取…' : error ? '读取失败' : `共 ${total.toLocaleString('zh-CN')} ${tab === 'popular' ? '首歌曲' : '条记录'}` }}</p>
      </div>
      <div class="history-rules">
        <div class="history-rules-line"><InfoFilled aria-hidden="true" /><p>实际播放满 30 秒计入排行，短歌播完也计入。</p><button type="button" :aria-expanded="rulesOpen" aria-controls="history-rules-detail" @click="rulesOpen = !rulesOpen">计入规则<ArrowDown aria-hidden="true" :class="{ expanded: rulesOpen }" /></button></div>
        <p v-if="rulesOpen" id="history-rules-detail">每次累计实际播放满 30 秒，计为 1 次有效播放；不足 30 秒的歌曲实际自然播完也计入。暂停和拖动进度不增加实际播放时长，后台试听不计入热门排行。</p>
      </div>
      <div id="history-result-panel" role="tabpanel" :aria-labelledby="tab === 'popular' ? 'history-popular-tab' : 'history-records-tab'" :aria-busy="loading">
        <p v-if="loading" class="history-empty" role="status">正在读取播放记录…</p>
        <div v-else-if="error" class="history-error" role="alert"><p>{{ error }}</p><ElButton @click="load">重试</ElButton></div>
        <template v-else>
          <div v-if="!total" class="history-empty"><h2>{{ appliedQuery ? '没有找到匹配的播放记录' : tab === 'popular' ? '暂无热门歌曲' : '暂无播放记录' }}</h2><p>{{ appliedQuery ? '试试其他歌名、歌手或统计时间。' : tab === 'popular' ? '这段时间还没有有效播放，切换到播放记录可查看每次播放。' : '播放歌曲后，这里会显示每次播放的设备、时长和结果。' }}</p><ElButton v-if="appliedQuery || period !== '30d'" @click="resetFilters">清除条件</ElButton><ElButton v-else-if="tab === 'popular'" @click="changeTab('records')">查看播放记录</ElButton></div>
          <table v-else-if="tab === 'popular'" class="popular-table" aria-label="热门排行">
            <colgroup><col class="rank-column"><col class="song-column"><col class="context-column"><col class="effective-column"><col class="count-column"><col class="latest-column"><col class="action-column"></colgroup>
            <thead><tr><th scope="col">排名</th><th scope="col">歌曲 / 歌手</th><th scope="col">版本 / 来源</th><th scope="col">有效播放</th><th scope="col">全部 / 自然播完</th><th scope="col">最近播放</th><th scope="col">操作</th></tr></thead>
            <tbody>
              <tr v-for="(song, index) in popular" :key="song.songId" class="popular-row">
                <td class="popular-rank" :class="{ 'top-rank': page === 1 && index < 3 }">{{ (page - 1) * 20 + index + 1 }}</td>
                <td class="popular-identity"><div class="popular-song"><SongCover :key="`${song.songId}-${coverRevision}`" :song-id="song.songId" :title="song.title" /><div class="popular-song-copy"><h3>{{ song.title || '未命名歌曲' }}</h3><p>{{ song.artists.join(' / ') || '未知歌手' }}</p></div></div></td>
                <td class="popular-context"><span>{{ versionLabel(song.versionLabel) }}</span><small>{{ song.sourceName || '来源未记录' }}</small></td>
                <td class="popular-effective"><strong>{{ song.effectivePlayCount.toLocaleString('zh-CN') }}</strong><span class="mobile-label"> 次有效播放</span></td>
                <td class="popular-count"><span>全部 {{ song.playCount.toLocaleString('zh-CN') }} 次</span><small>自然播完 {{ song.completedCount.toLocaleString('zh-CN') }} 次</small></td>
                <td class="popular-latest"><span class="mobile-label">最近播放 </span><time :datetime="song.lastPlayedAt">{{ date(song.lastPlayedAt) }}</time></td>
                <td class="popular-action"><ElButton text type="primary" :aria-label="`查看${song.title}的全部播放历史`" @click="openHistory(song)">播放历史</ElButton></td>
              </tr>
            </tbody>
          </table>
          <PlaybackEntryList v-else :key="coverRevision" :items="records" show-history @history="openHistory" />
        </template>
      </div>
      <div v-if="total && !error && !loading" class="history-results-footer"><p>{{ tab === 'popular' ? '按有效播放次数排序，次数相同时最近播放的在前' : '按开始时间从近到远排列，每次播放单独记录' }}</p><div v-if="total > 20" class="history-pagination"><span class="history-page-indicator">第 {{ page }} / {{ Math.ceil(total / 20) }} 页</span><ElPagination :current-page="page" :total="total" :page-size="20" :pager-count="5" layout="prev, pager, next" @current-change="v => { page = v; load() }" /></div></div>
    </section>
    <ElDrawer v-model="drawerOpen" class="history-drawer" title="全部播放历史" size="min(720px, 100vw)" @close="closeHistory">
      <div v-if="selectedSong" class="history-detail-song"><SongCover :key="selectedSong.songId" :song-id="selectedSong.songId" :title="selectedSong.title" /><div><h2>{{ selectedSong.title || '未命名歌曲' }}</h2><p>{{ selectedSong.artists.join(' / ') || '未知歌手' }}</p><small>{{ versionLabel(selectedSong.versionLabel) }}<template v-if="selectedSong.sourceName"> · {{ selectedSong.sourceName }}</template></small></div></div>
      <p class="history-detail-intro"><span>全部时间，不受搜索和时间筛选影响。</span><span v-if="detail && !detailLoading" class="history-detail-total">共 {{ detail.totalElements }} 条</span></p>
      <p v-if="detailLoading" class="history-empty" role="status">正在读取单曲历史…</p>
      <div v-else-if="detailError" class="history-error" role="alert"><p>{{ detailError }}</p><ElButton @click="loadDetail">重试</ElButton></div>
      <template v-else-if="detail"><PlaybackEntryList v-if="detail.items.length" :items="detail.items" single-song /><p v-else class="history-empty">这首歌曲暂无播放记录。</p><div v-if="detail.totalElements > 20" class="history-pagination history-detail-pagination"><span class="history-page-indicator">第 {{ detailPage }} / {{ Math.ceil(detail.totalElements / 20) }} 页</span><ElPagination :current-page="detailPage" :total="detail.totalElements" :page-size="20" :pager-count="5" layout="prev, pager, next" @current-change="v => { detailPage = v; loadDetail() }" /></div></template>
    </ElDrawer>
  </section>
</template>

<style scoped>
.playback-history-page { display: grid; gap: 14px; }
.playback-history-page > .page-heading { margin: 0; }
.playback-history-page :deep(.el-button) { min-height: 44px; font-size: 14px; }
.history-filters { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 24px; }
.history-search { display: flex; flex: 1 1 320px; max-width: 520px; gap: 8px; }
.history-search :deep(.el-input__wrapper) { min-height: 44px; padding: 0 12px; background: var(--sv-surface-2); }
.history-search :deep(.el-input__inner) { font-size: 14px; }
.history-search :deep(.el-input__clear) { width: 44px; height: 44px; margin-right: -12px; }
.history-periods { display: flex; flex-shrink: 0; padding: 3px; margin: 0; border: 1px solid var(--sv-border-default); border-radius: 8px; background: var(--sv-surface-2); }
.history-periods button { min-width: 94px; min-height: 44px; border: 0; border-radius: 5px; padding: 8px 16px; font: inherit; font-size: 14px; color: var(--sv-text-secondary); background: transparent; cursor: pointer; }
.history-periods button[aria-pressed=true] { color: var(--sv-accent-primary); background: var(--sv-accent-soft); font-weight: 600; }
.history-periods button:hover { color: var(--sv-accent-primary); }
.history-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); align-items: center; margin: 0; padding: 16px 20px; border: 1px solid var(--sv-border-subtle); border-radius: 8px; background: var(--sv-surface-2); }
.history-stats > div { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; min-width: 0; padding-inline: 24px; border-right: 1px solid var(--sv-border-subtle); }
.history-stats > div:first-child { padding-left: 0; }.history-stats > div:last-child { padding-right: 0; border: 0; }
.history-stats dt { font-size: 14px; color: var(--sv-text-secondary); }
.history-stats dd { margin: 0; white-space: nowrap; font-size: 24px; line-height: 1.3; font-weight: 600; font-variant-numeric: tabular-nums; }
.history-stats small { font-size: 12px; color: var(--sv-text-secondary); font-weight: 400; }.history-stats .history-time-stat { font-size: 18px; }
.history-results { min-width: 0; overflow: hidden; border: 1px solid var(--sv-border-subtle); border-radius: 8px; background: var(--sv-surface-2); }
.history-results-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 20px; border-bottom: 1px solid var(--sv-border-subtle); }
.history-tabs { display: flex; gap: 24px; }
.history-tabs button { min-height: 52px; padding: 0; border: 0; border-bottom: 2px solid transparent; background: none; color: var(--sv-text-secondary); font: inherit; font-size: 14px; cursor: pointer; }
.history-tabs button[aria-selected=true] { border-bottom-color: var(--sv-accent-primary); color: var(--sv-accent-primary); font-weight: 600; }
.history-result-count { margin: 0; font-size: 12px; color: var(--sv-text-secondary); white-space: nowrap; }
.history-rules { padding: 0 20px; border-bottom: 1px solid var(--sv-border-subtle); }
.history-rules-line { display: flex; align-items: center; gap: 8px; min-height: 44px; }
.history-rules-line > svg { flex-shrink: 0; width: 14px; height: 14px; color: var(--sv-text-tertiary); }
.history-rules p { margin: 0; font-size: 14px; line-height: 1.7; color: var(--sv-text-secondary); }
.history-rules-line button { display: inline-flex; flex-shrink: 0; align-items: center; justify-content: center; gap: 6px; margin-left: auto; min-height: 44px; padding: 0 4px 0 12px; border: 0; background: transparent; color: var(--sv-accent-primary); font: inherit; font-size: 14px; cursor: pointer; }
.history-rules-line button svg { width: 12px; height: 12px; transition: transform .15s; }.history-rules-line button svg.expanded { transform: rotate(180deg); }
#history-rules-detail { padding: 0 0 16px 22px; }
.popular-table { width: 100%; border-collapse: collapse; table-layout: fixed; text-align: left; }
.rank-column { width: 60px; }.song-column { width: auto; }.context-column { width: 17%; }.effective-column { width: 11%; }.count-column { width: 15%; }.latest-column { width: 15%; }.action-column { width: 112px; }
.popular-table th { padding: 10px 12px; background: var(--sv-surface-1); font-size: 12px; font-weight: 400; color: var(--sv-text-secondary); }.popular-table th:first-child { padding-left: 20px; }
.popular-table td { padding: 12px; border-top: 1px solid var(--sv-border-subtle); vertical-align: middle; font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
.popular-table .popular-rank { padding-left: 20px; font-size: 18px; color: var(--sv-text-tertiary); font-variant-numeric: tabular-nums; white-space: nowrap; overflow-wrap: normal; }.popular-table .top-rank { color: var(--sv-accent-primary); font-weight: 600; }
.popular-song { display: flex; gap: 12px; align-items: center; min-width: 0; }.popular-song-copy { min-width: 0; }
.popular-song h3 { margin: 0; font-size: 16px; line-height: 1.5; font-weight: 600; }.popular-song p { margin: 3px 0 0; color: var(--sv-text-secondary); font-size: 14px; }
.popular-table small { display: block; margin-top: 4px; color: var(--sv-text-secondary); font-size: 12px; }
.popular-context > span, .popular-count > span { display: block; }
.popular-effective strong { font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }.popular-latest { font-variant-numeric: tabular-nums; }
.popular-action .el-button { min-width: 88px; padding: 0 8px; margin: 0; }.mobile-label { display: none; }
.history-results-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 20px; border-top: 1px solid var(--sv-border-subtle); }
.history-results-footer p { margin: 0; color: var(--sv-text-secondary); font-size: 12px; line-height: 1.7; }
.history-pagination { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 12px; }.history-page-indicator { color: var(--sv-text-secondary); font-size: 12px; }
.history-pagination :deep(.el-pagination) { --el-pagination-button-height: 44px; --el-pagination-button-width: 44px; }.history-pagination :deep(.el-pager li) { min-width: 44px; height: 44px; }
.history-empty { padding: 48px 20px; text-align: center; color: var(--sv-text-secondary); font-size: 14px; line-height: 1.8; margin: 0; }.history-empty h2 { margin: 0 0 8px; color: var(--sv-text-primary); font-size: 18px; font-weight: 600; }.history-empty p { margin: 0 0 20px; }
.history-error { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 24px 20px; background: var(--sv-semantic-danger-soft); color: var(--sv-semantic-danger); font-size: 14px; }.history-error p { flex: 1; margin: 0; line-height: 1.7; }
.history-detail-song { display: flex; align-items: center; gap: 16px; padding-bottom: 20px; }.history-detail-song > div { min-width: 0; overflow-wrap: anywhere; }.history-detail-song :deep(.song-cover) { width: 64px; height: 64px; }
.history-detail-song h2 { margin: 0; font-size: 20px; line-height: 1.5; font-weight: 600; }.history-detail-song p { margin: 4px 0; color: var(--sv-text-secondary); font-size: 14px; }.history-detail-song small { color: var(--sv-text-secondary); font-size: 12px; }
.history-detail-intro { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 12px; margin: 0; padding: 16px 0; border-top: 1px solid var(--sv-border-subtle); border-bottom: 1px solid var(--sv-border-subtle); color: var(--sv-text-secondary); font-size: 14px; line-height: 1.7; }.history-detail-total { white-space: nowrap; }.history-detail-pagination { margin-top: 20px; }
:deep(.history-drawer .el-drawer__header) { padding: 16px 24px; margin-bottom: 0; border-bottom: 1px solid var(--sv-border-subtle); color: var(--sv-text-primary); }:deep(.history-drawer .el-drawer__title) { font-size: 18px; font-weight: 600; }:deep(.history-drawer .el-drawer__close-btn) { width: 44px; height: 44px; padding: 10px; }:deep(.history-drawer .el-drawer__body) { padding: 24px; }
button:focus-visible { outline: 2px solid var(--sv-accent-primary); outline-offset: 3px; }
@media (max-width: 1150px) {
  .history-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 24px; }.history-stats > div { padding: 0; border: 0; }.history-stats > div:nth-child(odd) { padding-right: 24px; border-right: 1px solid var(--sv-border-subtle); }
  .popular-table colgroup, .popular-table thead { display: none; }.popular-table, .popular-table tbody { display: block; }
  .popular-row { display: grid; grid-template-columns: 28px minmax(0, 1fr) minmax(108px, .6fr) 100px; align-items: center; gap: 8px 16px; padding: 16px 20px; border-bottom: 1px solid var(--sv-border-subtle); }
  .popular-table td { padding: 0; border: 0; }.popular-table .popular-rank { padding: 0; grid-column: 1; grid-row: 1; }.popular-identity { grid-column: 2; grid-row: 1; }.popular-context { grid-column: 3; grid-row: 1; }.popular-effective { grid-column: 4; grid-row: 1; }
  .popular-count { grid-column: 2; grid-row: 2; display: flex; flex-wrap: wrap; gap: 4px 12px; }.popular-table .popular-count small { margin: 0; font-size: 14px; }.popular-latest { grid-column: 2 / 4; grid-row: 3; color: var(--sv-text-secondary); }.popular-action { grid-column: 4; grid-row: 2 / 4; justify-self: end; }
  .popular-effective .mobile-label { display: block; font-size: 12px; color: var(--sv-text-secondary); }.popular-latest .mobile-label { display: inline; font-size: 12px; }
}
@media (max-width: 580px) {
  .history-search { flex-basis: 100%; max-width: none; }.history-search :deep(.el-input__inner) { font-size: 16px; }.history-periods { flex: 1; }.history-periods button { flex: 1; min-width: 0; padding: 8px; }
  .history-stats { padding: 16px; gap: 16px 12px; }.history-stats > div { gap: 6px; }.history-stats > div:nth-child(odd) { padding-right: 12px; }.history-stats dt { font-size: 12px; }.history-stats dd { font-size: 20px; }.history-stats .history-time-stat { font-size: 14px; }
  .history-results-top { padding: 0 16px; gap: 8px; }.history-tabs { gap: 20px; }.history-tabs button { font-size: 16px; }.history-result-count { font-size: 12px; }
  .history-rules { padding-inline: 16px; }.history-rules-line { min-height: 72px; padding-block: 8px; }.history-rules-line > svg { align-self: start; margin-top: 6px; }.history-rules-line p { flex: 1; min-width: 0; }.history-rules-line button { margin: 0; padding: 0; }#history-rules-detail { padding-left: 22px; }
  .popular-row { grid-template-columns: 32px minmax(0, 1fr) 88px; gap: 4px 8px; padding: 16px 16px 12px; }.popular-table .popular-rank { align-self: start; margin-top: 12px; font-size: 14px; text-align: right; }.popular-identity { grid-column: 2 / -1; }.popular-table .popular-context { grid-column: 2 / -1; grid-row: 2; display: flex; flex-wrap: wrap; gap: 0 8px; font-size: 12px; }.popular-table .popular-context small { margin: 0; }
  .popular-effective { grid-column: 2; grid-row: 3; }.popular-effective .mobile-label { display: inline; }.popular-count { grid-column: 2 / -1; grid-row: 4; }.popular-table .popular-count, .popular-table .popular-count small { font-size: 14px; }.popular-action { grid-column: 3; grid-row: 3; }.popular-table .popular-latest { grid-column: 2 / -1; grid-row: 5; font-size: 14px; }
  .history-results-footer { padding: 16px; }.history-pagination { justify-content: space-between; width: 100%; }.history-pagination :deep(.el-pager) { display: none; }.history-pagination :deep(.el-pagination) { gap: 8px; }.history-empty { padding: 40px 16px; }
  :deep(.history-drawer .el-drawer__header) { padding: 12px 16px; }:deep(.history-drawer .el-drawer__body) { padding: 20px 16px; }
}
@media (max-width: 360px) {
  .history-stats { align-items: start; }
  .history-stats > div { display: grid; justify-content: start; gap: 4px; }
  .history-stats dt { white-space: nowrap; }
  .history-stats .history-time-stat { white-space: normal; }
}
@media (prefers-reduced-motion: reduce) { .history-rules-line button svg { transition: none; } }
</style>
