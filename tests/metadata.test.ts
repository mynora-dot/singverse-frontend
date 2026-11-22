// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { songManagementRoutes } from '../src/admin/modules/song-management/routes'
import MetadataScrapeView from '../src/admin/modules/metadata/views/MetadataScrapeView.vue'
import SingleSongScrapeDialog from '../src/admin/modules/metadata/components/SingleSongScrapeDialog.vue'
import { metadata } from '../src/admin/modules/metadata/api/metadata'
import { media } from '../src/admin/modules/media-library/api/media'
import { singleReview } from '../src/admin/modules/metadata/api/single-review'
import type { MetadataBatch, MetadataCandidate } from '../src/admin/modules/metadata/types'
vi.mock('../src/admin/modules/metadata/api/metadata', () => ({ metadata: Object.fromEntries(['settings', 'saveSettings', 'latest', 'batch', 'start', 'pause', 'resume', 'cancel', 'retry', 'search', 'candidateCover'].map(name => [name, vi.fn()])) }))
vi.mock('../src/admin/modules/media-library/api/media', () => ({ media: { list: vi.fn() } }))
vi.mock('../src/admin/modules/metadata/api/single-review', () => ({ singleReview: { load: vi.fn(), apply: vi.fn(), applyBatch: vi.fn(), lyrics: vi.fn().mockResolvedValue({ status: 'MISSING', lyrics: null }) } }))
let wrapper: VueWrapper
const config = { enabled: true, providers: ['NETEASE' as const], autoApply: false, threshold: .95, minIntervalSeconds: 3, maxIntervalSeconds: 8 }
const candidate: MetadataCandidate = { id: 'candidate-1', score: .95, track: { provider: 'NETEASE', externalId: '1', title: '晴天', artists: ['周杰伦'], album: '叶惠美', aliases: [], releaseDate: '2003-07-31', durationMs: 270000, coverUrl: null, availability: 'UNKNOWN', fetchedAt: '2026-10-28T00:00:00Z' } }
function batch(status = 'RUNNING'): MetadataBatch { return { id: 'batch-1', mode: 'SELECTED', status, total: 1, completed: 0, pending: 1, processing: 0, review: 0, applied: 0, failed: 0, skippedExisting: 0, autoApply: false, threshold: .95, createdAt: '', updatedAt: '', items: [], page: 0, size: 20, totalElements: 1 } }
function button(text: string) { return wrapper.findAll('button').find(item => item.text() === text)! }
async function page(path = '/library/songs/metadata') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/library/songs/metadata', component: MetadataScrapeView }, songManagementRoutes.find(route => route.path === '/library/review')!, { path: '/system/music-platforms', component: { template: '<div>音乐平台设置</div>' } }, { path: '/library/songs', component: { template: '<div>歌曲管理</div>' } }] })
  await router.push(path)
  wrapper = mount({ template: '<RouterView />' }, { global: { plugins: [router], stubs: { teleport: true } } })
  await flushPromises(); return router
}
beforeEach(() => {
  vi.mocked(media.list).mockResolvedValue({ items: [{ id: 'source-1', name: '家庭 NAS', type: 'WEBDAV', location: 'https://nas.example/dav/', username: '', passwordConfigured: false, parserProfileId: 'default', createdAt: '', updatedAt: '' }], page: 0, size: 100, totalElements: 1 })
  vi.mocked(metadata.settings).mockResolvedValue({ ...config })
  vi.mocked(metadata.latest).mockResolvedValue(undefined)
  vi.mocked(metadata.batch).mockResolvedValue(batch())
  vi.mocked(metadata.search).mockResolvedValue({ candidates: [candidate], errors: [] })
})
it('可选择指定媒体来源创建批次，确认文案与请求范围一致', async () => {
  vi.mocked(metadata.start).mockResolvedValue(batch())
  await page()
  await wrapper.get('select[aria-label="匹配歌曲来源"]').setValue('source-1')
  await button('开始匹配').trigger('click'); await flushPromises()
  expect(wrapper.get('.start-scope-options').text()).toContain('家庭 NAS')
  expect(metadata.start).not.toHaveBeenCalled()
  await button('确认开始匹配').trigger('click'); await flushPromises()
  expect(metadata.start).toHaveBeenCalledWith(true, [], 'source-1')
})
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = ''; vi.restoreAllMocks(); vi.clearAllMocks(); vi.useRealTimers() })
it('历史查询期间误标已应用的记录可重新匹配，正常应用记录不显示恢复入口', async () => {
  const item = { id: 'item-1', songId: 'song-1', title: '晴天', artists: ['周杰伦'], status: 'MANUAL_APPLIED' as const, candidates: [candidate], error: '查询期间歌曲已确认，保留已有歌曲资料', updatedAt: '', confidence: 'HIGH' as const }
  const recovered = { ...batch('COMPLETED'), completed: 2, pending: 0, applied: 2, items: [item, { ...item, id: 'item-2', error: null }], total: 2, totalElements: 2 }
  vi.mocked(metadata.latest).mockResolvedValue(recovered)
  vi.mocked(metadata.retry).mockResolvedValue(batch())
  await page()
  expect(wrapper.findAll('button').filter(item => item.text() === '重新匹配')).toHaveLength(1)
  await button('重新匹配').trigger('click'); await flushPromises()
  expect(metadata.retry).toHaveBeenCalledWith('batch-1', 'item-1')
})
it('平台关闭时阻止启动，管理入口转到设置并保留所选歌曲', async () => {
  vi.mocked(metadata.settings).mockResolvedValue({ ...config, enabled: false })
  const router = await page('/library/songs/metadata?songIds=a,b')
  expect((button('开始匹配').element as HTMLButtonElement).disabled).toBe(true)
  expect(wrapper.text()).toContain('设置 → 音乐平台')
  expect(wrapper.find('input[type=checkbox]').exists()).toBe(false)
  await wrapper.get('.platform-entry').trigger('click'); await flushPromises()
  expect(router.currentRoute.value.path).toBe('/system/music-platforms')
  expect(router.currentRoute.value.query.returnTo).toBe('/library/songs/metadata?songIds=a,b')
  expect(metadata.saveSettings).not.toHaveBeenCalled()
})
it('选中批次确认后提交所选歌曲，并显示持久化进度', async () => {
  vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as Awaited<ReturnType<typeof ElMessageBox.confirm>>)
  vi.mocked(metadata.start).mockResolvedValue(batch())
  const router = await page('/library/songs/metadata?songIds=a,b')
  await button('开始匹配').trigger('click'); await flushPromises()
  expect(wrapper.get('input[value=selected]').element).toHaveProperty('checked', true)
  await button('确认开始匹配').trigger('click'); await flushPromises()
  expect(metadata.start).toHaveBeenCalledWith(false, ['a', 'b'])
  expect(router.currentRoute.value.query.batch).toBe('batch-1')
  expect(wrapper.text()).toContain('正在匹配')
  expect(wrapper.text()).toContain('本批次自动写入：关闭')
})
it('暂停、继续和离开页面停止轮询', async () => {
  vi.useFakeTimers()
  vi.mocked(metadata.latest).mockResolvedValue(batch())
  vi.mocked(metadata.pause).mockResolvedValue(batch('PAUSED'))
  vi.mocked(metadata.batch).mockResolvedValueOnce(batch('PAUSED')).mockResolvedValue(batch())
  vi.mocked(metadata.resume).mockResolvedValue(batch())
  await page(); await button('暂停').trigger('click'); await flushPromises()
  expect(metadata.pause).toHaveBeenCalledWith('batch-1')
  await button('继续').trigger('click'); await flushPromises()
  expect(metadata.resume).toHaveBeenCalledWith('batch-1')
  wrapper.unmount(); const calls = vi.mocked(metadata.batch).mock.calls.length
  await vi.advanceTimersByTimeAsync(6000)
  expect(metadata.batch).toHaveBeenCalledTimes(calls)
})

it('批次审核复用单曲编辑工作区及批次候选', async () => {
  const item = { id: 'item-1', songId: 'song-1', title: '晴天', artists: ['周杰伦'], status: 'REVIEW' as const, candidates: [candidate], error: null, updatedAt: '', confidence: 'HIGH' as const }
  vi.mocked(metadata.latest).mockResolvedValue({ ...batch('COMPLETED'), completed: 1, pending: 0, review: 1, items: [item] })
  vi.mocked(singleReview.load).mockResolvedValue({ song: { id: 'song-1', sourceName: 'nas', relativePath: '晴天.mkv', fileSize: 1024, metadata: null } as never, fingerprint: 'fingerprint', version: 'version', values: { title: '晴天', artists: ['周杰伦'], album: null, releaseDate: null, aliases: [], durationMs: null, cover: null } })
  await page()
  await button('审核候选').trigger('click'); await flushPromises()
  expect(wrapper.findComponent(SingleSongScrapeDialog).props('presentation')).toBe('drawer')
  expect(wrapper.find('.drawer-candidate-select').exists()).toBe(true)
  expect(wrapper.get('.file-context h3').text()).toBe('晴天')
  expect(wrapper.text()).toContain('选中候选与应用预览')
  expect(wrapper.text()).toContain('编辑歌曲资料')
  expect(wrapper.text()).toContain('选择封面')
  expect(metadata.search).not.toHaveBeenCalled()
  vi.mocked(singleReview.applyBatch).mockResolvedValue({ metadata: null, updated: ['album'], skipped: [], retained: [], before: { title: '晴天', artists: ['周杰伦'], album: null, releaseDate: null, aliases: [], durationMs: null, cover: null }, after: { title: '晴天', artists: ['周杰伦'], album: '叶惠美', releaseDate: null, aliases: [], durationMs: null, cover: null } })
  await wrapper.findAll('button').find(item => item.text().includes('确认应用（'))!.trigger('click'); await flushPromises()
  expect(singleReview.applyBatch).toHaveBeenCalledWith('batch-1', 'item-1', expect.objectContaining({ candidateId: 'candidate-1', fields: expect.arrayContaining(['album']) }))
})

it('歌曲信息页只展示已保存的平台与间隔，不再内嵌配置表单', async () => {
  vi.mocked(metadata.settings).mockResolvedValue({ ...config, minIntervalSeconds: 10, maxIntervalSeconds: 20 })
  await page()
  expect(wrapper.get('.platform-entry').attributes('title')).toContain('间隔 10～20 秒')
  expect(wrapper.find('input[name="minIntervalSeconds"]').exists()).toBe(false)
  expect(metadata.saveSettings).not.toHaveBeenCalled()
})
it('歌曲信息页准确展示零秒等待配置', async () => {
  vi.mocked(metadata.settings).mockResolvedValue({ ...config, minIntervalSeconds: 0, maxIntervalSeconds: 0 })
  await page()
  expect(wrapper.get('.platform-entry').attributes('title')).toContain('间隔 0～0 秒')
})
it('运行批次保留整体进度并将平台配置交给设置页', async () => {
  vi.mocked(metadata.latest).mockResolvedValue({ ...batch(), total: 12, completed: 5, pending: 6, processing: 1, review: 2, skippedExisting: 3, processableTotal: 9, legacySkipped: 3, observedAt: '2026-10-28T00:00:00Z' })
  await page()
  expect(wrapper.get('.progress-caption').text()).toContain('5 / 12首已处理')
  expect(wrapper.get('[role=progressbar]').attributes('aria-valuenow')).toBe('42')
  expect(wrapper.find('#batch-settings-form').exists()).toBe(false)
  expect(wrapper.get('.platform-entry')).toBeDefined()
  expect(wrapper.text()).toContain('仅保存汇总')
  expect(wrapper.text()).toContain('最近读取')
})
it('5% 候选明确显示无可信匹配和核对入口，不能误呈现为高可信推荐', async () => {
  vi.mocked(metadata.latest).mockResolvedValue({ ...batch('COMPLETED'), total: 1, completed: 1, pending: 0, review: 1, items: [{ id: 'item-1', songId: 'song-1', title: '原歌名', artists: ['原歌手'], status: 'REVIEW', candidates: [{ ...candidate, score: .05 }], error: null, updatedAt: '', confidence: 'NONE', sourceId: 'source-1' }] })
  await page()
  expect(wrapper.get('.batch-song-table').text()).toContain('5%')
  expect(wrapper.get('.batch-song-table').text()).toContain('无可信候选')
  expect(wrapper.get('.batch-song-table').text()).toContain('低分候选仅供核对')
  expect(button('核对候选')).toBeDefined()
  expect(button('重新匹配')).toBeDefined()
  expect(wrapper.get('.batch-song-table').text()).not.toContain('审核候选')
  expect(singleReview.apply).not.toHaveBeenCalled()
})
it('状态快捷筛选、歌手搜索和排序提交给后端，而不是只过滤当前页', async () => {
  vi.mocked(metadata.latest).mockResolvedValue(batch('COMPLETED'))
  await page()
  await wrapper.get('select[aria-label="更多歌曲状态"]').setValue('SKIPPED_EXISTING'); await flushPromises()
  expect(metadata.batch).toHaveBeenLastCalledWith('batch-1', 0, 'SKIPPED_EXISTING', '', 'DEFAULT')
  await wrapper.get('input[aria-label="搜索批次歌名或歌手"]').setValue('歌手%')
  await wrapper.get('form[aria-label="批次歌曲筛选"]').trigger('submit'); await flushPromises()
  await wrapper.get('select[aria-label="批次排序"]').setValue('SCORE_DESC'); await flushPromises()
  expect(metadata.batch).toHaveBeenLastCalledWith('batch-1', 0, 'SKIPPED_EXISTING', '歌手%', 'SCORE_DESC')
})
it('从音乐平台设置返回指定批次时显示服务端暂停状态并提供继续', async () => {
  vi.mocked(metadata.batch).mockResolvedValue(batch('PAUSED'))
  await page('/library/songs/metadata?batch=batch-1')
  expect(button('继续')).toBeDefined()
  expect(wrapper.text()).toContain('批次已暂停')
  expect(metadata.saveSettings).not.toHaveBeenCalled()
})
it('终止确认说明未处理和已写入的真实语义，终止后不再显示续跑', async () => {
  vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as Awaited<ReturnType<typeof ElMessageBox.confirm>>)
  vi.mocked(metadata.latest).mockResolvedValue(batch())
  vi.mocked(metadata.cancel).mockResolvedValue(batch('CANCELLED'))
  vi.mocked(metadata.batch).mockResolvedValue(batch('CANCELLED'))
  await page(); await button('终止').trigger('click'); await flushPromises()
  expect(ElMessageBox.confirm).toHaveBeenCalledWith(expect.stringContaining('不会自动撤销'), '终止批次', expect.anything())
  expect(metadata.cancel).toHaveBeenCalledWith('batch-1')
  expect(wrapper.text()).toContain('已终止')
  expect(button('继续')).toBeUndefined()
})

it('重新进入指定批次恢复后端状态与筛选结果', async () => {
  vi.mocked(metadata.batch).mockResolvedValue({ ...batch('PAUSED'), total: 9, completed: 5, pending: 4, processing: 0, review: 2, applied: 0, failed: 0, skippedExisting: 3 })
  await page('/library/songs/metadata?batch=batch-1')
  expect(metadata.batch).toHaveBeenCalledWith('batch-1', 0, '', '', 'DEFAULT')
  expect(wrapper.get('.progress-caption').text()).toContain('5 / 9首已处理')
  expect(wrapper.get('[role=progressbar]').attributes('aria-valuenow')).toBe('56')
  expect(button('继续')).toBeDefined()
  expect(metadata.start).not.toHaveBeenCalled()
})

it('旧审核链接跳转到歌曲信息，保留批次、所选歌曲和锚点并筛选待审核', async () => {
  vi.mocked(metadata.batch).mockResolvedValue({ ...batch('COMPLETED'), pending: 0, totalElements: 0 })
  const router = await page('/library/review?batch=batch-1&songIds=a,b#song-a')
  expect(router.currentRoute.value.path).toBe('/library/songs/metadata')
  expect(router.currentRoute.value.query).toEqual({ batch: 'batch-1', songIds: 'a,b', status: 'REVIEW' })
  expect(router.currentRoute.value.hash).toBe('#song-a')
  expect(wrapper.get('h1').text()).toBe('歌曲信息')
  expect(wrapper.get('button[data-status=REVIEW]').attributes('aria-pressed')).toBe('true')
  expect(metadata.batch).toHaveBeenCalledWith('batch-1', 0, 'REVIEW', '', 'DEFAULT')
  expect(metadata.start).not.toHaveBeenCalled()
})

it('待审核为零仍可筛选，空态返回全部歌曲并保留批次与选择上下文', async () => {
  const completed = { ...batch('COMPLETED'), completed: 1, pending: 0, applied: 1 }
  vi.mocked(metadata.batch).mockResolvedValue(completed)
  const router = await page('/library/songs/metadata?batch=batch-1&songIds=a,b')
  const reviewFilter = wrapper.get('button[data-status=REVIEW]')
  expect(reviewFilter.text()).toBe('待审核 0')
  await reviewFilter.trigger('click'); await flushPromises()
  expect(router.currentRoute.value.query.status).toBe('REVIEW')
  expect(wrapper.text()).toContain('当前没有待审核歌曲')
  expect(metadata.batch).toHaveBeenLastCalledWith('batch-1', 0, 'REVIEW', '', 'DEFAULT')
  await wrapper.get('.batch-list-empty button').trigger('click'); await flushPromises()
  expect(router.currentRoute.value.query).toEqual({ batch: 'batch-1', songIds: 'a,b' })
  expect(wrapper.get('button[data-status=ALL]').attributes('aria-pressed')).toBe('true')
  expect(metadata.batch).toHaveBeenLastCalledWith('batch-1', 0, '', '', 'DEFAULT')
})

it('浏览器返回状态查询时同步列表，未知状态回到全部', async () => {
  vi.mocked(metadata.batch).mockResolvedValue(batch('COMPLETED'))
  const router = await page('/library/songs/metadata?batch=batch-1&status=FAILED')
  await router.push('/library/songs/metadata?batch=batch-1&status=REVIEW'); await flushPromises()
  expect(wrapper.get('button[data-status=REVIEW]').attributes('aria-pressed')).toBe('true')
  expect(metadata.batch).toHaveBeenLastCalledWith('batch-1', 0, 'REVIEW', '', 'DEFAULT')
  await router.push('/library/songs/metadata?batch=batch-1&status=UNKNOWN'); await flushPromises()
  expect(wrapper.get('button[data-status=ALL]').attributes('aria-pressed')).toBe('true')
  expect(metadata.batch).toHaveBeenLastCalledWith('batch-1', 0, '', '', 'DEFAULT')
  expect(metadata.start).not.toHaveBeenCalled()
})




it('95% 同分候选展示高相似度及接近候选提示，不误标为低可信', async () => {
  vi.mocked(metadata.latest).mockResolvedValue({ ...batch('COMPLETED'), completed: 1, pending: 0, review: 1, items: [{ id: 'item-1', songId: 'song-1', title: '晴天', artists: ['周杰伦'], status: 'REVIEW', candidates: [candidate, { ...candidate, id: 'second' }], error: null, updatedAt: '', confidence: 'LOW' }] })
  await page()
  expect(wrapper.get('.batch-song-table').text()).toContain('高相似度 · 待确认')
  expect(wrapper.get('.batch-song-table').text()).toContain('多个接近候选')
  expect(wrapper.get('.batch-song-table').text()).not.toContain('未达到高相似度阈值')
  expect(singleReview.applyBatch).not.toHaveBeenCalled()
})


it('曲库所选歌曲以待开始状态为主体，旧批次默认收起且明确标记时间', async () => {
  vi.mocked(metadata.latest).mockResolvedValue({ ...batch('COMPLETED'), total: 31, completed: 31, applied: 31, createdAt: '2026-11-19T12:00:00Z' })
  await page('/library/songs/metadata?songIds=a,b')
  expect(wrapper.get('[aria-label="本次选择"]').text()).toContain('已选择 2 首歌曲，尚未开始本次匹配')
  expect(wrapper.get('.source-toolbar').text()).toContain('下一次匹配范围曲库所选 2 首歌曲')
  expect(wrapper.find('.batch-summary').exists()).toBe(false)
  expect(wrapper.find('.batch-list-card').exists()).toBe(false)
  expect(metadata.start).not.toHaveBeenCalled()
  await button('查看上一次匹配结果').trigger('click'); await flushPromises()
  expect(wrapper.get('.batch-context').text()).toContain('上一次匹配结果')
  expect(wrapper.get('.batch-context').text()).toContain('2026')
  expect(wrapper.get('.progress-caption').text()).toContain('31 / 31')
  await button('开始匹配').trigger('click'); await flushPromises()
  expect(wrapper.get('input[value=selected]').element).toHaveProperty('checked', true)
})

it('当前有运行批次时仍可从所选歌曲上下文展开查看，阻止并行启动', async () => {
  vi.mocked(metadata.latest).mockResolvedValue(batch())
  await page('/library/songs/metadata?songIds=a')
  expect(button('开始匹配').attributes('disabled')).toBeDefined()
  expect(wrapper.text()).toContain('已有运行或暂停的批次')
  await button('查看上一次匹配结果').trigger('click'); await flushPromises()
  expect(button('暂停')).toBeDefined()
  expect(metadata.start).not.toHaveBeenCalled()
})
