<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { ApiError, authRequest } from '../admin/core/auth/api'
import { useVisiblePolling } from '../admin/shared/composables/use-visible-polling'
import type { Credential } from './api'
import PartyIcon from './PartyIcon.vue'

type Television = { deviceId: string; deviceName: string; sessionId: string; acceptingRequests: boolean }
const endpoint = '/api/v1/admin/party/televisions'
const props = defineProps<{ nickname: string; busy: boolean }>()
const emit = defineEmits<{ joined: [credential: Credential] }>()
const access = ref<'checking' | 'ready' | 'guest'>('checking')
const televisions = ref<Television[]>([])
const reading = ref(false), joining = ref(''), readError = ref(''), joinError = ref('')
const controller = new AbortController()
const duplicateNames = computed(() => {
  const counts = new Map<string, number>()
  for (const { deviceName } of televisions.value) counts.set(deviceName, (counts.get(deviceName) ?? 0) + 1)
  return counts
})

const { refresh } = useVisiblePolling(async reason => {
  if (access.value === 'guest' || joining.value || props.busy) return
  reading.value = reason !== 'timer'
  try {
    const result = await authRequest<{ items: Television[] }>(endpoint, 'GET', undefined, 10000, controller.signal)
    if (controller.signal.aborted) return
    televisions.value = result.items
    access.value = 'ready'; readError.value = ''
  } catch (error) {
    if (controller.signal.aborted) return
    if (error instanceof ApiError && (error.status === 401 || error.status === 404)) access.value = 'guest'
    else readError.value = error instanceof Error ? error.message : '读取电视列表失败'
  } finally { reading.value = false }
}, () => access.value === 'ready' ? 5000 : undefined)

async function select(tv: Television) {
  if (joining.value || props.busy) return
  joining.value = tv.deviceId; joinError.value = ''
  let refreshList = false
  try {
    const credential = await authRequest<Credential>(`${endpoint}/${encodeURIComponent(tv.deviceId)}/join`, 'POST', {
      sessionId: tv.sessionId, name: props.nickname.trim() || '网页点歌',
    }, 10000, controller.signal)
    if (!controller.signal.aborted) emit('joined', credential)
  } catch (error) {
    if (controller.signal.aborted) return
    if (error instanceof ApiError && error.status === 401) access.value = 'guest'
    else {
      joinError.value = error instanceof Error ? error.message : '加入电视失败'
      refreshList = error instanceof ApiError && (error.status === 404 || error.status === 409)
    }
  } finally {
    joining.value = ''
    if (refreshList) void refresh()
  }
}

onBeforeUnmount(() => controller.abort())
</script>

<template>
  <template v-if="access === 'guest'">
    <h1>亲友点歌</h1>
    <div class="join-room"><PartyIcon name="tv" /><p>扫描电视上的二维码加入点歌。</p></div>
  </template>
  <template v-else>
    <div class="television-heading">
      <h1>选择电视</h1>
      <button type="button" class="text-button" :disabled="reading || !!joining || busy" @click="refresh()">刷新</button>
    </div>
    <p v-if="readError" class="inline-error" role="alert">{{ readError }}</p>
    <p v-if="joinError" class="inline-error" role="alert">{{ joinError }}</p>
    <ul v-if="televisions.length" class="television-list" aria-label="正在运行的电视" :aria-busy="reading">
      <li v-for="tv in televisions" :key="tv.deviceId">
        <button type="button" class="television-choice" :disabled="!!joining || busy" :aria-busy="joining === tv.deviceId" @click="select(tv)">
          <PartyIcon name="tv" />
          <span class="television-name">
            <strong>{{ tv.deviceName }}</strong>
            <small v-if="(duplicateNames.get(tv.deviceName) ?? 0) > 1">{{ tv.deviceId.slice(-6) }}</small>
            <small v-if="joining === tv.deviceId" role="status">正在加入…</small>
            <small v-else-if="!tv.acceptingRequests">点歌已暂停</small>
          </span>
          <PartyIcon name="chevron" />
        </button>
      </li>
    </ul>
    <p v-else-if="reading" class="join-empty" role="status">正在查找电视…</p>
    <p v-else-if="access === 'ready' && !readError" class="join-empty" role="status">暂无正在运行的电视</p>
  </template>
</template>

<style scoped>
.television-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.television-heading h1 { margin:0; }
.television-list { list-style:none; margin:0; padding:0; border-top:1px solid var(--line); }
.television-list li { border-bottom:1px solid var(--line); }
.television-choice {
  display:flex; align-items:center; gap:14px; width:100%; min-height:68px; padding:12px 8px;
  color:var(--ink); text-align:start;
}
.television-choice:hover:not(:disabled) { background:var(--soft); }
.television-choice .icon { flex:none; color:var(--blue-dark); }
.television-choice .icon:last-child { width:18px; }
.television-name { display:grid; flex:1; min-width:0; gap:4px; overflow-wrap:anywhere; }
.television-name small, .join-empty { color:var(--muted); }
.join-empty { padding:20px 0; }
</style>
