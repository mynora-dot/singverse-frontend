// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError, authRequest } from '../src/admin/core/auth/api'
import PartyApp from '../src/party/PartyApp.vue'
import { PartyHttpError, request, type Snapshot, type Song } from '../src/party/api'
vi.mock('../src/party/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/party/api')>()
  return { ...actual, request: vi.fn(), requestId: vi.fn(() => crypto.randomUUID()) }
})
vi.mock('../src/admin/core/auth/api', async importOriginal => ({
  ...await importOriginal<typeof import('../src/admin/core/auth/api')>(), authRequest: vi.fn(),
}))
let wrapper: VueWrapper | undefined, snapshot: Snapshot
const song: Song = { id: 'song', title: '晴天', artists: ['周杰伦'] }
function fresh(): Snapshot { return { id: 'party', revision: 1, stateRevision: 1, actorId: 'guest', host: false, status: 'ACTIVE', acceptingRequests: true, queuePolicy: 'FAIR', tvOnline: true, capabilities: ['AUTO_ADVANCE', 'SEEK', 'AUDIO_ROLE', 'APPLY_AUDIO_ROLES', 'REACTIONS'], playback: { attemptId: 'a', itemId: 'current', songId: 'singing', state: 'PLAYING', positionMs: 1000, durationMs: 200000, audioRole: 'backing' }, queue: [{ id: 'current', songId: 'singing', ownerId: 'other', ownerName: '家人', status: 'PLAYING', song: { ...song, id: 'singing' } }] } }
function credentials() { sessionStorage.setItem('singverse-party', JSON.stringify({ token: 'token', sessionId: 'party', name: '亲友' })) }
beforeEach(() => {
  vi.useFakeTimers(); sessionStorage.clear(); localStorage.clear(); history.replaceState(null, '', '/party/'); snapshot = fresh()
  vi.stubGlobal('scrollTo', vi.fn()); vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0))
  vi.mocked(authRequest).mockReset(); vi.mocked(authRequest).mockRejectedValue(new ApiError(401, '请先登录'))
  vi.mocked(request).mockReset(); vi.mocked(request).mockImplementation(async (path: string, _method, body) => {
    if (path.includes('snapshot')) return structuredClone(snapshot)
    if (path === 'favorites/ids') return { songIds: [], revision: 1 }
    if (path.includes('classification-tags')) return [{ id: 'tag', name: '国语', dimension: 'LANGUAGE', count: 1 }]
    if (path.includes('/commands')) {
      const command = body as { action: string; requestId: string }
      if (command.action === 'ADD') snapshot.queue.push({ id: `added-${snapshot.revision}`, songId: song.id, song, ownerId: 'guest', ownerName: '亲友', status: 'WAITING', sequence: snapshot.queue.length + 1 })
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
it('管理员选电视后使用手机布局，点歌只发给所选场次并可切换', async () => {
  const endpoint = '/api/v1/admin/party/televisions'
  const televisions = [
    { deviceId: 'living-tv', sessionId: 'party', deviceName: '客厅电视', acceptingRequests: true },
    { deviceId: 'study-tv', sessionId: 'study-party', deviceName: '书房电视', acceptingRequests: true },
  ]
  vi.mocked(authRequest).mockImplementation(async path => {
    if (path === endpoint) return { items: televisions } as never
    const television = televisions.find(tv => path === `${endpoint}/${tv.deviceId}/join`)!
    snapshot = { ...fresh(), id: television.sessionId }
    return { token: television.deviceId + '-guest', sessionId: television.sessionId, deviceName: television.deviceName, name: '网页点歌' } as never
  })
  await start()
  expect(wrapper!.get('h1').text()).toBe('选择电视')
  expect(wrapper!.findAll('li button').map(item => item.text())).toEqual(['客厅电视', '书房电视'])
  await click('书房电视')
  expect(authRequest).toHaveBeenCalledWith(`${endpoint}/study-tv/join`, 'POST', { sessionId: 'study-party', name: '网页点歌' }, 10000, expect.any(AbortSignal))
  const preview = wrapper!.get<HTMLElement>('.phone-screen')
  const ratio = wrapper!.get<HTMLSelectElement>('.phone-controls select')
  expect(ratio.element.selectedOptions[0]?.text).toBe('iQOO Z9 Turbo+ · 20:9')
  expect(parseFloat(preview.element.style.height) / parseFloat(preview.element.style.width)).toBeCloseTo(20 / 9)
  expect(wrapper!.get('.bottom-nav').text()).toContain('现场')
  expect(wrapper!.get('.header-room').text()).toBe('书房电视')
  await ratio.setValue('16-9')
  expect(parseFloat(preview.element.style.height) / parseFloat(preview.element.style.width)).toBeCloseTo(16 / 9)
  expect(vi.mocked(authRequest).mock.calls.filter(([path]) => path.endsWith('/join'))).toHaveLength(1)
  await wrapper!.get('.now-open').trigger('click')
  expect(wrapper!.get('.phone-screen [role="dialog"]').text()).toContain('电视遥控')
  expect(wrapper!.get<HTMLElement>('.party-scroll').element.style.overflow).toBe('hidden')
  await wrapper!.get('[role="dialog"] button[aria-label="关闭"]').trigger('click')
  expect(wrapper!.get<HTMLElement>('.party-scroll').element.style.overflow).toBe('')
  await wrapper!.get('.add-song').trigger('click'); await flushPromises()
  expect(request).toHaveBeenCalledWith('sessions/study-party/commands', 'POST', expect.objectContaining({ action: 'ADD' }), 'study-tv-guest', expect.any(AbortSignal))
  await wrapper!.get('button[aria-label="切换电视，当前书房电视"]').trigger('click'); await flushPromises()
  expect(wrapper!.find('.phone-screen').exists()).toBe(false)
  expect(sessionStorage.getItem('singverse-party')).toBeNull()
  await click('客厅电视')
  expect(wrapper!.get('.header-room').text()).toBe('客厅电视')
  expect(wrapper!.get<HTMLSelectElement>('.phone-controls select').element.value).toBe('16-9')
  expect(localStorage.getItem('singverse-party:nickname:v1')).toBeNull()
})
it('应用有效的自定义手机比例并在刷新后恢复', async () => {
  sessionStorage.setItem('singverse-party', JSON.stringify({ token: 'token', sessionId: 'party', name: '网页点歌', deviceName: '书房电视' }))
  await start()
  const aspect = () => {
    const { style } = wrapper!.get<HTMLElement>('.phone-screen').element
    return parseFloat(style.height) / parseFloat(style.width)
  }
  await wrapper!.get('.phone-controls select').setValue('custom')
  await wrapper!.get('.phone-ratio input[name="width"]').setValue('0')
  await wrapper!.get('.phone-ratio').trigger('submit')
  expect(wrapper!.get('.phone-ratio-error').text()).toContain('1:3 到 3:1')
  expect(aspect()).toBeCloseTo(20 / 9)
  await wrapper!.get('.phone-ratio input[name="width"]').setValue('9')
  await wrapper!.get('.phone-ratio input[name="height"]').setValue('17.5')
  await wrapper!.get('.phone-ratio').trigger('submit')
  expect(wrapper!.find('.phone-ratio-error').exists()).toBe(false)
  expect(aspect()).toBeCloseTo(17.5 / 9)
  wrapper!.unmount(); wrapper = undefined
  await start()
  expect(wrapper!.get<HTMLSelectElement>('.phone-controls select').element.value).toBe('custom')
  expect(aspect()).toBeCloseTo(17.5 / 9)
  expect(authRequest).not.toHaveBeenCalled()
})
it('电视选中时已经离线，保留错误并刷新列表', async () => {
  const endpoint = '/api/v1/admin/party/televisions'
  vi.mocked(authRequest).mockResolvedValueOnce({ items: [{ deviceId: 'tv', sessionId: 'party', deviceName: '客厅电视', acceptingRequests: true }] })
    .mockRejectedValueOnce(new ApiError(409, '电视已离线或聚会已结束，请重新选择'))
    .mockResolvedValueOnce({ items: [] })
  await start(); await click('客厅电视')
  expect(authRequest).toHaveBeenLastCalledWith(endpoint, 'GET', undefined, 10000, expect.any(AbortSignal))
  expect(wrapper!.text()).toContain('电视已离线或聚会已结束，请重新选择')
  expect(wrapper!.text()).toContain('暂无正在运行的电视')
  expect(sessionStorage.getItem('singverse-party')).toBeNull()
})
it('访客打开点歌主页时引导扫码', async () => {
  await start()
  expect(wrapper!.text()).toContain('扫描电视上的二维码加入点歌')
  expect(wrapper!.find('.television-list').exists()).toBe(false)
})
it('二维码只预览，明确确认后创建独立身份', async () => {
  history.replaceState(null, '', '/party/#invite=invitation')
  const original = vi.mocked(request).getMockImplementation()!
  vi.mocked(request).mockImplementation(async (...args) => args[0] === 'invitations/preview' ? { sessionId: 'party', deviceName: '客厅电视' } : args[0] === 'join' ? { token: 'participant-token', sessionId: 'party', name: '亲友' } : original(...args))
  await start(); expect(vi.mocked(request).mock.calls.some(c => c[0] === 'join')).toBe(false)
  expect(authRequest).not.toHaveBeenCalled()
  await wrapper!.get('input[autocomplete="nickname"]').setValue('亲友'); await wrapper!.get('form').trigger('submit'); await flushPromises()
  expect(request).toHaveBeenCalledWith('join', 'POST', { invitation: 'invitation', name: '亲友' }, undefined, expect.any(AbortSignal))
  expect(wrapper!.find('.phone-controls').exists()).toBe(false)
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
  expect(wrapper!.find('.feedback').exists()).toBe(false)
})
it('互动发送成功不弹提示，发送失败时显示原因', async () => {
  credentials(); await start(); await click('现场')
  for (const [label, kind] of [['点赞', 'LIKE'], ['鼓掌', 'CLAP'], ['喝彩', 'CHEER']] as const) {
    await click(label)
    expect(request).toHaveBeenCalledWith('sessions/party/reactions', 'POST', expect.objectContaining({ kind }), 'token', expect.any(AbortSignal))
    expect(wrapper!.find('.feedback').exists()).toBe(false)
  }
  await wrapper!.get('.bottom-nav button:first-child').trigger('click')
  expect(wrapper!.find('.feedback').exists()).toBe(false)
  await click('现场')
  const original = vi.mocked(request).getMockImplementation()!
  vi.mocked(request).mockImplementation(async (...args) => {
    if (args[0].endsWith('/reactions')) throw new PartyHttpError(429, '互动太快，请稍后再试')
    return original(...args)
  })
  await click('鼓掌')
  expect(wrapper!.get('.feedback').text()).toContain('互动太快，请稍后再试')
})
it('播放控制更新播放状态，发送和执行成功均无浮层', async () => {
  credentials()
  const original = vi.mocked(request).getMockImplementation()!
  vi.mocked(request).mockImplementation(async (...args) => {
    if (!args[0].endsWith('/commands')) return original(...args)
    const { requestId } = args[2] as { requestId: string }
    snapshot.stateRevision = 2
    snapshot.commandResults = [{ id: 'pause', requestId, action: 'PAUSE', attemptId: 'a', status: 'SENT' }]
    return structuredClone(snapshot)
  })
  await start(); await wrapper!.get('.now-open').trigger('click')
  const remote = wrapper!.get('[role="dialog"]')
  await remote.get('.primary-control').trigger('click'); await flushPromises()
  expect(request).toHaveBeenCalledWith('sessions/party/commands', 'POST', expect.objectContaining({ action: 'PAUSE' }), 'token', expect.any(AbortSignal))
  expect(wrapper!.find('.feedback').exists()).toBe(false)
  snapshot.playback!.state = 'PAUSED'; snapshot.commandResults![0]!.status = 'EXECUTED'; snapshot.stateRevision = 3
  await vi.advanceTimersByTimeAsync(1000); await flushPromises()
  expect(remote.get('.tv-status').text()).toBe('已暂停')
  expect(wrapper!.find('.feedback').exists()).toBe(false)
})
it('离线现场显示所选电视、上次进度和待唱队列，重新上线后恢复遥控', async () => {
  sessionStorage.setItem('singverse-party', JSON.stringify({ token: 'token', sessionId: 'party', name: '亲友', deviceName: '书房电视' }))
  snapshot.tvOnline = false
  snapshot.playback!.positionMs = 130000
  for (const id of ['一', '二', '三', '四']) {
    snapshot.queue.push({ id, songId: id, status: 'WAITING', ownerId: 'guest', ownerName: '亲友', song: { ...song, id, title: id } })
  }
  await start(); await wrapper!.get('.bottom-nav button:last-child').trigger('click')
  const stage = wrapper!.get('.stage')
  expect(wrapper!.get('.header-room').text()).toBe('书房电视')
  expect(stage.get('.tv-status').text()).toBe('电视离线')
  expect(wrapper!.find('.mobile-tvbar').exists()).toBe(false)
  expect(wrapper!.find('.side-section').exists()).toBe(false)
  expect(stage.find('.remote-main-controls').exists()).toBe(false)
  expect(stage.find('.reaction-row').exists()).toBe(false)
  expect(stage.find('.segmented').exists()).toBe(false)
  expect(stage.get('.seek-range').attributes('disabled')).toBeDefined()
  await vi.advanceTimersByTimeAsync(2000)
  expect(stage.get('.player-timeline').text()).toContain('上次进度2:10')
  expect(wrapper!.findAll('.next-row .song-title').map(row => row.text())).toEqual(['一', '二', '三'])
  await stage.get('.correct-role').trigger('click')
  expect(wrapper!.get('[role="dialog"] h2').text()).toBe('纠正原唱 / 伴奏')
  await wrapper!.get('[role="dialog"] [aria-label="关闭"]').trigger('click')

  snapshot.tvOnline = true; snapshot.playback!.state = 'PAUSED'; snapshot.stateRevision = 2
  await vi.advanceTimersByTimeAsync(1000); await flushPromises()
  expect(stage.get('.tv-status').text()).toBe('已暂停')
  expect(stage.get('.primary-control').text()).toBe('继续')
  expect(stage.get('.reaction-row').findAll('button')).toHaveLength(3)
  expect(stage.get('.seek-range').attributes('disabled')).toBeUndefined()
  await wrapper!.get('.side-next .text-button').trigger('click')
  expect(wrapper!.findAll('.queue-row')).toHaveLength(4)
  expect(wrapper!.find('.mobile-tvbar').exists()).toBe(true)
})
it('现场切换音轨绑定当前播放，拖动中换歌会清除旧进度', async () => {
  credentials(); await start(); await wrapper!.get('.bottom-nav button:last-child').trigger('click')
  const stage = wrapper!.get('.stage')
  const roles = stage.get('.role-controls .segmented').findAll('button')
  expect(roles.map(button => button.attributes('aria-pressed'))).toEqual(['false', 'true'])
  await roles[0]!.trigger('click'); await flushPromises()
  expect(request).toHaveBeenCalledWith('sessions/party/commands', 'POST', expect.objectContaining({ action: 'AUDIO_ROLE', role: 'original', attemptId: 'a' }), 'token', expect.any(AbortSignal))
  const range = stage.get<HTMLInputElement>('.seek-range')
  range.element.value = '30000'; await range.trigger('input')
  expect(range.attributes('aria-valuetext')).toBe('0:30 / 3:20')
  snapshot.playback!.attemptId = 'next'; snapshot.playback!.positionMs = 0; snapshot.stateRevision = 3
  await vi.advanceTimersByTimeAsync(1000); await flushPromises()
  await range.trigger('change')
  expect(vi.mocked(request).mock.calls.filter(c => c[0].endsWith('/commands'))).toHaveLength(1)
  const nextRange = stage.get<HTMLInputElement>('.seek-range')
  nextRange.element.value = '40000'; await nextRange.trigger('input'); await nextRange.trigger('change'); await flushPromises()
  expect(request).toHaveBeenCalledWith('sessions/party/commands', 'POST', expect.objectContaining({ action: 'SEEK', positionMs: 40000, attemptId: 'next' }), 'token', expect.any(AbortSignal))
})
it('NAS 断线时现场停止推算进度，重新同步后恢复播放状态', async () => {
  credentials(); await start(); await wrapper!.get('.bottom-nav button:last-child').trigger('click')
  const stage = wrapper!.get('.stage'), original = vi.mocked(request).getMockImplementation()!
  vi.mocked(request).mockImplementation(async (...args) => {
    if (args[0].includes('/snapshot')) throw new Error('连接中断')
    return original(...args)
  })
  await vi.advanceTimersByTimeAsync(3000); await flushPromises()
  expect(stage.get('.tv-status').text()).toBe('正在重连')
  expect(stage.get('.player-timeline').text()).toContain('上次进度0:01')
  expect(stage.find('.primary-control').exists()).toBe(false)
  vi.mocked(request).mockImplementation(original)
  await vi.advanceTimersByTimeAsync(1000); await flushPromises()
  expect(stage.get('.tv-status').text()).toBe('正在唱')
  expect(stage.get('.primary-control').text()).toBe('暂停')
})
it('现场空队列可直接回曲库选歌', async () => {
  credentials(); snapshot.queue = []; delete snapshot.playback; await start()
  await wrapper!.get('.bottom-nav button:last-child').trigger('click')
  expect(wrapper!.get('.stage h2').text()).toBe('等待开唱')
  expect(wrapper!.get('.empty-queue').text()).toContain('还没有待唱歌曲')
  expect(wrapper!.find('.stage .seek-range').exists()).toBe(false)
  await wrapper!.get('.side-next .text-button').trigger('click')
  expect(wrapper!.get('.library').isVisible()).toBe(true)
  expect(wrapper!.find('.stage').exists()).toBe(false)
})
it('从搜索结果和详情点歌成功后继续选歌，队列收录每次点唱', async () => {
  credentials(); await start()
  const input = wrapper!.get<HTMLInputElement>('input[type="search"]')
  await input.setValue('晴天'); await vi.advanceTimersByTimeAsync(200)
  const row = wrapper!.get('.song-row'), before = row.text()
  await row.get('.add-song').trigger('click'); await flushPromises()
  expect(input.element.value).toBe('晴天')
  expect(wrapper!.get('.library').isVisible()).toBe(true)
  expect(row.text()).toBe(before)
  expect(row.get('.add-song').text()).toBe('点歌')
  expect(wrapper!.find('.feedback').exists()).toBe(false)
  expect(wrapper!.get('.bottom-nav .count').text()).toBe('1')

  await row.get('.song-open').trigger('click')
  const detail = wrapper!.get('[role="dialog"]'), detailText = detail.text()
  expect(detailText).not.toContain('我点的')
  await nativeClick('点这首歌')
  expect(detail.text()).toBe(detailText)
  expect(wrapper!.find('.feedback').exists()).toBe(false)
  await detail.get('[aria-label="关闭"]').trigger('click')
  await wrapper!.get('.bottom-nav button:nth-child(2)').trigger('click')
  expect(wrapper!.findAll('.queue-row .song-title').map(title => title.text())).toEqual(['晴天', '晴天'])
})
it.each([
  ['ADD', 'EXECUTED'], ['ADD', 'FAILED'], ['START', 'EXECUTED'], ['START', 'FAILED'],
] as const)('开唱时只显示失败回执（%s，%s）', async (action, status) => {
  credentials()
  const item = { id: 'first', songId: song.id, song, ownerId: 'guest', ownerName: '亲友' }
  snapshot.queue = action === 'START' ? [{ ...item, status: 'WAITING' }] : []
  delete snapshot.playback
  const original = vi.mocked(request).getMockImplementation()!
  vi.mocked(request).mockImplementation(async (...args) => {
    if (!args[0].endsWith('/commands')) return original(...args)
    const { requestId } = args[2] as { requestId: string }
    snapshot.queue = [{ ...item, status: 'HANDOFF' }]
    snapshot.playback = { itemId: 'first', songId: song.id, attemptId: 'a', positionMs: 0, state: 'PREPARING' }
    snapshot.commandResults = [{ id: 'load', requestId, action: 'LOAD', attemptId: 'a', status: 'SENT' }]
    snapshot.stateRevision = 2
    return structuredClone(snapshot)
  })
  await start()
  if (action === 'START') {
    await click('现场')
    const button = wrapper!.get('.stage .primary-control')
    expect(button.text()).toBe('开始')
    await button.trigger('click')
  } else {
    await wrapper!.get('.add-song').trigger('click')
  }
  await flushPromises()
  expect(request).toHaveBeenCalledWith('sessions/party/commands', 'POST', expect.objectContaining({ action }), 'token', expect.any(AbortSignal))
  expect(wrapper!.find('.feedback').exists()).toBe(false)
  const result = snapshot.commandResults![0]!
  result.status = status
  if (status === 'FAILED') result.detail = '电视无法播放此文件'
  snapshot.stateRevision = 3
  await vi.advanceTimersByTimeAsync(1000); await flushPromises()
  if (status === 'FAILED') expect(wrapper!.get('.feedback').text()).toContain('电视无法播放此文件')
  else expect(wrapper!.find('.feedback').exists()).toBe(false)
})
it('搜索时仍能查看和调整已选筛选，清空关键词后可继续输入', async () => {
  credentials(); await start()
  await wrapper!.get('.filter-line button:nth-child(2)').trigger('click')
  const input = wrapper!.get<HTMLInputElement>('input[type="search"]')
  await input.setValue('晴天'); await vi.advanceTimersByTimeAsync(200)
  expect(wrapper!.find('.filter-line').exists()).toBe(false)
  expect(wrapper!.get('.selected-tags').text()).toContain('国语')
  await wrapper!.get('.filter-button').trigger('click')
  const language = wrapper!.get('.filter-options button')
  expect(language.attributes('aria-pressed')).toBe('true')
  await language.trigger('click'); await wrapper!.get('.filter-button').trigger('click')
  await wrapper!.get('[aria-label="清空搜索"]').trigger('click')
  expect(input.element.value).toBe('')
  expect(document.activeElement).toBe(input.element)
  expect(wrapper!.get('.filter-line button').attributes('aria-pressed')).toBe('true')
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
  let reject!: (error: Error) => void, attempts = 0
  vi.mocked(request).mockImplementation((...args) => {
    if (args[0].endsWith('/commands') && ++attempts === 1) return new Promise((_resolve, fail) => { reject = fail })
    return original(...args)
  })
  await wrapper!.get('.add-song').trigger('click'); await flushPromises()
  expect(wrapper!.get('.add-song').attributes('disabled')).toBeDefined()
  expect(wrapper!.find('.feedback').exists()).toBe(false)
  reject(new Error('连接中断')); await flushPromises()
  expect(wrapper!.get('.feedback').text()).toContain('连接中断')
  const first = vi.mocked(request).mock.calls.find(c => c[0].includes('commands'))!
  await click('重试原请求')
  const commands = vi.mocked(request).mock.calls.filter(c => c[0].includes('commands'))
  expect(commands).toHaveLength(2); expect(commands[1]![2]).toEqual(first[2])
  expect(wrapper!.find('.feedback').exists()).toBe(false)
  expect(wrapper!.get('.bottom-nav .count').text()).toBe('1')
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
  expect(wrapper!.get('.bottom-nav .count').text()).toBe('1')
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
