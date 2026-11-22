<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Headset } from '@element-plus/icons-vue'
import { ElAlert, ElButton, ElDialog, ElIcon, ElTag } from 'element-plus'
import AudioTrackPreview from './AudioTrackPreview.vue'
import AccompanimentPreview from './AccompanimentPreview.vue'
import { authRequest } from '../../../core/auth/api'
import { accompanimentUrl, songRoles, type AudioJob, type AudioRoles, type AudioRow, type AudioVersion, type Backend, type Node, type SeparationCapabilities, type SeparationProfile } from '../../audio-processing/api'
import { analysisReason, audioFailureMessage, backendName, failure, jobKinds, jobStates, latestAnalysis, latestJob, originLabel, profileBackends, profileName, profileReady, rolesSummary, streamLabel } from '../../audio-processing/presentation'
import SeparationControls from '../../audio-processing/components/SeparationControls.vue'

const props = withDefaults(defineProps<{ songId: string; song?: AudioRow; canProcess?: boolean; separation?: SeparationCapabilities; backends?: Backend[]; workbench?: boolean }>(), { canProcess: true })
const emit = defineEmits<{ changed: []; setup: [] }>()
const detail = ref<AudioRoles>(), original = ref(''), error = ref(''), notice = ref(''), busy = ref(false)
const node = ref<Node>(), profile = ref<SeparationProfile>('DSP_FAST'), preferred = ref('')
const sourceAudio = ref(''), sourceConfirmed = ref(false), coverFailed = ref(false), deleting = ref<AudioVersion>()
const root = ref<HTMLElement>(), currentPreview = ref<InstanceType<typeof AccompanimentPreview>>()
let timer: ReturnType<typeof setTimeout> | undefined, generation = 0
const base = () => songRoles(props.songId)
const inFlight = (job?: AudioJob) => !!job && ['QUEUED', 'RUNNING'].includes(job.state)
const capabilities = computed(() => props.separation || node.value?.separation)
const devices = computed(() => profileBackends(capabilities.value, profile.value, props.backends || node.value?.backends || []))
const reusingSource = computed(() => !!sourceAudio.value || (detail.value?.state === 'CONFIRMED' && !!detail.value.backingId))
const ready = computed(() => profileReady(capabilities.value, reusingSource.value ? 'DSP_FAST' : profile.value, props.canProcess))
const summary = computed(() => rolesSummary(detail.value))
const streams = computed(() => detail.value?.streams ?? [])
const uniqueOriginal = computed(() => detail.value?.state === 'CONFIRMED' && detail.value.originalSelection?.kind === 'UNIQUE_AUDIO')
const canGenerate = computed(() => streams.value.length === 1 || uniqueOriginal.value || reusingSource.value)
const separate = computed(() => latestJob(detail.value, 'SEPARATE'))
const deepAnalyze = computed(() => latestJob(detail.value, 'ANALYZE'))
const analyze = computed(() => latestAnalysis(detail.value))
const quick = computed(() => latestJob(detail.value, 'FAST'))
const canQuick = computed(() => detail.value?.state !== 'CONFIRMED')
const running = computed(() => detail.value?.jobs.filter(inFlight) ?? [])
const history = computed(() => detail.value?.jobs.filter(job => !inFlight(job)) ?? [])
const versions = computed(() => detail.value?.versions ?? [])
const cleanupPending = computed(() => detail.value?.jobs.some(job => job.cleanupState === 'PENDING'))
const reading = computed(() => running.value.some(job => job.kind !== 'SEPARATE'))
const canAnalyze = computed(() => !deepAnalyze.value || ['FAILED', 'CANCELLED'].includes(deepAnalyze.value.state) ||
  (deepAnalyze.value.state === 'SUCCEEDED' && detail.value?.state !== 'CONFIRMED' && deepAnalyze.value.resultState !== 'CONFIDENT'))
const backing = computed(() => original.value ? streams.value.find(stream => stream.id !== original.value)?.id ?? '' : '')
const confirmed = computed(() => detail.value?.state === 'CONFIRMED' && original.value === detail.value.originalId)
const saveLabel = computed(() => confirmed.value && detail.value?.origin === 'AUTO' ? '确认自动标记' : '保存标记')
const needsNode = computed(() => !detail.value?.streams || (streams.value.length === 1 && !detail.value.backingResource) || (streams.value.length === 2 && canAnalyze.value))
const generationDisabled = computed(() => busy.value || !ready.value || !canGenerate.value || inFlight(separate.value) || (!!sourceAudio.value && !sourceConfirmed.value))
const extension = computed(() => props.song?.relativePath?.split('.').pop()?.toUpperCase())
const durationLabel = computed(() => {
  const seconds = detail.value?.duration || detail.value?.backingResource?.duration
  return seconds ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : ''
})
const isCurrent = (version: AudioVersion) => version.jobId === detail.value?.backingResource?.jobId || !!versions.value.find(item => item.jobId === version.jobId)?.active
const versionTitle = (version: AudioVersion) => `${profileName(version.separationProfile)} · ${version.preview ? '12 秒试听' : '整曲'} · ${version.outputFormat === 'flac' ? 'FLAC' : 'AAC'}`
const versionDate = (version: AudioVersion) => version.createdAt ? new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(version.createdAt) : ''
watch(devices, value => { if (!value.some(item => item.id === preferred.value)) preferred.value = '' })
watch(sourceAudio, () => { sourceConfirmed.value = false })
async function loadCapabilities(turn: number) {
  if (props.separation) return
  try { const value = await authRequest<Node>('/api/v1/audio-processing/node', 'GET', undefined, 60000); if (turn === generation) node.value = value } catch { /* Older nodes keep their legacy controls. */ }
}
async function load(turn: number) {
  try {
    const value = await authRequest<AudioRoles>(`${base()}/audio-roles`)
    if (turn !== generation) return
    if (!detail.value || detail.value.revision !== value.revision) original.value = value.state === 'CONFIRMED' ? value.originalId ?? '' : ''
    detail.value = value
  } catch (e) { if (turn === generation) error.value = failure(e, '读取失败') }
}
async function action(run: () => Promise<unknown>, message: string) {
  if (busy.value) return false
  const turn = generation
  busy.value = true; error.value = ''; notice.value = ''
  try { await run(); if (turn !== generation) return false; notice.value = message; emit('changed'); await load(turn); return true }
  catch (e) { if (turn === generation) error.value = failure(e); return false }
  finally { if (turn === generation) busy.value = false }
}
const submit = (kind: string, message: string) => action(() => authRequest(`${base()}/audio-jobs`, 'POST', { kind }), message)
function generate(preview: boolean, outputFormat: 'aac' | 'flac' = 'aac') {
  if (generationDisabled.value) return
  return action(() => authRequest(`${base()}/audio-jobs`, 'POST', {
    kind: 'SEPARATE', separationProfile: reusingSource.value ? 'DSP_FAST' : profile.value, backend: reusingSource.value ? '' : preferred.value, preview, outputFormat,
    ...(sourceAudio.value ? { sourceAudioId: sourceAudio.value, sourceConfirmed: true } : {}),
  }), preview ? '已加入 12 秒试听队列，完成后可在伴奏版本中播放' : outputFormat === 'flac' ? '已加入 FLAC 导出队列，将从源文件重新按所选配方生成' : '已加入整曲生成队列；已有伴奏会保留，可试听后切换')
}
const activate = (jobId: string) => action(() => authRequest(`${base()}/accompaniment/${encodeURIComponent(jobId)}/activate`, 'POST'), '已切换当前伴奏，下次播放生效')
const cancel = (id: string) => action(() => authRequest(`${base()}/audio-jobs/${encodeURIComponent(id)}/cancel`, 'POST'), '已取消任务')
const save = () => action(() => authRequest(`${base()}/audio-roles`, 'PUT', { originalId: original.value, backingId: backing.value, revision: detail.value?.revision }), '已保存，下次点这首歌时生效')
function requestDelete(version: AudioVersion) { if (!busy.value && !isCurrent(version)) { deleting.value = version; error.value = '' } }
async function deleteVersion() {
  const version = deleting.value
  if (!version || isCurrent(version)) return
  const removed = await action(() => authRequest(accompanimentUrl(props.songId, version.jobId), 'DELETE'), '已删除伴奏版本')
  if (removed) { currentPreview.value?.stopVersion(version.jobId); deleting.value = undefined }
}
function onPlay(event: Event) { root.value?.querySelectorAll('audio').forEach(audio => { if (audio !== event.target && !audio.paused) audio.pause() }) }
async function poll(turn: number) {
  await load(turn)
  if (turn === generation) timer = setTimeout(() => { void poll(turn) }, 4000)
}
watch(() => props.songId, () => {
  generation++; clearTimeout(timer); detail.value = undefined; original.value = ''; sourceAudio.value = ''; sourceConfirmed.value = false; busy.value = false; error.value = ''; notice.value = ''; deleting.value = undefined; coverFailed.value = false; node.value = undefined
  void poll(generation); void loadCapabilities(generation)
}, { immediate: true })
onBeforeUnmount(() => { generation++; clearTimeout(timer) })
</script>

<template>
  <section ref="root" class="audio-roles-panel" :class="{ 'in-workbench': workbench, 'has-generation': capabilities && (streams.length || uniqueOriginal) }" aria-label="原唱与伴奏" @play.capture="onPlay">
    <header v-if="song" class="song-overview">
      <div class="song-cover"><img v-if="song.coverAvailable && !coverFailed" :src="`/api/v1/metadata/songs/${encodeURIComponent(songId)}/cover`" alt="" @error="coverFailed = true"><ElIcon v-else :size="28"><Headset /></ElIcon></div>
      <div class="song-identity"><h2>{{ song.title }}</h2><p>{{ song.artists?.join(' / ') || '未知歌手' }}</p></div>
      <div class="song-facts"><span v-if="song.sourceName">{{ song.sourceName }}</span><span v-if="extension">{{ extension }}</span><span v-if="durationLabel">{{ durationLabel }}</span></div>
    </header>
    <ElAlert v-if="error && !deleting" :title="error" type="error" show-icon :closable="false" role="alert" />
    <p v-if="notice" class="roles-notice" role="status">{{ notice }}</p>
    <AccompanimentPreview v-if="detail?.backingResource" ref="currentPreview" :song-id="songId" :version="detail.backingResource" :duration="detail.duration" />
    <div v-if="!detail?.backingResource || detail.packageRoleHint" class="roles-status" :class="'is-' + summary.tone"><ElTag :type="summary.tone" effect="light" round>{{ summary.tag }}</ElTag><div><h3>{{ summary.title }}</h3><p v-if="detail?.packageRoleHint && detail.state !== 'CONFIRMED'">{{ summary.hint }}</p></div></div>

    <dl v-if="detail?.state === 'CONFIRMED' && detail.origin" class="roles-origin"><dt>标记来源</dt><dd>{{ originLabel(detail.origin) }}</dd></dl>
    <div v-if="detail && !detail.streams && !uniqueOriginal" class="roles-actions"><ElButton type="primary" :disabled="busy || reading" @click="submit('PROBE', '已开始读取音轨')">读取音轨</ElButton></div>
    <fieldset v-if="streams.length === 2" class="roles-block track-choice" :disabled="busy">
      <legend>哪一条是原唱？</legend>
      <label v-for="(stream, index) in streams" :key="stream.id" class="track-option" :class="{ 'is-checked': original === stream.id }"><input v-model="original" type="radio" :name="'original-' + songId" :value="stream.id"><span class="track-name">{{ streamLabel(stream, index) }}</span><span v-if="original" class="track-role" :class="{ 'is-original': original === stream.id }">{{ original === stream.id ? '原唱' : '伴奏' }}</span></label>
      <AudioTrackPreview :song-id="songId" :streams="streams" />
      <div class="roles-actions"><ElButton type="primary" :disabled="busy || !backing || (confirmed && detail?.origin !== 'AUTO')" @click="save">{{ saveLabel }}</ElButton><ElButton v-if="canQuick" :disabled="busy || reading" @click="submit('FAST', '已开始快速识别；不确定时保留人工确认')">{{ quick ? '重新快速识别' : '快速识别' }}</ElButton><ElButton v-if="canAnalyze" :disabled="busy || !canProcess || reading" @click="submit('ANALYZE', '已开始深度识别，将分离多个片段的人声，耗时较长')">深度识别</ElButton></div>
    </fieldset>
    <section v-else-if="streams.length > 2" class="roles-block" aria-label="逐轨试听"><h3>逐轨试听</h3><AudioTrackPreview :song-id="songId" :streams="streams" /></section>

    <section v-if="capabilities && (streams.length || uniqueOriginal)" class="generation-block" aria-label="生成与试听伴奏">
      <div class="section-heading"><h3>{{ reusingSource ? '提取已确认的伴奏' : '生成新伴奏' }}</h3></div>
      <SeparationControls v-if="!reusingSource && canGenerate" v-model:profile="profile" v-model:backend="preferred" :backends="devices" :disabled="busy || inFlight(separate)" :cards="workbench" />
      <p v-if="!canGenerate" class="muted">请先试听并标记原唱与伴奏，或选择已确认的源伴奏音轨。</p>
      <p v-if="!ready" class="muted">所选方案尚未通过节点试跑。<ElButton link type="primary" @click="emit('setup')">准备环境</ElButton></p>
      <div class="generation-footer"><div class="roles-actions generation-actions"><ElButton :disabled="generationDisabled" @click="generate(true)">生成 12 秒试听</ElButton><ElButton type="primary" :disabled="generationDisabled" @click="generate(false)">生成整曲伴奏</ElButton></div></div>
    </section>
    <div v-else-if="(streams.length === 1 || uniqueOriginal) && !detail?.backingResource && !inFlight(separate)" class="roles-actions"><ElButton type="primary" :disabled="busy || !canProcess" @click="submit('SEPARATE', '已加入生成队列，可以关闭此窗口，完成后自动可用')">{{ separate?.state === 'FAILED' ? '重新生成伴奏' : '生成独立伴奏' }}</ElButton></div>

    <ul v-if="running.length" class="job-list" aria-label="进行中的任务"><li v-for="job in running" :key="job.id"><span class="sv-status-dot busy" aria-hidden="true" /><span>{{ jobKinds[job.kind] || job.kind }} · {{ jobStates[job.state] }}<span v-if="job.error"> · {{ audioFailureMessage(job.error) }}</span></span><ElButton :disabled="busy" @click="cancel(job.id)">取消任务</ElButton></li></ul>
    <div class="additional-options">
      <details v-if="capabilities && streams.length" class="option-section source-options"><summary><span>从已有音轨提取伴奏</span></summary><div class="option-body"><AudioTrackPreview v-if="streams.length === 1" :song-id="songId" :streams="streams" /><label class="source-label">已确认的源伴奏<select v-model="sourceAudio" aria-label="已确认的源伴奏" :disabled="busy || inFlight(separate)"><option value="">{{ detail?.backingId ? '使用已标记的伴奏音轨' : '没有源伴奏，按方案生成' }}</option><template v-for="(stream, index) in streams" :key="stream.id"><option :value="stream.id">{{ streamLabel(stream, index) }} · 整条</option><option v-if="stream.channels === 2" :value="stream.id + ':LEFT'">音轨 {{ index + 1 }} · 左声道</option><option v-if="stream.channels === 2" :value="stream.id + ':RIGHT'">音轨 {{ index + 1 }} · 右声道</option></template></select></label><label v-if="sourceAudio" class="confirm-source"><input v-model="sourceConfirmed" type="checkbox" :disabled="busy || inFlight(separate)">我已试听，确认所选音轨或声道是伴奏</label></div></details>
      <details v-if="versions.length" class="option-section version-options" aria-label="伴奏版本"><summary><span>伴奏版本与删除 <b class="version-count">{{ versions.length }}</b></span></summary><div class="option-body"><article v-for="version in versions" :key="version.jobId" class="version"><div class="version-heading"><div><h4>{{ versionTitle(version) }}</h4><time v-if="versionDate(version)">{{ versionDate(version) }} 生成</time></div><ElTag v-if="isCurrent(version)" type="success" effect="light">当前使用</ElTag></div><audio class="backing-player" :src="accompanimentUrl(songId, version.jobId)" controls preload="none" :aria-label="versionTitle(version) + '试听'" /><div class="roles-actions version-actions"><a :href="accompanimentUrl(songId, version.jobId)" :download="`${songId}-${version.jobId}.${version.outputFormat === 'flac' ? 'flac' : 'm4a'}`">下载{{ version.outputFormat === 'flac' ? ' FLAC' : '' }}</a><ElButton v-if="!version.preview && version.outputFormat !== 'flac' && !isCurrent(version)" :disabled="busy" @click="activate(version.jobId)">设为当前伴奏</ElButton><ElButton class="delete-version" :disabled="busy || isCurrent(version)" :aria-label="isCurrent(version) ? '当前伴奏不能删除' : '删除 ' + versionTitle(version)" @click="requestDelete(version)">删除</ElButton></div></article></div></details>
      <details v-if="capabilities && (streams.length || uniqueOriginal)" class="option-section"><summary><span>从源文件导出 FLAC</span></summary><div class="option-body"><ElButton :disabled="generationDisabled" @click="generate(false, 'flac')">生成 FLAC 导出</ElButton></div></details>
      <details v-if="analyze?.evidence" class="option-section job-history" aria-label="识别依据"><summary>识别依据</summary><div class="option-body"><p class="muted">{{ analyze.evidence.analysisVersion || '旧版分析' }} · {{ analyze.evidence.method === 'LABELS' ? '音轨标签' : `${analyze.evidence.vocalScores?.length || analyze.evidence.vocalRatio?.length || 0} 个片段` }}；{{ analyze.evidence.vocalScores ? '数值为人声分类分数' : '数值为人声与输入的能量比' }}，不是准确率。</p><p v-if="analyze.reason" class="muted">{{ analysisReason(analyze.reason) }}</p><ul><li v-for="(pair, index) in (analyze.evidence.vocalScores || analyze.evidence.vocalRatio)" :key="index">片段 {{ index + 1 }}<template v-if="analyze.evidence.windows?.[index]">（{{ Math.round(analyze.evidence.windows[index]!.start) }} 秒起）</template> · 音轨 1：{{ pair[0].toFixed(3) }} · 音轨 2：{{ pair[1].toFixed(3) }}</li></ul></div></details>
      <details v-if="history.length" class="option-section job-history"><summary>处理记录 <b class="version-count">{{ history.length }}</b></summary><div class="option-body"><ul><li v-for="job in history" :key="job.id"><span v-if="job.createdAt">{{ new Date(job.createdAt).toLocaleString('zh-CN') }} · </span>{{ jobKinds[job.kind] || job.kind }} · <span :class="{ danger: job.state === 'FAILED' }">{{ jobStates[job.state] || job.state }}</span><span v-if="job.backend"> · {{ backendName(job.backend) }}</span><span v-if="job.error" class="danger"> · {{ audioFailureMessage(job.error) }}</span></li></ul></div></details>
    </div>
    <p v-if="!canProcess && needsNode && !capabilities" class="roles-setup">分离环境未就绪。<ElButton link type="primary" @click="emit('setup')">去准备环境</ElButton></p>
    <details v-if="cleanupPending" class="cleanup-note"><summary>临时采样文件待清理，不影响已保存的伴奏</summary><p class="muted">音轨处理结果已保留；后台会单独重试清理，不会重新识别。</p></details>
    <ElDialog :model-value="!!deleting" title="删除这个伴奏版本？" width="420px" append-to-body class="audio-version-delete-dialog" :close-on-click-modal="!busy" :close-on-press-escape="!busy" :show-close="!busy" @update:model-value="value => { if (!value && !busy) deleting = undefined }"><template v-if="deleting"><p class="delete-title">{{ versionTitle(deleting) }}</p><p v-if="versionDate(deleting)" class="muted">{{ versionDate(deleting) }} 生成</p><p class="delete-explanation">该伴奏版本将被永久删除。源歌曲和当前使用的伴奏会保留。</p><ElAlert v-if="error" :title="error" type="error" :closable="false" show-icon role="alert" /><p v-if="isCurrent(deleting)" class="danger">此版本已成为当前伴奏，请先切换其他版本。</p></template><template #footer><ElButton :disabled="busy" @click="deleting = undefined">保留版本</ElButton><ElButton type="danger" :loading="busy" :disabled="!deleting || isCurrent(deleting)" @click="deleteVersion">确认删除</ElButton></template></ElDialog>
  </section>
</template>

<style scoped src="./audio-roles-panel.css"></style>
