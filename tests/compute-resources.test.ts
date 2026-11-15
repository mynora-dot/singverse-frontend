// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useComputeResources } from '../src/admin/modules/compute-settings/useComputeResources'
import { authRequest } from '../src/admin/core/auth/api'
import type { Node } from '../src/admin/modules/audio-processing/api'

vi.mock('../src/admin/core/auth/api', () => ({ authRequest: vi.fn() }))
let wrapper: VueWrapper | undefined
let resources!: ReturnType<typeof useComputeResources>
let hidden = false
const node = (state = 'IDLE') => ({ operation: { state, bytes: 0 }, backends: [] } as unknown as Node)
const nodeCalls = () => vi.mocked(authRequest).mock.calls.filter(([path]) => path.includes('/node'))
beforeEach(() => {
  vi.useFakeTimers(); hidden = false
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  vi.mocked(authRequest).mockReset().mockImplementation(async path => path.includes('/node') ? node() : {} as never)
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.restoreAllMocks(); vi.useRealTimers() })
async function open() {
  wrapper = mount(defineComponent({ setup() { resources = useComputeResources(true, true); return () => h('div') } }))
  await flushPromises()
}
function visibility(value: boolean) { hidden = value; document.dispatchEvent(new Event('visibilitychange')) }

it('空闲节点按 30 秒更新，模型操作期间保持 4 秒更新，后台暂停', async () => {
  await open()
  await vi.advanceTimersByTimeAsync(4000); expect(nodeCalls()).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(26000); expect(nodeCalls()).toHaveLength(2)
  vi.mocked(authRequest).mockResolvedValue(node('DOWNLOADING') as never)
  await resources.reloadNode(); await vi.advanceTimersByTimeAsync(4000)
  expect(nodeCalls()).toHaveLength(4)
  visibility(true); await vi.advanceTimersByTimeAsync(30000)
  expect(nodeCalls()).toHaveLength(4)
  visibility(false); await flushPromises()
  expect(nodeCalls()).toHaveLength(5)
})

it('轮询与手动读取复用慢请求，操作完成后再读取新状态', async () => {
  let resolve!: (value: Node) => void
  vi.mocked(authRequest).mockImplementation(path => path.includes('/node') ? new Promise(done => { resolve = done }) : Promise.resolve({} as never))
  await open()
  const manual = resources.reloadNode()
  const mutation = vi.fn(async () => undefined)
  const action = resources.run(mutation)
  await flushPromises(); await vi.advanceTimersByTimeAsync(60000)
  expect(nodeCalls()).toHaveLength(1)
  vi.mocked(authRequest).mockResolvedValue(node('VERIFYING') as never)
  resolve(node()); await manual; await action; await flushPromises()
  expect(mutation).toHaveBeenCalledTimes(1)
  expect(nodeCalls()).toHaveLength(2)
  expect(resources.node.value?.operation.state).toBe('VERIFYING')
  await vi.advanceTimersByTimeAsync(4000); expect(nodeCalls()).toHaveLength(3)
})

it('离开后忽略迟到结果，不再轮询', async () => {
  let resolve!: (value: Node) => void
  vi.mocked(authRequest).mockImplementation(path => path.includes('/node') ? new Promise(done => { resolve = done }) : Promise.resolve({} as never))
  await open(); wrapper!.unmount(); wrapper = undefined
  resolve(node('VERIFYING')); await flushPromises(); await vi.advanceTimersByTimeAsync(60000)
  expect(resources.node.value).toBeUndefined()
  expect(nodeCalls()).toHaveLength(1)
})
