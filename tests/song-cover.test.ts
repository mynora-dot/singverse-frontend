// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import SongCover from '../src/admin/modules/song-management/components/SongCover.vue'

it('播放历史可按歌曲编号读取封面，编码路径且在歌曲改变后恢复失败图片', async () => {
  const wrapper = mount(SongCover, { props: { songId: 'song/一', title: '家里的歌' } })
  expect(wrapper.get('img').attributes('src')).toBe('/api/v1/metadata/songs/song%2F%E4%B8%80/cover?variant=thumbnail')
  expect(wrapper.get('img').attributes('alt')).toBe('家里的歌的封面')
  expect(wrapper.get('img').attributes('loading')).toBe('lazy')
  await wrapper.get('img').trigger('error')
  expect(wrapper.find('img').exists()).toBe(false)
  expect(wrapper.find('[aria-label="暂无歌曲封面"]').exists()).toBe(true)
  await wrapper.setProps({ songId: 'song-2', title: '下一首' })
  expect(wrapper.get('img').attributes('src')).toContain('/song-2/cover?variant=thumbnail')
  await wrapper.setProps({ songId: '' })
  expect(wrapper.find('img').exists()).toBe(false)
  wrapper.unmount()
})
