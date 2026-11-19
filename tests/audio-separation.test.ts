// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import AudioRolesPanel from '../src/admin/modules/song-management/components/AudioRolesPanel.vue'
import { authRequest } from '../src/admin/core/auth/api'
import type { SeparationCapabilities } from '../src/admin/modules/audio-processing/api'
vi.mock('../src/admin/core/auth/api', () => ({ authRequest: vi.fn() }))
const capabilities: SeparationCapabilities = { version: 1, profiles: [{ id: 'DSP_FAST', ready: true, modelId: 'center-cancel-v1' }, { id: 'LEGACY_DEMUCS', ready: true, modelId: 'htdemucs' }], backends: [{ id: 'cpu', state: 'AVAILABLE', reason: '' }] }
let wrapper: ReturnType<typeof mount> | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.clearAllMocks() })
const roles = { state: 'UNKNOWN', jobs: [], streams: [{ id: 'stream:0', channels: 2 }], versions: [
  { jobId: 'preview', preview: true, separationProfile: 'DSP_FAST', outputFormat: 'aac' },
  { jobId: 'flac', preview: false, separationProfile: 'AI_CLEAN', outputFormat: 'flac' },
  { jobId: 'full', preview: false, separationProfile: 'DSP_FAST', outputFormat: 'aac' },
] }
async function open() {
  vi.mocked(authRequest).mockImplementation(async () => roles as never)
  wrapper = mount(AudioRolesPanel, { props: { songId: 'song', canProcess: false, separation: capabilities } })
  await flushPromises()
}
function button(label: string) { return wrapper!.findAll('button').find(item => item.text() === label)! }
it('无 Demucs 环境时仍可提交 DSP 试听，并保留试听与 FLAC 的独立版本', async () => {
  await open()
  expect(button('生成 12 秒试听').attributes('disabled')).toBeUndefined()
  await button('生成 12 秒试听').trigger('click'); await flushPromises()
  expect(authRequest).toHaveBeenCalledWith('/api/v1/media-songs/song/audio-jobs', 'POST', expect.objectContaining({ separationProfile: 'DSP_FAST', preview: true, outputFormat: 'aac' }))
  expect(wrapper!.findAll('button').filter(item => item.text() === '设为当前伴奏')).toHaveLength(1)
  expect(wrapper!.findAll('.version audio')).toHaveLength(3)
})
it('生成仅保留极速与高级两档，历史轻量版本仍可试听，FLAC 从所选方案重新生成', async () => {
  await open()
  expect(wrapper!.get('select[aria-label="伴奏方案"]').findAll('option').map(option => option.attributes('value'))).toEqual(['DSP_FAST', 'LEGACY_DEMUCS'])
  expect(wrapper!.text()).toContain('轻量 AI（历史版本）')
  await wrapper!.get('select[aria-label="伴奏方案"]').setValue('LEGACY_DEMUCS')
  expect(wrapper!.get('select[aria-label="生成伴奏使用的设备"]').find('option[value="cpu"]').exists()).toBe(false)
  await button('生成 FLAC 导出').trigger('click'); await flushPromises()
  expect(authRequest).toHaveBeenCalledWith('/api/v1/media-songs/song/audio-jobs', 'POST', expect.objectContaining({ separationProfile: 'LEGACY_DEMUCS', backend: '', outputFormat: 'flac', preview: false }))
})
it('手工确认左声道后只提取该声道，不改动全曲库原唱标记', async () => {
  await open()
  await wrapper!.get('select[aria-label="已确认的源伴奏"]').setValue('stream:0:LEFT')
  expect(button('生成整曲伴奏').attributes('disabled')).toBeDefined()
  await wrapper!.get('.confirm-source input').setValue(true)
  await button('生成整曲伴奏').trigger('click'); await flushPromises()
  expect(authRequest).toHaveBeenCalledWith('/api/v1/media-songs/song/audio-jobs', 'POST', expect.objectContaining({ sourceAudioId: 'stream:0:LEFT', sourceConfirmed: true }))
  expect(vi.mocked(authRequest).mock.calls.some(([path, method]) => path.endsWith('/audio-roles') && method === 'PUT')).toBe(false)
})

it('多音轨逐条试听，选择确认的源伴奏前禁止直接分离', async () => {
  vi.mocked(authRequest).mockResolvedValue({ state: 'UNKNOWN', jobs: [], streams: [0, 1, 2].map(i => ({ id: 'stream:' + i, channels: 2 })) } as never)
  wrapper = mount(AudioRolesPanel, { props: { songId: 'multi', canProcess: false, separation: capabilities, workbench: true } })
  await flushPromises()
  expect(wrapper.get('[aria-label="逐轨试听"]').findAll('button')).toHaveLength(3)
  expect(button('生成整曲伴奏').attributes('disabled')).toBeDefined()
  await wrapper.get('select[aria-label="已确认的源伴奏"]').setValue('stream:2')
  expect(button('生成整曲伴奏').attributes('disabled')).toBeDefined()
  await wrapper.get('.confirm-source input').setValue(true)
  expect(button('生成整曲伴奏').attributes('disabled')).toBeUndefined()
  await button('生成整曲伴奏').trigger('click'); await flushPromises()
  expect(authRequest).toHaveBeenCalledWith('/api/v1/media-songs/multi/audio-jobs', 'POST', expect.objectContaining({ sourceAudioId: 'stream:2', sourceConfirmed: true, separationProfile: 'DSP_FAST' }))
})
