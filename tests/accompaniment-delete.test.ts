// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import AudioRolesPanel from '../src/admin/modules/song-management/components/AudioRolesPanel.vue'
import { authRequest } from '../src/admin/core/auth/api'
import type { AudioRoles } from '../src/admin/modules/audio-processing/api'
import { mockMediaElements } from './media-element-mocks'
vi.mock('../src/admin/core/auth/api', () => ({ authRequest: vi.fn() }))
let wrapper: ReturnType<typeof mount> | undefined, roles: AudioRoles
let deleteError = ''
const current = { jobId: 'current', separationProfile: 'DSP_FAST' as const, outputFormat: 'aac' as const, active: true }
const old = { jobId: 'old version', separationProfile: 'AI_CLEAN' as const, outputFormat: 'aac' as const, createdAt: 1795114800000 }
const stubs = { ElDialog: { props: ['modelValue'], template: '<div v-if="modelValue" role="dialog"><slot /><slot name="footer" /></div>' } }
beforeEach(() => {
  vi.useFakeTimers(); mockMediaElements(); deleteError = ''
  roles = { state: 'CONFIRMED', streams: [{ id: 'stream:0' }], jobs: [], backingResource: { ...current }, versions: [{ ...current }, { ...old }] }
  vi.mocked(authRequest).mockReset().mockImplementation(async (path, method) => {
    if (method === 'DELETE') { if (deleteError) throw new Error(deleteError); roles = { ...roles, versions: roles.versions!.filter(version => !path.endsWith(encodeURIComponent(version.jobId))) }; return undefined as never }
    if (path.endsWith('/activate')) { roles = { ...roles, backingResource: { ...old, active: true }, versions: [{ ...current, active: false }, { ...old, active: true }] }; return roles as never }
    if (path.endsWith('/node')) return {} as never
    return roles as never
  })
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.restoreAllMocks(); vi.useRealTimers() })
async function open() { wrapper = mount(AudioRolesPanel, { props: { songId: 'song' }, global: { stubs } }); await flushPromises() }
const button = (label: string) => wrapper!.findAll('button').find(item => item.text() === label)!
const remove = () => wrapper!.get('button[aria-label="删除 轻量 AI（历史版本） · 整曲 · AAC"]')
const deletes = () => vi.mocked(authRequest).mock.calls.filter(([, method]) => method === 'DELETE')
it('当前伴奏不可删除，历史轻量版本保留试听、切换、下载和删除', async () => {
  await open()
  expect(wrapper!.get('button[aria-label="当前伴奏不能删除"]').attributes('disabled')).toBeDefined()
  expect(remove().attributes('disabled')).toBeUndefined()
  expect(wrapper!.get('.version-options').text()).toContain('设为当前伴奏')
  expect(wrapper!.findAll('.version audio')).toHaveLength(2)
  expect(wrapper!.findAll('.version a[download]')).toHaveLength(2)
})
it('删除前显示具体版本，取消不发请求，确认后移除且不删除源歌曲', async () => {
  await open(); await remove().trigger('click'); await flushPromises()
  expect(wrapper!.get('[role="dialog"]').text()).toContain('轻量 AI（历史版本） · 整曲 · AAC')
  await button('保留版本').trigger('click'); expect(deletes()).toHaveLength(0)
  await remove().trigger('click'); await button('确认删除').trigger('click'); await flushPromises()
  expect(deletes()).toEqual([['/api/v1/media-songs/song/accompaniment/old%20version', 'DELETE']])
  expect(wrapper!.find('[role="dialog"]').exists()).toBe(false)
  expect(wrapper!.findAll('.version')).toHaveLength(1)
  expect(wrapper!.get('.version').text()).toContain('当前使用')
  expect(wrapper!.text()).toContain('已删除伴奏版本')
})
it('删除失败保留版本和确认窗口，显示可重试错误', async () => {
  deleteError = '磁盘暂不可写'; await open(); await remove().trigger('click'); await button('确认删除').trigger('click'); await flushPromises()
  expect(wrapper!.get('[role="dialog"]').text()).toContain('磁盘暂不可写')
  expect(wrapper!.findAll('.version')).toHaveLength(2)
  deleteError = ''; await button('确认删除').trigger('click'); await flushPromises()
  expect(wrapper!.findAll('.version')).toHaveLength(1)
})
it('确认期间轮询发现版本成为当前时禁止删除', async () => {
  await open(); await remove().trigger('click')
  roles = { ...roles, backingResource: { ...old, active: true }, versions: [{ ...current, active: false }, { ...old, active: true }] }
  await vi.advanceTimersByTimeAsync(4000); await flushPromises()
  expect(button('确认删除').attributes('disabled')).toBeDefined()
  expect(wrapper!.get('[role="dialog"]').text()).toContain('此版本已成为当前伴奏')
  await button('确认删除').trigger('click'); expect(deletes()).toHaveLength(0)
})
it('切换当前版本后，原当前版本可以删除', async () => {
  await open(); await button('设为当前伴奏').trigger('click'); await flushPromises()
  expect(authRequest).toHaveBeenCalledWith('/api/v1/media-songs/song/accompaniment/old%20version/activate', 'POST')
  await wrapper!.get('button[aria-label="删除 极速档 · 整曲 · AAC"]').trigger('click')
  await button('确认删除').trigger('click'); await flushPromises()
  expect(deletes()[0]?.[0]).toBe('/api/v1/media-songs/song/accompaniment/current')
  expect(wrapper!.get('.version').text()).toContain('轻量 AI（历史版本）')
})
