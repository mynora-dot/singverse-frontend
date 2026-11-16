// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, expect, it, vi } from 'vitest'
import { authRequest } from '../src/admin/core/auth/api'
import type { Backend, Model, Node } from '../src/admin/modules/audio-processing/api'
import NodeTab from '../src/admin/modules/audio-processing/components/NodeTab.vue'
import { readiness } from '../src/admin/modules/audio-processing/presentation'
import ComputeOverview from '../src/admin/modules/compute-settings/ComputeOverview.vue'
import { planBackends } from '../src/admin/modules/compute-settings/presentation'

vi.mock('../src/admin/core/auth/api', () => ({ authRequest: vi.fn() }))
let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.resetAllMocks() })

const model = (id: string, backends?: string[]): Model => ({ id, version: 'fixture', installed: false, writable: true, maxBytes: 1024, backends, files: [] })
const backend = (id: string, detected: boolean, state = 'RUNTIME_MISSING'): Backend => ({ id, detected, state, reason: '' })
function node(): Node {
  return {
    environment: { system: 'Linux', architecture: 'x86_64', processor: 'fixture', versions: {} },
    memoryAvailableBytes: 4 * 1024 ** 3, diskFreeBytes: 10 * 1024 ** 3, selected: null, selection: 'auto', cpuFallback: false,
    model: { ...model('htdemucs'), filename: 'model.th', sha256: 'fixture', downloadUrl: 'https://example.test/model.th' },
    models: [model('uvr-mdxnet-9482'), model('uvr-mdxnet-9482-rknn'), model('htdemucs'), model('htdemucs-openvino')],
    fastClassifier: { ...model('panns-cnn6', ['cpu']), ready: false },
    backends: [backend('cpu', false), backend('cuda', false), backend('rocm', false), backend('mps', false), backend('openvino', false), backend('rknn', false)],
    separation: { version: 1, profiles: [{ id: 'AI_CLEAN', ready: false, modelId: 'uvr-mdxnet-9482' }], backends: [backend('cpu', false)] },
    operation: { state: 'IDLE', bytes: 0 }, instructions: {},
    deployment: { note: '四种加速镜像的通用说明', profiles: ['cuda', 'rocm', 'openvino', 'rknn'].map(id => ({ backend: id, image: `fixture:${id}`, command: `setup ${id}`, included: false, requiresRedeploy: true })) },
  }
}

it.each([
  ['Intel', 'openvino', ['panns-cnn6', 'uvr-mdxnet-9482', 'htdemucs', 'htdemucs-openvino']],
  ['NVIDIA', 'cuda', ['panns-cnn6', 'uvr-mdxnet-9482', 'htdemucs']],
  ['Mac', 'mps', ['panns-cnn6', 'uvr-mdxnet-9482', 'htdemucs']],
  ['AMD', 'rocm', ['panns-cnn6', 'uvr-mdxnet-9482', 'htdemucs']],
  ['瑞芯微', 'rknn', ['panns-cnn6', 'uvr-mdxnet-9482', 'uvr-mdxnet-9482-rknn', 'htdemucs']],
  ['CPU', 'cpu', ['panns-cnn6', 'uvr-mdxnet-9482', 'htdemucs']],
])('模型管理侧栏按 %s 节点过滤，保留通用模型和缺环境设备的模型', (_name, id, expected) => {
  const value = node()
  value.backends.find(item => item.id === id)!.detected = true
  wrapper = mount(NodeTab, { props: { node: value, nodeError: '', readiness: readiness(value, ''), reload: vi.fn(), modelsOnly: true } })
  expect(wrapper.findAll('[data-model]').map(row => row.attributes('data-model'))).toEqual(expected)
  expect(authRequest).not.toHaveBeenCalled()
})

it('仅轻量方案检测到的设备也能获得对应模型，明确未检测到的旧运行状态不冒充设备', () => {
  const value = node()
  value.backends.find(item => item.id === 'openvino')!.state = 'AVAILABLE'
  value.backends.find(item => item.id === 'openvino')!.device = { name: '旧设备信息' }
  value.separation!.backends.push(backend('rknn', true))
  wrapper = mount(NodeTab, { props: { node: value, nodeError: '', readiness: readiness(value, ''), reload: vi.fn(), modelsOnly: true } })
  expect(wrapper.find('[data-model="uvr-mdxnet-9482-rknn"]').exists()).toBe(true)
  expect(wrapper.find('[data-model="htdemucs-openvino"]').exists()).toBe(false)
  expect(planBackends(value, 'LEGACY_DEMUCS').map(item => item.id)).toEqual(['cpu'])
  expect(planBackends(value, 'AI_CLEAN').map(item => item.id)).toEqual(['cpu', 'rknn'])
})

async function openOverview(value: Node) {
  vi.mocked(authRequest).mockImplementation(async path => path.includes('/node') ? value : {
    backend: 'deployment', effectiveBackend: 'qsv', deploymentBackend: 'qsv', revision: 1, writable: true, detectedBackends: ['qsv', 'vaapi'],
  })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/system/compute', component: ComputeOverview, props: { connected: true, capabilities: ['media-probe', 'transcode-hls'] } }] })
  await router.push('/system/compute')
  wrapper = mount({ template: '<RouterView />' }, { global: { plugins: [router], stubs: {
    ElDrawer: { props: ['modelValue', 'title'], template: '<aside v-if="modelValue" class="drawer"><h2>{{ title }}</h2><slot /></aside>' },
  } } })
  await flushPromises()
}

it('Intel 节点概览和环境说明不再列出其他厂商，实际模型入口继续按设备过滤', async () => {
  const value = node()
  value.backends.find(item => item.id === 'openvino')!.detected = true
  await openOverview(value)
  expect(wrapper!.text()).not.toMatch(/Mac|NVIDIA|AMD|瑞芯微/)
  const button = (text: string) => wrapper!.findAll('button').find(item => item.text() === text)!
  await button('运行环境说明').trigger('click'); await flushPromises()
  const environment = wrapper!.get('.environment-help')
  expect(environment.text()).not.toMatch(/Mac|NVIDIA|AMD|瑞芯微|四种加速镜像/)
  expect(environment.findAll('.deployment-guide section')).toHaveLength(1)
  expect(environment.text()).toContain('fixture:openvino')
  expect(environment.text()).not.toMatch(/fixture:(cuda|rocm|rknn)/)
  await button('模型管理').trigger('click'); await flushPromises()
  expect(wrapper!.get('.models-only').findAll('[data-model]').map(item => item.attributes('data-model'))).toEqual(['panns-cnn6', 'uvr-mdxnet-9482', 'htdemucs', 'htdemucs-openvino'])
})
