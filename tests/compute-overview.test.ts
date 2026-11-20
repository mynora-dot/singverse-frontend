// @vitest-environment jsdom
import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { authRequest } from '../src/admin/core/auth/api'
import { importModel, type Node } from '../src/admin/modules/audio-processing/api'
import ComputeOverview from '../src/admin/modules/compute-settings/ComputeOverview.vue'

vi.mock('../src/admin/core/auth/api', () => ({ authRequest: vi.fn() }))
vi.mock('../src/admin/modules/audio-processing/api', async importOriginal => ({
  ...await importOriginal<typeof import('../src/admin/modules/audio-processing/api')>(), importModel: vi.fn(),
}))

let wrapper: VueWrapper | undefined, router: Router, node: Node
let hardware = { backend: 'deployment', effectiveBackend: 'nvenc', deploymentBackend: 'nvenc', revision: 9, writable: true, detectedBackends: ['nvenc'], cpuFallback: true }
const button = (text: string, scope: Pick<DOMWrapper<Element>, 'findAll'> = wrapper!) => scope.findAll('button').find(item => item.text() === text)!
const advanced = async () => { await wrapper!.get('[data-profile="LEGACY_DEMUCS"]').trigger('click') }
const models = () => wrapper!.get('.models-only')
async function open(hash = '') {
  router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/system/compute', component: ComputeOverview, props: { connected: true, capabilities: ['media-probe', 'transcode-hls'] } },
    { path: '/other', component: { template: '<p>其他页面</p>' } },
  ] })
  await router.push('/system/compute' + hash)
  wrapper = mount({ template: '<RouterView />' }, { attachTo: document.body, global: { plugins: [router], stubs: {
    ElDrawer: {
      props: ['modelValue', 'title', 'showClose', 'beforeClose'], emits: ['update:modelValue'],
      template: '<aside v-if="modelValue" role="dialog" :aria-label="title"><h2>{{ title }}</h2><button v-if="showClose" aria-label="关闭设置" @click="beforeClose(() => $emit(\'update:modelValue\', false))">关闭</button><slot /></aside>',
    },
  } } })
  await flushPromises()
}

beforeEach(() => {
  const model = { id: 'htdemucs', version: 'fixture', installed: false, writable: true, filename: 'model.th', downloadUrl: 'https://example.test/model.th', sha256: 'pinned', maxBytes: 1024 }
  node = {
    environment: { system: 'Linux', architecture: 'x86_64', processor: 'fixture', versions: {} },
    memoryAvailableBytes: 8 * 1024 ** 3, diskFreeBytes: 20 * 1024 ** 3, selected: null, selection: 'auto', cpuFallback: true,
    model, models: [model, { ...model, id: 'uvr-mdxnet-9482' }],
    fastClassifier: { ...model, id: 'panns-cnn6', ready: false, files: [{ name: 'Cnn6.pth', url: 'https://example.test/Cnn6.pth', size: 100, sha256: 'classifier-pinned' }] },
    backends: [{ id: 'cpu', state: 'UNVERIFIED', reason: '' }, { id: 'cuda', detected: true, state: 'UNVERIFIED', reason: '' }],
    separation: { version: 1, profiles: [{ id: 'DSP_FAST', ready: true, modelId: '' }, { id: 'AI_CLEAN', ready: true, modelId: 'uvr-mdxnet-9482' }, { id: 'LEGACY_DEMUCS', ready: false, modelId: 'htdemucs' }], backends: [] },
    operation: { state: 'IDLE', bytes: 0 }, instructions: {},
  }
  hardware = { ...hardware, cpuFallback: true, revision: 9 }
  vi.mocked(authRequest).mockImplementation(async (path, method, body) => {
    if (path.includes('/node')) return structuredClone(node) as never
    if (path === '/api/v1/transcoding/hardware-settings') {
      if (method === 'POST') hardware = { ...hardware, ...body as object, revision: hardware.revision + 1 }
      return { ...hardware } as never
    }
    return undefined as never
  })
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined; document.body.innerHTML = ''; vi.resetAllMocks() })

it('快速档在高级模型缺失时仍可用，两档切换同步焦点和面板名称', async () => {
  await open()
  expect(wrapper!.findAll('[role="tab"]').map(tab => tab.text())).toEqual(['快速', '高级'])
  expect(wrapper!.get('[role="tabpanel"]').text()).toContain('快速伴奏：可使用')
  const tabs = wrapper!.get('[role="tablist"]')
  for (const [key, profile] of [['ArrowRight', 'LEGACY_DEMUCS'], ['ArrowRight', 'DSP_FAST'], ['End', 'LEGACY_DEMUCS'], ['Home', 'DSP_FAST'], ['ArrowLeft', 'LEGACY_DEMUCS']]) {
    await tabs.trigger('keydown', { key })
    expect(wrapper!.get('[aria-selected="true"]').attributes('data-profile')).toBe(profile)
    expect(document.activeElement).toBe(wrapper!.get(`[data-profile="${profile}"]`).element)
    expect(wrapper!.get('[role="tabpanel"]').attributes('aria-labelledby')).toBe(`plan-${profile}`)
  }
  expect(wrapper!.text()).not.toMatch(/轻量 AI|片段试跑|当前处理方式|检测到：/)
})

it('高级模型从安装进入设备验证，沿用原有下载和验证接口', async () => {
  await open(); await advanced(); await button('安装模型').trigger('click')
  await button('下载到节点', models().get('[data-model="htdemucs"]')).trigger('click'); await flushPromises()
  expect(authRequest).toHaveBeenCalledWith('/api/v1/audio-processing/model/download', 'POST', undefined, 60000)
  await wrapper!.get('button[aria-label="关闭设置"]').trigger('click')
  node.models![0]!.installed = true
  await wrapper!.get('[data-profile="DSP_FAST"]').trigger('click')
  await button('重新检测').trigger('click'); await flushPromises(); await advanced()
  expect(wrapper!.get('[role="tabpanel"]').text()).toContain('已安装')
  expect(button('验证设备').attributes('disabled')).toBeUndefined()
})

it('已安装的高级模型通过处理设备侧栏验证，保留后端参数', async () => {
  node.models![0]!.installed = true
  await open(); await advanced(); await button('验证设备').trigger('click')
  await wrapper!.get('button[aria-label="验证NVIDIA 显卡 (CUDA)"]').trigger('click'); await flushPromises()
  expect(authRequest).toHaveBeenCalledWith('/api/v1/audio-processing/model/test', 'POST', { backend: 'cuda' }, 60000)
  expect(wrapper!.text()).not.toContain('轻量')
})

it('只展示当前设备的高级模型与识别模型，离线来源按需展开', async () => {
  await open('#audio-models')
  expect(models().findAll('[data-model]').map(row => row.attributes('data-model'))).toEqual(['htdemucs', 'panns-cnn6'])
  expect(models().findAll('.model-group').map(group => group.attributes('aria-label'))).toEqual(['伴奏', '音轨识别'])
  const model = models().get('[data-model="htdemucs"]')
  expect(model.get('details').attributes('open')).toBeUndefined()
  expect(model.get('input[type="file"]').attributes('accept')).toBe('.th')
  expect(model.get('a').attributes('href')).toBe(node.model.downloadUrl)
  expect(model.get('.digest').text()).toBe(node.model.sha256)
  expect(models().get('[data-model="panns-cnn6"] input').attributes('accept')).toBe('.zip')
  expect(authRequest).not.toHaveBeenCalledWith(expect.stringContaining('/model/download'), expect.anything(), expect.anything(), expect.anything())
})

it('导入时锁定关闭和离开，失败后保留模型入口并显示错误', async () => {
  let reject!: (error: Error) => void
  vi.mocked(importModel).mockImplementation(() => new Promise((_resolve, fail) => { reject = fail }))
  await open('#audio-models')
  const input = models().get('[data-model="htdemucs"] input')
  const file = new File(['weights'], 'model.th')
  Object.defineProperty(input.element, 'files', { value: [file] })
  await input.trigger('change'); await flushPromises()
  expect(importModel).toHaveBeenCalledWith(file, 'htdemucs')
  expect(wrapper!.find('button[aria-label="关闭设置"]').exists()).toBe(false)
  await router.push('/other')
  expect(router.currentRoute.value.path).toBe('/system/compute')
  reject(new Error('模型校验失败')); await flushPromises()
  expect(models().text()).toContain('模型校验失败')
  expect(wrapper!.find('button[aria-label="关闭设置"]').exists()).toBe(true)
  expect(models().attributes('aria-busy')).toBe('false')
  expect((input.element as HTMLInputElement).value).toBe('')
})

it('超限文件在本地拦截，不发起导入', async () => {
  await open('#audio-models')
  const input = models().get('[data-model="htdemucs"] input')
  const file = new File(['weights'], 'model.th')
  Object.defineProperty(file, 'size', { value: 1025 })
  Object.defineProperty(input.element, 'files', { value: [file] })
  await input.trigger('change'); await flushPromises()
  expect(importModel).not.toHaveBeenCalled()
  expect(models().text()).toContain('大小限制')
})

it('模型操作后刷新失败保留侧栏和关闭能力，重新读取后恢复操作', async () => {
  await open('#audio-models')
  vi.mocked(authRequest).mockResolvedValueOnce(undefined as never).mockRejectedValueOnce(new Error('状态读取失败'))
  await button('下载到节点', models().get('[data-model="htdemucs"]')).trigger('click'); await flushPromises()
  expect(models().text()).toContain('状态读取失败')
  expect(wrapper!.find('button[aria-label="关闭设置"]').exists()).toBe(true)
  expect(models().get('[data-model="htdemucs"] button').attributes('disabled')).toBeDefined()
  await button('重新读取', models()).trigger('click'); await flushPromises()
  expect(models().text()).not.toContain('状态读取失败')
  expect(models().get('[data-model="htdemucs"] button').attributes('disabled')).toBeUndefined()
})

it('已选择的设备验证失败时显示失败状态并可重试', async () => {
  node.models![0]!.installed = true; node.selected = 'cuda'
  node.backends[1]!.state = 'FAILED'
  await open(); await advanced(); await button('验证设备').trigger('click')
  expect(wrapper!.get('.device-row:last-child .device-state').text()).toBe('验证失败')
  await button('重试验证').trigger('click'); await flushPromises()
  expect(authRequest).toHaveBeenCalledWith('/api/v1/audio-processing/model/test', 'POST', { backend: 'cuda' }, 60000)
})

it('下载进度可取消，忙碌期间禁止重复下载与导入', async () => {
  node.operation = { state: 'DOWNLOADING', bytes: 50 * 1024 ** 2 }
  await open('#audio-models')
  expect(models().get('[role="status"]').text()).toContain('下载中 · 50.0 MiB')
  for (const input of models().findAll('input[type="file"]')) expect(input.attributes('disabled')).toBeDefined()
  for (const download of models().findAll('.model-actions button')) expect(download.attributes('disabled')).toBeDefined()
  await models().get('button[aria-label="取消模型操作"]').trigger('click'); await flushPromises()
  expect(authRequest).toHaveBeenCalledWith('/api/v1/audio-processing/model/cancel', 'POST', undefined, 60000)
})

it('不可写目录仍显示实际状态，禁止网页安装', async () => {
  node.models![0]!.writable = false
  await open('#audio-models')
  const model = models().get('[data-model="htdemucs"]')
  expect(model.text()).toContain('模型目录不可写')
  expect(model.get('button').attributes('disabled')).toBeDefined()
  expect(model.get('input').attributes('disabled')).toBeDefined()
})

it('共享 CPU 策略仅在保存后生效，保留视频方式与修订号', async () => {
  await open()
  await wrapper!.get('[role="switch"]').trigger('click')
  expect(authRequest).not.toHaveBeenCalledWith('/api/v1/transcoding/hardware-settings', 'POST', expect.anything(), expect.anything())
  await button('保存策略').trigger('click'); await flushPromises()
  expect(authRequest).toHaveBeenCalledWith('/api/v1/transcoding/hardware-settings', 'POST', { backend: 'deployment', revision: 9, cpuFallback: false }, 45000)
  expect(wrapper!.get('[role="switch"]').attributes('aria-checked')).toBe('false')
  expect(wrapper!.text()).toContain('已保存')
})

it('高级运行环境缺失时给出真实原因，检测到硬件不代表可生成', async () => {
  for (const backend of node.backends) { backend.state = 'RUNTIME_MISSING'; backend.reason = '缺少固定版本推理环境' }
  await open(); await advanced()
  expect(wrapper!.get('[role="tabpanel"]').text()).toContain('缺少运行环境')
  await button('检查环境').trigger('click')
  expect(wrapper!.get('.environment-help').text()).toContain('缺少固定版本推理环境')
  expect(authRequest).not.toHaveBeenCalledWith(expect.stringContaining('/model/test'), expect.anything(), expect.anything(), expect.anything())
})

it('Intel 缺模型时优先展示实际显卡并保留对应模型，固定 CPU 选择仍受尊重', async () => {
  node.models!.push({ ...node.model, id: 'htdemucs-openvino', backends: ['openvino'] })
  node.backends = [{ id: 'cpu', state: 'MODEL_MISSING', reason: '' }, { id: 'openvino', detected: true, state: 'MODEL_MISSING', reason: '' }]
  await open(); await advanced()
  expect(wrapper!.get('.preparation-list').text()).toContain('Intel 显卡 (OpenVINO)')
  await button('安装模型').trigger('click')
  await button('下载到节点', models().get('[data-model="htdemucs-openvino"]')).trigger('click'); await flushPromises()
  expect(authRequest).toHaveBeenCalledWith('/api/v1/audio-processing/model/download?model=htdemucs-openvino', 'POST', undefined, 60000)
  await wrapper!.get('button[aria-label="关闭设置"]').trigger('click')
  node.selected = 'cpu'; node.selection = 'cpu'
  await wrapper!.get('[data-profile="DSP_FAST"]').trigger('click')
  await button('重新检测').trigger('click'); await flushPromises(); await advanced()
  expect(wrapper!.get('.preparation-list').text()).toContain('CPU')
})
