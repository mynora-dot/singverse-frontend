// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import FavoritesView from '../src/admin/modules/favorites/FavoritesView.vue'
import { favoritesApi, type FavoritePage, type FavoriteSong } from '../src/admin/modules/favorites/api'

const song: FavoriteSong = { id: 'one', title: '晴天', artists: ['周杰伦'], album: '叶惠美', addedAt: '2026-11-14T02:00:00Z', available: true }
const result = (items = [song], total = items.length): FavoritePage => ({ items, totalElements: total, totalFavorites: total, page: 0, size: 20, revision: 1 })
let wrapper: VueWrapper | undefined
beforeEach(() => {
  vi.spyOn(favoritesApi, 'list').mockResolvedValue(result())
  vi.spyOn(favoritesApi, 'ids').mockResolvedValue({ songIds: ['one'], revision: 1 })
  vi.spyOn(favoritesApi, 'library').mockResolvedValue({ items: [song, { ...song, id: 'two', title: '稻香' }], totalElements: 2 })
  vi.spyOn(favoritesApi, 'set').mockResolvedValue({ songIds: [], revision: 2 })
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined; document.body.innerHTML = ''; vi.restoreAllMocks() })
async function start() { wrapper = mount(FavoritesView, { attachTo: document.body }); await flushPromises(); return wrapper }
async function button(label: string) {
  const target = wrapper!.findAll('button').find(button => button.text() === label)
  expect(target, label).toBeDefined(); await target!.trigger('click'); await flushPromises()
}

it('shows the collection and real thumbnail endpoint, including missing-song fallback', async () => {
  vi.mocked(favoritesApi.list).mockResolvedValue(result([song, { ...song, id: 'missing', available: false }]))
  await start()
  expect(wrapper!.get('h1').text()).toBe('收藏管理'); expect(wrapper!.text()).toContain('2 首收藏')
  expect(wrapper!.get('img').attributes('src')).toBe('/api/v1/metadata/songs/one/cover?variant=thumbnail')
  expect(wrapper!.findAll('.song-cover-placeholder')).toHaveLength(1)
  expect(wrapper!.text()).toContain('暂不可用')
})
it('read failure keeps rows with an explicit stale-state notice', async () => {
  await start(); vi.mocked(favoritesApi.list).mockRejectedValue(new Error('连接中断'))
  await wrapper!.get('.desktop-refresh').trigger('click'); await flushPromises()
  expect(wrapper!.findAll('.favorite-row')).toHaveLength(1)
  expect(wrapper!.text()).toContain('当前显示上次成功读取的内容')
  expect(wrapper!.text()).toContain('收藏读取失败：连接中断')
  expect(wrapper!.get('.row-remove').attributes('disabled')).toBeDefined()
})
it('failed cancel retains selection and confirms exactly the current page', async () => {
  await start(); await button('批量管理')
  await wrapper!.get('input[aria-label="选择当前页全部收藏"]').setValue(true)
  await button('取消所选收藏')
  expect(wrapper!.text()).toContain('取消这首收藏？')
  vi.mocked(favoritesApi.set).mockRejectedValue(new Error('保存失败'))
  await button('确认取消')
  expect(favoritesApi.set).toHaveBeenCalledWith(['one'], false)
  expect(wrapper!.findAll('.favorite-row')).toHaveLength(1)
  expect(wrapper!.text()).toContain('保存失败')
  expect(wrapper!.text()).not.toContain('已取消 1 首收藏')
})
it('adding reads server IDs and sends only the user selected library songs', async () => {
  await start(); await button('添加歌曲')
  expect(wrapper!.get('input[aria-label="添加 晴天"]').attributes('disabled')).toBeDefined()
  await wrapper!.get('input[aria-label="添加 稻香"]').setValue(true)
  await button('添加所选')
  expect(favoritesApi.set).toHaveBeenCalledWith(['two'], true)
  expect(wrapper!.text()).toContain('已添加 1 首收藏')
})
it('a late search cannot replace a newer query response', async () => {
  let complete!: (value: FavoritePage) => void
  vi.mocked(favoritesApi.list).mockReturnValueOnce(new Promise(resolve => { complete = resolve }))
  wrapper = mount(FavoritesView, { attachTo: document.body })
  await wrapper.get('input[aria-label="搜索收藏"]').setValue('稻香')
  await wrapper.get('.favorites-toolbar').trigger('submit'); await flushPromises()
  complete(result([{ ...song, title: '旧请求' }])); await flushPromises()
  expect(wrapper.text()).toContain('晴天'); expect(wrapper.text()).not.toContain('旧请求')
  expect(favoritesApi.list).toHaveBeenLastCalledWith('稻香', 'ALL', 'RECENT', 0)
})
it('manual refresh picks up changes from another terminal', async () => {
  await start(); vi.mocked(favoritesApi.list).mockResolvedValue(result([]))
  await wrapper!.get('.desktop-refresh').trigger('click'); await flushPromises()
  expect(wrapper!.findAll('.favorite-row')).toHaveLength(0)
  expect(wrapper!.text()).toContain('把想唱的歌留在一起')
})
