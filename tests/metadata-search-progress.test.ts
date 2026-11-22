// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useSingleSongScrape } from '../src/admin/modules/metadata/composables/useSingleSongScrape'
import SingleSongReviewWorkspace from '../src/admin/modules/metadata/components/SingleSongReviewWorkspace.vue'
import { metadata } from '../src/admin/modules/metadata/api/metadata'
import { singleReview } from '../src/admin/modules/metadata/api/single-review'
import type { MetadataCandidate, SearchResult } from '../src/admin/modules/metadata/types'
import type { SingleReview } from '../src/admin/modules/metadata/single-types'
import { preview } from './fixtures/filename-workspace'

vi.mock('../src/admin/modules/metadata/api/metadata', () => ({ metadata: { settings: vi.fn(), search: vi.fn(), candidateCover: (id: string) => `/api/v1/metadata/candidates/${id}/cover` } }))
vi.mock('../src/admin/modules/metadata/api/single-review', () => ({ singleReview: { load: vi.fn(), apply: vi.fn(), lyrics: vi.fn() } }))

const review: SingleReview = {
  song: { id: 'song-1', sourceId: 'source', sourceName: '曲库', relativePath: '歌名.mkv', fileSize: 2000, modifiedAt: null, scannedAt: '', parserProfileId: 'default', parserRevision: 0, selectedRuleId: null, result: preview().result },
  fingerprint: 'fingerprint', version: 'version',
  values: { title: '歌名', artists: ['歌手'], album: null, releaseDate: null, aliases: [], durationMs: null, cover: null },
}
const quick: MetadataCandidate = { id: 'quick', score: .96, track: { provider: 'QQ', externalId: '1', title: '歌名', artists: ['歌手'], album: '专辑', releaseDate: null, aliases: [], durationMs: null, coverUrl: null, availability: 'UNKNOWN', fetchedAt: '' } }
const slow: MetadataCandidate = { ...quick, id: 'slow', score: .99, track: { ...quick.track, provider: 'QISHUI', externalId: '2', album: '另一专辑' } }
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
let wrapper: VueWrapper | undefined
beforeEach(() => {
  vi.mocked(singleReview.load).mockResolvedValue(structuredClone(review))
  vi.mocked(singleReview.lyrics).mockResolvedValue({ status: 'MISSING', lyrics: null })
  vi.mocked(metadata.settings).mockResolvedValue({ enabled: true, providers: ['QQ', 'QISHUI'], autoApply: false, threshold: .95 })
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.resetAllMocks() })
async function pendingSearch() {
  const fast = deferred<SearchResult>(), late = deferred<SearchResult>()
  vi.mocked(metadata.search).mockImplementation((_id, _keyword, providers) => providers[0] === 'QQ' ? fast.promise : late.promise)
  const state = useSingleSongScrape(), done = state.open('song-1')
  await flushPromises()
  return { state, done, fast, late }
}

it('同时查询所选平台，快平台返回后马上展示候选和剩余进度', async () => {
  const { state, done, fast, late } = await pendingSearch()
  wrapper = mount(SingleSongReviewWorkspace, { props: { state, versionWarning: '' } })
  expect(wrapper.get('.review-workspace').classes()).not.toContain('review-mode')
  expect(metadata.search).toHaveBeenCalledTimes(2)
  fast.resolve({ candidates: [quick], errors: [] }); await flushPromises()
  expect(state.searching.value).toBe(true)
  expect(state.candidates.value).toEqual([quick])
  expect(wrapper.findAll('.review-candidate')).toHaveLength(1)
  expect(wrapper.text()).toContain('1/2')
  expect(wrapper.text()).toContain('汽水音乐')
  expect(state.selected.value).toBeNull()
  late.resolve({ candidates: [slow], errors: [] }); await done
  expect(state.searching.value).toBe(false)
  expect(state.candidates.value.map(item => item.id)).toEqual(['slow', 'quick'])
  expect(state.selected.value).toBeNull()
  expect(state.dirty.value).toBe(false)
  expect(singleReview.apply).not.toHaveBeenCalled()
})

it('慢平台返回不能覆盖用户已选择的候选和手工编辑', async () => {
  const { state, done, fast, late } = await pendingSearch()
  fast.resolve({ candidates: [quick], errors: [] }); await flushPromises()
  state.choose(quick)
  state.saveEdits({ ...review.values, title: '手工修改', album: '专辑' })
  late.resolve({ candidates: [slow], errors: [] }); await done
  expect(state.selected.value?.id).toBe('quick')
  expect(state.draft.value?.title).toBe('手工修改')
  expect(state.autoSelected.value).toBe(false)
})

it.each(['clear', 'manual'])('慢结果尊重用户取消候选或直接编辑的决定：%s', async mode => {
  const { state, done, fast, late } = await pendingSearch()
  fast.resolve({ candidates: [quick], errors: [] }); await flushPromises()
  if (mode === 'clear') { state.choose(quick); state.clearSelection() }
  else state.saveEdits({ ...review.values, title: '手工歌名' })
  late.resolve({ candidates: [slow], errors: [] }); await done
  expect(state.selected.value).toBeNull()
  expect(state.draft.value?.title).toBe(mode === 'clear' ? '歌名' : '手工歌名')
  expect(state.autoSelected.value).toBe(false)
})

it('用户已经打开编辑器时，不因后台查询完成而切换草稿来源', async () => {
  const { state, done, fast, late } = await pendingSearch()
  fast.resolve({ candidates: [quick], errors: [] }); await flushPromises()
  state.beginEditing()
  late.resolve({ candidates: [slow], errors: [] }); await done
  expect(state.selected.value).toBeNull()
  expect(state.draft.value).toEqual(review.values)
})

it('合并结果保持相似度排序和十条上限，保留用户已选中的早到候选', async () => {
  const { state, done, fast, late } = await pendingSearch()
  const early = Array.from({ length: 8 }, (_, i) => ({ ...quick, id: `quick-${i}`, score: .8 + i / 100 }))
  fast.resolve({ candidates: early, errors: [] }); await flushPromises()
  state.choose(early[0]!)
  late.resolve({ candidates: Array.from({ length: 8 }, (_, i) => ({ ...slow, id: `slow-${i}`, score: .99 - i / 100 })), errors: [] }); await done
  expect(state.candidates.value).toHaveLength(10)
  expect(state.candidates.value[0]?.id).toBe('slow-0')
  expect(state.candidates.value.some(item => item.id === 'quick-0')).toBe(true)
  expect(state.selected.value?.id).toBe('quick-0')
})

it('某个平台失败仍保留其它平台结果，并指出失败平台', async () => {
  const { state, done, fast, late } = await pendingSearch()
  fast.resolve({ candidates: [quick], errors: [] }); await flushPromises()
  late.reject(new Error('平台连接失败')); await done
  expect(state.candidates.value).toEqual([quick])
  expect(state.searchError.value).toBe('')
  expect(state.warning.value).toContain('汽水音乐：平台连接失败')
})

it('全部平台失败与成功查询但没有结果分别显示', async () => {
  const { state, done, fast, late } = await pendingSearch()
  fast.reject(new Error('QQ 连接失败')); late.reject(new Error('汽水连接失败')); await done
  expect(state.searchError.value).toContain('所选平台均暂时不可用')
  vi.mocked(metadata.search).mockResolvedValue({ candidates: [], errors: [] })
  await state.search()
  expect(state.searchError.value).toBe('')
  expect(state.candidates.value).toEqual([])
})

it('关闭窗口取消所有请求，忽略不遵守取消信号的迟到响应', async () => {
  const { state, done, fast, late } = await pendingSearch()
  const signals = vi.mocked(metadata.search).mock.calls.map(call => call[3])
  state.invalidate()
  expect(signals).toHaveLength(2)
  expect(signals.every(signal => signal?.aborted)).toBe(true)
  fast.resolve({ candidates: [quick], errors: [] }); late.resolve({ candidates: [slow], errors: [] }); await done
  expect(state.candidates.value).toEqual([])
  expect(state.searching.value).toBe(false)
})

it('可以确认已返回的候选，同时取消剩余查询，迟到结果不改动已确认草稿', async () => {
  const { state, done, fast, late } = await pendingSearch()
  fast.resolve({ candidates: [quick], errors: [] }); await flushPromises()
  state.choose(quick)
  const execute = vi.fn().mockResolvedValue({ metadata: null, before: review.values, after: state.draft.value, updated: ['album'], skipped: [], retained: [] })
  await state.apply(execute)
  expect(execute).toHaveBeenCalledTimes(1)
  expect(vi.mocked(metadata.search).mock.calls.every(call => call[3]?.aborted)).toBe(true)
  late.resolve({ candidates: [slow], errors: [] }); await done
  expect(state.selected.value?.id).toBe('quick')
  expect(state.result.value?.updated).toEqual(['album'])
})


it('候选卡片直接展示专辑、日期、时长和录音版本，便于选择前比较', async () => {
  const state = useSingleSongScrape()
  const live = { ...quick, track: { ...quick.track, album: '慈善演唱会', releaseDate: '2003-01-01', durationMs: 264000 } }
  await state.open('song-1', [live, { ...slow, score: live.score }])
  wrapper = mount(SingleSongReviewWorkspace, { props: { state, versionWarning: '' } })
  const recording = wrapper.get('.candidate-recording')
  expect(recording.text()).toContain('慈善演唱会')
  expect(recording.text()).toContain('2003-01-01')
  expect(recording.text()).toContain('4:24')
  expect(recording.text()).toContain('现场 / 演唱会')
  expect(wrapper.text()).toContain('多个候选分数接近')
  expect(state.selected.value).toBeNull()
})
