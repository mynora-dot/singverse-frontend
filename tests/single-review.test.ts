// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { ElMessageBox } from 'element-plus'
import SingleSongScrapeDialog from '../src/admin/modules/metadata/components/SingleSongScrapeDialog.vue'
import { useSingleSongScrape } from '../src/admin/modules/metadata/composables/useSingleSongScrape'
import { metadata } from '../src/admin/modules/metadata/api/metadata'
import { singleReview } from '../src/admin/modules/metadata/api/single-review'
import { preview } from './fixtures/filename-workspace'
import type { SingleReview, ReviewResult } from '../src/admin/modules/metadata/single-types'
import type { MetadataCandidate } from '../src/admin/modules/metadata/types'
import SingleCoverPicker from '../src/admin/modules/metadata/components/SingleCoverPicker.vue'
vi.mock('../src/admin/modules/metadata/api/single-review', () => ({ singleReview: { load: vi.fn(), apply: vi.fn(), covers: vi.fn(), upload: vi.fn(), assetUrl: (id: string) => `/api/v1/metadata/cover-assets/${id}` } }))
vi.mock('../src/admin/modules/metadata/api/metadata', () => ({ metadata: { settings: vi.fn(), search: vi.fn(), candidateCover: (id: string, quality?: string) => `/api/v1/metadata/candidates/${id}/cover${quality ? `?quality=${quality}` : ''}`, songCover: (id: string) => `/api/v1/metadata/songs/${id}/cover` } }))
function context(): SingleReview { return { song: { id: 'song-1', sourceId: 'source', sourceName: '家庭曲库', relativePath: '歌手《歌名》.mkv', fileSize: 2000, modifiedAt: null, scannedAt: '', parserProfileId: 'default', parserRevision: 0, selectedRuleId: null, result: preview().result }, fingerprint: 'fingerprint', version: 'version', values: { title: '歌名', artists: ['歌手'], album: null, releaseDate: null, aliases: [], durationMs: null, cover: null } } }
function result(): ReviewResult { return { metadata: null, before: context().values, after: { ...context().values, title: '手工歌名' }, updated: ['title'], skipped: [], retained: ['artists', 'album', 'releaseDate', 'aliases', 'durationMs', 'cover'] } }
const candidate: MetadataCandidate = { id: 'candidate', score: .95, track: { provider: 'QQ', externalId: 'id', title: '歌名', artists: ['歌手'], album: '新专辑', releaseDate: null, aliases: [], durationMs: null, coverUrl: null, availability: 'UNKNOWN', fetchedAt: '' } }
let wrapper: VueWrapper | undefined
beforeEach(() => {
  vi.mocked(singleReview.load).mockResolvedValue(context())
  vi.mocked(metadata.settings).mockResolvedValue({ enabled: false, providers: ['QQ'], autoApply: false, threshold: .95 })
  vi.mocked(metadata.search).mockResolvedValue({ candidates: [candidate], errors: [] })
  vi.mocked(singleReview.apply).mockResolvedValue(result())
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined; document.body.innerHTML = ''; vi.clearAllMocks(); vi.restoreAllMocks() })
it('没有平台也能编辑并真实提交，成功使用服务端反馈', async () => {
  const response = result()
  response.metadata = { track: { provider: null, externalId: null, title: '手工歌名', artists: ['歌手'], album: null, releaseDate: null, aliases: [], durationMs: null, coverUrl: null, availability: 'UNKNOWN', fetchedAt: '' }, fields: ['title', 'artists'], origins: {}, appliedAt: '2026-11-19T10:00:00Z', stale: false }
  vi.mocked(singleReview.apply).mockResolvedValue(response)
  wrapper = mount(SingleSongScrapeDialog, { props: { song: context().song }, global: { stubs: { teleport: true } } })
  await flushPromises()
  expect(wrapper.get('.review-workspace').classes()).toContain('review-mode')
  expect(wrapper.get('[aria-label="审核工作区"] [role="tab"][aria-selected="true"]').text()).toContain('字段核对')
  expect(metadata.search).not.toHaveBeenCalled()
  const edit = wrapper.findAll('button').find(b => b.text() === '编辑歌曲资料')!
  await edit.trigger('click'); await flushPromises()
  await wrapper.get('input[aria-label="编辑歌名"]').setValue('手工歌名')
  await wrapper.findAll('button').find(b => b.text() === '保存编辑到草稿')!.trigger('click'); await flushPromises()
  expect(singleReview.apply).not.toHaveBeenCalled()
  const apply = wrapper.findAll('button').find(b => b.text() === '确认应用（1 项）')!
  await apply.trigger('click'); await flushPromises()
  expect(singleReview.apply).toHaveBeenCalledWith('song-1', expect.objectContaining({ candidateId: null, fields: ['title'], edits: { title: '手工歌名' }, fingerprint: 'fingerprint', version: 'version' }))
  expect(wrapper.text()).toContain('歌曲资料已应用成功')
  expect(wrapper.text()).toContain('本次更新 1 项')
  expect(wrapper.emitted('applied')).toHaveLength(1)
  expect(wrapper.emitted('applied')![0]).toEqual([expect.objectContaining({ id: 'song-1', metadata: response.metadata })])
})
it('候选高分仍需确认，计数排除未变化和缺失字段', async () => {
  const state = useSingleSongScrape(); await state.open('song-1'); state.choose(candidate)
  expect(state.changed.value).toEqual(['album'])
  expect(singleReview.apply).not.toHaveBeenCalled()
  state.fields.value = []
  await state.apply(); expect(singleReview.apply).not.toHaveBeenCalled()
})
it('切换酷狗候选后，列表、待应用预览和提交使用同一封面候选与画质', async () => {
  vi.mocked(metadata.settings).mockResolvedValue({ enabled: true, providers: ['KUGOU'], autoApply: false, threshold: .95 })
  const album: MetadataCandidate = { ...candidate, id: 'album', track: { ...candidate.track, provider: 'KUGOU', coverUrl: 'https://imge.kugou.com/stdmusic/0/album.jpg' } }
  const portrait: MetadataCandidate = { ...candidate, id: 'portrait', track: { ...candidate.track, provider: 'KUGOU', coverUrl: 'https://singerimg.kugou.com/uploadpic/softhead/0/20230804/a.jpg' } }
  vi.mocked(metadata.search).mockResolvedValue({ candidates: [album, portrait], errors: [] })
  wrapper = mount(SingleSongScrapeDialog, { props: { song: context().song }, global: { stubs: { teleport: true } } }); await flushPromises()
  const choices = wrapper.findAll('.review-candidate')
  expect(wrapper.find('img[alt="待核对封面"]').exists()).toBe(false)
  expect(wrapper.text()).toContain('多个候选分数接近')
  await choices[1]!.trigger('click'); await flushPromises()
  expect(wrapper.get('img[alt="待核对封面"]').attributes('src')).toBe('/api/v1/metadata/candidates/portrait/cover?quality=ORIGINAL')
  expect(wrapper.get('img[alt="待核对封面"]').attributes('src')).toBe(choices[1]!.get('img[alt="候选歌曲封面"]').attributes('src'))
  expect(singleReview.apply).not.toHaveBeenCalled()
  await wrapper.get('.footer-actions .el-button--primary').trigger('click'); await flushPromises()
  expect(singleReview.apply).toHaveBeenCalledWith('song-1', expect.objectContaining({ candidateId: 'portrait', coverCandidateId: 'portrait', coverQuality: 'ORIGINAL', fields: expect.arrayContaining(['cover']) }))
})
it('高相似度候选自动选中但只有确认才应用', async () => {
  vi.mocked(metadata.settings).mockResolvedValue({ enabled: true, providers: ['QQ'], autoApply: false, threshold: .95 })
  const state = useSingleSongScrape(); await state.open('song-1')
  expect(metadata.search).toHaveBeenCalledWith('song-1', '歌名 歌手', ['QQ'], expect.any(AbortSignal))
  expect(state.selected.value?.id).toBe('candidate'); expect(state.autoSelected.value).toBe(true)
  expect(singleReview.apply).not.toHaveBeenCalled()
  await state.apply()
  expect(singleReview.apply).toHaveBeenCalledWith('song-1', expect.objectContaining({ candidateId: 'candidate', fields: ['album'] }))
})
it('批次阈值控制自动预览，同分候选需主动选择且不自动提交', async () => {
  const state = useSingleSongScrape()
  await state.open('song-1', [candidate], .96)
  expect(state.selected.value).toBeNull(); expect(state.changed.value).toEqual([])
  const second = { ...candidate, id: 'second' }
  await state.open('song-1', [candidate, second], .95)
  expect(state.selected.value).toBeNull(); expect(state.autoSelected.value).toBe(false)
  expect(state.changed.value).toEqual([]); expect(state.dirty.value).toBe(false)
  state.choose(second)
  expect(state.selected.value?.id).toBe('second'); expect(state.autoSelected.value).toBe(false)
  expect(singleReview.apply).not.toHaveBeenCalled()
})
it('请求失败保留草稿，安全重试复用提交标识', async () => {
  const state = useSingleSongScrape(); await state.open('song-1'); state.saveEdits({ ...context().values, title: '手工歌名' })
  vi.mocked(singleReview.apply).mockRejectedValueOnce(new Error('连接失败'))
  await state.apply(); const first = vi.mocked(singleReview.apply).mock.calls[0]![1]
  expect(state.draft.value?.title).toBe('手工歌名'); expect(state.result.value).toBeNull()
  await state.apply(); expect(vi.mocked(singleReview.apply).mock.calls[1]![1].requestId).toBe(first.requestId)
})
it('关闭或换曲后的迟到请求不会覆盖当前歌曲', async () => {
  let resolve!: (value: SingleReview) => void
  vi.mocked(singleReview.load).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const state = useSingleSongScrape(); const pending = state.open('old')
  await state.open('new'); resolve({ ...context(), version: 'old' }); await pending
  expect(state.review.value?.version).toBe('version')
})
it('未应用草稿关闭时确认，取消确认后保留编辑', async () => {
  vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
  wrapper = mount(SingleSongScrapeDialog, { props: { song: context().song }, global: { stubs: { teleport: true } } }); await flushPromises()
  await wrapper.findAll('button').find(b => b.text() === '编辑歌曲资料')!.trigger('click'); await flushPromises()
  await wrapper.get('input[aria-label="编辑专辑"]').setValue('草稿专辑')
  await wrapper.findAll('button').find(b => b.text() === '保存编辑到草稿')!.trigger('click'); await flushPromises()
  await wrapper.findAll('button').find(b => b.text() === '取消')!.trigger('click'); await flushPromises()
  expect(ElMessageBox.confirm).toHaveBeenCalledWith(expect.any(String), '有尚未应用的修改', expect.objectContaining({ customClass: 'discard-message-box', closeOnClickModal: false }))
  expect(wrapper.emitted('close')).toBeUndefined()
  expect(wrapper.text()).toContain('草稿专辑')
  vi.mocked(ElMessageBox.confirm).mockResolvedValueOnce('confirm' as Awaited<ReturnType<typeof ElMessageBox.confirm>>)
  await wrapper.findAll('button').find(b => b.text() === '取消')!.trigger('click'); await flushPromises()
  expect(wrapper.emitted('close')).toHaveLength(1)
  expect(singleReview.apply).not.toHaveBeenCalled()
})
it('未选字段不提交，上传封面加入真实变更摘要', async () => {
  const state = useSingleSongScrape(); await state.open('song-1')
  state.chooseCover({ kind: 'asset', id: 'asset', value: 'asset:asset', url: '/api/v1/metadata/cover-assets/asset', label: '已上传' })
  expect(state.changed.value).toEqual(['cover'])
  await state.apply()
  expect(singleReview.apply).toHaveBeenCalledWith('song-1', expect.objectContaining({ coverAssetId: 'asset', coverCandidateId: null, fields: ['cover'] }))
})
it('总开关关闭时配置中的平台不会显示为可选或已勾选，未搜索不显示结果数', async () => {
  wrapper = mount(SingleSongScrapeDialog, { props: { song: context().song }, global: { stubs: { teleport: true } } }); await flushPromises()
  const platforms = wrapper.find('.platform-select').findAll('input[type=checkbox]')
  expect(platforms).toHaveLength(6)
  for (const input of platforms) { expect((input.element as HTMLInputElement).checked).toBe(false); expect((input.element as HTMLInputElement).disabled).toBe(true) }
  expect(wrapper.text()).toContain('尚未搜索')
  expect(wrapper.text()).not.toContain('0 条结果')
  expect(wrapper.text()).toContain('打开音乐平台设置')
  expect(wrapper.text()).toContain('手工编辑歌曲资料')
  expect(wrapper.text()).toContain('选择或上传封面')
  expect(wrapper.findAll('button').find(b => b.text() === '重新搜索')!.attributes('disabled')).toBeDefined()
})

it.each(['KUGOU', 'KUWO', 'QISHUI', 'MIGU'] as const)('单曲匹配真实提交所选的 %s 平台，仍需确认后应用', async provider => {
  vi.mocked(metadata.settings).mockResolvedValue({ enabled: true, providers: [provider], autoApply: false, threshold: .95 })
  const state = useSingleSongScrape()
  await state.open('song-1')
  expect(metadata.search).toHaveBeenCalledWith('song-1', '歌名 歌手', [provider], expect.any(AbortSignal))
  expect(singleReview.apply).not.toHaveBeenCalled()
})

it('封面窗口可独立选择新增平台和原图/高清，画质与草稿一起提交', async () => {
  const withCover: MetadataCandidate = { ...candidate, track: { ...candidate.track, provider: 'QISHUI', coverUrl: 'https://p3-luna.douyinpic.com/img/a~tplv-test-image.image' } }
  const props = { open: false, songId: 'song-1', fingerprint: 'fingerprint', keyword: '歌名 歌手', candidates: [withCover], providers: ['QISHUI' as const], available: ['QISHUI' as const, 'KUWO' as const, 'KUGOU' as const], enabled: true, currentUrl: null, currentValue: null, selection: null }
  vi.mocked(singleReview.covers).mockResolvedValue({ items: [], errors: [] })
  wrapper = mount(SingleCoverPicker, { props, global: { stubs: { teleport: true } } })
  await wrapper.setProps({ open: true }); await flushPromises()
  expect(wrapper.get('[aria-label="平台封面画质"] button[aria-pressed="true"]').text()).toBe('原图')
  await wrapper.get('.cover-grid > button').trigger('click')
  await wrapper.findAll('[aria-label="平台封面画质"] button').find(button => button.text() === '高清')!.trigger('click')
  await wrapper.findAll('button').find(button => button.text() === '使用此封面')!.trigger('click')
  const selected = wrapper.emitted('select')![0]![0]
  expect(selected).toMatchObject({ quality: 'HIGH', value: 'https://p3-luna.douyinpic.com/img/a~tplv-test-resize:2048:2048.png' })
  const state = useSingleSongScrape(); await state.open('song-1'); state.chooseCover(selected as never); await state.apply()
  expect(singleReview.apply).toHaveBeenCalledWith('song-1', expect.objectContaining({ coverCandidateId: 'candidate', coverQuality: 'HIGH', fields: ['cover'] }))
  await wrapper.findAll('.cover-platforms label').find(label => label.text().includes('酷我音乐'))!.get('input').setValue(true)
  await wrapper.find('form.cover-search').trigger('submit'); await flushPromises()
  expect(singleReview.covers).toHaveBeenCalledWith('song-1', '歌名 歌手', ['QISHUI'], expect.any(AbortSignal))
  expect(singleReview.covers).toHaveBeenCalledWith('song-1', '歌名 歌手', ['KUWO'], expect.any(AbortSignal))
})

async function pendingCoverSearch() {
  type Result = Awaited<ReturnType<typeof singleReview.covers>>
  let quick!: (value: Result) => void, late!: (value: Result) => void
  const fast = new Promise<Result>(resolve => { quick = resolve }), slow = new Promise<Result>(resolve => { late = resolve })
  vi.mocked(singleReview.covers).mockImplementation((_id, _keyword, providers) => providers[0] === 'QQ' ? fast : slow)
  wrapper = mount(SingleCoverPicker, { props: { open: false, songId: 'song-1', fingerprint: 'fingerprint', keyword: '歌名 歌手', candidates: [], providers: ['QQ', 'QISHUI'], enabled: true, currentUrl: null, currentValue: null, selection: null }, global: { stubs: { teleport: true } } })
  await wrapper.setProps({ open: true }); await flushPromises()
  await wrapper.get('form.cover-search').trigger('submit'); await flushPromises()
  const item: Result['items'][number] = { candidateId: 'quick-cover', provider: 'QQ', externalId: '1', title: '快结果', artists: ['歌手'], album: null, coverUrl: 'https://y.gtimg.cn/cover.jpg', width: null, height: null }
  return { quick, late, item }
}

it('更多封面同时查平台、先显示快结果，查询中可以确认且晚结果保留已选封面', async () => {
  const { quick, late, item } = await pendingCoverSearch()
  expect(singleReview.covers).toHaveBeenCalledTimes(2)
  quick({ items: [item], errors: [] }); await flushPromises()
  expect(wrapper!.text()).toContain('1 / 2 个平台')
  expect(wrapper!.findAll('.cover-grid > button')).toHaveLength(1)
  await wrapper!.get('.cover-grid > button').trigger('click')
  const confirm = wrapper!.findAll('button').find(b => b.text() === '使用此封面')!
  expect(confirm.attributes('disabled')).toBeUndefined()
  late({ items: [{ ...item, candidateId: 'late-cover', provider: 'QISHUI', title: '慢结果' }], errors: [] }); await flushPromises()
  expect(wrapper!.get('.cover-grid > button[aria-pressed="true"]').text()).toContain('快结果')
  await confirm.trigger('click')
  expect(wrapper!.emitted('select')![0]![0]).toMatchObject({ id: 'quick-cover' })
})

it.each(['close', 'song'] as const)('封面窗口关闭或切歌后取消平台请求并丢弃迟到结果：%s', async mode => {
  const { quick, late, item } = await pendingCoverSearch()
  const signals = vi.mocked(singleReview.covers).mock.calls.map(call => call[3]!)
  if (mode === 'close') await wrapper!.setProps({ open: false })
  else await wrapper!.setProps({ songId: 'song-2', fingerprint: 'changed' })
  expect(signals.every(signal => signal.aborted)).toBe(true)
  quick({ items: [item], errors: [] }); late({ items: [{ ...item, candidateId: 'late' }], errors: [] }); await flushPromises()
  expect(wrapper!.findAll('.cover-grid > button')).toHaveLength(0)
})
it('平台已启用时真实空结果和请求失败有不同状态，部分失败保留成功候选', async () => {
  vi.mocked(metadata.settings).mockResolvedValue({ enabled: true, providers: ['QQ'], autoApply: false, threshold: .95 })
  vi.mocked(metadata.search).mockResolvedValueOnce({ candidates: [], errors: [] })
  wrapper = mount(SingleSongScrapeDialog, { props: { song: context().song }, global: { stubs: { teleport: true } } }); await flushPromises()
  expect(wrapper.text()).toContain('未找到匹配结果'); expect(wrapper.text()).toContain('0 条结果')
  vi.mocked(metadata.search).mockRejectedValueOnce(new Error('平台连接失败'))
  await wrapper.find('form.workspace-search').trigger('submit'); await flushPromises()
  expect(wrapper.text()).toContain('平台请求失败'); expect(wrapper.text()).not.toContain('未找到匹配结果')
  vi.mocked(metadata.search).mockResolvedValueOnce({ candidates: [candidate], errors: [{ provider: 'NETEASE', message: '冷却中' }] })
  await wrapper.find('form.workspace-search').trigger('submit'); await flushPromises()
  expect(wrapper.text()).toContain('冷却中'); expect(wrapper.findAll('.review-candidate')).toHaveLength(1)
})
it('重新搜索立即清除旧候选、封面和字段，取消候选恢复当前入库值', async () => {
  vi.mocked(metadata.settings).mockResolvedValue({ enabled: true, providers: ['QQ'], autoApply: false, threshold: .95 })
  const state = useSingleSongScrape(); await state.open('song-1'); state.choose(candidate)
  expect(state.preview.value?.album).toBe('新专辑')
  state.clearSelection(); expect(state.preview.value).toEqual(context().values); expect(state.changed.value).toEqual([])
  state.choose(candidate)
  let finish!: (value: { candidates: MetadataCandidate[]; errors: [] }) => void
  vi.mocked(metadata.search).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pending = state.search()
  expect(state.selected.value).toBeNull(); expect(state.cover.value).toBeNull(); expect(state.fields.value).toEqual([])
  expect(state.preview.value).toEqual(context().values)
  finish({ candidates: [], errors: [] }); await pending
  expect(state.selected.value).toBeNull()
})
it('字段取消应用保留候选对照，摘要只含实际勾选变更', async () => {
  vi.mocked(metadata.settings).mockResolvedValue({ enabled: true, providers: ['QQ'], autoApply: false, threshold: .95 })
  wrapper = mount(SingleSongScrapeDialog, { props: { song: context().song }, global: { stubs: { teleport: true } } }); await flushPromises()
  await wrapper.get('.review-candidate').trigger('click'); await flushPromises()
  expect(wrapper.get('.review-workspace').classes()).toContain('review-mode')
  await wrapper.get('[aria-label="审核工作区"] button:last-child').trigger('click')
  expect(wrapper.get('.review-workspace').classes()).not.toContain('review-mode')
  expect(singleReview.apply).not.toHaveBeenCalled()
  await wrapper.get('[aria-label="审核工作区"] button:first-child').trigger('click')
  expect(wrapper.get('.field-comparison [data-field="album"]').text()).toContain('新专辑')
  await wrapper.get('[aria-label="应用专辑"] input').setValue(false); await flushPromises()
  expect(wrapper.get('.field-comparison [data-field="album"]').text()).toContain('新专辑')
  expect(wrapper.get('.field-comparison [data-field="album"]').classes()).not.toContain('field-selected')
  expect(wrapper.get('.field-comparison').text()).toContain('不应用')
  expect(wrapper.text()).toContain('确认应用（0 项）')
  expect(wrapper.get('.footer-actions .el-button--primary').attributes('disabled')).toBeDefined()
  expect(wrapper.get('.change-summary').text()).toContain('勾选需要应用的字段')
  expect(wrapper.find('.selected-preview').exists()).toBe(false)
  expect(wrapper.get('.field-comparison tbody tr:last-child').text()).toContain('封面')
})
it('候选页保存手工编辑后返回字段核对，封面保留在同一对照表中', async () => {
  wrapper = mount(SingleSongScrapeDialog, { props: { song: context().song }, global: { stubs: { teleport: true } } }); await flushPromises()
  await wrapper.get('[aria-label="审核工作区"] button:last-child').trigger('click')
  expect(wrapper.get('.review-workspace').classes()).not.toContain('review-mode')
  await wrapper.findAll('button').find(button => button.text() === '手工编辑歌曲资料')!.trigger('click'); await flushPromises()
  await wrapper.get('input[aria-label="编辑专辑"]').setValue('手工完善专辑')
  await wrapper.findAll('button').find(button => button.text() === '保存编辑到草稿')!.trigger('click'); await flushPromises()
  expect(wrapper.get('[role="tab"][aria-selected="true"]').text()).toContain('字段核对')
  expect(wrapper.get('.review-workspace').classes()).toContain('review-mode')
  expect(wrapper.get('[data-field="album"]').classes()).toContain('field-selected')
  expect(wrapper.get('[data-field="album"]').text()).toContain('手工完善专辑')
  expect(wrapper.get('[data-field="cover"] .cover-action').text()).toBe('选择封面')
  expect(wrapper.get('.change-summary').text()).toContain('将应用专辑')
  expect(singleReview.apply).not.toHaveBeenCalled()
})
it('仅根据服务端已更新的封面显示成功缩略图，失败反馈保留审核上下文', async () => {
  const response = result()
  response.updated = ['cover']; response.after.cover = 'asset:confirmed-id'
  vi.mocked(singleReview.apply).mockRejectedValueOnce(new Error('保存失败')).mockResolvedValueOnce(response)
  wrapper = mount(SingleSongScrapeDialog, { props: { song: context().song }, global: { stubs: { teleport: true } } }); await flushPromises()
  await wrapper.findAll('button').find(b => b.text() === '编辑歌曲资料')!.trigger('click'); await flushPromises()
  await wrapper.get('input[aria-label="编辑歌名"]').setValue('手工歌名')
  await wrapper.findAll('button').find(b => b.text() === '保存编辑到草稿')!.trigger('click'); await flushPromises()
  await wrapper.findAll('button').find(b => b.text() === '确认应用（1 项）')!.trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('保存失败'); expect(wrapper.text()).not.toContain('歌曲资料已应用成功')
  await wrapper.findAll('button').find(b => b.text() === '确认应用（1 项）')!.trigger('click'); await flushPromises()
  expect(wrapper.get('img[alt="已实际应用的歌曲封面"]').attributes('src')).toBe('/api/v1/metadata/cover-assets/confirmed-id')
  expect(wrapper.text()).toContain('封面已应用')
})

it('单曲搜索自动选择达到阈值的最高候选，预览更新但不自动写入', async () => {
  vi.mocked(metadata.settings).mockResolvedValue({ enabled: true, providers: ['QQ'], autoApply: false, threshold: .95 })
  vi.mocked(metadata.search).mockResolvedValue({ candidates: [{ ...candidate, score: .8, id: 'low' }, candidate, { ...candidate, score: .81, id: 'lower' }], errors: [] })
  const state = useSingleSongScrape(); await state.open('song-1')
  expect(state.selected.value?.id).toBe('candidate')
  expect(state.autoSelected.value).toBe(true)
  expect(state.preview.value?.album).toBe('新专辑')
  expect(state.changed.value).toEqual(['album'])
  expect(singleReview.apply).not.toHaveBeenCalled()
  state.clearSelection()
  expect(state.selected.value).toBeNull()
  expect(state.autoSelected.value).toBe(false)
  expect(state.changed.value).toEqual([])
  vi.mocked(metadata.search).mockResolvedValue({ candidates: [{ ...candidate, score: .94 }], errors: [] })
  await state.search()
  expect(state.selected.value).toBeNull()
  expect(singleReview.apply).not.toHaveBeenCalled()
})

it('待复核歌曲不再展示顶部说明，保留可操作的手工编辑入口', async () => {
  const review = context()
  review.song.result.needsReview = true
  vi.mocked(singleReview.load).mockResolvedValue(review)
  wrapper = mount(SingleSongScrapeDialog, { props: { song: review.song }, global: { stubs: { teleport: true } } })
  await flushPromises()
  expect(wrapper.text()).not.toContain('文件名解析待复核')
  expect(wrapper.text()).not.toContain('可点击“编辑歌曲资料”补充歌名')
  const edit = wrapper.findAll('button').find(button => button.text() === '手工编辑歌曲资料')!
  expect(edit.exists()).toBe(true)
  await edit.trigger('click'); await flushPromises()
  expect(wrapper.get('input[aria-label="编辑歌名"]').element.tagName).toBe('INPUT')
})

it('抽屉切换候选时保护手工草稿，取消放弃后恢复选择并保留版本提醒', async () => {
  const live = context(); live.values.title = '歌名 (Live)'
  vi.mocked(singleReview.load).mockResolvedValue(live)
  vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
  const other = { ...candidate, id: 'other', track: { ...candidate.track, album: '另一张专辑', provider: 'NETEASE' as const } }
  wrapper = mount(SingleSongScrapeDialog, { props: { song: live.song, presentation: 'drawer', initialCandidates: [candidate, other], autoSelectThreshold: .95 }, global: { stubs: { teleport: true } } })
  await flushPromises()
  expect(wrapper.text()).toContain('多个候选分数接近')
  await wrapper.get('.drawer-candidate-select select').setValue('candidate'); await flushPromises()
  expect(wrapper.text()).toContain('候选未标记现场版')
  expect(wrapper.get('.drawer-candidate-select').text()).toContain('网易云音乐 · 歌名 / 歌手 / 另一张专辑')
  await wrapper.findAll('button').find(b => b.text() === '编辑歌曲资料')!.trigger('click'); await flushPromises()
  await wrapper.get('input[aria-label="编辑专辑"]').setValue('手工草稿')
  await wrapper.findAll('button').find(b => b.text() === '保存编辑到草稿')!.trigger('click'); await flushPromises()
  await wrapper.get('.drawer-candidate-select select').setValue('other'); await flushPromises()
  expect(ElMessageBox.confirm).toHaveBeenCalledWith(expect.stringContaining('切换候选'), '有尚未应用的修改', expect.anything())
  expect(wrapper.get('.drawer-candidate-select select').element).toHaveProperty('value', 'candidate')
  expect(wrapper.get('.field-comparison').text()).toContain('手工草稿')
  expect(singleReview.apply).not.toHaveBeenCalled()
})


it('相近录音版本不自动选择，点选后也不预勾覆盖现有资料', async () => {
  const original = context()
  original.values = { ...original.values, album: '一场游戏一场梦', releaseDate: '1987-12-18', durationMs: 257000, cover: 'https://cover.example/current.jpg' }
  vi.mocked(singleReview.load).mockResolvedValue(original)
  const live: MetadataCandidate = { ...candidate, id: 'live', track: { ...candidate.track, album: '英皇3周年慈善演唱会', releaseDate: '2003-01-01', durationMs: 264000, coverUrl: 'https://cover.example/live.jpg' } }
  const studio: MetadataCandidate = { ...candidate, id: 'studio', track: { ...candidate.track, album: '一场游戏一场梦', releaseDate: '1987-12-18', durationMs: 257000 } }
  const state = useSingleSongScrape(); await state.open('song-1', [live, studio], .95)
  expect(state.selected.value).toBeNull()
  expect(state.changed.value).toEqual([])
  expect(state.dirty.value).toBe(false)
  state.choose(live)
  expect(state.changed.value).toEqual([])
  expect(state.dirty.value).toBe(false)
  expect(state.preview.value).toEqual(original.values)
  state.fields.value = ['album']
  expect(state.dirty.value).toBe(true)
  await state.apply()
  expect(singleReview.apply).toHaveBeenCalledWith('song-1', expect.objectContaining({ candidateId: 'live', fields: ['album'] }))
})

it.each(['dialog', 'drawer'] as const)('手动浏览候选但未勾选变更时，取消不提示放弃草稿：%s', async presentation => {
  const original = context()
  original.values = { ...original.values, album: '录音室专辑', releaseDate: '1987-12-18', durationMs: 257000, cover: 'https://cover.example/current.jpg' }
  vi.mocked(singleReview.load).mockResolvedValue(original)
  vi.spyOn(ElMessageBox, 'confirm')
  const live: MetadataCandidate = { ...candidate, id: 'live', track: { ...candidate.track, album: '现场演唱会', releaseDate: '2003-01-01', durationMs: 264000, coverUrl: 'https://cover.example/live.jpg' } }
  wrapper = mount(SingleSongScrapeDialog, { props: { song: original.song, presentation, initialCandidates: [candidate, live], autoSelectThreshold: .95 }, global: { stubs: { teleport: true } } })
  await flushPromises()
  if (presentation === 'drawer') await wrapper.get('.drawer-candidate-select select').setValue('live')
  else await wrapper.findAll('.review-candidate')[1]!.trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('现场演唱会')
  expect(wrapper.text()).toContain('确认应用（0 项）')
  await wrapper.findAll('button').find(button => button.text() === '取消')!.trigger('click'); await flushPromises()
  expect(ElMessageBox.confirm).not.toHaveBeenCalled()
  expect(wrapper.emitted('close')).toHaveLength(1)
  expect(singleReview.apply).not.toHaveBeenCalled()
})

it('唯一候选只补缺失字段，自动预览直接退出不提示用户修改', async () => {
  const original = context(); original.values.album = '当前专辑'
  vi.mocked(singleReview.load).mockResolvedValue(original)
  vi.mocked(metadata.settings).mockResolvedValue({ enabled: true, providers: ['QQ'], autoApply: false, threshold: .95 })
  vi.spyOn(ElMessageBox, 'confirm')
  wrapper = mount(SingleSongScrapeDialog, { props: { song: original.song }, global: { stubs: { teleport: true } } })
  await flushPromises()
  expect(wrapper.get('[data-field="album"] input').element).toHaveProperty('checked', false)
  expect(wrapper.text()).toContain('覆盖已有信息请逐项勾选')
  await wrapper.findAll('button').find(button => button.text() === '取消')!.trigger('click'); await flushPromises()
  expect(ElMessageBox.confirm).not.toHaveBeenCalled()
  expect(wrapper.emitted('close')).toHaveLength(1)
})

it('自动预览后主动勾选覆盖字段属于未保存修改', async () => {
  const original = context(); original.values.album = '当前专辑'
  vi.mocked(singleReview.load).mockResolvedValue(original)
  const state = useSingleSongScrape(); await state.open('song-1', [candidate], .95)
  expect(state.dirty.value).toBe(false)
  state.fields.value = ['album']
  expect(state.dirty.value).toBe(true)
  expect(state.changed.value).toEqual(['album'])
})
