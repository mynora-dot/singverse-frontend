// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { expect, it } from 'vitest'
import HomeView from '../src/admin/modules/home/views/HomeView.vue'

async function home(path = '/') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: HomeView }] })
  await router.push(path)
  const wrapper = mount(HomeView, { global: {
    plugins: [router],
    stubs: {
      ElDialog: { props: ['modelValue'], template: '<section v-if="modelValue" role="dialog"><slot name="header" title-id="login-title" /><slot /></section>' },
      LoginView: { props: ['redirect'], template: '<div class="login-target">{{ redirect }}</div>', methods: { focusInitial() {} } },
      ThemeSwitcher: true,
    },
  } })
  return { wrapper, router }
}

it('管理快捷入口登录后保留各自目的地，关闭后可以重新选择', async () => {
  const { wrapper } = await home()
  try {
    expect(wrapper.get('h1').text()).toBe('管理中心')
    expect(wrapper.findAll('.sv-home-nav a').map(link => link.attributes('href'))).toEqual(['/party/', '/downloads/'])
    const destinations = ['/library/songs', '/library/media', '/library/playlists', '/library/songs/metadata', '/system/tv-settings', '/system/music-platforms']
    const entries = wrapper.findAll('.sv-home-entries button')
    for (const [index, entry] of entries.entries()) {
      await entry.trigger('click'); await flushPromises()
      expect(wrapper.get('.login-target').text()).toBe(destinations[index])
      await wrapper.get('[aria-label="关闭登录窗口"]').trigger('click')
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    }
    await wrapper.get('.sv-home-primary').trigger('click'); await flushPromises()
    expect(wrapper.get('.login-target').text()).toBe('')
  } finally { wrapper.unmount() }
})

it('登录深链接直接打开窗口，关闭后返回首页', async () => {
  const { wrapper, router } = await home('/login?redirect=/library/songs')
  try {
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    await wrapper.get('[aria-label="关闭登录窗口"]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  } finally { wrapper.unmount() }
})
