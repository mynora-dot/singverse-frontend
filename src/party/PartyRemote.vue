<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { QueueCommand } from './api'
import type { PartySession } from './usePartySession'
import PartyIcon from './PartyIcon.vue'
import SongArtwork from './SongArtwork.vue'

const props = defineProps<{ session: PartySession; compact?: boolean }>()
const emit = defineEmits<{
  confirm: [action: string]
  correct: []
  command: [action: string, fields?: Partial<QueueCommand>]
  reaction: [kind: 'LIKE' | 'CLAP' | 'CHEER']
}>()
const audioRoles = [{ id: 'original', label: '原唱' }, { id: 'backing', label: '伴奏' }] as const
const reactions = [
  { kind: 'LIKE', icon: 'like', label: '点赞' },
  { kind: 'CLAP', icon: 'clap', label: '鼓掌' },
  { kind: 'CHEER', icon: 'cheer', label: '喝彩' },
] as const

const snapshot = computed(() => props.session.state.snapshot)
const playback = computed(() => snapshot.value?.playback)
const current = computed(() => props.session.current.value)
const connected = computed(() => props.session.state.online && !!snapshot.value?.tvOnline)
const live = computed(() => connected.value && snapshot.value?.status === 'ACTIVE')
const remoteAvailable = computed(() => live.value && snapshot.value?.queuePolicy === 'FAIR')
const enabled = computed(() => remoteAvailable.value && !props.session.state.busy && !props.session.state.pending)
const active = computed(() => !!playback.value && !['ENDED', 'IDLE', 'ERROR'].includes(playback.value.state) && !snapshot.value?.manualStopped)
const playing = computed(() => live.value && active.value && playback.value?.state === 'PLAYING')
const canSwitchRole = computed(() => remoteAvailable.value && active.value && snapshot.value?.capabilities?.includes('AUDIO_ROLE'))
const roleName = computed(() => audioRoles.find(role => role.id === playback.value?.audioRole)?.label)
const canReact = computed(() => live.value && snapshot.value?.capabilities?.includes('REACTIONS'))
const primaryControl = computed(() => {
  if (!active.value) return { action: 'START', label: '开始', icon: 'play' }
  if (playback.value?.state === 'PAUSED') return { action: 'RESUME', label: '继续', icon: 'play' }
  return { action: 'PAUSE', label: '暂停', icon: 'pause' }
})
const statusLabel = computed(() => {
  if (snapshot.value?.status === 'ENDED') return '本场已结束'
  if (!props.session.state.online) return '正在重连'
  if (snapshot.value?.tvOnline && snapshot.value.manualStopped) return '已停止'
  return props.session.playbackStatus.value
})
const remoteHint = computed(() => {
  if (snapshot.value?.status !== 'ACTIVE') return ''
  if (!props.session.state.online) return '连接恢复后，将同步电视的播放进度。'
  if (!snapshot.value.tvOnline) return '电视上线后即可遥控和互动。'
  if (snapshot.value.queuePolicy !== 'FAIR') return '更新电视端后可使用全员遥控。'
  return ''
})

const now = ref(Date.now())
watch(() => playing.value && !props.compact, (ticking, _, onCleanup) => {
  if (!ticking) return
  now.value = Date.now()
  const timer = setInterval(() => { now.value = Date.now() }, 1000)
  onCleanup(() => clearInterval(timer))
}, { immediate: true })
const duration = computed(() => playback.value?.durationMs ?? 0)
const position = computed(() => {
  const p = playback.value
  if (!p) return 0
  const age = p.sampledAt && snapshot.value?.sampledAt ? Date.parse(snapshot.value.sampledAt) - Date.parse(p.sampledAt) : 0
  const elapsed = playing.value
    ? Math.max(0, now.value - props.session.state.receivedAt) + Math.max(0, age || 0)
    : 0
  return Math.min(duration.value || Number.MAX_SAFE_INTEGER, Math.max(0, (p.positionMs ?? 0) + elapsed))
})
const canSeek = computed(() => enabled.value && active.value && duration.value > 0 && snapshot.value?.capabilities?.includes('SEEK')
  && !['PREPARING', 'BUFFERING'].includes(playback.value?.state ?? ''))
const draft = ref<number | null>(null)
const shownPosition = computed(() => draft.value ?? position.value)
let seekAttempt = ''
watch([canSeek, () => playback.value?.attemptId], () => { draft.value = null })
function time(ms: number) {
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
function preview(event: Event) {
  if (!canSeek.value || !playback.value) return
  if (draft.value === null) seekAttempt = playback.value.attemptId
  draft.value = (event.target as HTMLInputElement).valueAsNumber
}
function seek() {
  if (draft.value !== null && canSeek.value && seekAttempt === playback.value?.attemptId) {
    emit('command', 'SEEK', { positionMs: draft.value, attemptId: seekAttempt })
  }
  draft.value = null
}
</script>

<template>
  <section class="remote-panel" :class="{ compact }" aria-label="电视播放">
    <div class="tv-screen">
      <div class="playing-track">
        <div v-if="current" class="record-sleeve">
          <SongArtwork :path="current.song.coverPath" :token="session.state.credential?.token" alt="" />
        </div>
        <div v-else class="empty-art"><PartyIcon name="tv" /></div>
        <div class="track-info">
          <p v-if="current || statusLabel !== '等待开唱'" class="tv-status" role="status"
            :class="{ offline: !connected, playing }">{{ statusLabel }}</p>
          <h2 :title="current?.song.title">{{ current?.song.title || (snapshot?.status === 'ENDED' ? '暂无播放' : '等待开唱') }}</h2>
          <p v-if="current" class="track-credits">{{ current.song.artists?.join(' / ') || '歌手未知' }}<template v-if="current.ownerName"> · {{ current.ownerName }}点的</template></p>
          <p v-else-if="session.waiting.value.length" class="track-credits">队列里有 {{ session.waiting.value.length }} 首待唱。</p>
          <p v-else-if="live && snapshot?.acceptingRequests" class="track-credits">去曲库挑一首想唱的歌。</p>
        </div>
      </div>
      <div v-if="!compact && playback" class="player-timeline">
        <span v-if="!connected">上次进度</span>
        <span>{{ time(shownPosition) }}</span>
        <template v-if="duration > 0">
          <input :key="playback.attemptId" class="seek-range" type="range" min="0" :max="duration" step="1000" :value="shownPosition"
            :style="{ '--played': `${100 * shownPosition / duration}%` }" aria-label="电视播放进度"
            :aria-valuetext="`${time(shownPosition)} / ${time(duration)}`" :disabled="!canSeek" @input="preview" @change="seek">
          <span>{{ time(duration) }}</span>
        </template>
        <span v-else class="unknown-duration">总时长待同步</span>
      </div>
      <p v-if="remoteHint" class="remote-hint">{{ remoteHint }}</p>
      <div v-else-if="remoteAvailable && (active || (!compact && session.waiting.value.length))" class="remote-main-controls">
        <button v-if="!compact" class="secondary-control" :disabled="!enabled || !active" @click="emit('confirm', 'RESTART')">
          <PartyIcon name="restart" />重唱
        </button>
        <button class="primary-control" :disabled="!enabled" @click="emit('command', primaryControl.action)">
          <PartyIcon :name="primaryControl.icon" />{{ primaryControl.label }}
        </button>
        <button class="secondary-control" :disabled="!enabled || !active" @click="emit('confirm', 'NEXT')">
          <PartyIcon name="next" />切歌
        </button>
      </div>
    </div>

    <div v-if="!compact && (current || canSwitchRole)" class="role-controls">
      <h3>播放音轨</h3>
      <div v-if="canSwitchRole" class="segmented" role="group" aria-label="播放音轨">
        <button v-for="role in audioRoles" :key="role.id" :class="{ active: playback?.audioRole === role.id }"
          :aria-pressed="playback?.audioRole === role.id" :disabled="!enabled" @click="emit('command', 'AUDIO_ROLE', { role: role.id })">
          {{ role.label }}
        </button>
      </div>
      <span v-else-if="roleName" class="role-value">{{ roleName }}</span>
      <button v-if="current" class="text-button correct-role" aria-label="原伴不对？纠正音轨" :disabled="!session.state.online" @click="emit('correct')">
        纠正音轨<PartyIcon name="chevron" />
      </button>
    </div>
    <section v-if="canReact" class="reactions" aria-label="现场互动">
      <h3 v-if="!compact">现场互动</h3>
      <div class="reaction-row">
        <button v-for="reaction in reactions" :key="reaction.kind" class="reaction-btn" @click="emit('reaction', reaction.kind)">
          <PartyIcon :name="reaction.icon" />{{ reaction.label }}
        </button>
      </div>
    </section>
  </section>
</template>

<style scoped>
.remote-panel {
  min-width: 0;
  container-type: inline-size;
}
.tv-screen {
  --art-size: 76px;
  --player-muted: #c8d5ee;
  --progress-fill: #a6c4ff;
  --progress-track: #465775;
  padding: 18px;
  border-radius: 16px;
  color: #fff;
  background: radial-gradient(ellipse at 0 0, #354f80, transparent 68%), linear-gradient(120deg, #203256, #142139 85%);
}
.playing-track { display: flex; align-items: center; gap: 16px; min-width: 0; }
.record-sleeve, .empty-art { flex: none; height: var(--art-size); }
.record-sleeve { position: relative; width: calc(var(--art-size) + 10px); }
.record-sleeve::before {
  content: "";
  position: absolute;
  inset: 3px 0 3px auto;
  aspect-ratio: 1;
  border-radius: 50%;
  background: repeating-radial-gradient(circle, transparent 0 3px, #a8bbdf36 3px 4px), linear-gradient(145deg, #64779b, #122038 62%, #46597d);
}
.record-sleeve .cover {
  position: relative;
  width: var(--art-size);
  height: var(--art-size);
  border-radius: 8px;
  box-shadow: 0 3px 10px #08132840;
}
.empty-art { width: var(--art-size); display: grid; place-items: center; color: var(--player-muted); background: #ffffff10; border-radius: 10px; }
.empty-art .icon { width: 30px; height: 30px; }
.track-info { flex: 1; min-width: 0; }
.track-info h2, .track-credits {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.track-info h2 { font-size: 22px; line-height: 1.25; letter-spacing: -.4px; }
.track-credits { margin-top: 5px; color: var(--player-muted); font-size: 13px; line-height: 1.5; }
.tv-status { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; color: var(--player-muted); font-size: 12px; font-weight: 600; line-height: 1.4; }
.tv-status::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: #aab9d1; }
.tv-status.playing::before { background: #77deba; }
.tv-status.offline::before { background: #f2bf76; }
.player-timeline {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  margin-top: 6px;
  color: var(--player-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.player-timeline span { flex: none; }
.unknown-duration { margin-left: auto; }
input.seek-range {
  appearance: none;
  flex: 1;
  min-width: 44px;
  width: 0;
  height: 44px;
  margin: 0;
  background: transparent;
}
.seek-range::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 2px;
  background: linear-gradient(to right, var(--progress-fill) var(--played), var(--progress-track) var(--played));
}
.seek-range::-webkit-slider-thumb { appearance: none; width: 12px; height: 12px; margin-top: -4px; border-radius: 50%; background: #fff; }
.seek-range::-moz-range-track { height: 4px; border-radius: 2px; background: var(--progress-track); }
.seek-range::-moz-range-progress { height: 4px; border-radius: 2px; background: var(--progress-fill); }
.seek-range::-moz-range-thumb { width: 12px; height: 12px; border: 0; border-radius: 50%; background: #fff; }
.seek-range:disabled { cursor: default; }
.seek-range:disabled::-webkit-slider-thumb { opacity: 0; }
.seek-range:disabled::-moz-range-thumb { opacity: 0; }
.remote-hint { padding-top: 10px; border-top: 1px solid #ffffff24; font-size: 13px; color: var(--player-muted); }
.playing-track + .remote-hint, .playing-track + .remote-main-controls { margin-top: 16px; }
.remote-main-controls { display: grid; grid-template-columns: 1fr 1.3fr 1fr; gap: 8px; }
.remote-main-controls button {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  min-height: 44px; padding: 8px 4px; border-radius: 24px; font-size: 14px; font-weight: 600;
}
.remote-main-controls .icon { width: 18px; height: 18px; }
.secondary-control { color: #e2eafb; }
.secondary-control:not(:disabled):hover { background: #ffffff18; }
.primary-control { color: #162747; background: #f3f7ff; }
.primary-control:not(:disabled):hover { background: #dce9ff; }
.remote-main-controls button:disabled { color: #a3afc5; background: transparent; }
.remote-main-controls .primary-control:disabled { background: #ffffff10; }

.role-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; min-height: 60px; padding: 8px 0; border-bottom: 1px solid var(--line); }
.role-controls h3, .reactions h3 { font-size: 16px; line-height: 1.4; }
.role-controls .segmented { padding: 3px; gap: 2px; }
.role-controls .segmented button { min-width: 48px; padding: 6px 10px; }
.role-value { font-size: 14px; color: var(--muted); }
.correct-role { margin-left: auto; padding: 6px 0 6px 4px; gap: 2px; font-size: 13px; border-radius: 6px; }
.correct-role .icon { width: 14px; height: 14px; }
.reactions { display: grid; gap: 10px; padding-top: 16px; }
.reaction-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.reaction-btn {
  display: flex; align-items: center; justify-content: center; gap: 7px; min-height: 46px;
  padding: 8px 4px; border: 1px solid var(--line); border-radius: 10px; color: var(--ink); font-size: 14px; font-weight: 600;
}
.reaction-btn .icon { width: 19px; height: 19px; color: var(--blue-dark); }
.reaction-btn:not(:disabled):hover, .reaction-btn:active { background: var(--blue-soft); }
.compact .tv-screen { --art-size: 58px; padding: 16px; border-radius: 0; }
.compact .track-info h2 { font-size: 18px; }
.compact .remote-main-controls { grid-template-columns: 1fr 1fr; }
.compact .reactions { padding: 12px; }
@container (min-width: 520px) {
  .tv-screen { --art-size: 90px; padding: 24px; }
  .track-info h2 { font-size: 26px; }
  .remote-main-controls { max-width: 420px; margin-inline: auto; }
}
</style>
