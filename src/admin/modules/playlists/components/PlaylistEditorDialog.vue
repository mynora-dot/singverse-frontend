<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Close, Delete, EditPen, Headset, MagicStick, Plus, Rank, RefreshLeft } from '@element-plus/icons-vue'
import { ElAlert, ElButton, ElDialog, ElIcon, ElInput, type InputInstance } from 'element-plus'
import SongCover from '../../song-management/components/SongCover.vue'
import type { AiService } from '../../ai-settings/types'
import type { Draft, Song } from '../api'
import { playlistSongSource, playlistSongVersion } from '../presentation'

interface EditorForm { name: string; description: string; songIds: string[] }
interface Generation { prompt: string; q: string; limit: number; modelServiceId: string }
const props = defineProps<{
  modelValue: boolean
  editing: boolean
  form: EditorForm
  songs: Record<string, Song>
  generation: Generation
  models: AiService[]
  proposal: Draft | null
  busy: boolean
  generating: boolean
  dirty: boolean
  error: string
  undoLabel: string
}>()
const emit = defineEmits<{
  close: []
  save: []
  'update:form': [value: EditorForm]
  'update:generation': [value: Generation]
  'open-picker': []
  move: [index: number, direction: number]
  reorder: [from: number, to: number]
  remove: [index: number]
  generate: []
  'dismiss-proposal': []
  'use-proposal': []
  undo: []
}>()
const editorId = useId()
const aiOpen = ref(false), metadataExpanded = ref(false)
const promptInput = ref<InputInstance>(), songHeading = ref<HTMLHeadingElement>()
const aiTrigger = ref<HTMLButtonElement>(), songList = ref<HTMLOListElement>()
const workspace = ref<HTMLElement>(), aiHeading = ref<HTMLHeadingElement>()
const dragFrom = ref<number | null>(null), dragOver = ref<number | null>(null)
const blocked = computed(() => props.busy || props.generating)
const title = computed(() => props.editing ? '编辑歌单' : '创建歌单')
const coverIds = computed(() => {
  const ids = props.form.songIds.slice(0, 4)
  return ids.length > 1 && ids.length < 4 ? Array.from({ length: 4 }, (_, i) => ids[i % ids.length]!) : ids
})
const modelName = computed(() => props.models.find(model => model.id === props.generation.modelServiceId)?.name || '未配置模型')
const validLimit = computed(() => Number.isInteger(Number(props.generation.limit)) && Number(props.generation.limit) >= 1 && Number(props.generation.limit) <= 50)
const canGenerate = computed(() => !blocked.value && !!props.generation.prompt.trim() && !!props.generation.modelServiceId && validLimit.value)
const canSave = computed(() => !blocked.value && !!props.form.name.trim() && props.form.songIds.length <= 500)
function updateForm(patch: Partial<EditorForm>) { emit('update:form', { ...props.form, ...patch }) }
function updateGeneration(patch: Partial<Generation>) { emit('update:generation', { ...props.generation, ...patch }) }
function resetWorkspaceScroll() {
  const body = workspace.value?.closest('.el-dialog__body')
  if (body) body.scrollTop = 0
}
async function showAi() { aiOpen.value = true; metadataExpanded.value = false; await nextTick(); resetWorkspaceScroll(); promptInput.value?.textarea?.focus({ preventScroll: true }) }
async function backToSongs() { aiOpen.value = false; await nextTick(); resetWorkspaceScroll(); aiTrigger.value?.focus({ preventScroll: true }) }
async function applyProposal() { emit('use-proposal'); aiOpen.value = false; await nextTick(); resetWorkspaceScroll(); songHeading.value?.focus({ preventScroll: true }) }
async function undo() { emit('undo'); await nextTick(); songHeading.value?.focus() }
async function removeSong(index: number) {
  emit('remove', index)
  await nextTick()
  const buttons = songList.value?.querySelectorAll<HTMLButtonElement>('[data-remove-song]')
  if (buttons?.length) buttons[Math.min(index, buttons.length - 1)]?.focus()
  else songHeading.value?.focus()
}
function startDrag(index: number, event: DragEvent) {
  if (blocked.value) { event.preventDefault(); return }
  dragFrom.value = index
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
  }
}
function endDrag() { dragFrom.value = null; dragOver.value = null }
function drop(index: number) {
  if (!blocked.value && dragFrom.value !== null && dragFrom.value !== index) emit('reorder', dragFrom.value, index)
  endDrag()
}
watch(() => props.modelValue, value => {
  if (value) { aiOpen.value = false; metadataExpanded.value = false; endDrag() }
})
watch(() => props.proposal, async value => {
  if (!aiOpen.value) return
  await nextTick()
  resetWorkspaceScroll()
  if (value) aiHeading.value?.focus({ preventScroll: true })
  else promptInput.value?.textarea?.focus({ preventScroll: true })
})
</script>

<template>
  <ElDialog class="playlist-editor-dialog" :model-value="modelValue" :title="title" width="min(1120px, calc(100vw - 48px))" align-center :show-close="false" :close-on-click-modal="false" :close-on-press-escape="!blocked" :before-close="() => emit('close')">
    <template #header="{ titleId }"><span :id="titleId" class="sr-only">{{ title }}</span></template>
    <div class="playlist-editor">
      <aside class="editor-sleeve" :class="{ 'metadata-expanded': metadataExpanded }" aria-label="歌单资料">
        <div class="sleeve-label"><img src="/assets/brand/logo-mark.svg" width="26" height="26" alt=""><span>歌单资料</span></div>
        <div class="sleeve-artwork" :class="{ 'single-cover': coverIds.length < 2 }" role="img" :aria-label="coverIds.length ? '由所选歌曲封面组成的歌单封面' : '暂无歌单封面'">
          <SongCover v-for="(id, index) in coverIds" :key="`${id}-${index}`" :song-id="id" :title="songs[id]?.title" :fallback-only="!songs[id]?.coverPath" aria-hidden="true" />
          <div v-if="!coverIds.length" class="sleeve-placeholder"><ElIcon><Headset /></ElIcon><span>从第一首歌开始</span></div>
        </div>
        <div class="sleeve-summary"><h2 :title="form.name">{{ form.name || '未命名歌单' }}</h2><p>{{ form.songIds.length }} 首歌曲</p><button type="button" class="sleeve-meta-button" :aria-expanded="metadataExpanded" :aria-controls="`${editorId}-metadata`" :disabled="blocked" @click="metadataExpanded = !metadataExpanded"><ElIcon><EditPen /></ElIcon>{{ metadataExpanded ? '收起资料' : '编辑资料' }}</button></div>
        <div :id="`${editorId}-metadata`" class="sleeve-fields">
          <label :for="`${editorId}-name`">歌单名称</label>
          <ElInput :id="`${editorId}-name`" :model-value="form.name" maxlength="120" aria-label="歌单名称" placeholder="给歌单起个名字" :disabled="blocked" @update:model-value="updateForm({ name: $event })" />
          <label :for="`${editorId}-description`">简介</label>
          <ElInput :id="`${editorId}-description`" :model-value="form.description" type="textarea" :rows="4" maxlength="1000" aria-label="歌单简介" placeholder="记录这张歌单的场景或心情" :disabled="blocked" resize="vertical" @update:model-value="updateForm({ description: $event })" />
        </div>
        <p class="sleeve-count"><ElIcon><Headset /></ElIcon>{{ form.songIds.length }} 首歌曲</p>
      </aside>

      <section ref="workspace" class="editor-workspace" :aria-label="aiOpen ? 'AI 选歌' : '歌曲编排'">
        <header class="editor-heading"><h2>{{ title }}</h2><span class="editor-draft" :class="{ changed: dirty }">{{ dirty ? '尚未保存' : '未修改' }}</span><button type="button" class="editor-icon editor-close" aria-label="关闭歌单编辑" :disabled="blocked" @click="emit('close')"><ElIcon><Close /></ElIcon></button></header>
        <ElAlert v-if="error" class="editor-error" :title="error" type="error" :closable="false" show-icon />

        <template v-if="!aiOpen">
          <div class="songs-toolbar"><div><h3 ref="songHeading" tabindex="-1">歌曲</h3><span class="song-count" aria-live="polite">{{ form.songIds.length }} / 500</span></div><ElButton type="primary" :icon="Plus" :disabled="blocked" @click="emit('open-picker')">选择歌曲</ElButton></div>
          <button ref="aiTrigger" type="button" class="ai-entry" :disabled="blocked" @click="showAi"><span class="ai-entry-icon"><ElIcon><MagicStick /></ElIcon></span><strong>AI 选歌</strong><span>说说你的想法，挑选适合的曲目</span><ElIcon class="ai-entry-arrow"><ArrowRight /></ElIcon></button>
          <div v-if="form.songIds.length" class="song-table-heading" aria-hidden="true"><span>顺序</span><span>歌曲 / 歌手</span><span>调整顺序与移除</span></div>
          <ol v-if="form.songIds.length" ref="songList" class="editor-song-list" aria-label="歌单歌曲顺序">
            <li v-for="(id, index) in form.songIds" :key="id" class="editor-song-row" :class="{ dragging: dragFrom === index, 'drag-target': dragOver === index && dragFrom !== index }" :draggable="!blocked" @dragstart="startDrag(index, $event)" @dragover.prevent="dragOver = dragFrom !== null ? index : null" @drop.prevent="drop(index)" @dragend="endDrag">
              <span class="song-position"><ElIcon class="drag-grip" aria-hidden="true"><Rank /></ElIcon><span>{{ index + 1 }}</span></span>
              <SongCover class="editor-song-art" :song-id="id" :title="songs[id]?.title" :fallback-only="!songs[id]?.coverPath" />
              <div class="song-copy"><strong :title="songs[id]?.title">{{ songs[id]?.title || '已选择歌曲' }}</strong><small :title="songs[id]?.artists.join(' / ') || id">{{ songs[id]?.artists.join(' / ') || id }}</small><small class="song-version" v-if="playlistSongVersion(songs[id])" :title="playlistSongVersion(songs[id])">{{ playlistSongVersion(songs[id]) }}</small><small class="song-source" v-if="playlistSongSource(songs[id])" :title="playlistSongSource(songs[id])">{{ playlistSongSource(songs[id]) }}</small></div>
              <div class="song-actions"><button type="button" class="editor-icon" :disabled="index === 0 || blocked" :aria-label="`上移第${index + 1}首`" title="上移" @click="emit('move', index, -1)"><ElIcon><ArrowUp /></ElIcon></button><button type="button" class="editor-icon" :disabled="index === form.songIds.length - 1 || blocked" :aria-label="`下移第${index + 1}首`" title="下移" @click="emit('move', index, 1)"><ElIcon><ArrowDown /></ElIcon></button><button type="button" class="editor-icon remove-song" data-remove-song :disabled="blocked" :aria-label="`移除第${index + 1}首`" title="移除歌曲" @click="removeSong(index)"><ElIcon><Delete /></ElIcon></button></div>
            </li>
          </ol>
          <div v-else class="editor-empty"><ElIcon><Headset /></ElIcon><h3>歌单里还没有歌曲</h3><p>选几首喜欢的歌，或让 AI 帮你选。</p><ElButton :icon="Plus" :disabled="blocked" @click="emit('open-picker')">选择歌曲</ElButton></div>
          <div class="song-list-note"><span>最多可添加 500 首歌曲</span><span><ElIcon><Rank /></ElIcon>拖动曲目可调整顺序</span></div>
        </template>

        <section v-else class="ai-workspace" aria-label="AI 选歌工作区">
          <div class="ai-heading"><h3 ref="aiHeading" tabindex="-1">AI 选歌<span class="model-badge" :title="modelName">{{ modelName }}</span></h3><ElButton text :icon="ArrowLeft" :disabled="blocked" @click="backToSongs">返回歌曲</ElButton></div>
          <div v-if="proposal" class="proposal-view">
            <div class="proposal-heading"><h3>{{ proposal.name }}</h3><p>{{ proposal.description }}</p><small>已检查 {{ proposal.candidateCount }} / {{ proposal.libraryCount }} 首候选，推荐 {{ proposal.songIds.length }} 首。尚未保存。</small></div>
            <ol class="proposal-songs" aria-label="AI 推荐歌曲"><li v-for="song in proposal.songs" :key="song.id"><SongCover :song-id="song.id" :title="song.title" :fallback-only="!song.coverPath" /><div class="song-copy"><strong>{{ song.title }}</strong><small>{{ song.artists.join(' / ') || '未知歌手' }}</small></div><ElIcon class="proposal-check" aria-hidden="true"><Check /></ElIcon></li></ol>
            <p v-if="!proposal.songIds.length" class="ai-help">没有选到合适的歌曲，可调整要求或手动选歌。</p>
            <p v-else class="replacement-note">使用后将替换名称、简介和当前 {{ form.songIds.length }} 首歌曲，可撤销。</p>
            <div class="proposal-actions"><ElButton :disabled="blocked" @click="emit('dismiss-proposal')">放弃建议</ElButton><ElButton type="primary" :icon="Check" :disabled="blocked || !proposal.songIds.length" @click="applyProposal">使用建议替换歌单</ElButton></div>
          </div>
          <form v-else class="ai-composer" @submit.prevent="canGenerate && emit('generate')">
            <div class="ai-intro"><h3>这次想唱什么？</h3><p>描述场景、歌手或氛围，只从当前 NAS 曲库中选歌。</p></div>
            <label :for="`${editorId}-prompt`">你的想法</label>
            <ElInput :id="`${editorId}-prompt`" ref="promptInput" :model-value="generation.prompt" type="textarea" :rows="4" maxlength="1000" placeholder="例如：适合朋友聚会的华语合唱，节奏轻快" :disabled="blocked" resize="vertical" @update:model-value="updateGeneration({ prompt: $event })" />
            <label :for="`${editorId}-keyword`">候选关键词 <span>可选</span></label>
            <ElInput :id="`${editorId}-keyword`" :model-value="generation.q" maxlength="200" placeholder="歌手、歌名或已有搜索词" :disabled="blocked" @update:model-value="updateGeneration({ q: $event })" />
            <div class="ai-config"><label :for="`${editorId}-model`">模型<select :id="`${editorId}-model`" :value="generation.modelServiceId" aria-label="歌单 AI 模型" :disabled="blocked || !models.length" @change="updateGeneration({ modelServiceId: ($event.target as HTMLSelectElement).value })"><option v-if="!models.length" value="">暂无可用模型</option><option v-for="model in models" :key="model.id" :value="model.id">{{ model.name }}</option></select></label><label :for="`${editorId}-limit`">最多推荐首数<input :id="`${editorId}-limit`" :value="generation.limit" type="number" min="1" max="50" step="1" inputmode="numeric" :aria-invalid="!validLimit" :aria-describedby="!validLimit ? `${editorId}-limit-error` : undefined" :disabled="blocked" @input="updateGeneration({ limit: Number(($event.target as HTMLInputElement).value) })"></label></div>
            <p v-if="!validLimit" :id="`${editorId}-limit-error`" class="field-error" role="alert">推荐首数请输入 1–50 之间的整数。</p>
            <p v-if="!models.length" class="ai-help no-model">尚无可用模型，请先到 AI 设置添加并启用。你仍可返回歌曲手动选歌。</p>
            <p class="ai-help">每次从最多 500 首候选中选择。只发送歌曲标题、歌手和分类，不发送文件路径或音视频。</p>
            <div class="generate-action"><span role="status">{{ generating ? '正在从曲库挑选歌曲，请稍候…' : '先预览推荐结果，再由你决定是否使用。' }}</span><ElButton type="primary" native-type="submit" :icon="generating ? undefined : MagicStick" :loading="generating" :disabled="!canGenerate">生成歌单建议</ElButton></div>
          </form>
        </section>
      </section>
    </div>
    <template #footer><div class="editor-footer"><div class="editor-status" role="status"><ElIcon><Check /></ElIcon><span>{{ undoLabel || (dirty ? '有未保存的修改' : '编辑后记得保存') }}</span><button v-if="undoLabel" type="button" class="undo-button" :disabled="blocked" @click="undo"><ElIcon><RefreshLeft /></ElIcon>撤销</button></div><div class="editor-footer-actions"><ElButton :disabled="blocked" @click="emit('close')">取消</ElButton><ElButton type="primary" :icon="Check" :loading="busy" :disabled="!canSave" @click="emit('save')">保存歌单</ElButton></div></div></template>
  </ElDialog>
</template>

<style scoped>
/* A playlist is a cover and an ordered set of songs: the sleeve holds its identity,
   while the white workspace stays dedicated to arranging or choosing tracks. */
:global(.playlist-editor-dialog) {
  height: min(790px, calc(100dvh - 64px));
  max-height: calc(100dvh - 64px);
  margin: auto;
  padding: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 20px;
}
:global(.playlist-editor-dialog .el-dialog__header) { padding: 0; margin: 0; border: 0; flex: none; }
:global(.playlist-editor-dialog .el-dialog__body) { flex: 1; min-height: 0; padding: 0; overflow: hidden; }
:global(.playlist-editor-dialog .el-dialog__footer) { flex: none; padding: 16px 28px; border-top: 1px solid var(--sv-border-subtle); background: var(--sv-surface-1); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.playlist-editor { position: relative; display: grid; grid-template-columns: 280px minmax(0, 1fr); height: 100%; min-height: 0; }
.playlist-editor h2, .playlist-editor h3, .playlist-editor p { margin: 0; }
.editor-sleeve {
  --sleeve-surface: #26384e;
  --sleeve-text: #f3f6fc;
  --sleeve-muted: #ced8e7;
  --sleeve-border: #607086;
  display: flex;
  flex-direction: column;
  gap: 24px;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 28px 24px;
  background: var(--sleeve-surface);
  color: var(--sleeve-text);
}
.sleeve-label { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 600; }
.sleeve-artwork { flex: none; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; width: 100%; aspect-ratio: 1; overflow: hidden; border-radius: 10px; background: var(--sv-media-stage); }
.sleeve-artwork.single-cover { grid-template-columns: 1fr; grid-template-rows: 1fr; }
.sleeve-artwork :deep(.song-cover) { width: 100%; height: 100%; min-height: 0; border-radius: 0; }
.sleeve-placeholder { display: grid; align-content: center; justify-items: center; gap: 18px; padding: 16px; color: var(--sleeve-muted); font-size: 14px; }
.sleeve-placeholder>.el-icon { font-size: 48px; }
.sleeve-summary { display: none; min-width: 0; }
.sleeve-fields { display: grid; gap: 8px; }
.sleeve-fields label { color: var(--sleeve-muted); font-size: 12px; font-weight: 500; }
.sleeve-fields label:not(:first-child) { margin-top: 12px; }
.sleeve-fields :deep(.el-input__wrapper), .sleeve-fields :deep(.el-textarea__inner) { background: rgb(255 255 255 / 3%); box-shadow: 0 0 0 1px var(--sleeve-border) inset; }
.sleeve-fields :deep(.el-input__wrapper.is-focus), .sleeve-fields :deep(.el-textarea__inner:focus) { box-shadow: 0 0 0 2px #93b4ff inset; }
.sleeve-fields :deep(.el-input__inner), .sleeve-fields :deep(.el-textarea__inner) { color: var(--sleeve-text); font-size: 14px; }
.sleeve-fields :deep(.el-input__inner) { font-size: 16px; font-weight: 600; }
.sleeve-fields :deep(.el-input__wrapper) { min-height: 48px; padding: 0 12px; border-radius: 7px; }
.sleeve-fields :deep(.el-textarea__inner) { min-height: 126px; padding: 12px; line-height: 24px; }
.sleeve-fields :deep(input::placeholder), .sleeve-fields :deep(textarea::placeholder) { color: var(--sleeve-muted); opacity: .85; }
.sleeve-count { display: flex; align-items: center; gap: 10px; margin-top: auto !important; padding-top: 8px; color: var(--sleeve-muted); font-size: 14px; }
.sleeve-count>.el-icon { font-size: 18px; }
.editor-workspace { display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 0 28px 16px; background: var(--sv-surface-2); }
.editor-heading { display: flex; align-items: center; gap: 12px; min-height: 84px; flex: none; padding-right: 44px; }
.editor-heading h2 { font-size: 22px; font-weight: 650; }
.editor-draft { flex: none; padding: 2px 8px; border: 1px solid var(--sv-border-subtle); border-radius: 4px; color: var(--sv-text-secondary); font-size: 12px; line-height: 20px; }
.editor-draft.changed { color: var(--sv-semantic-warn); border-color: var(--sv-semantic-warn); background: var(--sv-semantic-warn-soft); }
.editor-icon { display: inline-grid; place-items: center; flex: none; width: 44px; height: 44px; border: 0; border-radius: 7px; background: transparent; color: var(--sv-text-secondary); cursor: pointer; transition: background .15s, color .15s; }
.editor-icon>.el-icon { font-size: 18px; }
.editor-icon:hover:not(:disabled) { color: var(--sv-accent-primary); background: var(--sv-accent-soft); }
.editor-icon:disabled { opacity: .35; cursor: default; }
.editor-close { position: absolute; top: 20px; right: 16px; }
.editor-error { flex: none; margin-bottom: 12px; }
.songs-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex: none; min-height: 44px; margin-bottom: 12px; }
.songs-toolbar>div { display: flex; align-items: center; gap: 10px; min-width: 0; }
.songs-toolbar h3, .ai-heading h3 { font-size: 16px; font-weight: 600; }
.song-count { padding: 2px 8px; border-radius: 5px; background: var(--sv-surface-1); color: var(--sv-text-secondary); font-size: 12px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.ai-entry { display: flex; align-items: center; gap: 10px; flex: none; width: 100%; min-height: 48px; margin-bottom: 12px; padding: 4px 12px; border: 1px solid var(--sv-border-subtle); border-radius: 8px; background: var(--sv-accent-soft); text-align: left; color: var(--sv-text-secondary); cursor: pointer; }
.ai-entry:hover:not(:disabled) { border-color: var(--sv-accent-primary); }
.ai-entry-icon { display: grid; place-items: center; color: var(--sv-accent-primary); font-size: 20px; }
.ai-entry strong { flex: none; font-size: 14px; font-weight: 600; color: var(--sv-text-primary); }
.ai-entry>span:not(.ai-entry-icon) { font-size: 12px; }
.ai-entry-arrow { margin-left: auto; flex: none; }
.song-table-heading { display: grid; grid-template-columns: 40px minmax(0, 1fr) 132px; align-items: center; gap: 12px; min-height: 28px; flex: none; border-bottom: 1px solid var(--sv-border-subtle); color: var(--sv-text-secondary); font-size: 12px; }
.song-table-heading>span:last-child { text-align: right; white-space: nowrap; }
.editor-song-list { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; list-style: none; margin: 0; padding: 0; scroll-padding: 8px; }
.editor-song-row { display: grid; grid-template-columns: 40px 44px minmax(0, 1fr) 132px; align-items: center; gap: 12px; min-height: 72px; padding: 10px 0; border-bottom: 1px solid var(--sv-border-subtle); border-radius: 4px; }
.editor-song-row:hover { background: var(--sv-surface-1); }
.editor-song-row.dragging { opacity: .4; }
.editor-song-row.drag-target { box-shadow: inset 0 2px var(--sv-accent-primary); }
.song-position { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--sv-text-secondary); font-variant-numeric: tabular-nums; }
.drag-grip { cursor: grab; opacity: 0; }
.editor-song-row:hover .drag-grip, .editor-song-row:focus-within .drag-grip { opacity: 1; }
.editor-song-art { width: 44px; height: 44px; border-radius: 6px; }
.song-copy { min-width: 0; }
.song-copy strong, .song-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.song-copy strong { font-size: 15px; line-height: 24px; font-weight: 550; }
.song-copy .song-version, .song-copy .song-source { font-size: 12px; line-height: 18px; color: var(--sv-text-tertiary); }
.song-copy small { color: var(--sv-text-secondary); font-size: 14px; line-height: 20px; }
.song-actions { display: flex; align-items: center; }
.remove-song:hover:not(:disabled) { color: var(--sv-semantic-danger); background: var(--sv-semantic-danger-soft); }
.song-list-note { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 24px; padding-top: 8px; color: var(--sv-text-secondary); font-size: 12px; }
.song-list-note>span:last-child { display: flex; align-items: center; gap: 4px; }
.editor-empty { flex: 1; display: grid; align-content: center; justify-items: center; gap: 12px; min-height: 220px; padding: 24px; text-align: center; }
.editor-empty>.el-icon { font-size: 40px; color: var(--sv-text-tertiary); }
.editor-empty h3 { font-size: 17px; }
.editor-empty p { font-size: 14px; color: var(--sv-text-secondary); }
.editor-empty>.el-button { margin-top: 8px; }
.ai-workspace { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.ai-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex: none; min-height: 44px; margin-bottom: 16px; }
.ai-heading h3 { display: flex; align-items: center; gap: 10px; min-width: 0; }
.model-badge { display: inline-block; max-width: 180px; padding: 4px 8px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; border-radius: 4px; background: var(--sv-accent-soft); color: var(--sv-text-secondary); font-size: 12px; font-weight: 400; }
.ai-composer, .proposal-view { flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: thin; padding: 0 2px 8px; scroll-padding: 12px; }
.ai-composer>label { display: flex; align-items: center; gap: 8px; margin: 16px 0 8px; color: var(--sv-text-primary); font-size: 14px; }
.ai-composer>label>span { color: var(--sv-text-secondary); font-size: 12px; }
.ai-intro { margin-bottom: 20px; }
.ai-intro h3 { font-size: 20px; font-weight: 600; }
.ai-intro p { margin-top: 8px; font-size: 14px; line-height: 24px; color: var(--sv-text-secondary); }
.ai-composer :deep(.el-textarea__inner) { padding: 12px; line-height: 24px; font-size: 14px; }
.ai-config { display: grid; grid-template-columns: minmax(0, 1fr) 160px; gap: 16px; margin-top: 20px; }
.ai-config label { display: grid; gap: 8px; min-width: 0; font-size: 14px; }
.ai-config input, .ai-config select { width: 100%; min-width: 0; min-height: 44px; padding: 8px 12px; border: 1px solid var(--sv-border-default); border-radius: 7px; color: var(--sv-text-primary); background: var(--sv-surface-2); font: inherit; }
.ai-config input[aria-invalid=true] { border-color: var(--sv-semantic-danger); }
.field-error { margin-top: 8px !important; color: var(--sv-semantic-danger); font-size: 14px; }
.ai-help, .replacement-note { margin-top: 20px !important; font-size: 14px; line-height: 24px; color: var(--sv-text-secondary); }
.no-model { padding: 12px; border-radius: 8px; background: var(--sv-surface-1); }
.generate-action { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 24px; }
.generate-action>span { font-size: 12px; line-height: 20px; color: var(--sv-text-secondary); }
.generate-action>.el-button { flex: none; }
.proposal-heading h3 { font-size: 20px; font-weight: 600; }
.proposal-heading p { margin-top: 8px; color: var(--sv-text-secondary); font-size: 14px; line-height: 24px; }
.proposal-heading small { display: block; margin-top: 12px; color: var(--sv-text-secondary); font-size: 12px; line-height: 20px; }
.proposal-songs { margin: 20px 0 0; padding: 0; list-style: none; }
.proposal-songs li { display: flex; align-items: center; gap: 12px; min-height: 72px; padding: 12px 0; border-bottom: 1px solid var(--sv-border-subtle); }
.proposal-songs .song-copy { flex: 1; }
.proposal-check { color: var(--sv-accent-primary); margin: 0 8px; }
.proposal-actions { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-top: 20px; }
.proposal-actions .el-button { margin-left: 0; }
.editor-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; text-align: left; }
.editor-status { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 44px; color: var(--sv-text-secondary); font-size: 12px; }
.editor-status>span { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.editor-status>.el-icon { flex: none; }
.editor-footer-actions { flex: none; display: flex; align-items: center; gap: 12px; }
.editor-footer-actions .el-button { min-width: 96px; margin: 0; }
.editor-footer-actions .el-button--primary { min-width: 136px; }
.undo-button { display: inline-flex; align-items: center; justify-content: center; gap: 4px; flex: none; min-width: 64px; min-height: 44px; padding: 0 8px; border: 0; border-radius: 6px; background: transparent; color: var(--sv-accent-primary); font: inherit; font-size: 14px; cursor: pointer; }
.undo-button:hover:not(:disabled) { background: var(--sv-accent-soft); }
.sleeve-meta-button { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0; border: 0; background: none; color: var(--sleeve-text); font: inherit; font-size: 14px; cursor: pointer; }
.playlist-editor :deep(.el-button), .editor-footer :deep(.el-button) { min-height: 44px; font-size: 14px; }
.playlist-editor :deep(.el-input__wrapper) { min-height: 44px; }
.playlist-editor button:focus-visible, .editor-footer button:focus-visible, .playlist-editor select:focus-visible, .playlist-editor input[type=number]:focus-visible { outline: 3px solid var(--sv-accent-primary); outline-offset: 2px; }
.sleeve-meta-button:focus-visible { outline-color: #93b4ff !important; }
.songs-toolbar h3:focus-visible, .ai-heading h3:focus-visible { outline: 2px solid var(--sv-accent-primary); outline-offset: 4px; }

@media (max-width: 960px) and (min-width: 701px) {
  .playlist-editor { grid-template-columns: 240px minmax(0, 1fr); }
  .editor-sleeve { padding: 24px 20px; gap: 20px; }
  .editor-workspace { padding: 0 20px 16px; }
  .editor-song-row { grid-template-columns: 24px 44px minmax(0, 1fr) 132px; gap: 8px; }
  .song-table-heading { grid-template-columns: 24px minmax(0, 1fr) 132px; gap: 8px; }
  .drag-grip { display: none; }
  .ai-entry>span:not(.ai-entry-icon) { display: none; }
}
@media (max-width: 700px) {
  :global(.playlist-editor-dialog) { width: 100% !important; max-width: none; height: 100dvh; max-height: 100dvh; margin: 0; border: 0; border-radius: 0; }
  :global(.playlist-editor-dialog .el-dialog__body) { overflow-y: auto; scroll-padding: 16px; }
  :global(.playlist-editor-dialog .el-dialog__footer) { padding: 12px 16px max(12px, env(safe-area-inset-bottom)); }
  .playlist-editor { display: flex; flex-direction: column; height: auto; min-height: 100%; }
  .editor-sleeve { display: grid; grid-template-columns: 72px minmax(0, 1fr); align-items: start; gap: 12px 16px; overflow: visible; padding: 20px 16px 12px; }
  .sleeve-label, .sleeve-count { display: none; }
  .sleeve-artwork { width: 72px; margin-top: 4px; border-radius: 7px; }
  .sleeve-summary { display: block; padding-right: 40px; }
  .sleeve-summary h2 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 18px; line-height: 26px; font-weight: 600; }
  .sleeve-summary p { margin-top: 4px; color: var(--sleeve-muted); font-size: 12px; }
  .sleeve-fields { display: none; grid-column: 1 / -1; padding: 4px 0 8px; }
  .metadata-expanded .sleeve-fields { display: grid; }
  .sleeve-fields :deep(.el-input__inner), .sleeve-fields :deep(.el-textarea__inner) { font-size: 16px; }
  .editor-workspace { flex: 1; min-height: 0; padding: 0 16px 16px; }
  .editor-heading { min-height: 64px; padding-right: 0; }
  .editor-heading h2 { font-size: 20px; }
  .editor-close { top: 12px; right: 8px; color: var(--sleeve-text, #f3f6fc); }
  .editor-close:hover:not(:disabled) { color: #fff; background: rgb(255 255 255 / 12%); }
  .songs-toolbar { margin-bottom: 12px; }
  .ai-entry { gap: 8px; padding: 6px 10px; }
  .ai-entry>span:not(.ai-entry-icon) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .song-table-heading { grid-template-columns: 68px minmax(0, 1fr) 132px; gap: 8px; }
  .song-table-heading>span:first-child { white-space: nowrap; }
  .editor-song-list { flex: none; overflow: visible; }
  .editor-song-row { grid-template-columns: 16px 44px minmax(0, 1fr) 132px; gap: 8px; min-height: 72px; }
  .song-position { justify-content: center; }
  .drag-grip { display: none; }
  .song-copy strong { font-size: 14px; }
  .song-list-note>span:last-child { display: none; }
  .editor-empty { min-height: 260px; }
  .ai-heading { gap: 8px; margin-bottom: 16px; }
  .ai-heading h3 { gap: 6px; }
  .model-badge { max-width: 105px; }
  .ai-composer, .proposal-view { overflow: visible; padding: 0 0 12px; }
  .ai-composer :deep(.el-input__inner), .ai-composer :deep(.el-textarea__inner), .ai-config select, .ai-config input { font-size: 16px; }
  .ai-config { grid-template-columns: minmax(0, 1fr) 120px; gap: 12px; }
  .generate-action { align-items: stretch; flex-direction: column; gap: 12px; }
  .generate-action>.el-button { width: 100%; }
  .proposal-actions { display: grid; grid-template-columns: 1fr; }
  .proposal-actions>.el-button { width: 100%; }
  .editor-footer { flex-wrap: wrap; gap: 8px; }
  .editor-status { flex: 1 0 100%; min-height: 20px; }
  .editor-status:has(.undo-button) { min-height: 44px; }
  .editor-status>span { flex: 1; }
  .editor-footer-actions { width: 100%; gap: 12px; }
  .editor-footer-actions>.el-button { flex: 1; min-width: 0; }
  .editor-footer-actions>.el-button--primary { flex: 1.6; min-width: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .playlist-editor *, .editor-footer * { transition: none !important; scroll-behavior: auto !important; }
}
</style>
