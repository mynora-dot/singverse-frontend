<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElAlert, ElButton, ElEmpty, ElMessageBox, ElTag } from 'element-plus'
import TrackArtwork from './TrackArtwork.vue'
import PlatformBadge from './PlatformBadge.vue'
import { navigateRadios } from './radio-navigation'
import { active, bytes, lx, message, qualities, stateNames, type Batch, type Item, type Status } from './api'
const props = defineProps<{ visible: boolean; status: Status | null }>()
const emit = defineEmits<{ changed: [] }>()
const route = useRoute(), router = useRouter()
const batches = ref<Batch[]>([]), total = ref(0), page = ref(0), loading = ref(false), error = ref(''), selected = ref<Batch | null>(null)
const items = ref<Item[]>([]), itemPage = ref(0), itemTotal = ref(0), itemError = ref(''), actionError = ref(''), busy = ref(''), itemLoading = ref(false)
const filter = ref('all')
const filters = [{ id: 'all', label: '全部' }, { id: 'active', label: '进行中' }, { id: 'done', label: '已完成' }, { id: 'attention', label: '需处理' }]
const matches = (batch: Batch, value: string) => value === 'all' || (value === 'active' ? active(batch.status) : value === 'done' ? batch.status === 'COMPLETED' : !active(batch.status) && batch.status !== 'COMPLETED')
const filtered = computed(() => batches.value.filter(b => matches(b, filter.value)))
const saved = (batch: Batch) => (batch.counts.SUCCESS || 0) + (batch.counts.SKIPPED || 0)
const processing = (batch: Batch) => (batch.counts.RESOLVING || 0) + (batch.counts.DOWNLOADING || 0) + (batch.counts.PUBLISHING || 0)
const needsAttention = (batch: Batch) => (batch.counts.FAILED || 0) + (batch.counts.INTERRUPTED || 0) + (batch.counts.CANCELLED || 0)
const progress = (batch: Batch) => batch.total ? Math.min(100, Math.round(saved(batch) / batch.total * 100)) : 0
const transferProgress = (item: Item) => item.totalBytes && item.totalBytes > 0 ? Math.min(100, Math.floor(item.receivedBytes / item.totalBytes * 100)) : undefined
let alive = true, generation = 0, itemGeneration = 0, timer: ReturnType<typeof setTimeout> | undefined
const detailsElement = ref<HTMLElement>()
const qualityName = (value: string) => value === 'auto' ? '自动音质' : qualities[value] || value
const date = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false })
const retryable = (batch: Batch) => ['FAILED', 'INTERRUPTED', 'CANCELLED'].some(s => (batch.counts[s] || 0) > 0)
function schedule() { clearTimeout(timer); if (alive && !loading.value && !itemLoading.value && !document.hidden && ((props.status?.activeBatches || 0) > 0 || batches.value.some(b => active(b.status)) || (selected.value && active(selected.value.status)) || (props.visible && (error.value || itemError.value)))) timer = setTimeout(() => void refresh(), error.value || itemError.value ? 5000 : props.visible ? 1000 : 2500) }
async function refresh(nextPage = page.value) {
  const token = ++generation; loading.value = true; clearTimeout(timer)
  try {
    const result = await lx.batches(nextPage)
    if (!alive || token !== generation) return
    batches.value = result.items; total.value = result.total; page.value = nextPage; error.value = ''
    const id = typeof route.query.batch === 'string' ? route.query.batch : selected.value?.id
    const current = id ? result.items.find(b => b.id === id) : props.visible ? result.items.find(b => active(b.status)) || result.items[0] : undefined
    if (current) {
      if (selected.value?.id !== current.id) { itemPage.value = 0; items.value = [] }
      selected.value = current
      await details(current.id, itemPage.value, false)
    } else if (id) await details(id, itemPage.value)
    if (alive && token === generation) emit('changed')
  }
  catch (e) { if (alive && token === generation) error.value = message(e) }
  finally { if (alive && token === generation) { loading.value = false; schedule() } }
}
async function details(id: string, nextPage = 0, loadBatch = true) {
  const token = ++itemGeneration; itemLoading.value = true; itemError.value = ''
  try { const [result, batch] = await Promise.all([lx.items(id, nextPage), loadBatch ? lx.batch(id) : Promise.resolve(null)]); if (!alive || token !== itemGeneration) return; items.value = result.items; itemTotal.value = result.total; itemPage.value = nextPage; if (batch) selected.value = batch }
  catch (e) { if (alive && token === itemGeneration) itemError.value = message(e) }
  finally { if (alive && token === itemGeneration) { itemLoading.value = false; schedule() } }
}
async function choose(batch: Batch) { selected.value = batch; itemPage.value = 0; items.value = []; void router.replace({ query: { ...route.query, tab: 'records', batch: batch.id } }); await details(batch.id); await nextTick(); if (alive && selected.value?.id === batch.id) { detailsElement.value?.focus({ preventScroll: true }); detailsElement.value?.scrollIntoView?.({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }) } }
async function action(batch: Batch, type: 'cancel' | 'retry') {
  if (busy.value) return
  const title = type === 'cancel' ? '取消未完成下载' : '重新尝试下载'
  const description = type === 'cancel' ? `取消“${batch.name}”中尚未完成的歌曲？已经下载并入库的歌曲会保留。正在发布完整文件的歌曲会完成入库。` : `重试失败、中断和取消的歌曲。保存到：${props.status?.target.path || '未设置'}；使用音源：${props.status?.activeSource?.name || '未启用'}；音质：${qualities[batch.quality]}。`
  try { await ElMessageBox.confirm(description, title, { confirmButtonText: type === 'cancel' ? '取消下载' : '开始重试', cancelButtonText: '返回', type: type === 'cancel' ? 'warning' : 'info' }) } catch { return }
  busy.value = batch.id; actionError.value = ''
  try { if (type === 'cancel') await lx.cancel(batch.id); else { const result = await lx.retry(batch.id); if (alive) choose(result.batch) } if (alive) await refresh(0) }
  catch (e) { if (alive) actionError.value = message(e) }
  finally { if (alive) busy.value = '' }
}
function visibility() { clearTimeout(timer); if (document.hidden) { generation++; itemGeneration++; loading.value = false; itemLoading.value = false } else void refresh() }
watch(() => props.visible, value => { if (value && !document.hidden) void refresh(); else schedule() })
watch(() => props.status?.activeBatches, schedule)
watch(() => route.query.batch, id => { if (typeof id === 'string' && id !== selected.value?.id) { itemPage.value = 0; items.value = []; void details(id) } })
onMounted(() => { document.addEventListener('visibilitychange', visibility); void refresh() })
onBeforeUnmount(() => { alive = false; generation++; itemGeneration++; clearTimeout(timer); document.removeEventListener('visibilitychange', visibility) })
defineExpose({ refresh })
</script>
<template>
  <section class="records-pane" aria-label="下载记录">
    <div class="toolbar"><div><h2>下载记录</h2><p class="help">离开或刷新页面不会停止下载。完整文件会自动加入曲库。</p></div><ElButton text :loading="loading" @click="refresh()">刷新记录</ElButton></div>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" show-icon role="alert" />
    <ElAlert v-if="actionError" :title="actionError" type="error" :closable="false" show-icon role="alert" />
    <ElEmpty v-if="!batches.length && !loading && !error" description="还没有下载记录，先搜索歌曲或导入歌单。" />
    <div class="record-filters" role="radiogroup" aria-label="下载记录筛选" @keydown="navigateRadios($event, filters.map(f => f.id), filter, value => filter = value)"><button v-for="option in filters" :key="option.id" type="button" role="radio" :aria-checked="filter === option.id" :tabindex="filter === option.id ? 0 : -1" @click="filter = option.id">{{ option.label }}<span>{{ batches.filter(b => matches(b, option.id)).length }}</span></button><span v-if="total > 20" class="page-scope">筛选当前页的 {{ batches.length }} 个批次</span></div>
    <p v-if="batches.length && !filtered.length" class="filtered-empty" role="status">当前页暂无{{ filters.find(f => f.id === filter)?.label }}的下载批次。</p>
    <section v-if="selected || itemError" ref="detailsElement" class="details" aria-label="批次歌曲详情" tabindex="-1">
      <h3>{{ selected?.name || '下载详情' }}</h3><p class="help">保存位置：{{ selected?.path }} · 任务音源版本已固定</p>
      <ElAlert v-if="itemError" :title="itemError" type="error" :closable="false" show-icon role="alert" />
      <p v-if="itemLoading && !items.length" role="status">正在读取歌曲记录…</p>
      <ul class="item-list"><li v-for="item in items" :key="item.id"><div class="item-identity"><TrackArtwork :url="item.track.coverUrl" /><div><strong>{{ item.track.title }}</strong><p class="help">{{ item.track.artists.join(' / ') }} · <PlatformBadge :platform="item.track.platform" /><span v-if="item.resolvedQuality"> · {{ qualities[item.resolvedQuality] }}</span></p></div></div><div class="result"><span role="status">{{ stateNames[item.status] }}</span><a v-if="item.songId && ['SUCCESS', 'SKIPPED'].includes(item.status)" :href="'#/library/songs?detailSongId=' + encodeURIComponent(item.songId)">打开歌曲 ↗</a></div><div v-if="item.status === 'DOWNLOADING'" class="item-progress"><div class="progress-label"><span>{{ bytes(item.receivedBytes) }}<template v-if="item.totalBytes"> / {{ bytes(item.totalBytes) }}</template><template v-else> · 正在接收</template></span><span v-if="transferProgress(item) !== undefined">{{ transferProgress(item) }}%</span></div><div class="progress-track" :class="{ indeterminate: transferProgress(item) === undefined }" role="progressbar" :aria-label="item.track.title + '下载进度'" :aria-valuenow="transferProgress(item)" :aria-valuemin="0" :aria-valuemax="100"><span :style="{ width: transferProgress(item) === undefined ? '35%' : transferProgress(item) + '%' }" /></div></div><p v-if="item.message" class="item-message">{{ item.message }}</p></li></ul>
      <nav v-if="itemTotal > 20 && selected" class="pages" aria-label="批次歌曲分页"><ElButton :disabled="itemPage === 0 || itemLoading" @click="details(selected.id, itemPage - 1, false)">上一页</ElButton><span>第 {{ itemPage + 1 }} 页 · 共 {{ itemTotal }} 首</span><ElButton :disabled="(itemPage + 1) * 20 >= itemTotal || itemLoading" @click="details(selected.id, itemPage + 1, false)">下一页</ElButton></nav>
    </section>
    <article v-for="batch in filtered" :key="batch.id" class="batch" :class="{ selected: selected?.id === batch.id }">
      <div class="batch-main"><span class="batch-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 7h6l2 2h8v10H4zM4 7V5h7l2 2h7v2M12 11v5m-2-2 2 2 2-2" /></svg></span><div class="batch-copy"><div class="batch-title"><ElButton link @click="choose(batch)">{{ batch.name }}</ElButton><ElTag effect="light" :type="batch.status === 'COMPLETED' ? 'success' : needsAttention(batch) ? 'warning' : 'primary'">{{ stateNames[batch.status] || batch.status }}</ElTag></div><p class="help">{{ date(batch.createdAt) }} · {{ batch.total }} 首 · {{ qualityName(batch.quality) }}</p></div><div class="actions"><ElButton @click="choose(batch)">{{ selected?.id === batch.id ? '刷新详情' : '查看歌曲' }}</ElButton><ElButton v-if="active(batch.status)" :loading="busy === batch.id" :disabled="!!busy || batch.status === 'CANCELLING'" @click="action(batch, 'cancel')">取消未完成项目</ElButton><ElButton v-if="retryable(batch)" type="primary" plain :loading="busy === batch.id" :disabled="!!busy || !status?.ready" @click="action(batch, 'retry')">重试未完成歌曲</ElButton></div></div>
      <div class="batch-progress"><div class="progress-label" aria-live="polite"><span>已加入曲库 {{ saved(batch) }} / {{ batch.total }} 首</span><span>{{ progress(batch) }}%</span></div><div class="progress-track" role="progressbar" :aria-label="batch.name + '入库进度'" :aria-valuenow="saved(batch)" :aria-valuemin="0" :aria-valuemax="batch.total"><span :style="{ width: progress(batch) + '%' }" /></div><div class="phases"><span><i :class="{ current: (batch.counts.QUEUED || 0) > 0 }" />排队 {{ batch.counts.QUEUED || 0 }}</span><span><i :class="{ current: processing(batch) > 0 }" />处理中 {{ processing(batch) }}</span><span><i :class="{ complete: saved(batch) > 0 }" />已入库 {{ saved(batch) }}</span></div></div>
      <p v-if="needsAttention(batch)" class="attention">{{ needsAttention(batch) }} 首歌曲未完成。查看歌曲可了解具体原因，已入库的歌曲会保留。</p>
      <details class="batch-meta"><summary>保存位置与任务信息</summary><p class="help">保存到：{{ batch.path }}</p><p class="help">音质：{{ qualityName(batch.quality) }} · 此批次使用提交时的音源版本</p></details>
    </article>
    <nav v-if="total > 20" class="pages" aria-label="下载记录分页"><ElButton :disabled="page === 0 || loading" @click="refresh(page - 1)">上一页</ElButton><span>第 {{ page + 1 }} 页 · 共 {{ total }} 批</span><ElButton :disabled="(page + 1) * 20 >= total || loading" @click="refresh(page + 1)">下一页</ElButton></nav>

  </section>
</template>
<style scoped>
.records-pane{padding:24px 0 16px}.toolbar,.batch-title,.actions,.pages{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.toolbar{justify-content:space-between}.toolbar h2{font-size:17px;font-weight:600;margin:0 0 6px}.toolbar .help{margin:0;font-size:14px}.help{font-size:14px;color:var(--el-text-color-secondary);line-height:1.8;overflow-wrap:anywhere}.record-filters{display:flex;gap:8px;align-items:center;overflow:auto;margin:24px 0 18px;padding-bottom:4px}.record-filters>button{min-height:38px;display:flex;gap:8px;align-items:center;white-space:nowrap;border:1px solid var(--el-border-color-lighter);border-radius:8px;background:var(--el-bg-color);color:var(--el-text-color-regular);padding:0 14px;font-size:14px;cursor:pointer}.record-filters>button>span{font-size:12px;color:var(--el-text-color-secondary)}.record-filters>button[aria-checked=true]{background:var(--el-color-primary-light-9);border-color:var(--el-color-primary-light-5);color:var(--el-color-primary)}button:focus-visible,summary:focus-visible{outline:2px solid var(--el-color-primary);outline-offset:3px}.page-scope{font-size:12px;color:var(--el-text-color-secondary);white-space:nowrap}.batch{border:1px solid var(--el-border-color-lighter);border-radius:12px;margin-top:14px;padding:20px}.batch.selected{border-color:var(--el-color-primary-light-5);background:var(--el-fill-color-lighter)}.batch-main{display:flex;align-items:center;gap:14px}.batch-icon{width:48px;height:48px;border-radius:10px;background:var(--el-color-primary-light-9);color:var(--el-color-primary);display:flex;align-items:center;justify-content:center;flex:none}.batch-icon svg{width:28px;height:28px}.batch-copy{min-width:0;flex:1}.batch-copy .help{margin:6px 0 0;font-size:12px}.batch-title{gap:10px}.batch-title>.el-button{font-size:16px;font-weight:600;white-space:normal;height:auto;text-align:left;line-height:1.6;min-width:0;max-width:100%;color:var(--el-text-color-primary)}.actions{justify-content:flex-end;gap:8px}.actions>.el-button{margin:0;font-size:13px;min-height:38px;border-radius:8px}.batch-progress{margin:20px 0 0 62px}.progress-label{display:flex;justify-content:space-between;gap:12px;font-size:12px;color:var(--el-text-color-secondary);font-variant-numeric:tabular-nums}.progress-track{height:5px;background:var(--el-fill-color);border-radius:4px;overflow:hidden;margin:10px 0 14px}.progress-track>span{display:block;height:100%;background:var(--el-color-primary);border-radius:4px;transition:width .2s ease}.phases{display:flex;align-items:center;gap:28px;font-size:12px;color:var(--el-text-color-secondary)}.phases i{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--el-border-color);margin-right:7px;vertical-align:1px}.phases i.current{background:var(--el-color-primary)}.phases i.complete{background:var(--el-color-success)}.attention{margin:18px 0 0 62px;font-size:14px;line-height:1.8;color:var(--el-color-warning-dark-2)}.batch-meta{margin:18px 0 0 62px;border-top:1px solid var(--el-border-color-lighter);padding-top:12px}.batch-meta summary{cursor:pointer;font-size:12px;color:var(--el-text-color-secondary);width:fit-content;min-height:28px;align-content:center}.batch-meta .help{font-size:12px;margin:6px 0}.filtered-empty{text-align:center;padding:36px 0;color:var(--el-text-color-secondary);font-size:14px}.pages{justify-content:center;margin:24px 0;font-size:13px}.details{scroll-margin-top:100px;margin-top:28px;padding:22px;border:1px solid var(--el-border-color-lighter);border-radius:12px}.details h3{font-size:16px;margin:0}.details>.help{font-size:12px}.item-list{list-style:none;margin:0;padding:0}.item-list>li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 16px;padding:18px 0;border-bottom:1px solid var(--el-border-color-lighter)}.item-list>li:last-child{border:0}.item-identity{display:flex;align-items:center;gap:14px;min-width:0}.item-identity>div{min-width:0}.item-list strong{overflow-wrap:anywhere;font-size:14px}.item-list p{margin:6px 0}.item-list .help{font-size:12px}.result{display:flex;flex-direction:column;align-items:flex-end;gap:8px;font-size:13px}.result>a{color:var(--el-color-primary)}.item-message{grid-column:1/-1;font-size:14px;color:var(--el-color-warning-dark-2);overflow-wrap:anywhere;line-height:1.8}
@media(max-width:1000px){.batch-main{flex-wrap:wrap}.batch-copy{flex-basis:calc(100% - 62px)}.actions{margin-left:62px;justify-content:flex-start}.batch-progress{margin-top:18px}}
@media(max-width:700px){.records-pane{padding-top:20px}.toolbar{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px}.toolbar>div{display:contents}.toolbar h2{grid-column:1;grid-row:1;margin:0}.toolbar>.el-button{grid-column:2;grid-row:1}.toolbar .help{grid-column:1/-1;grid-row:2}.toolbar .help{font-size:14px}.batch{padding:16px 14px}.batch-icon{width:38px;height:38px}.batch-main{gap:10px}.batch-copy{flex-basis:calc(100% - 48px)}.batch-title{gap:6px}.batch-title>.el-button{font-size:15px}.actions{margin-left:0;width:100%;justify-content:flex-start;flex-wrap:wrap}.actions>.el-button{min-height:44px;padding:0 12px}.record-filters{gap:6px}.record-filters>button{min-height:44px;padding:0 10px;font-size:13px}.batch-progress,.attention,.batch-meta{margin-left:0}.phases{justify-content:space-between;gap:8px}.toolbar>.el-button,.pages>.el-button,.result>a{min-height:44px}.result>a{display:inline-flex;align-items:center}.batch-meta summary{min-height:44px}.details{padding:16px 14px}.item-list>li{grid-template-columns:minmax(0,1fr)}.item-identity{gap:10px}.item-identity :deep(.artwork){width:44px;height:44px}.result{align-items:flex-start;max-width:none;margin-left:54px}.page-scope{display:none}}
.item-progress{grid-column:1/-1;margin:8px 0 0 62px}.item-progress .progress-track{margin-bottom:0}.progress-track.indeterminate>span{animation:download-progress 1.5s ease-in-out infinite}@keyframes download-progress{from{transform:translateX(-100%)}to{transform:translateX(290%)}}
@media(max-width:700px){.item-progress{margin-left:54px}}
@media(prefers-reduced-motion:reduce){.progress-track>span{transition:none;animation:none}}
</style>
