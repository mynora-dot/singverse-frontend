<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import { ElAlert, ElButton, ElCheckbox, ElEmpty, ElInput } from 'element-plus'
import { ArrowDown, Edit, Search, SetUp } from '@element-plus/icons-vue'
import type { MetadataCandidate, MusicProvider } from '../types'
import { providerNames } from '../types'
import { metadata } from '../api/metadata'
import { equal, present, type useSingleSongScrape } from '../composables/useSingleSongScrape'
import { hasCloseAlternative } from '../candidate-selection'
import MetadataCover from './MetadataCover.vue'
import MetadataFieldComparison from './MetadataFieldComparison.vue'
import { songCoverUrl } from '../utils'

const props = defineProps<{ state: ReturnType<typeof useSingleSongScrape>; versionWarning: string }>()
const emit = defineEmits<{ search: []; settings: []; choose: [candidate: MetadataCandidate]; clear: []; edit: []; cover: [] }>()
// The existing review model remains the sole source of truth for drafts and writes.
const { review, draft, keyword, providers, available, enabled, loading, searching, applying,
  warning, searchError, candidates, selected, fields, edits, cover, changed, autoSelected,
  canSearch, searched, settingsStatus, pendingProviders, searchProgress } = props.state
const pane = ref<'review' | 'candidates'>('review')
const coverFailed = ref(false), retryKey = ref(0)
const uid = useId()
const platforms = Object.keys(providerNames) as MusicProvider[]
const icons: Record<MusicProvider, string> = { NETEASE: 'netease', QQ: 'qq', KUGOU: 'kugou', KUWO: 'kuwo', QISHUI: 'qishui', MIGU: 'migu' }
const icon = (provider: MusicProvider) => `/assets/music-platforms/${icons[provider]}.png`
const currentCover = computed(() => review.value?.values.cover ? songCoverUrl(review.value.song) : null)
const draftCover = computed(() => equal(draft.value?.cover, review.value?.values.cover) ? currentCover.value : cover.value?.url ?? null)
const sortedCandidates = computed(() => [...candidates.value].sort((a, b) => b.score - a.score))
const pendingLabel = computed(() => pendingProviders.value.map(p => providerNames[p]).join('、'))
const fileFormat = computed(() => review.value?.song.relativePath.split('.').pop()?.toUpperCase() || '格式未知')
const fileSize = computed(() => review.value?.song.fileSize == null ? '大小未知' : `${(review.value.song.fileSize / 1024 / 1024).toFixed(1)} MB`)
const sourceLabel = computed(() => !enabled.value ? '平台未启用' : !providers.value.length ? '请选择查询平台' : providers.value.length === available.value.length ? '全部已启用平台' : providers.value.length === 1 ? providerNames[providers.value[0]!] : `已选 ${providers.value.length} 个平台`)
const manualDraft = computed(() => Object.keys(edits.value).length > 0 || (!!cover.value && (cover.value.kind !== 'candidate' || cover.value.id !== selected.value?.id)))
const coverStatus = computed(() => !present(draft.value?.cover) ? '尚未选择封面' : equal(review.value?.values.cover, draft.value?.cover) ? '与当前相同' : changed.value.includes('cover') ? '待应用' : '未勾选，保留当前封面')
watch(searching, value => { if (value) pane.value = 'candidates' }, { immediate: true })
watch(selected, async value => {
  if (!value) return
  const wasCandidates = pane.value === 'candidates'
  pane.value = 'review'
  if (wasCandidates && window.matchMedia?.('(max-width: 700px)')?.matches) {
    await nextTick()
    document.getElementById(`${uid}-review-tab`)?.focus({ preventScroll: true })
  }
})
watch([edits, cover], ([values, selection]) => { if (Object.keys(values).length || selection) pane.value = 'review' }, { deep: true })
function duration(value: unknown) { const seconds = Math.round(Number(value) / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` }
function toggleProvider(provider: MusicProvider, checked: unknown) {
  providers.value = checked ? [...new Set([...providers.value, provider])] : providers.value.filter(p => p !== provider)
}
function switchPane(event: KeyboardEvent) {
  const tabs = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role=tab]'))
  const index = tabs.indexOf(document.activeElement as HTMLButtonElement)
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + 2) % 2
  pane.value = next === 0 ? 'review' : 'candidates'
  tabs[next]?.focus()
}
function focusCandidate(event: KeyboardEvent) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const buttons = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('.review-candidate'))
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  if (index < 0) return
  event.preventDefault()
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
  buttons[next]?.focus()
}
function closeDisclosure(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  const details = event.currentTarget as HTMLDetailsElement
  if (!details.open) return
  event.stopPropagation(); details.open = false; details.querySelector('summary')?.focus()
}
</script>

<template>
  <div v-if="review && draft" class="single-review-workspace">
    <div class="current-strip">
      <MetadataCover :src="currentCover" alt="当前有效封面" empty-text="暂无封面" retryable :retry-key="retryKey" />
      <div class="current-identity">
        <div class="identity-line"><span class="current-label">当前歌曲</span><h3 :title="String(review.values.title ?? '')">{{ review.values.title || '歌名未填写' }}</h3><p :title="(review.values.artists as string[] ?? []).join('、')">{{ (review.values.artists as string[] ?? []).join('、') || '歌手未填写' }}</p></div>
        <div class="file-badges"><span class="file-format">{{ fileFormat }}</span><span>{{ fileSize }}</span><span v-if="review.values.durationMs">平台时长 {{ duration(review.values.durationMs) }}</span></div>
      </div>
      <details class="context-file" @keydown="closeDisclosure">
        <summary>文件信息<ArrowDown aria-hidden="true" /></summary>
        <div class="file-evidence"><strong>{{ review.song.sourceName }}</strong><p>{{ review.song.relativePath }}</p><p v-if="review.song.metadata?.stale">媒体属性已变化，需重新核验媒体；已保存的歌曲资料继续保留。</p></div>
      </details>
    </div>

    <div class="mobile-review-switch" role="tablist" aria-label="审核工作区" @keydown="switchPane">
      <button :id="`${uid}-review-tab`" type="button" role="tab" :aria-controls="`${uid}-review-pane`" :aria-selected="pane === 'review'" :tabindex="pane === 'review' ? 0 : -1" @click="pane = 'review'">字段核对 <span>{{ changed.length }}</span></button>
      <button :id="`${uid}-candidates-tab`" type="button" role="tab" :aria-controls="`${uid}-candidates-pane`" :aria-selected="pane === 'candidates'" :tabindex="pane === 'candidates' ? 0 : -1" @click="pane = 'candidates'">候选歌曲 <span>{{ candidates.length }}</span></button>
    </div>

    <div class="review-workspace" :class="{ 'review-mode': pane === 'review' }">
      <section :id="`${uid}-candidates-pane`" class="candidate-pane" role="tabpanel" :aria-labelledby="`${uid}-candidates-tab`">
        <div class="candidate-tools">
          <div class="pane-title"><div><h3>候选歌曲</h3><span>{{ searching ? '查询中' : searchError ? '查询失败' : searched ? `${candidates.length} 条结果` : '尚未搜索' }}</span></div><ElButton text :icon="SetUp" :disabled="searching || applying" @click="emit('settings')">平台设置</ElButton></div>
          <form class="workspace-search" @submit.prevent="emit('search')"><ElInput v-model="keyword" aria-label="单曲搜索关键词" placeholder="歌名 歌手" maxlength="200" :prefix-icon="Search" :disabled="applying" /><ElButton native-type="submit" :loading="searching" :disabled="!canSearch">重新搜索</ElButton></form>
          <div class="platform-row"><details class="platform-select" @keydown="closeDisclosure"><summary><span>{{ sourceLabel }}</span><ArrowDown aria-hidden="true" /></summary><div class="platform-options"><span class="platform-caption">查询平台</span><ElCheckbox v-for="platform in platforms" :key="platform" :model-value="enabled && available.includes(platform) && providers.includes(platform)" :disabled="!enabled || !available.includes(platform) || searching || applying || loading" @change="value => toggleProvider(platform, value)"><img :src="icon(platform)" alt="" width="16" height="16">{{ providerNames[platform] }}<small v-if="!enabled || !available.includes(platform)">未启用</small></ElCheckbox></div></details><span class="sort-label">按相似度排序</span></div>
          <div v-if="!enabled || !available.length" class="platform-notice"><p>{{ settingsStatus === 'error' ? '无法读取平台配置。' : '平台查询未启用。' }}仍可手工编辑或上传封面。</p><ElButton text type="primary" :disabled="applying" @click="emit('settings')">打开音乐平台设置</ElButton></div>
          <ElAlert v-if="warning" class="search-warning" :title="warning" type="warning" :closable="false" />
          <p v-if="searching" class="search-progress" role="status" aria-live="polite">已完成 {{ searchProgress.completed }}/{{ searchProgress.total }} 个平台<span v-if="pendingLabel"> · 正在查询{{ pendingLabel }}</span><small v-if="candidates.length">可先选择候选并核对字段</small></p>
          <div v-if="coverFailed" class="cover-load-notice" role="status"><span>部分封面加载失败</span><ElButton text :disabled="applying" @click="retryKey++; coverFailed = false">重试封面</ElButton></div>
        </div>
        <div v-if="searching && !candidates.length" class="workspace-state" role="status"><h3>正在搜索匹配结果…</h3><p>各平台返回后会立即显示候选。</p></div>
        <div v-else-if="searchError" class="workspace-state"><h3>平台请求失败</h3><p role="alert">{{ searchError }}</p><ElButton :disabled="!canSearch" @click="emit('search')">重试搜索</ElButton><ElButton @click="emit('edit')">手工编辑</ElButton></div>
        <div v-else-if="!candidates.length" class="workspace-state"><ElEmpty :description="!enabled || !available.length ? '平台查询未就绪' : searched ? '未找到匹配结果' : '尚未搜索歌曲'" :image-size="48" /><p>{{ !enabled || !available.length ? '启用平台后可查询；也可直接完善当前歌曲。' : searched ? '可调整关键词、切换已启用平台，或手工填写。' : '输入歌名和歌手开始搜索。' }}</p><ElButton plain type="primary" @click="emit('edit')">手工编辑元数据</ElButton><ElButton @click="emit('cover')">选择或上传封面</ElButton></div>
        <div v-else class="candidate-scroll" @keydown="focusCandidate">
          <button v-for="candidate in sortedCandidates" :key="candidate.id" type="button" class="review-candidate" :class="{ chosen: selected?.id === candidate.id }" :aria-pressed="selected?.id === candidate.id" :aria-label="`${candidate.track.title}，${candidate.track.artists.join('、')}，${providerNames[candidate.track.provider]}，相似度${Math.round(candidate.score * 100)}%`" :title="[candidate.track.album, candidate.track.releaseDate].filter(Boolean).join(' · ')" :disabled="applying" @click="emit('choose', candidate)">
            <MetadataCover :src="candidate.track.coverUrl ? metadata.candidateCover(candidate.id, 'ORIGINAL') : null" alt="候选歌曲封面" :retry-key="retryKey" @failed="coverFailed = true" />
            <span class="candidate-info"><strong>{{ candidate.track.title }}</strong><span>{{ candidate.track.artists.join('、') || '未知歌手' }}</span><small><img :src="icon(candidate.track.provider)" alt="" width="16" height="16">{{ providerNames[candidate.track.provider] }}</small></span>
            <span class="candidate-score">{{ Math.round(candidate.score * 100) }}%</span>
          </button>
        </div>
      </section>

      <section :id="`${uid}-review-pane`" class="preview-pane" role="tabpanel" :aria-labelledby="`${uid}-review-tab`">
        <div class="review-toolbar"><div><h3>字段核对</h3><p class="review-source"><template v-if="selected"><img :src="icon(selected.track.provider)" alt="" width="16" height="16">{{ providerNames[selected.track.provider] }}<span>{{ Math.round(selected.score * 100) }}% 匹配</span><small v-if="autoSelected">自动选中，待确认</small></template><template v-else>{{ manualDraft ? '手工编辑草稿 · 尚未应用' : '当前入库信息 · 尚未选择候选' }}</template></p></div><div class="review-actions"><ElButton v-if="selected" text :disabled="applying" @click="emit('clear')">取消候选</ElButton><ElButton :icon="Edit" :disabled="applying" @click="emit('edit')">编辑元数据</ElButton></div></div>
        <ElAlert v-if="versionWarning" class="version-warning" :title="versionWarning" type="warning" :closable="false" />
        <p v-else-if="selected && autoSelected && hasCloseAlternative(candidates, selected)" class="alternative-note">存在其他接近候选，请核对录音版本后确认。</p>
        <div class="preview-scroll">
          <MetadataFieldComparison compact :before="review.values" :draft="draft" :fields="fields" :edits="edits" :disabled="applying" @change="fields = $event">
            <template #before-cover><div class="cover-value"><MetadataCover :src="currentCover" alt="当前有效封面" empty-text="暂无封面" retryable :retry-key="retryKey" /><span><strong>当前封面</strong><small>{{ currentCover ? '已保存' : '未填写' }}</small></span></div></template>
            <template #draft-cover><div class="cover-proposal"><div class="cover-value"><MetadataCover :src="draftCover" alt="待核对封面" empty-text="尚未选择封面" retryable :retry-key="retryKey" @failed="coverFailed = true" /><span><strong>{{ cover?.label || '当前封面' }}</strong><small>{{ coverStatus }}</small></span></div><ElButton class="cover-action" plain type="primary" :disabled="applying" @click="emit('cover')">选择封面</ElButton></div></template>
          </MetadataFieldComparison>
          <p class="overwrite-note">空值和相同内容会自动跳过；未勾选的字段保留当前值。</p>
          <p v-if="Object.values(review.song.metadata?.origins ?? {}).some(origin => origin.kind === 'FILE')" class="overwrite-note">人工确认的字段会保存为正式资料，重新扫描、提取和共享更新均保留本地决定。</p>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped src="./single-song-review-workspace.css"></style>
