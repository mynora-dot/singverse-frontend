// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import MediaLibraryView from '../src/admin/modules/media-library/views/MediaLibraryView.vue'
import BackgroundTasksView from '../src/admin/modules/background-tasks/BackgroundTasksView.vue'
import { backgroundTasks } from '../src/admin/modules/background-tasks/api'
import { acceptedUpload, packageUploads } from '../src/admin/modules/media-library/package-uploads'
import WebDavSourceRow from '../src/admin/modules/media-library/components/WebDavSourceRow.vue'
import { media } from '../src/admin/modules/media-library/api/media'
import { embeddedMetadata, type EmbeddedSummary } from '../src/admin/modules/media-library/api/embeddedMetadata'
import { shareImports, type ShareImportJob } from '../src/admin/modules/media-library/api/shareImports'
import { parserProfiles } from '../src/admin/modules/filename-parser/api/rules'
import type { MediaSource } from '../src/admin/modules/media-library/types'
import { workspace } from './fixtures/filename-workspace'
import { dropdownStubs } from './fixtures/dropdown-stubs'
import { authRequest } from '../src/admin/core/auth/api'

vi.mock('../src/admin/modules/background-tasks/api', () => ({ backgroundTasks: { list: vi.fn() } }))
vi.mock('../src/admin/modules/media-library/api/media', () => ({ media: { list: vi.fn(), save: vi.fn(), get: vi.fn(), latestTask: vi.fn(), latestIngest: vi.fn(), scan: vi.fn(), createTask: vi.fn() } }))
vi.mock('../src/admin/modules/media-library/api/embeddedMetadata', async original => ({
  ...await original<typeof import('../src/admin/modules/media-library/api/embeddedMetadata')>(),
  embeddedMetadata: { summary: vi.fn(), configure: vi.fn(), refresh: vi.fn() },
}))
vi.mock('../src/admin/modules/media-library/api/shareImports', async original => ({
  ...await original<typeof import('../src/admin/modules/media-library/api/shareImports')>(),
  shareImports: { upload: vi.fn(), latest: vi.fn(), get: vi.fn(), action: vi.fn() },
}))
vi.mock('../src/admin/modules/filename-parser/api/rules', () => ({ parserProfiles: { load: vi.fn() } }))
vi.mock('../src/admin/core/auth/api', () => ({ authRequest: vi.fn(async () => ({})) }))

const source: MediaSource = { id: 'new-library', name: '我的曲库', type: 'WEBDAV', location: 'https://mine.example.invalid/dav/我的 KTV/', username: '', passwordConfigured: false, parserProfileId: 'default', scanEnabled: false, createdAt: '', updatedAt: '' }
const job = (state: string): ShareImportJob => ({ id: 'import', state, phase: state, totalCount: 2, processedCount: 0, addedCount: 0, updatedCount: 0, preservedCount: 0, unchangedCount: 0, verifiedCount: 0, presentCount: 0, missingCount: 0, mismatchCount: 0, unreachableCount: 0, removePrefix: '', addPrefix: '', preview: { total: 2, newSongs: 2, existingSongs: 0 }, samples: [{ originalPath: '华语/歌 曲.mkv', relativePath: '华语/歌 曲.mkv', mediaURL: source.location + '华语/歌 曲.mkv' }] })
const summary: EmbeddedSummary = { enabled: false, paused: false, accessGroup: '', privateOrigins: [], emptyScans: 0, canConfirmEmpty: false, counts: {}, presence: {}, budget: { files_started: 0, bytes_read: 0 } }
let wrapper: VueWrapper, router: Router
beforeEach(async () => {
  vi.resetAllMocks()
  packageUploads.clear()
  acceptedUpload.value = undefined
  vi.mocked(backgroundTasks.list).mockResolvedValue({ items: [], totalElements: 0, page: 0, size: 20, observedAt: '' })
  vi.mocked(media.list).mockResolvedValue({ items: [], page: 0, size: 100, totalElements: 0 })
  vi.mocked(media.save).mockResolvedValue(source)
  vi.mocked(media.get).mockResolvedValue(source)
  vi.mocked(embeddedMetadata.summary).mockResolvedValue(summary)
  vi.mocked(parserProfiles.load).mockResolvedValue(workspace())
  vi.mocked(shareImports.upload).mockResolvedValue(job('PARSING'))
  vi.mocked(shareImports.get).mockResolvedValue(job('VERIFYING'))
  vi.mocked(shareImports.latest).mockResolvedValue({} as ShareImportJob)
  router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/library/media', component: MediaLibraryView },
    { path: '/system/tasks', component: BackgroundTasksView },
    { path: '/library/songs', component: { template: '<p>歌曲</p>' } },
  ] })
  await router.push('/library/media')
  wrapper = mount({ template: '<RouterView />' }, { attachTo: document.body, global: { plugins: [router], stubs: { teleport: true, ElSelect: true, ...dropdownStubs } } })
  await flushPromises()
})
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = ''; vi.restoreAllMocks() })
const button = (text: string) => wrapper.findAll('button').find(item => item.text() === text)!
const checkbox = (text: string) => wrapper.findAll('label.el-checkbox').find(item => item.text() === text)!.get('input')
function sourceStep(step: 1 | 2 | 3) {
  const screen = wrapper.get(`[data-source-step="${step}"]`)
  expect(screen.isVisible()).toBe(true)
  return screen
}
async function nextStep(step: 2 | 3) {
  await button('下一步').trigger('click'); await flushPromises()
  sourceStep(step)
}
async function openWebDAV(fromPackage = false) {
  if (fromPackage) {
    await wrapper.get('button[aria-label="歌曲来源的更多操作"]').trigger('click'); await flushPromises()
    await wrapper.findAll('[role="menuitem"]').find(item => item.text() === '导入资料包')!.trigger('click')
  } else await button('添加来源').trigger('click')
  await flushPromises()
  if (!fromPackage) { await button('WebDAV').trigger('click'); await flushPromises() }
  sourceStep(1)
  await wrapper.get('input[placeholder="https://nas.example/dav/歌曲目录/"]').setValue(source.location)
  expect(media.save).not.toHaveBeenCalled()
  expect(shareImports.upload).not.toHaveBeenCalled()
  await nextStep(2)
}
async function selectPackage(file = new File(['zip'], '曲库资料.zip')) {
  const input = wrapper.get('input[aria-label="新歌曲来源资料包"]')
  Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
  await input.trigger('change'); await flushPromises()
  return file
}
async function submit(startScan = true) {
  const method = wrapper.find('[data-source-step="2"]')
  if (method.exists() && method.isVisible()) await nextStep(3)
  sourceStep(3)
  const action = button('保存并导入资料包') || button('保存并预览资料包') || button(startScan ? '保存并扫描' : '仅保存')
  expect(action.isVisible()).toBe(true)
  await action.trigger('click'); await flushPromises()
}
function noMediaParsing() {
  expect(media.scan).not.toHaveBeenCalled()
  expect(media.createTask).not.toHaveBeenCalled()
  expect(embeddedMetadata.configure).not.toHaveBeenCalled()
  expect(embeddedMetadata.refresh).not.toHaveBeenCalled()
}

it('同名来源按来源 ID 隔离导入与状态，另一个来源仍可查看歌曲', async () => {
  const other = { ...source, id: 'other', location: source.location + '另一个目录/' }
  vi.mocked(media.list).mockResolvedValue({ items: [source, other], page: 0, size: 100, totalElements: 2 })
  await wrapper.findAll('[role="menuitem"]').find(item => item.text() === '刷新')!.trigger('click')
  await flushPromises()
  const first = wrapper.get('#webdav-source-' + source.id)
  const second = wrapper.get('#webdav-source-other')
  const input = second.get('input[type="file"]'), file = new File(['zip'], '第二个来源.zip')
  Object.defineProperty(input.element, 'files', { value: [file] })
  await input.trigger('change')
  expect(first.text()).not.toContain(file.name)
  await second.findAll('button').find(item => item.text() === '导入')!.trigger('click')
  await flushPromises()
  expect(shareImports.upload).toHaveBeenCalledExactlyOnceWith('other', file, expect.any(AbortSignal), 'auto')
  expect(second.text()).toContain('正在核验文件路径')
  expect(first.find('.status-line').exists()).toBe(false)
  expect(first.get('.import-button').element).toHaveProperty('disabled', false)
  await first.get('button[aria-label="查看歌曲"]').trigger('click'); await flushPromises()
  expect(router.currentRoute.value.query.sourceId).toBe(source.id)
  noMediaParsing()
})

it('任务中心定位到首批以外的来源，刷新后保留目录草稿和编辑焦点', async () => {
  const other = { ...source, id: 'other' }
  vi.mocked(media.list).mockResolvedValue({ items: [other], page: 0, size: 100, totalElements: 101 })
  vi.mocked(shareImports.get).mockResolvedValue({ ...job('PREVIEW'), id: 'history' })
  await router.push({ path: '/library/media', query: { source: source.id, import: 'history' } })
  await flushPromises()
  const row = wrapper.get('#webdav-source-' + source.id)
  expect(document.activeElement).toBe(row.element)
  expect(shareImports.get).toHaveBeenCalledWith(source.id, 'history')
  const prefix = row.get('input[type="text"]')
  ;(prefix.element as HTMLInputElement).focus()
  await prefix.setValue('新前缀')
  await wrapper.findAll('[role="menuitem"]').find(item => item.text() === '刷新')!.trigger('click')
  await flushPromises()
  expect(wrapper.get('#webdav-source-' + source.id).element).toBe(row.element)
  expect((prefix.element as HTMLInputElement).value).toBe('新前缀')
  expect(document.activeElement).toBe(prefix.element)
  expect(wrapper.get('#webdav-source-other').find('[aria-label="导入详情"]').exists()).toBe(false)
})

it('相同根地址更换账号后切换到新核验任务，不再显示旧完成任务', async () => {
  wrapper.unmount()
  vi.mocked(shareImports.get).mockImplementation(async (_source, id) => ({ ...job(id === 'new-verification' ? 'VERIFYING' : 'SUCCEEDED'), id }))
  vi.mocked(authRequest).mockImplementation(async path => path.endsWith('/rebind') ? { id: 'new-verification' } as never : {} as never)
  wrapper = mount(WebDavSourceRow, { attachTo: document.body, props: { source, importJobId: 'old-completed', summary }, global: { stubs: dropdownStubs } })
  await flushPromises()
  await wrapper.get('.record-menu button').trigger('click')
  await wrapper.findAll('[role="menuitem"]').find(item => item.text() === '维护与设置')!.trigger('click'); await flushPromises()
  await button('保留资料并重新核验').trigger('click'); await flushPromises()
  expect(authRequest).toHaveBeenCalledWith(`/api/v1/media-sources/${source.id}/rebind`, 'POST', expect.objectContaining({ location: source.location }))
  expect(shareImports.get).toHaveBeenCalledWith(source.id, 'new-verification')
  expect(wrapper.text()).toContain('正在核验文件路径')
  expect(wrapper.emitted('updated')).toContainEqual(['new-verification'])
})

it('新建 WebDAV 一次确认后自动核对路径，入库使用包内资料', async () => {
  await openWebDAV()
  await checkbox('自动读取文件内的歌曲信息').setValue(true)
  await wrapper.get('.source-advanced > summary').trigger('click'); await flushPromises()
  await checkbox('启用定时扫描').setValue(true); await flushPromises()
  await checkbox('从已导出的资料包入库').setValue(true); await flushPromises()
  expect(checkbox('启用定时扫描').element).toHaveProperty('disabled', true)
  expect(checkbox('启用定时扫描').element).toHaveProperty('checked', false)
  const file = await selectPackage()
  expect(wrapper.get('.source-package').text()).toContain(file.name)
  expect(media.save).not.toHaveBeenCalled()
  expect(shareImports.upload).not.toHaveBeenCalled()
  await nextStep(3)
  expect(button('保存并导入资料包')).toBeDefined()
  expect(button('仅保存')).toBeUndefined()
  expect(sourceStep(3).text()).toContain('后台自动核对 WebDAV 路径和已知文件大小')
  await submit()
  expect(media.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'WEBDAV', location: source.location, startScan: false, autoExtractEmbedded: false, scanEnabled: false }), undefined)
  expect(shareImports.upload).toHaveBeenCalledExactlyOnceWith(source.id, file, expect.any(AbortSignal), 'auto')
  expect(button('确认导入资料')).toBeUndefined()
  expect(shareImports.action).not.toHaveBeenCalled()
  expect(wrapper.text()).toContain('正在核验文件路径')
  noMediaParsing()
})

it('新建来源也可先预览并调整目录', async () => {
  await openWebDAV(true)
  const file = await selectPackage()
  await checkbox('预览并调整目录').setValue(true)
  vi.mocked(shareImports.get).mockResolvedValue(job('PREVIEW'))
  await submit()
  expect(shareImports.upload).toHaveBeenCalledExactlyOnceWith(source.id, file, expect.any(AbortSignal), 'preview')
  expect(wrapper.text()).toContain('自己的地址：' + source.location)
  expect(shareImports.action).not.toHaveBeenCalled()
  vi.mocked(shareImports.action).mockResolvedValue(job('QUEUED'))
  vi.mocked(shareImports.get).mockResolvedValue(job('VERIFYING'))
  await button('确认导入资料').trigger('click'); await flushPromises()
  expect(shareImports.action).toHaveBeenCalledExactlyOnceWith(source.id, 'import', 'apply')
  expect(wrapper.text()).toContain('正在核验文件路径')
  noMediaParsing()
})

it('新建后回到来源行，上传中可切到任务中心，收完解除离页保护', async () => {
  let finish!: (value: ShareImportJob) => void
  vi.mocked(shareImports.upload).mockReturnValue(new Promise(resolve => { finish = resolve }))
  await openWebDAV(true); const file = await selectPackage(); await submit()
  const during = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(during)
  expect(during.defaultPrevented).toBe(true)
  expect(wrapper.getComponent(WebDavSourceRow).text()).toContain(file.name)
  expect(wrapper.find('.library-workflow-dialog').exists()).toBe(false)
  await router.push('/system/tasks'); await flushPromises()
  expect(wrapper.text()).toContain(file.name)
  expect(button('取消上传')).toBeDefined()
  expect(vi.mocked(shareImports.upload).mock.calls[0]![2].aborted).toBe(false)
  finish(job('QUEUED')); await flushPromises()
  expect(backgroundTasks.list).toHaveBeenCalledTimes(2)
  expect(button('取消上传')).toBeUndefined()
  const after = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(after)
  expect(after.defaultPrevented).toBe(false)
  noMediaParsing()
})

it('在任务中心取消上传后可以重试同一资料包', async () => {
  vi.mocked(shareImports.upload).mockImplementationOnce((_id, _file, signal) =>
    new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))))
  await openWebDAV(true); const file = await selectPackage(); await submit()
  await router.push('/system/tasks'); await flushPromises()
  await button('取消上传').trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('上传已取消')
  await button('重试上传').trigger('click'); await flushPromises()
  expect(shareImports.upload).toHaveBeenLastCalledWith(source.id, file, expect.any(AbortSignal), 'auto')
  expect(media.save).toHaveBeenCalledTimes(1)
  expect(packageUploads.size).toBe(0)
})

it('上传失败可复用已保存的媒体库和已选文件重试，不重复新建来源', async () => {
  vi.mocked(shareImports.upload).mockRejectedValueOnce(new Error('网络断开'))
  await openWebDAV(true)
  const file = await selectPackage(); await submit()
  expect(wrapper.text()).toContain('网络断开')
  await button('重试上传资料包').trigger('click'); await flushPromises()
  expect(shareImports.upload).toHaveBeenCalledTimes(2)
  expect(shareImports.upload).toHaveBeenLastCalledWith(source.id, file, expect.any(AbortSignal), 'auto')
  expect(media.save).toHaveBeenCalledTimes(1)
  expect(button('确认导入资料')).toBeUndefined()
  noMediaParsing()
})

it('来源列表刷新缓慢时仍立即开始上传，不会丢失选择的资料包', async () => {
  await openWebDAV(true)
  const file = await selectPackage()
  let finish!: (value: Awaited<ReturnType<typeof media.list>>) => void
  vi.mocked(media.list).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  await submit()
  expect(shareImports.upload).toHaveBeenCalledExactlyOnceWith(source.id, file, expect.any(AbortSignal), 'auto')
  expect(button('确认导入资料')).toBeUndefined()
  finish({ items: [source], page: 0, size: 100, totalElements: 1 }); await flushPromises()
  expect(shareImports.upload).toHaveBeenCalledTimes(1)
  noMediaParsing()
})

it('保存来源失败时保留选中的资料包，再次保存成功后才上传', async () => {
  vi.mocked(media.save).mockRejectedValueOnce(new Error('地址无效'))
  await openWebDAV(true)
  const file = await selectPackage(); await submit()
  expect(wrapper.text()).toContain('地址无效')
  sourceStep(3)
  expect(sourceStep(3).text()).toContain(file.name)
  expect(shareImports.upload).not.toHaveBeenCalled()
  await submit()
  expect(shareImports.upload).toHaveBeenCalledExactlyOnceWith(source.id, file, expect.any(AbortSignal), 'auto')
  noMediaParsing()
})

it('未选包、空文件、非 ZIP 及超限资料包在新建来源前给出错误', async () => {
  await openWebDAV(true); await button('下一步').trigger('click'); await flushPromises()
  sourceStep(2)
  expect(wrapper.text()).toContain('请先选择导出的 ZIP 资料包')
  await selectPackage(new File(['json'], 'metadata.json'))
  expect(wrapper.text()).toContain('请选择 ZIP 格式的资料包')
  await selectPackage(new File([], 'empty.zip'))
  expect(wrapper.text()).toContain('资料包为空')
  const large = new File(['zip'], 'large.zip'); Object.defineProperty(large, 'size', { value: 8 * 1024 ** 3 + 1 })
  await selectPackage(large)
  expect(wrapper.text()).toContain('分享包不能超过 8 GiB')
  await button('下一步').trigger('click'); await flushPromises()
  sourceStep(2)
  expect(media.save).not.toHaveBeenCalled()
  expect(shareImports.upload).not.toHaveBeenCalled()
})

it.each([true, false])('新建 WebDAV 不提供资料包也可保存，startScan=%s', async startScan => {
  await openWebDAV()
  expect(wrapper.find('input[type="file"]').exists()).toBe(false)
  expect(button('直接扫描').attributes('aria-pressed')).toBe('true')
  await submit(startScan)
  expect(media.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'WEBDAV', location: source.location, startScan }), undefined)
  expect(shareImports.upload).not.toHaveBeenCalled()
  expect(shareImports.action).not.toHaveBeenCalled()
})

it('明确选用资料包但未选 ZIP 时可主动改为直接扫描，无需重新连接', async () => {
  await openWebDAV(true)
  await button('下一步').trigger('click'); await flushPromises()
  sourceStep(2)
  expect(wrapper.text()).toContain('请先选择导出的 ZIP 资料包')
  expect(media.save).not.toHaveBeenCalled()
  await button('改为直接扫描').trigger('click'); await flushPromises()
  expect(checkbox('从已导出的资料包入库').element).toHaveProperty('checked', false)
  expect(wrapper.find('input[aria-label="新歌曲来源资料包"]').exists()).toBe(false)
  await submit()
  expect(media.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'WEBDAV', location: source.location, startScan: true, autoExtractEmbedded: false }), undefined)
  expect(shareImports.upload).not.toHaveBeenCalled()
})

it('移除选中的资料包会回到扫描方式，前后步骤不保留失效包或伪造包统计', async () => {
  await openWebDAV(true)
  const file = await selectPackage()
  await button('移除资料包').trigger('click'); await flushPromises()
  sourceStep(2)
  expect(checkbox('从已导出的资料包入库').element).toHaveProperty('checked', false)
  expect(wrapper.text()).not.toContain(file.name)
  expect(wrapper.find('input[aria-label="新歌曲来源资料包"]').exists()).toBe(false)
  await nextStep(3)
  const confirmation = sourceStep(3)
  expect(confirmation.text()).not.toContain(file.name)
  expect(confirmation.text()).not.toContain('126')
  expect(button('保存并扫描')).toBeDefined()
  expect(button('保存并导入资料包')).toBeUndefined()
  await button('上一步').trigger('click'); await flushPromises(); sourceStep(2)
  expect(wrapper.find('input[aria-label="新歌曲来源资料包"]').exists()).toBe(false)
  await submit(false)
  expect(media.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ startScan: false, autoExtractEmbedded: false }), undefined)
  expect(shareImports.upload).not.toHaveBeenCalled()
})

it('资料包在确认与返回修改之间保留，但确认前不保存、不上传', async () => {
  await openWebDAV(true)
  const file = await selectPackage()
  await nextStep(3)
  expect(sourceStep(3).text()).toContain(file.name)
  expect(media.save).not.toHaveBeenCalled()
  expect(shareImports.upload).not.toHaveBeenCalled()
  await button('上一步').trigger('click'); await flushPromises(); sourceStep(2)
  expect(wrapper.get('.source-package').text()).toContain(file.name)
  await button('上一步').trigger('click'); await flushPromises(); sourceStep(1)
  expect(wrapper.get('input[placeholder="https://nas.example/dav/歌曲目录/"]').element).toHaveProperty('value', source.location)
  await wrapper.get('input#source-name').setValue('接收的曲库')
  await nextStep(2)
  expect(wrapper.get('.source-package').text()).toContain(file.name)
  await submit()
  expect(media.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: '接收的曲库', startScan: false }), undefined)
  expect(shareImports.upload).toHaveBeenCalledExactlyOnceWith(source.id, file, expect.any(AbortSignal), 'auto')
  expect(shareImports.action).not.toHaveBeenCalled()
  noMediaParsing()
})

it('切换来源类型会清除资料包选择，普通 WebDAV 保留默认保存并扫描', async () => {
  await openWebDAV(true); await selectPackage()
  await button('上一步').trigger('click'); await flushPromises(); sourceStep(1)
  await button('本地目录').trigger('click'); await flushPromises()
  expect(wrapper.find('input[aria-label="新歌曲来源资料包"]').exists()).toBe(false)
  expect(button('下一步')).toBeDefined()
  await button('WebDAV').trigger('click'); await flushPromises()
  expect(wrapper.find('input[type="file"]').exists()).toBe(false)
  await wrapper.get('input[placeholder="https://nas.example/dav/歌曲目录/"]').setValue(source.location)
  await nextStep(2)
  expect(checkbox('从已导出的资料包入库').element).toHaveProperty('checked', false)
  await submit()
  expect(media.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ startScan: true, autoExtractEmbedded: false }), undefined)
  expect(shareImports.upload).not.toHaveBeenCalled()
})
