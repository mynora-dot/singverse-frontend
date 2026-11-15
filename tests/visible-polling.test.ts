// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useVisiblePolling } from '../src/admin/shared/composables/use-visible-polling'

let wrapper: VueWrapper | undefined
let hidden = false
beforeEach(() => {
  vi.useFakeTimers()
  hidden = false
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.restoreAllMocks(); vi.useRealTimers() })
function visibility(value: boolean) { hidden = value; document.dispatchEvent(new Event('visibilitychange')) }
function start(task: Parameters<typeof useVisiblePolling>[0], delay: () => number | undefined = () => 4000, immediate = true) {
  let polling!: ReturnType<typeof useVisiblePolling>
  wrapper = mount(defineComponent({ setup() { polling = useVisiblePolling(task, delay, { immediate }); return () => h('div') } }))
  return polling
}

it('隐藏页面不启动轮询，恢复可见后立即更新并重新计时', async () => {
  hidden = true
  const task = vi.fn(async () => undefined)
  start(task); await flushPromises(); await vi.advanceTimersByTimeAsync(30000)
  expect(task).not.toHaveBeenCalled()
  visibility(false); await flushPromises()
  expect(task).toHaveBeenCalledTimes(1)
  visibility(true); await vi.advanceTimersByTimeAsync(30000)
  expect(task).toHaveBeenCalledTimes(1)
  visibility(false); await flushPromises(); await vi.advanceTimersByTimeAsync(4000)
  expect(task).toHaveBeenCalledTimes(3)
})

it('慢请求期间重复恢复合并为一次串行补读，手动刷新和计时不会重叠请求', async () => {
  let resolve!: () => void
  const task = vi.fn().mockImplementationOnce(() => new Promise<void>(done => { resolve = done })).mockResolvedValue(undefined)
  const polling = start(task); await flushPromises()
  const manual = polling.refresh()
  visibility(true); visibility(false); visibility(true); visibility(false)
  await vi.advanceTimersByTimeAsync(60000)
  expect(task).toHaveBeenCalledTimes(1)
  resolve(); await manual; await flushPromises()
  expect(task).toHaveBeenCalledTimes(2)
  expect(task.mock.calls.map(([reason]) => reason)).toEqual(['initial', 'resume'])
  await vi.advanceTimersByTimeAsync(3999); expect(task).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(1); expect(task).toHaveBeenCalledTimes(3)
})

it('请求完成时再次隐藏会保留暂停，下一次恢复才补读且不会循环触发', async () => {
  let resolve!: () => void
  const task = vi.fn().mockImplementationOnce(() => new Promise<void>(done => { resolve = done })).mockResolvedValue(undefined)
  start(task, () => undefined); await flushPromises()
  visibility(true); visibility(false); visibility(true)
  resolve(); await flushPromises(); await vi.advanceTimersByTimeAsync(60000)
  expect(task).toHaveBeenCalledTimes(1)
  visibility(false); await flushPromises(); await vi.advanceTimersByTimeAsync(60000)
  expect(task).toHaveBeenCalledTimes(2)
  expect(task).toHaveBeenLastCalledWith('resume')
})

it('根据完成后的状态降频，停止任务后不继续计时，恢复可见仍能更新一次', async () => {
  let delay: number | undefined = 30000
  const task = vi.fn(async () => undefined)
  const polling = start(task, () => delay); await flushPromises()
  await vi.advanceTimersByTimeAsync(4000); expect(task).toHaveBeenCalledTimes(1)
  delay = 4000; polling.schedule()
  await vi.advanceTimersByTimeAsync(4000); expect(task).toHaveBeenCalledTimes(2)
  delay = undefined; polling.schedule()
  await vi.advanceTimersByTimeAsync(60000); expect(task).toHaveBeenCalledTimes(2)
  visibility(true); visibility(false); await flushPromises()
  expect(task).toHaveBeenCalledTimes(3)
})

it('读取失败后继续重试，卸载后迟到响应不会创建新计时器', async () => {
  let resolve!: () => void
  const task = vi.fn().mockRejectedValueOnce(new Error('网络中断')).mockImplementation(() => new Promise<void>(done => { resolve = done }))
  start(task); await flushPromises(); await vi.advanceTimersByTimeAsync(4000)
  expect(task).toHaveBeenCalledTimes(2)
  wrapper!.unmount(); wrapper = undefined
  resolve(); await flushPromises(); visibility(true); visibility(false)
  await vi.advanceTimersByTimeAsync(30000)
  expect(task).toHaveBeenCalledTimes(2)
})

it('允许先加载来源列表，调用刷新时才开始跟踪任务', async () => {
  const task = vi.fn(async () => undefined)
  const polling = start(task, () => undefined, false); await flushPromises()
  expect(task).not.toHaveBeenCalled()
  await polling.refresh(); expect(task).toHaveBeenCalledTimes(1)
})

it('挂载后立即离开不会在下一微任务中发起读取', async () => {
  const task = vi.fn(async () => undefined)
  start(task); wrapper!.unmount(); wrapper = undefined
  await flushPromises(); await vi.advanceTimersByTimeAsync(30000)
  expect(task).not.toHaveBeenCalled()
})
