// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, onMounted, onUnmounted, ref } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import AdminLayout from '../src/admin/app/layouts/AdminLayout.vue'

vi.mock('../src/admin/app/composables/use-active-task-count', () => ({ useActiveTaskCount: () => ({ count: ref(0) }) }))
vi.mock('../src/admin/modules/ai-settings/components/AssistantWidget.vue', () => ({ default: { template: '<div />' } }))

let wrapper: VueWrapper | undefined
let router: Router
let mounted: number, unmounted: number
const Editor = defineComponent({
  setup() {
    const draft = ref('')
    onMounted(() => { mounted++ })
    onUnmounted(() => { unmounted++ })
    return { draft }
  },
  template: '<section><label>草稿<input v-model="draft" aria-label="草稿"></label></section>',
})
const Other = defineComponent({ template: '<section aria-label="另一页面">另一页面</section>' })

beforeEach(async () => {
  mounted = 0; unmounted = 0
  router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/editor/:id', component: Editor },
    { path: '/other', component: Other },
  ] })
  await router.push('/editor/one'); await router.isReady()
  wrapper = mount(AdminLayout, { attachTo: document.body, global: { plugins: [router], stubs: { ThemeSwitcher: true } } })
  await flushPromises()
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined })

it('查询和锚点变化保留页面实例、草稿及焦点', async () => {
  const input = wrapper!.get('input[aria-label="草稿"]')
  await input.setValue('尚未保存的内容')
  ;(input.element as HTMLInputElement).focus()
  await router.push('/editor/one?search=新查询#details'); await flushPromises()
  expect(mounted).toBe(1); expect(unmounted).toBe(0)
  expect(wrapper!.get('input[aria-label="草稿"]').element).toBe(input.element)
  expect((input.element as HTMLInputElement).value).toBe('尚未保存的内容')
  expect(document.activeElement).toBe(input.element)
})

it('同一路由组件的参数变化沿用 Vue Router 的实例复用', async () => {
  await wrapper!.get('input[aria-label="草稿"]').setValue('参数切换前的草稿')
  await router.push('/editor/two'); await flushPromises()
  expect(mounted).toBe(1); expect(unmounted).toBe(0)
  expect((wrapper!.get('input[aria-label="草稿"]').element as HTMLInputElement).value).toBe('参数切换前的草稿')
})

it('连续切换业务页后显示最终页面并释放导航滚动锁', async () => {
  await wrapper!.get('.mobile-nav-toggle').trigger('click')
  expect(document.body.style.overflow).toBe('hidden')
  await router.push('/other'); await router.push('/editor/final'); await router.push('/other')
  await flushPromises()
  expect(wrapper!.find('[aria-label="另一页面"]').exists()).toBe(true)
  expect(wrapper!.find('input[aria-label="草稿"]').exists()).toBe(false)
  expect(document.body.style.overflow).not.toBe('hidden')
  expect(wrapper!.find('.navigation-dialog').exists()).toBe(false)
  expect(wrapper!.get('.workspace').attributes('inert')).toBeUndefined()
})
