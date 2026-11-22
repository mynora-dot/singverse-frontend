<script setup lang="ts">
import { computed } from 'vue'
import { ElButton, ElDialog, ElEmpty } from 'element-plus'
import { formalArtists, formalTitle, type FormalDocument } from '../api/formal'

interface DifferenceItem {
  field_name: string
  source_key: string
  incoming_json: string
}

const props = defineProps<{ document: FormalDocument | null; items: readonly DifferenceItem[] }>()
const emit = defineEmits<{ close: []; edit: [document: FormalDocument] }>()

const labels: Record<string, string> = {
  title: '名称',
  artists: '演唱署名',
  credits: '演唱人员',
  aliases: '别名',
  album: '发行名称',
  releaseId: '关联发行',
  releaseDate: '发行日期',
  referenceDurationMs: '曲目参考时长（毫秒）',
  kind: '版本类型',
  languages: '语言',
  timelineDurationMs: '版本时间轴（毫秒）',
  durationMs: '实际媒体时长（毫秒）',
  lyrics: '歌词资料',
  lyricsAsset: '歌词文件',
  cover: '封面',
  workId: '关联作品',
  tagIds: '关联标签',
  externalIds: '外部标识',
  parentId: '上级关联',
}

function formatValue(value: unknown): string {
  if (value == null || value === '') return '未填写'
  if (Array.isArray(value)) return value.length ? value.map(formatValue).join('、') : '未填写'
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}

function formatIncoming(json: string): string {
  let value: unknown
  try { value = JSON.parse(json) }
  catch { return json || '未填写' }
  return value === null ? '清空' : formatValue(value)
}

const rows = computed(() => props.items.map(item => {
  const { field_name: field, source_key: source } = item
  const document = props.document
  const current = field === 'parentId' ? document?.parentId : document?.fields[field]
  return {
    key: JSON.stringify([field, source]),
    label: Object.hasOwn(labels, field) ? labels[field] : field,
    current: document?.states[field]?.status === 'CLEARED' ? '已清空' : formatValue(current),
    incoming: formatIncoming(item.incoming_json),
    shared: source.startsWith('SHARED:'),
  }
}))
const sourceLabel = computed(() => {
  const sharedCount = rows.value.filter(row => row.shared).length
  if (!sharedCount) return { header: '其他来源的新值', mixed: false }
  if (sharedCount === rows.value.length) return { header: '共享资料的新值', mixed: false }
  return { header: '来源提供的新值', mixed: true }
})

function edit() {
  if (props.document) emit('edit', props.document)
}
</script>

<template>
  <ElDialog
    :model-value="!!document"
    class="formal-differences-dialog"
    width="min(740px, calc(100vw - 24px))"
    align-center
    title="待核对的资料差异"
    @close="emit('close')"
  >
    <template #header="{ titleId, titleClass }">
      <h2 :id="titleId" :class="titleClass">待核对的资料差异</h2>
      <div v-if="document" class="comparison-context">
        <strong>{{ formalTitle(document) }}</strong>
        <span>{{ formalArtists(document) }}</span>
        <span v-if="rows.length" class="comparison-count">{{ rows.length }} 项待核对</span>
      </div>
    </template>

    <template v-if="rows.length">
      <div class="comparison-table" tabindex="0" role="region" aria-label="资料字段差异对照">
        <table>
          <colgroup><col class="comparison-field"><col><col></colgroup>
          <thead>
            <tr><th scope="col">资料字段</th><th scope="col">本机当前值</th><th scope="col">{{ sourceLabel.header }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.key">
              <th scope="row">{{ row.label }}</th>
              <td><span class="comparison-value">{{ row.current }}</span></td>
              <td class="comparison-incoming">
                <span class="comparison-value">{{ row.incoming }}</span>
                <small v-if="sourceLabel.mixed">{{ row.shared ? '共享资料' : '其他来源' }}</small>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="comparison-note">已保留本机当前值。可前往订正资料确认采用的内容。</p>
    </template>
    <ElEmpty v-else :image-size="64" description="当前没有待核对的资料差异" />

    <template #footer>
      <ElButton @click="emit('close')">关闭</ElButton>
      <ElButton type="primary" @click="edit">订正正式资料</ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
:global(.formal-differences-dialog.el-dialog) {
  display: flex;
  flex-direction: column;
  max-height: calc(100dvh - 24px);
  padding: 0;
  overflow: hidden;
}
:global(.formal-differences-dialog .el-dialog__header) {
  margin: 0;
  padding: 20px 52px 16px 24px;
  border-bottom: 1px solid var(--sv-border-subtle);
}
:global(.formal-differences-dialog .el-dialog__headerbtn) { top: 10px; right: 9px; }
:global(.formal-differences-dialog h2.el-dialog__title) {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
}
:global(.formal-differences-dialog .el-dialog__body) {
  min-height: 0;
  padding: 16px 24px 20px;
  overflow: auto;
}
:global(.formal-differences-dialog .el-dialog__footer) {
  padding: 12px 24px;
  border-top: 1px solid var(--sv-border-subtle);
}
.comparison-context {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  margin-top: 6px;
  overflow-wrap: anywhere;
  color: var(--sv-text-secondary);
  font-size: 13px;
}
.comparison-context strong { color: var(--sv-text-primary); font-weight: 600; }
.comparison-count {
  padding: 2px 7px;
  border-radius: var(--sv-radius-sm);
  color: var(--sv-semantic-warn);
  background: var(--sv-semantic-warn-soft);
  font-size: 12px;
  font-weight: 600;
}
.comparison-table {
  border: 1px solid var(--sv-border-subtle);
  border-radius: var(--sv-radius-md);
  overflow: hidden;
}
.comparison-table:focus-visible { outline: 2px solid var(--sv-accent-primary); outline-offset: 2px; }
table {
  width: 100%;
  border-spacing: 0;
  table-layout: fixed;
  text-align: left;
  font-size: 14px;
}
.comparison-field { width: 23%; }
th, td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--sv-border-subtle);
  vertical-align: top;
  overflow-wrap: anywhere;
}
thead th {
  color: var(--sv-text-secondary);
  background: var(--sv-surface-3);
  font-size: 13px;
  font-weight: 600;
}
tbody th { font-weight: 650; }
tbody tr:last-child > * { border-bottom: 0; }
.comparison-incoming {
  color: var(--sv-text-primary);
  background: color-mix(in srgb, var(--sv-semantic-warn-soft), var(--sv-surface-2) 40%);
}
.comparison-value { white-space: pre-wrap; }
.comparison-incoming small {
  display: block;
  margin-top: 4px;
  color: var(--sv-text-secondary);
  font-size: 12px;
}
.comparison-note { margin: 12px 0 0; color: var(--sv-text-secondary); font-size: 14px; }
@media (max-width: 560px) {
  :global(.formal-differences-dialog .el-dialog__header) { padding-inline: 14px 52px; }
  :global(.formal-differences-dialog .el-dialog__body),
  :global(.formal-differences-dialog .el-dialog__footer) { padding-inline: 14px; }
  :global(.formal-differences-dialog .el-dialog__footer .el-button) { min-height: 44px; }
  .comparison-field { width: 27%; }
  th, td { padding: 8px; }
}
</style>
