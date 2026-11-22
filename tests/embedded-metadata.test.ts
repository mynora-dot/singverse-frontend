// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ElButton, ElMessageBox } from 'element-plus'
import { packageUploads, uploadPackage } from '../src/admin/modules/media-library/package-uploads'
import LocalMetadataDialog from '../src/admin/modules/media-library/components/LocalMetadataDialog.vue'
import WebDavSourceRow from '../src/admin/modules/media-library/components/WebDavSourceRow.vue'
import { dropdownStubs } from './fixtures/dropdown-stubs'
import EmbeddedMetadataPanel from '../src/admin/modules/media-library/components/EmbeddedMetadataPanel.vue'
import { embeddedMetadata, type EmbeddedSummary } from '../src/admin/modules/media-library/api/embeddedMetadata'
import type { MediaSource } from '../src/admin/modules/media-library/types'
import { media } from '../src/admin/modules/media-library/api/media'
import { authRequest } from '../src/admin/core/auth/api'
import { shareImports, type ShareImportJob } from '../src/admin/modules/media-library/api/shareImports'
vi.mock('../src/admin/modules/media-library/api/embeddedMetadata', async importOriginal => {
  const original = await importOriginal<typeof import('../src/admin/modules/media-library/api/embeddedMetadata')>()
  return { ...original, embeddedMetadata: { summary: vi.fn(), configure: vi.fn(), confirmEmpty: vi.fn(), detail: vi.fn(), refresh: vi.fn() } }
})
vi.mock('../src/admin/modules/media-library/api/media', () => ({ media: { latestTask: vi.fn().mockResolvedValue(undefined), createTask: vi.fn(), songs: vi.fn().mockResolvedValue({ items: [{ id: 'trial', relativePath: 'sample.mp3' }] }) } }))
vi.mock('../src/admin/core/auth/api', () => ({ authRequest: vi.fn(async (path: string) => path.endsWith('/csrf') ? { token: 'test-csrf' } : {}) }))
const source: MediaSource = { id: 'source', name: '网盘曲库', type: 'WEBDAV', location: 'https://example.invalid/dav/', username: '', passwordConfigured: false, parserProfileId: 'default', createdAt: '', updatedAt: '' }
const summary: EmbeddedSummary = { enabled: false, paused: false, accessGroup: 'shared-cloud', privateOrigins: [], emptyScans: 0, canConfirmEmpty: false, counts: { COMPLETE: 12, PARTIAL: 3 }, presence: { missing: 1, changed: 2 }, budget: { files_started: 15, bytes_read: 1048576 } }
let wrapper: ReturnType<typeof mount>
let rowSummary: EmbeddedSummary
function renderRow(item = source) {
  wrapper = mount(WebDavSourceRow, { props: { source: item, summary: rowSummary, onConfigured: value => { void wrapper.setProps({ summary: value }) } }, global: { stubs: dropdownStubs } })
}
const menuItem = (label: string) => wrapper.findAll('[role="menuitem"]').find(item => item.text() === label)
const button = (label: string) => wrapper.findAllComponents(ElButton).find(item => item.text() === label)!
async function openAdvanced() {
  const details = wrapper.find('details.advanced-options')
  if (details.exists()) {
    (details.element as HTMLDetailsElement).open = true
    await details.trigger('toggle')
  } else {
    await wrapper.get('.record-menu button').trigger('click')
    await menuItem('维护与设置')!.trigger('click')
  }
  await flushPromises()
}
beforeEach(() => {
  vi.clearAllMocks(); packageUploads.clear(); rowSummary = { ...summary }
  vi.mocked(embeddedMetadata.summary).mockResolvedValue({ ...summary })
  vi.mocked(embeddedMetadata.configure).mockResolvedValue({ ...summary, enabled: true })
  vi.mocked(embeddedMetadata.detail).mockResolvedValue({ state: 'PARTIAL', changed: 1, result: { state: 'PARTIAL', fields: { lyrics: 'UNKNOWN' }, technical: { container: 'mp3' }, lyrics: { text: '内嵌歌词', timing: 'none' } } })
})
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks() })
it('维护设置直接开启和暂停提取，独立于未保存的访问组更改', async () => {
  renderRow()
  await flushPromises()
  expect(wrapper.text()).not.toContain('MiB')
  expect(wrapper.find('.el-tabs').exists()).toBe(false)
  expect(button('试提取一首')).toBeUndefined()
  await openAdvanced()
  await wrapper.get('input[maxlength="64"]').setValue('草稿组')
  expect(wrapper.get('.embedded-action h4').text()).toBe('完善歌曲信息')
  expect(wrapper.get('.embedded-action').element.closest('details')).toBeNull()
  await wrapper.findAllComponents(ElButton).find(button => button.text() === '开始自动提取')!.trigger('click')
  await flushPromises()
  expect(embeddedMetadata.configure).toHaveBeenLastCalledWith('source', { enabled: true, paused: false, accessGroup: 'shared-cloud', privateOrigins: [] })
  vi.mocked(embeddedMetadata.configure).mockResolvedValue({ ...summary, enabled: true, paused: true })
  await wrapper.findAllComponents(ElButton).find(button => button.text() === '暂停自动提取')!.trigger('click')
  await flushPromises()
  expect(embeddedMetadata.configure).toHaveBeenLastCalledWith('source', { enabled: true, paused: true, accessGroup: 'shared-cloud', privateOrigins: [] })
  expect(wrapper.text()).toContain('继续自动提取')
})
it('仅在满足空库确认条件后提供全部下架操作', async () => {
  rowSummary = { ...summary, emptyScans: 2, canConfirmEmpty: true }
  vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as Awaited<ReturnType<typeof ElMessageBox.confirm>>)
  renderRow()
  await flushPromises(); await openAdvanced()
  await wrapper.findAllComponents(ElButton).find(button => button.text() === '确认空库同步')!.trigger('click')
  await flushPromises()
  expect(embeddedMetadata.confirmEmpty).toHaveBeenCalledWith('source')
})
it('展示缓存变化提示、歌词及普通和深度手动提取', async () => {
  vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as Awaited<ReturnType<typeof ElMessageBox.confirm>>)
  wrapper = mount(EmbeddedMetadataPanel, { props: { songId: 'song' } })
  await flushPromises()
  expect(wrapper.text()).toContain('文件可能已变化')
  expect(wrapper.text()).toContain('内嵌歌词')
  await wrapper.findAllComponents(ElButton).find(button => button.text() === '重新读取文件信息')!.trigger('click')
  await flushPromises()
  expect(embeddedMetadata.refresh).toHaveBeenLastCalledWith(['song'], false)
  await wrapper.findAllComponents(ElButton).find(button => button.text() === '深入读取文件信息')!.trigger('click')
  await flushPromises()
  expect(embeddedMetadata.refresh).toHaveBeenLastCalledWith(['song'], true)
})
it('切换歌曲后忽略旧请求结果', async () => {
  let finish: (value: { state: string }) => void = () => undefined
  vi.mocked(embeddedMetadata.detail).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  wrapper = mount(EmbeddedMetadataPanel, { props: { songId: 'old-song' } })
  await wrapper.setProps({ songId: 'new-song' }); await flushPromises()
  finish({ state: 'EMPTY' }); await flushPromises()
  expect(wrapper.text()).toContain('部分完成')
  expect(wrapper.text()).not.toContain('没有内嵌标签')
})

it('ZIP 导入使用当前来源、会话与 CSRF，并刷新状态', async () => {
  vi.spyOn(ElMessageBox, 'alert').mockResolvedValue('confirm' as Awaited<ReturnType<typeof ElMessageBox.alert>>)
  const fetcher = vi.fn(async () => Response.json({ id: 'import-task', state: 'PARSING', phase: 'PARSING', totalCount: 0, processedCount: 0 }))
  vi.mocked(authRequest).mockImplementation(async (path: string) => path.endsWith('/csrf') ? { token: 'test-csrf' } as never : path.endsWith('/import-task') ? { id: 'import-task', state: 'PARSING', phase: 'PARSING', totalCount: 0, processedCount: 0 } as never : {} as never)
  vi.stubGlobal('fetch', fetcher)
  try {
    renderRow()
    await flushPromises()
    const file = new File(['zip-test'], 'index.zip', { type: 'application/zip' })
    const input = wrapper.get('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change'); await flushPromises()
    expect(fetcher).not.toHaveBeenCalled()
    await button('导入').trigger('click'); await flushPromises()
    expect(fetcher).toHaveBeenCalledWith('/api/v1/media-sources/source/embedded-metadata/import-jobs?applyMode=auto', expect.objectContaining({
      method: 'POST', credentials: 'same-origin', body: file,
      headers: { 'Content-Type': 'application/zip', 'X-CSRF-Token': 'test-csrf' },
    }))
    expect(wrapper.text()).not.toContain('开始导入')
    expect(wrapper.text()).toContain('正在解析资料包')
    expect(wrapper.text()).not.toContain('自动跳过')
  } finally { vi.unstubAllGlobals() }
})

it('已有歌曲的来源在上传中仍可查看歌曲', async () => {
  let finish!: (value: ShareImportJob) => void
  vi.spyOn(shareImports, 'upload').mockReturnValue(new Promise(resolve => { finish = resolve }))
  void uploadPackage(source, new File(['zip'], '资料.zip'), 'auto')
  renderRow()
  await flushPromises()
  await button('查看歌曲').trigger('click')
  expect(wrapper.emitted('songs')).toHaveLength(1)
  wrapper.unmount()
  expect(packageUploads.get(source.id)?.controller?.signal.aborted).toBe(false)
  finish({ id: 'late', state: 'PARSING' } as ShareImportJob); await flushPromises()
})

it('维护区试提取一首不会开启整库自动提取，分享不再暴露旧版入口', async () => {
  renderRow()
  await flushPromises(); await openAdvanced()
  vi.mocked(embeddedMetadata.detail).mockResolvedValueOnce({ state: 'PENDING' })
  await wrapper.findAllComponents(ElButton).find(button => button.text() === '试提取一首')!.trigger('click')
  await flushPromises()
  expect(embeddedMetadata.refresh).toHaveBeenCalledWith(['trial'])
  expect(embeddedMetadata.configure).not.toHaveBeenCalled()
  expect(wrapper.text()).not.toContain('旧版')
  expect(wrapper.text()).not.toContain('SUCCEEDED')
})

it('已完成样本复用缓存，未知字段不显示为确认没有', async () => {
  renderRow()
  await flushPromises(); await openAdvanced()
  await wrapper.findAllComponents(ElButton).find(button => button.text() === '试提取一首')!.trigger('click')
  await flushPromises()
  expect(embeddedMetadata.refresh).not.toHaveBeenCalled()
  expect(wrapper.text()).toContain('尚未读取到内嵌歌名')
  expect(wrapper.text()).not.toContain('文件未提供内嵌歌名')
})

it('默认隐藏同步和分包细节，分享可直接提交给后台准备', async () => {
  vi.mocked(embeddedMetadata.summary).mockResolvedValue({ ...summary, files: { pending: 2, failed: 1, directory: 'library/source' } })
  wrapper = mount(LocalMetadataDialog, { props: { source: { ...source, type: 'LOCAL' } }, global: { stubs: { teleport: true } } })
  await flushPromises()
  expect(wrapper.text()).not.toContain('等待处理')
  expect(wrapper.text()).not.toContain('暂未保存')
  expect(wrapper.text()).not.toContain('5000')
  expect(wrapper.text()).not.toContain('启用自动补齐')
  expect(wrapper.findAllComponents(ElButton).find(button => button.text() === '导出分享包')!.props('disabled')).toBe(false)
  expect(media.latestTask).not.toHaveBeenCalled()
  await openAdvanced()
  expect(wrapper.text()).toContain('等待处理 2 首')
  expect(wrapper.text()).toContain('1 首待重新生成')
  expect(wrapper.findAllComponents(ElButton).some(button => button.text() === '重新扫描歌曲')).toBe(true)
})

it('后台准备只显示可理解的进度，不暴露任务状态和分包细节', async () => {
  vi.mocked(authRequest).mockImplementation(async path => (path.endsWith('/share-jobs/latest') ? { id: 'job', state: 'WAITING', total_count: 15, processed_count: 0, part_count: 0 } : {}) as never)
  renderRow()
  await flushPromises()
  expect(wrapper.text()).toContain('正在准备')
  expect(wrapper.find('[role="progressbar"]').exists()).toBe(true)
  expect(wrapper.text()).not.toContain('WAITING')
  expect(wrapper.text()).not.toContain('分包')
})

it('首页显示歌曲数、中文路径和当前来源的异常数，导出在更多中', async () => {
  rowSummary = { ...summary, quality: { total: 21, songs: 17, files: 21, identityComplete: 16, informationMissing: 1, pendingVerification: 0, mediaIssues: 2, missingFiles: 2 } }
  let exporting = false
  vi.mocked(authRequest).mockImplementation(async (path, method) => {
    if (path.endsWith('/share-jobs') && method === 'POST') {
      exporting = true
      return { id: 'out', state: 'QUEUED' } as never
    }
    if (exporting && path.endsWith('/share-jobs/latest')) return { id: 'out', state: 'SUCCEEDED', part_count: 1 } as never
    return {} as never
  })
  renderRow({ ...source, location: 'http://nas/%E5%A8%B1%E4%B9%90%E6%9C%BA%E6%A2%B01/ktv/test2/' })
  await flushPromises()
  expect(wrapper.get('[aria-label="查看歌曲"]').text()).toContain('17 首')
  expect(wrapper.text().split('http://nas/娱乐机械1/ktv/test2/')).toHaveLength(2)
  expect(wrapper.text()).toContain('1 首歌曲资料待补齐 · 2 个文件未找到')
  expect(button('导出资料包')).toBeUndefined()
  await wrapper.get('.record-menu button').trigger('click'); await menuItem('导出资料包')!.trigger('click'); await flushPromises()
  expect(authRequest).toHaveBeenCalledWith('/api/v1/media-sources/source/embedded-metadata/share-jobs', 'POST', expect.anything())
  expect(wrapper.get('a[download]').text()).toBe('下载资料包')
  expect(wrapper.get('a[download]').attributes('href')).toBe('/api/v1/media-sources/source/embedded-metadata/share-jobs/out/download')
})
