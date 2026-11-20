// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import MediaSourceCard from '../src/admin/modules/media-library/components/MediaSourceCard.vue'
import type { EmbeddedSummary } from '../src/admin/modules/media-library/api/embeddedMetadata'
import type { MediaSource, ScanTask } from '../src/admin/modules/media-library/types'

const source: MediaSource = { id: 'remote', name: 'WebDAV 歌曲', type: 'WEBDAV', location: 'https://nas.example.invalid/%E6%AD%8C%E6%9B%B2/', username: '', parserProfileId: 'default', passwordConfigured: true, createdAt: '', updatedAt: '' }
const summary: EmbeddedSummary = {
  quality: { songs: 17, variants: 19, files: 21, total: 21, identityComplete: 16, informationMissing: 1, pendingVerification: 0, mediaIssues: 0 },
  enabled: false, paused: false, accessGroup: '', privateOrigins: [], emptyScans: 0, canConfirmEmpty: false,
  counts: {}, presence: {}, budget: { files_started: 0, bytes_read: 0 },
}
function task(status: ScanTask['status']): ScanTask {
  return { id: 'task', sourceId: source.id, status, phase: 'SCANNING', directories: 1, entries: 21, totalSongs: 17, matchedSongs: 16, needsReviewSongs: 1, skippedFiles: 0, cancelRequested: false, error: status === 'FAILED' ? '目录读取失败，旧索引已保留' : null, createdAt: '', startedAt: '', finishedAt: null }
}
let wrapper: VueWrapper
function render(props: Partial<InstanceType<typeof MediaSourceCard>['$props']> = {}) {
  wrapper = mount(MediaSourceCard, { props: { source, profileName: '默认解析方案', ...props }, attachTo: document.body })
  return wrapper
}
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = ''; vi.restoreAllMocks() })

it('区分歌曲、版本和文件数量，只突出非零待处理事项并提供完善入口', async () => {
  render({ summary })
  expect(wrapper.findAll('.source-metrics dd').map(metric => metric.text())).toEqual(['17', '19', '21', '16'])
  expect(wrapper.get('.source-attention').text()).toContain('1 首歌曲信息不足')
  expect(wrapper.get('.source-attention').text()).not.toContain('路径待核验')
  expect(wrapper.get('.source-attention').text()).not.toContain('媒体待处理')
  expect(wrapper.get('.source-location').text()).toBe('https://nas.example.invalid/歌曲/')
  await wrapper.get('.source-attention button').trigger('click')
  expect(wrapper.emitted('metadata')).toHaveLength(1)
})

it('尚未读取统计时不伪造零值，兼容旧统计字段且保留真实零值', async () => {
  render()
  expect(wrapper.find('.source-metrics').exists()).toBe(false)
  await wrapper.setProps({ summary: { ...summary, quality: { total: 9, identityComplete: 9, informationMissing: 0, pendingVerification: 0, mediaIssues: 0 } } })
  expect(wrapper.findAll('.source-metrics dd').map(metric => metric.text())).toEqual(['9', '9', '9', '9'])
  expect(wrapper.find('.source-attention').exists()).toBe(false)
  await wrapper.setProps({ summary: { ...summary, quality: { ...summary.quality!, songs: 0, variants: 0, files: 0 } } })
  expect(wrapper.findAll('.source-metrics dd').slice(0, 3).map(metric => metric.text())).toEqual(['0', '0', '0'])
})

it('扫描进行时自动展开并支持取消，完成后收起明细仍显示复核数量', async () => {
  render({ task: task('RUNNING') })
  expect(wrapper.get('.source-scan-details').attributes('open')).toBeDefined()
  expect(wrapper.get('[role="status"]').text()).toBe('正在扫描目录')
  await wrapper.get('.scan-progress button').trigger('click')
  expect(wrapper.emitted('cancelScan')).toHaveLength(1)
  await wrapper.setProps({ task: task('SUCCEEDED') })
  expect(wrapper.get('.source-scan-details').attributes('open')).toBeUndefined()
  expect(wrapper.get('[role="status"]').text()).toBe('扫描完成')
  expect(wrapper.get('.source-scan-details summary').text()).toContain('1 首需复核')
})

it('折叠扫描明细时仍直接显示失败原因，避免重复显示同一错误', () => {
  const failed = task('FAILED')
  render({ task: failed, source: { ...source, lastScanError: failed.error }, taskError: '网络断开' })
  expect(wrapper.get('.source-scan-details').attributes('open')).toBeUndefined()
  expect(wrapper.findAll('.scan-error').map(error => error.text())).toEqual(['目录读取失败，旧索引已保留', '状态读取失败：网络断开，正在重试'])
  expect(wrapper.get('.scan-error').element.closest('details')).toBeNull()
})

it('分享资料直接显示，更多菜单移除重复入口并回传正确事件', async () => {
  render()
  const actions = wrapper.get('.source-actions')
  expect(actions.findAll('button').map(button => button.text())).toEqual(['查看歌曲', '分享资料', ''])
  await actions.findAll('button')[1]!.trigger('click')
  expect(wrapper.emitted('metadata')).toHaveLength(1)
  await wrapper.get('button[aria-label="WebDAV 歌曲的更多操作"]').trigger('click')
  await flushPromises()
  const menu = document.body.querySelector('[role="menu"]')!
  expect(menu).not.toBeNull()
  expect(menu.closest('.source-card')).toBeNull()
  const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')]
  expect(items.map(item => item.textContent?.trim())).toEqual(['扫描歌曲', '编辑', '移除'])
  items[1]!.click()
  await flushPromises()
  expect(wrapper.emitted('edit')).toHaveLength(1)
  expect(wrapper.get('button[aria-label="WebDAV 歌曲的更多操作"]').attributes('aria-expanded')).toBe('false')
})

it('后台入库期间显示当前状态，并阻止重复发起扫描', async () => {
  render({ task: task('SUCCEEDED'), ingest: { state: 'RUNNING' } })
  expect(wrapper.get('.source-status').text()).toBe('正在后台入库')
  await wrapper.get('button[aria-label="WebDAV 歌曲的更多操作"]').trigger('click')
  await flushPromises()
  const scan = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent?.trim() === '扫描歌曲')!
  expect(scan.getAttribute('aria-disabled')).toBe('true')
  scan.click()
  expect(wrapper.emitted('scan')).toBeUndefined()
})
