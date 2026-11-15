<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { Roles } from './api'
import type { PartySession } from './usePartySession'
import PartyIcon from './PartyIcon.vue'
const props = defineProps<{ songId: string; session: PartySession }>()
const detail = ref<Roles>(), original = ref(''), backing = ref(''), busy = ref(false), error = ref(''), saved = ref(false), resultId = ref(''), applyError = ref('')
const result = computed(() => props.session.state.snapshot?.commandResults?.find(r => r.requestId === resultId.value))
const current = computed(() => props.session.state.snapshot?.playback?.songId === props.songId && !['ENDED', 'IDLE'].includes(props.session.state.snapshot?.playback?.state ?? 'IDLE'))
const canSave = computed(() => !!detail.value && !!original.value && !!backing.value && original.value !== backing.value && !busy.value && result.value?.status !== 'SENT')
function label(stream: NonNullable<Roles['streams']>[number], index: number) { return [stream.title || `音轨 ${index + 1}`, stream.language && stream.language !== 'und' ? stream.language : '', stream.channels ? `${stream.channels} 声道` : '', stream.id].filter(Boolean).join(' · ') }
async function load() {
  busy.value = true; error.value = ''
  try { detail.value = await props.session.call<Roles>(`audio-roles/songs/${encodeURIComponent(props.songId)}`); original.value = detail.value.originalId ?? ''; backing.value = detail.value.backingId ?? '' }
  catch (e) { error.value = e instanceof Error ? e.message : '音轨读取失败' }
  finally { busy.value = false }
}
async function apply(attemptId = props.session.state.snapshot?.playback?.attemptId) {
  applyError.value = ''
  try { const r = await props.session.command('APPLY_AUDIO_ROLES', { songId: props.songId, attemptId }); resultId.value = r?.requestId ?? '' }
  catch (e) { applyError.value = e instanceof Error ? e.message : '应用失败' }
}
async function save(swap = false) {
  if (!detail.value || busy.value) return
  if (swap) { const a = original.value; original.value = backing.value; backing.value = a }
  if (!canSave.value) return
  busy.value = true; error.value = ''; saved.value = false; resultId.value = ''; applyError.value = ''
  const attempt = current.value ? props.session.state.snapshot?.playback?.attemptId : undefined
  try {
    const value = await props.session.call<Roles>(`audio-roles/songs/${encodeURIComponent(props.songId)}`, 'PUT', { originalId: original.value, backingId: backing.value, revision: detail.value.revision })
    detail.value = { ...detail.value, ...value }; saved.value = true
    if (attempt) await apply(attempt)
  } catch (e) { error.value = e instanceof Error ? e.message : '保存失败，原标记保持不变' }
  finally { busy.value = false }
}
onMounted(load)
</script>
<template><div class="stack"><p class="muted">标记保存在本 NAS，所有亲友共享。当前歌曲会立即应用，并保留播放位置和暂停状态。</p><p v-if="error" class="inline-error" role="alert">{{ error }}</p><p v-if="busy && !detail" role="status">正在读取音轨…</p><div v-else-if="!detail?.streams || detail.streams.length < 2" class="empty-state compact"><PartyIcon name="filter" /><h3>还没有可订正的音轨</h3><p>请先在电视或管理后台完成媒体探测。单音轨歌曲可在电视音轨设置中试听左右声道。</p><button class="outline" :disabled="busy" @click="load">重新读取</button></div><template v-else><div v-if="detail.streams.length === 2 && original && backing" class="swap-panel"><div><strong>原唱和伴奏反了？</strong><p class="muted">两条音轨一键对调并保存</p></div><button class="subtle" :disabled="!canSave" @click="save(true)"><PartyIcon name="shuffle" />一键对调</button></div><label class="field">原唱<select v-model="original" :disabled="busy"><option value="">选择有人声的音轨</option><option v-for="(stream, index) in detail.streams" :key="stream.id" :value="stream.id">{{ label(stream, index) }}</option></select></label><label class="field">伴奏<select v-model="backing" :disabled="busy"><option value="">选择无人声的音轨</option><option v-for="(stream, index) in detail.streams" :key="stream.id" :value="stream.id">{{ label(stream, index) }}</option></select></label><p v-if="original && original === backing" class="inline-error">原唱和伴奏需要选择不同音轨。</p><button class="primary full" :disabled="!canSave" @click="save()">{{ busy ? '正在保存…' : '保存原伴标记' }}</button></template><div v-if="saved" class="save-result" role="status"><strong v-if="result?.status === 'EXECUTED'">标记已保存，电视已应用</strong><strong v-else-if="applyError || result?.status === 'FAILED'">标记已保存，电视尚未应用</strong><strong v-else-if="resultId">标记已保存，等待电视应用</strong><strong v-else>原伴标记已保存到本 NAS</strong><p v-if="applyError || result?.status === 'FAILED'" class="muted">{{ applyError || result?.detail }}。保存的标记会保留。</p><button v-if="current && (applyError || result?.status === 'FAILED')" class="outline" :disabled="busy || session.state.busy" @click="apply()">重新应用到电视</button></div></div></template>
