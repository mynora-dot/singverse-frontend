// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ElCheckbox, ElDialog, ElMessageBox, ElPagination } from 'element-plus'
import { onBeforeRouteLeave } from 'vue-router'
import SongCacheView from '../src/admin/modules/song-cache/SongCacheView.vue'
import { songCache, type CachePage, type CleanupJob } from '../src/admin/modules/song-cache/api'
import { ApiError } from '../src/admin/core/auth/api'

vi.mock('../src/admin/modules/song-cache/api')
vi.mock('vue-router', async original => ({ ...await original<typeof import('vue-router')>(), onBeforeRouteLeave: vi.fn(), useRoute: () => ({ query: {} }) }))
const original: CachePage = {
  settings: { maxBytes: 10 * 1024 ** 3, policy: 'HYBRID', ttlHours: 72, revision: 2, highWatermarkPercent: 90, lowWatermarkPercent: 75 }, usageBytes: 1024 ** 3, entryCount: 2,
  page: 0, size: 20, totalElements: 2,
  items: [
    { id: 'cache-video', songId: 'song1', title: '合唱歌曲', artist: '歌手一 / 歌手二', mediaType: 'VIDEO', bytes: 512 * 1024 ** 2, hits: 7, createdAt: '2026-11-04T02:00:00Z', lastAccessAt: '2026-11-05T02:00:00Z', leased: false, target: { mode: 'TRANSCODE', codec: 'h264', width: 1920, height: 1080 } },
    { id: 'cache-audio', songId: 'song2', title: '音频歌曲', artist: '歌手三', mediaType: 'AUDIO', bytes: 10 * 1024 ** 2, hits: 1, createdAt: '2026-11-04T03:00:00Z', lastAccessAt: '2026-11-05T03:00:00Z', leased: true, target: { mode: 'AUDIO_TRANSCODE', start: 10 } },
  ],
}
const completed: CleanupJob = { id: 'cleanup', state: 'SUCCEEDED', removed: 1, skipped: 1, failed: 0, freedBytes: 1024 ** 2, usageBeforeBytes: 1024 ** 3, usageAfterBytes: 1023 * 1024 ** 2, targetBytes: 7.5 * 1024 ** 3, targetReached: true, spaceInsufficient: false, shortfallBytes: 0, skippedByReason: { PLAYING: 1 }, errors: [] }
let wrapper: VueWrapper | undefined
beforeEach(() => {
  vi.resetAllMocks()
  sessionStorage.clear()
  vi.mocked(songCache.list).mockResolvedValue(structuredClone(original))
  vi.mocked(songCache.save).mockImplementation(async value => ({ ...value, revision: value.revision + 1 }))
  vi.mocked(songCache.remove).mockResolvedValue(undefined)
  vi.mocked(songCache.clear).mockResolvedValue({ removed: 1, skipped: 1 })
  vi.mocked(songCache.pins).mockResolvedValue({ items: [], page: 0, size: 20, totalElements: 0 })
  vi.mocked(songCache.cleanup).mockResolvedValue(structuredClone(completed))
  vi.mocked(songCache.job).mockResolvedValue(structuredClone(completed))
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.restoreAllMocks(); vi.useRealTimers() })
async function page() { wrapper = mount(SongCacheView, { attachTo: document.body, global: { stubs: { RouterLink: { template: '<a><slot/></a>' } } } }); await flushPromises() }
function button(text: string) { return wrapper!.findAll('button').find(b => b.text() === text)! }
function confirm() { return vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as Awaited<ReturnType<typeof ElMessageBox.confirm>>) }

it('显示音视频缓存、容量、命中和租约状态，格式标明请求画质上限', async () => {
  await page()
  expect(songCache.list).toHaveBeenCalledWith(0, 20)
  expect(wrapper!.findAll('.cache-row')).toHaveLength(2)
  expect(wrapper!.text()).toContain('1 GiB')
  expect(wrapper!.text()).toContain('2 份歌曲缓存')
  expect(wrapper!.text()).toContain('合唱歌曲')
  expect(wrapper!.text()).toContain('画质上限 1920 × 1080')
  expect(wrapper!.text()).toContain('命中 7 次')
  expect(wrapper!.text()).toContain('从 10 秒起')
  expect(wrapper!.text()).toContain('整曲缓存支持跳转复用')
  expect(wrapper!.text()).toContain('清理只删除本地缓存，不修改原始歌曲或已有离线兼容版本')
  expect(wrapper!.get('button[aria-label="删除音频歌曲的缓存"]').attributes('disabled')).toBeDefined()
  expect(wrapper!.get('button[aria-label="删除合唱歌曲的缓存"]').attributes('disabled')).toBeUndefined()
})

it('磁盘满导致自动预算为零时容量进度仍有效，不自动保存设置', async () => {
  vi.mocked(songCache.list).mockResolvedValue({ ...structuredClone(original), settings: { ...original.settings, maxBytes: 0, revision: 0 }, usageBytes: 0, entryCount: 0, totalElements: 0, items: [] })
  await page()
  expect(wrapper!.get('progress[aria-label="缓存容量使用比例"]').attributes('value')).toBe('0')
  expect(wrapper!.get('input[aria-label="最大缓存容量"]').element).toHaveProperty('value', '0')
  expect(wrapper!.text()).toContain('默认 50 GiB')
  expect(wrapper!.text()).not.toContain('NaN')
  expect(songCache.save).not.toHaveBeenCalled()
})

it('缓存明细按歌曲编号显示封面，编号编码且缺图或加载失败时显示占位', async () => {
  const value = structuredClone(original)
  value.items[0]!.songId = 'song/一'
  delete value.items[1]!.songId
  vi.mocked(songCache.list).mockResolvedValue(value)
  await page()
  const video = wrapper!.get('[data-cache-id="cache-video"]')
  expect(video.get('.song-cover img').attributes('src')).toBe('/api/v1/metadata/songs/song%2F%E4%B8%80/cover?variant=thumbnail')
  expect(video.get('.song-cover img').attributes('alt')).toBe('合唱歌曲的封面')
  expect(video.get('.song-cover img').attributes('loading')).toBe('lazy')
  const audio = wrapper!.get('[data-cache-id="cache-audio"]')
  expect(audio.find('.song-cover img').exists()).toBe(false)
  expect(audio.find('[aria-label="暂无歌曲封面"]').exists()).toBe(true)
  await video.get('.song-cover img').trigger('error')
  expect(video.find('.song-cover img').exists()).toBe(false)
  expect(video.find('[aria-label="暂无歌曲封面"]').exists()).toBe(true)
})

it('固定歌曲包含尚无缓存的歌曲也显示封面，加载失败保留歌曲与取消固定操作', async () => {
  vi.mocked(songCache.pins).mockResolvedValue({ items: [{ songId: 'future/song', title: '未来固定', pinned: true, revision: 7, hasCache: false }], page: 0, size: 20, totalElements: 1 })
  await page()
  await wrapper!.get('#cache-pins-tab').trigger('click')
  const pin = wrapper!.get('[data-pin-song-id="future/song"]')
  expect(pin.get('.song-cover img').attributes('src')).toBe('/api/v1/metadata/songs/future%2Fsong/cover?variant=thumbnail')
  expect(pin.get('.song-cover img').attributes('alt')).toBe('未来固定的封面')
  expect(pin.text()).toContain('尚无缓存')
  await pin.get('.song-cover img').trigger('error')
  expect(pin.find('.song-cover img').exists()).toBe(false)
  expect(pin.find('[aria-label="暂无歌曲封面"]').exists()).toBe(true)
  expect(pin.get('button[aria-label="取消固定未来固定"]').attributes('disabled')).toBeUndefined()
  expect(songCache.cleanup).not.toHaveBeenCalled()
})

it('原片部分缓存显示实际容量和完整度，使用中的预缓存不能删除', async () => {
  const value = structuredClone(original)
  value.items = [
    { ...value.items[0]!, id: 'raw-part', title: '原片部分', bytes: 2 * 1024 ** 2, cachedBytes: 2 * 1024 ** 2, sourceBytes: 20 * 1024 ** 2, complete: false, leased: true, target: { mode: 'ORIGINAL', sourceBytes: 20 * 1024 ** 2 } },
    { ...value.items[0]!, id: 'raw-full', title: '原片完整', bytes: 20 * 1024 ** 2, cachedBytes: 20 * 1024 ** 2, sourceBytes: 20 * 1024 ** 2, complete: true, target: { mode: 'ORIGINAL' } },
  ]
  vi.mocked(songCache.list).mockResolvedValue(value)
  await page()
  expect(wrapper!.text()).toContain('WebDAV 原片 / 已缓存 2 MiB / 20 MiB')
  expect(wrapper!.text()).toContain('WebDAV 原片 / 已完整缓存')
  expect(wrapper!.text()).not.toContain('画质上限')
  expect(wrapper!.get('button[aria-label="删除原片部分的缓存"]').attributes('disabled')).toBeDefined()
  const ask = confirm()
  await wrapper!.get('button[aria-label="删除原片完整的缓存"]').trigger('click'); await flushPromises()
  expect(ask.mock.calls[0]![0]).toContain('WebDAV 源文件会保留')
  expect(ask.mock.calls[0]![0]).not.toContain('重新解码')
  expect(songCache.cleanup).toHaveBeenCalledWith({ mode: 'DELETE', entryId: 'raw-full' })
})

it('未占用的原片部分缓存可复用并可删除，不把部分数据标为整曲', async () => {
  const value = structuredClone(original)
  value.items = [{ ...value.items[0]!, bytes: 2 * 1024 ** 2, complete: false, target: { mode: 'ORIGINAL', sourceBytes: 80 * 1024 ** 2 } }]
  vi.mocked(songCache.list).mockResolvedValue(value)
  await page()
  expect(wrapper!.text()).toContain('已缓存 2 MiB / 80 MiB')
  expect(wrapper!.text()).toContain('部分已缓存')
  expect(wrapper!.text()).not.toContain('已完整缓存')
  expect(wrapper!.get('button[aria-label="删除合唱歌曲的缓存"]').attributes('disabled')).toBeUndefined()
})

it('残留占用与有效原片字节分开展示，不把损坏块计入整曲完整度', async () => {
  const value = structuredClone(original)
  value.usageBytes = 6 * 1024 ** 2
  value.items = [{ ...value.items[0]!, bytes: 2 * 1024 ** 2, cachedBytes: 2 * 1024 ** 2, residueBytes: 4 * 1024 ** 2, sourceBytes: 6 * 1024 ** 2, complete: false, target: { mode: 'ORIGINAL' } }]
  value.entryCount = value.totalElements = 1
  vi.mocked(songCache.list).mockResolvedValue(value)
  await page()
  expect(wrapper!.get('.cache-storage-number').text()).toContain('6 MiB')
  expect(wrapper!.get('.cache-size').text()).toContain('2 MiB')
  expect(wrapper!.findAll('.cache-size small').map(item => item.text())).toContain('另有残留占用 4 MiB')
  expect(wrapper!.text()).toContain('已缓存 2 MiB / 6 MiB')
  expect(wrapper!.text()).not.toContain('已完整缓存')
})

it('容量和策略只有显式保存才生效，按GiB转为字节且携带当前revision', async () => {
  await page()
  expect(wrapper!.get('select[aria-label="缓存策略"]').findAll('option').map(o => o.attributes('value'))).toEqual(['HYBRID', 'MANUAL'])
  await wrapper!.get('input[aria-label="最大缓存容量"]').setValue('3.5')
  await wrapper!.get('input[aria-label="缓存高水位"]').setValue('85')
  await wrapper!.get('input[aria-label="缓存低水位"]').setValue('65')
  expect(songCache.save).not.toHaveBeenCalled()
  await wrapper!.get('form.cache-settings').trigger('submit'); await flushPromises()
  expect(songCache.save).toHaveBeenCalledWith({ maxBytes: 3.5 * 1024 ** 3, policy: 'HYBRID', ttlHours: 72, revision: 2, highWatermarkPercent: 85, lowWatermarkPercent: 65 })
  expect(wrapper!.text()).toContain('缓存设置已保存')
})

it('设置默认收起，取消放弃继续编辑，确认放弃后收起并恢复保存值', async () => {
  await page()
  expect(wrapper!.get('form.cache-settings').isVisible()).toBe(false)
  await button('调整设置').trigger('click')
  expect(wrapper!.get('form.cache-settings').isVisible()).toBe(true)
  await wrapper!.get('input[aria-label="最大缓存容量"]').setValue('25')
  const ask = confirm().mockRejectedValueOnce('cancel')
  await wrapper!.get('.cache-settings-toggle').trigger('click'); await flushPromises()
  expect(wrapper!.get('form.cache-settings').isVisible()).toBe(true)
  expect(wrapper!.get('input[aria-label="最大缓存容量"]').element).toHaveProperty('value', '25')
  await wrapper!.get('.cache-settings-toggle').trigger('click'); await flushPromises()
  expect(ask).toHaveBeenCalledTimes(2)
  expect(wrapper!.get('form.cache-settings').isVisible()).toBe(false)
  await button('调整设置').trigger('click')
  expect(wrapper!.get('input[aria-label="最大缓存容量"]').element).toHaveProperty('value', '10')
  expect(songCache.save).not.toHaveBeenCalled()
})

it('明细按当前页关键词和类型筛选，不把筛选结果计为全库数量', async () => {
  const value = structuredClone(original)
  value.totalElements = value.entryCount = 52
  value.items[0]!.target.mode = 'ORIGINAL'
  vi.mocked(songCache.list).mockResolvedValue(value)
  await page()
  const search = wrapper!.get('input[aria-label="查找当前页歌曲或歌手"]')
  await search.setValue('歌手三')
  expect(wrapper!.findAll('[data-cache-id]')).toHaveLength(1)
  expect(wrapper!.get('[data-cache-id]').attributes('data-cache-id')).toBe('cache-audio')
  expect(wrapper!.get('#cache-list-tab').text()).toContain('52')
  expect(wrapper!.get('.cache-list-footer').text()).toContain('本页 1 / 2 份（已筛选）')
  expect(songCache.list).toHaveBeenCalledTimes(1)
  await wrapper!.get('select[aria-label="筛选当前页缓存类型"]').setValue('ORIGINAL')
  expect(wrapper!.text()).toContain('当前页没有匹配的缓存')
  await button('重置筛选').trigger('click')
  expect(wrapper!.findAll('[data-cache-id]')).toHaveLength(2)
  wrapper!.getComponent(ElPagination).vm.$emit('current-change', 2); await flushPromises()
  expect(songCache.list).toHaveBeenLastCalledWith(1, 20)
})

it('缓存与固定列表通过键盘切换，筛选在切换后重置且独立分页', async () => {
  vi.mocked(songCache.pins).mockResolvedValue({ items: [{ songId: 'future', title: '未来固定', pinned: true, revision: 7, hasCache: false }], page: 0, size: 20, totalElements: 21 })
  await page()
  await wrapper!.get('input[aria-label="查找当前页歌曲或歌手"]').setValue('无匹配')
  await wrapper!.get('#cache-list-tab').trigger('keydown', { key: 'ArrowRight' })
  expect(wrapper!.get('#cache-pins-tab').attributes('aria-selected')).toBe('true')
  expect(wrapper!.get('#cache-pins-tab').attributes('tabindex')).toBe('0')
  expect(wrapper!.get('#cache-pins-panel').isVisible()).toBe(true)
  expect(wrapper!.get('#cache-list-panel').isVisible()).toBe(false)
  expect(wrapper!.get('input[aria-label="查找当前页固定歌曲"]').element).toHaveProperty('value', '')
  expect(wrapper!.get('#cache-pins-panel').text()).toContain('尚无缓存')
  wrapper!.findAllComponents(ElPagination)[1]!.vm.$emit('current-change', 2); await flushPromises()
  expect(songCache.pins).toHaveBeenLastCalledWith(1, 20)
  expect(songCache.list).toHaveBeenCalledTimes(1)
  await wrapper!.get('#cache-pins-tab').trigger('keydown', { key: 'Home' })
  expect(wrapper!.get('#cache-list-panel').isVisible()).toBe(true)
  expect(wrapper!.findAll('[data-cache-id]')).toHaveLength(2)
})

it('保存前仍按已保存策略回收，已保存手动策略禁用评分回收但允许清理', async () => {
  const value = structuredClone(original)
  value.settings.policy = 'MANUAL'
  vi.mocked(songCache.list).mockResolvedValue(value)
  await page()
  expect(button('按策略回收').attributes('disabled')).toBeDefined()
  expect(button('清理缓存').attributes('disabled')).toBeUndefined()
  await wrapper!.get('select[aria-label="缓存策略"]').setValue('HYBRID')
  expect(button('按策略回收').attributes('disabled')).toBeDefined()
  const ask = confirm()
  await button('按策略回收').trigger('click'); await flushPromises()
  expect(songCache.cleanup).not.toHaveBeenCalled()
  expect(ask).not.toHaveBeenCalled()
  await button('清理缓存').trigger('click'); await flushPromises()
  expect(songCache.cleanup).toHaveBeenCalledWith({ mode: 'CLEAR' })
})

it('统计未就绪时显示准备状态并禁止批量及单份删除', async () => {
  vi.mocked(songCache.list).mockResolvedValue({ ...structuredClone(original), statisticsReady: false })
  await page()
  expect(wrapper!.text()).toContain('正在准备播放评分统计')
  expect(button('按策略回收').attributes('disabled')).toBeDefined()
  expect(button('清理缓存').attributes('disabled')).toBeDefined()
  expect(wrapper!.get('button[aria-label="删除合唱歌曲的缓存"]').attributes('disabled')).toBeDefined()
  const ask = confirm()
  await button('清理缓存').trigger('click'); await flushPromises()
  expect(ask).not.toHaveBeenCalled()
  expect(songCache.cleanup).not.toHaveBeenCalled()
})

it('验证容量与整数水位边界，无效草稿不能提交', async () => {
  await page()
  await wrapper!.get('input[aria-label="最大缓存容量"]').setValue('0')
  expect(wrapper!.text()).toContain('缓存容量应在')
  expect(button('保存设置').attributes('disabled')).toBeDefined()
  await wrapper!.get('input[aria-label="最大缓存容量"]').setValue('1')
  await wrapper!.get('input[aria-label="缓存高水位"]').setValue('75')
  expect(wrapper!.text()).toContain('低水位必须小于高水位')
  await wrapper!.get('input[aria-label="缓存高水位"]').setValue('90.5')
  expect(wrapper!.text()).toContain('水位应为')
  await wrapper!.get('form.cache-settings').trigger('submit'); await flushPromises()
  expect(songCache.save).not.toHaveBeenCalled()
})

it('刷新列表保留设置草稿，重新读取设置需确认放弃', async () => {
  await page()
  await wrapper!.get('input[aria-label="最大缓存容量"]').setValue('25')
  await button('刷新列表').trigger('click'); await flushPromises()
  expect(wrapper!.get('input[aria-label="最大缓存容量"]').element).toHaveProperty('value', '25')
  const ask = confirm().mockRejectedValueOnce('cancel')
  await button('重新读取设置').trigger('click'); await flushPromises()
  expect(songCache.list).toHaveBeenCalledTimes(2)
  expect(ask).toHaveBeenCalledTimes(1)
  await button('重新读取设置').trigger('click'); await flushPromises()
  expect(wrapper!.get('input[aria-label="最大缓存容量"]').element).toHaveProperty('value', '10')
})

it('单份删除先确认，批量清理显示跳过的播放中缓存', async () => {
  await page()
  const ask = confirm().mockRejectedValueOnce('cancel')
  await wrapper!.get('button[aria-label="删除合唱歌曲的缓存"]').trigger('click'); await flushPromises()
  expect(songCache.cleanup).not.toHaveBeenCalled()
  await wrapper!.get('button[aria-label="删除合唱歌曲的缓存"]').trigger('click'); await flushPromises()
  expect(songCache.cleanup).toHaveBeenCalledWith({ mode: 'DELETE', entryId: 'cache-video' })
  await button('清理缓存').trigger('click'); await flushPromises()
  expect(songCache.cleanup).toHaveBeenCalledWith({ mode: 'CLEAR' })
  expect(ask.mock.calls[2]![0]).toContain('原始歌曲和离线兼容版本会保留')
  expect(wrapper!.text()).toContain('已清理 1 份缓存')
  expect(wrapper!.text()).toContain('正在播放：1 份')
})

it('设置冲突保留草稿，重新读取后才能再次提交', async () => {
  await page()
  await wrapper!.get('input[aria-label="最大缓存容量"]').setValue('12')
  vi.mocked(songCache.save).mockRejectedValueOnce(new ApiError(409, '配置已变化，请重新读取'))
  await wrapper!.get('form.cache-settings').trigger('submit'); await flushPromises()
  expect(wrapper!.text()).toContain('配置已变化，请重新读取')
  expect(wrapper!.get('input[aria-label="最大缓存容量"]').element).toHaveProperty('value', '12')
  expect(button('保存设置').attributes('disabled')).toBeDefined()
  expect(wrapper!.text()).not.toContain('缓存设置已保存')
  confirm()
  await button('重新读取设置').trigger('click'); await flushPromises()
  await wrapper!.get('input[aria-label="最大缓存容量"]').setValue('12')
  expect(button('保存设置').attributes('disabled')).toBeUndefined()
})

it('未连接和空缓存状态分开，重试失败读取后显示真实空态', async () => {
  vi.mocked(songCache.list).mockRejectedValueOnce(new ApiError(503, '缓存目录不可读取'))
  await page()
  expect(wrapper!.text()).toContain('缓存目录不可读取')
  expect(wrapper!.text()).toContain('缓存管理无需连接计算节点')
  expect(wrapper!.text()).not.toContain('前往性能节点配置')
  expect(wrapper!.text()).not.toContain('暂无歌曲缓存')
  vi.mocked(songCache.list).mockResolvedValueOnce({ ...structuredClone(original), items: [], totalElements: 0, entryCount: 0, usageBytes: 0 })
  await button('重试').trigger('click'); await flushPromises()
  expect(wrapper!.text()).toContain('暂无歌曲缓存')
  expect(button('清理缓存').attributes('disabled')).toBeDefined()
})

it('没有完整可复用条目但仍有磁盘占用时，允许清理旧缓存或损坏产物', async () => {
  vi.mocked(songCache.list).mockResolvedValue({ ...structuredClone(original), settings: { ...original.settings, policy: 'MANUAL' }, items: [], totalElements: 0, entryCount: 0, usageBytes: 128 * 1024 ** 2 })
  await page()
  expect(wrapper!.text()).toContain('暂无歌曲缓存')
  expect(button('清理缓存').attributes('disabled')).toBeUndefined()
  confirm()
  vi.mocked(songCache.clear).mockResolvedValue({ removed: 1, skipped: 0 })
  await button('清理缓存').trigger('click'); await flushPromises()
  expect(songCache.cleanup).toHaveBeenCalledWith({ mode: 'CLEAR' })
  expect(wrapper!.text()).toContain('已清理 1 份缓存')
})

it('分页交给服务端，删除末页最后一份缓存会回退有效页', async () => {
  vi.mocked(songCache.list).mockResolvedValue({ ...structuredClone(original), totalElements: 21 })
  await page()
  wrapper!.findComponent(ElPagination).vm.$emit('current-change', 2); await flushPromises()
  expect(songCache.list).toHaveBeenLastCalledWith(1, 20)
  vi.mocked(songCache.list).mockResolvedValue({ ...structuredClone(original), totalElements: 20 })
  confirm()
  await wrapper!.get('button[aria-label="删除合唱歌曲的缓存"]').trigger('click'); await flushPromises()
  expect(songCache.list).toHaveBeenLastCalledWith(0, 20)
})

it('离页和关闭浏览器时保护设置草稿，取消离页后继续编辑', async () => {
  await page()
  const guard = vi.mocked(onBeforeRouteLeave).mock.calls[0]![0] as () => Promise<boolean>
  expect(await guard()).toBe(true)
  await wrapper!.get('input[aria-label="最大缓存容量"]').setValue('12')
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  confirm().mockRejectedValueOnce('cancel')
  expect(await guard()).toBe(false)
  expect(wrapper!.get('input[aria-label="最大缓存容量"]').element).toHaveProperty('value', '12')
})

it('未知策略可读取与编辑，旧策略安全映射混合而不崩溃', async () => {
  vi.mocked(songCache.list).mockResolvedValue({ ...structuredClone(original), settings: { ...original.settings, policy: 'FUTURE_POLICY' } })
  await page()
  expect(wrapper!.text()).toContain('未知策略，请重新读取设置')
  expect(wrapper!.get('select[aria-label="缓存策略"]').element).toHaveProperty('value', 'HYBRID')
  await wrapper!.get('input[aria-label="最大缓存容量"]').setValue('12')
  await wrapper!.get('form').trigger('submit'); await flushPromises()
  expect(songCache.save).toHaveBeenCalledWith(expect.objectContaining({ policy: 'HYBRID', highWatermarkPercent: 90, lowWatermarkPercent: 75 }))
})

it('歌曲级固定展示保护并禁删，无缓存的固定歌曲仍可取消且携带修订', async () => {
  const value = structuredClone(original)
  value.items[0] = { ...value.items[0]!, pinned: true, pinRevision: 4, protectionReasons: ['PINNED'], H: .5, R: .8, F: .4, score: .6, priority: .8, lifecycle: 'HOT', playCount7d: 4 }
  vi.mocked(songCache.list).mockResolvedValue(value)
  vi.mocked(songCache.pins).mockResolvedValue({ items: [{ songId: 'future', title: '未来固定', pinned: true, revision: 7, hasCache: false }], page: 0, size: 20, totalElements: 1 })
  vi.mocked(songCache.pin).mockResolvedValue({ pinned: false, revision: 8 })
  await page()
  expect(wrapper!.text()).toContain('近 7 天有效 4 次')
  expect(wrapper!.text()).toContain('H 0.500 / R 0.800 / F 0.400')
  expect(wrapper!.get('button[aria-label="删除合唱歌曲的缓存"]').attributes('disabled')).toBeDefined()
  expect(wrapper!.get('[aria-label="固定的歌曲缓存"]').text()).toContain('尚无缓存')
  confirm(); await wrapper!.get('button[aria-label="取消固定未来固定"]').trigger('click'); await flushPromises()
  expect(songCache.pin).toHaveBeenCalledWith('future', false, 7)
  expect(songCache.cleanup).not.toHaveBeenCalled()
})

it('固定作用于歌曲而非单份缓存，新固定使用当前pinRevision', async () => {
  vi.mocked(songCache.pin).mockResolvedValue({ pinned: true, revision: 1 })
  await page(); const ask = confirm()
  await wrapper!.get('button[aria-label="固定合唱歌曲的缓存"]').trigger('click'); await flushPromises()
  expect(ask.mock.calls[0]![0]).toContain('以后产生的变体')
  expect(ask.mock.calls[0]![0]).toContain('不会强制下载整曲')
  expect(songCache.pin).toHaveBeenCalledWith('song1', true, 0)
})

it('近24小时单删必须明确确认，批量清理仍保护近期和固定', async () => {
  const value = structuredClone(original)
  value.items[0] = { ...value.items[0]!, protectionReasons: ['RECENT_PLAY'] }
  vi.mocked(songCache.list).mockResolvedValue(value)
  await page(); const ask = confirm()
  await wrapper!.get('button[aria-label="删除合唱歌曲的缓存"]').trigger('click'); await flushPromises()
  const dialog = wrapper!.getComponent(ElDialog)
  expect(dialog.text()).toContain('我确认覆盖近期播放保护，只删除这一份缓存')
  const remove = () => dialog.findAll('button').find(item => item.text() === '覆盖保护并删除')!
  expect(remove().attributes('disabled')).toBeDefined()
  expect(songCache.cleanup).not.toHaveBeenCalled()
  await dialog.getComponent(ElCheckbox).setValue(true)
  await remove().trigger('click'); await flushPromises()
  expect(songCache.cleanup).toHaveBeenCalledWith({ mode: 'DELETE', entryId: 'cache-video', confirmRecent: true })
  await button('清理缓存').trigger('click'); await flushPromises()
  expect(ask.mock.calls[0]![0]).toContain('固定、近 24 小时实际播放')
  expect(songCache.cleanup).toHaveBeenLastCalledWith({ mode: 'CLEAR' })
})

it('近期缓存取消删除不发请求，重新打开仍需重新勾选', async () => {
  const value = structuredClone(original)
  value.items[0]!.protectionReasons = ['RECENT_PLAY']
  vi.mocked(songCache.list).mockResolvedValue(value)
  await page()
  await wrapper!.get('button[aria-label="删除合唱歌曲的缓存"]').trigger('click'); await flushPromises()
  const dialog = wrapper!.getComponent(ElDialog)
  await dialog.getComponent(ElCheckbox).setValue(true)
  await dialog.findAll('button').find(item => item.text() === '保留缓存')!.trigger('click'); await flushPromises()
  expect(songCache.cleanup).not.toHaveBeenCalled()
  await wrapper!.get('button[aria-label="删除合唱歌曲的缓存"]').trigger('click'); await flushPromises()
  expect(dialog.getComponent(ElCheckbox).props('modelValue')).toBe(false)
  expect(dialog.findAll('button').find(item => item.text() === '覆盖保护并删除')!.attributes('disabled')).toBeDefined()
})

it('异步任务轮询显示保护阻塞，未达目标不误报空间不足', async () => {
  vi.useFakeTimers()
  vi.mocked(songCache.cleanup).mockResolvedValue({ ...completed, state: 'QUEUED', removed: 0 })
  vi.mocked(songCache.job).mockResolvedValue({ ...completed, state: 'BLOCKED', targetReached: false, skippedByReason: { PINNED: 2, RECENT_PLAY: 1 } })
  await page(); confirm(); await button('按策略回收').trigger('click'); await flushPromises()
  expect(wrapper!.text()).toContain('等待清理')
  expect(songCache.cleanup).toHaveBeenCalledWith({ mode: 'POLICY' })
  await vi.advanceTimersByTimeAsync(1000); await flushPromises()
  expect(wrapper!.text()).toContain('受保护数据阻止继续清理')
  expect(wrapper!.text()).toContain('未达到目标水位，当前仍有可用缓存空间')
  expect(wrapper!.text()).not.toContain('清理后空间仍不足')
  expect(wrapper!.text()).toContain('已固定：2 份')
  expect(wrapper!.text()).toContain('近 24 小时播放保护：1 份')
})

it('部分失败保留已释放结果并明确报告空间不足和错误', async () => {
  vi.mocked(songCache.cleanup).mockResolvedValue({ ...completed, state: 'PARTIAL', failed: 1, targetReached: false, spaceInsufficient: true, shortfallBytes: 2 * 1024 ** 3, errors: [{ id: 'cache', message: '目录不可写，索引已保留' }] })
  await page(); confirm(); await button('清理缓存').trigger('click'); await flushPromises()
  expect(wrapper!.text()).toContain('部分清理完成')
  expect(wrapper!.text()).toContain('释放 1 MiB')
  expect(wrapper!.text()).toContain('清理后空间仍不足，还需 2 GiB')
  expect(wrapper!.text()).toContain('目录不可写，索引已保留')
})

it('取消任务后的迟到RUNNING响应不能覆盖CANCELLING，随后可读最终取消', async () => {
  vi.useFakeTimers()
  let resolve!: (value: CleanupJob) => void
  vi.mocked(songCache.cleanup).mockResolvedValue({ ...completed, state: 'RUNNING' })
  vi.mocked(songCache.job).mockReturnValueOnce(new Promise(done => { resolve = done })).mockResolvedValue({ ...completed, state: 'CANCELLED' })
  vi.mocked(songCache.cancelJob).mockResolvedValue({ ...completed, state: 'CANCELLING' })
  await page(); confirm(); await button('清理缓存').trigger('click'); await flushPromises()
  await vi.advanceTimersByTimeAsync(1000)
  await button('取消清理').trigger('click'); await flushPromises()
  resolve({ ...completed, state: 'RUNNING' }); await flushPromises()
  expect(wrapper!.text()).toContain('正在取消')
  await vi.advanceTimersByTimeAsync(1000); await flushPromises()
  expect(wrapper!.text()).toContain('清理已取消')
  expect(songCache.cancelJob).toHaveBeenCalledWith('cleanup')
})

it('离开后不再轮询，重新进入可恢复当前任务并允许查询失败重试', async () => {
  vi.useFakeTimers(); sessionStorage.setItem('singverse.cache.cleanup', 'restored')
  vi.mocked(songCache.job).mockRejectedValueOnce(new Error('暂时不可读取')).mockResolvedValue({ ...completed, id: 'restored', state: 'RUNNING' })
  await page()
  expect(wrapper!.text()).toContain('暂时不可读取')
  await button('重试读取进度').trigger('click'); await flushPromises()
  // Failed restoration must retain the id for an explicit retry.
  expect(songCache.job).toHaveBeenLastCalledWith('restored')
  wrapper!.unmount(); wrapper = undefined
  const count = vi.mocked(songCache.job).mock.calls.length
  await vi.advanceTimersByTimeAsync(5000)
  expect(songCache.job).toHaveBeenCalledTimes(count)
})
