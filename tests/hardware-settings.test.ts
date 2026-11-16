// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import HardwareSettings from '../src/admin/modules/compute-settings/HardwareSettings.vue'
import { authRequest } from '../src/admin/core/auth/api'
vi.mock('../src/admin/core/auth/api')
const initial = { backend: 'deployment', effectiveBackend: 'auto', deploymentBackend: 'auto', revision: 3, writable: true }
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(authRequest).mockImplementation(async (path, _method, body) => {
    if (path.endsWith('/test')) return { passed: true, backend: 'software', hardware: false, elapsedMs: 10 }
    if (body) return { ...initial, backend: 'software', effectiveBackend: 'software', revision: 4 }
    return initial
  })
})
it('读取、测试草稿、保存和恢复部署选择保持分离', async () => {
  const wrapper = mount(HardwareSettings)
  const button = (text: string) => wrapper.findAll('button').find(b => b.text() === text)!
  try {
    await flushPromises()
    await wrapper.get('select').setValue('software')
    expect(authRequest).toHaveBeenCalledTimes(1)
    await button('测试所选方式').trigger('click'); await flushPromises()
    expect(authRequest).toHaveBeenCalledWith('/api/v1/transcoding/hardware-settings/test', 'POST', { backend: 'software' }, 45000)
    expect(wrapper.text()).toContain('当前使用 CPU 软件编码')
    expect(wrapper.text()).toContain('当前生效：自动选择')
    await button('保存硬件加速设置').trigger('click'); await flushPromises()
    expect(authRequest).toHaveBeenCalledWith('/api/v1/transcoding/hardware-settings', 'POST', { backend: 'software', revision: 3, cpuFallback: true }, 45000)
    expect(wrapper.text()).toContain('硬件加速设置已保存')
    await wrapper.get('select').setValue('deployment')
    await button('保存硬件加速设置').trigger('click'); await flushPromises()
    expect(authRequest).toHaveBeenLastCalledWith('/api/v1/transcoding/hardware-settings', 'POST', { backend: 'deployment', revision: 4, cpuFallback: true }, 45000)
  } finally { wrapper.unmount() }
})
it('读取失败可重试，保存冲突显示错误且不宣告成功', async () => {
  vi.mocked(authRequest).mockRejectedValueOnce(new Error('节点暂不可用'))
  const wrapper = mount(HardwareSettings)
  try {
    await flushPromises()
    expect(wrapper.text()).toContain('节点暂不可用')
    await wrapper.find('button').trigger('click'); await flushPromises()
    vi.mocked(authRequest).mockRejectedValueOnce(new Error('配置已变化，请重新读取'))
    await wrapper.findAll('button').find(b => b.text() === '保存硬件加速设置')!.trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('配置已变化，请重新读取')
    expect(wrapper.text()).not.toContain('硬件加速设置已保存')
  } finally { wrapper.unmount() }
})

it('能力按当前方式优先展示，无关硬件和手选 CPU 不出现在选择及能力列表', async () => {
  vi.mocked(authRequest).mockImplementation(async path => path.endsWith('/capabilities') ? {
    backends: [
      { backend: 'software', installed: true, samplePassed: true, codecs: { h264: { samplePassed: true } } },
      { backend: 'qsv', installed: false, samplePassed: false, codecs: {} },
      { backend: 'videotoolbox', installed: true, samplePassed: true, decodeAcceleration: true, zeroCopy: true, toneMappingAcceleration: false, codecs: { h264: { samplePassed: true }, hevc: { samplePassed: true }, av1: { samplePassed: false } } },
    ],
  } : { ...initial, effectiveBackend: 'videotoolbox', detectedBackends: ['videotoolbox'] })
  const wrapper = mount(HardwareSettings)
  try {
    await flushPromises()
    await wrapper.findAll('button').find(b => b.text() === '检测当前硬件')!.trigger('click'); await flushPromises()
    const rows = wrapper.findAll('tbody tr')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.text()).toContain('Mac（VideoToolbox）')
    expect(rows[0]!.text()).toContain('当前使用')
    expect(rows[0]!.findAll('.codec-tag').map(tag => tag.text())).toEqual(['H264', 'HEVC'])
    expect(rows[0]!.findAll('.stage-tag.verified').map(tag => tag.text())).toEqual(['硬解已验证', '零拷贝已验证'])
    expect(rows[0]!.text()).toContain('GPU 色调映射待验证')
    expect(wrapper.find('option[value="software"]').exists()).toBe(false)
    expect(wrapper.find('option[value="qsv"]').exists()).toBe(false)
    expect(wrapper.find('.unavailable-details').exists()).toBe(false)
    expect((wrapper.get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(true)
    await wrapper.get('input[type="checkbox"]').setValue(false)
    await wrapper.findAll('button').find(b => b.text() === '保存硬件加速设置')!.trigger('click'); await flushPromises()
    expect(authRequest).toHaveBeenCalledWith('/api/v1/transcoding/hardware-settings', 'POST', expect.objectContaining({ cpuFallback: false }), 45000)
    expect(wrapper.find('.deployment-note').exists()).toBe(false)
  } finally { wrapper.unmount() }
})

it('Intel 节点只显示检测到的编码方式，编码详情默认收起', async () => {
  vi.mocked(authRequest).mockResolvedValue({ ...initial, effectiveBackend: 'qsv', detectedBackends: ['qsv', 'vaapi'] })
  const wrapper = mount(HardwareSettings, { props: { hideFallback: true } })
  try {
    await flushPromises()
    expect(wrapper.findAll('option').map(option => option.attributes('value'))).toEqual(['deployment', 'auto', 'qsv', 'vaapi'])
    expect(wrapper.text()).not.toMatch(/Mac|NVIDIA|AMD|Rockchip/)
    expect(wrapper.text()).toContain('VA-API（Linux）')
    expect(wrapper.get('details.encoder-section').attributes('open')).toBeUndefined()
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
    expect(authRequest).toHaveBeenCalledTimes(1)
  } finally { wrapper.unmount() }
})

it('无加速硬件时保留 CPU，未知检测结果不会展示所有厂商', async () => {
  vi.mocked(authRequest).mockResolvedValueOnce({ ...initial, detectedBackends: [] })
  const wrapper = mount(HardwareSettings)
  try {
    await flushPromises()
    expect(wrapper.findAll('option').map(option => option.attributes('value'))).toEqual(['deployment', 'auto', 'software'])
    expect(wrapper.get('.current-backend').text()).toContain('CPU 软件处理')
    vi.mocked(authRequest).mockResolvedValueOnce(initial)
    await wrapper.findAll('button').find(button => button.text() === '重新读取设置')!.trigger('click')
    await flushPromises()
    expect(wrapper.findAll('option').map(option => option.attributes('value'))).toEqual(['deployment', 'auto', 'software'])
    expect(wrapper.text()).toContain('尚未确认硬件')
    expect(wrapper.text()).not.toMatch(/Mac|NVIDIA|Intel|AMD|Rockchip/)
  } finally { wrapper.unmount() }
})

it('已保存但未检测到的方式仅提示失效，选择可用方式后才能保存', async () => {
  vi.mocked(authRequest).mockResolvedValue({ ...initial, backend: 'nvenc', effectiveBackend: 'nvenc', detectedBackends: ['qsv', 'vaapi'] })
  const wrapper = mount(HardwareSettings)
  try {
    await flushPromises()
    const savedOption = wrapper.get('option[value="nvenc"]')
    expect(savedOption.attributes('disabled')).toBeDefined()
    expect(savedOption.text()).toBe('已配置方式未检测到')
    expect(wrapper.text()).not.toContain('NVIDIA')
    expect(wrapper.get('.current-backend').text()).toContain('所配置的加速设备未检测到')
    const save = wrapper.findAll('button').find(button => button.text() === '保存硬件加速设置')!
    expect(save.attributes('disabled')).toBeDefined()
    expect(authRequest).toHaveBeenCalledTimes(1)
    await wrapper.get('select').setValue('auto')
    expect(save.attributes('disabled')).toBeUndefined()
    expect(authRequest).toHaveBeenCalledTimes(1)
  } finally { wrapper.unmount() }
})
