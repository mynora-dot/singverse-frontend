// @vitest-environment jsdom
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import LocalSourceCard from '../src/admin/modules/media-library/components/LocalSourceCard.vue'
import WebDavSourceRow from '../src/admin/modules/media-library/components/WebDavSourceRow.vue'
import { shareImports } from '../src/admin/modules/media-library/api/shareImports'
import type { EmbeddedSummary } from '../src/admin/modules/media-library/api/embeddedMetadata'
import type { MediaSource, ScanTask } from '../src/admin/modules/media-library/types'

const source: MediaSource = { id: 'remote', name: 'WebDAV 歌曲', type: 'WEBDAV', location: 'https://nas.example.invalid/%E6%AD%8C%E6%9B%B2/', username: '', parserProfileId: 'default', passwordConfigured: true, createdAt: '', updatedAt: '' }
const local: MediaSource = { ...source, id: 'local', type: 'LOCAL', name: '本地歌曲', location: '/媒体库/歌曲' }
vi.mock('../src/admin/modules/media-library/api/shareImports', async original => ({
  ...await original<typeof import('../src/admin/modules/media-library/api/shareImports')>(),
  shareImports: { latest: vi.fn(async () => ({})) },
}))
vi.mock('../src/admin/core/auth/api', () => ({ authRequest: vi.fn(async () => ({})) }))
const summary: EmbeddedSummary = {
  quality: { songs: 17, variants: 19, files: 21, total: 21, identityComplete: 16, informationMissing: 1, pendingVerification: 0, mediaIssues: 0 },
  enabled: false, paused: false, accessGroup: '', privateOrigins: [], emptyScans: 0, canConfirmEmpty: false,
  counts: {}, presence: {}, budget: { files_started: 0, bytes_read: 0 },
}
function task(status: ScanTask['status']): ScanTask {
  return { id: 'task', sourceId: source.id, status, phase: 'SCANNING', directories: 1, entries: 21, totalSongs: 17, matchedSongs: 16, needsReviewSongs: 1, skippedFiles: 0, cancelRequested: false, error: status === 'FAILED' ? '目录读取失败，旧索引已保留' : null, createdAt: '', startedAt: '', finishedAt: null }
}
let wrapper: VueWrapper
function renderLocal(props: Partial<InstanceType<typeof LocalSourceCard>['$props']> = {}) {
  wrapper = mount(LocalSourceCard, { props: { source: local, profileName: '默认解析方案', ...props }, attachTo: document.body })
}
function renderRow(props: Partial<InstanceType<typeof WebDavSourceRow>['$props']> = {}) {
  wrapper = mount(WebDavSourceRow, { props: { source, ...props }, attachTo: document.body, global: { stubs: { transition: false } } })
}
function maintenanceDialog() {
  return new DOMWrapper(document.body).get('[role="dialog"]')
}
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = ''; vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('区分歌曲、版本和文件数量，只突出非零待处理事项并提供完善入口', async () => {
  renderLocal({ summary })
  expect(wrapper.findAll('.source-metrics dd').map(metric => metric.text())).toEqual(['17', '19', '21', '16'])
  expect(wrapper.get('.source-attention').text()).toContain('1 首歌曲信息不足')
  expect(wrapper.get('.source-attention').text()).not.toContain('路径待核验')
  expect(wrapper.get('.source-attention').text()).not.toContain('媒体待处理')
  expect(wrapper.get('.source-location').text()).toBe(local.location)
  await wrapper.get('.source-attention button').trigger('click')
  expect(wrapper.emitted('metadata')).toHaveLength(1)
})

it('尚未读取统计时不伪造零值，兼容旧统计字段且保留真实零值', async () => {
  renderLocal()
  expect(wrapper.find('.source-metrics').exists()).toBe(false)
  await wrapper.setProps({ summary: { ...summary, quality: { total: 9, identityComplete: 9, informationMissing: 0, pendingVerification: 0, mediaIssues: 0 } } })
  expect(wrapper.findAll('.source-metrics dd').map(metric => metric.text())).toEqual(['9', '9', '9', '9'])
  expect(wrapper.find('.source-attention').exists()).toBe(false)
  await wrapper.setProps({ summary: { ...summary, quality: { ...summary.quality!, songs: 0, variants: 0, files: 0 } } })
  expect(wrapper.findAll('.source-metrics dd').slice(0, 3).map(metric => metric.text())).toEqual(['0', '0', '0'])
})

it('WebDAV 扫描平时仅占一行，查看后可取消，正常结束后收起状态', async () => {
  renderRow({ task: task('RUNNING') })
  await flushPromises()
  const status = wrapper.get('[role="status"]')
  expect(status.text()).toContain('正在扫描目录')
  expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  const inspect = status.get('button')
  expect(inspect.attributes('aria-haspopup')).toBe('dialog')
  await inspect.trigger('click')
  const cancel = maintenanceDialog().findAll('button').find(button => button.text() === '取消扫描')!
  await cancel.trigger('click')
  expect(wrapper.emitted('cancelScan')).toHaveLength(1)
  await wrapper.setProps({ task: task('SUCCEEDED') })
  expect(wrapper.find('.status-line').exists()).toBe(false)
  const settings = maintenanceDialog()
  const details = settings.findAll('details').find(item => item.get('summary').text().includes('运行详情'))!
  expect(details.element.open).toBe(false)
  expect(details.get('[role="status"]').text()).toBe('扫描完成')
  const needsReview = details.findAll('dl > div').find(item => item.get('dt').text() === '文件名待复核')!
  expect(needsReview.get('dd').text()).toBe('1 首')
  await settings.trigger('keydown', { key: 'Escape' })
  await vi.waitFor(() => expect(document.activeElement).toBe(wrapper.get('.more-button').element))
})

it('状态读取出错时仍能查看最近扫描错误，重复的原因只显示一次', async () => {
  const failed = task('FAILED')
  renderRow({ task: failed, source: { ...source, lastScanError: failed.error }, taskError: '网络断开' })
  await flushPromises()
  expect(wrapper.get('.status-line').text()).toContain('网络断开')
  await wrapper.get('.status-line button').trigger('click')
  const settings = maintenanceDialog()
  expect(settings.get('.maintenance').text().split('目录读取失败，旧索引已保留')).toHaveLength(2)
  await settings.trigger('keydown', { key: 'Escape' })
  await vi.waitFor(() => expect(document.activeElement).toBe(wrapper.get('.status-line button').element))
})

it('来源行只显示一次中文目录与去重歌曲数，更多菜单可打开对应维护弹窗', async () => {
  renderRow({ summary: { ...summary, quality: { ...summary.quality!, informationMissing: 0 } } })
  await flushPromises()
  expect(wrapper.get('[aria-label="媒体目录"]').text()).toBe('https://nas.example.invalid/歌曲/')
  expect(wrapper.text().split('https://nas.example.invalid/歌曲/')).toHaveLength(2)
  expect(wrapper.findAll('button').map(item => item.text())).toEqual(['查看歌曲17 首', '导入资料包', ''])
  const songs = wrapper.get('button[aria-label="查看歌曲"]')
  expect(songs.attributes('aria-describedby')).toBe('webdav-count-remote')
  await songs.trigger('click')
  expect(wrapper.emitted('songs')).toHaveLength(1)
  const more = wrapper.get('button[aria-label="WebDAV 歌曲的更多操作"]')
  await more.trigger('click')
  await flushPromises()
  const menu = document.body.querySelector('[role="menu"]')!
  expect(menu.closest('article')).toBeNull()
  const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')]
  expect(items.map(item => item.textContent?.trim())).toEqual(['导出资料包', '维护与设置'])
  items[1]!.click()
  await flushPromises()
  const settings = maintenanceDialog()
  expect(settings.element.closest('article')).toBeNull()
  expect(settings.attributes('aria-modal')).toBe('true')
  expect(settings.get(`#${settings.attributes('aria-labelledby')}`).text()).toBe('维护与设置')
  expect(settings.get('.maintenance-source').text()).toBe(source.name)
  expect(settings.element.contains(document.activeElement)).toBe(true)
  await settings.get('.el-dialog__headerbtn').trigger('click')
  await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')).toBeNull())
  expect(more.element).toBe(document.activeElement)
})

it('后台入库期间显示当前阶段，并阻止重复扫描', async () => {
  renderRow({ task: task('SUCCEEDED'), ingest: { state: 'RUNNING' } })
  await flushPromises()
  expect(wrapper.get('.status-line').text()).toContain('正在后台入库')
  await wrapper.get('.status-line button').trigger('click')
  const scan = maintenanceDialog().findAll('button').find(item => item.text() === '重新扫描歌曲')!
  expect(scan.element.disabled).toBe(true)
  await scan.trigger('click')
  expect(wrapper.emitted('scan')).toBeUndefined()
})

it('单列文件总数无法推出歌曲数，读取到真实零首才显示零', async () => {
  renderRow({ summary: { ...summary, quality: { ...summary.quality!, songs: undefined } } })
  expect(wrapper.find('.song-count').exists()).toBe(false)
  await wrapper.setProps({ summary: { ...summary, quality: { ...summary.quality!, songs: 0 } } })
  expect(wrapper.get('.song-count').text()).toBe('0 首')
})

it('未进入视口的来源不查历史，键盘进入该来源时读取一次', async () => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
  renderRow()
  await flushPromises()
  expect(shareImports.latest).not.toHaveBeenCalled()
  await wrapper.get('button[aria-label="查看歌曲"]').trigger('focusin')
  await flushPromises()
  expect(shareImports.latest).toHaveBeenCalledExactlyOnceWith(source.id)
})
