<script setup lang="ts">
import { onMounted, onBeforeUnmount, reactive, ref, computed, watch, defineAsyncComponent, nextTick } from 'vue'
import { ElLoading, ElAlert, ElButton, ElDialog, ElDropdown, ElDropdownItem, ElDropdownMenu, ElEmpty, ElForm, ElFormItem, ElInput, ElMessage, ElMessageBox, ElCheckbox } from 'element-plus'
import { MagicStick, MoreFilled, Plus, RefreshRight, Upload } from '@element-plus/icons-vue'
import { parserProfiles } from '../../filename-parser/api/rules'
import type { ParserWorkspace } from '../../filename-parser/types'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import PageHeader from '../../../shared/ui/PageHeader.vue'
import { useVisiblePolling } from '../../../shared/composables/use-visible-polling'
import { media, type MediaSource, type SourceType, type ScanTask } from '../api/media'

import WebDavMetadataDialog from '../components/WebDavMetadataDialog.vue'
import LocalFolderPicker from '../components/LocalFolderPicker.vue'
import MediaSourceCard from '../components/MediaSourceCard.vue'
import MediaSourceWizard from '../components/MediaSourceWizard.vue'
import { lx } from '../../lx-downloads/api'
import { embeddedMetadata, type EmbeddedSummary } from '../api/embeddedMetadata'
import { validateSharePackage } from '../api/shareImports'
const FilenameProfilesView = defineAsyncComponent(() => import('../../filename-parser/views/FilenameProfilesView.vue'))
const FilenameParserView = defineAsyncComponent(() => import('../../filename-parser/views/FilenameParserView.vue'))
const metadataSource = ref<MediaSource | null>(null)
const metadataImportFile = ref<File>()
const metadataUploading = ref(false)
const importMode = ref(false)
const importFile = ref<File>()
const sourceStep = ref<1 | 2 | 3>(1)
const summaries = reactive<Record<string, EmbeddedSummary | undefined>>({})
const ingests = reactive<Record<string, { state: string; error?: string } | undefined>>({})
const router = useRouter()
const route = useRoute()
const vLoading = ElLoading.directive
const items = ref<MediaSource[]>([])
const moreSources = ref(false), sourcePage = ref(0)
const advanced = ref(false), picker = ref(false)
function chooseFolder() { picker.value = true }
function confirmFolder(path: string) { draft.location = path; picker.value = false }
function changeType(type: SourceType) {
  if (editing.value || saving.value || draft.type === type) return
  Object.assign(draft, { autoExtractEmbedded: false, type, location: '', username: '', password: '', useForLxDownloads: false }); clearPassword.value = false
  importMode.value = false; importFile.value = undefined; formError.value = ''
}
function changeImportMode() {
  importFile.value = undefined; formError.value = ''
  if (importMode.value) { draft.autoExtractEmbedded = false; draft.scanEnabled = false }
}
function directScan() {
  if (saving.value) return
  importMode.value = false; changeImportMode()
}
function chooseImportFile(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = ''
  if (!file || saving.value) return
  try { validateSharePackage(file); importFile.value = file; formError.value = '' }
  catch (e) { importFile.value = undefined; formError.value = e instanceof Error ? e.message : '无法读取资料包' }
}
const loading = ref(false), saving = ref(false), loaded = ref(false), dialog = ref(false)
const error = ref(''), formError = ref(''), editing = ref<MediaSource | null>(null), clearPassword = ref(false)
const draft = reactive({ autoExtractEmbedded: false, useForLxDownloads: false, scanEnabled: false, scanCron: '0 3 * * *', parserProfileId: 'default', name: '', type: 'LOCAL' as SourceType, location: '', username: '', password: '' })
const importingSource = computed(() => !editing.value && draft.type === 'WEBDAV' && importMode.value)
const sourceName = computed(() => draft.name.trim() || (draft.type === 'LOCAL' ? draft.location.split(/[\\/]/).filter(Boolean).pop() || '本地歌曲' : 'WebDAV 歌曲').slice(0, 100))
const summaryLocation = computed(() => {
  if (draft.type === 'LOCAL') return draft.location
  // A pasted URL may contain credentials; never echo them on the confirmation page.
  try {
    const url = new URL(draft.location)
    const hiddenParameters = !!(url.search || url.hash)
    url.username = ''; url.password = ''; url.search = ''; url.hash = ''
    let display = url.toString()
    try { display = decodeURI(display) } catch { /* Preserve malformed percent escapes as entered. */ }
    return display + (hiddenParameters ? '（查询参数及片段已隐藏）' : '')
  }
  catch { return '请返回检查 WebDAV 目录地址' }
})
const editorPanel = ref<'source' | 'profiles' | 'rules'>('source')
const workbenchProfileId = ref('default')
const workbench = ref<{ canLeave: () => Promise<boolean> }>()
const editorBack = ref<InstanceType<typeof ElButton>>()
const formBaseline = ref('')
const formSignature = computed(() => JSON.stringify({ ...draft, clearPassword: clearPassword.value, importMode: importMode.value, importFile: importFile.value ? [importFile.value.name, importFile.value.size, importFile.value.lastModified] : null }))
const formDirty = computed(() => dialog.value && formSignature.value !== formBaseline.value)
const profileWorkspace = ref<ParserWorkspace | null>(null), profilesLoading = ref(false), profilesError = ref('')
const selectedProfile = computed(() => profileWorkspace.value?.profiles.find(p => p.id === draft.parserProfileId))
const enabledEntries = computed(() => selectedProfile.value?.entries.filter(e => e.enabled) ?? [])
const scanning = ref('')
const localResults = reactive<Record<string, { totalSongs: number; needsReviewSongs: number }>>({})
const tasks = reactive<Record<string, ScanTask | undefined>>({})
const taskVersions: Record<string, number> = {}
const taskErrors = reactive<Record<string, string>>({})
const cancelling = reactive<Record<string, boolean>>({})
let taskGeneration = 0, loadGeneration = 0, latestTasksRequested = false
function enhancing(id: string) { const s = summaries[id]; return !!s?.enabled && !s.paused && (s.counts.PENDING ?? 0) + (s.counts.QUEUED ?? 0) + (s.counts.RUNNING ?? 0) > 0 }
function ingestActive(id: string) { return ['QUEUED', 'RUNNING'].includes(ingests[id]?.state ?? '') }
function taskActive(task?: ScanTask) { return !!task && ['QUEUED', 'RUNNING'].includes(task.status) }
const taskPolling = useVisiblePolling(async reason => {
  if (reason === 'resume') latestTasksRequested = true
  do {
    const latest = latestTasksRequested; latestTasksRequested = false
    await readTasks(latest)
  } while (active && !document.hidden && latestTasksRequested)
}, () => items.value.some(item => ingestActive(item.id) || enhancing(item.id) || taskActive(tasks[item.id]))
  ? 2000 : items.value.some(item => taskErrors[item.id]) ? 10000 : undefined, { immediate: false })
function scheduleTasks(token = taskGeneration) {
  if (!active || token !== taskGeneration) return
  taskPolling.schedule()
}
function refreshTasks(latest: boolean): Promise<void> {
  latestTasksRequested ||= latest
  return taskPolling.refresh().then((): Promise<void> | undefined => {
    if (active && !document.hidden && latestTasksRequested) return refreshTasks(false)
  })
}
async function readTasks(latest: boolean, token = taskGeneration) {
  const sources = items.value
  await Promise.all(sources.map(async item => {
    const previous = tasks[item.id], version = taskVersions[item.id] ?? 0
    if (!latest && !ingestActive(item.id) && !enhancing(item.id) && !taskActive(previous) && !taskErrors[item.id]) return
    try {
      const [task, ingest, summary] = await Promise.all([item.type === 'WEBDAV' ? latest || !previous ? media.latestTask(item.id) : media.task(item.id, previous.id) : undefined, media.latestIngest(item.id), embeddedMetadata.summary(item.id)])
      if (!active || token !== taskGeneration || version !== (taskVersions[item.id] ?? 0)) return
      tasks[item.id] = task; ingests[item.id] = ingest; summaries[item.id] = summary; taskErrors[item.id] = ''
    } catch (e) {
      if (active && token === taskGeneration && version === (taskVersions[item.id] ?? 0)) taskErrors[item.id] = e instanceof Error ? e.message : '读取扫描状态失败'
    }
  }))
}
async function cancelScan(item: MediaSource) {
  const task = tasks[item.id]
  if (!task || cancelling[item.id]) return
  cancelling[item.id] = true
  try {
    const updated = await media.cancelTask(item.id, task.id)
    if (active) { taskVersions[item.id] = (taskVersions[item.id] ?? 0) + 1; tasks[item.id] = updated; scheduleTasks() }
  } catch (e) { if (active) error.value = e instanceof Error ? e.message : '取消失败' }
  finally { if (active) cancelling[item.id] = false }
}
let active = true, profileGeneration = 0
async function loadProfiles() {
  const token = ++profileGeneration
  profilesLoading.value = true; profilesError.value = ''
  try { const result = await parserProfiles.load(); if (active && token === profileGeneration) profileWorkspace.value = result }
  catch (e) { if (active && token === profileGeneration) profilesError.value = e instanceof Error ? e.message : '加载解析方案失败' }
  finally { if (active && token === profileGeneration) profilesLoading.value = false }
}
function profileName(id: string) {
  return profileWorkspace.value?.profiles.find(p => p.id === id)?.name ?? (profilesError.value ? '方案加载失败' : '方案不可用')
}
async function scan(item: MediaSource) {
  if (scanning.value) return
  try { await ElMessageBox.confirm('扫描会按已保存的解析方案更新歌曲索引。WebDAV 缺失文件需两次完整扫描确认后下架；已提取的内嵌元数据会复用。不会修改原始文件。', item.type === 'WEBDAV' ? '扫描 WebDAV 歌曲' : '扫描本地歌曲', { confirmButtonText: '开始扫描', cancelButtonText: '取消' }) }
  catch { return }
  scanning.value = item.id; error.value = ''
  try {
    if (item.type === 'WEBDAV') {
      const task = await media.createTask(item.id)
      if (!active) return
      taskVersions[item.id] = (taskVersions[item.id] ?? 0) + 1
      tasks[item.id] = task; taskErrors[item.id] = ''; scheduleTasks()
      ElMessage.success('后台扫描已创建，可以离开页面，稍后查看结果')
      return
    }
    const result = await media.scan(item.id)
    if (!active) return
    localResults[item.id] = result
    ElMessage.success(`扫描完成：${result.totalSongs} 首，${result.needsReviewSongs} 首需复核`)
    await load()

  } catch (e) { if (active) error.value = e instanceof Error ? e.message : '扫描失败' }
  finally { if (active) scanning.value = '' }
}
async function showSongs(item: MediaSource) {
  await router.push({ path: '/library/songs', query: { sourceId: item.id } })
}
async function load(append = false, openLinkedSource = true) {
  const token = ++loadGeneration
  loading.value = true; error.value = ''
  try {
    const next = append ? sourcePage.value + 1 : 0
    const result = await media.list(next, 100)
    if (!active || token !== loadGeneration) return
    items.value = append ? [...items.value, ...result.items] : result.items
    const selectedSource = route.query.source
    if (openLinkedSource && !append && typeof selectedSource === 'string') {
      const selected = items.value.find(item => item.id === selectedSource) ?? await media.get(selectedSource)
      if (!active || token !== loadGeneration) return
      if (!items.value.some(item => item.id === selected.id)) items.value.unshift(selected)
      metadataSource.value = selected
    }
    sourcePage.value = next; moreSources.value = (next + 1) * 100 < result.totalElements; loaded.value = true
    taskPolling.clear(); taskGeneration++; void refreshTasks(true)
  } catch (e) { if (active && token === loadGeneration) error.value = e instanceof Error ? e.message : '读取媒体库失败' }
  finally { if (active && token === loadGeneration) loading.value = false }
}
function open(type: SourceType, item?: MediaSource, forImport = false) {
  if (saving.value) return
  sourceStep.value = 1
  importMode.value = forImport
  importFile.value = undefined
  editing.value = item ?? null
  Object.assign(draft, { autoExtractEmbedded: false, scanEnabled: item?.scanEnabled ?? false, scanCron: item?.scanCron ?? '0 3 * * *', name: item?.name ?? '', type, location: item?.location ?? '', username: item?.username ?? '', password: '', parserProfileId: item?.parserProfileId ?? 'default' })
  draft.useForLxDownloads = item?.useForLxDownloads ?? route.query.download === '1'
  advanced.value = false; clearPassword.value = false; formError.value = ''; editorPanel.value = 'source'
  formBaseline.value = formSignature.value; dialog.value = true; void loadProfiles()
}
function closed() { if (dialog.value) return; picker.value = false; draft.password = ''; importFile.value = undefined; formError.value = ''; editing.value = null; editorPanel.value = 'source' }
async function canLeaveWorkbench() { return editorPanel.value === 'source' || !workbench.value || await workbench.value.canLeave() }
async function canLeaveSource() {
  if (metadataUploading.value) return false
  if (!dialog.value) return true
  if (saving.value || !await canLeaveWorkbench()) return false
  if (!formDirty.value) return true
  try {
    await ElMessageBox.confirm('来源还有未保存修改，是否放弃？已保存的识别方案和规则会保留。', '未保存来源', { confirmButtonText: '放弃修改', cancelButtonText: '继续编辑', type: 'warning' })
    return true
  } catch { return false }
}
async function closeSource(done?: () => void) {
  if (!await canLeaveSource()) return
  if (done) done()
  else dialog.value = false
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (formDirty.value) { event.preventDefault(); event.returnValue = '' }
}
onBeforeRouteLeave(canLeaveSource)
async function showRecognition(item?: MediaSource) {
  if (saving.value) return
  if (item) open(item.type, item)
  workbenchProfileId.value = draft.parserProfileId
  editorPanel.value = 'profiles'
  await nextTick(); (editorBack.value?.$el as HTMLElement | undefined)?.focus()
}
async function returnToSource(profileId?: string) {
  if (!await canLeaveWorkbench()) return
  if (profileId) draft.parserProfileId = profileId
  editorPanel.value = 'source'; void loadProfiles()
  await nextTick(); document.getElementById('source-parser-profile')?.focus()
}
function showRules(profileId: string) { workbenchProfileId.value = profileId; editorPanel.value = 'rules' }
async function returnToProfiles(profileId = workbenchProfileId.value) {
  if (!await canLeaveWorkbench()) return
  workbenchProfileId.value = profileId; editorPanel.value = 'profiles'
  await nextTick(); (editorBack.value?.$el as HTMLElement | undefined)?.focus()
}
function focusSourceField(selector: string) {
  void nextTick(() => document.querySelector<HTMLElement>(selector)?.focus())
}
function validateConnection() {
  if (!draft.location.trim()) {
    formError.value = draft.type === 'LOCAL' ? '请选择歌曲文件夹' : '请填写 WebDAV 目录地址'
    if (!editing.value) sourceStep.value = 1
    focusSourceField(draft.type === 'LOCAL' ? '.folder-selection button' : '#source-location')
    return false
  }
  if (draft.type === 'WEBDAV') {
    try {
      const url = new URL(draft.location.trim())
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocol')
    } catch {
      formError.value = '请填写完整的 http:// 或 https:// WebDAV 目录地址'
      if (!editing.value) sourceStep.value = 1
      focusSourceField('#source-location')
      return false
    }
  }
  return true
}
function validateMethod() {
  if (importingSource.value && !importFile.value) {
    formError.value = '请先选择导出的 ZIP 资料包'
    if (!editing.value) sourceStep.value = 2
    focusSourceField('input[aria-label="新媒体库资料包"]')
    return false
  }
  if (profilesLoading.value || profilesError.value || !selectedProfile.value) {
    formError.value = '请选择有效的解析方案，或重新加载方案列表'
    if (!editing.value) sourceStep.value = 2
    focusSourceField('#source-parser-profile')
    return false
  }
  if (!importingSource.value && draft.scanEnabled && draft.scanCron.trim().split(/\s+/).length !== 5) {
    formError.value = '请输入五段 cron：分 时 日 月 周'; advanced.value = true
    if (!editing.value) sourceStep.value = 2
    focusSourceField('input[aria-label="扫描 Cron 表达式"]')
    return false
  }
  return true
}
function nextSourceStep() {
  if (saving.value || editing.value || sourceStep.value === 3) return
  formError.value = ''
  if (sourceStep.value === 1 ? validateConnection() : validateMethod()) sourceStep.value++
}
function previousSourceStep() {
  if (saving.value || sourceStep.value === 1) return
  sourceStep.value--; formError.value = ''
}
function submitSourceForm() {
  if (!editing.value && sourceStep.value < 3) nextSourceStep()
  else void save()
}
async function save(startScan = !editing.value && !importMode.value) {
  if (saving.value) return
  if (!editing.value && sourceStep.value !== 3) { nextSourceStep(); return }
  if (!validateConnection() || !validateMethod()) return
  const importing = !editing.value && draft.type === 'WEBDAV' && importMode.value, file = importFile.value
  if (importing) { startScan = false; draft.autoExtractEmbedded = false; draft.scanEnabled = false }
  saving.value = true; formError.value = ''
  try {
    if (draft.type === 'LOCAL' && draft.useForLxDownloads) {
      const current = await lx.status()
      if (!active) return
      if (current.target.id && (current.target.id !== editing.value?.id || current.target.path !== draft.location)) {
        try { await ElMessageBox.confirm(`原保存位置：${current.target.path}。新保存位置：${draft.location}。保存后，新下载会使用新位置。`, '更改下载保存位置', { confirmButtonText: '更改并保存', cancelButtonText: '返回', type: 'warning' }) }
        catch { return }
      }
    }
    const profileChanged = editing.value && editing.value.parserProfileId !== draft.parserProfileId
    if (!active) return
    const saved = await media.save({ startScan, ...(!editing.value && draft.type === 'WEBDAV' ? { autoExtractEmbedded: !importMode.value && draft.autoExtractEmbedded } : {}), name: sourceName.value, type: draft.type, location: draft.location.trim(), parserProfileId: draft.parserProfileId,
      ...(draft.type === 'LOCAL' ? { useForLxDownloads: draft.useForLxDownloads } : {}),
      ...(importing ? { scanEnabled: false } : draft.scanEnabled || editing.value?.scanEnabled || editing.value?.scanCron ? { scanEnabled: draft.scanEnabled, scanCron: draft.scanCron.trim() } : {}),
      ...(draft.type === 'WEBDAV' ? { username: draft.username,
        password: clearPassword.value ? '' : draft.password || (editing.value ? undefined : '') } : {}) }, editing.value?.id)
    if (!active) return
    dialog.value = false; draft.password = ''; ElMessage.success(importing ? '媒体库已保存，接下来上传资料包并核对路径' : startScan ? '已保存，后台将自动扫描入库，可以离开页面' : profileChanged ? '已保存解析方案，请重新扫描以更新文件名识别结果' : '媒体库配置已保存')
    if (saved && importing) { metadataImportFile.value = file; metadataSource.value = saved }
    await load(false, !importing)
  } catch (e) { formError.value = e instanceof Error ? e.message : '保存失败' }
  finally { saving.value = false }
}
async function reloadMetadataSource(importJobId?: string) {
  const id = metadataSource.value?.id
  if (id) {
    const source = await media.get(id)
    if (metadataSource.value?.id !== id) return
    if (importJobId) await router.replace({ query: { ...route.query, import: importJobId } })
    metadataSource.value = source
  }
  void refreshTasks(true)
}
async function remove(item: MediaSource) {
  try {
    await ElMessageBox.confirm(`移除“${item.name}”的媒体库配置？原始文件不会被删除。`, '移除媒体库', { confirmButtonText: '移除', cancelButtonText: '取消', type: 'warning' })
  } catch { return }
  try { await media.remove(item.id); ElMessage.success('已移除媒体库配置'); await load() }
  catch (e) { error.value = e instanceof Error ? e.message : '移除失败' }
}
watch(() => route.query.source, id => { if (typeof id === 'string') void load() })
onMounted(() => {
  window.addEventListener('beforeunload', beforeUnload)
  void load(); void loadProfiles()
  // 概览等入口通过 ?add=LOCAL|WEBDAV 直接打开添加弹窗，打开后移除参数避免刷新重复弹出。
  const add = route.query.add
  if (add === 'LOCAL' || add === 'WEBDAV') { open(add); const query = { ...route.query }; delete query.add; delete query.download; void router.replace({ query }) }
})
onBeforeUnmount(() => { active = false; profileGeneration++; taskGeneration++; loadGeneration++; draft.password = ''; window.removeEventListener('beforeunload', beforeUnload) })
</script>

<template>
  <div class="media-library-page management-page">
    <PageHeader class="media-heading" title="歌曲来源" description="连接本地目录或 WebDAV，扫描并整理歌曲。已有资料包也可以导入，继续使用整理好的资料。">
      <template #meta><span v-if="loaded" class="source-count" :aria-label="`已读取 ${items.length} 个歌曲来源${moreSources ? '，可继续读取' : ''}`">{{ items.length }} 个来源</span></template>
      <template #actions>
        <div class="media-actions">
          <ElButton type="primary" :icon="Plus" @click="open('LOCAL')">添加来源</ElButton>
          <ElDropdown trigger="click" placement="bottom-end" :teleported="true" :show-arrow="false" popper-class="source-actions-dropdown">
            <ElButton class="media-more-button" text :icon="MoreFilled" aria-label="歌曲来源的更多操作" title="更多操作" />
            <template #dropdown><ElDropdownMenu><ElDropdownItem :icon="RefreshRight" :disabled="loading" @click="load()">刷新</ElDropdownItem><ElDropdownItem :icon="Upload" @click="open('WEBDAV', undefined, true)">导入资料包</ElDropdownItem><ElDropdownItem :icon="MagicStick" @click="router.push('/library/media/recognition')">文件名识别</ElDropdownItem></ElDropdownMenu></template>
          </ElDropdown>
        </div>
      </template>
    </PageHeader>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" show-icon class="media-error"><ElButton text @click="load()">重试</ElButton></ElAlert>
    <section v-loading="loading" class="source-cards" aria-label="媒体库">
      <ElEmpty v-if="loaded && !items.length && !error" description="添加本地目录或 WebDAV，开始整理你的歌曲。"><ElButton type="primary" @click="open('LOCAL')">添加第一个目录</ElButton></ElEmpty>
      <MediaSourceCard
        v-for="row in items" :key="row.id" :source="row"
        :summary="summaries[row.id]" :ingest="ingests[row.id]"
        :task="tasks[row.id]" :task-error="taskErrors[row.id]" :local-result="localResults[row.id]"
        :scan-disabled="!!scanning" :cancelling="cancelling[row.id]"
        :profile-loading="profilesLoading" :profile-name="profileName(row.parserProfileId)"
        @songs="showSongs(row)" @metadata="metadataSource = row" @recognition="showRecognition(row)"
        @scan="scan(row)" @cancel-scan="cancelScan(row)" @edit="open(row.type, row)" @remove="remove(row)"
      />
      <ElButton v-if="moreSources" :loading="loading" @click="load(true)">显示更多位置</ElButton>
    </section>
    <details class="media-notes"><summary>扫描与媒体说明</summary><p class="feature-note">本地目录优先读取音频与视频内嵌标签，缺失信息用文件名补充；WebDAV 可启用后台内嵌元数据提取，同路径复用缓存。扫描不会修改原文件，不代表已验证可播放。</p></details>
    <WebDavMetadataDialog v-if="metadataSource" :source="metadataSource" :initial-import-file="metadataImportFile" :import-job-id="typeof route.query.import === 'string' ? route.query.import : undefined" @uploading="metadataUploading = $event" @file-consumed="metadataImportFile = undefined" @songs="showSongs(metadataSource!); metadataSource = null" @close="metadataSource = null; metadataImportFile = undefined" @updated="reloadMetadataSource" />
    <ElDialog v-model="dialog" :title="editorPanel === 'source' ? (editing ? '编辑媒体库' : '添加媒体') : `${editing?.name || draft.name || '新来源'} · ${editorPanel === 'profiles' ? '文件名识别' : '自定义规则'}`" :width="editorPanel !== 'source' ? 'min(1120px, calc(100vw - 24px))' : editing ? 'min(560px, calc(100vw - 24px))' : 'min(1080px, calc(100vw - 24px))'" class="media-dialog" :class="{ 'source-workbench': editorPanel !== 'source', 'source-wizard-dialog': editorPanel === 'source' && !editing }" :close-on-click-modal="false" :close-on-press-escape="!saving" :show-close="!saving" :before-close="closeSource" @closed="closed">
      <template v-if="editorPanel !== 'source'">
        <div class="source-workbench-context"><ElButton ref="editorBack" @click="editorPanel === 'rules' ? returnToProfiles() : returnToSource()">{{ editorPanel === 'rules' ? '← 返回识别方案' : '← 返回来源设置' }}</ElButton><p>来源草稿已保留，选好方案后再保存来源。</p></div>
        <FilenameProfilesView v-if="editorPanel === 'profiles'" ref="workbench" embedded :profile-id="workbenchProfileId" @use-profile="returnToSource" @rules="showRules" />
        <FilenameParserView v-else ref="workbench" embedded @profile="returnToProfiles" />
      </template>
      <ElForm v-else label-position="top" @submit.prevent="submitSourceForm">
        <MediaSourceWizard :step="sourceStep" :editing="!!editing" :source-type="draft.type" :importing="importingSource">
        <section v-show="editing || sourceStep === 1" data-source-step="1">
        <div v-if="!editing" class="source-types" aria-label="位置类型"><ElButton :type="draft.type === 'LOCAL' ? 'primary' : 'default'" :disabled="saving" @click="changeType('LOCAL')">本地目录</ElButton><ElButton :type="draft.type === 'WEBDAV' ? 'primary' : 'default'" :disabled="saving" @click="changeType('WEBDAV')">WebDAV</ElButton></div>
        <template v-if="draft.type === 'LOCAL'">
          <ElFormItem label="歌曲文件夹" required><div class="folder-selection"><span>{{ draft.location || '尚未选择文件夹' }}</span><ElButton :disabled="saving" @click="chooseFolder">选择文件夹</ElButton></div></ElFormItem>
          <p class="profile-help">选择后端可访问的目录。Docker 使用挂载后的路径，例如 /media；下载可使用可写的 /downloads。</p>
        </template>
        <template v-else>
          <ElFormItem label="WebDAV 目录地址" for="source-location" required><ElInput id="source-location" v-model="draft.location" placeholder="https://nas.example/dav/歌曲目录/" maxlength="2048" :disabled="saving" /></ElFormItem>
          <ElFormItem label="用户名（可选）"><ElInput v-model="draft.username" autocomplete="off" maxlength="256" :disabled="saving" /></ElFormItem>
          <ElFormItem :label="editing?.passwordConfigured ? '密码 / 应用密码（留空保留）' : '密码 / 应用密码（可选）'"><ElInput v-model="draft.password" type="password" show-password autocomplete="new-password" maxlength="1024" :disabled="saving || clearPassword" /></ElFormItem>
          <ElCheckbox v-if="editing?.passwordConfigured" v-model="clearPassword" :disabled="saving" @change="draft.password = ''">清除已保存密码</ElCheckbox>
          <p class="profile-help">凭据仅加密保存在服务端，不会回显。建议使用 HTTPS。OpenList 地址填写 /dav/ 加挂载目录，账号需开启 WebDAV 读取权限。</p>
          <p v-if="editing" class="profile-help">修改地址或账号时需重新填写密码或明确清除。迁移媒体目录并保留已整理资料，请从“完善信息 → 高级选项 → 重新绑定自己的媒体目录”操作。</p>
        </template>
        <ElFormItem label="名称（可选）" for="source-name" class="source-name"><ElInput id="source-name" v-model="draft.name" :placeholder="draft.type === 'LOCAL' ? '留空使用文件夹名称' : '留空使用 WebDAV 歌曲'" maxlength="100" :disabled="saving" /></ElFormItem>
        </section>
        <section v-show="editing || sourceStep === 2" data-source-step="2">
        <div v-if="draft.type === 'LOCAL' && !editing" class="source-local-method"><strong>直接扫描本地目录</strong><p>优先读取文件内的歌曲信息，缺失时从文件名补充。无需资料包。</p></div>
        <ElFormItem v-if="draft.type === 'LOCAL'"><ElCheckbox v-model="draft.useForLxDownloads" :disabled="saving">用于保存洛雪下载</ElCheckbox><p class="profile-help">仅能指定一个本地媒体库。启用后检查实际写入权限，下载完成自动加入曲库。有未完成任务时不能修改保存位置。</p></ElFormItem>
        <ElFormItem v-if="!editing && draft.type === 'WEBDAV'" label="入库方式（资料包可选）" class="source-import">
          <div class="source-methods">
            <ElButton class="source-method-direct" :class="{ selected: !importMode }" :aria-pressed="!importMode" :disabled="saving" @click="directScan"><strong>直接扫描</strong><span>使用目录与文件名整理歌曲，无需资料包</span></ElButton>
            <div class="source-method-package" :class="{ selected: importMode }"><ElCheckbox v-model="importMode" :disabled="saving" @change="changeImportMode">从已导出的资料包入库</ElCheckbox><p>可选 · 复用已经整理好的资料</p></div>
          </div>
          <template v-if="importMode">
            <div class="source-package"><label class="package-choice" :class="{ disabled: saving }">{{ importFile ? '更换资料包' : '选择资料包' }}<input type="file" accept=".zip,application/zip" aria-label="新媒体库资料包" :disabled="saving" @change="chooseImportFile"></label><span v-if="importFile" class="package-name">{{ importFile.name }}</span><ElButton v-if="importFile" text :disabled="saving" @click="directScan">移除资料包</ElButton><ElButton v-else text :disabled="saving" @click="directScan">改为直接扫描</ElButton></div>
            <p class="profile-help">填写自己的 WebDAV 媒体根目录，选择导出的完整 ZIP。保存后上传资料包，核对路径并确认导入；不会自动扫描或读取媒体内容。资料保存后只核验目录和文件大小。</p>
          </template>
          <template v-else>
            <p class="profile-help">无需资料包，可直接保存并扫描目录；也可仅保存来源，稍后手动扫描。</p>
            <ElCheckbox v-model="draft.autoExtractEmbedded" :disabled="saving">自动读取文件内的歌曲信息</ElCheckbox>
          </template>
        </ElFormItem>
        <ElFormItem label="文件名识别" for="source-parser-profile" required class="profile-field">
          <div class="source-profile-selection"><select id="source-parser-profile" v-model="draft.parserProfileId" aria-label="解析方案" :disabled="saving || profilesLoading || !!profilesError" class="profile-select">
            <option v-for="profile in profileWorkspace?.profiles ?? []" :key="profile.id" :value="profile.id">{{ profile.name }}</option>
          </select><ElButton :disabled="saving || profilesLoading || !!profilesError || !selectedProfile" @click="showRecognition()">试验与调整</ElButton></div>
          <p v-if="selectedProfile" class="profile-help">{{ enabledEntries.length }} 条启用规则，按方案中的顺序匹配，第一条完整命中生效。</p>
          <p v-if="selectedProfile && !enabledEntries.length" class="profile-help">此方案没有启用规则，扫描结果会标记为需复核，不会使用其他方案兜底。</p>
          <p v-if="!profilesLoading && !profilesError && !selectedProfile" class="profile-help">所选方案已不可用，请重新选择。</p>
          <p class="profile-help">{{ draft.type === 'LOCAL' ? '优先读取文件内的歌曲信息，缺失时按此方案从文件名补充。' : '扫描时按此方案从文件名提取歌名和歌手。' }}可在此试验命名格式，或进入高级配置编写自定义规则。</p>
        </ElFormItem>
        <details :open="advanced" class="source-advanced" @toggle="advanced = ($event.target as HTMLDetailsElement).open"><summary>更多设置 <span>定时扫描</span></summary>
        <ElFormItem label="定时扫描"><ElCheckbox v-model="draft.scanEnabled" :disabled="saving || (!editing && importMode)">启用定时扫描</ElCheckbox><p v-if="!editing && importMode" class="profile-help">导入资料时关闭定时扫描。导入完成后，可在编辑媒体库时开启。</p></ElFormItem>
        <ElFormItem v-if="draft.scanEnabled" label="Cron 表达式" required><ElInput v-model="draft.scanCron" aria-label="扫描 Cron 表达式" placeholder="0 3 * * *" maxlength="120" :disabled="saving" /><p class="profile-help">标准五段：分 时 日 月 周。例：0 3 * * * 每天 03:00；*/30 * * * * 每半小时。时区：Asia/Shanghai。同一来源扫描中跳过，停机期间不逐次补跑。</p></ElFormItem>
        </details>
        </section>
        <section v-if="!editing" v-show="sourceStep === 3" data-source-step="3" class="source-confirmation">
          <dl class="source-confirm-list">
            <div><dt>来源名称</dt><dd>{{ sourceName }}</dd></div>
            <div><dt>媒体位置</dt><dd><span class="source-confirm-type">{{ draft.type === 'LOCAL' ? '本地目录' : 'WebDAV' }}</span>{{ summaryLocation }}</dd></div>
            <div v-if="draft.type === 'WEBDAV' && draft.username"><dt>访问账号</dt><dd>{{ draft.username }}</dd></div>
            <div><dt>添加方式</dt><dd>{{ importingSource ? '导入已有资料包' : '直接扫描目录' }}<span v-if="importingSource && importFile" class="source-confirm-detail">{{ importFile.name }}</span></dd></div>
            <div><dt>文件名识别</dt><dd>{{ selectedProfile?.name || '方案不可用' }}</dd></div>
            <div><dt>文件内信息</dt><dd>{{ draft.type === 'LOCAL' ? '优先读取，缺失时用文件名补充' : importingSource ? '复用资料包，不自动读取媒体内容' : draft.autoExtractEmbedded ? '扫描后在后台按需读取' : '暂不开启，优先使用文件名' }}</dd></div>
            <div><dt>定时扫描</dt><dd>{{ !importingSource && draft.scanEnabled ? draft.scanCron : '未开启' }}<span v-if="!importingSource && draft.scanEnabled" class="source-confirm-detail">时区 Asia/Shanghai；仅保存也会保留此定时设置。</span></dd></div>
            <div v-if="draft.type === 'LOCAL' && draft.useForLxDownloads"><dt>洛雪下载</dt><dd>使用此目录保存新下载</dd></div>
          </dl>
          <p class="source-confirm-note">{{ importingSource ? '保存后上传资料包，接着核对路径并确认导入。不会自动扫描；路径不匹配或上传失败时可继续处理，无需重复新建来源。' : '保存并扫描会在后台整理歌曲，完成后可在来源中查看结果。仅保存不会立即扫描。扫描不会修改原始文件，目录可访问也不代表媒体可播放。' }}</p>
        </section>
        <template #actions>
          <div v-if="profilesError || formError" class="source-footer-feedback">
            <ElAlert v-if="profilesError" :title="profilesError" type="error" :closable="false"><ElButton text :disabled="saving || profilesLoading" @click="loadProfiles">重新加载解析方案</ElButton></ElAlert>
            <ElAlert v-if="formError" :title="formError" type="error" :closable="false" show-icon />
          </div>
          <div class="source-form-actions">
            <ElButton class="source-cancel" :disabled="saving" @click="closeSource()">取消</ElButton>
            <ElButton v-if="!editing && sourceStep > 1" :disabled="saving" @click="previousSourceStep">上一步</ElButton>
            <ElButton v-if="!editing && sourceStep < 3" type="primary" native-type="submit" :disabled="saving || (sourceStep === 2 && profilesLoading)">下一步</ElButton>
            <template v-else>
              <ElButton v-if="!editing && !importMode" :disabled="saving || profilesLoading || !!profilesError || !selectedProfile" @click="save(false)">仅保存</ElButton>
              <ElButton type="primary" native-type="submit" :loading="saving" :disabled="saving || profilesLoading || !!profilesError || !selectedProfile">{{ editing ? '保存修改' : importMode ? '保存并导入资料包' : '保存并扫描' }}</ElButton>
            </template>
          </div>
        </template>
        </MediaSourceWizard>
      </ElForm>
    </ElDialog>

    <LocalFolderPicker v-if="picker" :initial-path="draft.location" :sources="items" :download="draft.useForLxDownloads" @select="confirmFolder" @close="picker = false" />
  </div>
</template>

<style scoped>
.media-library-page :deep(.source-wizard-dialog) { display: flex; flex-direction: column; max-height: 92dvh; margin-top: 4vh; }
.media-library-page :deep(.source-wizard-dialog .el-dialog__header) { flex-shrink: 0; padding: 4px 8px 16px; }
.media-library-page :deep(.source-wizard-dialog .el-dialog__body) { padding: 24px; overflow-y: auto; overscroll-behavior: contain; background: var(--sv-surface-1); }
.source-name { margin-top: 24px; }
.source-methods { display: grid; gap: 12px; width: 100%; }
.source-method-direct, .source-method-package { width: 100%; height: auto; padding: 16px; border: 1px solid var(--sv-border-default); border-radius: 8px; text-align: left; background: var(--sv-surface-2); }
.source-method-direct { justify-content: flex-start; }
.source-method-direct :deep(> span) { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; white-space: normal; }
.source-method-direct strong { color: var(--sv-text-primary); font-size: 14px; font-weight: 600; }
.source-method-direct span span, .source-method-package p { margin: 0; color: var(--sv-text-secondary); font-size: 13px; line-height: 1.8; }
.source-method-package p { margin-top: 5px; padding-left: 22px; }
.source-method-direct.selected, .source-method-package.selected { border-color: var(--sv-accent-primary); background: var(--sv-accent-soft); }
.source-method-package :deep(.el-checkbox) { height: auto; white-space: normal; }
.source-method-package :deep(.el-checkbox__label) { white-space: normal; line-height: 1.7; font-weight: 600; }
.source-local-method { padding: 16px; margin-bottom: 24px; border: 1px solid var(--sv-border-subtle); border-radius: 8px; }
.source-local-method strong { font-size: 14px; font-weight: 600; }
.source-local-method p { margin: 6px 0 0; color: var(--sv-text-secondary); font-size: 14px; line-height: 1.8; }
.source-form-actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; }
.source-form-actions .el-button { margin-left: 0; min-height: 40px; }
.source-form-actions .source-cancel { margin-right: auto; }
.source-footer-feedback { max-height: min(160px, 26dvh); overflow-y: auto; margin-bottom: 12px; }
.source-footer-feedback :deep(.el-alert) { margin-top: 0; }
.source-footer-feedback :deep(.el-alert + .el-alert) { margin-top: 8px; }
.source-editor-actions { margin-top: 24px; }
.source-confirm-list { margin: 0; }
.source-confirm-list > div { display: grid; grid-template-columns: 100px minmax(0, 1fr); gap: 16px; padding: 15px 0; border-bottom: 1px solid var(--sv-border-subtle); font-size: 14px; line-height: 1.8; }
.source-confirm-list > div:first-child { padding-top: 0; }
.source-confirm-list dt { color: var(--sv-text-secondary); }
.source-confirm-list dd { margin: 0; overflow-wrap: anywhere; color: var(--sv-text-primary); }
.source-confirm-type { display: block; margin-bottom: 3px; color: var(--sv-text-secondary); font-size: 12px; }
.source-confirm-detail { display: block; margin-top: 3px; color: var(--sv-text-secondary); font-size: 13px; }
.source-confirm-note { margin: 20px 0 0; color: var(--sv-text-secondary); font-size: 14px; line-height: 1.9; }
.source-wizard-dialog .profile-help { font-size: 13px; }
@media(max-width: 600px) {
  .media-library-page :deep(.source-wizard-dialog) { max-height: 96dvh; margin-top: 2dvh; padding: 12px; }
  .media-library-page :deep(.source-wizard-dialog .el-dialog__body) { padding: 10px; }
  .source-form-actions { flex-wrap: wrap; gap: 10px; }
  .source-form-actions .el-button { min-height: 44px; padding: 10px 14px; }
  .source-form-actions .source-cancel { margin-right: auto; }
  .source-form-actions:has(> :nth-child(4)) { display: grid; grid-template-columns: 1fr 1fr; }
  .source-form-actions:has(> :nth-child(4)) .source-cancel { margin-right: 0; }
  .source-confirm-list > div { grid-template-columns: 1fr; gap: 4px; padding: 13px 0; }
  .source-name { margin-top: 20px; }
  .source-wizard-dialog :deep(.el-input__inner) { font-size: 16px; }
}
.profile-select {
  width: 100%;
}

.profile-field {
  margin-top: 24px;
}
.source-package{display:flex;align-items:center;flex-wrap:wrap;gap:12px;width:100%;margin-top:8px}
.package-choice{position:relative;display:inline-flex;padding:8px 12px;border:1px solid var(--sv-border-subtle);border-radius:8px;cursor:pointer;overflow:hidden}
.package-choice input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer}
.package-choice:focus-within{outline:2px solid var(--sv-accent-primary);outline-offset:2px}
.package-choice.disabled{opacity:.5;cursor:default}
.package-name{overflow-wrap:anywhere;min-width:0}
.source-import :deep(.el-form-item__content){align-items:flex-start;flex-direction:column}
.source-profile-selection { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; width: 100%; }
.source-profile-selection .profile-select { flex: 1; min-width: 180px; width: auto; }
.source-profile-selection .el-button { margin-left: 0; }
.media-library-page :deep(.source-workbench) { display: flex; flex-direction: column; max-height: 92dvh; margin-top: 4vh; }
.media-library-page :deep(.source-workbench .el-dialog__header) { flex-shrink: 0; }
.media-library-page :deep(.media-dialog .el-dialog__title) { display: block; padding-right: 28px; overflow-wrap: anywhere; line-height: 1.5; }
.media-library-page :deep(.source-workbench .el-dialog__body) { overflow-y: auto; overscroll-behavior: contain; }
.media-library-page :deep(.source-workbench .profiles-rail) { position: static; }
.source-workbench-context { display: flex; align-items: center; flex-wrap: wrap; gap: 12px 20px; margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid var(--sv-border-subtle); }
.source-workbench-context p { flex: 1; min-width: 180px; color: var(--sv-text-secondary); font-size: 12px; line-height: 1.9; }

.profile-help {
  width: 100%;
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.8;
  color: var(--el-text-color-secondary);
}

.media-actions .el-button+.el-button {
  margin-left: 0;
}

.folder-selection+.profile-help {
  margin-bottom: 16px;
}

.source-cards {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 20px;
  min-height: 120px;
}

.source-cards>.el-empty {
  grid-column: 1/-1;
}

.source-types {
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
}

.source-types .el-button {
  flex: 1;
  margin-left: 0;
}

.folder-selection {
  display: flex;
  gap: 12px;
  align-items: center;
  width: 100%;
  padding: 12px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--sv-radius-sm);
}

.folder-selection span {
  flex: 1;
  overflow-wrap: anywhere;
  min-width: 0;
}

.source-advanced {
  margin-top: 24px;
  padding: 16px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--sv-radius-sm);
}

.source-advanced summary {
  cursor: pointer;
  font-weight: 600;
}

.source-advanced summary span {
  font-weight: normal;
  color: var(--el-text-color-secondary);
  margin-left: 8px;
}

.source-advanced[open] summary {
  margin-bottom: 20px;
}

@media(max-width:480px) {
  .source-workbench-context { margin-bottom: 20px; padding-bottom: 16px; }
  .source-workbench-context p { display: none; }
}
.source-count { white-space: nowrap; color: var(--sv-text-secondary); font-size: 12px; font-weight: 400; }
.media-actions { justify-content: flex-end; flex-wrap: nowrap; gap: 8px; }
.media-more-button { width: 40px; padding: 0; }
.media-notes { margin-top: 16px; color: var(--sv-text-secondary); font-size: 12px; }
.media-notes summary { display: inline-flex; align-items: center; min-height: 40px; cursor: pointer; }
.media-notes .feature-note { margin: 4px 0 0; }
@media(max-width:768px) {
  .media-actions { gap: 4px; }
  .media-more-button, .media-notes summary { min-width: 44px; min-height: 44px; }
  .source-advanced summary, .package-choice { min-height: 44px; }
  .media-actions > .el-button { min-height: 44px; }
}
</style>
