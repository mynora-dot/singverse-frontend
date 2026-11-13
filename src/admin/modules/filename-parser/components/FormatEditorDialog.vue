<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ElAlert, ElButton, ElDialog, ElForm, ElFormItem, ElInput, ElMessage, ElMessageBox } from 'element-plus'
import { ApiError } from '../../../core/auth/api'
import { ruleLibrary } from '../api/rules'
import type { ParserWorkspace, RuleInput } from '../types'
import { copyValue, errorMessage, expressionFor } from '../utils'

const props = defineProps<{ modelValue: boolean; workspace: ParserWorkspace; ruleId: string | null; disabled?: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [workspace: ParserWorkspace, id: string]
  reload: []
}>()
const editor = ref<RuleInput>({ name: '', type: 'TEMPLATE', expression: '{artist}-{title}', builtinId: null })
const baseline = ref('')
const busy = ref(false)
const error = ref('')
const conflict = ref(false)
const expressionInput = ref<HTMLTextAreaElement>()
const dirty = computed(() => props.modelValue && JSON.stringify(editor.value) !== baseline.value)
const affected = computed(() => props.workspace.definitions.find(d => d.id === props.ruleId)?.referencedBy ?? [])
const fields = [{ key: 'artist', label: '歌手' }, { key: 'title', label: '歌名' }, { key: 'version', label: '版本' }, { key: 'language', label: '语种' }]
let active = true
onBeforeUnmount(() => { active = false })
watch(() => [props.modelValue, props.ruleId] as const, ([open]) => {
  if (!open) return
  const rule = props.workspace.definitions.find(d => d.id === props.ruleId)
  editor.value = { name: rule?.name ?? '', type: rule?.type === 'REGEX' ? 'REGEX' : 'TEMPLATE', expression: rule ? expressionFor(rule, props.workspace) : '{artist}-{title}', builtinId: null }
  baseline.value = JSON.stringify(editor.value)
  error.value = ''; conflict.value = false
}, { immediate: true })
watch(() => props.workspace.revision, () => { conflict.value = false })

async function canLeave() {
  if (busy.value) return false
  if (!dirty.value) return true
  try {
    await ElMessageBox.confirm('当前格式有未保存修改，是否放弃？方案草稿会保留。', '未保存格式', { confirmButtonText: '放弃修改', cancelButtonText: '继续编辑', type: 'warning' })
    return true
  } catch { return false }
}
async function close(done?: () => void) {
  if (!await canLeave()) return
  if (done) done()
  else emit('update:modelValue', false)
}
defineExpose({ canLeave, busy, dirty })

async function insertField(field: string) {
  const input = expressionInput.value
  const start = input?.selectionStart ?? editor.value.expression.length
  const end = input?.selectionEnd ?? start
  const text = `{${field}}`
  editor.value.expression = editor.value.expression.slice(0, start) + text + editor.value.expression.slice(end)
  await nextTick(); input?.focus(); input?.setSelectionRange(start + text.length, start + text.length)
}
async function save() {
  if (busy.value || props.disabled || conflict.value) return
  if (!editor.value.name.trim() || !editor.value.expression.trim()) { error.value = '请填写格式名称和表达式。'; return }
  busy.value = true; error.value = ''
  try {
    const input = copyValue(editor.value); input.name = input.name.trim()
    const response = props.ruleId
      ? await ruleLibrary.update(props.ruleId, props.workspace.revision, input)
      : await ruleLibrary.create(props.workspace.revision, input)
    if (!active) return
    if (!response.changedId) { error.value = '格式已保存，请加载最新配置后添加。'; return }
    emit('saved', response, response.changedId)
    emit('update:modelValue', false)
    ElMessage.success(props.ruleId ? '共享格式已保存，请重新试解析。' : '格式已保存并加入方案草稿，请试解析后保存方案。')
  } catch (failure) {
    if (!active) return
    conflict.value = failure instanceof ApiError && failure.status === 409
    error.value = failure instanceof ApiError && failure.details?.field ? `${failure.details.field}：${failure.message}` : errorMessage(failure)
  } finally { if (active) busy.value = false }
}
</script>

<template>
  <ElDialog :model-value="modelValue" :title="ruleId ? '编辑自定义格式' : '自定义格式'" width="min(680px, calc(100vw - 32px))" append-to-body destroy-on-close :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy" :before-close="close" @update:model-value="emit('update:modelValue', $event)">
    <ElForm class="format-editor" label-position="top" @submit.prevent="save">
      <fieldset :disabled="busy || disabled">
        <p class="editor-intro">保留文件名中的分隔符，用字段标记歌手和歌名。</p>
        <ElFormItem label="格式名称"><ElInput v-model="editor.name" aria-label="格式名称" maxlength="100" :disabled="busy || disabled" placeholder="例如：歌名_歌手" /></ElFormItem>
        <ElFormItem label="编写方式"><select v-model="editor.type" class="native-field" aria-label="编写方式"><option value="TEMPLATE">字段模板</option><option value="REGEX">高级正则（RE2）</option></select></ElFormItem>
        <ElFormItem :label="editor.type === 'TEMPLATE' ? '字段模板' : '正则表达式'"><textarea ref="expressionInput" v-model="editor.expression" class="native-field expression-input" aria-label="格式表达式" rows="3" maxlength="2048" spellcheck="false" /></ElFormItem>
        <div v-if="editor.type === 'TEMPLATE'" class="field-inserts"><ElButton v-for="field in fields" :key="field.key" :disabled="busy" @click="insertField(field.key)">{{ field.label }} {{ '{' + field.key + '}' }}</ElButton></div>
        <p v-if="editor.type === 'TEMPLATE'" class="editor-help">例如 {title}_{artist} 对应“晴天_周杰伦”。必须包含 artist、title，字段不能重复或相邻；还支持 code、quality、extra。</p>
        <p v-else class="editor-help">必须包含 artist、title 命名组，例如 (?P&lt;artist&gt;[^-]+)-(?P&lt;title&gt;[^-]+)。使用 RE2，不支持回溯引用和前后查找断言。</p>
        <ElAlert v-if="affected.length" :title="`保存格式会立即影响 ${affected.length} 个引用方案：${affected.map(p => p.name).join('、')}`" type="warning" :closable="false" />
        <p class="editor-help">格式保存到共享目录。新格式还需随当前方案保存；保存格式或方案均不会自动重扫。</p>
        <ElAlert v-if="error" :title="error" type="error" :closable="false" role="alert" />
        <div class="editor-actions"><ElButton v-if="conflict" :disabled="busy" @click="emit('reload')">加载最新配置，保留编辑内容</ElButton><ElButton :disabled="busy" @click="close()">取消</ElButton><ElButton native-type="submit" type="primary" :loading="busy" :disabled="conflict">{{ ruleId ? '保存共享格式' : '保存格式并添加' }}</ElButton></div>
      </fieldset>
    </ElForm>
  </ElDialog>
</template>

<style scoped>
.format-editor fieldset{min-width:0;margin:0;padding:0;border:0}.editor-intro{margin:0 0 20px;color:var(--sv-text-secondary);font-size:14px;line-height:1.7}.format-editor .native-field{width:100%;min-height:40px;box-sizing:border-box}.format-editor .expression-input{font-family:var(--sv-font-mono);resize:vertical;line-height:1.7}.field-inserts{display:flex;flex-wrap:wrap;gap:8px;margin-top:-4px}.field-inserts .el-button{margin:0;min-height:40px;font-size:12px}.editor-help{margin:12px 0 16px;color:var(--sv-text-secondary);font-size:14px;line-height:1.7;overflow-wrap:anywhere}.editor-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;margin-top:20px}.editor-actions .el-button{margin:0;min-height:40px}.format-editor :deep(.el-input__wrapper){min-height:40px;box-sizing:border-box}
@media(max-width:768px){.format-editor .native-field,.field-inserts .el-button,.editor-actions .el-button{min-height:44px}.format-editor :deep(.el-input__wrapper){min-height:44px}.format-editor :deep(.el-input__inner),.format-editor .native-field{font-size:16px}.editor-actions .el-button{flex:1}.editor-actions .el-button:first-child:nth-last-child(3){flex-basis:100%}}
</style>
