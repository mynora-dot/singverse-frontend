// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mockMediaElements } from './media-element-mocks'
import { playback } from '../src/admin/modules/transcoding/playback'
import { adminActivity } from '../src/admin/modules/transcoding/activity'
const hlsAdapter = vi.hoisted(() => ({ supported: vi.fn(), load: vi.fn(), attach: vi.fn(), destroy: vi.fn(), on: vi.fn(), select: vi.fn(), audioTrack: -1, tracks: [] as { url: string }[] }))
vi.mock('hls.js', () => ({ default: class {
  static Events = { ERROR: 'error', AUDIO_TRACKS_UPDATED: 'audioTracksUpdated' }
  static isSupported = hlsAdapter.supported
  loadSource = hlsAdapter.load
  attachMedia = hlsAdapter.attach
  destroy = hlsAdapter.destroy
  on = hlsAdapter.on
  get audioTracks() { return hlsAdapter.tracks }
  get audioTrack() { return hlsAdapter.audioTrack }
  set audioTrack(value: number) { hlsAdapter.audioTrack = value; hlsAdapter.select(value) }
} }))
vi.mock('../src/admin/modules/transcoding/playback')
beforeEach(() => {
  vi.resetAllMocks()
  hlsAdapter.supported.mockReturnValue(true)
  hlsAdapter.audioTrack = -1; hlsAdapter.tracks = []
  mockMediaElements()
  vi.spyOn(adminActivity, 'create').mockResolvedValue({ attemptId: 'admin-attempt', writeToken: 'test-write-token', eventSeq: -1, leaseSeconds: 120, startedAt: Date.now(), serverTime: Date.now() })
  vi.spyOn(adminActivity, 'event').mockResolvedValue(undefined)
  vi.mocked(playback.start).mockImplementation(async id => ({ mode: 'DIRECT', status: 'READY', url: `/api/v1/media-songs/${id}/video`, offset: 0 }))
  vi.mocked(playback.roles).mockResolvedValue({ state: 'UNKNOWN', jobs: [] })
  vi.mocked(playback.cancel).mockResolvedValue(undefined)
})
afterEach(() => vi.restoreAllMocks())
import SongVideoDialog from '../src/admin/modules/song-management/components/SongVideoDialog.vue'
import type { MediaSong } from '../src/admin/modules/media-library/types'

it('播放器失败时显示原因范围并可重新加载，切换歌曲使用新的同源地址', async () => {
  const song = { id: 'song-1', sourceName: '远端', relativePath: 'video.mp4', result: { title: '歌曲', artists: [] } } as unknown as MediaSong
  const wrapper = mount(SongVideoDialog, { props: { song }, global: { stubs: { teleport: true } } })
  try {
    await flushPromises()
    expect(wrapper.get('video').attributes('controls')).toBeUndefined()
    expect(wrapper.findAll('[aria-label="播放进度"]')).toHaveLength(1)
    expect(wrapper.get('video').attributes('preload')).toBe('metadata')
    await wrapper.get('video').trigger('error'); await flushPromises()
    expect(wrapper.text()).toContain('媒体暂时无法播放')
    expect(wrapper.find('video').exists()).toBe(false)
    await wrapper.findAll('button').find(button => button.text() === '重新加载')!.trigger('click'); await flushPromises()
    expect(wrapper.get('video').attributes('src')).toBe('/api/v1/media-songs/song-1/video')
    await wrapper.setProps({ song: { ...song, id: 'song-2' } }); await flushPromises()
    expect(wrapper.get('video').attributes('src')).toBe('/api/v1/media-songs/song-2/video')
    await wrapper.setProps({ song: null })
    expect(wrapper.find('video').exists()).toBe(false)
  } finally { wrapper.unmount(); document.body.innerHTML = '' }
})

it('音频使用音频控件，切换视频时移除音频，关闭时停止加载', async () => {
  const song = { id: 'audio', sourceName: '本地音频', relativePath: '歌手《歌名》.FLAC', result: { title: '歌名', artists: [] } } as unknown as MediaSong
  const wrapper = mount(SongVideoDialog, { props: { song }, global: { stubs: { teleport: true } } })
  try {
    await flushPromises()
    expect(wrapper.find('video').exists()).toBe(false)
    expect(wrapper.get('audio').attributes('controls')).toBeUndefined()
    expect(wrapper.get('audio').attributes('src')).toBe('/api/v1/media-songs/audio/video')
    expect(wrapper.text()).toContain('音频播放')
    await wrapper.get('audio').trigger('error'); await flushPromises()
    expect(wrapper.text()).toContain('媒体暂时无法播放')
    await wrapper.findAll('button').find(button => button.text() === '重新加载')!.trigger('click'); await flushPromises()
    expect(wrapper.find('audio').exists()).toBe(true)
    await wrapper.setProps({ song: { ...song, id: 'video', relativePath: 'song.mp4' } }); await flushPromises()
    expect(wrapper.find('audio').exists()).toBe(false)
    expect(wrapper.find('video').exists()).toBe(true)
    await wrapper.setProps({ song: null })
    expect(wrapper.find('audio, video').exists()).toBe(false)
  } finally { wrapper.unmount(); document.body.innerHTML = '' }
})

it('切换歌曲时丢弃迟到的准备结果并取消旧执行', async () => {
  let resolveOld!: (value: Awaited<ReturnType<typeof playback.start>>) => void
  vi.mocked(playback.start).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
  vi.mocked(playback.cancel).mockResolvedValue(undefined)
  const song = { id: 'old', sourceName: '来源', relativePath: 'old.mp4', result: { title: '旧歌曲', artists: [] } } as unknown as MediaSong
  const wrapper = mount(SongVideoDialog, { props: { song }, global: { stubs: { teleport: true } } })
  try {
    await wrapper.setProps({ song: { ...song, id: 'new' } }); await flushPromises()
    resolveOld({ id: 'old-execution', mode: 'HLS', status: 'READY', url: '/api/v1/transcoding/old/master.m3u8', offset: 0 })
    await flushPromises()
    expect(wrapper.get('video').attributes('src')).toBe('/api/v1/media-songs/new/video')
    expect(playback.cancel).toHaveBeenCalledWith('old-execution')
  } finally { wrapper.unmount(); document.body.innerHTML = '' }
})

it('转换失败展示真实错误，并可通过兼容编码重新加载', async () => {
  vi.mocked(playback.start).mockRejectedValueOnce(new Error('计算节点不可用'))
  const song = { id: 'failed-song', sourceName: '来源', relativePath: 'song.mkv', result: { title: '歌曲', artists: [] } } as unknown as MediaSong
  const wrapper = mount(SongVideoDialog, { props: { song }, global: { stubs: { teleport: true } } })
  try {
    await flushPromises(); expect(wrapper.text()).toContain('计算节点不可用')
    await wrapper.findAll('button').find(button => button.text() === '重新加载')!.trigger('click')
    await flushPromises()
    expect(playback.start).toHaveBeenLastCalledWith(song.id, expect.objectContaining({ force: true, codec: 'h264' }))
    expect(wrapper.get('video').attributes('src')).toBe('/api/v1/media-songs/failed-song/video')
  } finally { wrapper.unmount(); document.body.innerHTML = '' }
})

const videoSong = { id: 'roles-song', sourceName: '来源', relativePath: 'song.mkv', result: { title: '歌曲', artists: [] } } as unknown as MediaSong
const confirmed = { state: 'CONFIRMED', originalId: 'stream:1', backingId: 'stream:2', jobs: [], streams: [{ id: 'stream:1' }, { id: 'stream:2' }] }

it.each([true, false])('浏览器报告原生 HLS 时优先使用可用的 MSE，并保留原生回退（MSE=%s）', async mse => {
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('probably')
  hlsAdapter.supported.mockReturnValue(mse)
  vi.mocked(playback.start).mockResolvedValue({ id: 'hls-session', mode: 'HLS', status: 'READY', url: '/compatible.m3u8', offset: 0 })
  const wrapper = mount(SongVideoDialog, { props: { song: videoSong }, global: { stubs: { teleport: true } } })
  try {
    for (let i = 0; i < 5; i++) await flushPromises()
    if (mse) {
      expect(hlsAdapter.load).toHaveBeenCalledExactlyOnceWith('/compatible.m3u8')
      expect(hlsAdapter.attach).toHaveBeenCalledExactlyOnceWith(wrapper.get('video').element)
      expect(wrapper.get('video').attributes('src')).toBeUndefined()
    } else {
      expect(hlsAdapter.load).not.toHaveBeenCalled()
      expect(wrapper.get('video').attributes('src')).toBe('/compatible.m3u8')
    }
    await wrapper.setProps({ song: null })
    expect(playback.cancel).toHaveBeenCalledWith('hls-session')
    expect(hlsAdapter.destroy).toHaveBeenCalledTimes(mse ? 1 : 0)
  } finally { wrapper.unmount() }
})

function mediaError(element: HTMLMediaElement, code: number) {
  Object.defineProperty(element, 'error', { configurable: true, value: { code } })
  element.dispatchEvent(new Event('error'))
}

it('首次自动播放解码失败时内部只重试一次兼容编码，不先展示错误', async () => {
  const wrapper = mount(SongVideoDialog, { props: { song: videoSong }, global: { stubs: { teleport: true } } })
  try {
    await flushPromises()
    const oldVideo = wrapper.get('video').element
    oldVideo.currentTime = 48; await wrapper.get('video').trigger('timeupdate')
    await wrapper.get('.main-play').trigger('click'); await flushPromises()
    await wrapper.get('[aria-label="音量"]').setValue('40')
    mediaError(oldVideo, 3); await flushPromises()
    expect(wrapper.find('.player-error').exists()).toBe(false)
    expect(playback.start).toHaveBeenCalledTimes(2)
    expect(playback.start).toHaveBeenLastCalledWith(videoSong.id, expect.objectContaining({ force: true, start: 48, audioRole: 'original' }))
    const newVideo = wrapper.get('video').element
    expect(newVideo).not.toBe(oldVideo)
    // A queued event from the replaced source must not tear down the retry.
    mediaError(oldVideo, 4); await flushPromises()
    expect(playback.start).toHaveBeenCalledTimes(2)
    await wrapper.get('video').trigger('loadedmetadata'); await flushPromises()
    expect(newVideo.currentTime).toBe(48)
    expect(newVideo.volume).toBe(.4)
    expect(newVideo.paused).toBe(false)
    mediaError(newVideo, 4); await flushPromises()
    expect(playback.start).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('媒体暂时无法播放')
  } finally { wrapper.unmount() }
})

it('不支持的格式也会自动兼容，网络错误和取消事件不触发转码', async () => {
  const wrapper = mount(SongVideoDialog, { props: { song: videoSong }, global: { stubs: { teleport: true } } })
  try {
    await flushPromises()
    mediaError(wrapper.get('video').element, 1); await flushPromises()
    expect(wrapper.find('.player-error').exists()).toBe(false)
    expect(playback.start).toHaveBeenCalledTimes(1)
    mediaError(wrapper.get('video').element, 4); await flushPromises()
    expect(playback.start).toHaveBeenCalledTimes(2)
    await wrapper.setProps({ song: { ...videoSong, id: 'network' } }); await flushPromises()
    const calls = vi.mocked(playback.start).mock.calls.length
    mediaError(wrapper.get('video').element, 2); await flushPromises()
    expect(playback.start).toHaveBeenCalledTimes(calls)
    expect(wrapper.text()).toContain('媒体读取失败，请检查网络或媒体来源后重试')
  } finally { wrapper.unmount() }
})

it('用户明确选择原始编码时，失败后不擅自转码', async () => {
  const wrapper = mount(SongVideoDialog, { props: { song: videoSong }, global: { stubs: { teleport: true } } })
  try {
    await flushPromises()
    await wrapper.get('[aria-label="播放编码"]').setValue('source'); await flushPromises()
    mediaError(wrapper.get('video').element, 4); await flushPromises()
    expect(playback.start).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('播放器无法解码此媒体')
  } finally { wrapper.unmount() }
})

it('自动兼容准备失败保留真实原因，并允许手动重试', async () => {
  vi.mocked(playback.start).mockRejectedValueOnce(new Error('计算节点不可用'))
  const wrapper = mount(SongVideoDialog, { props: { song: videoSong }, global: { stubs: { teleport: true } } })
  try {
    await flushPromises()
    await wrapper.findAll('button').find(b => b.text() === '重新加载')!.trigger('click'); await flushPromises()
    expect(wrapper.find('video').exists()).toBe(true)
    await wrapper.setProps({ song: { ...videoSong, id: 'fallback-failure' } }); await flushPromises()
    vi.mocked(playback.start).mockRejectedValueOnce(new Error('兼容转码设备不可用'))
    mediaError(wrapper.get('video').element, 3); await flushPromises()
    expect(wrapper.text()).toContain('兼容转码设备不可用')
  } finally { wrapper.unmount() }
})

it('原唱伴奏按共享角色选择，切换保留位置、播放状态和音量', async () => {
  vi.mocked(playback.start).mockImplementation(async () => ({ mode: 'DIRECT', status: 'READY', url: '/api/v1/selected', offset: 0, audioRoles: confirmed }))
  const wrapper = mount(SongVideoDialog, { props: { song: videoSong }, global: { stubs: { teleport: true } } })
  try {
    await flushPromises()
    expect(playback.start).toHaveBeenLastCalledWith(videoSong.id, expect.objectContaining({ audioRole: 'original' }))
    const media = wrapper.get('video').element
    media.currentTime = 48; await wrapper.get('video').trigger('timeupdate')
    await wrapper.get('.main-play').trigger('click'); await flushPromises()
    await wrapper.get('[aria-label="音量"]').setValue('35')
    await wrapper.findAll('.role-picker button')[1]!.trigger('click'); await flushPromises()
    expect(playback.start).toHaveBeenLastCalledWith(videoSong.id, expect.objectContaining({ audioRole: 'backing', start: 48 }))
    await wrapper.get('video').trigger('loadedmetadata'); await flushPromises()
    expect(wrapper.get('video').element.currentTime).toBe(48)
    expect(wrapper.get('video').element.paused).toBe(false)
    expect(wrapper.get('video').element.volume).toBe(.35)
    expect(wrapper.get('.transport-state').text()).toContain('正在播放 · 伴奏')
    expect(wrapper.findAll('.role-picker button')[1]!.attributes('aria-pressed')).toBe('true')
  } finally { wrapper.unmount() }
})

const dualTrackResource = {
  id: 'dual-track', mode: 'HLS', status: 'READY', url: '/api/v1/dual/master.m3u8', offset: 0,
  audioRoles: { ...confirmed, originalId: 'stream:7', backingId: 'stream:11' },
  execution: { trackMapping: [
    { sourceId: 'stream:0', outputIndex: 0, kind: 'video' },
    { sourceId: 'stream:11', outputIndex: 1, kind: 'audio' },
    { sourceId: 'stream:7', outputIndex: 2, kind: 'audio' },
  ] },
}

it('HLS 按源音轨映射切换，同一个视频和会话保留画面、位置与播放状态', async () => {
  vi.mocked(playback.start).mockResolvedValue(dualTrackResource)
  const wrapper = mount(SongVideoDialog, { props: { song: videoSong }, global: { stubs: { teleport: true } } })
  try {
    await flushPromises()
    // HLS rendition order can differ from the original source and role order.
    expect(playback.start).toHaveBeenCalledWith(videoSong.id, expect.objectContaining({ audioRole: 'original', switchableAudio: true }))
    hlsAdapter.tracks = [{ url: '/api/v1/dual/stream_audio1.m3u8' }, { url: '/api/v1/dual/stream_audio0.m3u8' }]
    const tracksUpdated = hlsAdapter.on.mock.calls.find(([event]) => event === 'audioTracksUpdated')![1] as () => void
    tracksUpdated()
    expect(hlsAdapter.select).toHaveBeenLastCalledWith(0)
    const video = wrapper.get('video').element
    video.currentTime = 48; await wrapper.get('video').trigger('timeupdate')
    await wrapper.get('.main-play').trigger('click'); await flushPromises()
    await wrapper.get('[aria-label="音量"]').setValue('35')
    for (const index of [1, 0, 1, 0]) {
      await wrapper.findAll('.role-picker button')[index]!.trigger('click'); await flushPromises()
      expect(hlsAdapter.select).toHaveBeenLastCalledWith(index)
      expect(wrapper.get('video').element).toBe(video)
      expect(video.currentTime).toBe(48); expect(video.paused).toBe(false)
      expect(video.volume).toBe(.35)
    }
    expect(playback.start).toHaveBeenCalledOnce()
    expect(playback.cancel).not.toHaveBeenCalled()
    expect(hlsAdapter.destroy).not.toHaveBeenCalled()
    await wrapper.get('.main-play').trigger('click'); await flushPromises()
    await wrapper.findAll('.role-picker button')[1]!.trigger('click'); await flushPromises()
    expect(video.paused).toBe(true)
  } finally { wrapper.unmount() }
})

it('原生 HLS 使用对应音轨标签切换，首次元数据就选择确认的原唱', async () => {
  hlsAdapter.supported.mockReturnValue(false)
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('probably')
  vi.mocked(playback.start).mockResolvedValue(dualTrackResource)
  const wrapper = mount(SongVideoDialog, { props: { song: videoSong }, global: { stubs: { teleport: true } } })
  try {
    await flushPromises()
    const video = wrapper.get('video').element
    const nativeTracks = [{ label: 'audio_2', enabled: false }, { label: 'audio_1', enabled: true }]
    Object.defineProperty(video, 'audioTracks', { configurable: true, value: nativeTracks })
    await wrapper.get('video').trigger('loadedmetadata'); await flushPromises()
    expect(nativeTracks.map(track => track.enabled)).toEqual([true, false])
    await wrapper.findAll('.role-picker button')[1]!.trigger('click'); await flushPromises()
    expect(nativeTracks.map(track => track.enabled)).toEqual([false, true])
    expect(wrapper.get('video').element).toBe(video)
    expect(playback.start).toHaveBeenCalledOnce()
  } finally { wrapper.unmount() }
})

it('浏览器无法选择 HLS 音轨时回退为服务器单轨选择，不重复申请无法切换的多轨资源', async () => {
  hlsAdapter.supported.mockReturnValue(false)
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('probably')
  vi.mocked(playback.start).mockResolvedValueOnce(dualTrackResource).mockResolvedValueOnce({
    ...dualTrackResource, id: 'selected-backing', url: '/api/v1/selected-backing.m3u8',
    execution: { trackMapping: [{ sourceId: 'stream:11', kind: 'audio', outputIndex: 1 }] },
  })
  const wrapper = mount(SongVideoDialog, { props: { song: videoSong }, global: { stubs: { teleport: true } } })
  try {
    await flushPromises()
    wrapper.get('video').element.currentTime = 12; await wrapper.get('video').trigger('timeupdate')
    await wrapper.get('.main-play').trigger('click'); await flushPromises()
    await wrapper.findAll('.role-picker button')[1]!.trigger('click'); await flushPromises()
    expect(playback.start).toHaveBeenLastCalledWith(videoSong.id, expect.objectContaining({ audioRole: 'backing', start: 12, switchableAudio: false }))
    expect(wrapper.get('video').attributes('src')).toBe('/api/v1/selected-backing.m3u8')
    await wrapper.get('video').trigger('loadedmetadata'); await flushPromises()
    expect(wrapper.get('video').element.currentTime).toBe(12)
    expect(wrapper.get('video').element.paused).toBe(false)
  } finally { wrapper.unmount() }
})

it('未确认的音轨不能切换伴奏，设置默认收起且不展示元数据和路径', async () => {
  vi.mocked(playback.roles).mockResolvedValue({ ...confirmed, state: 'NEEDS_REVIEW' })
  const wrapper = mount(SongVideoDialog, { props: { song: videoSong }, global: { stubs: { teleport: true } } })
  try {
    await flushPromises()
    expect(wrapper.findAll('.role-picker button')[1]!.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('伴奏未就绪')
    expect(wrapper.find('[aria-label="播放画质"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('song.mkv')
    await wrapper.get('.settings-button').trigger('click')
    expect(wrapper.find('[aria-label="播放画质"]').exists()).toBe(true)
  } finally { wrapper.unmount() }
})

it('编码选择真实直放或强制 H264 兼容处理，位置保持在原时间轴', async () => {
  const wrapper = mount(SongVideoDialog, { props: { song: videoSong }, global: { stubs: { teleport: true } } })
  try {
    await flushPromises()
    wrapper.get('video').element.currentTime = 30; await wrapper.get('video').trigger('timeupdate')
    const calls = vi.mocked(playback.start).mock.calls.length
    await wrapper.get('[aria-label="播放编码"]').setValue('source'); await flushPromises()
    expect(playback.start).toHaveBeenCalledTimes(calls)
    expect(wrapper.get('video').attributes('src')).toBe('/api/v1/media-songs/roles-song/video')
    await wrapper.get('video').trigger('loadedmetadata')
    expect(wrapper.get('video').element.currentTime).toBe(30)
    await wrapper.get('[aria-label="播放编码"]').setValue('compatible'); await flushPromises()
    expect(playback.start).toHaveBeenLastCalledWith(videoSong.id, expect.objectContaining({ codec: 'h264', force: true, start: 30 }))
  } finally { wrapper.unmount() }
})

it('多轨原唱不能使用浏览器默认音轨冒充，选择原始编码回到自动处理', async () => {
  vi.mocked(playback.roles).mockResolvedValue(confirmed)
  const wrapper = mount(SongVideoDialog, { props: { song: videoSong }, global: { stubs: { teleport: true } } })
  try {
    await flushPromises()
    await wrapper.get('[aria-label="播放编码"]').setValue('source'); await flushPromises()
    expect((wrapper.get('[aria-label="播放编码"]').element as HTMLSelectElement).value).toBe('auto')
    expect(playback.start).toHaveBeenLastCalledWith(videoSong.id, expect.objectContaining({ audioRole: 'original' }))
    expect(wrapper.text()).toContain('已切换为自动编码')
  } finally { wrapper.unmount() }
})

it('音频的独立伴奏提前加载，切换不更换原媒体或重新申请播放', async () => {
  vi.mocked(playback.roles).mockResolvedValue({ state: 'CONFIRMED', originalId: 'stream:0', backingResource: { jobId: 'generated' }, jobs: [] })
  const wrapper = mount(SongVideoDialog, { props: { song: { ...videoSong, relativePath: 'song.flac' } }, global: { stubs: { teleport: true } } })
  try {
    await flushPromises()
    const original = wrapper.get('.song-audio').element as HTMLAudioElement
    const backing = wrapper.get('.backing-audio').element as HTMLAudioElement
    Object.defineProperty(backing, 'readyState', { value: 4, configurable: true })
    expect(backing.getAttribute('src')).toBe('/api/v1/media-songs/roles-song/accompaniment/generated')
    expect(backing.muted).toBe(true)
    original.currentTime = 20; await wrapper.get('.song-audio').trigger('timeupdate')
    await wrapper.get('.main-play').trigger('click'); await flushPromises()
    expect(backing.paused).toBe(false)
    await wrapper.findAll('.role-picker button')[1]!.trigger('click'); await flushPromises()
    expect(wrapper.get('.song-audio').element).toBe(original)
    expect(original.muted).toBe(true); expect(backing.muted).toBe(false)
    expect(backing.currentTime).toBe(20)
    await wrapper.findAll('.role-picker button')[0]!.trigger('click'); await flushPromises()
    expect(wrapper.get('.song-audio').element).toBe(original)
    expect(original.getAttribute('src')).toBe('/api/v1/media-songs/roles-song/video')
    expect(original.paused).toBe(false); expect(original.muted).toBe(false)
    expect(backing.paused).toBe(false); expect(backing.muted).toBe(true)
    expect(playback.start).toHaveBeenCalledOnce()
    expect(playback.cancel).not.toHaveBeenCalled()
  } finally { wrapper.unmount() }
})

const generatedRoles = { state: 'CONFIRMED', originalId: 'stream:0', backingResource: { jobId: 'generated' }, jobs: [] }

it('未选中的伴奏缓冲或预载失败不会打断原唱，伴奏出错也保留画面并恢复原唱', async () => {
  vi.mocked(playback.roles).mockResolvedValue(generatedRoles)
  const wrapper = mount(SongVideoDialog, { props: { song: videoSong }, global: { stubs: { teleport: true } } })
  try {
    await flushPromises()
    const video = wrapper.get('video').element, backing = wrapper.get('.backing-audio').element as HTMLAudioElement
    Object.defineProperty(backing, 'readyState', { configurable: true, value: 4 })
    await wrapper.get('.main-play').trigger('click'); await flushPromises()
    await wrapper.get('.backing-audio').trigger('waiting'); await flushPromises()
    expect(video.paused).toBe(false)
    mediaError(backing, 2); await flushPromises()
    expect(video.paused).toBe(false); expect(video.muted).toBe(false)
    expect(wrapper.find('.player-error').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('已恢复原唱')
    await wrapper.findAll('.role-picker button')[1]!.trigger('click'); await flushPromises()
    expect(video.muted).toBe(true)
    mediaError(backing, 3); await flushPromises()
    expect(wrapper.get('video').element).toBe(video)
    expect(video.paused).toBe(false); expect(video.muted).toBe(false)
    expect(backing.muted).toBe(true)
    expect(wrapper.text()).toContain('已恢复原唱')
    expect(playback.start).toHaveBeenCalledOnce()
  } finally { wrapper.unmount() }
})

it('伴奏缓冲时切回原唱会继续播放，用户暂停后迟到的就绪事件不会自动续播', async () => {
  vi.mocked(playback.roles).mockResolvedValue(generatedRoles)
  const wrapper = mount(SongVideoDialog, { props: { song: videoSong }, global: { stubs: { teleport: true } } })
  try {
    await flushPromises()
    const video = wrapper.get('video').element, backing = wrapper.get('.backing-audio').element as HTMLAudioElement
    Object.defineProperty(backing, 'readyState', { configurable: true, value: 4 })
    await wrapper.get('.main-play').trigger('click'); await flushPromises()
    await wrapper.findAll('.role-picker button')[1]!.trigger('click'); await flushPromises()
    await wrapper.get('.backing-audio').trigger('waiting'); await flushPromises()
    expect(video.paused).toBe(true)
    await wrapper.findAll('.role-picker button')[0]!.trigger('click'); await flushPromises()
    expect(video.paused).toBe(false); expect(video.muted).toBe(false)
    await wrapper.findAll('.role-picker button')[1]!.trigger('click'); await flushPromises()
    await wrapper.get('.backing-audio').trigger('waiting'); await flushPromises()
    await wrapper.get('.main-play').trigger('click'); await flushPromises()
    await wrapper.get('.backing-audio').trigger('canplay'); await flushPromises()
    expect(video.paused).toBe(true); expect(backing.paused).toBe(true)
    await wrapper.findAll('.role-picker button')[0]!.trigger('click'); await flushPromises()
    expect(video.paused).toBe(true)
  } finally { wrapper.unmount() }
})

it('伴奏只有元数据时不提前续播，缓冲可播放后再恢复原来的播放状态', async () => {
  vi.mocked(playback.roles).mockResolvedValue(generatedRoles)
  const wrapper = mount(SongVideoDialog, { props: { song: videoSong }, global: { stubs: { teleport: true } } })
  try {
    await flushPromises()
    const video = wrapper.get('video').element, backing = wrapper.get('.backing-audio').element as HTMLAudioElement
    let ready = 0
    Object.defineProperty(backing, 'readyState', { configurable: true, get: () => ready })
    await wrapper.get('.main-play').trigger('click'); await flushPromises()
    await wrapper.findAll('.role-picker button')[1]!.trigger('click'); await flushPromises()
    expect(video.paused).toBe(true)
    ready = 1; await wrapper.get('.backing-audio').trigger('loadedmetadata'); await flushPromises()
    expect(video.paused).toBe(true)
    ready = 4; await wrapper.get('.backing-audio').trigger('canplay'); await flushPromises()
    expect(video.paused).toBe(false); expect(backing.paused).toBe(false)
    await wrapper.get('[aria-label="播放编码"]').setValue('compatible'); await flushPromises()
    expect(playback.start).toHaveBeenLastCalledWith(videoSong.id, expect.objectContaining({ audioRole: 'original', force: true }))
    await wrapper.get('video').trigger('loadedmetadata'); await flushPromises()
    expect(wrapper.get('video').element.muted).toBe(true)
  } finally { wrapper.unmount() }
})

it('切歌与关闭停止预播伴奏，旧伴奏的迟到事件不会影响新歌曲', async () => {
  vi.mocked(playback.roles).mockResolvedValueOnce(generatedRoles)
  const wrapper = mount(SongVideoDialog, { props: { song: videoSong }, global: { stubs: { teleport: true } } })
  try {
    await flushPromises()
    const backing = wrapper.get('.backing-audio').element as HTMLAudioElement
    await wrapper.get('.main-play').trigger('click'); await flushPromises()
    expect(backing.paused).toBe(false)
    await wrapper.setProps({ song: { ...videoSong, id: 'next' } }); await flushPromises()
    expect(backing.paused).toBe(true); expect(backing.getAttribute('src')).toBeNull()
    mediaError(backing, 3); backing.dispatchEvent(new Event('canplay')); await flushPromises()
    expect(wrapper.find('.player-error').exists()).toBe(false)
    expect(wrapper.get('video').attributes('src')).toBe('/api/v1/media-songs/next/video')
    expect(wrapper.get('video').element.paused).toBe(true)
  } finally { wrapper.unmount() }
})

it('关闭会停止并移除媒体源，迟到的音轨查询不会覆盖下一首歌', async () => {
  let resolveRoles!: (value: Awaited<ReturnType<typeof playback.roles>>) => void
  vi.mocked(playback.roles).mockImplementationOnce(() => new Promise(resolve => { resolveRoles = resolve }))
  const wrapper = mount(SongVideoDialog, { props: { song: videoSong }, global: { stubs: { teleport: true } } })
  try {
    await flushPromises()
    const media = wrapper.get('video').element
    await wrapper.setProps({ song: { ...videoSong, id: 'next' } }); await flushPromises()
    resolveRoles(confirmed); await flushPromises()
    expect(wrapper.findAll('.role-picker button')[1]!.attributes('disabled')).toBeDefined()
    expect(media.getAttribute('src')).toBeNull()
    const current = wrapper.get('video').element
    await wrapper.setProps({ song: null }); await flushPromises()
    expect(current.getAttribute('src')).toBeNull()
    expect(current.paused).toBe(true)
  } finally { wrapper.unmount() }
})


it('视频暂停和设置展开不会固定显示浮层', async () => {
  const wrapper = mount(SongVideoDialog, { props: { song: videoSong }, global: { stubs: { teleport: true } } })
  try {
    await flushPromises()
    expect(wrapper.get('.song-player').classes()).toContain('is-video')
    expect(wrapper.get('.song-player').classes()).not.toContain('controls-pinned')
    await wrapper.get('video').trigger('playing')
    expect(wrapper.get('.song-player').classes()).not.toContain('controls-pinned')
    await wrapper.get('.settings-button').trigger('click')
    expect(wrapper.get('.song-player').classes()).not.toContain('controls-pinned')
    await wrapper.get('.settings-button').trigger('click')
    expect(wrapper.get('.song-player').classes()).not.toContain('controls-pinned')
    await wrapper.get('video').trigger('pause')
    expect(wrapper.get('.song-player').classes()).not.toContain('controls-pinned')
    await wrapper.setProps({ song: { ...videoSong, relativePath: 'song.flac' } })
    await flushPromises()
    expect(wrapper.get('.song-player').classes()).not.toContain('is-video')
  } finally { wrapper.unmount() }
})


it('管理员只按主媒体实际播放采集，独立伴奏不重复建实例，重建保留同一实例', async () => {
  vi.mocked(playback.start).mockResolvedValue({ mode: 'DIRECT', status: 'READY', url: '/api/v1/main', offset: 0, backingUrl: '/api/v1/backing', audioRoles: confirmed })
  const wrapper = mount(SongVideoDialog, { props: { song: videoSong }, global: { stubs: { teleport: true } } })
  try {
    await flushPromises()
    expect(adminActivity.create).not.toHaveBeenCalled()
    await wrapper.get('.main-play').trigger('click'); await flushPromises()
    expect(adminActivity.create).toHaveBeenCalledOnce()
    expect(adminActivity.create).toHaveBeenCalledWith(videoSong.id, expect.any(Number))
    expect(adminActivity.event).toHaveBeenLastCalledWith('admin-attempt', expect.objectContaining({ state: 'PLAYING', actualPlayedMs: 0 }))
    await wrapper.get('.backing-audio').trigger('playing'); await flushPromises()
    expect(adminActivity.create).toHaveBeenCalledOnce()
    const old = wrapper.get('video').element
    await wrapper.get('video').trigger('waiting'); await flushPromises()
    expect(adminActivity.event).toHaveBeenLastCalledWith('admin-attempt', expect.objectContaining({ state: 'BUFFERING' }))
    await wrapper.get('[aria-label="播放编码"]').setValue('compatible'); await flushPromises()
    await wrapper.get('video').trigger('loadedmetadata'); await flushPromises()
    expect(adminActivity.create).toHaveBeenCalledOnce()
    await wrapper.setProps({ song: { ...videoSong, id: 'new-preview' } }); await flushPromises()
    expect(adminActivity.event).toHaveBeenLastCalledWith('admin-attempt', expect.objectContaining({ state: 'STOPPED' }))
    old.dispatchEvent(new Event('playing')); await flushPromises()
    expect(adminActivity.create).toHaveBeenCalledOnce()
    await wrapper.get('.main-play').trigger('click'); await flushPromises()
    expect(adminActivity.create).toHaveBeenCalledTimes(2)
  } finally { wrapper.unmount(); await flushPromises() }
})
