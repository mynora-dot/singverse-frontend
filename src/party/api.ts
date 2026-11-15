export type Song = { id: string; title: string; artists: string[]; version?: string; classification?: unknown; coverPath?: string; available?: boolean; durationMs?: number; lastPlayedAt?: string; playCount?: number }
export type Artist = { id: string; name: string; count: number; portraitPath?: string }
export type Tag = { id: string; name: string; dimension: string; count: number }
export type Item = { id: string; songId: string; ownerId: string; ownerName: string; status: string; sequence?: number; priority?: boolean; song: Song }
export type Playback = { attemptId: string; itemId: string; songId: string; state: string; positionMs: number; durationMs?: number; sampledAt?: string; audioRole?: 'original' | 'backing'; confirmed?: boolean }
export type CommandResult = { id: string; requestId: string; attemptId: string; action: string; status: 'SENT' | 'EXECUTED' | 'FAILED'; detail?: string }
export type Snapshot = { id: string; revision: number; stateRevision?: number; actorId: string; host: boolean; status: string; acceptingRequests: boolean; queue: Item[]; playback?: Playback; queuePolicy?: 'FAIR' | 'LEGACY'; manualStopped?: boolean; tvOnline?: boolean; sampledAt?: string; capabilities?: string[]; commandResults?: CommandResult[]; rotation?: string[]; priorityItemId?: string }
export type Credential = { token: string; sessionId: string; name: string }
export type Page<T> = { items: T[]; totalElements: number; revision?: number }
export type FavoriteState = { songIds: string[]; revision: number }
export type QueueCommand = { action: string; requestId: string; expectedRevision: number; attemptId?: string; songId?: string; itemId?: string; positionMs?: number; role?: string }
export interface Roles { revision: number; state?: string; originalId?: string; backingId?: string; streams?: { id: string; title?: string; language?: string; channels?: number; codec?: string }[] }
export class PartyHttpError extends Error { constructor(readonly status: number, message: string) { super(message) } }
export async function request<T>(path: string, method = 'GET', body?: unknown, token?: string, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, 10000)
  try {
    const result = await fetch(`/api/v1/party/${path}`, { method, headers, credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal, body: body === undefined ? undefined : JSON.stringify(body) })
    if (!result.ok) { const problem = await result.json().catch(() => ({})) as { detail?: string }; throw new PartyHttpError(result.status, problem.detail ?? `请求失败（${result.status}）`) }
    return await result.json() as T
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
}
export { requestId } from '../shared/request-id'
