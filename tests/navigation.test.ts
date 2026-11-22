// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../src/admin/App.vue'
import { router } from '../src/admin/app/router/index'
import { navigationGroups, navigationContext } from '../src/admin/app/navigation'

const settingsLabels = ['音乐平台', '存储与缓存', '计算服务', 'AI 与助手', '账号与安全']

async function settleLayout() { await vi.dynamicImportSettled(); await flushPromises() }
beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn())
  vi.stubGlobal('fetch', vi.fn().mockImplementation((path: string) => {
    if (path.endsWith('/metadata/settings')) return Promise.resolve(Response.json({ enabled: true, providers: ['NETEASE', 'QQ', 'KUGOU', 'KUWO', 'QISHUI'], autoApply: false, threshold: .8, minIntervalSeconds: 1, maxIntervalSeconds: 2 }))
    if (path.endsWith('/metadata/batches/latest')) return Promise.resolve(new Response(null, { status: 204 }))
    if (path.includes('/playback-history/summary')) return Promise.resolve(Response.json({ totalPlays: 0, effectivePlays: 0, playedSongs: 0, playedMs: 0 }))
    return Promise.resolve(path.includes('/background-tasks/batch-1') ? Response.json({detail:'任务不存在'}, {status:404}) : Response.json((path.includes('/ai/') || path.endsWith('/classification/tags')) ? [] : path.includes('/auth/session') ? { username: 'admin', defaultPassword: true, mfaEnabled: false, recoveryCodesRemaining: 0 } : { status: 'UP', items: [], totalElements: 0 }))
  }))
})
afterEach(() => vi.unstubAllGlobals())
it('键盘跳转主要内容不会破坏 hash 路由', async () => {
  await router.push('/overview')
  const wrapper = mount(App, { attachTo: document.body, global: { plugins: [router] } })
  await settleLayout(); await wrapper.get('.skip-link').trigger('click')
  expect(document.activeElement?.id).toBe('main-content'); expect(router.currentRoute.value.path).toBe('/overview')
  wrapper.unmount()
})
it('未知链接提供返回空间的入口', async () => {
  await router.push('/missing-page'); const wrapper = mount(App, { global: { plugins: [router] } }); await settleLayout()
  expect(wrapper.text()).toContain('页面不存在'); await wrapper.get('.text-link').trigger('click'); await flushPromises()
  expect(router.currentRoute.value.path).toBe('/overview'); expect(wrapper.get('h1').text()).toBe('曲库概览'); wrapper.unmount()
})
it('窄屏全部导航切页后关闭，Escape 恢复焦点并限制键盘范围', async () => {
  await router.push('/overview'); const wrapper = mount(App, { attachTo: document.body, global: { plugins: [router] } }); await settleLayout()
  const toggle = wrapper.get('.mobile-nav-toggle'); await toggle.trigger('click'); await flushPromises()
  expect(toggle.attributes('aria-expanded')).toBe('true'); expect(wrapper.get('.navigation-dialog').attributes('aria-modal')).toBe('true')
  expect(wrapper.get('.workspace').attributes('inert')).toBeDefined()
  const links = wrapper.findAll('#admin-navigation a'); (links[links.length - 1]!.element as HTMLElement).focus()
  await wrapper.get('.navigation-dialog').trigger('keydown', { key: 'Tab' })
  expect(document.activeElement).toBe(wrapper.get('.sheet-heading button').element)
  await wrapper.get('.navigation-dialog').trigger('keydown', { key: 'Escape' }); await flushPromises()
  expect(toggle.attributes('aria-expanded')).toBe('false'); expect(document.activeElement).toBe(toggle.element)
  await toggle.trigger('click'); await router.push('/system/parameters'); await flushPromises()
  expect(wrapper.find('.navigation-dialog').exists()).toBe(false); wrapper.unmount()
})
it('精简主导航与当前分区提供全部现有管理功能', async () => {
  await router.push('/library/songs'); const wrapper = mount(App, { global: { plugins: [router] } }); await settleLayout()
  expect(wrapper.findAll('.primary-navigation a').map(a => a.text())).toEqual(['首页','曲库','加歌','整理','客厅'])
  expect(wrapper.findAll('.section-navigation a').map(a => a.text())).toEqual(['歌曲','歌手','歌单','收藏'])
  const expected = ['/system/client-downloads','/library/songs','/library/artists','/library/playlists','/library/favorites','/library/classification','/library/media','/library/downloads','/library/songs/metadata','/library/audio-processing','/system/tv-settings','/library/playback-history','/library/missing-feedback','/system/parameters','/system/music-platforms','/library/cache','/system/compute','/system/ai']
  expect(navigationGroups.flatMap(g => g.children.map(e => e.path)).sort()).toEqual(expected.sort())
  await wrapper.get('.mobile-nav-toggle').trigger('click')
  const entries = (group: string) => wrapper.findAll(`[aria-labelledby="nav-group-${group}"] a`).map(a => a.text())
  expect(entries('add')).toEqual(['歌曲来源','下载歌曲','缺歌心愿'])
  expect(entries('tidy')).toEqual(['歌曲信息','歌曲分类','原唱与伴奏'])
  expect(entries('living')).toEqual(['播放与热门','电视首页','客户端下载'])
  expect(entries('settings')).toEqual(settingsLabels)
  expect(wrapper.findAll('#admin-navigation a').some(a => a.text() === '文件名识别')).toBe(false)
  wrapper.unmount()
})
it('客厅与设置入口打开分区第一项，账号与安全仍在设置中直接可达', async () => {
  await router.push('/library/songs')
  const wrapper = mount(App, { global: { plugins: [router] } })
  try {
    await settleLayout()
    await wrapper.findAll('.primary-navigation a').find(a => a.text() === '客厅')!.trigger('click'); await settleLayout()
    expect(router.currentRoute.value.path).toBe('/library/playback-history')
    expect(wrapper.get('.section-navigation a').attributes('aria-current')).toBe('page')
    await wrapper.get('.settings-link').trigger('click'); await settleLayout()
    expect(router.currentRoute.value.path).toBe('/system/music-platforms')
    expect(wrapper.findAll('.section-navigation a').map(a => a.text())).toEqual(settingsLabels)
    expect(wrapper.get('.section-navigation a').attributes('aria-current')).toBe('page')
    await wrapper.findAll('.section-navigation a').find(a => a.text() === '账号与安全')!.trigger('click'); await settleLayout()
    expect(router.currentRoute.value.path).toBe('/system/parameters')
    expect(wrapper.get('.section-navigation [aria-current="page"]').text()).toBe('账号与安全')
  } finally { wrapper.unmount() }
})
it('旧服务状态地址跳转到首页概览并保留查询参数与锚点', async () => {
  await router.push('/system?source=bookmark#main-content')
  const wrapper = mount(App, { global: { plugins: [router] } })
  try {
    await settleLayout()
    expect(router.currentRoute.value.fullPath).toBe('/overview?source=bookmark#main-content')
    expect(wrapper.get('h1').text()).toBe('曲库概览')
    expect(wrapper.find('a[href="#/system"]').exists()).toBe(false)
  } finally { wrapper.unmount() }
})
it('设置子路由与任务批次深链接高亮所属入口', async () => {
  await router.push('/system/ai/features'); const wrapper = mount(App, { global: { plugins: [router] } }); await settleLayout()
  expect(wrapper.get('.section-navigation [aria-current="page"]').text()).toBe('AI 与助手')
  expect(wrapper.get('.settings-link').attributes('aria-current')).toBe('page')
  await router.push('/system/tasks/batch-1'); await flushPromises()
  expect(wrapper.get('.utility-link[aria-current="page"]').text()).toBe('任务')
  expect(navigationContext('/system/tasks/batch-1').entry?.path).toBe('/system/tasks')
  wrapper.unmount()
})
it('任务、助手、设置提供完整文字入口，助手切页保留当前入口高亮', async () => {
  await router.push('/system/music-platforms')
  const wrapper = mount(App, { global: { plugins: [router] } })
  try {
    await settleLayout()
    const tools = wrapper.get('nav[aria-label="主要功能"]')
    expect(tools.findAll('.utility-label').map(label => label.text())).toEqual(['任务', '助手', '设置'])
    expect(tools.findAll('a').map(link => link.attributes('href'))).toEqual(['#/system/tasks', '#/system/assistant', '#/system/music-platforms'])
    await tools.get('[aria-label="管理助手"]').trigger('click'); await settleLayout()
    expect(router.currentRoute.value.path).toBe('/system/assistant')
    expect(tools.get('[aria-current="page"]').text()).toBe('助手')
    expect(tools.get('.settings-link').attributes('aria-current')).toBeUndefined()
  } finally { wrapper.unmount() }
})
it('旧方案和规则链接归入歌曲来源并保留指定方案、查询与锚点', async () => {
  await router.push('/library/filename-parser-profiles?profile=chosen&source=existing#preview')
  expect(router.currentRoute.value.path).toBe('/library/media/recognition')
  expect(router.currentRoute.value.query).toEqual({ profile: 'chosen', source: 'existing' })
  expect(router.currentRoute.value.hash).toBe('#preview')
  expect(router.currentRoute.value.meta.activeMenu).toBe('/library/media')
  await router.push('/library/filename-parser?profile=chosen')
  expect(router.currentRoute.value.path).toBe('/library/media/recognition/rules')
  expect(router.currentRoute.value.query.profile).toBe('chosen')
  expect(router.currentRoute.value.meta.activeMenu).toBe('/library/media')
  for (const path of [router.currentRoute.value.path, '/library/media/recognition', '/library/filename-parser', '/library/filename-parser-profiles']) {
    expect(navigationContext(path).entry?.label).toBe('歌曲来源')
    expect(navigationContext(path).group?.label).toBe('加歌')
  }
})

it('音乐平台在设置中直接可达并高亮，六个选项保留真实五平台配置', async () => {
  vi.mocked(fetch).mockImplementation(async input => {
    const path = String(input)
    if (path.endsWith('/metadata/settings')) return Response.json({ enabled: true, providers: ['NETEASE', 'QQ', 'KUGOU', 'KUWO', 'QISHUI'], autoApply: false, threshold: .95, minIntervalSeconds: 3, maxIntervalSeconds: 8 })
    if (path.endsWith('/metadata/batches/latest')) return new Response(null, { status: 204 })
    return Response.json({ username: 'admin', status: 'UP', items: [], totalElements: 0 })
  })
  await router.push('/system/music-platforms')
  const wrapper = mount(App, { global: { plugins: [router] } }); await settleLayout()
  expect(wrapper.get('.settings-link').attributes('aria-current')).toBe('page')
  expect(wrapper.get('.section-navigation [aria-current="page"]').text()).toBe('音乐平台')
  expect(wrapper.get('h1').text()).toBe('音乐平台')
  const platforms = wrapper.findAll<HTMLInputElement>('.platform-options input[type="checkbox"]')
  expect(platforms).toHaveLength(6)
  expect(platforms.filter(platform => platform.element.checked).map(platform => platform.element.value))
    .toEqual(['NETEASE', 'QQ', 'KUGOU', 'KUWO', 'QISHUI'])
  wrapper.unmount()
})

it('其他页面顶栏全局搜索跳转到歌曲工作区并携带搜索词与透镜', async () => {
  await router.push('/library/songs')
  const wrapper = mount(App, { global: { plugins: [router] } }); await settleLayout()
  await wrapper.get('.masthead-search .search-input').setValue('周杰伦')
  await wrapper.get('.masthead-search').trigger('submit'); await flushPromises()
  expect(router.currentRoute.value.path).toBe('/library/songs')
  expect(router.currentRoute.value.query).toEqual({ lens: 'songs', search: '周杰伦' })
  wrapper.unmount()
})

it('电视授权页和入口已移除，客厅入口直接进入播放与热门', async () => {
  expect(navigationGroups.find(group => group.id === 'living')?.path).toBe('/library/playback-history')
  expect(router.getRoutes().some(route => route.path === '/system/tv-devices')).toBe(false)
  await router.push('/system/tv-devices')
  const wrapper = mount(App, { global: { plugins: [router] } })
  try {
    await settleLayout()
    expect(wrapper.text()).toContain('页面不存在')
    expect(wrapper.findAll('a').some(link => link.attributes('href')?.includes('/system/tv-devices'))).toBe(false)
    expect(vi.mocked(fetch).mock.calls.some(([path]) => String(path).includes('/device-authorizations') || String(path).includes('/tv-devices'))).toBe(false)
  } finally { wrapper.unmount() }
})


it('唱片室首页使用主区搜索，离开首页后恢复全局搜索与默认布局', async () => {
  await router.push('/overview')
  const wrapper = mount(App, { global: { plugins: [router] } })
  try {
    await settleLayout()
    expect(wrapper.find('.record-room-shell').exists()).toBe(true)
    expect(wrapper.find('.masthead-search').exists()).toBe(false)
    expect(wrapper.find('.home-search').exists()).toBe(true)
    await router.push('/library/songs'); await settleLayout()
    expect(wrapper.find('.record-room-shell').exists()).toBe(false)
    expect(wrapper.find('.masthead-search').exists()).toBe(true)
  } finally { wrapper.unmount() }
})


it('全局搜索反映曲库当前关键词，切换其他页面清空旧词并说明搜索范围', async () => {
  await router.push('/library/songs?search=王杰')
  const wrapper=mount(App,{global:{plugins:[router]}})
  try {
    await settleLayout()
    expect(wrapper.get('.masthead-search input').element).toHaveProperty('value','王杰')
    await router.push('/library/songs?search=薛之谦'); await settleLayout()
    expect(wrapper.get('.masthead-search input').element).toHaveProperty('value','薛之谦')
    await router.push('/library/playlists'); await settleLayout()
    expect(wrapper.get('.masthead-search input').element).toHaveProperty('value','')
    expect(wrapper.get('.masthead-search input').attributes('placeholder')).toContain('在曲库中搜索')
  } finally { wrapper.unmount() }
})
