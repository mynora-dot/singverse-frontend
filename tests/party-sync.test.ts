// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { request, type Snapshot } from '../src/party/api'
import { usePartySession, type PartySession } from '../src/party/usePartySession'

vi.mock('../src/party/api', async importOriginal => ({ ...await importOriginal<typeof import('../src/party/api')>(), request: vi.fn() }))
let session: PartySession, snapshot: Snapshot
const waits: { resolve: (value: Snapshot) => void; reject: (error: Error) => void; signal?: AbortSignal }[] = []
beforeEach(() => {
  vi.useFakeTimers(); waits.length = 0; sessionStorage.clear(); history.replaceState(null, '', '/party/')
  sessionStorage.setItem('singverse-party', JSON.stringify({ token: 'guest-token', sessionId: 'party', name: '家人' }))
  snapshot = { id: 'party', revision: 1, stateRevision: 10, snapshotWaitMs: 8000, actorId: 'guest', host: false, status: 'ACTIVE', acceptingRequests: true, queue: [], queuePolicy: 'FAIR', tvOnline: true, playback: { attemptId: 'attempt', itemId: 'item', songId: 'song', state: 'PLAYING', positionMs: 1000 } }
  vi.mocked(request).mockReset(); vi.mocked(request).mockImplementation(async (path, _method, body, _token, signal) => {
    if (path.includes('/snapshot?')) return new Promise<Snapshot>((resolve, reject) => {
      waits.push({ resolve, reject, signal })
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    })
    if (path.endsWith('/snapshot')) return structuredClone(snapshot)
    if (path.endsWith('/commands')) {
      const command = body as { requestId: string; action: string }
      snapshot.stateRevision = snapshot.stateRevision! + 1
      snapshot.commandResults = [{ ...command, id: 'command', attemptId: 'attempt', status: 'SENT' }]
      return structuredClone(snapshot)
    }
    return { songIds: [], revision: 1 }
  })
  session = usePartySession()
})
afterEach(() => { session.close(); sessionStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks() })

it('支持等待的服务持续订阅最新版本，发送与电视执行分开反馈且无需等待一秒', async () => {
  await session.initialize(); await vi.advanceTimersByTimeAsync(50)
  expect(request).toHaveBeenLastCalledWith('sessions/party/snapshot?afterStateRevision=10&waitMs=8000', 'GET', undefined, 'guest-token', expect.any(AbortSignal))
  await session.command('PAUSE')
  expect(session.execution.value?.status).toBe('SENT')
  expect(session.state.snapshot?.playback?.state).toBe('PLAYING')
  waits[0]!.resolve(structuredClone(snapshot)); await flushPromises(); await vi.advanceTimersByTimeAsync(50)
  expect(request).toHaveBeenLastCalledWith('sessions/party/snapshot?afterStateRevision=11&waitMs=8000', 'GET', undefined, 'guest-token', expect.any(AbortSignal))
  snapshot.stateRevision = 12; snapshot.playback!.state = 'PAUSED'; snapshot.commandResults![0]!.status = 'EXECUTED'
  waits[1]!.resolve(structuredClone(snapshot)); await flushPromises()
  expect(session.execution.value?.status).toBe('EXECUTED')
  expect(session.state.snapshot?.playback?.state).toBe('PAUSED')
  await vi.advanceTimersByTimeAsync(50)
  expect(request).toHaveBeenLastCalledWith('sessions/party/snapshot?afterStateRevision=12&waitMs=8000', 'GET', undefined, 'guest-token', expect.any(AbortSignal))
  expect(waits).toHaveLength(3)
})

it('旧服务继续按一秒同步，不发送等待参数或不断发空请求', async () => {
  delete snapshot.snapshotWaitMs
  await session.initialize(); const initial = vi.mocked(request).mock.calls.length
  await vi.advanceTimersByTimeAsync(999); expect(request).toHaveBeenCalledTimes(initial)
  await vi.advanceTimersByTimeAsync(1)
  expect(request).toHaveBeenLastCalledWith('sessions/party/snapshot', 'GET', undefined, 'guest-token', expect.any(AbortSignal))
  expect(waits).toHaveLength(0)
})

it('收藏同步停滞时仍接收电视回执并续订快照', async () => {
  await session.initialize(); const original = vi.mocked(request).getMockImplementation()!
  let resolveFavorites!: (value: unknown) => void
  vi.mocked(request).mockImplementation((...args) => args[0] === 'favorites/ids' ? new Promise(resolve => { resolveFavorites = resolve }) : original(...args))
  await vi.advanceTimersByTimeAsync(5000)
  expect(resolveFavorites).toBeTypeOf('function'); expect(waits).toHaveLength(1)
  snapshot.stateRevision = 11; snapshot.playback!.state = 'PAUSED'
  waits[0]!.resolve(structuredClone(snapshot)); await flushPromises(); await vi.advanceTimersByTimeAsync(50)
  expect(session.state.snapshot?.playback?.state).toBe('PAUSED')
  expect(waits).toHaveLength(2)
  resolveFavorites({ songIds: ['saved-song'], revision: 2 }); await flushPromises()
  expect(session.state.favoriteIds).toEqual(['saved-song'])
})

it('断线先获取即时快照再恢复等待，离开聚会会取消挂起请求', async () => {
  await session.initialize(); await vi.advanceTimersByTimeAsync(50)
  waits[0]!.reject(new Error('连接中断')); await flushPromises()
  expect(session.state.online).toBe(false)
  await vi.advanceTimersByTimeAsync(1000)
  expect(request).toHaveBeenLastCalledWith('sessions/party/snapshot', 'GET', undefined, 'guest-token', expect.any(AbortSignal))
  expect(session.state.online).toBe(true)
  await vi.advanceTimersByTimeAsync(50)
  const pending = waits.at(-1)!
  session.leave(); expect(pending.signal?.aborted).toBe(true)
  pending.resolve({ ...snapshot, stateRevision: 999 }); await flushPromises()
  expect(session.state.credential).toBeNull(); expect(session.state.snapshot).toBeNull()
})

it('遥控请求成功后，先前等待的网络失败不会把已确认的连接标为离线', async () => {
  await session.initialize(); await vi.advanceTimersByTimeAsync(50)
  await session.command('PAUSE')
  waits[0]!.reject(new Error('旧连接中断')); await flushPromises()
  expect(session.state.online).toBe(true)
  expect(session.state.error).toBe('')
  await vi.advanceTimersByTimeAsync(50)
  expect(request).toHaveBeenLastCalledWith('sessions/party/snapshot?afterStateRevision=11&waitMs=8000', 'GET', undefined, 'guest-token', expect.any(AbortSignal))
})
