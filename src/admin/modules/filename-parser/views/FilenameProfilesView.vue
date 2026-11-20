<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import { ElAlert, ElButton, ElDialog, ElInput, ElMessage, ElMessageBox, ElSwitch } from 'element-plus'
import { ArrowDown, ArrowUp, CopyDocument, Document, Plus } from '@element-plus/icons-vue'
import PageHeader from '../../../shared/ui/PageHeader.vue'
import { ApiError } from '../../../core/auth/api'
import { parserProfiles } from '../api/rules'
import type { ParserProfile, ParserWorkspace, ProfileInput, RuleDefinition, RulePreview } from '../types'
import { attemptFor, candidateEntries, copyValue, errorMessage, expressionFor, formatItems } from '../utils'
import FormatEditorDialog from '../components/FormatEditorDialog.vue'
import RulePreviewPanel from '../components/RulePreviewPanel.vue'

// A：先核对文件名提取结果，再在唯一的成员列表里调整格式；常用操作不进入折叠区。
const props = defineProps<{ embedded?: boolean; profileId?: string }>()
const emit = defineEmits<{ useProfile: [id: string]; rules: [profileId: string] }>()
const route = useRoute()
const router = useRouter()
const workspace = ref<ParserWorkspace | null>(null)
const selectedId = ref<string | null>('default')
const draft = ref<ProfileInput>({ name: '', entries: [] })
const baseline = ref('')
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const conflict = ref(false)
const memberError = ref<{ ruleId?: string | null; ruleIndex?: number; field?: string; message: string } | null>(null)
const filename = ref('周杰伦-晴天.mkv')
const parsing = ref(false)
const parseError = ref('')
const preview = ref<RulePreview | null>(null)
const stale = ref(false)
const previewName = ref('')
const reverseHelp = ref(false)
const catalogOpen = ref(false)
const catalogSearch = ref('')
const suggesting = ref(false)
const detection = ref<RulePreview | null>(null)
const detecting = ref(false)
const detectError = ref('')
const detectionStale = ref(false)
const manageOpen = ref(false)
const formatOpen = ref(false)
const editingRuleId = ref<string | null>(null)
const formatEditor = ref<InstanceType<typeof FormatEditorDialog>>()
const schemeControls = ref<HTMLElement>()
const schemeSaveVisible = ref(false)
const signature = computed(() => JSON.stringify(draft.value))
const dirty = computed(() => workspace.value !== null && signature.value !== baseline.value)
const editable = computed(() => !!workspace.value && !busy.value && !loading.value && !formatEditor.value?.busy)
const enabledEntries = computed(() => draft.value.entries.filter(entry => entry.enabled).length)
const reverseRule = computed(() => workspace.value?.definitions.find(d => d.type === 'BUILTIN' && d.builtinId === 'reverse-hyphen'))
const exampleIds = ['hyphen', 'reverse-hyphen', 'book', 'parentheses', 'underscore-version']
const examples = computed(() => exampleIds.flatMap(id => {
  const preset = workspace.value?.builtinRules.find(p => p.id === id)
  return preset ? [{ filename: preset.example, label: preset.example.replace(/\.[^.]+$/, '') }] : []
}))
const formatRanks: Record<string, number> = { MATCHED: 0, PARTIAL: 1, AMBIGUOUS: 2, NO_MATCH: 3, DISABLED: 4 }
const catalog = computed(() => {
  const query = catalogSearch.value.trim().toLowerCase()
  return (workspace.value?.definitions ?? []).map(rule => ({
    ...rule, example: exampleFor(rule.id), attempt: suggesting.value ? attemptFor(detection.value, rule.id) : undefined,
  })).filter(rule => `${rule.name} ${rule.example}`.toLowerCase().includes(query)).sort((a, b) => {
    if (!suggesting.value || !detection.value || detectionStale.value) return 0
    return (formatRanks[a.attempt?.status ?? ''] ?? 9) - (formatRanks[b.attempt?.status ?? ''] ?? 9)
  })
})
let generation = 0
let detectGeneration = 0
let active = true
let schemeObserver: IntersectionObserver | undefined
watch(schemeControls, element => {
  schemeObserver?.disconnect()
  if (!element || typeof IntersectionObserver === 'undefined') return
  schemeObserver = new IntersectionObserver(entries => {
    schemeSaveVisible.value = entries[0]?.isIntersecting ?? false
  }, { rootMargin: '-64px 0px 0px' })
  schemeObserver.observe(element)
}, { flush: 'post' })

function definition(id: string) { return workspace.value?.definitions.find(d => d.id === id) }
function ruleName(id: string) { return definition(id)?.name ?? `失效引用：${id}` }
function exampleFor(id: string) {
  const rule = definition(id)
  const builtin = workspace.value?.builtinRules.find(p => p.id === rule?.builtinId)
  if (builtin) return builtin.example
  if (rule?.type === 'REGEX') return '自定义正则，可在详情中查看表达式'
  const sample: Record<string, string> = { artist: '周杰伦', title: '晴天', code: '00128', language: '国语', version: '伴奏', quality: '1080P', extra: '流行' }
  return rule?.expression ? `${rule.expression.replace(/\{(\w+)\}/g, (token, field: string) => sample[field] ?? token)}.mkv` : '格式已失效，请移除或重新选择'
}
function invalidate() { generation++; if (preview.value) stale.value = true; parseError.value = '' }
function invalidateDetection() { detectGeneration++; if (detection.value) detectionStale.value = true; detectError.value = '' }
watch(() => JSON.stringify(draft.value.entries), () => { invalidate(); memberError.value = null }, { flush: 'sync' })
watch(filename, () => { invalidate(); invalidateDetection() }, { flush: 'sync' })

function select(profile: ParserProfile, keepPreview = false) {
  const sameEntries = JSON.stringify(profile.entries) === JSON.stringify(draft.value.entries)
  selectedId.value = profile.id
  draft.value = copyValue({ name: profile.name, entries: profile.entries })
  baseline.value = signature.value
  error.value = ''; memberError.value = null; reverseHelp.value = false
  if (!keepPreview || !sameEntries) { generation++; preview.value = null; stale.value = false }
}
async function discard(): Promise<boolean> {
  if (!dirty.value) return true
  try {
    await ElMessageBox.confirm('当前方案有未保存修改，是否放弃这些修改？', '未保存草稿', { confirmButtonText: '放弃修改', cancelButtonText: '继续编辑', type: 'warning' })
    return true
  } catch { return false }
}
async function canLeave() {
  if (busy.value || loading.value || formatEditor.value?.busy) return false
  if (formatEditor.value && !await formatEditor.value.canLeave()) return false
  return discard()
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value || formatEditor.value?.dirty) { event.preventDefault(); event.returnValue = '' }
}
defineExpose({ canLeave })
onBeforeRouteLeave(() => props.embedded || canLeave())
onBeforeRouteUpdate((to, from) => {
  if (props.embedded || to.query.profile === from.query.profile) return true
  return (!dirty.value && !formatEditor.value?.dirty) || canLeave()
})
watch(() => route.query.profile, id => {
  if (props.embedded || !workspace.value) return
  const profile = workspace.value.profiles.find(p => p.id === (typeof id === 'string' ? id : 'default'))
  if (profile) {
    if (profile.id !== selectedId.value || dirty.value) select(profile)
  } else error.value = '指定方案不存在，请选择其他方案或加载最新配置。'
})
onBeforeUnmount(() => { active = false; generation++; detectGeneration++; schemeObserver?.disconnect(); window.removeEventListener('beforeunload', beforeUnload) })

function absorb(response: ParserWorkspace) {
  workspace.value = response; conflict.value = false
  const saved = response.profiles.find(p => p.id === selectedId.value)
  if (saved) baseline.value = JSON.stringify({ name: saved.name, entries: saved.entries })
  else { selectedId.value = null; baseline.value = '' }
  invalidate(); invalidateDetection()
}
async function load(preserve = false) {
  if (busy.value || formatEditor.value?.busy) return
  loading.value = true; error.value = ''; invalidate(); invalidateDetection()
  try {
    const response = await parserProfiles.load()
    if (!active) return
    if (preserve) { absorb(response); ElMessage.info('已加载最新配置，草稿已保留，请核对后重试或保存。') }
    else {
      workspace.value = response; conflict.value = false
      const requested = props.embedded ? props.profileId : typeof route.query.profile === 'string' ? route.query.profile : selectedId.value
      const found = response.profiles.find(p => p.id === requested)
      const fallback = response.profiles.find(p => p.id === 'default') ?? response.profiles[0]
      if (found || fallback) select((found ?? fallback)!)
      if (requested && !found) error.value = '指定方案不存在，已显示默认方案。'
    }
  } catch (failure) { if (active) error.value = errorMessage(failure) }
  finally { if (active) loading.value = false }
}
async function choose(id: string) {
  if (!editable.value || !id || id === selectedId.value) return
  if (props.embedded || route.query.profile === id) {
    if (await discard()) {
      const saved = workspace.value?.profiles.find(p => p.id === id)
      if (saved) select(saved)
    }
  } else await router.replace({ query: { ...route.query, profile: id } })
  if (selectedId.value === id) manageOpen.value = false
}
async function chooseFromSelect(event: Event) {
  const input = event.target as HTMLSelectElement
  await choose(input.value)
  input.value = selectedId.value ?? ''
}
async function create(copy = false) {
  if (!editable.value) return
  if (copy && dirty.value) {
    try { await ElMessageBox.confirm('把当前草稿复制到新方案？原方案的未保存修改不会单独保存。', '复制当前草稿', { confirmButtonText: '复制草稿', cancelButtonText: '继续编辑' }) }
    catch { return }
  } else if (!await discard()) return
  const current = copyValue(draft.value)
  selectedId.value = null
  draft.value = copy ? { name: `${current.name}（副本）`.slice(0, 100), entries: current.entries } : { name: '', entries: [] }
  baseline.value = ''; error.value = ''; memberError.value = null; preview.value = null; reverseHelp.value = false
  generation++
}
function hasRule(id: string) { return draft.value.entries.some(e => e.ruleId === id) }
function add(id: string) {
  if (!editable.value || !definition(id) || hasRule(id) || draft.value.entries.length >= 100) return
  draft.value.entries.push({ ruleId: id, enabled: true })
}
function removeEntry(index: number) { if (editable.value) draft.value.entries.splice(index, 1) }
function move(index: number, step: number) {
  if (!editable.value) return
  const target = index + step
  if (target < 0 || target >= draft.value.entries.length) return
  const entries = [...draft.value.entries]
  ;[entries[index], entries[target]] = [entries[target]!, entries[index]!]
  draft.value.entries = entries
}
function preferReverse() {
  if (!editable.value || !reverseRule.value) return
  const id = reverseRule.value.id
  if (!hasRule(id) && draft.value.entries.length >= 100) { error.value = '方案最多包含 100 个格式，请先移除一个格式。'; return }
  draft.value.entries = [{ ruleId: id, enabled: true }, ...draft.value.entries.filter(e => e.ruleId !== id)]
  reverseHelp.value = false
  ElMessage.info('反向格式已启用并移到最前，请重新试解析。')
}
function handleFailure(failure: unknown): string {
  if (failure instanceof ApiError) {
    conflict.value = failure.status === 409
    if (conflict.value) { invalidate(); invalidateDetection() }
    if (failure.status === 400) memberError.value = { ...failure.details, message: failure.message }
  }
  return errorMessage(failure)
}
async function save(): Promise<string | null> {
  if (!workspace.value || !editable.value || conflict.value) return null
  if (!dirty.value) return selectedId.value
  if (!draft.value.name.trim()) { error.value = '请填写方案名称。'; return null }
  busy.value = true; error.value = ''
  try {
    const input = copyValue(draft.value); input.name = input.name.trim()
    const response = selectedId.value ? await parserProfiles.update(selectedId.value, workspace.value.revision, input) : await parserProfiles.create(workspace.value.revision, input)
    if (!active) return null
    const saved = response.profiles.find(p => p.id === response.changedId)
    if (!saved) { error.value = '方案已保存，请加载最新配置后确认。'; return null }
    workspace.value = response
    select(saved, true)
    if (!props.embedded) await router.replace({ query: { ...route.query, profile: saved.id } })
    ElMessage.success('解析方案已保存，不会自动重扫。')
    return saved.id
  } catch (failure) { if (active) error.value = handleFailure(failure); return null }
  finally { if (active) busy.value = false }
}
async function saveAndUse() {
  const id = await save()
  if (id && active) emit('useProfile', id)
}
async function remove(profile: ParserProfile) {
  if (!workspace.value || profile.id === 'default' || !editable.value) return
  if (profile.id === selectedId.value && !await discard()) return
  try { await ElMessageBox.confirm(`删除「${profile.name}」？不会删除共享格式；正在被歌曲来源使用的方案不能删除。`, '删除方案', { confirmButtonText: '删除方案', cancelButtonText: '取消', type: 'warning' }) }
  catch { return }
  busy.value = true; error.value = ''
  try {
    const response = await parserProfiles.remove(profile.id, workspace.value.revision)
    if (!active) return
    if (profile.id === selectedId.value) {
      workspace.value = response
      const fallback = response.profiles.find(p => p.id === 'default')!
      select(fallback)
      if (!props.embedded) await router.replace({ query: { ...route.query, profile: fallback.id } })
    } else absorb(response)
    ElMessage.success('方案已删除。')
  } catch (failure) { if (active) error.value = handleFailure(failure) }
  finally { if (active) busy.value = false }
}
async function parse() {
  if (!workspace.value || parsing.value || !editable.value || conflict.value || !filename.value.trim()) return
  const token = generation
  const name = draft.value.name
  parsing.value = true; parseError.value = ''; memberError.value = null
  try {
    const response = await parserProfiles.preview(filename.value, workspace.value.revision, copyValue(draft.value.entries))
    if (!active || token !== generation) return
    preview.value = response.preview; stale.value = false; previewName.value = name || '未命名草稿'
  } catch (failure) {
    if (active && token === generation) { parseError.value = handleFailure(failure); if (preview.value) stale.value = true }
  } finally { if (active) parsing.value = false }
}
function openCatalog(suggestions = false) {
  suggesting.value = suggestions; catalogSearch.value = ''; catalogOpen.value = true
  if (suggestions) void detect()
}
async function detect() {
  if (!workspace.value || detecting.value || !editable.value || !filename.value.trim() || conflict.value) return
  const token = detectGeneration
  detecting.value = true; detectError.value = ''; detection.value = null; detectionStale.value = false
  try {
    const response = await parserProfiles.preview(filename.value, workspace.value.revision, candidateEntries(workspace.value))
    if (active && token === detectGeneration) detection.value = response.preview
  } catch (failure) { if (active && token === detectGeneration) detectError.value = handleFailure(failure) }
  finally { if (active) detecting.value = false }
}
function openFormat(rule?: RuleDefinition) {
  if (!editable.value || rule?.type === 'BUILTIN') return
  editingRuleId.value = rule?.id ?? null
  catalogOpen.value = false; formatOpen.value = true
}
function formatSaved(response: ParserWorkspace, id: string) {
  absorb(response)
  if (!hasRule(id) && draft.value.entries.length < 100) draft.value.entries.push({ ruleId: id, enabled: true })
}
function rowError(id: string, index: number) {
  return memberError.value && (memberError.value.ruleId === id || memberError.value.ruleIndex === index) ? memberError.value.message : ''
}
async function openRules() {
  if (props.embedded) { if (await canLeave()) emit('rules', selectedId.value ?? props.profileId ?? 'default') }
  else await router.push({ path: '/library/media/recognition/rules', query: { ...route.query, profile: selectedId.value ?? undefined } })
}
onMounted(() => { window.addEventListener('beforeunload', beforeUnload); void load() })
</script>

<template>
  <section class="filename-workbench management-page" :class="{ 'filename-embedded': embedded }">
    <PageHeader v-if="!embedded" title="文件名识别" />
    <div v-if="error || conflict || parseError" class="workbench-feedback"><ElAlert v-if="error" :title="error" type="error" :closable="false" role="alert" /><ElButton :disabled="loading || busy" @click="load(!!workspace)">{{ workspace ? '加载最新配置，保留草稿' : '重试加载' }}</ElButton></div>
    <p v-if="loading" class="load-status" role="status">正在读取解析方案…</p>
    <template v-if="workspace">
      <section class="scheme-bar" aria-label="方案设置">
        <label class="scheme-select"><span>当前方案<span v-if="dirty" class="mobile-dirty" role="status">未保存草稿</span></span><select class="native-field" aria-label="当前方案" :value="selectedId ?? ''" :disabled="!editable" @change="chooseFromSelect"><option v-if="!selectedId" value="">{{ draft.name || '未命名方案' }}（未保存）</option><option v-for="profile in workspace.profiles" :key="profile.id" :value="profile.id">{{ profile.name }}</option></select></label>
        <label class="scheme-name"><span>方案名称</span><ElInput v-model="draft.name" aria-label="方案名称" maxlength="100" placeholder="未命名方案" :disabled="!editable" @keyup.enter="embedded ? saveAndUse() : save()" /></label>
        <div class="scheme-create"><ElButton :disabled="!editable || workspace.profiles.length >= 100" @click="create()">新建</ElButton><ElButton :icon="CopyDocument" :disabled="!editable || workspace.profiles.length >= 100" @click="create(true)">复制</ElButton></div>
        <div ref="schemeControls" class="scheme-save"><span class="save-state" :class="{ dirty }" role="status">{{ dirty ? '未保存草稿' : '已保存方案' }}</span><ElButton text :disabled="!editable" @click="manageOpen = true">管理</ElButton><ElButton v-if="embedded" type="primary" :loading="busy" :disabled="!editable || conflict || (!dirty && !selectedId)" @click="saveAndUse">{{ dirty ? '保存并使用' : '使用此方案并返回' }}</ElButton><ElButton v-else type="primary" :loading="busy" :disabled="!editable || !dirty || conflict" @click="save">保存方案</ElButton></div>
      </section>
      <p class="sharing-note">保存影响所有引用来源的后续扫描。</p>
      <section class="filename-trial" aria-label="文件名试解析">
        <div class="trial-inputs"><div class="trial-heading"><label for="parser-filename">试一个文件名</label></div>
          <form class="filename-form" @submit.prevent="parse"><ElInput id="parser-filename" v-model="filename" aria-label="文件名" :prefix-icon="Document" maxlength="1024" placeholder="例如 周杰伦-晴天.mkv" :disabled="!workspace || busy" /><ElButton type="primary" native-type="submit" :loading="parsing" :disabled="!editable || !filename.trim() || conflict">试解析</ElButton></form>
          <div class="filename-examples"><span>换个示例</span><ElButton v-for="example in examples" :key="example.filename" text :class="{ active: filename === example.filename }" :disabled="!editable" @click="filename = example.filename">{{ example.label }}</ElButton></div>
          <label class="mobile-example"><span>换个示例</span><select class="native-field" aria-label="换个文件名示例" :value="examples.some(e => e.filename === filename) ? filename : ''" :disabled="!editable" @change="filename = ($event.target as HTMLSelectElement).value"><option disabled value="">选择示例文件名</option><option v-for="example in examples" :key="example.filename" :value="example.filename">{{ example.filename }}</option></select></label>
        </div>
        <ElAlert v-if="parseError" :title="parseError" type="error" :closable="false" role="alert" />
        <RulePreviewPanel :preview="preview" :stale="stale"><template v-if="preview" #actions><ElButton v-if="preview.selectedRule" link type="primary" :disabled="!editable" @click="reverseHelp = !reverseHelp">歌名和歌手反了？</ElButton><ElButton v-else link type="primary" :disabled="!editable || !filename.trim() || conflict" @click="openCatalog(true)">找其他适合的格式</ElButton></template></RulePreviewPanel>
        <div v-if="reverseHelp" class="reverse-help"><p>连字符两侧都可能是名称。若文件名是“歌名-歌手”，请启用反向格式并移到最前，再试解析。</p><ElButton :disabled="!editable || !reverseRule" @click="preferReverse">启用反向并移到最前</ElButton><ElButton text @click="reverseHelp = false">收起</ElButton></div>
      </section>
      <section class="filename-formats" aria-labelledby="filename-formats-heading"><div class="formats-heading"><div><div class="formats-title"><h2 id="filename-formats-heading">识别顺序</h2><span>{{ draft.entries.length }} 项 · 已启用 {{ enabledEntries }} 项</span></div></div><div class="format-add"><ElButton :icon="Plus" :disabled="!editable || draft.entries.length >= 100" @click="openCatalog()">添加格式</ElButton><ElButton :disabled="!editable || draft.entries.length >= 100 || workspace.definitions.length >= 1000" @click="openFormat()">自定义格式</ElButton></div></div>
        <ol class="format-members"><li v-for="(entry, index) in draft.entries" :key="entry.ruleId" class="format-member" :class="{ 'is-disabled': !entry.enabled, 'is-match': !stale && preview?.selectedRule?.id === entry.ruleId }"><span class="member-order">{{ index + 1 }}</span><div class="member-description"><div class="member-title"><strong>{{ ruleName(entry.ruleId) }}</strong><span v-if="!stale && preview?.selectedRule?.id === entry.ruleId" class="matched-label">本次命中</span></div><p>{{ exampleFor(entry.ruleId) }}</p><p v-if="!definition(entry.ruleId)" class="inline-error">引用已失效，请加载最新配置后移除此项或选择其他格式。</p><p v-if="rowError(entry.ruleId, index)" class="inline-error" role="alert">{{ rowError(entry.ruleId, index) }}</p></div><label class="member-toggle"><ElSwitch v-model="entry.enabled" :aria-label="`启用 ${ruleName(entry.ruleId)}`" :disabled="!editable" /><span>{{ entry.enabled ? '启用' : '停用' }}</span></label><div class="member-actions"><ElButton v-if="definition(entry.ruleId) && definition(entry.ruleId)?.type !== 'BUILTIN'" text :disabled="!editable" :aria-label="`编辑 ${ruleName(entry.ruleId)}`" @click="openFormat(definition(entry.ruleId))">编辑</ElButton><ElButton text :icon="ArrowUp" :disabled="!editable || index === 0" :aria-label="`上移 ${ruleName(entry.ruleId)}`" @click="move(index, -1)">上移</ElButton><ElButton text :icon="ArrowDown" :disabled="!editable || index === draft.entries.length - 1" :aria-label="`下移 ${ruleName(entry.ruleId)}`" @click="move(index, 1)">下移</ElButton><ElButton text class="remove-format" :disabled="!editable" :aria-label="`移除 ${ruleName(entry.ruleId)}`" @click="removeEntry(index)">移除</ElButton></div></li></ol>
        <div v-if="!draft.entries.length" class="empty-formats"><strong>这个方案还没有格式</strong></div>
      </section>
      <details class="technical-details"><summary>表达式与匹配诊断</summary><div class="technical-content"><div class="technical-heading"><h3>格式表达式</h3><ElButton text :disabled="!editable" @click="openRules">管理共享格式</ElButton></div><ol class="format-expressions"><li v-for="entry in draft.entries" :key="entry.ruleId"><strong>{{ ruleName(entry.ruleId) }}</strong><code>{{ expressionFor(definition(entry.ruleId), workspace) || '失效引用' }}</code></li></ol><h3>逐项匹配记录</h3><RulePreviewPanel details-only :preview="preview" :stale="stale" :profile-name="previewName" /></div></details>
      <div v-if="dirty && !schemeSaveVisible" class="draft-save-bar" role="region" aria-label="未保存方案"><span><strong>{{ draft.name || '未命名方案' }}</strong><span>未保存草稿</span></span><ElButton type="primary" :loading="busy" :disabled="!editable || conflict" @click="embedded ? saveAndUse() : save()">{{ embedded ? '保存并使用' : '保存方案' }}</ElButton></div>
      <ElDialog v-model="catalogOpen" title="添加格式" width="min(680px, calc(100vw - 32px))" append-to-body destroy-on-close><div class="format-catalog"><ElInput v-model="catalogSearch" aria-label="搜索格式" placeholder="搜索格式或文件名示例" clearable /><p class="catalog-count">{{ formatItems(workspace).length }} 种内置格式，{{ workspace.definitions.filter(d => d.type !== 'BUILTIN').length }} 种自定义格式</p><p v-if="detecting" role="status">正在试匹配内置格式…</p><ElAlert v-if="detectError" :title="detectError" type="error" :closable="false" role="alert" /><p v-if="detectionStale" class="catalog-warning">文件名或规则库已变化，以下候选已过期，请重新检测。</p><ElButton v-if="suggesting && (detectError || detectionStale)" :loading="detecting" :disabled="!editable || conflict" @click="detect">重新检测</ElButton><ul class="catalog-list"><li v-for="item in catalog" :key="item.id" :data-catalog-id="item.id"><div><strong>{{ item.name }}</strong><p>{{ item.example }}</p><p v-if="suggesting && !detectionStale && item.attempt" class="candidate-note">{{ item.attempt.status === 'MATCHED' ? '可完整提取，仍需核对字段方向' : item.attempt.status === 'AMBIGUOUS' ? '存在多种读法' : item.attempt.status === 'PARTIAL' ? '只提取到部分字段' : '未完整匹配' }}<span v-if="item.attempt.captures.artist && item.attempt.captures.title">：歌名 {{ item.attempt.captures.title }}，歌手 {{ item.attempt.captures.artist }}</span></p></div><ElButton :disabled="!editable || hasRule(item.id) || draft.entries.length >= 100" @click="add(item.id)">{{ hasRule(item.id) ? '已添加' : '添加' }}</ElButton></li></ul><p v-if="!catalog.length">没有找到格式</p></div><template #footer><ElButton :disabled="!editable || draft.entries.length >= 100 || workspace.definitions.length >= 1000" @click="openFormat()">自定义格式</ElButton><ElButton type="primary" @click="catalogOpen = false">完成</ElButton></template></ElDialog>
      <ElDialog v-model="manageOpen" title="方案管理" width="min(640px, calc(100vw - 32px))" append-to-body destroy-on-close><div class="profile-manager"><ElAlert v-if="error" :title="error" type="error" :closable="false" role="alert" /><div v-for="profile in workspace.profiles" :key="profile.id" class="managed-profile"><div><strong>{{ profile.name }}</strong><p>{{ profile.entries.length }} 个格式{{ profile.id === 'default' ? ' · 默认方案' : '' }}{{ profile.id === selectedId ? ' · 当前方案' : '' }}</p></div><ElButton :disabled="!editable || profile.id === selectedId" @click="choose(profile.id)">使用</ElButton><ElButton class="remove-format" :disabled="!editable || profile.id === 'default'" :aria-label="`删除方案 ${profile.name}`" @click="remove(profile)">{{ profile.id === 'default' ? '不可删除' : '删除方案' }}</ElButton></div></div><template #footer><ElButton :disabled="busy" @click="manageOpen = false">完成</ElButton></template></ElDialog>
      <FormatEditorDialog ref="formatEditor" v-model="formatOpen" :workspace="workspace" :rule-id="editingRuleId" :disabled="loading || busy" @saved="formatSaved" @reload="load(true)" />
    </template>
  </section>
</template>

<style scoped>
.filename-workbench{min-width:0}.mobile-dirty{display:none}.filename-workbench .el-button{min-height:40px;margin-left:0}.workbench-feedback{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:16px}.workbench-feedback .el-alert{flex:1;min-width:220px}.load-status{margin-bottom:16px;font-size:14px;color:var(--sv-text-secondary)}
.scheme-bar{display:grid;grid-template-columns:minmax(180px,.8fr) minmax(220px,1.2fr) auto auto;align-items:end;gap:12px;padding:16px;background:var(--sv-surface-2);border:1px solid var(--sv-border-subtle);border-radius:var(--sv-radius-md)}.scheme-select,.scheme-name{min-width:0}.scheme-select>span,.scheme-name>span{display:block;margin-bottom:6px;font-size:12px;font-weight:500;color:var(--sv-text-secondary)}.scheme-select>span{display:flex;justify-content:space-between;gap:8px}.scheme-select select{width:100%;box-sizing:border-box;height:40px;min-width:0}.scheme-name :deep(.el-input__wrapper){height:40px;box-sizing:border-box}.scheme-create,.scheme-save{display:flex;align-items:center;gap:8px;min-width:0}.save-state{font-size:12px;color:var(--sv-text-secondary);white-space:nowrap}.save-state.dirty{color:var(--sv-semantic-warn)}.sharing-note{display:flex;gap:8px;align-items:flex-start;font-size:14px;line-height:1.7;color:var(--sv-text-secondary);margin:10px 0 16px}.sharing-note .el-icon{flex:none;margin-top:5px;color:var(--sv-text-tertiary)}
.filename-trial{border:1px solid var(--sv-border-subtle);background:var(--sv-surface-2);border-radius:var(--sv-radius-md);overflow:hidden}.trial-inputs{padding:16px 20px 12px}.trial-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:8px}.trial-heading label{font-size:14px;font-weight:600}.filename-form{display:grid;grid-template-columns:minmax(0,1fr) 120px;gap:10px}.filename-form :deep(.el-input__wrapper){height:42px;box-sizing:border-box}.filename-form :deep(.el-input__inner){font-size:16px}.filename-examples{display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-top:8px}.filename-examples>span{font-size:12px;color:var(--sv-text-tertiary);margin-right:4px}.filename-examples .el-button{font-size:12px;padding:0 10px;min-height:40px}.filename-examples .active{color:var(--sv-accent-primary);background:var(--sv-accent-soft)}.mobile-example{display:none}.filename-trial :deep(.result-actions .el-button){min-height:40px;font-size:12px}.reverse-help{display:flex;gap:12px;align-items:center;padding:12px 20px;border-top:1px solid var(--sv-border-subtle);background:var(--sv-accent-soft)}.reverse-help p{flex:1;font-size:14px;line-height:1.7;margin:0;color:var(--sv-text-secondary)}
.filename-formats{margin-top:20px}.formats-heading{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:10px}.formats-title{display:flex;gap:12px;align-items:baseline}.formats-title h2{font-size:16px;font-weight:600;margin:0}.formats-title>span{font-size:12px;color:var(--sv-text-tertiary)}.format-add{display:flex;align-items:center;gap:8px}.format-members{list-style:none;padding:0;margin:0;border:1px solid var(--sv-border-subtle);border-radius:var(--sv-radius-md);background:var(--sv-surface-2);overflow:hidden}.format-members:empty{display:none}.format-member{display:grid;grid-template-columns:26px minmax(0,1fr) auto auto;align-items:center;gap:12px;padding:12px 16px;border-top:1px solid var(--sv-border-subtle);min-height:68px;box-sizing:border-box}.format-member:first-child{border-top:0}.format-member.is-match{background:var(--sv-accent-soft)}.member-order{font-size:12px;text-align:center;color:var(--sv-text-tertiary)}.member-description{min-width:0}.member-title{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.member-title strong{font-size:14px;font-weight:600;overflow-wrap:anywhere}.matched-label{font-size:12px;line-height:20px;background:var(--sv-accent-soft);color:var(--sv-accent-primary);padding:0 6px;border-radius:var(--sv-radius-sm)}.member-description p{margin:4px 0 0;font-size:12px;color:var(--sv-text-tertiary);line-height:1.7;overflow-wrap:anywhere}.member-description p.inline-error{color:var(--sv-semantic-danger)}.is-disabled .member-title strong{color:var(--sv-text-tertiary);font-weight:500}.member-toggle{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--sv-text-secondary);min-height:40px}.member-toggle :deep(.el-switch){height:40px;--el-switch-on-color:var(--sv-accent-primary)}.member-actions{display:flex;gap:2px;align-items:center}.member-actions .el-button{padding:0 8px;font-size:12px}.remove-format{color:var(--sv-text-secondary)}.remove-format:not(:disabled):hover{color:var(--sv-semantic-danger);background:var(--sv-semantic-danger-soft)}.empty-formats{padding:28px 20px;background:var(--sv-surface-2);border:1px solid var(--sv-border-subtle);border-radius:var(--sv-radius-md);text-align:center}.empty-formats strong{font-size:14px}.empty-formats p{font-size:14px;line-height:1.7;color:var(--sv-text-secondary);margin:8px 0 0}
.draft-save-bar{position:sticky;bottom:12px;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:12px;padding:10px 16px;border:1px solid var(--sv-border-strong);border-radius:var(--sv-radius-md);background:var(--sv-surface-2);box-shadow:var(--sv-shadow-sm)}.draft-save-bar>span{display:flex;align-items:center;gap:12px;min-width:0}.draft-save-bar strong{font-size:14px;font-weight:500;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.draft-save-bar>span>span{font-size:12px;color:var(--sv-semantic-warn);white-space:nowrap}.draft-save-bar>.el-button{flex:none}.technical-details{margin-top:12px;border:1px solid var(--sv-border-subtle);border-radius:var(--sv-radius-md);background:var(--sv-surface-2)}.technical-details>summary{cursor:pointer;min-height:44px;padding:0 16px;align-content:center;font-size:12px;color:var(--sv-text-secondary)}.technical-details>summary>span{float:right;color:var(--sv-text-tertiary)}.technical-content{padding:0 20px 20px}.technical-heading{display:flex;justify-content:space-between;align-items:center;gap:12px}.technical-content h3{font-size:14px;font-weight:600;margin:16px 0 12px}.format-expressions{list-style:none;margin:0 0 20px;padding:0}.format-expressions li{margin:12px 0}.format-expressions strong{font-size:12px;font-weight:500}.format-expressions code{display:block;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.7 var(--sv-font-mono);margin-top:4px;color:var(--sv-text-secondary)}
.format-catalog,.profile-manager{min-width:0}.format-catalog>p,.profile-manager>p{font-size:14px;line-height:1.7;color:var(--sv-text-secondary);margin:0 0 16px}.format-catalog .catalog-count{font-size:12px;margin:10px 0 0;color:var(--sv-text-tertiary)}.catalog-list{list-style:none;margin:12px 0 0;padding:0;max-height:55vh;overflow-y:auto;overscroll-behavior:contain}.catalog-list li{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 0;border-top:1px solid var(--sv-border-subtle)}.catalog-list li>div{min-width:0}.catalog-list strong{font-size:14px;font-weight:500;overflow-wrap:anywhere}.catalog-list p{font-size:12px;line-height:1.7;color:var(--sv-text-secondary);margin:4px 0 0;overflow-wrap:anywhere}.catalog-list .el-button{min-height:40px;flex:none}.catalog-list .candidate-note{color:var(--sv-accent-muted)}.format-catalog .catalog-warning{color:var(--sv-semantic-warn);margin-top:12px}.managed-profile{display:flex;align-items:center;gap:8px;padding:14px 0;border-top:1px solid var(--sv-border-subtle)}.managed-profile>div{flex:1;min-width:0}.managed-profile strong{font-size:14px;overflow-wrap:anywhere}.managed-profile p{font-size:12px;line-height:1.7;color:var(--sv-text-secondary);margin:4px 0 0}.managed-profile .el-button{min-height:40px;margin-left:0}
@media(max-width:1100px) and (min-width:769px){.scheme-bar{grid-template-columns:minmax(180px,1fr) minmax(220px,1.2fr) auto}.scheme-save{grid-column:1/-1;justify-content:flex-end}.format-member{gap:8px;padding-left:12px;padding-right:12px}.member-actions .el-button{padding:0 5px}}
@media(max-width:768px){.filename-workbench .el-button{min-height:44px}.mobile-dirty{display:inline;color:var(--sv-semantic-warn);font-weight:400}.draft-save-bar{bottom:8px;padding:8px 12px;gap:8px}.draft-save-bar>span{display:grid;gap:2px}.scheme-bar{grid-template-columns:1fr 1fr;gap:12px 8px;padding:14px}.scheme-select,.scheme-name{grid-column:1/-1}.scheme-select select{height:44px;font-size:16px}.scheme-name :deep(.el-input__wrapper){height:44px}.scheme-name :deep(.el-input__inner){font-size:16px}.scheme-create{gap:6px}.scheme-create .el-button{padding:0 10px}.scheme-save{justify-content:flex-end;gap:4px}.scheme-save .save-state{display:none}.scheme-save .el-button{padding:0 10px}.filename-embedded .scheme-create{grid-column:1/-1}.filename-embedded .scheme-save{grid-column:1/-1;justify-content:space-between}.sharing-note{margin:10px 0 14px;font-size:14px}.trial-inputs{padding:14px 14px 10px}.trial-heading{gap:8px}.filename-form{grid-template-columns:minmax(0,1fr) 88px;gap:8px}.filename-form :deep(.el-input__wrapper){height:44px}.filename-form .el-button{padding:0 10px}.filename-examples{display:none}.mobile-example{display:grid;grid-template-columns:64px minmax(0,1fr);align-items:center;gap:8px;margin-top:8px}.mobile-example>span{font-size:12px;color:var(--sv-text-tertiary)}.mobile-example select{height:44px;min-width:0;width:100%;font-size:14px;box-sizing:border-box}.filename-trial :deep(.result-actions .el-button){min-height:44px}.reverse-help{flex-wrap:wrap;padding:12px 14px;gap:8px}.reverse-help p{flex-basis:100%}.reverse-help>.el-button:first-of-type{flex:1}.formats-heading{display:block;margin-bottom:10px}.formats-title h2{font-size:16px}.format-add{display:flex;margin-top:10px;gap:8px}.format-add .el-button{flex:1;padding:0 10px}.format-member{grid-template-columns:18px minmax(0,1fr) auto;gap:6px 8px;padding:10px 12px}.member-order{grid-column:1;grid-row:1}.member-description{grid-column:2;grid-row:1}.member-toggle{grid-column:3;grid-row:1;min-height:44px;gap:5px}.member-toggle :deep(.el-switch){height:44px;--el-switch-width:30px}.member-actions{grid-column:2/-1;justify-content:flex-start;flex-wrap:wrap;gap:4px}.member-actions .el-button{padding:0 8px;min-width:44px}.member-actions .remove-format{margin-left:auto}.technical-details>summary{min-height:44px;padding:0 12px}.technical-details>summary>span{display:none}.technical-content{padding:0 14px 16px}.catalog-list{max-height:48vh}.catalog-list .el-button,.managed-profile .el-button{min-height:44px}.managed-profile{flex-wrap:wrap}.managed-profile>div{flex-basis:100%}.managed-profile .el-button{flex:1}.format-catalog :deep(.el-input__wrapper){min-height:44px}.format-catalog :deep(.el-input__inner){font-size:16px}}
</style>
