// @vitest-environment jsdom
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { acceptedUpload, packageUploads } from '../src/admin/modules/media-library/package-uploads'
import { displayWebDavLocation } from '../src/admin/modules/media-library/webdav-location'
import ShareImportPanel from '../src/admin/modules/media-library/components/ShareImportPanel.vue'
import { shareImports, type ShareImportJob } from '../src/admin/modules/media-library/api/shareImports'
import type { MediaSource } from '../src/admin/modules/media-library/types'
vi.mock('../src/admin/modules/media-library/api/shareImports', async original => ({
  ...await original<typeof import('../src/admin/modules/media-library/api/shareImports')>(),
  shareImports: { latest: vi.fn(), get: vi.fn(), upload: vi.fn(), mapping: vi.fn(), action: vi.fn(), differences: vi.fn() },
}))
const source: MediaSource = { id: 'mine', name: '自己的曲库', type: 'WEBDAV', location: 'https://my.example.invalid/dav/我的曲库/', username: '', passwordConfigured: false, parserProfileId: 'default', createdAt: '', updatedAt: '' }
const job = (state: string): ShareImportJob => ({ id: 'job', state, phase: state, totalCount: 2, processedCount: 0, addedCount: 0, updatedCount: 0, preservedCount: 0, unchangedCount: 0, verifiedCount: 0, presentCount: 0, missingCount: 0, mismatchCount: 0, unreachableCount: 0, removePrefix: '', addPrefix: '', preview: { total: 2, newSongs: 1, existingSongs: 1 }, samples: [{ originalPath: '旧目录/歌 曲.mkv', relativePath: '旧目录/歌 曲.mkv', mediaURL: 'https://my.example.invalid/dav/我的曲库/旧目录/歌 曲.mkv' }] })
let wrapper: VueWrapper
beforeEach(() => { vi.resetAllMocks(); packageUploads.clear(); acceptedUpload.value = undefined; vi.mocked(shareImports.latest).mockResolvedValue({} as ShareImportJob) })
afterEach(() => { wrapper?.unmount(); vi.useRealTimers() })
const button = (text: string) => wrapper.findAll('button').find(item => item.text() === text)!
it('业务结束后继续观察独立清理，不重新导入，并说明仅路径核验', async () => {
  vi.useFakeTimers()
  vi.mocked(shareImports.get).mockResolvedValueOnce({ ...job('SUCCEEDED'), inputState: 'PENDING', pathOnlyCount: 1 })
  vi.mocked(shareImports.get).mockResolvedValue({ ...job('SUCCEEDED'), inputState: 'RELEASED', pathOnlyCount: 1 })
  wrapper = mount(ShareImportPanel, { props: { source, jobId: 'job' } }); await flushPromises()
  expect(wrapper.text()).toContain('临时资料包待清理')
  expect(wrapper.text()).toContain('文件大小未知')
  await vi.advanceTimersByTimeAsync(2000); await flushPromises()
  expect(wrapper.text()).toContain('临时资料包已清理')
  expect(shareImports.action).not.toHaveBeenCalled()
  const calls = vi.mocked(shareImports.get).mock.calls.length
  await vi.advanceTimersByTimeAsync(6000); await flushPromises()
  expect(shareImports.get).toHaveBeenCalledTimes(calls)
})
it('切换媒体源后忽略迟到的确认响应，不覆盖新任务', async () => {
  let finish!: (value: ShareImportJob) => void
  vi.mocked(shareImports.latest).mockResolvedValue(job('PREVIEW'))
  vi.mocked(shareImports.action).mockReturnValue(new Promise(resolve => { finish = resolve }))
  wrapper = mount(ShareImportPanel, { props: { source } }); await flushPromises()
  expect(button('确认导入资料')).toBeUndefined()
  await button('核对目录').trigger('click')
  await button('确认导入资料').trigger('click')
  vi.mocked(shareImports.latest).mockResolvedValue({ ...job('PREVIEW'), id: 'new-job', totalCount: 9 })
  await wrapper.setProps({ source: { ...source, id: 'other' } }); await flushPromises()
  finish(job('VERIFYING')); await flushPromises()
  await button('核对目录').trigger('click')
  expect(wrapper.text()).toContain('共 9 首')
  expect(wrapper.text()).not.toContain('正在核对媒体路径')
  expect(shareImports.get).not.toHaveBeenCalledWith('other', 'job')
})
it('显式选择预览后等待确认，核验结束时收起进度', async () => {
  vi.useFakeTimers()
  vi.mocked(shareImports.upload).mockResolvedValue(job('PARSING'))
  vi.mocked(shareImports.get).mockResolvedValue(job('PREVIEW'))
  wrapper = mount(ShareImportPanel, { props: { source } }); await flushPromises()
  const file = new File(['zip'], '资料.zip'), input = wrapper.get('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: [file] })
  await input.trigger('change'); await flushPromises()
  expect(shareImports.upload).not.toHaveBeenCalled()
  await button('预览并调整目录').trigger('click'); await flushPromises()
  expect(shareImports.upload).toHaveBeenCalledWith('mine', file, expect.any(AbortSignal), 'preview')
  expect(wrapper.text()).toContain('自己的地址：https://my.example.invalid/')
  expect(wrapper.text()).toContain('为已有 1 首合并资料')
  expect(shareImports.action).not.toHaveBeenCalled()
  vi.mocked(shareImports.action).mockResolvedValue(job('QUEUED'))
  vi.mocked(shareImports.get).mockResolvedValueOnce({ ...job('VERIFYING'), processedCount: 2 })
    .mockResolvedValue({ ...job('SUCCEEDED'), phase: 'VERIFYING', processedCount: 2, verifiedCount: 2, presentCount: 2 })
  await button('确认导入资料').trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('正在核验文件路径')
  expect(button('核验 WebDAV 路径')).toBeUndefined()
  await button('查看').trigger('click')
  expect(wrapper.find('[aria-label="导入详情"]').exists()).toBe(true)
  await vi.advanceTimersByTimeAsync(2000); await flushPromises()
  expect(wrapper.find('.job').exists()).toBe(false)
  expect(wrapper.find('.status-line').exists()).toBe(false)
  expect(shareImports.action).toHaveBeenCalledExactlyOnceWith('mine', 'job', 'apply')
  expect(wrapper.emitted('updated')).toHaveLength(2)
})
it('旧版已导入但未核验的任务可以手动启动核验', async () => {
  vi.mocked(shareImports.latest).mockResolvedValue({ ...job('SUCCEEDED'), phase: 'IMPORTED', processedCount: 2 })
  vi.mocked(shareImports.action).mockResolvedValue(job('VERIFYING'))
  vi.mocked(shareImports.get).mockResolvedValue(job('VERIFYING'))
  wrapper = mount(ShareImportPanel, { props: { source } }); await flushPromises()
  expect(shareImports.action).not.toHaveBeenCalled()
  await button('查看').trigger('click')
  await button('核验 WebDAV 路径').trigger('click'); await flushPromises()
  expect(shareImports.action).toHaveBeenCalledExactlyOnceWith('mine', 'job', 'retry')
  expect(wrapper.text()).toContain('正在核验文件路径')
})
it('目录映射修改后必须刷新预览再确认，并保留根目录', async () => {
  vi.mocked(shareImports.latest).mockResolvedValue(job('PREVIEW'))
  wrapper = mount(ShareImportPanel, { props: { source } }); await flushPromises()
  await button('核对目录').trigger('click')
  const inputs = wrapper.findAll('input[type="text"]')
  await inputs[0]!.setValue('旧目录')
  expect(button('确认导入资料').attributes('disabled')).toBeDefined()
  vi.mocked(shareImports.mapping).mockResolvedValue({ ...job('PREVIEW'), removePrefix: '旧目录', samples: [{ originalPath: '旧目录/歌 曲.mkv', relativePath: '歌 曲.mkv', mediaURL: source.location + '歌 曲.mkv' }] })
  await button('更新路径预览').trigger('click'); await flushPromises()
  expect(shareImports.mapping).toHaveBeenCalledWith('mine', 'job', '旧目录', '')
  expect(button('确认导入资料').attributes('disabled')).toBeUndefined()
  expect(wrapper.text()).toContain('自己的地址：' + source.location + '歌 曲.mkv')
})
it('切回来源只展开本次收到的预览，恢复标签页时保留正在编辑的目录', async () => {
  acceptedUpload.value = { sourceId: source.id, job: job('PARSING') }
  vi.mocked(shareImports.latest).mockResolvedValue(job('PREVIEW'))
  vi.mocked(shareImports.get).mockResolvedValue(job('PREVIEW'))
  wrapper = mount(ShareImportPanel, { props: { source } }); await flushPromises()
  const prefix = wrapper.get('input[type="text"]')
  await prefix.setValue('未提交的目录')
  document.dispatchEvent(new Event('visibilitychange')); await flushPromises()
  expect((prefix.element as HTMLInputElement).value).toBe('未提交的目录')
  expect(button('确认导入资料').attributes('disabled')).toBeDefined()
})
it('从任务中心恢复指定任务，差异显示保留的本地字段与连接原因', async () => {
  const result = { ...job('SUCCEEDED'), phase: 'VERIFYING', preservedCount: 1, unreachableCount: 1, processedCount: 2, verifiedCount: 2 }
  vi.mocked(shareImports.get).mockResolvedValue(result)
  vi.mocked(shareImports.differences).mockResolvedValue({ items: [{ ordinal: 1, relativePath: '歌曲.mkv', outcome: 'PRESERVED', fields: ['title'], local: { title: '我的订正' }, incoming: { title: '共享修订' }, verification: 'UNREACHABLE', verificationError: '来源权限错误' }], nextCursor: 1, hasMore: false })
  wrapper = mount(ShareImportPanel, { props: { source, jobId: 'earlier-task' } }); await flushPromises()
  expect(shareImports.get).toHaveBeenCalledWith('mine', 'earlier-task')
  await button('查看差异与待处理项').trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('保留本地「我的订正」；共享「共享修订」')
  expect(wrapper.text()).toContain('来源权限错误')
  vi.mocked(shareImports.action).mockResolvedValue(job('VERIFYING'))
  await button('重试未通过的核验').trigger('click'); await flushPromises()
  expect(shareImports.action).toHaveBeenCalledWith('mine', 'job', 'retry')
  expect(wrapper.text()).not.toContain('来源权限错误')
})
it('旧包的路径已变更时可以查看跳过原因', async () => {
  vi.mocked(shareImports.latest).mockResolvedValue({ ...job('SUCCEEDED'), phase: 'VERIFYING', processedCount: 2, verifiedCount: 2, presentCount: 1 })
  vi.mocked(shareImports.differences).mockResolvedValue({ items: [{ ordinal: 1, relativePath: '旧路径.mkv', fields: [], outcome: 'ADDED', verification: 'SUPERSEDED' }], nextCursor: 1, hasMore: false })
  wrapper = mount(ShareImportPanel, { props: { source } }); await flushPromises()
  expect(wrapper.text()).toContain('已跳过 1 个')
  await button('查看').trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('此条目的位置或文件信息已变更')
  expect(shareImports.action).not.toHaveBeenCalled()
})
it('开始上传后忽略迟到的旧任务查询，保留新资料包的路径预览', async () => {
  let old!: (value: ShareImportJob) => void
  vi.mocked(shareImports.latest).mockReturnValue(new Promise(resolve => { old = resolve }))
  vi.mocked(shareImports.upload).mockResolvedValue(job('PARSING'))
  vi.mocked(shareImports.get).mockResolvedValue(job('PREVIEW'))
  wrapper = mount(ShareImportPanel, { props: { source } }); await flushPromises()
  const input = wrapper.get('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: [new File(['zip'], 'new.zip')] })
  await input.trigger('change'); await flushPromises()
  await button('预览并调整目录').trigger('click'); await flushPromises()
  old({ ...job('SUCCEEDED'), id: 'older-job' }); await flushPromises()
  expect(button('确认导入资料')).toBeDefined()
  expect(wrapper.text()).toContain('请核对自己的媒体目录')
  expect(wrapper.text()).not.toContain('曲库资料已导入')
})

it('已有来源只在点导入后自动提交，连续点击共上传一次', async () => {
  let finish!: (job: ShareImportJob) => void
  vi.mocked(shareImports.upload).mockReturnValue(new Promise(resolve => { finish = resolve }))
  vi.mocked(shareImports.get).mockResolvedValue(job('VERIFYING'))
  wrapper = mount(ShareImportPanel, { props: { source } }); await flushPromises()
  const input = wrapper.get('input[type="file"]'), file = new File(['zip'], '资料.zip')
  Object.defineProperty(input.element, 'files', { value: [file] })
  await input.trigger('change')
  expect(shareImports.upload).not.toHaveBeenCalled()
  const submit = button('导入')
  await Promise.all([submit.trigger('click'), submit.trigger('click')])
  expect(shareImports.upload).toHaveBeenCalledExactlyOnceWith(source.id, file, expect.any(AbortSignal), 'auto')
  finish(job('QUEUED')); await flushPromises()
  expect(wrapper.text()).toContain('正在核验文件路径')
  expect(shareImports.action).not.toHaveBeenCalled()
})

it('中文目录仅解码显示路径的有效字符，保留分隔符、百分号与查询参数', () => {
  const root = 'http://10.103.1.14:5005/'
  expect(displayWebDavLocation(root + '%E5%A8%B1%E4%B9%90%E6%9C%BA%E6%A2%B01/ktv/test2/')).toBe(root + '娱乐机械1/ktv/test2/')
  expect(displayWebDavLocation(root + '%E6%AD%8C%20%41%2FB%3F%23/%252F/%ZZ/?q=%E6%AD%8C')).toBe(root + '歌 A%2FB%3F%23/%2F/%ZZ/?q=%E6%AD%8C')
  expect(displayWebDavLocation(root + '100%25/%25E6%25AD%258C/%E6%AD')).toBe(root + '100%/%E6%AD%8C/%E6%AD')
})
