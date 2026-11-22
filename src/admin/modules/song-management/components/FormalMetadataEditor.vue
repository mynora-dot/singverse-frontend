<script setup lang="ts">
import { requestId as newRequestId } from '../../../../shared/request-id'
import { computed, reactive, ref, watch } from 'vue'
import { Picture } from '@element-plus/icons-vue'
import { ElAlert, ElButton, ElDialog, ElIcon, ElInput, ElMessage } from 'element-plus'
import { formalArtists, formalLibrary, formalStateLabel, formalTitle, type FormalDocument, type FieldOperation } from '../api/formal'

const props = defineProps<{ document: FormalDocument | null }>()
const emit = defineEmits<{ close: []; saved: [FormalDocument] }>()
const labels = {
  title: '名称',
  artists: '演唱署名',
  aliases: '别名',
  album: '发行名称',
  releaseDate: '发行日期',
  referenceDurationMs: '曲目参考时长（毫秒）',
  kind: '版本类型',
  languages: '语言',
  timelineDurationMs: '版本时间轴（毫秒）',
  lyrics: '歌词资料',
  cover: '封面',
}
type MetadataField = keyof typeof labels
type FieldGroup = { title: string; fields: MetadataField[] }
const coverGroup: FieldGroup = { title: '封面', fields: ['cover'] }
const songGroups: FieldGroup[] = [
  { title: '歌曲识别', fields: ['title', 'artists', 'aliases'] },
  { title: '发行与时长', fields: ['album', 'releaseDate', 'referenceDurationMs'] },
  coverGroup,
]
const versionGroups: FieldGroup[] = [
  { title: '版本识别', fields: ['title', 'artists', 'kind', 'languages'] },
  { title: '时间轴与歌词', fields: ['timelineDurationMs', 'lyrics'] },
  coverGroup,
]
const isVersion = computed(() => props.document?.type === 'VARIANT')
const groups = computed(() => isVersion.value ? versionGroups : songGroups)
const names = computed(() => groups.value.flatMap(group => group.fields))
const dialogTitle = computed(() => isVersion.value ? '订正版本资料' : '订正正式资料')
const saveLabel = computed(() => isVersion.value ? '保存版本资料' : '保存正式资料')
const values = reactive<Partial<Record<MetadataField, string>>>({})
const choices = reactive<Partial<Record<MetadataField, 'KEEP' | FieldOperation['op']>>>({})
const changedCount = computed(() => names.value.filter(field => choices[field] && choices[field] !== 'KEEP').length)
const activity = ref<'save' | 'cover' | null>(null)
const busy = computed(() => activity.value !== null)
const error = ref('')
const coverInputs = ref<HTMLInputElement[]>([])
let attempt: { content: string; id: string } | null = null

watch(() => props.document, document => {
  error.value = ''
  attempt = null
  for (const name of names.value) {
    const value = document?.fields[name]
    if (name === 'cover') values[name] = (value as { assetId?: string } | undefined)?.assetId ?? ''
    else if (Array.isArray(value)) values[name] = value.join('、')
    else if (value == null) values[name] = ''
    else values[name] = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)
    choices[name] = 'KEEP'
  }
}, { immediate: true })

async function save() {
  if (!props.document || busy.value) return
  const operations: FieldOperation[] = []
  try {
    for (const field of names.value) {
      const op = choices[field]
      if (!op || op === 'KEEP') continue
      let value: unknown = values[field] ?? ''
      if (op === 'SET') {
        if (['artists', 'aliases', 'languages'].includes(field)) value = String(value).split('、').map(v => v.trim()).filter(Boolean)
        else if (field.endsWith('Ms')) { if (!/^\d+$/.test(String(value))) throw new Error('时长请输入整数毫秒'); value = Number(value) }
        else if (field === 'cover') value = { assetId: value }
        else if (field === 'lyrics') value = JSON.parse(String(value))
        else if (!String(value).trim()) throw new Error('确认值不能为空；需要移除内容时请选择“明确清空”')
      }
      operations.push({ field, op, ...(op === 'SET' ? { value } : {}) })
    }
    if (!operations.length) return
    activity.value = 'save'
    error.value = ''
    const content = JSON.stringify({ revision: props.document.revision, operations })
    if (attempt?.content !== content) attempt = { content, id: newRequestId() }
    const result = await formalLibrary.update(props.document, operations, undefined, attempt.id)
    ElMessage.success('正式资料已保存'); emit('saved', result)
  } catch (failure) { error.value = failure instanceof Error ? failure.message : '保存失败' }
  finally { activity.value = null }
}

async function uploadCover(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || busy.value) return
  if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 32 * 1024 * 1024) { error.value = '请选择 32 MiB 以内的 JPEG / PNG'; return }
  activity.value = 'cover'
  error.value = ''
  try { const asset = await formalLibrary.uploadAsset(file); values.cover = asset.id; choices.cover = 'SET'; ElMessage.success('原图已保存，确认资料后采用') }
  catch (failure) { error.value = failure instanceof Error ? failure.message : '附件保存失败' }
  finally { activity.value = null }
}
</script>

<template>
  <ElDialog
    :model-value="!!document"
    :title="dialogTitle"
    class="formal-editor-dialog"
    width="min(794px, calc(100vw - 24px))"
    align-center
    append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="!busy"
    :show-close="!busy"
    @close="emit('close')"
  >
    <template #header="{ titleId, titleClass }">
      <div class="editor-heading">
        <h2 :id="titleId" :class="titleClass">{{ dialogTitle }}</h2>
        <p v-if="document">{{ formalTitle(document) }}<template v-if="!isVersion"> / {{ formalArtists(document) }}</template></p>
      </div>
    </template>
    <div class="formal-fields">
      <section v-for="(group, index) in groups" :key="group.title" :aria-labelledby="'formal-group-' + index">
        <h3 :id="'formal-group-' + index" class="group-heading">{{ group.title }}</h3>
        <div v-for="name in group.fields" :key="name" class="formal-field">
          <div class="field-label">
            <label v-if="name !== 'cover'" :for="'formal-' + name">{{ labels[name] }}</label>
            <span v-else>{{ isVersion ? '版本封面' : '歌曲封面' }}</span>
            <small :id="'formal-source-' + name">{{ formalStateLabel(document?.states[name]) }}</small>
          </div>
          <ElInput
            v-if="name !== 'cover'"
            :id="'formal-' + name"
            v-model="values[name]"
            :aria-label="labels[name]"
            :aria-describedby="'formal-source-' + name"
            :inputmode="name.endsWith('Ms') ? 'numeric' : undefined"
            :type="name === 'lyrics' ? 'textarea' : 'text'"
            :rows="name === 'lyrics' ? 5 : undefined"
            :disabled="busy || choices[name] === 'CLEAR' || choices[name] === 'RESET'"
            @input="choices[name] = 'SET'"
          />
          <div v-else class="cover-controls">
            <img
              v-if="values.cover && choices.cover !== 'CLEAR'"
              :src="'/api/v1/metadata/assets/' + encodeURIComponent(values.cover)"
              alt="封面预览"
              class="cover-preview"
            />
            <span v-else class="cover-preview cover-empty" role="img" aria-label="暂无封面">
              <ElIcon aria-hidden="true"><Picture /></ElIcon>
            </span>
            <div class="cover-upload">
              <input ref="coverInputs" type="file" accept="image/jpeg,image/png" aria-label="上传正式封面原图" hidden :disabled="busy" @change="uploadCover" />
              <ElButton :icon="Picture" :disabled="busy" :loading="activity === 'cover'" aria-describedby="formal-cover-help" @click="coverInputs[0]?.click()">选择封面</ElButton>
              <small id="formal-cover-help">JPEG / PNG，最大 32 MiB</small>
            </div>
          </div>
          <select v-model="choices[name]" class="field-operation" :class="{ changed: choices[name] !== 'KEEP' }" :aria-label="labels[name] + '保存方式'" :disabled="busy">
            <option value="KEEP">本次不修改</option>
            <option value="SET" :disabled="name === 'cover' && !values.cover">确认此值并保护</option>
            <option value="CLEAR">明确清空并保护</option>
            <option value="RESET">恢复自动采用</option>
          </select>
        </div>
      </section>
    </div>
    <template #footer>
      <ElAlert v-if="error" class="editor-error" type="error" :title="error" :closable="false" role="alert" />
      <div class="editor-footer">
        <span class="change-count" aria-live="polite">本次待保存 {{ changedCount }} 项</span>
        <ElButton :disabled="busy" @click="emit('close')">取消</ElButton>
        <ElButton type="primary" :disabled="!changedCount || busy" :loading="activity === 'save'" @click="save">{{ saveLabel }}</ElButton>
      </div>
    </template>
  </ElDialog>
</template>

<style scoped>
:global(.formal-editor-dialog.el-dialog) {
  display: flex;
  flex-direction: column;
  max-height: calc(100dvh - 32px);
  overflow: hidden;
}
:global(.formal-editor-dialog > .el-dialog__header) {
  flex: none;
  padding: 20px 68px 16px 24px;
}
:global(.formal-editor-dialog > .el-dialog__body) {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 16px 24px 20px;
}
:global(.formal-editor-dialog > .el-dialog__footer) {
  flex: none;
  padding: 12px 24px;
  border-top: 1px solid var(--sv-border-subtle);
  background: var(--sv-surface-2);
}
.editor-heading h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 650;
}
.editor-heading p {
  margin: 4px 0 0;
  color: var(--sv-text-secondary);
  font-size: 14px;
  overflow-wrap: anywhere;
}
.formal-fields {
  display: grid;
  gap: 16px;
}
.editor-error { margin-bottom: 10px; text-align: left; }
.group-heading {
  margin: 0 0 8px;
  padding: 0 0 7px;
  border-bottom: 1px solid var(--sv-border-subtle);
  font-size: 14px;
  font-weight: 650;
}
.formal-field {
  display: grid;
  grid-template-columns: minmax(124px, 148px) minmax(0, 1fr) minmax(158px, 172px);
  align-items: start;
  gap: 10px;
}
.formal-field + .formal-field { margin-top: 8px; }
.field-label {
  align-self: center;
  font-weight: 600;
}
.formal-field small {
  display: block;
  margin-top: 2px;
  color: var(--sv-text-secondary);
  font-size: var(--sv-font-label);
  font-weight: 400;
}
.field-operation {
  width: 100%;
  background-color: var(--sv-surface-1);
}
.field-operation.changed:not(:disabled) {
  color: var(--sv-accent-muted);
  border-color: var(--sv-accent-primary);
  background-color: var(--sv-accent-soft);
}
.cover-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  min-width: 0;
}
.cover-preview {
  display: block;
  width: 56px;
  height: 56px;
  flex: none;
  border-radius: 8px;
  object-fit: contain;
  background: var(--sv-surface-1);
}
.cover-empty {
  display: grid;
  place-items: center;
  color: var(--sv-text-secondary);
  font-size: 22px;
}
.editor-footer {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
.editor-footer :deep(.el-button) { margin-left: 0; }
.change-count {
  margin-right: auto;
  color: var(--sv-text-secondary);
  font-size: var(--sv-font-meta);
}
@media (max-width: 620px) {
  :global(.formal-editor-dialog.el-dialog) { max-width: calc(100vw - 24px); }
  :global(.formal-editor-dialog > .el-dialog__header) { padding: 16px 58px 14px 16px; }
  :global(.formal-editor-dialog > .el-dialog__body) { padding: 14px 16px 18px; }
  :global(.formal-editor-dialog > .el-dialog__footer) { padding: 10px 16px; }
  .formal-field { grid-template-columns: minmax(0, 1fr) minmax(154px, 45%); gap: 6px 8px; }
  .field-label { grid-column: 1 / -1; }
  .field-label small { display: inline; margin: 0 0 0 6px; }
  .field-operation { padding-right: 25px; background-position: calc(100% - 12px) calc(50% - 1px), calc(100% - 7px) calc(50% - 1px); }
  .formal-field :deep(.el-input__wrapper), .field-operation, .cover-upload :deep(.el-button), .editor-footer :deep(.el-button) { min-height: 44px; }
  .formal-field :deep(.el-input__inner), .formal-field :deep(.el-textarea__inner), .field-operation { font-size: 16px; }
}
@media (max-width: 360px) {
  .formal-field { grid-template-columns: minmax(0, 1fr); }
  .editor-footer .change-count { flex-basis: 100%; text-align: left; }
}
</style>
