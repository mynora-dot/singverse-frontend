<script setup lang="ts">
import { computed } from 'vue'
import { ElButton, ElCheckbox, ElTag } from 'element-plus'
import { fieldNames } from '../types'
import { reviewFields } from '../single-types'
import type { Values, ReviewField, ReviewEdits, LyricsState } from '../single-types'
import { fieldEqual, fieldPresent, present } from '../composables/useSingleSongScrape'
import ReviewLyricsPreview from './ReviewLyricsPreview.vue'
const props = defineProps<{ before: Values; draft: Values; fields: ReviewField[]; edits: ReviewEdits; lyricsState: LyricsState; lyricsError: string; disabled?: boolean; compact?: boolean }>()
const emit = defineEmits<{ change: [fields: ReviewField[]]; retryLyrics: [] }>()
const differences = computed(() => reviewFields.filter(field => hasChange(field)).length)
const lyricMessage = computed(() => ({ IDLE: '选择候选后获取歌词', LOADING: '正在获取歌词…', AVAILABLE: '', MISSING: '平台未提供歌词', UNSUPPORTED: '该平台暂未接入歌词', ERROR: props.lyricsError || '歌词获取失败' })[props.lyricsState])
function hasChange(field: ReviewField) { return fieldPresent(props.draft, field) && !fieldEqual(props.before, props.draft, field) }
function selected(field: ReviewField) { return props.fields.includes(field) && hasChange(field) }
function toggle(field: ReviewField, checked: unknown) { emit('change', checked ? [...new Set([...props.fields, field])] : props.fields.filter(f => f !== field)) }
function state(field: ReviewField) {
  if (!fieldPresent(props.draft, field)) return '无候选值'
  if (fieldEqual(props.before, props.draft, field)) return '无变化'
  if (!props.fields.includes(field)) return '不应用'
  return fieldPresent(props.before, field) ? '将修改' : '待补全'
}
function compactState(field: ReviewField) { return ({ '不应用': '不应用', '无候选值': '跳过', '无变化': '相同', '将修改': '修改', '待补全': '补全' })[state(field)] }
function displayValue(value: unknown, field: string): string {
  if (!present(value)) return '—'
  if (Array.isArray(value)) return value.join('、')
  if (field === 'durationMs') { const seconds = Math.round(Number(value) / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` }
  if (field === 'cover') return '已选择封面'
  return String(value)
}
</script>
<template>
  <div class="field-comparison" :class="{ compact }"><table><caption class="sr-only">核对当前值和候选值，勾选需要应用的字段</caption><thead><tr><th scope="col">应用字段</th><th scope="col">{{ compact ? '当前信息' : '当前值' }}</th><th scope="col">{{ compact ? '候选信息' : '候选 / 编辑值' }}<span v-if="compact" class="difference-count">{{ differences }} 项差异</span></th><th v-if="!compact" scope="col">状态</th></tr></thead><tbody>
    <tr v-for="field in reviewFields" :key="field" :data-field="field" :class="{ 'field-selected': selected(field), 'cover-row': field === 'cover', 'lyrics-row': field === 'lyrics' }">
      <th scope="row"><ElCheckbox :aria-label="`应用${fieldNames[field]}`" :model-value="compact ? selected(field) : fields.includes(field)" :disabled="disabled || !hasChange(field)" @change="value => toggle(field, value)">{{ compact && field === 'durationMs' ? '平台时长' : fieldNames[field] }}</ElCheckbox></th>
      <td data-label="当前值">
        <slot v-if="compact && field === 'cover'" name="before-cover">{{ displayValue(before[field], field) }}</slot>
        <template v-else-if="field === 'lyrics'">
          <ReviewLyricsPreview v-if="fieldPresent(before, field)" :value="before.lyrics" label="当前歌词" />
          <span v-else class="missing-value">{{ compact ? '未填写' : '—' }}</span>
        </template>
        <span v-else :class="{ 'missing-value': !fieldPresent(before, field) }">{{ compact && !fieldPresent(before, field) ? '未填写' : displayValue(before[field], field) }}</span>
      </td>
      <td data-label="候选 / 编辑值">
        <slot v-if="compact && field === 'cover'" name="draft-cover">{{ displayValue(draft[field], field) }}</slot>
        <div v-else class="proposed-value">
          <div v-if="field === 'lyrics'" class="lyric-proposal">
            <ReviewLyricsPreview v-if="lyricsState === 'AVAILABLE'" :value="draft.lyrics" label="候选歌词" />
            <template v-else>
              <span class="missing-value" role="status">{{ lyricMessage }}</span>
              <ElButton v-if="lyricsState === 'ERROR'" link type="primary" :disabled="disabled" @click="emit('retryLyrics')">重试歌词</ElButton>
            </template>
          </div>
          <div v-else>
            <span :class="{ 'missing-value': !present(draft[field]) }">{{ compact && !present(draft[field]) ? '未填写' : displayValue(draft[field], field) }}</span>
            <small v-if="Object.hasOwn(edits, field)" class="edited">手工编辑</small>
          </div>
          <span v-if="compact && (field !== 'lyrics' || lyricsState === 'AVAILABLE')" class="field-status" :class="{ pending: selected(field) }">{{ compactState(field) }}</span>
        </div>
      </td>
      <td v-if="!compact"><ElTag v-if="field !== 'lyrics' || lyricsState === 'AVAILABLE'" :type="state(field) === '将修改' ? 'warning' : state(field) === '待补全' ? 'success' : 'info'" size="small">{{ state(field) }}</ElTag></td>
    </tr>
  </tbody></table></div>
</template>
<style scoped>
.field-comparison {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  table-layout: fixed;
}

th,
td {
  text-align: left;
  padding: 12px 8px;
  border-bottom: 1px solid var(--sv-border-subtle);
  vertical-align: middle;
  overflow-wrap: anywhere;
}

thead th {
  color: var(--sv-text-secondary);
  font-weight: 500;
  background: var(--sv-surface-3);
}

th:first-child {
  width: 98px;
}

th:last-child {
  width: 74px;
}

:deep(.el-checkbox) {
  margin-right: 0;
  white-space: normal;
  height: auto;
}

:deep(.el-checkbox__label) {
  font-size: 12px;
  padding-left: 8px;
}

td {
  color: var(--sv-text-secondary);
}

.edited {
  display: block;
  color: var(--el-color-primary);
  margin-top: 4px;
}

.lyric-proposal .el-button {
  display: flex;
  min-height: 44px;
  padding-inline: 0;
}

.lyrics-row:has(details[open]) > th,
.lyrics-row:has(details[open]) > td {
  vertical-align: top;
}

.lyrics-row:has(details[open]) .proposed-value {
  align-items: flex-start;
}

.lyric-proposal {
  flex: 1;
}

@media (min-width: 701px) {
  .lyrics-row:has(details[open]) .field-status {
    margin-top: 9px;
  }
}

@media (max-width: 560px) {
  .field-comparison {
    overflow: visible;
  }

  table,
  tbody {
    display: block;
  }

  thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  tbody tr {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 12px 16px;
    padding: 16px 0;
    border-bottom: 1px solid var(--sv-border-subtle);
  }

  tbody th,
  tbody td {
    width: auto;
    padding: 0;
    border: 0;
  }

  tbody th {
    grid-column: 1;
    grid-row: 1;
  }

  td:last-child {
    grid-column: 2;
    grid-row: 1;
    justify-self: end;
  }

  td[data-label]::before {
    content: attr(data-label);
    display: block;
    margin-bottom: 4px;
    color: var(--sv-text-tertiary);
    font-size: 12px;
  }
}

.compact { overflow: visible; }
.compact table { font-size: 14px; line-height: 1.6; }
.compact th, .compact td { padding: 4px 16px; }
.compact thead th { background: transparent; font-size: 12px; border-bottom-color: var(--sv-border-default); padding-block: 8px; }
.compact thead th:first-child { width: 132px; }
.compact thead th:nth-child(2) { width: 40%; }
.compact thead th:last-child { width: auto; color: var(--sv-text-primary); }
.compact tbody th { width: 132px; height: 56px; }
.compact tbody td { color: var(--sv-text-primary); }
.compact tbody tr.field-selected { background: var(--sv-accent-soft); }
.compact tbody tr.cover-row th, .compact tbody tr.cover-row td { padding-block: 16px; }
.compact :deep(.el-checkbox) { min-height: 44px; min-width: 44px; font-weight: 500; }
.compact :deep(.el-checkbox__label) { padding-left: 12px; font-size: 14px; color: var(--sv-text-secondary); line-height: 1.5; }
.compact :deep(.el-checkbox__inner) { width: 18px; height: 18px; border-radius: 3px; }
.compact :deep(.el-checkbox__inner::after) { left: 6px; top: 3px; }
.compact :deep(.el-checkbox.is-checked .el-checkbox__label) { color: var(--sv-text-primary); }
.compact :deep(.el-checkbox__input.is-disabled .el-checkbox__inner) { background: var(--sv-surface-1); }
.compact .missing-value { color: var(--sv-text-tertiary); }
.compact .proposed-value { display: flex; justify-content: space-between; align-items: center; gap: 12px; min-height: 35px; }
.compact .proposed-value > div { min-width: 0; }
.compact .field-status { flex: none; color: var(--sv-text-tertiary); font-size: 12px; white-space: nowrap; }
.compact .field-status.pending, .difference-count { border: 1px solid color-mix(in srgb, var(--sv-accent-primary) 28%, transparent); border-radius: var(--sv-radius-sm); background: var(--sv-surface-2); padding: 0 5px; color: var(--sv-accent-muted); font-size: 12px; line-height: 20px; }
.difference-count { display: inline-block; margin-left: 8px; font-weight: 500; }
.compact .edited { font-size: 12px; }
@media (min-width: 701px) and (max-width: 1150px) {
  .compact th, .compact td { padding-inline: 10px; }
  .compact thead th:first-child, .compact tbody th { width: 108px; }
  .compact thead th:nth-child(2) { width: 32%; }
  .compact :deep(.el-checkbox__label) { padding-left: 8px; }
}
@media (max-width: 700px) {
  .compact table, .compact tbody { display: block; }
  .compact thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .compact tbody tr { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); column-gap: 16px; row-gap: 0; padding: 4px 12px 14px; border-bottom: 1px solid var(--sv-border-subtle); }
  .compact tbody th { grid-column: 1 / -1; grid-row: 1; }
  .compact tbody td[data-label] { grid-row: 2; justify-self: stretch; }
  .compact tbody th, .compact tbody td { width: auto; height: auto; padding: 0; border: 0; }
  .compact tbody tr.cover-row th, .compact tbody tr.cover-row td { padding-block: 0; }
  .compact tbody td[data-label]::before { content: attr(data-label); display: block; margin-bottom: 6px; color: var(--sv-text-tertiary); font-size: 12px; }
  .compact tbody td[data-label="候选 / 编辑值"]::before { content: '候选信息'; }
  .compact tbody td[data-label="当前值"]::before { content: '当前信息'; }
  .compact tbody td { font-size: 16px; }
  .compact :deep(.el-checkbox) { width: 100%; }
  .compact :deep(.el-checkbox__label) { font-size: 16px; padding-left: 10px; }
  .compact .proposed-value { display: block; min-height: 26px; }
  .compact .field-status { position: absolute; top: 16px; right: 12px; }
}
</style>
