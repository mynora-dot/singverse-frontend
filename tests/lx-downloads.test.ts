// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ElCheckbox, ElDialog, ElMessageBox } from 'element-plus'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import DownloadsView from '../src/admin/modules/lx-downloads/DownloadsView.vue'
import RecordsPanel from '../src/admin/modules/lx-downloads/RecordsPanel.vue'
import SourcesDialog from '../src/admin/modules/lx-downloads/SourcesDialog.vue'
import TrackPicker from '../src/admin/modules/lx-downloads/TrackPicker.vue'
import { lx, type Batch, type Item, type LxSource, type Status, type Track, type SearchResult } from '../src/admin/modules/lx-downloads/api'
import { media } from '../src/admin/modules/media-library/api/media'

vi.mock('../src/admin/modules/lx-downloads/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/admin/modules/lx-downloads/api')>()
  return { ...actual, lx: Object.fromEntries(Object.keys(actual.lx).map(key => [key, vi.fn()])) }
})
vi.mock('../src/admin/modules/media-library/api/media', () => ({ media: { list: vi.fn(), save: vi.fn() } }))
const source: LxSource = { id: 'script', name: '我的音源', version: '1', environment: 'mobile', createdAt: '', active: true, capabilities: { wy: ['flac', '128k'], tx: ['128k'] } }
const status = (): Status => ({ ready: true, target: { id: 'local', name: '下载曲库', path: '/downloads', ready: true, reason: '' }, activeSource: source, platforms: {}, activeBatches: 0 })
const track = (id = 'a', extra: Partial<Track> = {}): Track => ({ id, platform: 'wy', title: `歌曲${id}`, artists: ['歌手'], album: '专辑', durationMs: 180000, coverUrl: '', inLibrary: false, downloading: false, songId: null, ...extra })
const batch = (state = 'RUNNING'): Batch => ({ id: 'batch', name: '测试批次', sourceId: 'local', scriptId: 'script', path: '/downloads', quality: 'auto', status: state, counts: state === 'RUNNING' ? { DOWNLOADING: 1 } : state === 'FAILED' ? { FAILED: 1 } : { SUCCESS: 1 }, total: 1, createdAt: '2026-11-09T01:00:00Z', updatedAt: '' })
let wrapper: VueWrapper | undefined, router: Router
beforeEach(async () => {
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/library/downloads', component: { template: '<div />' } }, { path: '/library/media', component: { template: '<div />' } }] })
  await router.push('/library/downloads')
  vi.mocked(lx.status).mockResolvedValue(status())
  vi.mocked(lx.search).mockResolvedValue({ tracks: [track()], errors: [], warnings: [], page: 1, hasMore: false })
  vi.mocked(lx.batches).mockResolvedValue({ items: [], total: 0, page: 0, size: 20 })
  vi.mocked(lx.items).mockResolvedValue({ items: [], total: 0, page: 0, size: 20 })
  vi.mocked(lx.batch).mockResolvedValue(batch())
  vi.mocked(lx.sources).mockResolvedValue([source])
  vi.mocked(lx.create).mockResolvedValue({ batch: batch(), merged: 0, relatedBatchIds: [] })
  vi.mocked(lx.trackStates).mockResolvedValue([track('a', { inLibrary: true, songId: 'song' })])
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined; document.body.innerHTML = ''; vi.clearAllMocks(); vi.restoreAllMocks(); vi.useRealTimers() })
async function page() { wrapper = mount(DownloadsView, { global: { plugins: [router], stubs: { teleport: true, SourcesDialog: true, RecordsPanel: { template: '<div />', methods: { refresh: vi.fn() } } } } }); await flushPromises(); return wrapper }
const button = (text: string) => wrapper!.findAll('button').find(b => b.text() === text)!
async function search() { await wrapper!.get('input[aria-label="歌名或歌手"]').setValue('测试'); await wrapper!.get('.search-form').trigger('submit'); await flushPromises() }

it('目录和音源缺失时禁用找歌，配置入口保持可用', async () => {
  vi.mocked(lx.status).mockResolvedValue({ ...status(), ready: false, target: { id: null, name: null, path: null, ready: false, reason: '尚未设置' }, activeSource: null })
  await page()
  expect(button('搜索').attributes('disabled')).toBeDefined()
  expect(button('设置下载目录').attributes('disabled')).toBeUndefined()
  expect(button('导入并启用音源').attributes('disabled')).toBeUndefined()
  expect(wrapper!.text()).toContain('已有下载记录仍可查看')
  expect(lx.search).not.toHaveBeenCalled()
})
it('目录失效显示检查挂载提示，选择新目录显示原位置并保留写入错误', async () => {
  vi.mocked(lx.status).mockResolvedValue({ ...status(), ready: false, target: { ...status().target, ready: false, reason: '下载目录不可写，请检查 NAS 挂载' } })
  vi.mocked(media.list).mockResolvedValue({ items: [{ id: 'local', name: '新目录', type: 'LOCAL', location: '/new-downloads', parserProfileId: 'default' }], page: 0, size: 100, totalElements: 1 } as never)
  vi.mocked(media.save).mockRejectedValue(new Error('原保存位置仍有下载任务'))
  await page(); expect(wrapper!.text()).toContain('检查 NAS 挂载')
  await button('更改保存位置').trigger('click'); await flushPromises()
  expect(wrapper!.text()).toContain('原保存位置：/downloads'); expect(wrapper!.text()).toContain('新保存位置：/new-downloads')
  await button('保存位置').trigger('click'); await flushPromises()
  expect(media.save).toHaveBeenCalledWith(expect.objectContaining({ useForLxDownloads: true, location: '/new-downloads' }), 'local')
  expect(wrapper!.text()).toContain('原保存位置仍有下载任务')
})
it('保留部分平台结果、版本和失败提示，批量确认显示数量位置和可用音质', async () => {
  vi.mocked(lx.search).mockResolvedValue({ tracks: [track('a'), track('b', { platform: 'tx' })], errors: [{ platform: 'kg', message: '平台暂不可用' }], warnings: [], page: 1, hasMore: false })
  await page(); await search()
  expect(wrapper!.text()).toContain('平台暂不可用'); expect(wrapper!.findAll('.track')).toHaveLength(2)
  await wrapper!.findAllComponents(ElCheckbox)[0]!.get('input').setValue(true)
  await button('下载所选').trigger('click'); await flushPromises()
  const confirm = wrapper!.findAllComponents(ElDialog).find(c => c.props('title') === '确认下载')!
  expect(confirm.text()).toContain('2 首歌曲'); expect(confirm.text()).toContain('/downloads')
  const select = confirm.get('select[aria-label="下载音质"]'); expect(select.element).toHaveProperty('value', 'auto')
  expect(select.findAll('option').map(o => o.attributes('value'))).toEqual(['auto', '128k'])
  await select.setValue('128k'); await button('开始下载').trigger('click'); await flushPromises()
  expect(lx.create).toHaveBeenCalledWith(['a', 'b'], '128k', undefined)
  expect(wrapper!.findAll('.track')).toHaveLength(2); expect(wrapper!.text()).toContain('已提交 2 首歌曲')
})
it('指定音质失败保留确认框和歌曲选择', async () => {
  vi.mocked(lx.create).mockRejectedValueOnce(new Error('该音质不可用，请更换音源'))
  await page(); await search(); await button('下载').trigger('click'); await flushPromises()
  await button('开始下载').trigger('click'); await flushPromises()
  expect(wrapper!.text()).toContain('该音质不可用'); expect(button('开始下载').exists()).toBe(true)
})
it('提交下载后定位到该批次的实时进度，保留原搜索结果', async () => {
  await page(); await search(); await button('下载').trigger('click'); await flushPromises()
  await button('开始下载').trigger('click'); await flushPromises()
  expect(router.currentRoute.value.query).toMatchObject({ tab: 'records', batch: 'batch' })
  expect(wrapper!.get('#tab-records').attributes('aria-selected')).toBe('true')
  await wrapper!.get('#tab-search').trigger('click'); await flushPromises()
  expect(wrapper!.findAll('.track')).toHaveLength(1)
})
it('链接预览逐页读取，重复页停止并保留已读歌曲', async () => {
  const preview = { platform: 'wy', kind: 'album' as const, name: '我的专辑', coverUrl: '', tracks: [track('a')], page: 1, total: 30, hasMore: true, warning: '平台仅公开部分歌曲' }
  vi.mocked(lx.preview).mockResolvedValueOnce(preview).mockResolvedValueOnce({ ...preview, page: 2 })
  await page(); await wrapper!.get('#tab-preview').trigger('click')
  await wrapper!.get('input[aria-label="歌单或专辑分享链接"]').setValue('https://music.163.com/album?id=123')
  await wrapper!.get('.link-form').trigger('submit'); await flushPromises()
  expect(wrapper!.text()).toContain('已读取 1 / 30 首'); expect(wrapper!.text()).toContain('平台仅公开部分歌曲')
  await button('继续读取歌曲').trigger('click'); await flushPromises()
  expect(wrapper!.text()).toContain('平台未返回新的歌曲'); expect(wrapper!.findAll('.track')).toHaveLength(1)
  expect(lx.preview).toHaveBeenLastCalledWith('https://music.163.com/album?id=123', 2, expect.any(AbortSignal))
})
it('配置改变后忽略迟到的搜索响应', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof lx.search>>) => void
  vi.mocked(lx.search).mockReturnValue(new Promise(r => { resolve = r }))
  await page(); await search()
  vi.mocked(lx.status).mockResolvedValue({ ...status(), activeSource: { ...source, id: 'replacement' } })
  await button('刷新状态').trigger('click'); await flushPromises()
  expect(vi.mocked(lx.search).mock.calls.every(call => call[3]?.aborted)).toBe(true)
  resolve({ tracks: [track('late')], errors: [], warnings: [], page: 1, hasMore: false }); await flushPromises()
  expect(wrapper!.text()).not.toContain('歌曲late')
})

it('下载搜索按平台并行，快结果可下载，慢结果不回退下载状态', async () => {
  let quick!: (value: SearchResult) => void, late!: (value: SearchResult) => void
  const first = new Promise<SearchResult>(resolve => { quick = resolve }), second = new Promise<SearchResult>(resolve => { late = resolve })
  vi.mocked(lx.search).mockImplementation((_query, platform) => platform === 'wy' ? first : second)
  await page(); await search()
  expect(lx.search).toHaveBeenCalledTimes(2)
  expect(vi.mocked(lx.search).mock.calls.map(call => call[1])).toEqual(['wy', 'tx'])
  quick({ tracks: [track('fast')], errors: [], warnings: [], page: 1, hasMore: false }); await flushPromises()
  expect(wrapper!.text()).toContain('1 / 2 个平台')
  expect(wrapper!.findAll('.track')).toHaveLength(1)
  await button('下载').trigger('click'); await flushPromises()
  await button('开始下载').trigger('click'); await flushPromises()
  expect(wrapper!.find('.track .state').text()).toBe('下载中')
  late({ tracks: [track('late', { platform: 'tx' })], errors: [], warnings: [], page: 1, hasMore: false }); await flushPromises()
  expect(wrapper!.findAll('.track')).toHaveLength(2)
  expect(wrapper!.findAll('.track').find(row => row.text().includes('歌曲fast'))!.text()).toContain('下载中')
  expect(wrapper!.text()).not.toContain('1 / 2 个平台')
})

it('继续读取只查询仍有下一页的平台', async () => {
  vi.mocked(lx.search).mockImplementation(async (_query, p, page = 1) => ({ tracks: [track(`${p}-${page}`, { platform: p })], errors: [], warnings: [], page, hasMore: p === 'wy' && page === 1 }))
  await page(); await search()
  await button('继续读取搜索结果').trigger('click'); await flushPromises()
  expect(lx.search).toHaveBeenCalledTimes(3)
  expect(lx.search).toHaveBeenLastCalledWith('测试', 'wy', 2, expect.any(AbortSignal))
  expect(wrapper!.findAll('.track')).toHaveLength(3)
  expect(wrapper!.text()).not.toContain('继续读取搜索结果')
})

it('平台失败后继续读取会重试该平台原页，并保留已选歌曲', async () => {
  let txCalls = 0
  vi.mocked(lx.search).mockImplementation(async (_query, p, page = 1) => p === 'tx' && txCalls++ === 0
    ? { tracks: [], errors: [{ platform: p, message: '暂不可用' }], warnings: [], page, hasMore: false }
    : { tracks: [track(`${p}-${page}`, { platform: p })], errors: [], warnings: [], page, hasMore: false })
  await page(); await search()
  await wrapper!.get('.track input[type="checkbox"]').setValue(true)
  await button('继续读取搜索结果').trigger('click'); await flushPromises()
  expect(lx.search).toHaveBeenLastCalledWith('测试', 'tx', 1, expect.any(AbortSignal))
  expect(wrapper!.get('.track input[type="checkbox"]').element).toHaveProperty('checked', true)
  expect(wrapper!.findAll('.track')).toHaveLength(2)
})

it('离开下载页会取消平台请求并忽略迟到结果', async () => {
  let late!: (value: SearchResult) => void
  vi.mocked(lx.search).mockReturnValue(new Promise(resolve => { late = resolve }))
  await page(); await search()
  const signals = vi.mocked(lx.search).mock.calls.map(call => call[3]!)
  wrapper!.unmount(); wrapper = undefined
  expect(signals.every(signal => signal.aborted)).toBe(true)
  late({ tracks: [track('late')], errors: [], warnings: [], page: 1, hasMore: false }); await flushPromises()
  expect(lx.create).not.toHaveBeenCalled()
})
it('选择已读取歌曲跳过正在下载和已入库项目', async () => {
  wrapper = mount(TrackPicker, { props: { tracks: [track('a'), track('b', { downloading: true }), track('c', { inLibrary: true, songId: 'song' })], selected: [] } })
  await wrapper.findAllComponents(ElCheckbox)[0]!.get('input').setValue(true)
  expect(wrapper.emitted('update:selected')?.[0]).toEqual([['a']])
  expect(wrapper.get('a').attributes('href')).toContain('detailSongId=song')
})
it('任务完成后停止轮询，隐藏和卸载时忽略迟到响应', async () => {
  vi.useFakeTimers()
  vi.mocked(lx.batches).mockResolvedValueOnce({ items: [batch()], total: 1, page: 0, size: 20 }).mockResolvedValue({ items: [batch('COMPLETED')], total: 1, page: 0, size: 20 })
  wrapper = mount(RecordsPanel, { props: { visible: true, status: status() }, global: { plugins: [router] } }); await flushPromises()
  await vi.advanceTimersByTimeAsync(2600); await flushPromises(); expect(lx.batches).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(10000); expect(lx.batches).toHaveBeenCalledTimes(2)
  let resolve!: (value: Awaited<ReturnType<typeof lx.batches>>) => void
  vi.mocked(lx.batches).mockReturnValue(new Promise(r => { resolve = r })); await button('刷新记录').trigger('click')
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true); document.dispatchEvent(new Event('visibilitychange'))
  resolve({ items: [batch('FAILED')], total: 1, page: 0, size: 20 }); await flushPromises(); expect(wrapper.text()).not.toContain('失败 / 中断 1')
  wrapper.unmount(); wrapper = undefined; await vi.advanceTimersByTimeAsync(10000); expect(lx.batches).toHaveBeenCalledTimes(3)
})
it('下载记录自动展开活动批次，按秒刷新单曲字节与百分比，完成后停止轮询', async () => {
  vi.useFakeTimers()
  const item: Item = { id: 'item', track: track(), status: 'DOWNLOADING', requestedQuality: 'auto', resolvedQuality: '128k', receivedBytes: 1024 ** 2, totalBytes: 4 * 1024 ** 2, songId: null, message: '' }
  vi.mocked(lx.batches).mockResolvedValue({ items: [batch()], total: 1, page: 0, size: 20 })
  vi.mocked(lx.items).mockResolvedValue({ items: [item], total: 1, page: 0, size: 20 })
  wrapper = mount(RecordsPanel, { props: { visible: true, status: status() }, global: { plugins: [router] } }); await flushPromises()
  expect(lx.items).toHaveBeenCalledWith('batch', 0)
  expect(wrapper.get('.item-progress [role="progressbar"]').attributes('aria-valuenow')).toBe('25')
  expect(wrapper.get('.item-progress').text()).toContain('1.0 MiB / 4.0 MiB')
  vi.mocked(lx.items).mockResolvedValue({ items: [{ ...item, receivedBytes: 3 * 1024 ** 2 }], total: 1, page: 0, size: 20 })
  await vi.advanceTimersByTimeAsync(1000); await flushPromises()
  expect(wrapper.get('.item-progress [role="progressbar"]').attributes('aria-valuenow')).toBe('75')
  vi.mocked(lx.batches).mockResolvedValue({ items: [batch('COMPLETED')], total: 1, page: 0, size: 20 })
  vi.mocked(lx.items).mockResolvedValue({ items: [{ ...item, status: 'SUCCESS', receivedBytes: item.totalBytes!, songId: 'song' }], total: 1, page: 0, size: 20 })
  await vi.advanceTimersByTimeAsync(1000); await flushPromises()
  const calls = vi.mocked(lx.items).mock.calls.length
  expect(wrapper.find('.item-progress').exists()).toBe(false)
  await vi.advanceTimersByTimeAsync(5000)
  expect(lx.items).toHaveBeenCalledTimes(calls)
})
it('未知文件大小显示已传字节和不定进度，不编造百分比', async () => {
  vi.mocked(lx.batches).mockResolvedValue({ items: [batch()], total: 1, page: 0, size: 20 })
  vi.mocked(lx.items).mockResolvedValue({ items: [{ id: 'item', track: track(), status: 'DOWNLOADING', requestedQuality: 'auto', resolvedQuality: '128k', receivedBytes: 2 * 1024 ** 2, totalBytes: null, songId: null, message: '' }], total: 1, page: 0, size: 20 })
  wrapper = mount(RecordsPanel, { props: { visible: true, status: status() }, global: { plugins: [router] } }); await flushPromises()
  const progress = wrapper.get('.item-progress')
  expect(progress.text()).toContain('2.0 MiB')
  expect(progress.get('[role="progressbar"]').attributes('aria-valuenow')).toBeUndefined()
  expect(progress.text()).not.toContain('%')
})
it('重试和取消使用业务接口，并显示歌曲记录及深链接', async () => {
  vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
  vi.mocked(lx.batches).mockResolvedValue({ items: [batch('FAILED')], total: 1, page: 0, size: 20 })
  vi.mocked(lx.retry).mockResolvedValue({ batch: batch(), merged: 0, relatedBatchIds: [] })
  vi.mocked(lx.items).mockResolvedValue({ items: [{ id: 'item', track: track(), status: 'SUCCESS', requestedQuality: 'auto', resolvedQuality: '128k', receivedBytes: 1000, totalBytes: 1000, songId: 'saved-song', message: '封面获取失败，可稍后补充' }], total: 1, page: 0, size: 20 })
  wrapper = mount(RecordsPanel, { props: { visible: true, status: status() }, global: { plugins: [router] } }); await flushPromises()
  vi.mocked(lx.batches).mockResolvedValue({ items: [batch()], total: 1, page: 0, size: 20 })
  await button('重试未完成歌曲').trigger('click'); await flushPromises()
  expect(lx.retry).toHaveBeenCalledWith('batch'); expect(ElMessageBox.confirm).toHaveBeenCalledWith(expect.stringContaining('/downloads'), '重新尝试下载', expect.anything())
  expect(wrapper.text()).toContain('封面获取失败'); expect(wrapper.get('a').attributes('href')).toContain('detailSongId=saved-song')
  await button('取消未完成项目').trigger('click'); await flushPromises(); expect(lx.cancel).toHaveBeenCalledWith('batch')
})
it('HTTPS 导入默认 mobile，导入并启用后清除地址', async () => {
  vi.mocked(lx.importSource).mockResolvedValue(source)
  wrapper = mount(SourcesDialog, { props: { modelValue: false }, global: { stubs: { teleport: true } } }); await wrapper.setProps({ modelValue: true }); await flushPromises()
  await button('HTTPS 链接').trigger('click'); await wrapper.get('input[type="url"]').setValue('https://example.com/source.js?token=fixture')
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(lx.importSource).toHaveBeenCalledWith({ name: '', url: 'https://example.com/source.js?token=fixture', environment: 'mobile' }); expect(lx.activate).toHaveBeenCalledWith('script')
  expect(wrapper.get('input[type="url"]').element).toHaveProperty('value', '')
})
it('拒绝非 js 文件，关闭音源窗口后忽略迟到的文件读取', async () => {
  wrapper = mount(SourcesDialog, { props: { modelValue: false }, global: { stubs: { teleport: true } } }); await wrapper.setProps({ modelValue: true }); await flushPromises()
  const input = wrapper.get('input[type="file"]'); Object.defineProperty(input.element, 'files', { configurable: true, value: [{ name: 'bad.txt', size: 3 }] }); await input.trigger('change'); expect(wrapper.text()).toContain('不超过 9 MB 的 .js')
  let resolve!: (value: ArrayBuffer) => void
  Object.defineProperty(input.element, 'files', { configurable: true, value: [{ name: 'source.js', size: 3, arrayBuffer: () => new Promise(r => { resolve = r }) }] }); await input.trigger('change'); await wrapper.setProps({ modelValue: false }); resolve(new TextEncoder().encode('lx;').buffer); await flushPromises(); await wrapper.setProps({ modelValue: true }); await flushPromises()
  expect(wrapper.text()).not.toContain('source.js'); expect(lx.importSource).not.toHaveBeenCalled()
})

it('只展示音源支持的平台，汽水可搜索、查看封面并选择声明的音质', async () => {
  vi.mocked(lx.status).mockResolvedValue({ ...status(), activeSource: { ...source, capabilities: { qs: ['flac', '320k', '256k', '128k', '64k', '32k'] } } })
  vi.mocked(lx.search).mockResolvedValue({ tracks: [track('qishui', { platform: 'qs', coverUrl: 'https://p3-luna.douyinpic.com/img/cover.image' })], errors: [], warnings: [], page: 1, hasMore: false })
  await page()
  const chips = wrapper!.findAll('[aria-label="搜索平台"] [role="radio"]')
  expect(chips).toHaveLength(2)
  expect(chips[1]!.text()).toBe('汽水音乐')
  await chips[0]!.trigger('keydown', { key: 'ArrowRight' }); expect(chips[1]!.attributes('aria-checked')).toBe('true'); await search()
  expect(lx.search).toHaveBeenLastCalledWith('测试', 'qs', 1, expect.any(AbortSignal))
  expect(wrapper!.get('.track .artwork img').attributes('src')).toContain('cover.image')
  await button('下载').trigger('click'); await flushPromises()
  const confirm = wrapper!.findAllComponents(ElDialog).find(c => c.props('title') === '确认下载')!
  expect(confirm.get('select[aria-label="下载音质"]').findAll('option').map(o => o.attributes('value'))).toEqual(['auto', 'flac', '320k', '256k', '128k', '64k', '32k'])
})
it('导入页支持独立链接，并跟随路由切换工作区', async () => {
  await router.replace('/library/downloads?tab=preview'); await page()
  expect(wrapper!.get('#tab-preview').attributes('aria-selected')).toBe('true')
  expect(wrapper!.text()).toContain('汽水支持公开歌单')
  await router.replace('/library/downloads?tab=records'); await flushPromises()
  expect(wrapper!.get('#tab-records').attributes('aria-selected')).toBe('true')
  await router.replace('/library/downloads'); await flushPromises()
  expect(wrapper!.get('#tab-search').attributes('aria-selected')).toBe('true')
})
it('下载记录按当前页真实状态筛选，保留失败原因和重试入口', async () => {
  vi.mocked(lx.batches).mockResolvedValue({ items: [{ ...batch('FAILED'), id: 'failed', name: '失败批次' }, { ...batch('COMPLETED'), id: 'done', name: '完成批次' }], total: 2, page: 0, size: 20 })
  wrapper = mount(RecordsPanel, { props: { visible: true, status: status() }, global: { plugins: [router] } }); await flushPromises()
  const filters = wrapper.findAll('[aria-label="下载记录筛选"] button')
  await filters[3]!.trigger('click')
  expect(wrapper.findAll('.batch')).toHaveLength(1)
  expect(wrapper.get('.batch').text()).toContain('失败批次')
  expect(button('重试未完成歌曲').exists()).toBe(true)
  await filters[2]!.trigger('click')
  expect(wrapper.get('.batch').text()).toContain('完成批次')
  expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('1')
})
it('重新测试音源后刷新能力列表和主页面状态', async () => {
  vi.mocked(lx.test).mockResolvedValue({ message: '初始化成功' })
  wrapper = mount(SourcesDialog, { props: { modelValue: false }, global: { stubs: { teleport: true } } }); await wrapper.setProps({ modelValue: true }); await flushPromises()
  await button('测试').trigger('click'); await flushPromises()
  expect(lx.test).toHaveBeenCalledWith('script')
  expect(lx.sources).toHaveBeenCalledTimes(2)
  expect(wrapper.emitted('changed')).toHaveLength(1)
})
