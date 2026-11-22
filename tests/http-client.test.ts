import { afterEach, describe, expect, it, vi } from 'vitest'
import { getJson } from '../src/admin/shared/http/client'

const releasePath = '/api/v1/client-releases/mobile'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function respond(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue(Response.json(body, { status }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('同源 JSON 请求', () => {
  it('读取 JSON 并使用同源凭据', async () => {
    const body = { available: false }
    const fetchMock = respond(body)
    await expect(getJson(releasePath)).resolves.toEqual(body)
    expect(fetchMock).toHaveBeenCalledWith(
      releasePath,
      expect.objectContaining({
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
      }),
    )
  })

  it('保留失败 HTTP 状态，不将 503 当作成功', async () => {
    respond({ detail: '服务暂时不可用' }, 503)
    await expect(getJson(releasePath)).rejects.toMatchObject({ kind: 'http', status: 503 })
  })

  it('拒绝代理返回的 HTML 登录页', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html>Login</html>', {
          headers: { 'Content-Type': 'text/html' },
        }),
      ),
    )
    await expect(getJson(releasePath)).rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it('拒绝标记为 JSON 的损坏响应', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{', {
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    await expect(getJson(releasePath)).rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it('报告断网，并且下一次调用可恢复', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(Response.json({ available: false }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(getJson(releasePath)).rejects.toMatchObject({ kind: 'network' })
    await expect(getJson(releasePath)).resolves.toEqual({ available: false })
  })

  it('超时会取消请求并清理计时器', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_path, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            )
          }),
      ),
    )
    const result = expect(getJson(releasePath, 20)).rejects.toMatchObject({
      kind: 'timeout',
    })
    await vi.advanceTimersByTimeAsync(20)
    await result
    expect(vi.getTimerCount()).toBe(0)
  })

  it('不允许通过 API 客户端请求其他服务器', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(getJson(`//other.example${releasePath}`)).rejects.toThrow('同源')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('不允许遗漏 /api 前缀', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(getJson('/client-releases/mobile')).rejects.toThrow('/api')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
