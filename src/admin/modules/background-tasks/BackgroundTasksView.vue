<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter, type LocationQueryRaw } from 'vue-router'
import { ElAlert, ElButton, ElEmpty, ElInput, ElOption, ElPagination, ElProgress, ElSelect, ElSkeleton, ElTag } from 'element-plus'
import { ArrowLeft, ArrowRight, Clock, Document, FolderOpened, Headset, RefreshRight, Search } from '@element-plus/icons-vue'
import PageHeader from '../../shared/ui/PageHeader.vue'
import TaskProgressOverview from './TaskProgressOverview.vue'
import { acceptedUpload, packageUploads, uploadPackage } from '../media-library/package-uploads'
import { backgroundTasks, type BackgroundTask, type ChildPage, type ItemPage, type TaskPage } from './api'
import { activeTask, compactTaskName, countNames, date, failureGuidance, failureText, frameProgress, isScan, itemStatusNames, progressStatus, progressText, skipReasons, stageName, statistics, statusNames, taskFailure, taskHighlights, tone, typeNames, unsuccessful } from './presentation'

const route = useRoute(), router = useRouter()
const taskId = computed(() => typeof route.params.id === 'string' ? route.params.id : '')
const value = (key: string) => typeof route.query[key] === 'string' ? route.query[key] as string : ''
const pageNumber = (key: string) => Math.max(0, Math.min(1000000, Number.parseInt(value(key), 10) || 0))
const filter = computed(() => ({ view: ['HISTORY', 'ALL'].includes(value('view')) ? value('view') : 'ACTIVE',
  type: value('type'), status: value('status'), q: value('q'), page: pageNumber('page') }))
const keyword = ref(filter.value.q)
const localUploads = computed(() => {
  const { view, type, status, q, page } = filter.value
  if (view === 'HISTORY' || page || (type && type !== 'SHARE_IMPORT')) return []
  return [...packageUploads.values()].filter(item => {
    const state = item.controller ? 'RUNNING' : item.error === '上传已取消' ? 'CANCELLED' : 'FAILED'
    return (!status || status === state) && (item.source.name + item.file.name).toLowerCase().includes(q.toLowerCase())
  })
})
watch(acceptedUpload, receipt => { if (receipt && !taskId.value) void refresh() })
const result = ref<TaskPage>(), task = ref<BackgroundTask>(), items = ref<ItemPage>(), children = ref<ChildPage>()
const error = ref(''), loading = ref(false), observed = ref('')
const failureReason = ref(''), failureSong = ref('')
const detailStats = computed(() => task.value ? statistics(task.value) : [])
const skipped = computed(() => task.value?.statistics.skippedByReason as Record<string, number> | undefined)
const parentBatch = computed(() => value('fromBatch') || (!task.value?.isBatch ? task.value?.batches[0]?.id : '') || '')
const timingNames: Record<string, string> = { queue: '等待', download: '读取素材', probe: '探测', decode: '解码', inference: '推理', encode: '编码', total: '合计' }
let active = true, generation = 0, timer: ReturnType<typeof setTimeout> | undefined
function valid(turn: number, path: string) { return active && turn === generation && path === route.fullPath && document.visibilityState !== 'hidden' }
function schedule() {
  clearTimeout(timer)
  if (!active || document.visibilityState === 'hidden') return
  if (error.value || (taskId.value ? task.value && activeTask(task.value.status) : filter.value.view !== 'HISTORY'))
    timer = setTimeout(() => { void refresh() }, error.value ? 5000 : 2000)
}
async function refresh() {
  clearTimeout(timer)
  if (!active || document.visibilityState === 'hidden') return
  const turn = ++generation, path = route.fullPath, id = taskId.value
  loading.value = true
  try {
    if (id) {
      const detail = await backgroundTasks.detail(id)
      if (!valid(turn, path)) return
      const native = detail.detailMode === 'ITEMS'
      const entries = native ? await backgroundTasks.items(id, pageNumber('itemPage'), value('itemStatus'))
        : await backgroundTasks.children(id, pageNumber('itemPage'), value('itemStatus'), value('itemType'))
      if (!valid(turn, path)) return
      let failedItems = native ? (entries as ItemPage).items : []
      let failedChildren = native ? [] : (entries as ChildPage).items
      if (unsuccessful(detail.status) && (!detail.error.trim() || /^[A-Z_]+$/.test(detail.error.trim())) && !taskFailure({ ...detail, error: '', execution: {} }, failedItems, failedChildren)) {
        // Page/filter changes must not make the overview lose a cause recorded on another page.
        const counts = entries.counts
        const failedStatus = ['FAILED', 'INTERRUPTED', 'BLOCKED'].find(status => (counts[status] || 0) > 0) || 'FAILED'
        try {
          if (native) failedItems = (await backgroundTasks.items(id, 0, failedStatus)).items
          else failedChildren = (await backgroundTasks.children(id, 0, failedStatus, '')).items
        } catch { /* The main detail remains usable; the related business page is still available. */ }
        if (!valid(turn, path)) return
      }
      failureReason.value = taskFailure(detail, failedItems, failedChildren)
      failureSong.value = failedItems.find(item => unsuccessful(item.status))?.title || failedChildren.find(child => unsuccessful(child.status))?.subjectName || ''
      task.value = detail; items.value = native ? entries as ItemPage : undefined
      children.value = native ? undefined : entries as ChildPage; observed.value = detail.observedAt
      const last = Math.max(0, Math.ceil(entries.totalElements / 20) - 1)
      if (pageNumber('itemPage') > last) { void change({ itemPage: last ? String(last) : undefined }); return }
    } else {
      const data = await backgroundTasks.list(filter.value)
      if (!valid(turn, path)) return
      result.value = data; observed.value = data.observedAt
      const last = Math.max(0, Math.ceil(data.totalElements / 20) - 1)
      if (filter.value.page > last) { void change({ page: last ? String(last) : undefined }); return }
    }
    error.value = ''
  } catch (failure) {
    if (valid(turn, path)) error.value = failure instanceof Error ? failure.message : '读取后台任务失败'
  } finally {
    if (valid(turn, path)) { loading.value = false; schedule() }
  }
}
function change(query: Record<string, string | undefined>) { return router.replace({ query: { ...route.query, ...query } }) }
function search() { void change({ q: keyword.value.trim() || undefined, page: undefined }) }
function clearFilters() { keyword.value = ''; void change({ q: undefined, type: undefined, status: undefined, page: undefined }) }
function open(id: string) { void router.push({ path: '/system/tasks/' + encodeURIComponent(id), query: route.query }) }
function openChild(id: string) {
  if (id === taskId.value) return
  void router.push({ path: '/system/tasks/' + encodeURIComponent(id), query: { ...route.query,
    fromBatch: taskId.value, batchPage: value('itemPage') || undefined, batchStatus: value('itemStatus') || undefined,
    batchType: value('itemType') || undefined, itemPage: undefined, itemStatus: undefined, itemType: undefined } })
}
function back() {
  const query: LocationQueryRaw = { ...route.query }, parent = parentBatch.value
  delete query.itemPage; delete query.itemStatus; delete query.itemType
  if (parent) {
    query.itemPage = value('batchPage') || undefined; query.itemStatus = value('batchStatus') || undefined; query.itemType = value('batchType') || undefined
  }
  for (const key of ['fromBatch', 'batchPage', 'batchStatus', 'batchType']) delete query[key]
  void router.push({ path: parent ? '/system/tasks/' + encodeURIComponent(parent) : '/system/tasks', query })
}
function visibility() { generation++; clearTimeout(timer); loading.value = false; if (document.visibilityState !== 'hidden') void refresh() }
watch(() => route.fullPath, (_next, previous) => {
  generation++; clearTimeout(timer); keyword.value = filter.value.q
  if (previous?.split('?')[0] !== route.path) { task.value = undefined; items.value = undefined; children.value = undefined; result.value = undefined; observed.value = ''; failureReason.value = ''; failureSong.value = '' }
  error.value = ''; void refresh()
})
onMounted(() => { document.addEventListener('visibilitychange', visibility); void refresh() })
onBeforeUnmount(() => { active = false; generation++; clearTimeout(timer); document.removeEventListener('visibilitychange', visibility) })
</script>

<template>
  <div class="task-center">
    <PageHeader v-if="!taskId" title="后台任务">
      <template #actions><ElButton :icon="RefreshRight" :loading="loading" @click="refresh">刷新</ElButton></template>
    </PageHeader>
    <ElButton v-else class="task-back" text :icon="ArrowLeft" @click="back">{{ parentBatch ? '返回批次' : '返回任务列表' }}</ElButton>
    <ElAlert v-if="error" :title="error" type="error" show-icon :closable="false" class="task-error" role="alert">
      <span v-if="task || result">仍显示上次成功读取的结果。</span><ElButton text @click="refresh">重试</ElButton>
    </ElAlert>

    <template v-if="!taskId">
      <div class="task-list-toolbar">
        <div class="task-tabs" role="group" aria-label="任务记录范围">
          <ElButton v-for="(label, view) in { ACTIVE: '未完成', HISTORY: '历史记录', ALL: '全部' }" :key="view"
            text :type="filter.view === view ? 'primary' : 'default'" :aria-pressed="filter.view === view"
            @click="change({ view, page: undefined, status: undefined })">{{ label }}</ElButton>
        </div><span class="task-retention">历史保留 30 天</span>
      </div>
      <form class="task-filters" @submit.prevent="search">
        <ElInput v-model="keyword" aria-label="搜索任务名称或编号" placeholder="搜索任务名称、歌曲或编号" clearable :prefix-icon="Search" maxlength="200" @clear="search" />
        <ElSelect :model-value="filter.type" aria-label="任务类型" placeholder="全部类型" @change="change({ type: $event || undefined, page: undefined })">
          <ElOption label="全部类型" value="" /><ElOption v-for="(name, type) in typeNames" :key="type" :label="name" :value="type" />
        </ElSelect>
        <ElSelect :model-value="filter.status" aria-label="任务状态" placeholder="全部状态" @change="change({ status: $event || undefined, page: undefined })">
          <ElOption label="全部状态" value="" /><ElOption v-for="(name, status) in statusNames" :key="status" :label="name" :value="status" />
        </ElSelect>
        <ElButton native-type="submit">搜索</ElButton>
      </form>
      <section v-if="localUploads.length" aria-label="当前标签页的资料包上传" class="local-uploads">
        <article v-for="item in localUploads" :key="item.source.id">
          <div><strong>{{ item.source.name }} · {{ item.file.name }}</strong><p role="status">{{ item.controller ? '正在上传，完成前请保留此标签页' : item.error }}</p></div>
          <ElButton v-if="item.controller" @click="item.controller.abort()">取消上传</ElButton>
          <template v-else><ElButton @click="uploadPackage(item.source, item.file, item.mode)">重试上传</ElButton><ElButton text @click="packageUploads.delete(item.source.id)">移除记录</ElButton></template>
        </article>
      </section>
      <ElSkeleton v-if="loading && !result" :rows="5" animated />
      <div v-else-if="result?.items.length" class="task-table-wrap task-list-wrap sv-glass">
        <table class="task-table task-list-table">
          <thead><tr><th scope="col">批次与处理范围</th><th scope="col">状态</th><th scope="col">阶段与处理结果</th><th scope="col">创建时间</th><th scope="col"><span class="sr-only">操作</span></th></tr></thead>
          <tbody><tr v-for="entry in result.items" :key="entry.id">
            <td class="task-identity"><div class="task-identity-content"><span class="task-type-icon"><component :is="isScan(entry) ? FolderOpened : entry.type.startsWith('AUDIO') ? Headset : Document" aria-hidden="true" /></span><div><button class="task-name" :title="entry.name" @click="open(entry.id)">{{ compactTaskName(entry) }}</button><span class="task-subject">{{ entry.subjectName || '全部或选定范围' }}</span><span v-if="!entry.name.includes(typeNames[entry.type] || entry.type)" class="task-type-caption">{{ typeNames[entry.type] || entry.type }}</span></div></div></td>
            <td class="task-list-status"><ElTag :type="tone(entry.status)" class="task-status" :class="{ 'is-waiting': entry.status === 'QUEUED' }" size="small"><Clock v-if="entry.status === 'QUEUED'" aria-hidden="true" />{{ statusNames[entry.status] || entry.status }}</ElTag></td>
            <td class="task-progress"><strong>{{ stageName(entry.stage) }}</strong><ElProgress v-if="entry.progress.percent !== null" :percentage="Math.floor(entry.progress.percent)" :status="progressStatus(entry.status)" :stroke-width="4" :show-text="false" />
              <div class="task-progress-meta"><span v-if="isScan(entry) && entry.operation.status === 'COMPLETED'" class="task-success">扫描完成</span><span v-if="progressText(entry) !== '查看处理结果'">{{ progressText(entry) }}</span><span v-for="highlight in taskHighlights(entry)" :key="highlight.key" :class="{ 'task-danger': highlight.key === 'failed', 'task-warning': highlight.key === 'review' || highlight.key === 'uncertain' }">{{ highlight.value }} 项{{ highlight.label }}</span><span v-if="unsuccessful(entry.status)">{{ failureText(entry.error || entry.execution?.reason || '') || '任务未全部完成，打开详情查看具体原因' }}</span></div>
              <small v-if="frameProgress(entry.execution)">{{ frameProgress(entry.execution) }}</small>
            </td>
            <td class="task-created"><time :datetime="entry.createdAt || undefined">{{ date(entry.createdAt) }}</time></td>
            <td class="task-open"><ElButton link type="primary" :aria-label="'查看' + entry.name + '的详情'" @click="open(entry.id)">详情<ArrowRight aria-hidden="true" /></ElButton></td>
          </tr></tbody>
        </table>
      </div>
      <ElEmpty v-else-if="!loading && !error && !localUploads.length" :description="filter.q || filter.type || filter.status ? '没有符合筛选条件的任务' : filter.view === 'ACTIVE' ? '当前没有未完成的任务' : '暂无任务历史'">
        <ElButton v-if="filter.q || filter.type || filter.status" @click="clearFilters">清除筛选</ElButton>
      </ElEmpty>
      <div v-if="result" class="task-list-footer"><span>共 {{ result.totalElements.toLocaleString() }} 个批次</span><span v-if="observed">最近读取：{{ date(observed) }}<template v-if="error"> · 读取失败，等待重试</template></span></div>
      <ElPagination v-if="result && result.totalElements > 20" :current-page="filter.page + 1" :page-size="20" :total="result.totalElements" layout="total, prev, pager, next" @current-change="change({ page: $event === 1 ? undefined : String($event - 1) })" />
    </template>

    <template v-else-if="task">
      <header class="task-detail-header"><div><div class="task-detail-title"><h1>{{ compactTaskName(task) }}</h1><ElTag :type="tone(task.status)" class="task-status" :class="{ 'is-waiting': task.status === 'QUEUED' }"><Clock v-if="task.status === 'QUEUED'" aria-hidden="true" />{{ statusNames[task.status] || task.status }}</ElTag></div><p class="task-detail-subtitle"><span>{{ task.subjectName || '全部或选定范围' }}</span><span>创建于 {{ date(task.createdAt) }}</span></p></div><div class="task-detail-actions"><ElButton v-if="task.relatedAvailable" @click="router.push(task.relatedPath)">前往相关页面</ElButton><ElButton :icon="RefreshRight" :loading="loading" @click="refresh">刷新</ElButton></div></header>
      <div class="task-detail-layout" :class="{ 'is-single': !task.isBatch }">
        <section class="sv-glass task-panel task-overview" aria-label="任务概览">
          <p v-if="task.batchKind === 'LEGACY'" class="task-muted">未记录原始批次：这些历史任务按来源和类型归档，未推断扫描归属。</p>
          <p v-if="!task.relatedAvailable" class="task-muted">关联对象或原业务任务已移除或过期，任务记录仍保留。</p>
          <ElAlert v-if="failureReason || unsuccessful(task.status)" :title="failureReason || '本次处理未全部完成'" :type="['FAILED', 'INTERRUPTED'].includes(task.status) ? 'error' : 'warning'" show-icon :closable="false" class="task-error">
            <p v-if="unsuccessful(task.status)">{{ failureGuidance(task, failureReason) }}</p>
            <ElButton v-if="task.type === 'LX_DOWNLOAD' && unsuccessful(task.status)" text type="primary" @click="router.push({ path: '/library/downloads', query: { tab: 'search', q: failureSong || undefined } })">重新搜索歌曲</ElButton>
            <ElButton v-if="task.relatedAvailable && unsuccessful(task.status)" text type="primary" @click="router.push(task.relatedPath)">{{ task.type === 'LX_DOWNLOAD' ? '查看下载记录' : '前往处理' }}</ElButton>
          </ElAlert>
          <TaskProgressOverview :task="task" />
          <details class="task-extra"><summary>编号、处理范围与时间</summary><dl class="task-metadata"><div><dt>任务编号</dt><dd class="task-number">{{ task.id }}</dd></div><div><dt>业务编号</dt><dd class="task-number">{{ task.businessId || '未记录' }}</dd></div><div><dt>任务类型</dt><dd>{{ typeNames[task.type] || task.type }}</dd></div><div><dt>处理范围</dt><dd>{{ task.subjectName || '全部或选定范围' }}</dd></div><div><dt>创建时间</dt><dd>{{ date(task.createdAt) }}</dd></div><div><dt>开始时间</dt><dd>{{ date(task.startedAt) }}</dd></div><div><dt>结束时间</dt><dd>{{ date(task.finishedAt) }}</dd></div><div><dt>最近变化</dt><dd>{{ date(task.updatedAt) }}</dd></div></dl></details>
          <p v-if="task.timeIncomplete" class="task-muted">这条历史任务的部分时间未记录，无法还原准确耗时。</p>
        </section>
        <aside v-if="task.isBatch" class="sv-glass task-panel task-count-summary" aria-label="子任务统计"><h2>子任务统计</h2><dl><div v-for="(label, key) in countNames" :key="key" :class="{ 'task-danger': key === 'failed' && task.childrenCounts[key], 'task-warning': (key === 'review' || key === 'uncertain') && task.childrenCounts[key] }"><dt>{{ label }} </dt> <dd>{{ task.childrenCounts[key] || 0 }}</dd></div></dl></aside>
        <section v-if="task.detailMode === 'ITEMS'" class="sv-glass task-panel" aria-label="结果明细">
          <div class="task-detail-heading"><h2>任务明细</h2><ElSelect :model-value="value('itemStatus')" aria-label="明细状态" placeholder="全部结果" @change="change({ itemStatus: $event || undefined, itemPage: undefined })"><ElOption label="全部结果" value="" /><ElOption v-for="(count, status) in items?.counts" :key="status" :label="(itemStatusNames[status] || status) + '（' + count + '）'" :value="status" /></ElSelect></div>
          <div v-if="items?.items.length" class="task-table-wrap"><table class="task-table task-data-table"><thead><tr><th scope="col">歌曲 / 条目</th><th scope="col">状态</th><th scope="col">说明</th></tr></thead><tbody><tr v-for="item in items.items" :key="item.id"><td data-label="歌曲 / 条目">{{ item.title || item.songId || item.id }}</td><td data-label="状态">{{ ['PROBING', 'PROCESSING'].includes(item.status) && item.execution?.jobState === 'QUEUED' ? '排队中' : itemStatusNames[item.status] || item.status }}</td><td data-label="说明">{{ failureText(item.message || '') || (item.execution?.stage ? stageName(item.execution.stage) : '—') }}<small v-if="frameProgress(item.execution)">{{ frameProgress(item.execution) }}</small></td></tr></tbody></table></div>
          <ElEmpty v-if="items && !items.items.length" description="暂无符合条件的明细" :image-size="48" />
          <ElPagination v-if="items && items.totalElements > 20" :current-page="pageNumber('itemPage') + 1" :page-size="20" :total="items.totalElements" layout="total, prev, pager, next" @current-change="change({ itemPage: $event === 1 ? undefined : String($event - 1) })" />
        </section>
        <section v-else class="sv-glass task-panel" aria-label="任务明细">
          <div class="task-detail-heading"><h2>任务明细</h2><div class="task-child-filters">
            <ElSelect :model-value="value('itemType')" aria-label="明细类型" placeholder="全部类型" @change="change({ itemType: $event || undefined, itemPage: undefined })"><ElOption label="全部类型" value="" /><ElOption v-for="(name, type) in typeNames" :key="type" :label="name" :value="type" /></ElSelect>
            <ElSelect :model-value="value('itemStatus')" aria-label="明细状态" placeholder="全部状态" @change="change({ itemStatus: $event || undefined, itemPage: undefined })"><ElOption label="全部状态" value="" /><ElOption v-for="(count, status) in children?.counts" :key="status" :label="(statusNames[status] || status) + '（' + count + '）'" :value="status" /></ElSelect>
          </div></div>
          <div v-if="children?.items.length" class="task-table-wrap"><table class="task-table task-data-table"><thead><tr><th scope="col">具体任务 / 歌曲</th><th scope="col">状态</th><th scope="col">当前阶段与进度</th><th scope="col">说明</th></tr></thead><tbody><tr v-for="child in children.items" :key="child.id">
            <td data-label="具体任务 / 歌曲"><button v-if="child.id !== taskId" class="task-name" @click="openChild(child.id)">{{ child.name }}</button><span v-else>{{ child.name }}</span><small>{{ child.subjectName }}</small><small class="task-number">{{ child.businessId }}</small></td>
            <td data-label="状态"><ElTag :type="tone(child.status)" size="small">{{ statusNames[child.status] || child.status }}</ElTag><small v-if="child.execution.resultState === 'UNKNOWN'">识别不确定</small></td>
            <td data-label="当前阶段与进度"><span>{{ stageName(child.stage) }}</span><small>{{ progressText(child) }}</small><small v-if="frameProgress(child.execution)">{{ frameProgress(child.execution) }}</small></td><td data-label="说明">{{ failureText(child.error || child.execution?.reason || '') || '—' }}</td>
          </tr></tbody></table></div>
          <div v-else class="task-entries-empty"><Document aria-hidden="true" /><div><strong>{{ value('itemStatus') || value('itemType') ? '暂无符合条件的任务' : '尚无子任务记录' }}</strong></div></div>
          <ElPagination v-if="children && children.totalElements > 20" :current-page="pageNumber('itemPage') + 1" :page-size="20" :total="children.totalElements" layout="total, prev, pager, next" @current-change="change({ itemPage: $event === 1 ? undefined : String($event - 1) })" />
        </section>
        <section v-if="detailStats.length" class="sv-glass task-panel" aria-label="处理结果">
          <h2>处理结果</h2><dl class="task-stats"><div v-for="entry in detailStats" :key="entry.key"><dt>{{ entry.label }}</dt><dd>{{ entry.value }}</dd></div></dl>
          <p v-if="task.statistics.review" class="task-muted">待审核的结果尚需人工确认，处理完成不代表已全部保存。</p>
          <p v-if="task.statistics.spaceInsufficient" class="task-danger">仍有空间缺口，请查看保护条件和失败原因。</p>
          <p v-if="task.statistics.targetReached === false" class="task-muted">本次清理未达到目标。</p>
          <ul v-if="skipped" class="task-reasons"><li v-for="(count, reason) in skipped" :key="reason">{{ skipReasons[reason] || reason }}：{{ count }}</li></ul>
          <p v-if="task.statistics.errorDetailsLimited" class="task-muted">失败明细保留业务任务提供的前 20 项，失败总数见上方统计。</p>
        </section>
        <section v-if="task.execution?.backend || task.execution?.fallbackReason || task.execution?.reason || Object.keys(task.execution?.timingsMs || {}).length" class="sv-glass task-panel" aria-label="执行信息">
          <h2>执行信息</h2><p v-if="task.execution.backend">处理设备：{{ task.execution.backend }}<template v-if="task.execution.modelVersion"> · 模型 {{ task.execution.modelVersion }}</template></p><p v-if="task.execution.fallbackReason">{{ task.execution.fallbackReason }}</p><p v-if="task.execution.reason">{{ task.execution.reason }}</p>
          <p v-for="(duration, key) in task.execution.timingsMs" :key="key">{{ timingNames[key] || key }}：{{ (duration / 1000).toFixed(2) }} 秒</p>
        </section>
      </div>
    </template>
    <ElSkeleton v-else-if="loading" :rows="6" animated />
    <ElButton v-else-if="taskId && error" :icon="RefreshRight" @click="refresh">重新读取任务</ElButton>
    <p v-if="taskId && observed" class="task-last-read">最近读取：{{ date(observed) }}<template v-if="error"> · 读取失败，等待重试</template></p>
  </div>
</template>

<style scoped src="./background-tasks.css" />
