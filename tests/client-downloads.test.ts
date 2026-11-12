// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ClientDownloads from '../src/downloads/ClientDownloads.vue'
import { getJson } from '../src/admin/shared/http/client'
import { readRelease, reachableOrigin } from '../src/downloads/api'
vi.mock('../src/admin/shared/http/client', () => ({ getJson: vi.fn() }))
function release(platform = 'mobile') { return { available: true, versionCode: 1000, versionName: '0.1.0', packageName: `com.mynora.singverse.${platform}`, minSdk: platform === 'tv' ? 23 : 24, abis: ['arm64-v8a'], size: 1024, sha256: 'a'.repeat(64), certificateSha256: 'b'.repeat(64), url: `/api/v1/client-releases/${platform}/apk` } }
beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { vi.restoreAllMocks() })
it('仅接受同源固定下载地址与完整的包信息', async () => {
  vi.mocked(getJson).mockResolvedValue(release())
  expect((await readRelease('mobile')).versionCode).toBe(1000)
  vi.mocked(getJson).mockResolvedValue({ ...release(), url: 'https://outside.example/app.apk' })
  await expect(readRelease('mobile')).rejects.toThrow('下载地址无效')
  vi.mocked(getJson).mockResolvedValue({ ...release(), sha256: 'bad' })
  await expect(readRelease('mobile')).rejects.toThrow('信息不完整')
  vi.mocked(getJson).mockResolvedValue({ available: false })
  expect(await readRelease('tv')).toEqual({ available: false })
})
it('回环地址不生成跨设备二维码，局域网域名和IP可以分享', () => {
  for (const origin of ['http://localhost:8080', 'http://127.0.0.2', 'http://[::1]', 'http://a.localhost']) expect(reachableOrigin(origin)).toBe(false)
  expect(reachableOrigin('http://192.168.1.9:18080')).toBe(true)
  expect(reachableOrigin('https://nas.local')).toBe(true)
})
it('两端独立展示，缺包保持真实空态并允许失败后重试', async () => {
  vi.mocked(getJson).mockImplementation(async path => {
    if (path.endsWith('/mobile')) return release()
    throw new Error('NAS unavailable')
  })
  const wrapper = mount(ClientDownloads)
  await flushPromises()
  expect(wrapper.find('a[href="/api/v1/client-releases/mobile/apk"]').exists()).toBe(true)
  expect(wrapper.find('a[href="/api/v1/client-releases/tv/apk"]').exists()).toBe(false)
  expect(wrapper.text()).toContain('NAS unavailable')
  vi.mocked(getJson).mockResolvedValue({ available: false })
  const retry = wrapper.findAll('button').find(button => button.text().includes('重新读取'))
  await retry!.trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('尚未提供电视端安装包')
  wrapper.unmount()
})
