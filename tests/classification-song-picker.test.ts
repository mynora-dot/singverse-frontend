// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ClassificationSongPicker from '../src/admin/modules/classification/components/ClassificationSongPicker.vue'
import { songs } from '../src/admin/modules/song-management/api/songs'
import { classification } from '../src/admin/modules/classification/api/classification'
import type { MediaSong, MediaSource, SongPage } from '../src/admin/modules/media-library/types'
import type { Tag } from '../src/admin/modules/classification/types'
import { preview } from './fixtures/filename-workspace'
vi.mock('../src/admin/modules/song-management/api/songs')
vi.mock('../src/admin/modules/classification/api/classification')
let wrapper: VueWrapper
function song(index: number): MediaSong { return { id: `song-${index}`, sourceId: 'source-1', sourceName: '隔离曲库', relativePath: `歌手-歌曲${index}.mp3`, fileSize: 10, modifiedAt: null, scannedAt: '', parserProfileId: 'default', parserRevision: 0, selectedRuleId: null, result: { ...preview().result, title: `歌曲${index}`, artists: ['测试歌手'] } } }
const first = Array.from({ length: 20 }, (_, i) => song(i + 1))
function result(items = first, page = 0, totalElements = 21): SongPage { return { items, page, size: 20, totalElements } }
const button = (name: string) => wrapper.findAll('button').find(b => b.text() === name)!
async function open(ids: string[] = [], purpose?: string) { wrapper = mount(ClassificationSongPicker, { props: { selectedIds: ids, purpose }, attachTo: document.body }); await flushPromises() }
async function query(q: string) { await wrapper.get('input[aria-label="搜索歌名或歌手"]').setValue(q); await wrapper.get('form').trigger('submit'); await flushPromises() }
async function page(n: number) { wrapper.findComponent({ name: 'ElPagination' }).vm.$emit('current-change', n); await flushPromises() }
async function scope(unclassified: boolean) { await button(unclassified ? '未分类' : '全部歌曲').trigger('click'); await flushPromises() }
async function more() { await button('更多筛选').trigger('click'); await flushPromises() }
const sources: MediaSource[] = ['本地歌曲', 'WebDAV 歌曲'].map((name, i) => ({ id: `source-${i + 1}`, name, type: i ? 'WEBDAV' : 'LOCAL', location: '', username: '', parserProfileId: 'default', passwordConfigured: false, createdAt: '', updatedAt: '' }))
const tags: Tag[] = [
  { id: 'language-1', dimension: 'LANGUAGE', name: '国语', aliases: [], active: true, revision: 1, count: 2 },
  { id: 'genre-1', dimension: 'GENRE', name: '流行', aliases: [], active: true, revision: 1, count: 1 },
  { id: 'inactive', dimension: 'MOOD', name: '停用标签', aliases: [], active: false, revision: 1, count: 1 },
]
const select = (selector: string) => wrapper.findAllComponents({ name: 'ElSelect' }).find(component => component.classes().includes(selector.slice(1)))!
async function filter(selector: string, value: unknown) {
  if (!select(selector)) await more()
  const component = select(selector)
  component.vm.$emit('update:modelValue', value); component.vm.$emit('change', value); await flushPromises()
}
beforeEach(() => {
  vi.mocked(songs.list).mockImplementation(async filters => filters.search ? result([song(21)], 0, 1) : filters.page ? result([song(21)], 1) : result())
  vi.mocked(songs.sources).mockResolvedValue(sources)
  vi.mocked(classification.tags).mockResolvedValue(tags)
})
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = ''; vi.clearAllMocks() })
it('搜索和跨页保留勾选，确认只返回已选歌曲 ID', async () => {
  await open(['song-1'])
  await wrapper.get('input[aria-label="选择歌曲：歌曲2"]').setValue(true)
  await page(2); await wrapper.get('input[aria-label="选择歌曲：歌曲21"]').setValue(true)
  await query('测试歌手')
  expect(songs.list).toHaveBeenLastCalledWith(expect.objectContaining({ q: '', search: '测试歌手', status: 'ALL', page: 0, size: 20 }))
  expect((wrapper.get('input[aria-label="选择歌曲：歌曲21"]').element as HTMLInputElement).checked).toBe(true)
  await button('确认选择（3 首）').trigger('click')
  expect(wrapper.emitted('confirm')).toEqual([[['song-1', 'song-2', 'song-21']]])
})
it('取消和清空只修改弹窗草稿，不覆盖原有选择', async () => {
  const ids = ['song-1']; await open(ids)
  await button('清空已选').trigger('click'); await button('取消').trigger('click')
  expect(ids).toEqual(['song-1']); expect(wrapper.emitted('confirm')).toBeUndefined(); expect(wrapper.emitted('close')).toHaveLength(1)
})
it('选择本页和取消本页不会影响其他页已选歌曲', async () => {
  await open(); await wrapper.get('input[aria-label="选择本页歌曲"]').setValue(true)
  await page(2); await wrapper.get('input[aria-label="选择歌曲：歌曲21"]').setValue(true)
  await page(1); await wrapper.get('input[aria-label="选择本页歌曲"]').setValue(false)
  await button('确认选择（1 首）').trigger('click'); expect(wrapper.emitted('confirm')).toEqual([[['song-21']]])
})
it('读取失败可重试，搜索无结果保留已选歌曲', async () => {
  vi.mocked(songs.list).mockRejectedValueOnce(new Error('曲库暂时不可用'))
  await open(['song-1']); expect(wrapper.text()).toContain('曲库暂时不可用')
  await button('重新加载').trigger('click'); await flushPromises(); expect(wrapper.text()).toContain('歌曲1')
  vi.mocked(songs.list).mockResolvedValueOnce(result([], 0, 0)); await query('不存在的歌曲')
  expect(wrapper.text()).toContain('没有找到匹配的歌曲'); expect(wrapper.text()).toContain('已选 1 首')
})
it('迟到的搜索结果不会替换新搜索结果', async () => {
  await open(); let resolveOld!: (value: SongPage) => void
  vi.mocked(songs.list).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
  await query('旧查询'); await query('新查询')
  resolveOld(result([song(99)], 0, 1)); await flushPromises()
  expect(wrapper.text()).toContain('歌曲21'); expect(wrapper.text()).not.toContain('歌曲99')
})
it('选择有 5000 首上限，仍可取消选择并确认清空', async () => {
  await open(Array.from({ length: 5000 }, (_, i) => i === 0 ? 'song-1' : `selected-${i}`))
  expect(wrapper.get('input[aria-label="选择歌曲：歌曲2"]').attributes('disabled')).toBeDefined()
  expect(wrapper.get('input[aria-label="选择歌曲：歌曲1"]').attributes('disabled')).toBeUndefined()
  await button('清空已选').trigger('click'); await button('确认选择').trigger('click')
  expect(wrapper.emitted('confirm')).toEqual([[[]]])
})

it('媒体库和未分类组合查询，换页带上筛选且保留其他媒体库的已选歌曲', async () => {
  await open(['song-1']); await page(2)
  await filter('.picker-source-filter', 'source-2')
  expect(songs.list).toHaveBeenLastCalledWith(expect.objectContaining({ sourceId: 'source-2', unclassified: true, page: 0 }))
  await scope(false)
  expect(songs.list).toHaveBeenLastCalledWith(expect.not.objectContaining({ unclassified: true }))
  await scope(true)
  await page(2)
  expect(songs.list).toHaveBeenLastCalledWith(expect.objectContaining({ sourceId: 'source-2', unclassified: true, page: 1 }))
  await button('确认选择（1 首）').trigger('click')
  expect(wrapper.emitted('confirm')).toEqual([[['song-1']]])
})

it('按维度分组启用标签，和未分类双向互斥，避免冲突查询', async () => {
  await open(); await scope(false); await more()
  const groups = wrapper.findAllComponents({ name: 'ElOptionGroup' })
  expect(groups.map(group => group.props('label'))).toEqual(['语种', '风格'])
  expect(wrapper.findAllComponents({ name: 'ElOption' }).some(option => option.props('value') === 'inactive')).toBe(false)
  await filter('.picker-tag-filter', ['language-1', 'genre-1'])
  expect(songs.list).toHaveBeenLastCalledWith(expect.objectContaining({ tagIds: ['language-1', 'genre-1'] }))
  await scope(true)
  expect(wrapper.find('.picker-tag-filter').exists()).toBe(false)
  expect(songs.list).toHaveBeenLastCalledWith(expect.not.objectContaining({ tagIds: expect.anything() }))
  await scope(false)
  expect(select('.picker-tag-filter').props('modelValue')).toEqual([])
  await filter('.picker-tag-filter', ['genre-1'])
  expect(button('全部歌曲').attributes('aria-pressed')).toBe('true')
  expect(songs.list).toHaveBeenLastCalledWith(expect.objectContaining({ tagIds: ['genre-1'] }))
  expect(songs.list).toHaveBeenLastCalledWith(expect.not.objectContaining({ unclassified: true }))
})

it('文件名识别状态与关键词组合，重置筛选保留选择', async () => {
  await open(['song-1'])
  await filter('.picker-source-filter', 'source-2')
  await filter('.picker-status-filter', 'MATCHED'); await query('测试歌手')
  expect(songs.list).toHaveBeenLastCalledWith(expect.objectContaining({ sourceId: 'source-2', search: '测试歌手', status: 'MATCHED', page: 0 }))
  await page(2); await button('重置筛选').trigger('click'); await flushPromises()
  expect(songs.list).toHaveBeenLastCalledWith({ q: '', search: '', sourceId: '', status: 'ALL', page: 0, size: 20, unclassified: true })
  expect(button('未分类').attributes('aria-pressed')).toBe('true')
  expect(wrapper.find('.picker-filters').exists()).toBe(false)
  expect(wrapper.text()).toContain('已选 1 首')
})

it('筛选没有结果时可一键清除，不误报曲库为空', async () => {
  await open(['song-1'])
  vi.mocked(songs.list).mockResolvedValueOnce(result([], 0, 0))
  await filter('.picker-source-filter', 'source-2')
  expect(wrapper.text()).toContain('没有找到匹配的歌曲')
  expect(wrapper.text()).not.toContain('曲库中还没有歌曲')
  await button('清除筛选').trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('歌曲1'); expect(wrapper.text()).toContain('已选 1 首')
})

it('媒体库或标签加载失败不阻塞选歌，并支持单独重试', async () => {
  vi.mocked(songs.sources).mockRejectedValueOnce(new Error('网络错误'))
  vi.mocked(classification.tags).mockRejectedValueOnce(new Error('网络错误'))
  await open()
  expect(wrapper.text()).toContain('媒体库读取失败'); expect(wrapper.text()).not.toContain('分类标签读取失败')
  await wrapper.get('input[aria-label="选择歌曲：歌曲1"]').setValue(true)
  await scope(false); await more()
  expect(wrapper.text()).toContain('分类标签读取失败')
  await button('重试媒体库').trigger('click'); await button('重试标签').trigger('click'); await flushPromises()
  expect(songs.sources).toHaveBeenCalledTimes(2); expect(classification.tags).toHaveBeenCalledTimes(2)
  expect(wrapper.text()).not.toContain('读取失败'); expect(wrapper.text()).toContain('已选 1 首')
})

it('迟到的媒体库筛选响应不会覆盖新筛选', async () => {
  await open(); let resolveOld!: (value: SongPage) => void
  vi.mocked(songs.list).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
  await filter('.picker-source-filter', 'source-1')
  vi.mocked(songs.list).mockResolvedValueOnce(result([song(21)], 0, 1))
  await filter('.picker-source-filter', 'source-2')
  resolveOld(result([song(99)], 0, 1)); await flushPromises()
  expect(wrapper.text()).toContain('歌曲21'); expect(wrapper.text()).not.toContain('歌曲99')
})

it('歌单选歌保持独立流程和500首上限，不加载分类专用筛选', async () => {
  await open([], 'playlist')
  expect(wrapper.text()).toContain('选择歌单歌曲'); expect(wrapper.text()).toContain('最多 500 首')
  expect(wrapper.find('.picker-filters').exists()).toBe(false)
  expect(songs.sources).not.toHaveBeenCalled(); expect(classification.tags).not.toHaveBeenCalled()
  expect(songs.list).toHaveBeenCalledWith(expect.not.objectContaining({ unclassified: true }))
  await wrapper.get('input[aria-label="选择歌曲：歌曲1"]').setValue(true)
  await button('确认选择（1 首）').trigger('click')
  expect(wrapper.emitted('selectedSongs')?.[0]?.[0]).toEqual([song(1)])
})

it('分类选歌默认查询未分类，主入口常显，高级筛选默认收起', async () => {
  await open()
  expect(songs.list).toHaveBeenCalledWith(expect.objectContaining({ unclassified: true, page: 0 }))
  expect(button('未分类').attributes('aria-pressed')).toBe('true')
  expect(button('全部歌曲').attributes('aria-pressed')).toBe('false')
  expect(wrapper.find('.picker-source-filter').exists()).toBe(true)
  expect(wrapper.find('.picker-filters').exists()).toBe(false)
  expect(button('更多筛选').attributes('aria-expanded')).toBe('false')
})

it('没有未分类歌曲时明确显示空状态，可查看全部且保留已选', async () => {
  vi.mocked(songs.list).mockResolvedValueOnce(result([], 0, 0))
  await open(['song-1'])
  expect(wrapper.text()).toContain('没有未分类的歌曲')
  expect(wrapper.text()).not.toContain('曲库中还没有歌曲')
  await button('查看全部歌曲').trigger('click'); await flushPromises()
  expect(songs.list).toHaveBeenLastCalledWith(expect.not.objectContaining({ unclassified: true }))
  expect(button('全部歌曲').attributes('aria-pressed')).toBe('true')
  expect(wrapper.text()).toContain('已选 1 首')
})

it('收起高级筛选保留条件，入口显示已用筛选数量', async () => {
  await open(); await filter('.picker-status-filter', 'REVIEW')
  await button('收起筛选（1）').trigger('click'); await flushPromises()
  expect(wrapper.find('.picker-status-filter').exists()).toBe(false)
  expect(button('更多筛选（1）').attributes('aria-expanded')).toBe('false')
  await query('复核')
  expect(songs.list).toHaveBeenLastCalledWith(expect.objectContaining({ search: '复核', status: 'REVIEW', unclassified: true }))
})
