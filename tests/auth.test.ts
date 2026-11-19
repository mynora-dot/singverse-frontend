// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { auth, authRequest, refreshAccount, ApiError } from '../src/admin/core/auth/api'
import { router } from '../src/admin/app/router/index'
import { flushPromises } from '@vue/test-utils'

afterEach(() => { vi.unstubAllGlobals(); auth.account = null })
it('未登录访问管理路由会跳转登录并保留目标', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(Response.json({ detail: '请先登录' }, { status: 401 }))))
  await router.push('/system/parameters')
  expect(router.currentRoute.value.path).toBe('/login')
  expect(router.currentRoute.value.query.redirect).toBe('/system/parameters')
})
it('二次验证未完成不能通过会话查询获得权限', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(Response.json({}, { status: 401 }))))
  expect(await refreshAccount()).toBeNull()
  expect(auth.account).toBeNull()
})
it('写操作先获取 CSRF 并发送安全 Cookie 请求配置', async () => {
  const fetcher = vi.fn().mockImplementation((path: string) => Promise.resolve(Response.json(path.endsWith('/csrf') ? { token: 'csrf-example' } : { state: 'mfaRequired' })))
  vi.stubGlobal('fetch', fetcher)
  expect(await authRequest('/api/v1/auth/login', 'POST', { username: 'admin', password: 'test' })).toEqual({ state: 'mfaRequired' })
  expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store', headers: { 'X-CSRF-Token': 'csrf-example' } })
  expect(auth.account).toBeNull()
})
it('接口限定同源命名空间', async () => {
  await expect(authRequest('https://evil.example/api/v1/auth/login')).rejects.toThrow('同源')
  await expect(authRequest('/system/parameters')).rejects.toThrow('同源')
})
it('显示限流返回的信息', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(Response.json({ detail: '尝试过于频繁，请稍后重试' }, { status: 429 }))))
  await expect(authRequest('/api/v1/auth/csrf')).rejects.toBeInstanceOf(ApiError)
  await expect(authRequest('/api/v1/auth/csrf')).rejects.toThrow('尝试过于频繁')
})

it('会话过期与密码校验失败分别处理', async () => {
  const notify = vi.spyOn(window, 'dispatchEvent')
  vi.stubGlobal('fetch', vi.fn().mockImplementation((path: string) => Promise.resolve(Response.json(path.endsWith('/csrf') ? { token: 'csrf' } : { type: 'urn:singverse:auth:session-required', detail: '请先登录' }, { status: path.endsWith('/csrf') ? 200 : 401 }))))
  await expect(authRequest('/api/v1/auth/password', 'POST', { password: 'old', newPassword: 'long new password' })).rejects.toThrow('请先登录')
  expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'singverse:session-expired' }))
  notify.mockRestore()
})

it('规则错误的定位字段通过 HTTP 客户端保留', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ detail: '表达式无效', ruleId: 'bad', ruleIndex: 2, field: 'expression' }, { status: 400 })))
  try {
    await authRequest('/api/v1/filename-parser/rules')
    throw new Error('预期接口返回参数错误')
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).details).toMatchObject({ ruleId: 'bad', ruleIndex: 2, field: 'expression' })
  }
})

it('调用方已取消的请求不读取 CSRF，也不发送业务请求', async () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const controller = new AbortController(); controller.abort()
  await expect(authRequest('/api/v1/metadata/songs/song/search', 'POST', {}, 30000, controller.signal)).rejects.toThrow()
  expect(fetcher).not.toHaveBeenCalled()
})

it('CSRF 等待期间取消后，即使 CSRF 迟到也不会发送搜索', async () => {
  let finish!: (response: Response) => void
  const fetcher = vi.fn().mockImplementation(() => new Promise<Response>(resolve => { finish = resolve }))
  vi.stubGlobal('fetch', fetcher)
  const controller = new AbortController()
  const pending = authRequest('/api/v1/metadata/songs/song/search', 'POST', {}, 30000, controller.signal)
  controller.abort(); finish(Response.json({ token: 'csrf' }))
  await expect(pending).rejects.toThrow()
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect((fetcher.mock.calls[0]![1] as RequestInit).signal?.aborted).toBe(true)
})

it('取消信号传给正在执行的搜索，同时保留客户端超时限制', async () => {
  let requestSignal: AbortSignal | undefined
  const fetcher = vi.fn().mockImplementation((path: string, options: RequestInit) => {
    if (path.endsWith('/csrf')) return Promise.resolve(Response.json({ token: 'csrf' }))
    requestSignal = options.signal as AbortSignal
    return new Promise<Response>((_resolve, reject) => requestSignal!.addEventListener('abort', () => reject(new DOMException('已取消', 'AbortError')), { once: true }))
  })
  vi.stubGlobal('fetch', fetcher)
  const controller = new AbortController()
  const pending = authRequest('/api/v1/metadata/songs/song/search', 'POST', {}, 30000, controller.signal)
  await flushPromises()
  expect(requestSignal?.aborted).toBe(false)
  controller.abort()
  await expect(pending).rejects.toThrow()
  expect(requestSignal?.aborted).toBe(true)
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it('调用方未取消时，搜索仍受客户端超时限制', async () => {
  let requestSignal: AbortSignal | undefined
  vi.stubGlobal('fetch', vi.fn().mockImplementation((path: string, options: RequestInit) => {
    if (path.endsWith('/csrf')) return Promise.resolve(Response.json({ token: 'csrf' }))
    requestSignal = options.signal as AbortSignal
    return new Promise<Response>((_resolve, reject) => requestSignal!.addEventListener('abort', () => reject(new Error('超时')), { once: true }))
  }))
  const controller = new AbortController()
  await expect(authRequest('/api/v1/metadata/songs/song/search', 'POST', {}, 20, controller.signal)).rejects.toThrow()
  expect(requestSignal?.aborted).toBe(true)
  expect(controller.signal.aborted).toBe(false)
})
