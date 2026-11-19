// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Preview from '../src/admin/modules/song-management/components/AccompanimentPreview.vue'
import { playback, type Resource } from '../src/admin/modules/transcoding/playback'
import { mockMediaElements } from './media-element-mocks'
vi.mock('../src/admin/modules/transcoding/playback', () => ({ playback: { start: vi.fn(), status: vi.fn(), cancel: vi.fn(async () => {}) } }))
vi.mock('../src/admin/modules/transcoding/activity', () => ({ AdminPlaybackActivity: class { closed = false; transition = vi.fn() } }))
vi.mock('hls.js', () => ({ default: class { static isSupported() { return false } } }))
let wrapper: ReturnType<typeof mount> | undefined
const version = { jobId: 'current', duration: 290 }
beforeEach(() => { vi.useFakeTimers(); mockMediaElements(); vi.mocked(playback.start).mockReset(); vi.mocked(playback.cancel).mockClear() })
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.restoreAllMocks(); vi.useRealTimers() })
async function open() { wrapper = mount(Preview, { props: { songId: 'song', version, duration: 290 } }); await flushPromises() }
async function metadata(duration = 290) { const audio = wrapper!.get('audio'); Object.defineProperty(audio.element, 'duration', { configurable: true, value: duration }); await audio.trigger('loadedmetadata'); await flushPromises() }
it('不自动播放或虚构进度，音频事件驱动真实时间，支持暂停与定位', async () => {
  await open(); await vi.advanceTimersByTimeAsync(5000)
  expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
  expect(wrapper!.get('.player-time').text()).toBe('0:00 / 4:50')
  await wrapper!.get('button[aria-label="播放试听"]').trigger('click'); await metadata()
  expect(wrapper!.get('audio').attributes('src')).toBe('/api/v1/media-songs/song/accompaniment/current')
  const audio = wrapper!.get('audio').element as HTMLAudioElement
  audio.currentTime = 37; await wrapper!.get('audio').trigger('timeupdate')
  expect(wrapper!.get('.player-time').text()).toBe('0:37 / 4:50')
  await wrapper!.get('button[aria-label="暂停试听"]').trigger('click'); expect(audio.paused).toBe(true)
  await wrapper!.get('input[aria-label="试听进度"]').setValue('45')
  expect(audio.currentTime).toBe(45)
})
it('原唱用角色协商，切换音轨沿用真实位置并在关闭时释放会话', async () => {
  vi.mocked(playback.start).mockResolvedValue({ id: 'lease', mode: 'HLS', status: 'READY', url: '/original.m3u8', offset: 30 })
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('probably')
  await open(); await wrapper!.get('button[aria-label="播放试听"]').trigger('click'); await metadata()
  const audio = wrapper!.get('audio').element as HTMLAudioElement
  audio.currentTime = 45; await wrapper!.get('audio').trigger('timeupdate')
  await wrapper!.findAll('.track-switch button')[0]!.trigger('click'); await flushPromises(); await metadata(260)
  expect(playback.start).toHaveBeenCalledWith('song', { audioRole: 'original', quality: 'auto', start: 45 })
  expect(audio.currentTime).toBe(15)
  expect(wrapper!.get('.player-time').text()).toBe('0:45 / 4:50')
  wrapper!.unmount(); wrapper = undefined
  expect(playback.cancel).toHaveBeenCalledWith('lease')
})
it('关闭后迟到的原唱会话会被取消，不重新启动播放', async () => {
  let finish!: (value: Resource) => void
  vi.mocked(playback.start).mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await open(); await wrapper!.findAll('.track-switch button')[0]!.trigger('click')
  await wrapper!.get('button[aria-label="播放试听"]').trigger('click')
  wrapper!.unmount(); wrapper = undefined
  finish({ id: 'late', mode: 'DIRECT', status: 'READY', url: '/original', offset: 0 }); await flushPromises()
  expect(playback.cancel).toHaveBeenCalledWith('late')
  expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
})
it('当前版本切换不打断试听，删除正在试听的旧版本会停止它', async () => {
  await open(); await wrapper!.get('button[aria-label="播放试听"]').trigger('click'); await metadata()
  await wrapper!.setProps({ version: { jobId: 'new', duration: 290 } })
  expect(wrapper!.get('audio').attributes('src')).toContain('/current')
  expect(wrapper!.text()).toContain('下次播放时使用新版本')
  const vm = wrapper!.vm as unknown as { stopVersion: (id: string) => void }
  vm.stopVersion('current'); await flushPromises()
  expect(wrapper!.get('audio').attributes('src')).toBeUndefined()
})
it('原唱 HLS 仅加载部分片段时，时间轴保留协商的完整歌曲时长', async () => {
  vi.mocked(playback.start).mockResolvedValue({ id: 'lease', mode: 'HLS', status: 'READY', url: '/original.m3u8', offset: 0, media: { duration: 290, streams: [] } })
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('probably')
  await open(); await wrapper!.findAll('.track-switch button')[0]!.trigger('click')
  await wrapper!.get('button[aria-label="播放试听"]').trigger('click'); await flushPromises(); await metadata(60)
  expect(wrapper!.get('.player-time').text()).toBe('0:00 / 4:50')
  expect(wrapper!.get('input[aria-label="试听进度"]').attributes('max')).toBe('290')
})
