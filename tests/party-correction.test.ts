// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import AudioRolesEditor from '../src/party/AudioRolesEditor.vue'
import MissingSongForm from '../src/party/MissingSongForm.vue'
import { usePartySession } from '../src/party/usePartySession'
import { request, type Snapshot } from '../src/party/api'
vi.mock('../src/party/api', async importOriginal => ({ ...await importOriginal<typeof import('../src/party/api')>(), request: vi.fn() }))
let wrapper: VueWrapper | undefined
let session: ReturnType<typeof usePartySession>
let snapshot: Snapshot
beforeEach(() => {
  session = usePartySession(); session.replaceCredential({ token: 'token', sessionId: 's', name: '小明' }); session.state.online = true
  snapshot = { id: 's', status: 'ACTIVE', revision: 1, actorId: 'p', host: false, acceptingRequests: true, queue: [], queuePolicy: 'FAIR', capabilities: ['APPLY_AUDIO_ROLES'], playback: { songId: 'song', itemId: 'item', attemptId: 'attempt', state: 'PAUSED', positionMs: 30000 } }
  session.accept(snapshot)
  vi.mocked(request).mockReset(); vi.mocked(request).mockImplementation(async (path, method, body) => {
    if (path.startsWith('audio-roles/')) return { revision: method === 'PUT' ? 2 : 1, originalId: 'stream:0', backingId: 'stream:1', streams: [{ id: 'stream:0', title: '人声', language: 'zh', channels: 2 }, { id: 'stream:1', title: '伴奏', channels: 2 }] }
    if (path.includes('/commands')) return { ...snapshot, stateRevision: 2, commandResults: [{ id: 'c', requestId: (body as { requestId: string }).requestId, attemptId: 'attempt', action: 'APPLY_AUDIO_ROLES', status: 'FAILED', detail: '媒体重建失败' }] }
    return snapshot
  })
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined; session.close(); vi.restoreAllMocks() })
it('双轨一键对调立即保存，并区分电视应用失败', async () => {
  wrapper = mount(AudioRolesEditor, { props: { songId: 'song', session } }); await flushPromises()
  await wrapper.findAll('button').find(b => b.text() === '一键对调')!.trigger('click'); await flushPromises()
  const save = vi.mocked(request).mock.calls.find(c => c[1] === 'PUT')!
  expect(save[2]).toEqual({ originalId: 'stream:1', backingId: 'stream:0', revision: 1 })
  expect(vi.mocked(request).mock.calls.find(c => c[0].includes('commands'))?.[2]).toMatchObject({ action: 'APPLY_AUDIO_ROLES', songId: 'song', attemptId: 'attempt' })
  expect(wrapper.text()).toContain('标记已保存，电视尚未应用'); expect(wrapper.text()).toContain('媒体重建失败')
})
it('多轨显示清晰名称，未探测时不能编造音轨或保存', async () => {
  vi.mocked(request).mockResolvedValueOnce({ revision: 0, state: 'UNKNOWN', streams: [] })
  wrapper = mount(AudioRolesEditor, { props: { songId: 'song', session } }); await flushPromises()
  expect(wrapper.text()).toContain('先在电视或管理后台完成媒体探测'); expect(wrapper.find('select').exists()).toBe(false)
  wrapper.unmount(); vi.mocked(request).mockResolvedValue({ revision: 1, streams: [{ id: 'stream:0', title: '国语原唱' }, { id: 'stream:1', title: '国语伴奏' }, { id: 'stream:2', title: '粤语原唱' }] })
  wrapper = mount(AudioRolesEditor, { props: { songId: 'song', session } }); await flushPromises()
  expect(wrapper.findAll('select')[0]!.text()).toContain('粤语原唱'); expect(wrapper.text()).not.toContain('一键对调')
})
it('缺歌只要求歌名，超时重试保持原 payload 和请求 ID', async () => {
  let attempts = 0
  vi.mocked(request).mockImplementation(async () => { if (++attempts === 1) throw new Error('超时'); return { id: 'feedback', source: 'PARTY' } })
  wrapper = mount(MissingSongForm, { props: { keyword: '没找到的歌', session } })
  await wrapper.get('form').trigger('submit'); await flushPromises()
  const first = vi.mocked(request).mock.calls[0]![2]
  expect(wrapper.get('input').attributes('disabled')).toBeDefined()
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(vi.mocked(request).mock.calls[1]![2]).toEqual(first)
  expect(first).toMatchObject({ title: '没找到的歌', artist: '', versionLabel: '', description: '' })
  expect(first).not.toHaveProperty('submittedBy'); expect(wrapper.text()).toContain('缺歌反馈已记录')
})
