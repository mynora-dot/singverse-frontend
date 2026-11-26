import { computed, reactive, ref } from 'vue'
import { request, requestId, PartyHttpError, type CommandResult, type Credential, type FavoriteState, type QueueCommand, type Snapshot } from './api'
import { readPartyNickname, rememberPartyNickname } from './nickname'

class DiscardedPartyResponse extends Error {}
const credentialKey = 'singverse-party'
const playbackLabels: Record<string, string> = { IDLE: '已停止', PREPARING: '正在准备', BUFFERING: '正在缓冲', PLAYING: '正在唱', PAUSED: '已暂停', ENDED: '等待下一首', ERROR: '播放失败' }
export const playbackActions = ['PAUSE', 'RESUME', 'NEXT', 'RESTART', 'STOP', 'START', 'SEEK', 'AUDIO_ROLE', 'APPLY_AUDIO_ROLES']
export function usePartySession() {
  const state = reactive({ credential: null as Credential | null, snapshot: null as Snapshot | null, preview: null as { sessionId: string; deviceName: string } | null,
    nickname: readPartyNickname(), online: false, loading: false, busy: false, error: '', notice: '', pending: null as QueueCommand | null,
    favoriteIds: [] as string[], favoriteRevision: -1, favoriteBusy: [] as string[], favoritesReady: false, lastCommand: null as QueueCommand | null, receivedAt: 0 })
  const invitation = ref(new URLSearchParams(location.hash.slice(1)).get('invite') ?? '')
  const hasInvitation = computed(() => !!invitation.value)
  let requestOrder = 0, lastAuthenticated = 0
  let generation = 0, stopped = false, timer: ReturnType<typeof setTimeout> | undefined, favoriteTimer: ReturnType<typeof setTimeout> | undefined, controller = new AbortController()
  const waiting = computed(() => state.snapshot?.queue.filter(i => i.status === 'WAITING') ?? [])
  const current = computed(() => state.snapshot?.queue.find(i => i.id === state.snapshot?.playback?.itemId))
  const playbackStatus = computed(() => state.snapshot?.tvOnline ? playbackLabels[state.snapshot.playback?.state ?? ''] ?? '等待开唱' : '电视离线')
  const execution = computed<CommandResult | undefined>(() => {
    const command = state.lastCommand
    if (command) return state.snapshot?.commandResults?.find(r => r.requestId === command.requestId)
  })
  function accept(value: Snapshot) {
    if (!state.credential || value.id !== state.credential.sessionId) return false
    if (state.snapshot?.id === value.id && (value.stateRevision ?? value.revision) < (state.snapshot.stateRevision ?? state.snapshot.revision)) return false
    state.snapshot = value; state.receivedAt = Date.now(); return true
  }
  function replaceCredential(value: Credential | null) {
    generation++; controller.abort(); controller = new AbortController()
    state.credential = value; state.snapshot = null; state.pending = null; state.favoriteIds = []; state.favoriteRevision = -1; state.favoritesReady = false; state.online = false; state.lastCommand = null; state.busy = false
    if (value) {
      sessionStorage.setItem(credentialKey, JSON.stringify(value))
      state.nickname = value.name
      if (!value.deviceName) rememberPartyNickname(value.name)
    }
    else sessionStorage.removeItem(credentialKey)
  }
  function failure(error: unknown) {
    if (stopped || error instanceof DiscardedPartyResponse) return
    if (error instanceof PartyHttpError && error.status === 401) {
      const selectedTelevision = !!state.credential?.deviceName
      replaceCredential(null); state.preview = null
      state.error = selectedTelevision ? '电视会话已失效，请重新选择电视。' : '参与权限已失效，请重新扫描电视二维码。'
    } else state.error = error instanceof Error ? error.name === 'AbortError' ? '请求超时，请检查连接后重试' : error.message : '连接失败，请重试'
  }
  async function call<T>(path: string, method = 'GET', body?: unknown) {
    const turn = generation, token = state.credential?.token, order = ++requestOrder
    try {
      const result = await request<T>(path, method, body, token, controller.signal)
      if (stopped || turn !== generation) throw new DiscardedPartyResponse('连接已更换')
      lastAuthenticated = Math.max(lastAuthenticated, order)
      return result
    } catch (e) {
      const staleSnapshotFailure = method === 'GET' && path.includes('/snapshot') && !(e instanceof PartyHttpError) && order < lastAuthenticated
      if (stopped || turn !== generation || staleSnapshotFailure || e instanceof PartyHttpError && e.status === 401 && order < lastAuthenticated) throw new DiscardedPartyResponse('已忽略旧响应')
      if (turn === generation && !stopped && e instanceof PartyHttpError && e.status === 401) failure(e)
      throw e
    }
  }
  function snapshotWaitMs() {
    const s = state.snapshot
    return state.online && s?.status === 'ACTIVE' && Number.isSafeInteger(s.stateRevision) && s.stateRevision! >= 0 && Number.isInteger(s.snapshotWaitMs) && s.snapshotWaitMs! > 0 ? Math.min(8000, s.snapshotWaitMs!) : 0
  }
  async function refresh(waitForChanges = false) {
    const c = state.credential; if (!c) return
    try {
      const waitMs = waitForChanges ? snapshotWaitMs() : 0
      const query = waitMs ? `?afterStateRevision=${state.snapshot!.stateRevision}&waitMs=${waitMs}` : ''
      const value = await call<Snapshot>(`sessions/${encodeURIComponent(c.sessionId)}/snapshot${query}`)
      accept(value); state.online = true
      if (state.error.startsWith('与 NAS 同步失败')) state.error = ''
    } catch (e) { if (!(e instanceof DiscardedPartyResponse)) state.online = false; throw e }
  }
  function acceptFavorites(value: FavoriteState) {
    if (value.revision >= state.favoriteRevision) { state.favoriteIds = value.songIds; state.favoriteRevision = value.revision; state.favoritesReady = true }
  }
  async function refreshFavorites() { acceptFavorites(await call<FavoriteState>('favorites/ids')) }
  async function setFavorite(songId: string, selected: boolean) {
    if (!state.favoritesReady || state.favoriteBusy.includes(songId)) return
    state.favoriteBusy.push(songId)
    try { acceptFavorites(await call<FavoriteState>('favorites', 'PUT', { songIds: [songId], selected })); state.lastCommand = null; state.notice = selected ? '已加入家庭收藏' : '已从家庭收藏移除' }
    catch (e) { failure(e) }
    finally { state.favoriteBusy = state.favoriteBusy.filter(id => id !== songId) }
  }
  async function sendPending() {
    const c = state.credential, command = state.pending, turn = generation
    if (!c || !command || state.busy) return
    state.busy = true; state.error = ''; state.notice = ''; state.lastCommand = null
    try {
      const value = await call<Snapshot>(`sessions/${encodeURIComponent(c.sessionId)}/commands`, 'POST', command)
      accept(value); state.pending = null; state.online = true; state.lastCommand = command
      return { requestId: command.requestId, snapshot: value }
    } catch (e) {
      if (turn !== generation || e instanceof DiscardedPartyResponse) throw new DiscardedPartyResponse('连接已更换')
      if (e instanceof PartyHttpError && e.status >= 400 && e.status < 500) state.pending = null
      failure(e)
      await refresh().catch(() => {})
      throw e
    } finally { if (turn === generation) state.busy = false }
  }
  async function command(action: string, fields: Partial<QueueCommand> = {}) {
    if (!state.snapshot || !state.credential) throw new Error('请先加入聚会')
    if (state.busy || state.pending) throw new Error('上一项操作结果尚未确认，请先重试原请求')
    if (!state.online) throw new Error('与 NAS 连接已断开，请先重连')
    if (playbackActions.includes(action) && state.snapshot.queuePolicy !== 'FAIR') throw new Error('请更新 TV 版本后使用全员遥控')
    const needed: Record<string, string> = { SEEK: 'SEEK', AUDIO_ROLE: 'AUDIO_ROLE', APPLY_AUDIO_ROLES: 'APPLY_AUDIO_ROLES' }
    if (needed[action] && !state.snapshot.capabilities?.includes(needed[action]!)) throw new Error('请更新 TV 版本以使用此功能')
    state.pending = { ...fields, action, requestId: requestId(), expectedRevision: state.snapshot.revision, attemptId: fields.attemptId ?? state.snapshot.playback?.attemptId }
    return sendPending()
  }
  async function react(kind: 'LIKE' | 'CLAP' | 'CHEER') {
    const s = state.snapshot; if (!s || !state.online || !s.tvOnline) throw new Error('电视离线，连接后再互动')
    if (!s.capabilities?.includes('REACTIONS')) throw new Error('请更新 TV 版本后发送互动')
    await call(`sessions/${encodeURIComponent(s.id)}/reactions`, 'POST', { requestId: requestId(), kind })
  }
  async function initialize() {
    state.loading = true
    try {
      const saved = sessionStorage.getItem(credentialKey)
      if (saved) { try { const c: Credential = JSON.parse(saved); if (c.token && c.sessionId && typeof c.name === 'string') replaceCredential(c); else sessionStorage.removeItem(credentialKey) } catch { sessionStorage.removeItem(credentialKey) } }
      if (invitation.value) {
        state.preview = await request('invitations/preview', 'POST', { invitation: invitation.value }, undefined, controller.signal)
        if (state.credential?.sessionId !== state.preview?.sessionId) replaceCredential(null)
      }
      if (state.credential) { await refresh(); await refreshFavorites() }
    } catch (e) { failure(e) }
    finally { state.loading = false; schedulePoll(); scheduleFavoritePoll() }
  }
  async function openSession(value: Credential) {
    replaceCredential(value); state.preview = null
    await refresh(); await refreshFavorites()
  }
  async function join(name: string) {
    state.loading = true; state.error = ''
    const turn = generation
    try {
      const value = await request<Credential>('join', 'POST', { invitation: invitation.value, name: name.trim() }, undefined, controller.signal)
      if (stopped || turn !== generation) return
      invitation.value = ''; history.replaceState(null, '', location.pathname)
      await openSession(value)
    } catch (e) { failure(e) }
    finally { state.loading = false }
  }
  async function connectTelevision(value: Credential) {
    if (state.loading || stopped) return
    state.loading = true; state.error = ''
    try { await openSession(value) }
    catch (e) { failure(e) }
    finally { state.loading = false }
  }
  function schedulePoll() {
    clearTimeout(timer)
    if (stopped) return
    timer = setTimeout(async () => {
      try { if (state.credential) await refresh(true) }
      catch (e) { if (!stopped && state.credential && !(e instanceof DiscardedPartyResponse)) { failure(e); if (!(e instanceof PartyHttpError)) state.error = '与 NAS 同步失败，正在重连…' } }
      finally { schedulePoll() }
    }, snapshotWaitMs() ? 50 : 1000)
  }
  // Slow catalog/favorite requests must never hold up remote execution feedback.
  function scheduleFavoritePoll() {
    clearTimeout(favoriteTimer)
    if (stopped) return
    favoriteTimer = setTimeout(async () => {
      try { if (state.credential) await refreshFavorites() }
      catch (e) { failure(e) }
      finally { scheduleFavoritePoll() }
    }, 5000)
  }
  function leave() { replaceCredential(null); state.preview = null; state.notice = ''; state.error = '' }
  function close() { stopped = true; generation++; controller.abort(); clearTimeout(timer); clearTimeout(favoriteTimer) }
  return { state, waiting, current, playbackStatus, execution, hasInvitation, accept, replaceCredential, acceptFavorites, call, refresh, refreshFavorites, setFavorite, sendPending, command, react, initialize, join, connectTelevision, leave, close, failure }
}
export type PartySession = ReturnType<typeof usePartySession>
