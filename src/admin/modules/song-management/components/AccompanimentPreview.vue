<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Download, Headset, Microphone, Mute, VideoPause, VideoPlay } from '@element-plus/icons-vue'
import { ElIcon } from 'element-plus'
import type Hls from 'hls.js'
import { accompanimentUrl, type AudioVersion } from '../../audio-processing/api'
import { playback, type Resource } from '../../transcoding/playback'
import { AdminPlaybackActivity } from '../../transcoding/activity'

const props = defineProps<{ songId: string; version: AudioVersion; duration?: number }>()
const player = ref<HTMLAudioElement>()
const track = ref<'original' | 'backing'>('backing')
const playing = ref(false), loading = ref(false), muted = ref(false), elapsed = ref(0), length = ref(0), error = ref('')
const total = computed(() => length.value || (track.value === 'backing' ? props.version.duration : props.duration) || 0)
const expectedKey = computed(() => track.value === 'backing' ? props.version.jobId : 'original')
const pendingVersion = computed(() => track.value === 'backing' && loadedKey.value && loadedKey.value !== props.version.jobId)
const loadedKey = ref('')
let generation = 0, resource: Resource | undefined, hls: Hls | undefined, activity: AdminPlaybackActivity | undefined
let heartbeat: ReturnType<typeof setInterval> | undefined, removeReady: (() => void) | undefined
const offset = () => resource?.offset || 0
const time = (value: number) => `${Math.floor(Math.max(0, value) / 60)}:${String(Math.floor(Math.max(0, value) % 60)).padStart(2, '0')}`

function release() {
  activity?.transition('PREPARING')
  generation++; clearInterval(heartbeat); removeReady?.(); removeReady = undefined
  hls?.destroy(); hls = undefined
  const audio = player.value
  if (audio?.hasAttribute('src')) { audio.pause(); audio.removeAttribute('src'); audio.load() }
  if (resource?.id) void playback.cancel(resource.id).catch(() => {})
  resource = undefined; loadedKey.value = ''; playing.value = false; loading.value = false
}
function stop() { activity?.transition('STOPPED'); activity = undefined; release(); elapsed.value = 0; length.value = 0 }
function failed(message: string) { activity?.transition('ERROR'); stop(); error.value = message }
function updateTime() {
  if (!player.value) return
  elapsed.value = offset() + player.value.currentTime
  const sourceDuration = resource?.media?.duration || resource?.execution?.media?.duration
  if (sourceDuration && sourceDuration > 0) length.value = sourceDuration
  else if (Number.isFinite(player.value.duration) && player.value.duration > 0) length.value = offset() + player.value.duration
}
function reportPlaying() {
  if (!player.value || player.value.paused || player.value.seeking) return
  loading.value = false; playing.value = true
  if (!activity || activity.closed) activity = new AdminPlaybackActivity(props.songId)
  activity.transition('PLAYING', total.value > 0 ? total.value * 1000 : undefined)
}
async function start(position = elapsed.value) {
  const audio = player.value
  if (!audio) return
  error.value = ''
  if (loadedKey.value === expectedKey.value) {
    try { await audio.play() } catch { error.value = '未能开始播放，请重试' }
    return
  }
  release(); elapsed.value = position; length.value = 0; loading.value = true
  const turn = generation, key = expectedKey.value
  try {
    let value: Resource | undefined
    if (track.value === 'original') {
      value = await playback.start(props.songId, { audioRole: 'original', quality: 'auto', start: position })
      if (turn !== generation) { if (value.id) void playback.cancel(value.id).catch(() => {}); return }
      resource = value
      const deadline = Date.now() + 60000
      while (value.status !== 'READY') {
        if (['FAILED', 'CANCELLED'].includes(value.state || '')) throw new Error(value.execution?.error || value.error || '原唱准备失败')
        if (!value.id || Date.now() > deadline) throw new Error('原唱准备超时，请重试')
        await new Promise(resolve => setTimeout(resolve, 500))
        if (turn !== generation) return
        value = await playback.status(value.id)
        if (turn !== generation) return
        resource = value
      }
    }
    const ready = () => {
      if (turn !== generation) return
      loadedKey.value = key; loading.value = false
      const local = Math.max(0, position - offset())
      audio.currentTime = Number.isFinite(audio.duration) ? Math.min(local, audio.duration) : local
      updateTime()
      void audio.play().catch(() => { if (turn === generation) error.value = '点击播放按钮开始试听' })
    }
    audio.addEventListener('loadedmetadata', ready, { once: true })
    removeReady = () => audio.removeEventListener('loadedmetadata', ready)
    // The initial element uses preload=none. Explicit playback must request
    // metadata before waiting for it, otherwise native audio never starts.
    audio.preload = 'metadata'
    if (value?.mode === 'HLS') {
      const { default: Adapter } = await import('hls.js')
      if (turn !== generation) return
      if (Adapter.isSupported()) {
        hls = new Adapter()
        hls.on(Adapter.Events.ERROR, (_event, data) => { if (turn === generation && data.fatal) failed('原唱播放中断，请重新试听') })
        hls.loadSource(value.url); hls.attachMedia(audio)
      } else if (audio.canPlayType('application/vnd.apple.mpegurl')) { audio.src = value.url; audio.load() }
      else throw new Error('当前浏览器不支持原唱试听，请使用支持 HLS 的浏览器')
    } else { audio.src = value?.url || accompanimentUrl(props.songId, props.version.jobId); audio.load() }
    if (resource?.id) heartbeat = setInterval(() => { if (resource?.id) void playback.status(resource.id).catch(() => {}) }, 10000)
  } catch (e) { if (turn === generation) failed(e instanceof Error ? e.message : '试听失败') }
}
function toggle() { if (playing.value) player.value?.pause(); else void start() }
function selectTrack(value: 'original' | 'backing') {
  if (track.value === value) return
  const resume = playing.value || loading.value, position = elapsed.value
  release(); track.value = value; length.value = 0; elapsed.value = position; error.value = ''
  if (resume) void start(position)
}
function seek(event: Event) {
  const position = Number((event.target as HTMLInputElement).value), audio = player.value
  if (!audio || !Number.isFinite(position)) return
  elapsed.value = position
  if (position < offset()) { release(); void start(position); return }
  audio.currentTime = Math.max(0, position - offset())
}
function toggleMute() { muted.value = !muted.value; if (player.value) player.value.muted = muted.value }
watch(() => props.songId, () => { stop(); track.value = 'backing'; error.value = '' })
watch(() => props.version.jobId, () => { if (!playing.value) { release(); elapsed.value = 0; length.value = 0 } })
onBeforeUnmount(stop)
defineExpose({ stop, stopVersion: (id: string) => { if (loadedKey.value === id) stop() }, pause: () => player.value?.pause() })
</script>

<template>
  <section class="current-preview" aria-label="试听当前伴奏">
    <div class="preview-heading"><h3>试听当前伴奏 <span class="current-tag">✓ 当前使用</span></h3><div class="track-switch" role="group" aria-label="切换试听音轨"><button type="button" :aria-pressed="track === 'original'" @click="selectTrack('original')">原唱</button><button type="button" :aria-pressed="track === 'backing'" @click="selectTrack('backing')">伴奏</button></div></div>
    <p class="preview-hint">已生成独立伴奏，点歌时可在原唱和伴奏之间切换。</p>
    <div class="player-controls">
      <button type="button" class="play-toggle" :disabled="loading" :aria-label="loading ? '正在准备试听' : playing ? '暂停试听' : '播放试听'" @click="toggle"><span v-if="loading" class="loading-ring" /><ElIcon v-else :size="22"><VideoPause v-if="playing" /><VideoPlay v-else /></ElIcon></button>
      <div class="timeline"><label class="timeline-label"><ElIcon :size="16"><Microphone v-if="track === 'original'" /><Headset v-else /></ElIcon>{{ track === 'original' ? '原唱' : '当前伴奏' }}<span>播放进度</span></label><input type="range" min="0" :max="total || 1" step="0.1" :value="elapsed" :style="{ '--played': `${total ? Math.min(100, elapsed / total * 100) : 0}%` }" :disabled="!loadedKey || loading" aria-label="试听进度" @input="seek"></div>
      <span class="player-time"><strong>{{ time(elapsed) }}</strong> / {{ total ? time(total) : '—:—' }}</span>
      <div class="player-tools"><button type="button" :aria-label="muted ? '取消静音' : '静音'" :aria-pressed="muted" @click="toggleMute"><ElIcon :size="19"><Mute v-if="muted" /><Headset v-else /></ElIcon></button><a :href="accompanimentUrl(songId, version.jobId)" :download="`${songId}-${version.jobId}.m4a`" aria-label="下载当前伴奏"><ElIcon :size="19"><Download /></ElIcon></a></div>
    </div>
    <p v-if="pendingVersion" class="preview-hint" role="status">当前伴奏已切换，下次播放时使用新版本。</p>
    <p v-if="error" class="preview-error" role="alert">{{ error }}</p>
    <audio ref="player" preload="none" :aria-label="track === 'original' ? '试听原唱' : '试听生成的伴奏'" @timeupdate="updateTime" @durationchange="updateTime" @playing="reportPlaying" @pause="playing = false; activity?.transition('PAUSED')" @waiting="activity?.transition('BUFFERING')" @seeking="activity?.transition('BUFFERING')" @seeked="!player?.paused && reportPlaying()" @ended="playing = false; activity?.transition('COMPLETED')" @error="player?.hasAttribute('src') && failed('音频读取失败，请重新试听')" />
  </section>
</template>

<style scoped>
.current-preview{padding:20px 24px;border:1px solid var(--sv-border-subtle);border-radius:12px;background:var(--sv-surface-1)}.preview-heading{display:flex;justify-content:space-between;gap:16px;align-items:center}.preview-heading h3{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:0;font-size:16px;font-weight:600;color:var(--sv-text-primary)}.current-tag{padding:4px 9px;border-radius:5px;font-size:12px;font-weight:500;color:var(--sv-semantic-ok);background:var(--sv-semantic-ok-soft)}.track-switch{display:flex;flex:none;padding:3px;border:1px solid var(--sv-border-subtle);border-radius:9px;background:var(--sv-surface-3)}.track-switch button{min-width:68px;min-height:44px;border:0;border-radius:6px;background:transparent;color:var(--sv-text-secondary);font:inherit;font-size:14px;cursor:pointer}.track-switch button[aria-pressed=true]{color:var(--sv-accent-primary);background:var(--sv-surface-2);box-shadow:var(--sv-shadow-sm)}.preview-hint{margin:8px 0 0;color:var(--sv-text-secondary);font-size:14px;line-height:1.7}.player-controls{display:flex;gap:18px;align-items:center;margin-top:18px}.play-toggle{display:grid;place-items:center;width:50px;height:50px;flex:none;border:0;border-radius:50%;background:var(--sv-accent-primary);color:var(--sv-text-on-accent,#fff);cursor:pointer;box-shadow:0 4px 12px rgb(37 99 235 / 15%)}.play-toggle:disabled{cursor:wait}.timeline{flex:1;min-width:0}.timeline-label{display:flex;gap:7px;align-items:center;font-size:12px;color:var(--sv-text-secondary)}.timeline-label>span{margin-left:auto}.timeline input{display:block;width:100%;height:34px;margin:0;appearance:none;background:transparent;cursor:pointer}.timeline input::-webkit-slider-runnable-track{height:5px;border-radius:5px;background:linear-gradient(to right,var(--sv-accent-primary) var(--played),var(--sv-border-default) var(--played))}.timeline input::-moz-range-track{height:5px;border-radius:5px;background:var(--sv-border-default)}.timeline input::-moz-range-progress{height:5px;background:var(--sv-accent-primary)}.timeline input::-webkit-slider-thumb{appearance:none;width:12px;height:12px;margin-top:-3.5px;border-radius:50%;background:var(--sv-accent-primary)}.timeline input::-moz-range-thumb{width:12px;height:12px;border:0;border-radius:50%;background:var(--sv-accent-primary)}.timeline input:disabled{cursor:default}.player-time{flex:none;font-size:13px;color:var(--sv-text-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}.player-time strong{color:var(--sv-text-primary);font-weight:500}.player-tools{display:flex;gap:2px}.player-tools button,.player-tools a{display:grid;place-items:center;width:44px;height:44px;padding:0;border:0;border-radius:7px;background:transparent;color:var(--sv-text-secondary);cursor:pointer}.player-tools :is(button,a):hover{background:var(--sv-surface-3);color:var(--sv-accent-primary)}.preview-error{margin:10px 0 0;color:var(--sv-semantic-danger);font-size:14px}.loading-ring{width:20px;height:20px;border:2px solid #ffffff66;border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite}.current-preview audio{display:none}button:focus-visible,a:focus-visible,input:focus-visible{outline:2px solid var(--sv-accent-primary);outline-offset:3px}@keyframes spin{to{transform:rotate(360deg)}}
@media(max-width:560px){.current-preview{padding:16px}.preview-heading{display:block}.preview-heading h3{font-size:17px}.track-switch{margin-top:16px}.track-switch button{flex:1;font-size:16px}.preview-hint{font-size:16px}.player-controls{flex-wrap:wrap;gap:12px;margin-top:18px}.timeline{flex-basis:calc(100% - 62px)}.timeline input{height:44px}.player-time{padding-left:62px;font-size:14px;margin-right:auto}.player-tools{margin-left:auto}.preview-error{font-size:16px}}
@media(prefers-reduced-motion:reduce){.loading-ring{animation:none}}
</style>
