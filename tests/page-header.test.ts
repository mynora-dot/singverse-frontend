// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { h } from 'vue'
import { expect, it, vi } from 'vitest'
import PageHeader from '../src/admin/shared/ui/PageHeader.vue'

it('标题、数量与操作直接可用，导航链接保留真实地址', async () => {
  const action = vi.fn()
  const wrapper = mount(PageHeader, {
    props: { title: '文件名识别' },
    slots: {
      meta: () => h('span', '3 个方案'),
      actions: () => [
        h('a', { href: '#/library/media/recognition?sourceId=source-1' }, '来源方案'),
        h('button', { onClick: action }, '保存方案'),
      ],
    },
  })
  try {
    expect(wrapper.get('h1').text()).toBe('文件名识别')
    expect(wrapper.text()).toContain('3 个方案')
    expect(wrapper.get('a').attributes('href')).toBe('#/library/media/recognition?sourceId=source-1')
    await wrapper.get('button').trigger('click')
    expect(action).toHaveBeenCalledOnce()
  } finally { wrapper.unmount() }
})

it('没有操作时不生成空操作栏', () => {
  const wrapper = mount(PageHeader, { props: { title: '计算服务' } })
  try {
    expect(wrapper.get('h1').text()).toBe('计算服务')
    expect(wrapper.find('.sv-page-header-actions').exists()).toBe(false)
    expect(wrapper.classes()).not.toContain('has-controls')
  } finally { wrapper.unmount() }
})
