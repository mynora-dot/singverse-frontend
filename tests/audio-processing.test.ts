// @vitest-environment jsdom
import { type DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import AudioModelsHarness from './fixtures/AudioModelsHarness.vue'
import View from '../src/admin/modules/audio-processing/AudioProcessingView.vue'
import { authRequest } from '../src/admin/core/auth/api'
import { confirmDanger } from '../src/admin/shared/ui/confirm'
import { audioFailureMessage, audioIssue, readiness } from '../src/admin/modules/audio-processing/presentation'
import type { Node } from '../src/admin/modules/audio-processing/api'

const router = vi.hoisted(() => ({ route: undefined as unknown as { path: string; query: Record<string, string> }, replace: vi.fn(), push: vi.fn() }))
vi.mock('vue-router', async () => {
  const { reactive } = await import('vue')
  router.route = reactive({ path: '/library/audio-processing', query: {} })
  router.replace.mockImplementation(async (to: { query: Record<string, string> }) => { router.route.query = typeof to === 'string' ? {} : to.query })
  return { useRoute: () => router.route, useRouter: () => ({ replace: router.replace, push: router.push }) }
})
vi.mock('../src/admin/core/auth/api', () => ({ authRequest: vi.fn() }))
vi.mock('../src/admin/shared/ui/confirm', () => ({ confirmDanger: vi.fn(async () => true) }))
let wrapper: ReturnType<typeof mount> | undefined
let ready = true
let resourceReady = true
const preview = { id: 'batch', state: 'PREVIEW', backend: '', total: 2, counts: { PENDING: 2 }, categories: { UNPROBED: 1, ELIGIBLE: 1 } }
const roles = { state: 'UNKNOWN', revision: 0, streams: [{ id: 'stream:1', codec: 'aac', channels: 2 }, { id: 'stream:2', codec: 'aac', channels: 2 }], jobs: [] }
const node = () => ({ selected: ready ? 'cpu' : null, selection: 'auto', environment: { system: 'Linux', architecture: 'aarch64', processor: 'RK3566', versions: {} }, model: { installed: false, writable: true, filename: 'model.th', sha256: 'digest', maxBytes: 100 * 1024 ** 2 }, operation: { state: 'IDLE', bytes: 0 }, backends: [{ id: 'cpu', state: ready ? 'AVAILABLE' : 'UNVERIFIED' }, { id: 'rknn', state: 'MODEL_UNSUPPORTED', reason: '无通过验收的转换模型' }], instructions: {} } as unknown as Node)
const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, artists: ['歌手'], sourceName: '媒体库', relativePath: id + '.mkv', category: 'ELIGIBLE', audio: { state: 'UNKNOWN', streams: [{ id: 'stream:1' }], jobs: [] }, ...extra })
beforeEach(() => {
  vi.useFakeTimers(); ready = true; resourceReady = true; router.route.query = {}; router.replace.mockClear(); router.push.mockClear(); vi.mocked(confirmDanger).mockClear().mockResolvedValue(true)
  vi.mocked(authRequest).mockReset().mockImplementation(async (path) => {
    if (path.includes('/media-sources')) return { items: [] } as never
    if (path.includes('/node')) return { ...node(), resourceReady } as never
    if (path.includes('/songs?')) { const page = new URL('http://test' + path).searchParams.get('page'); const ids = page === '1' ? ['c', 'd'] : ['a', 'b']; return { totalElements: 60, items: ids.map(id => row(id)) } as never }
    if (path.endsWith('/batches/preview') || path.endsWith('/retry')) return preview as never
    if (path.endsWith('/submit')) return { ...preview, state: 'QUEUED' } as never
    if (path.endsWith('/batches/batch?page=0')) return { ...preview, state: 'QUEUED', items: [{ song_id: 'a', title: 'a', state: 'PROCESSING', job_state: 'RUNNING', execution: { backend: 'cpu' }, error: '' }] } as never
    if (path.includes('/batches?')) return { items: [{ ...preview, state: 'QUEUED' }], totalElements: 1 } as never
    if (path.endsWith('/audio-roles')) return roles as never
    return {} as never
  })
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.useRealTimers() })
const stubs = {
  RouterLink: { template: '<a><slot /></a>' },
  ElDialog: { props: ['modelValue'], template: '<div v-if="modelValue" role="dialog"><slot /><slot name="footer" /></div>' },
  ElDrawer: { props: ['modelValue', 'title'], template: '<aside v-if="modelValue" class="drawer"><h2>{{ title }}</h2><slot /></aside>' },
}
async function open() { wrapper = mount(View, { global: { stubs } }); await flushPromises() }
function button(text: string, scope: Pick<DOMWrapper<Element>, 'findAll'> = wrapper!) { return scope.findAll('button').find(item => item.text() === text)! }
async function configureGeneration() {
  await button('生成伴奏', wrapper!.get('.selection-bar')).trigger('click'); await flushPromises()
}
async function prepareGeneration() {
  await configureGeneration()
  await button('预览处理范围').trigger('click'); await flushPromises()
}
function requested(fragment: string) { return vi.mocked(authRequest).mock.calls.some(([path]) => path.includes(fragment)) }

it('空闲页面降低更新频率，后台暂停，恢复可见时立即读取', async () => {
  let hidden = false
  const visibility = vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  const original = vi.mocked(authRequest).getMockImplementation()!
  vi.mocked(authRequest).mockImplementation(async (path, ...args) => path.includes('/batches?') ? { items: [], totalElements: 0 } as never : original(path, ...args))
  const nodeCalls = () => vi.mocked(authRequest).mock.calls.filter(([path]) => path.includes('/node')).length
  try {
    await open(); expect(nodeCalls()).toBe(1)
    await vi.advanceTimersByTimeAsync(4000); expect(nodeCalls()).toBe(1)
    await vi.advanceTimersByTimeAsync(26000); expect(nodeCalls()).toBe(2)
    hidden = true; document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(60000); expect(nodeCalls()).toBe(2)
    hidden = false; document.dispatchEvent(new Event('visibilitychange')); await flushPromises()
    expect(nodeCalls()).toBe(3)
  } finally { visibility.mockRestore() }
})

it('节点慢响应完成前不启动下一轮轮询', async () => {
  let resolve!: (value: Node) => void
  const original = vi.mocked(authRequest).getMockImplementation()!
  vi.mocked(authRequest).mockImplementation((path, ...args) => path.includes('/node') ? new Promise(done => { resolve = done }) : original(path, ...args))
  await open(); await vi.advanceTimersByTimeAsync(60000)
  expect(vi.mocked(authRequest).mock.calls.filter(([path]) => path.includes('/node'))).toHaveLength(1)
  vi.mocked(authRequest).mockImplementation(original)
  resolve(node()); await flushPromises(); await vi.advanceTimersByTimeAsync(4000)
  expect(vi.mocked(authRequest).mock.calls.filter(([path]) => path.includes('/node'))).toHaveLength(2)
})

it('任务中心的批次深链接直接打开指定批次详情', async () => {
  router.route.query = { tab: 'tasks', batch: 'batch' }
  await open()
  expect(wrapper!.get('.drawer').text()).toContain('任务详情')
  expect(requested('/batches/batch?page=0')).toBe(true)
})

it('跨页勾选后确认生成，提交后进入生成任务并显示执行设备', async () => {
  await open(); await wrapper!.find('input[aria-label="选择a"]').setValue(true)
  await button('下一页').trigger('click'); await flushPromises()
  await wrapper!.find('input[aria-label="选择c"]').setValue(true)
  expect(wrapper!.text()).toContain('已选 2 首')
  await prepareGeneration()
  expect(authRequest).toHaveBeenCalledWith('/api/v1/audio-processing/batches/preview', 'POST', expect.objectContaining({ ids: ['a', 'c'], all: false }), 120000)
  const dialog = wrapper!.get('[role="dialog"]')
  expect(dialog.text()).toContain('将为 2 首歌曲生成独立伴奏'); expect(dialog.text()).toContain('先读取音轨 1 首')
  await button('开始生成', dialog).trigger('click'); await flushPromises()
  expect(authRequest).toHaveBeenCalledWith('/api/v1/audio-processing/batches/batch/submit', 'POST')
  expect(router.route.query.tab).toBe('tasks'); await flushPromises()
  expect(wrapper!.get('[role="tab"][aria-selected="true"]').text()).toContain('生成任务')
  expect(wrapper!.get('.drawer').text()).toContain('任务详情')
  await vi.advanceTimersByTimeAsync(4000); await flushPromises()
  const item = wrapper!.get('.item-row'); expect(item.text()).toContain('CPU'); expect(item.text()).toContain('生成中')
})
it('全部筛选结果绑定已应用的筛选，编辑未提交条件不会改变快照范围', async () => {
  await open(); await button('选择全部 60 首').trigger('click')
  expect(wrapper!.text()).toContain('已选 60 首')
  await wrapper!.find('input[placeholder="搜索歌曲名称"]').setValue('尚未应用')
  await prepareGeneration()
  expect(authRequest).toHaveBeenCalledWith('/api/v1/audio-processing/batches/preview', 'POST', expect.objectContaining({ all: true, filter: expect.objectContaining({ title: '', streams: null }) }), 120000)
})
it('后台准备显示进度，准备完成前不能提交，完成后等待明确确认', async () => {
  const previous = vi.mocked(authRequest).getMockImplementation()!
  vi.mocked(authRequest).mockImplementation(async (...args) => {
    if (args[0].endsWith('/batches/preview')) return { ...preview, state: 'PREPARING', prepared: 200, selectionTotal: 1000 } as never
    if (args[0].endsWith('/batches/batch?page=0')) return preview as never
    return previous(...args)
  })
  await open(); await wrapper!.get('input[aria-label="选择a"]').setValue(true)
  await prepareGeneration()
  expect(wrapper!.get('[role="dialog"]').text()).toContain('200 / 1000')
  expect(button('开始生成').attributes('disabled')).toBeDefined()
  expect(requested('/submit')).toBe(false)
  await vi.advanceTimersByTimeAsync(4000); await flushPromises()
  expect(button('开始生成').attributes('disabled')).toBeUndefined()
  expect(requested('/submit')).toBe(false)
})
it('准备中可取消且取消后不能提交', async () => {
  const previous = vi.mocked(authRequest).getMockImplementation()!
  vi.mocked(authRequest).mockImplementation(async (...args) => {
    if (args[0].endsWith('/batches/preview')) return { ...preview, state: 'PREPARING', prepared: 0, selectionTotal: 2 } as never
    if (args[0].endsWith('/cancel')) return { ...preview, state: 'CANCELLED' } as never
    return previous(...args)
  })
  await open(); await wrapper!.get('input[aria-label="选择a"]').setValue(true)
  await prepareGeneration()
  await button('取消准备').trigger('click'); await flushPromises()
  expect(authRequest).toHaveBeenCalledWith('/api/v1/audio-processing/batches/batch/cancel', 'POST')
  expect(wrapper!.get('[role="dialog"]').text()).toContain('已取消准备')
  expect(button('开始生成').attributes('disabled')).toBeDefined()
})
it('取消准备后迟到的预览轮询不能恢复开始按钮', async () => {
  const previous = vi.mocked(authRequest).getMockImplementation()!
  let resolvePreview!: (value: unknown) => void
  vi.mocked(authRequest).mockImplementation((...args) => {
    if (args[0].endsWith('/batches/preview')) return Promise.resolve({ ...preview, state: 'PREPARING' }) as never
    if (args[0].endsWith('/batches/batch?page=0')) return new Promise(done => { resolvePreview = done }) as never
    if (args[0].endsWith('/cancel')) return Promise.resolve({ ...preview, state: 'CANCELLED' }) as never
    return previous(...args)
  })
  await open(); await wrapper!.get('input[aria-label="选择a"]').setValue(true)
  await prepareGeneration()
  await vi.advanceTimersByTimeAsync(4000)
  await button('取消准备').trigger('click'); await flushPromises()
  resolvePreview(preview); await flushPromises()
  expect(wrapper!.get('[role="dialog"]').text()).toContain('已取消准备')
  expect(button('开始生成').attributes('disabled')).toBeDefined()
})
it('索引503重试在KeepAlive切换页签后停止，返回歌曲页再恢复', async () => {
  const previous = vi.mocked(authRequest).getMockImplementation()!
  let building = true
  vi.mocked(authRequest).mockImplementation(async (...args) => {
    if (args[0].includes('/songs?') && building) throw Object.assign(new Error('Index building'), { status: 503 })
    return previous(...args)
  })
  await open()
  await wrapper!.get('#audio-tab-tasks').trigger('click'); await flushPromises()
  const calls = vi.mocked(authRequest).mock.calls.filter(([path]) => path.includes('/songs?')).length
  await vi.advanceTimersByTimeAsync(9000); await flushPromises()
  expect(vi.mocked(authRequest).mock.calls.filter(([path]) => path.includes('/songs?'))).toHaveLength(calls)
  building = false
  await wrapper!.get('#audio-tab-songs').trigger('click'); await flushPromises()
  expect(wrapper!.findAll('.song-row')).toHaveLength(2)
})
it('首次索引准备返回503时自动重试，离开后停止重试', async () => {
  const previous = vi.mocked(authRequest).getMockImplementation()!
  let building = true
  vi.mocked(authRequest).mockImplementation(async (...args) => {
    if (args[0].includes('/songs?') && building) throw Object.assign(new Error('Index building'), { status: 503 })
    return previous(...args)
  })
  await open()
  expect(wrapper!.text()).toContain('正在准备歌曲列表')
  building = false; await vi.advanceTimersByTimeAsync(1000); await flushPromises()
  expect(wrapper!.findAll('.song-row')).toHaveLength(2)
  wrapper!.unmount(); wrapper = undefined
  const count = vi.mocked(authRequest).mock.calls.length
  await vi.advanceTimersByTimeAsync(10000)
  expect(authRequest).toHaveBeenCalledTimes(count)
})
it('应用新筛选会清除旧选择', async () => {
  await open(); await wrapper!.find('input[aria-label="选择a"]').setValue(true)
  expect(wrapper!.text()).toContain('已选 1 首')
  await wrapper!.find('input[placeholder="搜索歌手"]').setValue('新歌手')
  await wrapper!.find('form').trigger('submit'); await flushPromises()
  expect(wrapper!.text()).not.toContain('已选')
  expect(wrapper!.find('.selection-bar').exists()).toBe(false)
  expect(requested('artist=%E6%96%B0%E6%AD%8C%E6%89%8B')).toBe(true)
})
it('状态快捷筛选立即生效，并按状态给出对应的单曲操作', async () => {
  const previous = vi.mocked(authRequest).getMockImplementation()!
  vi.mocked(authRequest).mockImplementation(async (...args) => {
    if (args[0].includes('/songs?')) return { totalElements: 3, items: [
      row('双轨', { category: 'INAPPLICABLE', audio: { state: 'UNKNOWN', streams: [{ id: 'stream:1' }, { id: 'stream:2' }], jobs: [] } }),
      row('已完成', { category: 'READY', audio: { state: 'CONFIRMED', streams: [{ id: 'stream:1' }], backingResource: { jobId: 'job' }, jobs: [] } }),
      row('失败', { audio: { state: 'CONFIRMED', streams: [{ id: 'stream:1' }], jobs: [{ id: 'j', kind: 'SEPARATE', state: 'FAILED', error: '素材或模型不支持此任务' }] } }),
    ] } as never
    return previous(...args)
  })
  await open()
  await wrapper!.get('select[aria-label="更多处理状态"]').setValue('UNCONFIRMED')
  await wrapper!.get('form').trigger('submit'); await flushPromises()
  expect(requested('state=UNCONFIRMED')).toBe(true)
  expect(wrapper!.text()).toContain('待标记'); expect(wrapper!.text()).toContain('已有伴奏'); expect(wrapper!.text()).toContain('素材或模型不支持此任务')
  expect(button('试听伴奏')).toBeTruthy(); expect(button('重新生成')).toBeTruthy()
  await button('标记原唱').trigger('click'); await flushPromises()
  const drawer = wrapper!.get('.audio-song-dialog')
  expect(drawer.text()).toContain('哪一条是原唱'); expect(drawer.text()).toContain('音轨 1 · AAC 立体声')
  expect(authRequest).toHaveBeenCalledWith('/api/v1/media-songs/%E5%8F%8C%E8%BD%A8/audio-roles')
})
it('从歌曲详情带入的歌曲会自动打开音轨面板，并可返回全部歌曲', async () => {
  router.route.query = { song: 'a' }; await open()
  expect(requested('songId=a')).toBe(true)
  expect(wrapper!.text()).toContain('正在查看单首歌曲：a')
  expect(wrapper!.get('.audio-song-dialog').text()).toContain('哪一条是原唱')
  await button('查看全部歌曲').trigger('click'); await flushPromises()
  expect(router.route.query.song).toBeUndefined()
})

it('已确认的双音轨把过去失败标为历史记录，并说明当前仍可用', async () => {
  const previous = vi.mocked(authRequest).getMockImplementation()!
  vi.mocked(authRequest).mockImplementation(async (...args) => args[0].includes('/songs?') ? { totalElements: 1, items: [row('双音轨', { category: 'READY', audio: { ...roles, state: 'CONFIRMED', jobs: [{ id: 'old', kind: 'ANALYZE', state: 'FAILED', error: 'AUDIO_EXECUTION_FAILED', createdAt: Date.UTC(2026, 10, 19) }] } })] } as never : previous(...args))
  await open()
  const state = wrapper!.get('.song-state')
  expect(state.text()).toContain('自带伴奏')
  expect(state.text()).toContain('历史记录：深度识别原唱/伴奏失败')
  expect(state.text()).toContain('现有原唱与伴奏仍可使用')
  expect(state.text()).toContain('请检查计算服务状态后重试')
  expect(state.text()).not.toContain('AUDIO_EXECUTION_FAILED')
  expect(state.find('.task-error').exists()).toBe(false)
})

it('成功重试后不再显示同类任务更早的失败', () => {
  expect(audioIssue({ ...roles, jobs: [{ id: 'new', kind: 'PROBE', state: 'SUCCEEDED' }, { id: 'old', kind: 'PROBE', state: 'FAILED', error: 'AUDIO_EXECUTION_FAILED' }] })).toBeUndefined()
  expect(audioIssue({ ...roles, jobs: [{ id: 'new', kind: 'ANALYZE', state: 'SUCCEEDED' }, { id: 'old', kind: 'FAST', state: 'FAILED', error: 'AUDIO_EXECUTION_FAILED' }] })).toBeUndefined()
  expect(audioIssue({ ...roles, jobs: [{ id: 'new', kind: 'FAST', state: 'SUCCEEDED' }, { id: 'old', kind: 'ANALYZE', state: 'FAILED', error: 'AUDIO_EXECUTION_FAILED' }] })).toBeUndefined()
  expect(audioFailureMessage('源文件无法读取')).toBe('源文件无法读取')
  expect(audioFailureMessage('UNKNOWN_AUDIO_ERROR')).toContain('音频处理失败')
})
it('页签与地址同步，支持方向键切换', async () => {
  router.route.query = { tab: 'tasks' }; await open()
  const tabs = wrapper!.findAll('[role="tab"]')
  const generationTab = tabs.find(tab => tab.text().includes('生成任务'))!
  expect(generationTab.attributes('aria-selected')).toBe('true'); expect(tabs[0]!.attributes('tabindex')).toBe('-1')
  expect(wrapper!.text()).toContain('2 首歌曲')
  await generationTab.trigger('keydown', { key: 'ArrowRight' }); await flushPromises()
  expect(router.replace).toHaveBeenLastCalledWith({ path: '/library/audio-processing', query: {} })
  expect(wrapper!.findAll('[role="tab"]')).toHaveLength(3)
})
it('停止进行中的任务需要确认，取消确认则不发送请求', async () => {
  router.route.query = { tab: 'tasks' }; await open()
  vi.mocked(confirmDanger).mockResolvedValueOnce(false)
  await button('停止').trigger('click'); await flushPromises()
  expect(confirmDanger).toHaveBeenCalledTimes(1); expect(requested('/batches/batch/cancel')).toBe(false)
  await button('停止').trigger('click'); await flushPromises()
  expect(authRequest).toHaveBeenCalledWith('/api/v1/audio-processing/batches/batch/cancel', 'POST')
})
it('任务详情显示真实分离进度，保存阶段不沿用分离百分比', async () => {
  const previous = vi.mocked(authRequest).getMockImplementation()!
  let stage = 'separate'
  vi.mocked(authRequest).mockImplementation(async (...args) => args[0].endsWith('/batches/batch?page=0')
    ? { ...preview, state: 'QUEUED', items: [{ song_id: 'a', title: 'a', state: 'PROCESSING', job_state: 'RUNNING',
      execution: { stage, progress: { completedFrames: 400, frames: 1000 } }, error: '' }] } as never : previous(...args))
  router.route.query = { tab: 'tasks' }; await open()
  await button('查看详情').trigger('click'); await flushPromises()
  expect(wrapper!.get('.item-row').text()).toContain('生成伴奏 40%')
  stage = 'encode'; await vi.advanceTimersByTimeAsync(4000); await flushPromises()
  expect(wrapper!.get('.item-row').text()).toContain('保存伴奏')
  expect(wrapper!.get('.item-row').text()).not.toContain('40%')
})
it('停止任务确认期间阻止重复提交，离页后不发送停止请求', async () => {
  router.route.query = { tab: 'tasks' }; await open()
  let confirm!: (approved: boolean) => void
  vi.mocked(confirmDanger).mockImplementationOnce(() => new Promise(done => { confirm = done }))
  const stop = button('停止')
  await stop.trigger('click')
  expect(stop.attributes('disabled')).toBeDefined()
  await stop.trigger('click'); expect(confirmDanger).toHaveBeenCalledTimes(1)
  wrapper!.unmount(); wrapper = undefined
  confirm(true); await flushPromises()
  expect(requested('/batches/batch/cancel')).toBe(false)
})
it('没有合格后端时禁止生成，并引导到节点与模型下载模型', async () => {
  ready = false; await open()
  expect(wrapper!.find('.selection-bar').exists()).toBe(false)
  await wrapper!.get('input[aria-label="选择a"]').setValue(true)
  await configureGeneration()
  expect(button('预览处理范围').attributes('disabled')).toBeDefined()
  expect(wrapper!.text()).toContain('还没有安装分离模型')
  await button('去准备环境').trigger('click'); await flushPromises()
  expect(router.push).toHaveBeenCalledWith('/system/compute#audio-models')
  wrapper!.unmount(); wrapper = mount(AudioModelsHarness, { global: { stubs } }); await flushPromises()
  expect(wrapper!.text()).toContain('自动安装')
  expect(wrapper!.text()).toContain('RK3566')
  await button('自动安装').trigger('click'); await flushPromises()
  expect(authRequest).toHaveBeenCalledWith('/api/v1/audio-processing/model/download', 'POST', undefined, 60000)
})
it('离开页面后不再轮询', async () => {
  await open(); wrapper!.unmount(); wrapper = undefined
  const count = vi.mocked(authRequest).mock.calls.length
  await vi.advanceTimersByTimeAsync(12000); await flushPromises()
  expect(authRequest).toHaveBeenCalledTimes(count)
})
it('模型试跑通过但当前资源不足时阻止生成并显示预算入口', async () => {
  resourceReady = false; await open()
  await wrapper!.get('input[aria-label="选择a"]').setValue(true)
  await configureGeneration()
  expect(button('预览处理范围').attributes('disabled')).toBeDefined()
  expect(wrapper!.text()).toContain('空闲内存或磁盘低于预算')
})
it('隐藏部署信息，OpenVINO模型下载使用独立清单', async () => {
  const previous = vi.mocked(authRequest).getMockImplementation()!
  vi.mocked(authRequest).mockImplementation(async (...args) => {
    if (args[0].includes('/node')) return { ...node(),
      build: { version: '0.1.0', revision: 'abc123', variant: 'cpu', runtimeLock: 'runtime-digest' },
      deployment: { note: '镜像架构由Docker选择', profiles: [{ backend: 'openvino', image: 'singverse-compute:0.1.0-openvino', command: 'docker compose --project-directory . example', included: false }] },
      models: [{ ...node().model, id: 'htdemucs', version: 'baseline' }, { id: 'htdemucs-openvino', version: 'fixed-revision', installed: false, writable: true, maxBytes: 128*1024**2, files: [{ name: 'htdemucs_fwd.xml', url: 'https://example.test/model.xml', sha256: 'expected', size: 1 }] }],
      backends: [{ id: 'cpu', state: 'AVAILABLE' }, { id: 'openvino', detected: true, state: 'IMAGE_MISSING', reason: '当前镜像未包含此推理后端' }]
    } as never
    return previous(...args)
  })
  wrapper = mount(AudioModelsHarness, { global: { stubs } }); await flushPromises()
  expect(wrapper!.text()).not.toContain('运行环境、镜像与安装命令')
  expect(wrapper!.text()).not.toContain('singverse-compute:0.1.0-openvino')
  expect(wrapper!.text()).toContain('当前镜像未包含')
  const openvino = wrapper!.get('[data-model="htdemucs-openvino"]')
  expect(openvino.text()).toContain('Intel 显卡版')
  expect(openvino.get('input[type="file"]').attributes('accept')).toBe('.zip')
  expect(wrapper!.get('[data-model="htdemucs"] input[type="file"]').attributes('accept')).toBe('.th')
  expect(openvino.text()).not.toContain('htdemucs_fwd.xml')
  await button('自动安装', openvino).trigger('click'); await flushPromises()
  expect(authRequest).toHaveBeenCalledWith('/api/v1/audio-processing/model/download?model=htdemucs-openvino', 'POST', undefined, 60000)
})

it.each([true, false])('NVIDIA 节点仅显示适配模型，CPU 降级为 %s', async cpuFallback => {
  const previous = vi.mocked(authRequest).getMockImplementation()!
  vi.mocked(authRequest).mockImplementation(async (...args) => args[0].includes('/node') ? {
    ...node(), cpuFallback,
    models: [
      { ...node().model, id: 'htdemucs', backends: ['cpu', 'cuda', 'rocm', 'mps'] },
      { ...node().model, id: 'htdemucs-openvino', backends: ['openvino'], installed: false },
      { ...node().model, id: 'uvr-mdxnet-9482-rknn', backends: ['rknn'], installed: false, downloadSourceRequired: true },
    ],
    backends: [{ id: 'cuda', detected: true, state: 'UNVERIFIED' }, { id: 'cpu', state: 'UNVERIFIED' }, { id: 'rknn', detected: false, state: 'IMAGE_MISSING' }],
  } as never : previous(...args))
  wrapper = mount(AudioModelsHarness, { global: { stubs } }); await flushPromises()
  expect(wrapper!.find('[data-model="htdemucs"]').exists()).toBe(true)
  expect(wrapper!.find('[data-model="htdemucs-openvino"]').exists()).toBe(false)
  expect(wrapper!.find('[data-model="uvr-mdxnet-9482-rknn"]').exists()).toBe(false)
})

it.each([true, undefined])('瑞芯微用 ZIP 离线导入，兼容 downloadSourceRequired 为 %s 的节点', async downloadSourceRequired => {
  const previous = vi.mocked(authRequest).getMockImplementation()!
  vi.mocked(authRequest).mockImplementation(async (...args) => args[0].includes('/node') ? {
    ...node(), cpuFallback: false,
    models: [{ ...node().model, id: 'uvr-mdxnet-9482-rknn', installed: false, downloadSourceRequired, target: 'rk3566' }],
    backends: [{ id: 'rknn', detected: true, state: 'MODEL_MISSING' }],
  } as never : previous(...args))
  wrapper = mount(AudioModelsHarness, { global: { stubs } }); await flushPromises()
  const model = wrapper!.get('[data-model="uvr-mdxnet-9482-rknn"]')
  expect(model.text()).toContain('瑞芯微版')
  expect(model.text()).not.toMatch(/自动安装|manifest\.json|rk3566|SHA-256/)
  expect(model.get('input[type="file"]').attributes('accept')).toBe('.zip')
  expect(model.find('form').exists()).toBe(false)
  expect(requested('/model/download')).toBe(false)
})

it('旧 setup 链接跳转性能节点配置', async () => {
  router.route.query = { tab: 'setup' }; await open()
  expect(router.replace).toHaveBeenCalledWith('/system/compute#audio-models')
})
it('表格展示封面音轨与任务信息，调整分页后回到首页', async () => {
  const previous = vi.mocked(authRequest).getMockImplementation()!
  vi.mocked(authRequest).mockImplementation(async (...args) => args[0].includes('/songs?') ? { totalElements: 60, items: [row('a', { coverAvailable: true, audio: { ...roles, jobs: [{ id: 'job', kind: 'SEPARATE', state: 'FAILED', backend: 'cuda', error: '执行失败' }] } })] } as never : previous(...args))
  await open()
  expect(wrapper!.findAll('thead th')).toHaveLength(6)
  expect(wrapper!.text()).toContain('AAC 立体声')
  expect(wrapper!.text()).toContain('执行失败')
  expect(wrapper!.get('.row-cover img').attributes('src')).toBe('/api/v1/metadata/songs/a/cover')
  await wrapper!.get('.row-cover img').trigger('error')
  expect(wrapper!.find('[aria-label="暂无歌曲封面"]').exists()).toBe(true)
  const pager = wrapper!.findComponent({ name: 'ElPagination' })
  pager.vm.$emit('current-change', 2); await flushPromises()
  pager.vm.$emit('size-change', 50); await flushPromises()
  expect(requested('page=0&size=50')).toBe(true)
})
it('生成伴奏只提供加速设备选项，CPU 保留为自动降级', async () => {
  const previous = vi.mocked(authRequest).getMockImplementation()!
  vi.mocked(authRequest).mockImplementation(async (...args) => args[0].includes('/node') ? { ...node(), backends: [{ id: 'cpu', state: 'AVAILABLE' }, { id: 'cuda', state: 'AVAILABLE', detected: true }, { id: 'mps', state: 'AVAILABLE', detected: true }] } as never : previous(...args))
  await open()
  await wrapper!.get('input[aria-label="选择a"]').setValue(true)
  await configureGeneration()
  const choices = wrapper!.get('[aria-label="生成伴奏使用的设备"]')
  expect(choices.find('option[value="cpu"]').exists()).toBe(false)
  expect(choices.find('option[value="cuda"]').exists()).toBe(true)
})
it('刷新后总量缩减，自动回到最后有效页', async () => {
  await open()
  const previous = vi.mocked(authRequest).getMockImplementation()!
  vi.mocked(authRequest).mockImplementation(async (...args) => args[0].includes('/songs?') ? { totalElements: 1, items: args[0].includes('page=0') ? [row('a')] : [] } as never : previous(...args))
  wrapper!.findComponent({ name: 'ElPagination' }).vm.$emit('current-change', 2)
  await flushPromises()
  expect(wrapper!.findComponent({ name: 'ElPagination' }).props('currentPage')).toBe(1)
  expect(wrapper!.findAll('.song-row')).toHaveLength(1)
})

it('伴奏页可保存 CPU 自动降级策略，并保留视频加速方式和修订号', async () => {
  const previous = vi.mocked(authRequest).getMockImplementation()!
  vi.mocked(authRequest).mockImplementation(async (...args) => {
    if (args[0] === '/api/v1/transcoding/hardware-settings') return { backend: 'deployment', revision: 9 } as never
    return previous(...args)
  })
  wrapper = mount(AudioModelsHarness, { global: { stubs } }); await flushPromises()
  await wrapper.get('.fallback-toggle input').setValue(false); await flushPromises()
  expect(authRequest).toHaveBeenCalledWith('/api/v1/transcoding/hardware-settings', 'POST', { backend: 'deployment', revision: 9, cpuFallback: false }, 45000)
  expect(wrapper!.text()).not.toContain('固定使用')
})
it('没有加速设备时也不提供手选 CPU 或 CPU 重试', async () => {
  await open()
  expect(wrapper!.find('option[value="cpu"]').exists()).toBe(false)
  expect(wrapper!.text()).not.toContain('改用 CPU 重试')
})

it('快速分类模型独立展示，GPU 节点也可下载且不提供设备选择', async () => {
  const previous = vi.mocked(authRequest).getMockImplementation()!
  vi.mocked(authRequest).mockImplementation(async (...args) => {
    if (args[0].includes('/node')) return { ...node(), cpuFallback: false,
      fastClassifier: { id: 'panns-cnn6', installed: false, ready: false, writable: true, maxBytes: 32*1024**2, files: [{ name: 'Cnn6_mAP=0.343.pth', size: 23698321, sha256: 'pinned' }] },
      backends: [{ id: 'mps', detected: true, state: 'UNVERIFIED' }]
    } as never
    return previous(...args)
  })
  wrapper = mount(AudioModelsHarness, { global: { stubs } }); await flushPromises()
  const fast = wrapper!.get('[data-model="panns-cnn6"]')
  expect(fast.text()).toContain('原唱与伴奏识别')
  expect(fast.find('select').exists()).toBe(false)
  expect(fast.get('input[type="file"]').attributes('accept')).toBe('.zip')
  await button('自动安装', fast).trigger('click'); await flushPromises()
  expect(authRequest).toHaveBeenCalledWith('/api/v1/audio-processing/model/download?model=panns-cnn6', 'POST', undefined, 60000)
})

it('启动自动试跑显示进度和播放优先提示，验证完成后恢复就绪', () => {
  const current = { ...node(), selected: null, startupCheck: { state: 'TESTING', backend: 'mps' } }
  expect(readiness(current, '').title).toContain('正在自动检测')
  expect(readiness(current, '').ready).toBe(false)
  current.startupCheck.state = 'WAITING'
  expect(readiness(current, '').title).toContain('等待空闲')
  expect(readiness(current, '').hint).toContain('播放任务优先')
  expect(readiness({ ...current, selected: 'mps', startupCheck: { state: 'COMPLETED' } }, '').ready).toBe(true)
})

it('选歌后才显示处理栏，打开配置或取消均不会创建批次', async () => {
  await open()
  expect(wrapper!.find('.selection-bar').exists()).toBe(false)
  await wrapper!.get('input[aria-label="选择a"]').setValue(true)
  await configureGeneration()
  expect(wrapper!.get('[role="dialog"]').text()).toContain('已选 1 首歌曲')
  expect(button('预览处理范围').attributes('disabled')).toBeUndefined()
  expect(requested('/batches/preview')).toBe(false)
  await button('取消').trigger('click'); await flushPromises()
  expect(wrapper!.find('[role="dialog"]').exists()).toBe(false)
  expect(wrapper!.get('.selection-bar').text()).toContain('已选 1 首')
  await button('取消选择').trigger('click')
  expect(wrapper!.find('.selection-bar').exists()).toBe(false)
})

it('新版方案卡只选择加速设备并保留方案请求，极速档不依赖 Demucs', async () => {
  ready = false
  const previous = vi.mocked(authRequest).getMockImplementation()!
  vi.mocked(authRequest).mockImplementation(async (...args) => args[0].includes('/node') ? { ...node(), backends: [{ id: 'mlx', state: 'AVAILABLE', reason: '' }], separation: { version: 1,
    profiles: [{ id: 'DSP_FAST', ready: true }, { id: 'AI_CLEAN', ready: true }, { id: 'LEGACY_DEMUCS', ready: true }],
    backends: [{ id: 'cpu', state: 'AVAILABLE' }, { id: 'openvino-cpu', state: 'AVAILABLE' }, { id: 'mlx', state: 'AVAILABLE' }],
  } } as never : previous(...args))
  await open(); await wrapper!.get('input[aria-label="选择a"]').setValue(true)
  await configureGeneration()
  expect(button('预览处理范围').attributes('disabled')).toBeUndefined()
  expect(wrapper!.find('.profile-card input[value="AI_CLEAN"]').exists()).toBe(false)
  await wrapper!.get('.profile-card input[value="LEGACY_DEMUCS"]').setValue(true)
  const devices = wrapper!.get('select[aria-label="生成伴奏使用的设备"]')
  expect(devices.find('option[value="cpu"]').exists()).toBe(false)
  expect(devices.find('option[value="openvino-cpu"]').exists()).toBe(false)
  await devices.setValue('mlx')
  await button('预览处理范围').trigger('click'); await flushPromises()
  expect(authRequest).toHaveBeenCalledWith('/api/v1/audio-processing/batches/preview', 'POST', expect.objectContaining({ ids: ['a'], all: false, backend: 'mlx', separationProfile: 'LEGACY_DEMUCS', outputFormat: 'aac' }), 120000)
  expect(requested('/submit')).toBe(false)
})

it('识别配置显示快速模型降级说明，并提交所选识别方式', async () => {
  const previous = vi.mocked(authRequest).getMockImplementation()!
  vi.mocked(authRequest).mockImplementation(async (...args) => {
    if (args[0].includes('/node')) return { ...node(), fastClassifier: { ready: false } } as never
    if (args[0].endsWith('/batches/preview')) return { ...preview, kind: 'ANALYZE' } as never
    return previous(...args)
  })
  await open(); await wrapper!.get('input[aria-label="选择a"]').setValue(true)
  await button('识别已有音轨', wrapper!.get('.selection-bar')).trigger('click'); await flushPromises()
  expect(wrapper!.get('[role="dialog"]').text()).toContain('本次仅按音轨标签判断')
  await wrapper!.get('input[name="recognition-kind"][value="ANALYZE"]').setValue(true)
  await button('预览处理范围').trigger('click'); await flushPromises()
  expect(authRequest).toHaveBeenCalledWith('/api/v1/audio-processing/batches/preview', 'POST', expect.objectContaining({ kind: 'ANALYZE', ids: ['a'] }), 120000)
  expect(button('开始识别')).toBeTruthy()
  expect(requested('/submit')).toBe(false)
})

it('范围准备失败留在配置面板，错误可见且允许重试', async () => {
  const previous = vi.mocked(authRequest).getMockImplementation()!
  let failing = true
  vi.mocked(authRequest).mockImplementation(async (...args) => {
    if (args[0].endsWith('/batches/preview') && failing) throw new Error('节点暂时不可用')
    return previous(...args)
  })
  await open(); await wrapper!.get('input[aria-label="选择a"]').setValue(true)
  await prepareGeneration()
  expect(wrapper!.get('[role="dialog"]').text()).toContain('节点暂时不可用')
  expect(button('预览处理范围').attributes('disabled')).toBeUndefined()
  failing = false
  await button('预览处理范围').trigger('click'); await flushPromises()
  expect(button('开始生成')).toBeTruthy()
})

it('预览读取逐曲跳过原因，明细失败时先重试再允许提交', async () => {
  const previous = vi.mocked(authRequest).getMockImplementation()!
  let failing = true
  vi.mocked(authRequest).mockImplementation(async (...args) => {
    if (args[0].endsWith('/batches/batch?page=0')) {
      if (failing) throw new Error('读取明细失败')
      return { ...preview, items: [{ song_id: 'a', title: '已有伴奏歌曲', state: 'SKIPPED', category: 'READY', error: '已有伴奏' }] } as never
    }
    return previous(...args)
  })
  await open(); await wrapper!.get('input[aria-label="选择a"]').setValue(true)
  await prepareGeneration()
  expect(button('开始生成').attributes('disabled')).toBeDefined()
  expect(wrapper!.get('[role="dialog"]').text()).toContain('读取明细失败')
  failing = false; await button('重试明细').trigger('click'); await flushPromises()
  expect(wrapper!.get('.preview-songs').text()).toContain('已有伴奏歌曲已有伴奏已跳过')
  expect(button('开始生成').attributes('disabled')).toBeUndefined()
})

it('未读取音轨的行先进入检查面板，不直接生成批次', async () => {
  const previous = vi.mocked(authRequest).getMockImplementation()!
  vi.mocked(authRequest).mockImplementation(async (...args) => args[0].includes('/songs?') ? { totalElements: 1, items: [row('未知', { category: 'UNPROBED', audio: { state: 'UNKNOWN', jobs: [] } })] } as never : previous(...args))
  await open(); await button('读取音轨').trigger('click'); await flushPromises()
  expect(wrapper!.get('.audio-song-dialog').text()).toContain('未知')
  expect(requested('/batches/preview')).toBe(false)
})

it('生成任务可返回对应歌曲并自动打开音轨面板', async () => {
  router.route.query = { tab: 'tasks', batch: 'batch' }; await open()
  await button('查看歌曲').trigger('click'); await flushPromises()
  expect(router.route.query).toEqual({ song: 'a' })
  expect(wrapper!.get('#audio-tab-songs').attributes('aria-selected')).toBe('true')
  expect(wrapper!.get('.audio-song-dialog').text()).toContain('哪一条是原唱')
})

it('更多筛选支持 Escape 收起，且不应用未提交的条件', async () => {
  await open()
  const details = wrapper!.get('.more-filters')
  ;(details.element as HTMLDetailsElement).open = true
  await wrapper!.get('input[aria-label="歌手"]').setValue('尚未应用')
  await details.trigger('keydown', { key: 'Escape' })
  expect((details.element as HTMLDetailsElement).open).toBe(false)
  expect((wrapper!.get('input[aria-label="歌手"]').element as HTMLInputElement).value).toBe('')
  expect(requested('artist=')).toBe(false)
})
