<script setup lang="ts">
import { requestId as newRequestId } from '../../../../shared/request-id'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElAlert, ElButton, ElDialog, ElDrawer, ElEmpty, ElIcon, ElInput, ElMessage, ElMessageBox, ElOption, ElPagination, ElSelect, ElSkeleton, ElTag } from 'element-plus'
import { ArrowDown, Document, EditPen, Filter, FolderOpened, InfoFilled, MoreFilled, Picture, Plus, Search, VideoPlay } from '@element-plus/icons-vue'
import PageHeader from '../../../shared/ui/PageHeader.vue'
import { formalArtists, formalLibrary, formalStateLabel, formalTitle, type FormalDetail, type FormalDocument } from '../api/formal'
import { songs } from '../api/songs'
import { singleReview } from '../../metadata/api/single-review'
import { mediaVerification } from '../../media-library/api/shareImports'
import type { MediaSong, MediaSource } from '../../media-library/types'
import FormalSongArtwork from '../components/FormalSongArtwork.vue'
import FormalMetadataEditor from '../components/FormalMetadataEditor.vue'
import FormalMetadataDifferences from '../components/FormalMetadataDifferences.vue'
import SongVideoDialog from '../components/SongVideoDialog.vue'

const route = useRoute(), router = useRouter()
const mobileFiltersOpen = ref(false)
const search = ref(''), sourceId = ref(''), page = ref(1), total = ref(0), items = ref<FormalDocument[]>([]), sources = ref<MediaSource[]>([])
const counts = ref<Record<string, number>>({}), loading = ref(false), error = ref(''), detailError = ref(''), busy = ref(false)
const detail = ref<FormalDetail | null>(null), variant = ref<FormalDetail | null>(null), editing = ref<FormalDocument | null>(null), playing = ref<MediaSong | null>(null)
const drawerOpen = ref(false), songLoading = ref(false), variantLoading = ref(false)
const selectedVariant = ref(''), selectedSong = ref('')
type DifferenceItems = Awaited<ReturnType<typeof formalLibrary.differences>>['items']
const difference = ref<{ document: FormalDocument; items: DifferenceItems } | null>(null)
const differenceRequest = ref('')
const inspectedDifferences = ref(new Map<string, number>())
const binding = ref<FormalDocument | null>(null), bindSource = ref(''), bindPath = ref('')
const moving = ref<FormalDocument | null>(null), destinations = ref<FormalDocument[]>([]), destinationSong = ref(''), destinationVariants = ref<FormalDocument[]>([]), destinationVariant = ref('')
const adding = ref(false), versionTitle = ref(''), versionKind = ref('UNKNOWN')
const media = computed(() => variant.value?.children.filter(d => d.type === 'MEDIA') ?? [])
const variants = computed(() => detail.value?.children.filter(d => d.type === 'VARIANT') ?? [])
const sourceName = (id: string | null) => id
  ? sources.value.find(s => s.id === id)?.name ?? '媒体来源暂不可用'
  : '位置已解绑'
const versionKinds: Record<string, string> = {
  UNKNOWN: '待确认类型', MV: '音乐视频', KTV: 'KTV', LIVE: '现场', AUDIO: '音频', OTHER: '其他',
}
function versionLabel(document: FormalDocument) {
  const kind = document.fields.kind
  const label = typeof kind === 'string' && kind ? versionKinds[kind] || kind : versionKinds.UNKNOWN
  return formalTitle(document) + ' · ' + label
}
function durationInSeconds(value: unknown) {
  const milliseconds = typeof value === 'number' || typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(milliseconds) ? milliseconds / 1000 : undefined
}
const location = (id: string) => variant.value?.locations?.find(l => l.media_id === id)
const stateLabel = (id: string) => mediaVerification(location(id)?.state) || ({ UNBOUND: '位置已解绑', REPLACED: '文件已替换' }[location(id)?.state ?? ''] || '待核验')
function fileStateTone(id: string) {
  const state = location(id)?.state
  if (state === 'PRESENT') return 'success'
  return state === 'PENDING' || !state ? 'info' : 'warning'
}
const attempts = new Map<string, { payload: string; id: string }>()
function attempt(key: string, payload: unknown) { const value = JSON.stringify(payload), previous = attempts.get(key); if (previous?.payload === value) return previous.id; const id = newRequestId(); attempts.set(key, { payload: value, id }); return id }
async function refreshCounts() { try { const value = await formalLibrary.statistics(); if (active) counts.value = value } catch {} }
let active = true, generation = 0, detailGeneration = 0, variantGeneration = 0, differenceGeneration = 0
async function load() {
  const token = ++generation; loading.value = true; error.value = ''
  try { const result = await formalLibrary.list(search.value, page.value - 1, sourceId.value); if (active && token === generation) { items.value = result.items; total.value = result.totalElements } }
  catch (failure) { if (active && token === generation) error.value = failure instanceof Error ? failure.message : '曲库读取失败' }
  finally { if (active && token === generation) loading.value = false }
}
async function apply(nextPage = 1) {
  const query: Record<string, string> = { lens: 'formal' }
  if (search.value.trim()) query.search = search.value.trim()
  if (sourceId.value) query.sourceId = sourceId.value
  if (nextPage > 1) query.page = String(nextPage)
  const target = router.resolve({ path: '/library/songs', query })
  if (target.fullPath === route.fullPath) { page.value = nextPage; await load() } else await router.replace(target.fullPath)
}
function openFilesLens() {
  const query: Record<string, string> = { lens: 'songs' }
  if (search.value.trim()) query.search = search.value.trim()
  if (sourceId.value) query.sourceId = sourceId.value
  if (page.value > 1) query.page = String(page.value)
  void router.replace({ path: '/library/songs', query })
}
watch([() => route.query.search, () => route.query.sourceId, () => route.query.page], () => {
  const query = route.query
  search.value = typeof query.search === 'string' ? query.search : ''
  sourceId.value = typeof query.sourceId === 'string' ? query.sourceId : ''
  page.value = Math.max(1, Number(query.page) || 1)
  void load()
}, { immediate: true })
void songs.sources().then(value => { if (active) sources.value = value }).catch(() => { if (active) error.value = '媒体来源读取失败，请刷新重试' })
void refreshCounts()
async function openSong(id: string, childPage = 0) {
  const token = ++detailGeneration
  ++variantGeneration
  drawerOpen.value = true
  songLoading.value = true
  variantLoading.value = false
  selectedSong.value = id
  selectedVariant.value = ''
  detail.value = null
  variant.value = null
  detailError.value = ''
  try {
    const result = await formalLibrary.detail(id, childPage)
    if (!active || token !== detailGeneration) return
    detail.value = result
    const firstVersion = result.children.find(child => child.type === 'VARIANT')
    if (firstVersion) void openVariant(firstVersion.id)
  } catch (failure) {
    if (active && token === detailGeneration) detailError.value = failure instanceof Error ? failure.message : '歌曲资料读取失败'
  } finally {
    if (active && token === detailGeneration) songLoading.value = false
  }
}
async function openVariant(id: string, childPage = 0) {
  const token = ++variantGeneration
  selectedVariant.value = id
  variantLoading.value = true
  variant.value = null
  detailError.value = ''
  try {
    const result = await formalLibrary.detail(id, childPage)
    if (active && token === variantGeneration) variant.value = result
  } catch (failure) {
    if (active && token === variantGeneration) detailError.value = failure instanceof Error ? failure.message : '版本读取失败'
  } finally {
    if (active && token === variantGeneration) variantLoading.value = false
  }
}
function closeDrawer() {
  drawerOpen.value = false
  detail.value = null
  variant.value = null
  detailGeneration++
  variantGeneration++
}
async function saved(document: FormalDocument) {
  editing.value = null
  inspectedDifferences.value.delete(document.id)
  items.value = items.value.map(item => item.id === document.id ? document : item)
  for (const current of [detail, variant]) {
    if (!current.value) continue
    current.value = { ...current.value, document: current.value.document.id === document.id ? document : current.value.document,
      children: current.value.children.map(item => item.id === document.id ? document : item) }
  }
  await load()
}
async function inspectDifferences(document: FormalDocument) {
  const token = ++differenceGeneration
  differenceRequest.value = document.id
  try {
    const result = await formalLibrary.differences(document.id)
    if (!active || token !== differenceGeneration) return
    const currentDocument = items.value.find(item => item.id === document.id) ?? document
    inspectedDifferences.value.set(document.id, result.items.length)
    difference.value = { document: currentDocument, items: result.items }
  } catch (failure) {
    if (active && token === differenceGeneration) ElMessage.error(failure instanceof Error ? failure.message : '差异读取失败')
  } finally {
    if (active && token === differenceGeneration) differenceRequest.value = ''
  }
}
function openDifferenceEditor(document: FormalDocument) {
  difference.value = null
  editing.value = document
}
async function preview(document: FormalDocument) { try { playing.value = (await singleReview.load(document.id)).song } catch (failure) { ElMessage.error(failure instanceof Error ? failure.message : '媒体读取失败') } }
async function split(document: FormalDocument) { if (!variant.value || busy.value) return; busy.value = true; try { await formalLibrary.split(variant.value.document, document.id, attempt('split', [variant.value.document, document.id])); attempts.delete('split'); await refreshCounts(); if (detail.value) await openSong(detail.value.document.id); ElMessage.success('已建立新版本，请单独确认歌词时间轴和音轨') } catch (failure) { ElMessage.error(failure instanceof Error ? failure.message : '拆分失败') } finally { busy.value = false } }
async function bind(document: FormalDocument) { binding.value = document; const old = location(document.id); bindSource.value = old?.source_id ?? ''; bindPath.value = old?.relative_path ?? ''; detailError.value = '' }
async function saveBinding() { if (!binding.value || !bindSource.value || !bindPath.value || busy.value) return; busy.value = true; try { await formalLibrary.rebind(binding.value, bindSource.value, bindPath.value, attempt('binding', [binding.value, bindSource.value, bindPath.value])); attempts.delete('binding'); binding.value = null; if (variant.value) await openVariant(variant.value.document.id); ElMessage.success('文件位置已保存，后台正在核验；已有资料已保留') } catch (failure) { detailError.value = failure instanceof Error ? failure.message : '位置保存失败' } finally { busy.value = false } }
async function beginMove(document: FormalDocument) { moving.value = document; destinationSong.value = ''; destinationVariant.value = ''; destinationVariants.value = []; await findDestination('') }
async function findDestination(keyword: string) { try { destinations.value = (await formalLibrary.list(keyword)).items } catch (failure) { ElMessage.error(failure instanceof Error ? failure.message : '读取目标歌曲失败') } }
async function chooseDestination() {
  const id = destinationSong.value
  destinationVariant.value = ''
  destinationVariants.value = []
  if (!id) return
  try {
    const result = await formalLibrary.detail(id)
    if (moving.value && id === destinationSong.value) {
      destinationVariants.value = result.children.filter(item => item.type === 'VARIANT')
    }
  } catch (failure) {
    if (moving.value && id === destinationSong.value) ElMessage.error(failure instanceof Error ? failure.message : '读取目标版本失败')
  }
}
async function move() { if (!moving.value || !destinationVariant.value || busy.value) return; busy.value = true; try { await formalLibrary.update(moving.value, [], destinationVariant.value, attempt('move', [moving.value, destinationVariant.value])); attempts.delete('move'); moving.value = null; if (detail.value) await openSong(detail.value.document.id); ElMessage.success('已调整媒体版本关联') } catch (failure) { ElMessage.error(failure instanceof Error ? failure.message : '关联失败') } finally { busy.value = false } }
async function createVersion() { if (!detail.value || !versionTitle.value.trim() || busy.value) return; busy.value = true; try { await formalLibrary.createVariant(detail.value.document.id, versionTitle.value.trim(), versionKind.value, attempt('create-version', [detail.value.document.id, versionTitle.value.trim(), versionKind.value])); attempts.delete('create-version'); await refreshCounts(); adding.value = false; versionTitle.value = ''; await openSong(detail.value.document.id) } catch (failure) { detailError.value = failure instanceof Error ? failure.message : '新版本创建失败' } finally { busy.value = false } }
async function replaceMedia(document: FormalDocument) {
  if (busy.value) return
  try { await ElMessageBox.confirm('确认此路径的文件内容已经被替换？系统将登记新媒体，保留原媒体记录与歌曲资料；新文件的时长、音轨需要重新确认。', '确认文件内容变更', { confirmButtonText: '登记新媒体', cancelButtonText: '取消', type: 'warning' }) } catch { return }
  busy.value = true
  try { await formalLibrary.replaceMedia(document, attempt('replace', document)); attempts.delete('replace'); await refreshCounts(); if (detail.value) await openSong(detail.value.document.id); ElMessage.success('新媒体已登记，后台正在核验') } catch (failure) { ElMessage.error(failure instanceof Error ? failure.message : '新媒体登记失败') } finally { busy.value = false }
}
onBeforeUnmount(() => { active = false; generation++; detailGeneration++; variantGeneration++ })
</script>

<template>
  <section class="formal-library">
    <PageHeader title="歌曲与版本">
      <template #meta>
        <p class="library-counts" aria-live="polite">
          全库 {{ counts.SONG ?? '—' }} 首歌曲 · {{ counts.VARIANT ?? '—' }} 个版本 · {{ counts.MEDIA ?? '—' }} 个媒体文件
        </p>
      </template>
      <template #actions>
        <ElButton :icon="FolderOpened" @click="openFilesLens">按文件管理与筛选</ElButton>
        <ElButton type="primary" :icon="Plus" @click="router.push('/library/media')">添加或导入歌曲</ElButton>
      </template>
    </PageHeader>

    <section class="song-catalog" aria-label="正式歌曲列表" :aria-busy="loading">
      <form class="catalog-filters" role="search" aria-label="歌曲资料搜索与筛选" @submit.prevent="apply()">
        <ElInput v-model="search" :prefix-icon="Search" aria-label="搜索正式歌曲资料" placeholder="搜索歌名、演唱者或别名" maxlength="200" clearable />
        <ElButton class="formal-filter-toggle" :icon="Filter" :aria-expanded="mobileFiltersOpen" aria-controls="formal-source-filter" @click="mobileFiltersOpen = !mobileFiltersOpen">筛选</ElButton>
        <ElSelect
          id="formal-source-filter"
          v-model="sourceId"
          class="formal-source-filter"
          :class="{ expanded: mobileFiltersOpen }"
          aria-label="媒体来源"
          clearable
          placeholder="全部来源"
          @change="apply()"
        >
          <ElOption v-for="source in sources" :key="source.id" :value="source.id" :label="source.name" />
        </ElSelect>
        <ElButton type="primary" plain native-type="submit" :loading="loading">搜索</ElButton>
      </form>

      <ElAlert v-if="error" class="catalog-error" type="error" :title="error" :closable="false" show-icon />
      <ElSkeleton v-if="loading && !items.length" class="catalog-placeholder" :rows="5" animated />
      <ElEmpty v-else-if="!items.length && !error" description="还没有符合条件的歌曲资料">
        <ElButton @click="router.push('/library/media')">添加媒体来源或导入资料包</ElButton>
      </ElEmpty>
      <table v-else-if="items.length" class="formal-song-table" role="table" aria-label="歌曲与版本">
        <colgroup>
          <col>
          <col class="artist-column">
          <col class="source-column">
          <col class="status-column">
          <col class="actions-column">
        </colgroup>
        <thead role="rowgroup">
          <tr role="row">
            <th scope="col" role="columnheader">歌曲</th>
            <th scope="col" role="columnheader">演唱者</th>
            <th scope="col" role="columnheader">资料来源</th>
            <th scope="col" role="columnheader">状态</th>
            <th scope="col" role="columnheader">操作</th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          <tr v-for="song in items" :key="song.id" role="row">
            <td class="song-cell" role="cell">
              <div class="song-identity">
                <FormalSongArtwork :cover="song.fields.cover" />
                <button type="button" class="song-name" @click="openSong(song.id)">{{ formalTitle(song) }}</button>
              </div>
            </td>
            <td class="song-artist" role="cell">{{ formalArtists(song) }}</td>
            <td class="song-source" role="cell">{{ formalStateLabel(song.states.title) }}</td>
            <td class="song-status" role="cell">
              <ElTag v-if="inspectedDifferences.get(song.id)" type="warning" effect="light" disable-transitions>{{ inspectedDifferences.get(song.id) }} 项待核对</ElTag>
              <ElTag v-else type="success" effect="light" disable-transitions>资料已保存</ElTag>
            </td>
            <td class="song-actions" role="cell">
              <div class="actions">
                <ElButton link type="primary" :loading="differenceRequest === song.id" @click="inspectDifferences(song)">查看差异</ElButton>
                <ElButton link type="primary" @click="editing = song">订正资料</ElButton>
                <ElButton type="primary" plain @click="openSong(song.id)">查看版本与文件</ElButton>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <footer v-if="total > 0" class="catalog-pagination">
        <ElPagination :current-page="page" :page-size="20" :total="total" :pager-count="5" layout="total, prev, pager, next" @current-change="apply" />
      </footer>
    </section>

    <ElDrawer :model-value="drawerOpen" title="版本与文件" size="min(640px, 100vw)" class="formal-versions-drawer" @close="closeDrawer">
      <div class="versions-content">
        <ElAlert v-if="detailError" type="error" :title="detailError" :closable="false" show-icon />
        <ElSkeleton v-if="songLoading" :rows="4" animated />
        <ElButton v-else-if="!detail && selectedSong" @click="openSong(selectedSong)">重试读取歌曲</ElButton>

        <template v-if="detail">
          <section class="version-identity" aria-label="当前歌曲">
            <FormalSongArtwork :cover="detail.document.fields.cover" />
            <div>
              <h2>{{ formalTitle(detail.document) }}</h2>
              <p>{{ formalArtists(detail.document) }}</p>
            </div>
            <ElTag type="success" effect="light">文字资料已保存</ElTag>
          </section>
          <div v-if="detail.saveStatus?.attachmentsPending || detail.saveStatus?.derivativesPending" class="pending-attachments" role="status">
            <p v-if="detail.saveStatus.attachmentsPending">{{ detail.saveStatus.attachmentsPending }} 项封面正在保存。已有原图继续可用。</p>
            <p v-if="detail.saveStatus.derivativesPending">{{ detail.saveStatus.derivativesPending }} 项衍生文件等待生成。</p>
          </div>

          <section class="version-section">
            <h3>版本</h3>
            <div class="version-toolbar">
              <ElSelect
                v-if="variants.length"
                :model-value="selectedVariant"
                aria-label="选择媒体版本"
                placeholder="选择媒体版本"
                class="version-select"
                @change="id => openVariant(id)"
              >
                <ElOption v-for="item in variants" :key="item.id" :value="item.id" :label="versionLabel(item)" />
              </ElSelect>
              <p v-else class="version-empty">这首歌还没有版本</p>
              <ElButton :icon="Plus" @click="detailError = ''; adding = true">新增版本</ElButton>
              <ElButton v-if="variant" :icon="EditPen" link type="primary" @click="editing = variant.document">订正版本资料</ElButton>
            </div>
            <ElPagination v-if="(detail.childrenPage?.totalElements ?? 0) > 20" :current-page="(detail.childrenPage?.page ?? 0) + 1" :page-size="20" :total="detail.childrenPage?.totalElements ?? 0" :pager-count="5" layout="prev, pager, next" @current-change="page => openSong(detail!.document.id, page - 1)" />
            <p class="version-guidance">
              <ElIcon><InfoFilled /></ElIcon>
              <span>歌词和时间轴属于版本，实际时长与音轨属于媒体文件。关联前请确认演绎和剪辑一致。</span>
            </p>
          </section>

          <section v-if="selectedVariant" class="media-section" :aria-busy="variantLoading">
            <div class="media-heading">
              <h3>媒体文件</h3>
              <span v-if="variant">{{ variant.childrenPage?.totalElements ?? media.length }} 个</span>
            </div>
            <ElSkeleton v-if="variantLoading" :rows="3" animated />
            <ElButton v-else-if="!variant" @click="openVariant(selectedVariant)">重试读取版本</ElButton>
            <ElEmpty v-else-if="!media.length" :image-size="72" description="这个版本尚未关联媒体文件" />
            <article v-for="file in media" :key="file.id" class="media-file">
              <div class="file-heading">
                <span class="file-icon"><ElIcon><Document /></ElIcon></span>
                <div class="file-identity">
                  <h4>{{ location(file.id)?.relative_path || '媒体位置待绑定' }}</h4>
                  <p>{{ sourceName(location(file.id)?.source_id ?? null) }}</p>
                </div>
                <ElTag :type="fileStateTone(file.id)" effect="light">{{ stateLabel(file.id) }}</ElTag>
              </div>
              <div class="media-durations">
                <div>
                  <span>实际媒体时长</span>{{ ' ' }}<strong v-if="durationInSeconds(file.fields.durationMs) !== undefined">{{ durationInSeconds(file.fields.durationMs) }} <small>秒</small></strong>
                  <strong v-else>—</strong>
                </div>
                <div>
                  <span>曲目参考时长</span>{{ ' ' }}<strong v-if="durationInSeconds(detail.document.fields.referenceDurationMs) !== undefined">{{ durationInSeconds(detail.document.fields.referenceDurationMs) }} <small>秒</small></strong>
                  <strong v-else>—</strong>
                </div>
              </div>
              <div class="actions file-actions">
                <ElButton type="primary" plain :icon="VideoPlay" :disabled="location(file.id)?.state !== 'PRESENT'" @click="preview(file)">试听检查</ElButton>
                <ElButton @click="router.push({ path: '/library/audio-processing', query: { song: file.id } })">查看原唱与伴奏</ElButton>
                <ElButton :icon="Picture" @click="router.push({ path: '/library/songs', query: { lens: 'songs', reviewSongId: file.id } })">完善信息与封面</ElButton>
              </div>
              <details class="file-management">
                <summary><ElIcon><MoreFilled /></ElIcon>管理文件<ElIcon class="file-management-chevron"><ArrowDown /></ElIcon></summary>
                <div class="actions">
                  <ElButton :disabled="busy" @click="bind(file)">重新绑定位置</ElButton>
                  <ElButton :disabled="busy" @click="beginMove(file)">关联其他版本</ElButton>
                  <ElButton :disabled="busy" @click="replaceMedia(file)">文件内容已替换</ElButton>
                  <ElButton :disabled="busy" @click="split(file)">拆为新版本</ElButton>
                </div>
              </details>
            </article>
            <ElPagination v-if="(variant?.childrenPage?.totalElements ?? 0) > 20" :current-page="(variant?.childrenPage?.page ?? 0) + 1" :page-size="20" :total="variant?.childrenPage?.totalElements ?? 0" :pager-count="5" layout="prev, pager, next" @current-change="page => openVariant(variant!.document.id, page - 1)" />
          </section>
        </template>
      </div>
    </ElDrawer>
    <FormalMetadataEditor :document="editing" @close="editing = null" @saved="saved" />
    <FormalMetadataDifferences
      :document="difference?.document ?? null"
      :items="difference?.items ?? []"
      @close="difference = null"
      @edit="openDifferenceEditor"
    />
    <ElDialog :model-value="!!binding" title="重新绑定媒体文件位置" width="min(540px, calc(100vw - 24px))" :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy" @close="binding = null">
      <div class="formal-operation-fields">
        <p>填写来源和相对路径。保存后核验路径，歌曲资料、封面与本机订正会保留。</p>
        <ElAlert v-if="detailError" type="error" :title="detailError" :closable="false" show-icon />
        <label for="formal-bind-source">媒体来源</label>
        <ElSelect id="formal-bind-source" v-model="bindSource" aria-label="新的媒体来源" :disabled="busy">
          <ElOption v-for="source in sources" :key="source.id" :value="source.id" :label="source.name" />
        </ElSelect>
        <label for="formal-bind-path">相对路径</label>
        <ElInput id="formal-bind-path" v-model="bindPath" aria-label="新的媒体相对路径" placeholder="华语/歌手/歌曲.mkv" maxlength="2048" :disabled="busy" />
      </div>
      <template #footer>
        <ElButton :disabled="busy" @click="binding = null">取消</ElButton>
        <ElButton type="primary" :loading="busy" :disabled="!bindSource || !bindPath" @click="saveBinding">保存位置</ElButton>
      </template>
    </ElDialog>
    <ElDialog :model-value="!!moving" title="关联媒体版本" width="min(540px, calc(100vw - 24px))" :close-on-click-modal="!busy" :close-on-press-escape="!busy" :show-close="!busy" @close="moving = null">
      <div class="formal-operation-fields">
        <p>选择相同演绎、剪辑与时间轴的版本。不同演唱者的翻唱请保留为不同歌曲。</p>
        <label for="formal-destination-song">目标歌曲</label>
        <ElSelect id="formal-destination-song" v-model="destinationSong" aria-label="目标歌曲" filterable remote :remote-method="findDestination" :disabled="busy" @change="chooseDestination">
          <ElOption v-for="item in destinations" :key="item.id" :value="item.id" :label="formalTitle(item) + ' · ' + formalArtists(item)" />
        </ElSelect>
        <label for="formal-destination-version">目标版本</label>
        <ElSelect id="formal-destination-version" v-model="destinationVariant" aria-label="目标版本" :disabled="busy || !destinationSong">
          <ElOption v-for="item in destinationVariants" :key="item.id" :value="item.id" :label="versionLabel(item)" />
        </ElSelect>
      </div>
      <template #footer>
        <ElButton :disabled="busy" @click="moving = null">取消</ElButton>
        <ElButton type="primary" :loading="busy" :disabled="!destinationVariant" @click="move">保存关联</ElButton>
      </template>
    </ElDialog>
    <ElDialog v-model="adding" title="新增媒体版本" width="min(500px, calc(100vw - 24px))" :close-on-click-modal="!busy" :close-on-press-escape="!busy" :show-close="!busy">
      <div class="formal-operation-fields">
        <ElAlert v-if="detailError" type="error" :title="detailError" :closable="false" show-icon />
        <label for="formal-version-title">版本名称</label>
        <ElInput id="formal-version-title" v-model="versionTitle" aria-label="版本名称" placeholder="例如：2024 现场完整版" maxlength="500" :disabled="busy" />
        <label for="formal-version-kind">版本类型</label>
        <ElSelect id="formal-version-kind" v-model="versionKind" aria-label="版本类型" :disabled="busy">
          <ElOption v-for="(label, kind) in versionKinds" :key="kind" :value="kind" :label="label" />
        </ElSelect>
      </div>
      <template #footer>
        <ElButton :disabled="busy" @click="adding = false">取消</ElButton>
        <ElButton type="primary" :loading="busy" :disabled="!versionTitle.trim()" @click="createVersion">创建版本</ElButton>
      </template>
    </ElDialog>
    <SongVideoDialog :song="playing" @close="playing = null" />
  </section>
</template>

<style scoped>
.formal-library {
  display: grid;
  gap: 16px;
  min-width: 0;
  width: min(100%, 1320px);
  margin-inline: auto;
}
.formal-library > .page-heading { margin-bottom: 0; }
.formal-library :deep(.sv-page-header-copy) {
  display: grid;
  justify-items: start;
  gap: 3px;
  min-width: 0;
}
.formal-library :deep(.sv-page-header-copy h1) { font-size: 26px; line-height: 1.35; }
.library-counts {
  min-width: 0;
  color: var(--sv-text-secondary);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.song-catalog {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--sv-border-subtle);
  border-radius: var(--sv-radius-lg);
  background: var(--sv-surface-2);
  box-shadow: var(--sv-shadow-sm);
}
.catalog-filters {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 18px;
}
.catalog-filters .el-input { flex: 1 1 360px; max-width: 480px; min-width: 0; }
.catalog-filters .el-select { flex: 0 0 156px; min-width: 0; }
.catalog-filters :deep(.el-input__wrapper) { background: var(--sv-surface-1); }
.catalog-filters .formal-filter-toggle { display: none; }
.catalog-error { width: auto; margin: 0 18px 14px; }
.catalog-placeholder { padding: 14px 18px; }
.formal-song-table { width: 100%; table-layout: fixed; border-collapse: collapse; text-align: start; }
.artist-column { width: 16%; }
.source-column { width: 15%; }
.status-column { width: 15%; }
.actions-column { width: 308px; }
.formal-song-table :is(th, td) { padding: 10px 12px; border-top: 1px solid var(--sv-border-subtle); overflow-wrap: anywhere; }
.formal-song-table :is(th, td):first-child { padding-inline-start: 18px; }
.formal-song-table :is(th, td):last-child { padding-inline-end: 18px; }
.formal-song-table th {
  background: var(--sv-surface-1);
  color: var(--sv-text-secondary);
  text-align: start;
  font-size: 13px;
  font-weight: 600;
}
.formal-song-table th:last-child { text-align: end; }
.formal-song-table td { min-width: 0; font-size: 14px; vertical-align: middle; }
.formal-song-table tbody tr:hover { background: var(--sv-surface-1); }
.song-source { color: var(--sv-text-secondary); }
.song-identity { display: flex; align-items: center; gap: 10px; }
.song-name {
  padding: 4px 0;
  min-height: 42px;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--sv-text-primary);
  font: inherit;
  font-weight: 650;
  text-align: start;
  overflow-wrap: anywhere;
  cursor: pointer;
}
.song-name:hover { color: var(--sv-accent-muted); }
.song-name:focus-visible,
.file-management summary:focus-visible { outline: 2px solid var(--sv-accent-primary); outline-offset: 2px; }
.actions, .version-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.actions .el-button, .version-toolbar .el-button { margin: 0; }
.song-actions .actions { justify-content: flex-end; gap: 6px 9px; }
.song-actions .el-button.is-link { padding-inline: 4px; }
.catalog-pagination {
  display: flex;
  justify-content: flex-end;
  padding: 8px 18px;
  border-top: 1px solid var(--sv-border-subtle);
}

:global(.formal-versions-drawer .el-drawer__header) {
  padding: 14px 22px;
  min-height: 62px;
  background: var(--sv-surface-2);
}
:global(.formal-versions-drawer .el-drawer__title) { font-size: 17px; font-weight: 650; }
:global(.formal-versions-drawer .el-drawer__body) { padding: 0; }
.versions-content {
  display: grid;
  align-content: start;
  gap: 18px;
  padding: 20px 22px;
  min-width: 0;
}
.versions-content h2, .versions-content h3, .versions-content h4, .versions-content p { margin: 0; }
.version-identity, .media-file {
  border: 1px solid var(--sv-border-subtle);
  border-radius: var(--sv-radius-md);
  background: var(--sv-surface-2);
  padding: 14px;
}
.version-identity {
  --formal-artwork-size: 60px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
}
.version-identity h2 { font-size: 22px; line-height: 1.35; overflow-wrap: anywhere; }
.version-identity p, .file-identity p { color: var(--sv-text-secondary); overflow-wrap: anywhere; }
.pending-attachments {
  display: grid;
  gap: 4px;
  color: var(--sv-text-secondary);
  font-size: 13px;
}
.version-section, .media-section { display: grid; gap: 9px; min-width: 0; }
.version-section h3, .media-section h3 { font-size: 16px; }
.version-toolbar .version-select { flex: 1 1 208px; min-width: 0; }
.version-toolbar .version-empty { margin-right: auto; color: var(--sv-text-secondary); }
.version-guidance {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--sv-radius-md);
  background: var(--sv-accent-soft);
  color: var(--sv-text-primary);
  font-size: 14px;
  line-height: 1.55;
}
.version-guidance .el-icon { flex: none; color: var(--sv-accent-muted); }
.media-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.media-heading span { font-size: 13px; color: var(--sv-text-secondary); }
.media-file { display: flex; align-items: baseline; flex-wrap: wrap; gap: 10px; }
.file-heading {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  width: 100%;
  gap: 9px;
  align-items: start;
}
.file-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: var(--sv-radius-md);
  color: var(--sv-accent-muted);
  background: var(--sv-accent-soft);
  font-size: 19px;
}
.file-identity h4 { font-size: 15px; overflow-wrap: anywhere; }
.file-identity p { font-size: 13px; }
.media-durations { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; width: 100%; }
.media-durations > div {
  display: grid;
  gap: 2px;
  padding: 7px 10px;
  border: 1px solid var(--sv-border-subtle);
  border-radius: var(--sv-radius-md);
  background: var(--sv-surface-1);
}
.media-durations span, .media-durations small { font-size: 12px; color: var(--sv-text-secondary); }
.media-durations strong { font-size: 17px; font-weight: 650; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.media-durations small { font-weight: 400; }
.file-management[open] { flex-basis: 100%; }
.file-management summary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 40px;
  padding-inline: 8px;
  border-radius: var(--sv-radius-md);
  color: var(--sv-accent-muted);
  font-weight: 600;
  list-style: none;
  cursor: pointer;
}
.file-management summary::-webkit-details-marker { display: none; }
.file-management summary:hover { background: var(--sv-accent-soft); }
.file-management[open] .file-management-chevron { transform: rotate(180deg); }
.file-management .actions { gap: 6px; margin-top: 8px; }
.formal-operation-fields { display: grid; gap: 10px; }
.formal-operation-fields p { margin: 0; color: var(--sv-text-secondary); }
.formal-operation-fields label { font-weight: 600; }

@media (max-width: 920px) {
  .catalog-filters { flex-wrap: wrap; }
  .actions-column { width: 280px; }
  .song-actions .actions { gap: 8px; }
  .song-actions .el-button { font-size: 13px; }
  .formal-song-table :is(th, td) { padding-inline: 8px; }
}
@media (max-width: 768px) {
  .formal-library { gap: 12px; }
  .catalog-filters { padding: 12px; }
  .catalog-filters .el-input { flex-basis: 0; max-width: none; }
  .catalog-filters .formal-filter-toggle { display: inline-flex; }
  .catalog-filters .formal-source-filter { display: none; }
  .catalog-filters .formal-source-filter.expanded { display: flex; order: 1; flex: 1 0 100%; }
  .formal-song-table { display: block; }
  .formal-song-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .formal-song-table colgroup { display: none; }
  .formal-song-table tbody { display: block; }
  .formal-song-table tr {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    column-gap: 8px;
    padding: 9px 12px;
    border-top: 1px solid var(--sv-border-subtle);
  }
  .formal-song-table td, .formal-song-table td:first-child, .formal-song-table td:last-child { padding: 0; border: 0; }
  .song-cell { grid-column: 1; grid-row: 1; align-self: center; }
  .formal-song-table .song-artist { grid-column: 1; grid-row: 2; padding-inline-start: 52px; }
  .song-source { grid-column: 2; grid-row: 2; text-align: end; }
  .song-status { grid-column: 2; grid-row: 1; justify-self: end; }
  .song-actions { grid-column: 1 / -1; }
  .song-actions .actions { justify-content: flex-end; margin-top: 7px; }
  .song-actions .el-button, .catalog-filters .el-button, .file-actions .el-button, .file-management summary, .file-management .el-button, .version-toolbar .el-button { min-height: 44px; }
  .catalog-filters :deep(.el-input__wrapper), .catalog-filters :deep(.el-select__wrapper), .version-toolbar :deep(.el-select__wrapper) { min-height: 44px; }
  .catalog-pagination { padding-inline: 8px; }
}
@media (max-width: 480px) {
  .catalog-filters { display: grid; grid-template-columns: minmax(0, 1fr) auto; }
  .catalog-filters .el-input, .catalog-filters .formal-source-filter.expanded { grid-column: 1 / -1; width: 100%; order: 0; }
  .catalog-filters .formal-filter-toggle { justify-self: start; }
  :global(.formal-versions-drawer .el-drawer__header) { padding-inline: 14px; }
  .versions-content { gap: 14px; padding: 14px 12px; }
  .version-identity { --formal-artwork-size: 48px; grid-template-columns: auto minmax(0, 1fr); }
  .version-identity .el-tag { grid-column: 2; justify-self: start; }
  .version-identity h2 { font-size: 18px; }
  .file-heading { grid-template-columns: auto minmax(0, 1fr); }
  .file-heading .el-tag { grid-column: 2; justify-self: start; }
  .version-toolbar .version-select { flex-basis: 100%; }
}
</style>
