// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { assistantApi } from '../src/admin/modules/assistant/api'
import { assistantState as state, resetAssistant, useAssistant, selectConversation, sendMessage, decideOperation, stopRun, loadAssistant } from '../src/admin/modules/assistant/state'
import type { Detail, Operation } from '../src/admin/modules/assistant/types'
vi.mock('../src/admin/modules/assistant/api')
class Stream {
  static all: Stream[] = []; onopen?: () => void; onmessage?: (e: { data: string }) => void; onerror?: () => void; closed = false
  constructor(readonly url: string) { Stream.all.push(this) }
  close() { this.closed = true }
  event(sequence: number, text: string) { this.onmessage?.({ data: JSON.stringify({ runId: 'r', sequence, kind: 'text_delta', data: { text } }) }) }
}
const snapshot = (id = 'c', status = 'RUNNING'): Detail => ({ conversation: { id, title: '测试', activeRunId: ['RUNNING','WAITING'].includes(status) ? 'r' : null, createdAt: '', updatedAt: '' }, messages: [], operations: [], runs: [{ id: 'r', conversationId: id, status, requestId: 'request', modelServiceId: 'model', lastSequence: 3, error: '', createdAt: '', updatedAt: '' }] })
let releases: (() => void)[] = []
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); resetAssistant(); state.busy = false; state.loading = false; state.error = ''; localStorage.clear(); Stream.all = []; vi.stubGlobal('EventSource', Stream)
  vi.mocked(assistantApi.status).mockResolvedValue({ready:true,message:'',model:'模型',toolCount:67,settingsPage:'/system/ai/features/assistant'})
  vi.mocked(assistantApi.tools).mockResolvedValue([]); vi.mocked(assistantApi.conversations).mockResolvedValue([snapshot().conversation]); vi.mocked(assistantApi.detail).mockImplementation(async id => snapshot(id))
  vi.mocked(assistantApi.eventsUrl).mockImplementation((id, after) => `/events/${id}?after=${after}`)
})
afterEach(() => { releases.forEach(f => f()); releases = []; resetAssistant(); vi.useRealTimers(); vi.unstubAllGlobals() })
async function connect() { releases.push(useAssistant()); await flushPromises(); return Stream.all.at(-1)! }
it('悬浮面板和工作台只创建一个连接，事件续读去重', async () => {
  const stream = await connect(); releases.push(useAssistant()); await flushPromises(); expect(assistantApi.status).toHaveBeenCalledTimes(1)
  stream.event(1,'你'); stream.event(1,'重复'); stream.event(3,'好'); expect(state.events.map(e => e.data.text)).toEqual(['你','好'])
  stream.onerror?.(); await flushPromises(); await vi.advanceTimersByTimeAsync(2000)
  expect(Stream.all.at(-1)!.url).toBe('/events/r?after=3'); expect(stream.closed).toBe(true)
})
it('切换会话后迟到的详情与连接错误不能覆盖当前会话', async () => {
  const old = await connect(); let resolve!: (value: Detail) => void
  vi.mocked(assistantApi.detail).mockImplementationOnce(() => new Promise(r => {resolve = r}))
  const pending = selectConversation('old'); await selectConversation('new'); const latest = Stream.all.at(-1)!
  resolve(snapshot('old')); await pending; old.onerror?.(); expect(state.detail?.conversation.id).toBe('new'); expect(latest.closed).toBe(false)
})
it('请求失败后再次发送保留幂等标识和草稿', async () => {
  state.detail = snapshot('c','COMPLETED'); state.draft = '创建歌单'
  vi.mocked(assistantApi.detail).mockResolvedValue(snapshot('c','COMPLETED'))
  vi.mocked(assistantApi.submit).mockRejectedValueOnce(new Error('连接中断')).mockResolvedValueOnce(snapshot().runs[0]!)
  await sendMessage(); expect(state.draft).toBe('创建歌单'); await sendMessage()
  expect(vi.mocked(assistantApi.submit).mock.calls[0]![1]).toBe(vi.mocked(assistantApi.submit).mock.calls[1]![1]); expect(state.draft).toBe('')
})
it('活动运行期间禁止重复发送', async () => { state.detail = snapshot(); state.draft = '重复'; await sendMessage(); expect(assistantApi.submit).not.toHaveBeenCalled() })
it('确认使用服务端冻结修订，网络重试复用决定标识', async () => {
  state.detail = snapshot('c','WAITING'); const op = { id:'o',runId:'r',revision:'frozen-revision' } as Operation
  vi.mocked(assistantApi.decide).mockRejectedValueOnce(new Error('断线')).mockResolvedValueOnce(snapshot().runs[0]!)
  await decideOperation(op,true); await decideOperation(op,true)
  const calls = vi.mocked(assistantApi.decide).mock.calls; expect(calls[0]![2]).toBe(calls[1]![2]); expect(calls[0]!.slice(3)).toEqual(['frozen-revision',true])
})
it('停止对话仅调用运行停止接口', async () => { state.detail = snapshot(); await stopRun(); expect(assistantApi.stop).toHaveBeenCalledWith('r'); expect(assistantApi.decide).not.toHaveBeenCalled() })
it('退出登录后进行中的初始加载不会恢复旧账号记录', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof assistantApi.status>>) => void
  vi.mocked(assistantApi.status).mockImplementationOnce(() => new Promise(r => { resolve = r }))
  const pending = loadAssistant(); resetAssistant(); resolve({ready:true,message:'',model:'旧账号',toolCount:1,settingsPage:''}); await pending
  expect(state.status).toBeNull(); expect(state.detail).toBeNull(); expect(state.tools).toEqual([])
})
