// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import PartyApp from '../src/party/PartyApp.vue'
import { PartyHttpError, request, type Snapshot, type Song } from '../src/party/api'
vi.mock('../src/party/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/party/api')>()
  return { ...actual, request: vi.fn(), requestId: vi.fn(() => crypto.randomUUID()) }
})
let wrapper: VueWrapper | undefined, snapshot: Snapshot
const song: Song = { id: 'song', title: '晴天', artists: ['周杰伦'] }
function fresh(): Snapshot { return { id: 'party', revision: 1, stateRevision: 1, actorId: 'guest', host: false, status: 'ACTIVE', acceptingRequests: true, queuePolicy: 'FAIR', tvOnline: true, capabilities: ['AUTO_ADVANCE', 'SEEK', 'AUDIO_ROLE', 'APPLY_AUDIO_ROLES', 'REACTIONS'], playback: { attemptId: 'a', itemId: 'current', songId: 'singing', state: 'PLAYING', positionMs: 1000, durationMs: 200000, audioRole: 'backing' }, queue: [{ id: 'current', songId: 'singing', ownerId: 'other', ownerName: '家人', status: 'PLAYING', song: { ...song, id: 'singing' } }] } }
function credentials() { sessionStorage.setItem('singverse-party', JSON.stringify({ token: 'token', sessionId: 'party', name: '亲友' })) }
beforeEach(() => {
  vi.useFakeTimers(); sessionStorage.clear(); localStorage.clear(); history.replaceState(null, '', '/party/'); snapshot = fresh()
  vi.stubGlobal('scrollTo', vi.fn()); vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0))
  vi.mocked(request).mockReset(); vi.mocked(request).mockImplementation(async (path: string, _method, body) => {
    if (path.includes('snapshot')) return structuredClone(snapshot)
    if (path === 'favorites/ids') return { songIds: [], revision: 1 }
    if (path.includes('classification-tags')) return [{ id: 'tag', name: '国语', dimension: 'LANGUAGE', count: 1 }]
    if (path.includes('/commands')) {
      const command = body as { action: string; requestId: string }
      if (command.action === 'ADD') snapshot.queue.push({ id: 'added', songId: song.id, song, ownerId: 'guest', ownerName: '亲友', status: 'WAITING', sequence: 2 })
      snapshot.revision++; snapshot.stateRevision = (snapshot.stateRevision ?? 0) + 1
      return structuredClone(snapshot)
    }
    if (path.includes('library/artists')) return { items: [{ id: 'artist', name: '周杰伦', count: 1 }], totalElements: 1 }
    return { items: [song], totalElements: 1 }
  })
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined; document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
async function start() { wrapper = mount(PartyApp, { attachTo: document.body }); await flushPromises(); return wrapper }
async function click(text: string, scope = wrapper!) { const b = scope.findAll('button').find(b => b.text() === text); expect(b, text).toBeDefined(); await b!.trigger('click'); await flushPromises() }
async function nativeClick(text: string) { const b = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === text); expect(b, text).toBeDefined(); b!.click(); await flushPromises() }
async function leave() { await wrapper!.get('.menu-button').trigger('click'); await flushPromises(); await nativeClick('离开本场') }
it('二维码只预览，明确确认后创建独立身份', async () => {
  history.replaceState(null, '', '/party/#invite=invitation')
  const original = vi.mocked(request).getMockImplementation()!
  vi.mocked(request).mockImplementation(async (...args) => args[0] === 'invitations/preview' ? { sessionId: 'party', deviceName: '客厅电视' } : args[0] === 'join' ? { token: 'participant-token', sessionId: 'party', name: '亲友' } : original(...args))
  await start(); expect(vi.mocked(request).mock.calls.some(c => c[0] === 'join')).toBe(false)
  await wrapper!.get('input[autocomplete="nickname"]').setValue('亲友'); await wrapper!.get('form').trigger('submit'); await flushPromises()
  expect(request).toHaveBeenCalledWith('join', 'POST', { invitation: 'invitation', name: '亲友' }, undefined, expect.any(AbortSignal))
  expect(location.hash).toBe(''); expect(sessionStorage.getItem('singverse-party')).toContain('participant-token')
  expect(localStorage.getItem('singverse-party:nickname:v1')).toBe('亲友')
})
it('重新打开或扫描另一场时记住昵称，仍可修改后确认加入', async () => {
  history.replaceState(null, '', '/party/#invite=first-invitation')
  const original = vi.mocked(request).getMockImplementation()!
  vi.mocked(request).mockImplementation(async (...args) => args[0] === 'invitations/preview'
    ? { sessionId: 'party', deviceName: '客厅电视' }
    : args[0] === 'join' ? { token: 'participant-token', sessionId: 'party', name: (args[2] as { name: string }).name }
      : original(...args))
  await start()
  await wrapper!.get('input[autocomplete="nickname"]').setValue('  小明  ')
  await wrapper!.get('form').trigger('submit'); await flushPromises()
  expect(localStorage.getItem('singverse-party:nickname:v1')).toBe('小明')
  wrapper!.unmount(); wrapper = undefined; sessionStorage.clear()
  history.replaceState(null, '', '/party/#invite=second-invitation')
  const joined = vi.mocked(request).mock.calls.filter(c => c[0] === 'join').length
  await start()
  expect((wrapper!.get('input[autocomplete="nickname"]').element as HTMLInputElement).value).toBe('小明')
  expect(vi.mocked(request).mock.calls.filter(c => c[0] === 'join')).toHaveLength(joined)
  await wrapper!.get('input[autocomplete="nickname"]').setValue('家人')
  await wrapper!.get('form').trigger('submit'); await flushPromises()
  expect(localStorage.getItem('singverse-party:nickname:v1')).toBe('家人')
  expect(localStorage.length).toBe(1)
  expect(localStorage.getItem('singverse-party:nickname:v1')).not.toContain('participant-token')
})
it('已有参与身份会补存昵称，离开本场仍保留昵称', async () => {
  credentials(); await start(); await leave()
  expect(sessionStorage.getItem('singverse-party')).toBeNull()
  expect(localStorage.getItem('singverse-party:nickname:v1')).toBe('亲友')
  wrapper!.unmount(); wrapper = undefined
  history.replaceState(null, '', '/party/#invite=next-invitation')
  vi.mocked(request).mockResolvedValue({ sessionId: 'next-party', deviceName: '另一台电视' })
  await start()
  expect((wrapper!.get('input[autocomplete="nickname"]').element as HTMLInputElement).value).toBe('亲友')
})
it('加入失败不覆盖上次成功使用的昵称', async () => {
  localStorage.setItem('singverse-party:nickname:v1', '小明')
  history.replaceState(null, '', '/party/#invite=invitation')
  vi.mocked(request).mockImplementation(async path => {
    if (path === 'join') throw new PartyHttpError(400, '邀请已过期')
    return { sessionId: 'party', deviceName: '客厅电视' }
  })
  await start(); await wrapper!.get('input[autocomplete="nickname"]').setValue('另一个昵称')
  await wrapper!.get('form').trigger('submit'); await flushPromises()
  expect(localStorage.getItem('singverse-party:nickname:v1')).toBe('小明')
  expect(sessionStorage.getItem('singverse-party')).toBeNull()
  expect(wrapper!.text()).toContain('邀请已过期')
})
it('昵称持久存储不可用时仍可正常加入', async () => {
  const get = Storage.prototype.getItem, set = Storage.prototype.setItem
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
    if (key === 'singverse-party:nickname:v1') throw new Error('Storage unavailable')
    return get.call(this, key)
  })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key === 'singverse-party:nickname:v1') throw new Error('Storage unavailable')
    set.call(this, key, value)
  })
  history.replaceState(null, '', '/party/#invite=invitation')
  const original = vi.mocked(request).getMockImplementation()!
  vi.mocked(request).mockImplementation(async (...args) => args[0] === 'invitations/preview'
    ? { sessionId: 'party', deviceName: '客厅电视' }
    : args[0] === 'join' ? { token: 'participant-token', sessionId: 'party', name: '亲友' } : original(...args))
  await start(); await wrapper!.get('input[autocomplete="nickname"]').setValue('亲友')
  await wrapper!.get('form').trigger('submit'); await flushPromises()
  expect(wrapper!.find('.layout').exists()).toBe(true)
  expect(sessionStorage.getItem('singverse-party')).toContain('participant-token')
})
it.each(['   ', '长'.repeat(31)])('无效的缓存昵称不影响重新填写（%s）', async value => {
  localStorage.setItem('singverse-party:nickname:v1', value)
  history.replaceState(null, '', '/party/#invite=invitation')
  vi.mocked(request).mockResolvedValue({ sessionId: 'party', deviceName: '客厅电视' })
  await start()
  expect((wrapper!.get('input[autocomplete="nickname"]').element as HTMLInputElement).value).toBe('')
})
it('五种入口直接可见，歌手、最近、热门和共享收藏读取真实接口', async () => {
  credentials(); await start()
  expect(wrapper!.findAll('.finder button').map(b => b.text())).toEqual(['分类', '歌手', '最近', '热门', '家庭收藏'])
  for (const [label, path] of [['歌手', 'library/artists'], ['最近', 'library/recent'], ['热门', 'library/popular'], ['家庭收藏', 'favorites?']]) {
    await click(label!); expect(vi.mocked(request).mock.calls.some(c => c[0].includes(path!))).toBe(true)
  }
  await click('热门'); await click('近 7 天'); await vi.advanceTimersByTimeAsync(200); await flushPromises()
  expect(vi.mocked(request).mock.calls.some(c => c[0].includes('popular?') && c[0].includes('period=7d'))).toBe(true)
})
it('暂停接单禁用点歌，普通亲友仍可遥控', async () => {
  credentials(); snapshot.acceptingRequests = false; await start()
  expect(wrapper!.get('.add-song').attributes('disabled')).toBeDefined()
  await wrapper!.get('.bottom-nav button:last-child').trigger('click'); await flushPromises()
  const pause = wrapper!.findAll('.stage button').find(b => b.text() === '暂停')!
  expect(pause.attributes('disabled')).toBeUndefined(); await pause.trigger('click'); await flushPromises()
  expect(vi.mocked(request).mock.calls.find(c => c[0].includes('commands'))?.[2]).toMatchObject({ action: 'PAUSE', attemptId: 'a' })
})
it('点歌成功留在曲库并显示自己的排队位置', async () => {
  credentials(); await start(); await wrapper!.get('.add-song').trigger('click'); await flushPromises()
  expect(wrapper!.get('.song-placement').text()).toContain('排第 1 位')
  expect(wrapper!.get('.library').isVisible()).toBe(true)
})
it('歌手页往返后继续搜索，不吞掉第一次输入', async () => {
  credentials(); await start(); await click('歌手')
  await wrapper!.get('.artist-item').trigger('click'); await flushPromises()
  const input = wrapper!.get('input[type="search"]')
  await input.setValue('夜曲'); await vi.advanceTimersByTimeAsync(200); await flushPromises()
  expect(vi.mocked(request).mock.calls.some(c => c[0].includes('library/artists/artist/songs?') && c[0].includes('q=%E5%A4%9C%E6%9B%B2'))).toBe(true)
  await wrapper!.get('.artist-back').trigger('click'); await flushPromises()
  await input.setValue('陈奕迅'); await vi.advanceTimersByTimeAsync(200); await flushPromises()
  expect(vi.mocked(request).mock.calls.some(c => c[0].includes('library/artists?') && c[0].includes('q=%E9%99%88%E5%A5%95%E8%BF%85'))).toBe(true)
})
it('未知结果沿用同一请求 ID 重试，不再次点歌', async () => {
  credentials(); await start(); const original = vi.mocked(request).getMockImplementation()!
  vi.mocked(request).mockImplementation(async (...args) => { if (args[0].includes('commands')) throw new Error('连接中断'); return original(...args) })
  await wrapper!.get('.add-song').trigger('click'); await flushPromises()
  const first = vi.mocked(request).mock.calls.find(c => c[0].includes('commands'))!
  await click('重试原请求')
  const commands = vi.mocked(request).mock.calls.filter(c => c[0].includes('commands'))
  expect(commands).toHaveLength(2); expect(commands[1]![2]).toEqual(first[2])
})
it('收藏失败保留服务端原状态，不写入浏览器收藏副本', async () => {
  credentials(); await start(); const original = vi.mocked(request).getMockImplementation()!
  vi.mocked(request).mockImplementation(async (...args) => { if (args[0] === 'favorites') throw new Error('保存失败'); return original(...args) })
  await wrapper!.get('.song-row .favorite').trigger('click'); await flushPromises()
  expect(wrapper!.get('.song-row .favorite').attributes('aria-pressed')).toBe('false')
  expect(request).toHaveBeenCalledWith('favorites', 'PUT', { songIds: ['song'], selected: true }, 'token', expect.any(AbortSignal))
  expect(localStorage.length).toBe(1)
  expect(localStorage.getItem('singverse-party:nickname:v1')).toBe('亲友')
})
it('退出只清理参与身份，迟到轮询不能恢复旧聚会', async () => {
  credentials(); await start(); let resolve!: (value: unknown) => void
  const original = vi.mocked(request).getMockImplementation()!
  vi.mocked(request).mockImplementation((...args) => args[0].includes('snapshot') ? new Promise(done => { resolve = done }) : original(...args))
  await vi.advanceTimersByTimeAsync(1000)
  const signal = vi.mocked(request).mock.calls.at(-1)![4]!
  await leave(); expect(signal.aborted).toBe(true); resolve(snapshot); await flushPromises()
  expect(wrapper!.find('.layout').exists()).toBe(false); expect(sessionStorage.getItem('singverse-party')).toBeNull()
  expect(vi.mocked(request).mock.calls.some(c => c[0].includes('commands'))).toBe(false)
})
it('旧快照不能回退已确认队列', async () => {
  credentials(); await start(); let resolve!: (value: unknown) => void
  const old = structuredClone(snapshot), original = vi.mocked(request).getMockImplementation()!
  vi.mocked(request).mockImplementation((...args) => args[0].includes('snapshot') ? new Promise(done => { resolve = done }) : original(...args))
  await vi.advanceTimersByTimeAsync(1000); await wrapper!.get('.add-song').trigger('click'); await flushPromises(); resolve(old); await flushPromises()
  expect(wrapper!.get('.song-placement').text()).toContain('排第 1 位')
})
it('新操作成功后，旧轮询的 401 不清除当前身份', async () => {
  credentials(); await start(); let reject!: (reason: Error) => void
  const original = vi.mocked(request).getMockImplementation()!
  vi.mocked(request).mockImplementation((...args) => args[0].includes('snapshot') ? new Promise((_done, fail) => { reject = fail }) : original(...args))
  await vi.advanceTimersByTimeAsync(1000); await wrapper!.get('.add-song').trigger('click'); await flushPromises(); reject(new PartyHttpError(401, '旧响应')); await flushPromises()
  expect(wrapper!.find('.layout').exists()).toBe(true); expect(sessionStorage.getItem('singverse-party')).toContain('token')
})
it('确认期间自然切换的歌曲不会被迟到的切歌操作影响', async () => {
  credentials(); await start(); await wrapper!.get('.bottom-nav button:last-child').trigger('click'); await flushPromises(); await click('切歌')
  snapshot.playback!.attemptId = 'next-attempt'; snapshot.stateRevision = 3; await vi.advanceTimersByTimeAsync(1000); await flushPromises()
  await nativeClick('确认切歌')
  expect(vi.mocked(request).mock.calls.find(c => c[0].includes('commands'))?.[2]).toMatchObject({ action: 'NEXT', attemptId: 'a' })
})
it('旧 TV 能力不足时提示升级并禁用新增遥控', async () => {
  credentials(); snapshot.queuePolicy = 'LEGACY'; snapshot.capabilities = []; await start()
  expect(wrapper!.text()).toContain('更新 TV 版本')
  await wrapper!.get('.bottom-nav button:last-child').trigger('click'); await flushPromises()
  expect(wrapper!.get('.stage .seek-range').attributes('disabled')).toBeDefined()
})
it('切换邀请清除旧身份，不轮询上一场', async () => {
  history.replaceState(null, '', '/party/#invite=new-invitation'); credentials()
  vi.mocked(request).mockResolvedValue({ sessionId: 'new-party', deviceName: '新电视' })
  await start(); expect(wrapper!.text()).toContain('新电视'); expect(sessionStorage.getItem('singverse-party')).toBeNull()
  expect(vi.mocked(request).mock.calls.some(([path]) => path.includes('snapshot'))).toBe(false)
})
