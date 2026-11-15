// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useActiveTaskCount } from '../src/admin/app/composables/use-active-task-count'
import { auth, authRequest, type Account } from '../src/admin/core/auth/api'

vi.mock('../src/admin/core/auth/api', async importOriginal => ({
  ...await importOriginal<typeof import('../src/admin/core/auth/api')>(), authRequest: vi.fn(),
}))
const account = (username = 'admin'): Account => ({ username, defaultPassword: false, mfaEnabled: true, recoveryCodesRemaining: 0 })
const Badge = defineComponent({ setup: () => useActiveTaskCount(30000), template: '<span>{{ count }}</span>' })
let wrapper: VueWrapper | undefined
let visibility: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.useFakeTimers(); auth.account = account()
  visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.mocked(authRequest).mockReset().mockResolvedValue({ totalElements: 3 })
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined; auth.account = null; vi.restoreAllMocks(); vi.useRealTimers() })

it('路由更新同一账户资料不重复加载，按读取完成时间开始下一轮', async () => {
  wrapper = mount(Badge); await flushPromises()
  expect(wrapper.text()).toBe('3')
  auth.account = { ...account(), mfaEnabled: false }; await flushPromises()
  expect(authRequest).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(30000); await flushPromises()
  expect(authRequest).toHaveBeenCalledTimes(2)
})

it('慢请求期间重复可见事件共用一次读取，完成前不积累轮询', async () => {
  let resolve!: (page: { totalElements: number }) => void
  vi.mocked(authRequest).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  wrapper = mount(Badge)
  document.dispatchEvent(new Event('visibilitychange'))
  document.dispatchEvent(new Event('visibilitychange'))
  await vi.advanceTimersByTimeAsync(90000)
  expect(authRequest).toHaveBeenCalledTimes(1)
  resolve({ totalElements: 7 }); await flushPromises()
  expect(wrapper.text()).toBe('7')
  await vi.advanceTimersByTimeAsync(30000)
  expect(authRequest).toHaveBeenCalledTimes(2)
})

it('注销后忽略迟到的任务总数并停止后续轮询', async () => {
  let resolve!: (page: { totalElements: number }) => void
  vi.mocked(authRequest).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  wrapper = mount(Badge)
  auth.account = null
  resolve({ totalElements: 9 }); await flushPromises()
  expect(wrapper.text()).toBe('0')
  await vi.advanceTimersByTimeAsync(90000)
  expect(authRequest).toHaveBeenCalledTimes(1)
})

it('切换账户时旧请求不能覆盖新账户结果或生成额外定时器', async () => {
  let resolve!: (page: { totalElements: number }) => void
  vi.mocked(authRequest).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  wrapper = mount(Badge)
  auth.account = account('other'); await flushPromises()
  expect(wrapper.text()).toBe('3')
  resolve({ totalElements: 9 }); await flushPromises()
  expect(wrapper.text()).toBe('3')
  await vi.advanceTimersByTimeAsync(30000)
  expect(authRequest).toHaveBeenCalledTimes(3)
})

it('后台初次挂载不请求，返回前台立即更新，隐藏和卸载后停止轮询', async () => {
  visibility.mockReturnValue('hidden')
  wrapper = mount(Badge); await flushPromises()
  expect(authRequest).not.toHaveBeenCalled()
  visibility.mockReturnValue('visible'); document.dispatchEvent(new Event('visibilitychange')); await flushPromises()
  expect(authRequest).toHaveBeenCalledTimes(1)
  visibility.mockReturnValue('hidden'); document.dispatchEvent(new Event('visibilitychange'))
  await vi.advanceTimersByTimeAsync(90000)
  expect(authRequest).toHaveBeenCalledTimes(1)
  wrapper.unmount(); wrapper = undefined
  visibility.mockReturnValue('visible'); document.dispatchEvent(new Event('visibilitychange'))
  await vi.advanceTimersByTimeAsync(90000)
  expect(authRequest).toHaveBeenCalledTimes(1)
})
