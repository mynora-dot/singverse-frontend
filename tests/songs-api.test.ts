import { beforeEach, expect, it, vi } from 'vitest'
import { authRequest } from '../src/admin/core/auth/api'
import { songs } from '../src/admin/modules/song-management/api/songs'

vi.mock('../src/admin/core/auth/api', () => ({ authRequest: vi.fn() }))
beforeEach(() => vi.mocked(authRequest).mockReset())

it('歌曲排序与搜索、来源、未分类筛选一同交给服务端分页', async () => {
  await songs.list({ sourceId: 'source-1', q: '', search: '晴天', status: 'ALL', page: 2, sort: 'UPDATED_DESC', unclassified: true })
  const url = new URL(vi.mocked(authRequest).mock.calls[0]![0], 'https://singverse.test')
  expect(url.pathname).toBe('/api/v1/media-songs')
  expect(Object.fromEntries(url.searchParams)).toEqual({ page: '2', size: '20', status: 'ALL', sourceId: 'source-1', search: '晴天', unclassified: 'true', sort: 'UPDATED_DESC' })
})

it('未选择排序的调用保留原有默认顺序', async () => {
  await songs.list({ sourceId: '', q: '', status: 'ALL', page: 0 })
  expect(authRequest).toHaveBeenCalledWith('/api/v1/media-songs?page=0&size=20&status=ALL')
})

it('详情歌词通过管理员同源接口读取并编码歌曲标识', async () => {
  const value = { songId: 'a/b', items: [{ id: 'lrc', format: 'text', text: '已下载的歌词' }], warnings: [] }
  vi.mocked(authRequest).mockResolvedValue(value)
  expect(await songs.textTracks('a/b')).toBe(value)
  expect(authRequest).toHaveBeenCalledWith('/api/v1/media-songs/a%2Fb/text-tracks')
})
