// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ElMessageBox } from 'element-plus'
import FilenameProfilesView from '../src/admin/modules/filename-parser/views/FilenameProfilesView.vue'
import { parserProfiles, ruleLibrary } from '../src/admin/modules/filename-parser/api/rules'
import { ApiError } from '../src/admin/core/auth/api'
import type { ParserWorkspace, ProfilePreview } from '../src/admin/modules/filename-parser/types'
import { workspace, preview } from './fixtures/filename-workspace'

vi.mock('../src/admin/modules/filename-parser/api/rules', () => ({
  parserProfiles: { load: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), preview: vi.fn() },
  ruleLibrary: { load: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
}))
let wrapper: VueWrapper
let router: Router
let server: ParserWorkspace
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
beforeEach(() => {
  server = workspace()
  vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as Awaited<ReturnType<typeof ElMessageBox.confirm>>)
  vi.mocked(parserProfiles.load).mockImplementation(async () => clone(server))
  vi.mocked(parserProfiles.preview).mockImplementation(async () => ({ revision: server.revision, profileId: null, profileName: null, preview: preview() }))
  vi.mocked(parserProfiles.create).mockImplementation(async (revision, profile) => {
    server = { ...server, revision: revision + 1, changedId: 'created-profile', profiles: [...server.profiles, { id: 'created-profile', ...clone(profile) }] }
    return clone(server)
  })
  vi.mocked(parserProfiles.update).mockImplementation(async (id, revision, profile) => {
    server = { ...server, revision: revision + 1, changedId: id, profiles: server.profiles.map(p => p.id === id ? { id, ...clone(profile) } : p) }
    return clone(server)
  })
  vi.mocked(parserProfiles.remove).mockImplementation(async (id, revision) => {
    server = { ...server, revision: revision + 1, changedId: id, profiles: server.profiles.filter(p => p.id !== id) }
    return clone(server)
  })
  vi.mocked(ruleLibrary.create).mockImplementation(async (revision, rule) => {
    server = { ...server, revision: revision + 1, changedId: 'custom-format', definitions: [...server.definitions, { id: 'custom-format', ...clone(rule), referencedBy: [] }] }
    return clone(server)
  })
  vi.mocked(ruleLibrary.update).mockImplementation(async (id, revision, rule) => {
    server = { ...server, revision: revision + 1, changedId: id, definitions: server.definitions.map(d => d.id === id ? { ...d, ...clone(rule) } : d) }
    return clone(server)
  })
})
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = ''; vi.restoreAllMocks(); vi.resetAllMocks() })
async function open(profile = 'reverse-profile') {
  router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/library/media/recognition', component: FilenameProfilesView },
    { path: '/library/media/recognition/rules', component: { template: '<div>解析规则</div>' } },
    { path: '/other', component: { template: '<div>其他页面</div>' } },
  ] })
  await router.push(`/library/media/recognition?profile=${profile}`)
  wrapper = mount({ template: '<RouterView />' }, { global: { plugins: [router], stubs: { teleport: true } } })
  await flushPromises()
}
function button(text: string) { return wrapper.findAll('button').find(b => b.text() === text)! }
async function choose(id: string) { await wrapper.get('select[aria-label="当前方案"]').setValue(id); await flushPromises() }
async function addFormat(id: string) {
  await button('添加格式').trigger('click'); await flushPromises()
  await wrapper.get(`[data-catalog-id="${id}"] button`).trigger('click')
  await button('完成').trigger('click'); await flushPromises()
}
async function parse() { await wrapper.get('form.filename-form').trigger('submit'); await flushPromises() }
async function failParse() {
  const none = preview(); none.selectedRule = null; none.result.title = null; none.result.artists = []; none.result.parseStatus = 'FAILED'; none.attempts = []
  vi.mocked(parserProfiles.preview).mockResolvedValueOnce({ revision: server.revision, profileId: null, profileName: null, preview: none })
  await parse()
}
async function suggest() { await button('找其他适合的格式').trigger('click'); await flushPromises() }

it('引用链接选择方案，试解析只发送成员草稿，不保存也不发送规则定义', async () => {
  await open()
  expect(wrapper.get('input[aria-label="方案名称"]').element).toHaveProperty('value', '反向方案')
  expect(parserProfiles.preview).not.toHaveBeenCalled()
  await parse()
  expect(parserProfiles.preview).toHaveBeenCalledWith('周杰伦-晴天.mkv', 0, [{ ruleId: 'reverse', enabled: true }])
  expect(wrapper.get('[data-testid="parsed-artists"]').text()).toBe('周杰伦')
  expect(wrapper.get('[data-testid="parsed-title"]').text()).toBe('晴天')
  expect(wrapper.text()).toContain('试解析方案：反向方案')
  expect(parserProfiles.update).not.toHaveBeenCalled()
})
it('创建和复制方案只复制成员引用，空方案按空成员提交和试解析', async () => {
  await open()
  await button('复制').trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('未保存草稿')
  await button('保存方案').trigger('click'); await flushPromises()
  expect(parserProfiles.create).toHaveBeenCalledWith(0, { name: '反向方案（副本）', entries: [{ ruleId: 'reverse', enabled: true }] })
  expect(parserProfiles.preview).not.toHaveBeenCalled()
  expect(router.currentRoute.value.query.profile).toBe('created-profile')
  expect(wrapper.text()).toContain('已保存方案')
  await button('新建').trigger('click'); await flushPromises()
  await wrapper.get('input[aria-label="方案名称"]').setValue('空方案')
  await parse()
  expect(parserProfiles.preview).toHaveBeenLastCalledWith('周杰伦-晴天.mkv', 1, [])
  await button('保存方案').trigger('click'); await flushPromises()
  expect(parserProfiles.create).toHaveBeenLastCalledWith(1, { name: '空方案', entries: [] })
})
it('同一格式列表内添加、排序、启停和移除，打开编辑器前没有表达式输入框', async () => {
  await open(); await addFormat('forward')
  await wrapper.get('button[aria-label="上移 正向"]').trigger('click')
  await wrapper.get('[aria-label="启用 正向"]').trigger('click')
  await parse()
  expect(parserProfiles.preview).toHaveBeenLastCalledWith('周杰伦-晴天.mkv', 0, [{ ruleId: 'forward', enabled: false }, { ruleId: 'reverse', enabled: true }])
  expect(wrapper.find('textarea').exists()).toBe(false)
  await wrapper.get('button[aria-label="移除 正向"]').trigger('click')
  await wrapper.get('input[aria-label="方案名称"]').setValue('改名反向')
  await wrapper.get('[aria-label="未保存方案"] button').trigger('click'); await flushPromises()
  expect(parserProfiles.update).toHaveBeenCalledWith('reverse-profile', 0, { name: '改名反向', entries: [{ ruleId: 'reverse', enabled: true }] })
})
it('切换、离开和刷新保护未保存草稿，取消切换时恢复选择框', async () => {
  await open()
  await wrapper.get('input[aria-label="方案名称"]').setValue('尚未保存')
  vi.mocked(ElMessageBox.confirm).mockRejectedValueOnce('cancel')
  await choose('default')
  expect(wrapper.get('input[aria-label="方案名称"]').element).toHaveProperty('value', '尚未保存')
  expect(wrapper.get('select[aria-label="当前方案"]').element).toHaveProperty('value', 'reverse-profile')
  const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  vi.mocked(ElMessageBox.confirm).mockRejectedValueOnce('cancel')
  await router.push('/other'); await flushPromises()
  expect(router.currentRoute.value.path).toBe('/library/media/recognition')
  await choose('default')
  expect(wrapper.get('input[aria-label="方案名称"]').element).toHaveProperty('value', '默认解析方案')
  expect(ElMessageBox.confirm).toHaveBeenCalledTimes(3)
})
it('管理中默认方案不可删除，删除当前其他方案后保留共享格式', async () => {
  await open('default'); await button('管理').trigger('click'); await flushPromises()
  expect(wrapper.get('button[aria-label="删除方案 默认解析方案"]').attributes('disabled')).toBeDefined()
  await button('完成').trigger('click'); await choose('reverse-profile')
  await button('管理').trigger('click'); await flushPromises()
  await wrapper.get('button[aria-label="删除方案 反向方案"]').trigger('click'); await flushPromises()
  expect(parserProfiles.remove).toHaveBeenCalledWith('reverse-profile', 0)
  expect(router.currentRoute.value.query.profile).toBe('default')
  expect(server.definitions.some(d => d.id === 'reverse')).toBe(true)
})
it('输入或成员变化标记结果过期，并丢弃迟到响应', async () => {
  await open(); await parse()
  await wrapper.get('input[aria-label="文件名"]').setValue('新的输入.mkv')
  expect(wrapper.text()).toContain('结果已过期')
  expect(wrapper.get('.filename-result').text()).toContain('上次文件名：晴天-周杰伦.mkv')
  let resolve!: (value: ProfilePreview) => void
  vi.mocked(parserProfiles.preview).mockImplementationOnce(() => new Promise(r => { resolve = r }))
  await wrapper.get('form.filename-form').trigger('submit')
  await wrapper.get('[aria-label="启用 反向"]').trigger('click')
  const late = preview(); late.result.title = '迟到结果'
  resolve({ revision: 0, profileId: null, profileName: null, preview: late }); await flushPromises()
  expect(wrapper.get('[data-testid="parsed-title"]').text()).toBe('晴天')
  expect(wrapper.text()).not.toContain('迟到结果')
})
it('版本冲突后加载最新配置保留草稿，不自动删除失效引用', async () => {
  await open(); await button('复制').trigger('click'); await flushPromises()
  vi.mocked(parserProfiles.preview).mockRejectedValueOnce(new ApiError(409, '配置变化'))
  await parse()
  expect(wrapper.text()).toContain('配置变化')
  server = { ...workspace(), revision: 8, definitions: workspace().definitions.filter(d => d.id !== 'reverse'), profiles: workspace().profiles.filter(p => p.id !== 'reverse-profile') }
  await button('加载最新配置，保留草稿').trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('失效引用：reverse')
  expect(wrapper.get('input[aria-label="方案名称"]').element).toHaveProperty('value', '反向方案（副本）')
  vi.mocked(parserProfiles.preview).mockRejectedValueOnce(new ApiError(400, '规则已被删除', { ruleId: 'reverse', ruleIndex: 0, field: 'entries' }))
  await parse()
  expect(parserProfiles.preview).toHaveBeenLastCalledWith('周杰伦-晴天.mkv', 8, [{ ruleId: 'reverse', enabled: true }])
  expect(wrapper.get('.format-member').text()).toContain('规则已被删除')
})
it('加载失败可重试，未命中时提供其他格式入口', async () => {
  vi.mocked(parserProfiles.load).mockRejectedValueOnce(new Error('加载失败'))
  await open()
  expect(wrapper.text()).toContain('加载失败')
  await button('重试加载').trigger('click'); await flushPromises()
  await failParse()
  expect(wrapper.text()).toContain('未提取到完整')
  expect(wrapper.get('[data-testid="parsed-artists"]').text()).toBe('未确定')
  expect(button('找其他适合的格式').exists()).toBe(true)
})
it('未命中后只请求一次内置候选，添加只改草稿，主结果保持原样', async () => {
  await open(); await failParse(); await suggest()
  expect(parserProfiles.preview).toHaveBeenLastCalledWith('周杰伦-晴天.mkv', 0, [{ ruleId: 'builtin-book', enabled: true }, { ruleId: 'builtin-hyphen', enabled: true }])
  expect(wrapper.get('[data-catalog-id="builtin-hyphen"]').text()).toContain('可完整提取，仍需核对字段方向')
  expect(wrapper.get('[data-catalog-id="builtin-book"]').text()).toContain('未完整匹配')
  await wrapper.get('[data-catalog-id="builtin-hyphen"] button').trigger('click')
  expect(wrapper.get('[data-catalog-id="builtin-hyphen"] button').attributes('disabled')).toBeDefined()
  expect(wrapper.get('[data-testid="parsed-title"]').text()).toBe('未确定')
  expect(parserProfiles.update).not.toHaveBeenCalled()
  await button('完成').trigger('click'); await flushPromises()
  await button('保存方案').trigger('click'); await flushPromises()
  expect(parserProfiles.update).toHaveBeenCalledWith('reverse-profile', 0, { name: '反向方案', entries: [{ ruleId: 'reverse', enabled: true }, { ruleId: 'builtin-hyphen', enabled: true }] })
})
it('候选检测冲突时保留草稿，加载最新配置后可继续保存', async () => {
  await open(); await failParse()
  await wrapper.get('input[aria-label="方案名称"]').setValue('待保护')
  vi.mocked(parserProfiles.preview).mockRejectedValueOnce(new ApiError(409, '配置变化'))
  await suggest()
  expect(wrapper.text()).toContain('配置变化')
  expect(wrapper.get('input[aria-label="方案名称"]').element).toHaveProperty('value', '待保护')
  expect(button('保存方案').attributes('disabled')).toBeDefined()
  await button('完成').trigger('click'); await flushPromises()
  await button('加载最新配置，保留草稿').trigger('click'); await flushPromises()
  expect(wrapper.get('input[aria-label="方案名称"]').element).toHaveProperty('value', '待保护')
  expect(button('保存方案').attributes('disabled')).toBeUndefined()
})
it('修改文件名后旧候选过期，重新检测发送新输入', async () => {
  await open(); await failParse(); await suggest()
  await wrapper.get('input[aria-label="文件名"]').setValue('新的输入.mkv')
  expect(wrapper.text()).toContain('以下候选已过期')
  await button('重新检测').trigger('click'); await flushPromises()
  expect(wrapper.text()).not.toContain('以下候选已过期')
  expect(parserProfiles.preview).toHaveBeenLastCalledWith('新的输入.mkv', 0, [{ ruleId: 'builtin-book', enabled: true }, { ruleId: 'builtin-hyphen', enabled: true }])
})
it('自定义格式就地保存到共享目录，保留方案草稿并使用新版本再保存成员', async () => {
  await open()
  await wrapper.get('input[aria-label="方案名称"]').setValue('我的方案')
  await button('自定义格式').trigger('click'); await flushPromises()
  await wrapper.get('input[aria-label="格式名称"]').setValue('歌名_歌手')
  await wrapper.get('textarea[aria-label="格式表达式"]').setValue('{title}_{artist}')
  await wrapper.get('form.format-editor').trigger('submit'); await flushPromises()
  expect(ruleLibrary.create).toHaveBeenCalledWith(0, { name: '歌名_歌手', type: 'TEMPLATE', expression: '{title}_{artist}', builtinId: null })
  expect(wrapper.get('input[aria-label="方案名称"]').element).toHaveProperty('value', '我的方案')
  expect(wrapper.findAll('.format-member').map(row => row.text()).join(' ')).toContain('歌名_歌手')
  expect(parserProfiles.update).not.toHaveBeenCalled()
  await button('保存方案').trigger('click'); await flushPromises()
  expect(parserProfiles.update).toHaveBeenCalledWith('reverse-profile', 1, { name: '我的方案', entries: [{ ruleId: 'reverse', enabled: true }, { ruleId: 'custom-format', enabled: true }] })
})
it('编辑已有格式明确共享影响，保存不重复添加成员，旧结果过期', async () => {
  await open(); await parse()
  await wrapper.get('button[aria-label="编辑 反向"]').trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('保存格式会立即影响 1 个引用方案：反向方案')
  await wrapper.get('textarea[aria-label="格式表达式"]').setValue('{title}_{artist}')
  await wrapper.get('form.format-editor').trigger('submit'); await flushPromises()
  expect(ruleLibrary.update).toHaveBeenCalledWith('reverse', 0, { name: '反向', type: 'TEMPLATE', expression: '{title}_{artist}', builtinId: null })
  expect(wrapper.findAll('.format-member')).toHaveLength(1)
  expect(wrapper.text()).toContain('结果已过期')
  expect(button('保存方案').attributes('disabled')).toBeDefined()
})
it('格式保存冲突保留编辑内容，重载时禁止提交，重载后用新版本保存', async () => {
  await open(); await button('自定义格式').trigger('click'); await flushPromises()
  await wrapper.get('input[aria-label="格式名称"]').setValue('不丢失的格式')
  vi.mocked(ruleLibrary.create).mockRejectedValueOnce(new ApiError(409, '配置变化'))
  await wrapper.get('form.format-editor').trigger('submit'); await flushPromises()
  let resolve!: (value: ParserWorkspace) => void
  vi.mocked(parserProfiles.load).mockImplementationOnce(() => new Promise(r => { resolve = r }))
  await button('加载最新配置，保留编辑内容').trigger('click'); await flushPromises()
  expect(wrapper.get('.format-editor fieldset').attributes('disabled')).toBeDefined()
  await wrapper.get('form.format-editor').trigger('submit'); await flushPromises()
  expect(ruleLibrary.create).toHaveBeenCalledTimes(1)
  server.revision = 8; resolve(clone(server)); await flushPromises()
  expect(wrapper.get('input[aria-label="格式名称"]').element).toHaveProperty('value', '不丢失的格式')
  await wrapper.get('form.format-editor').trigger('submit'); await flushPromises()
  expect(ruleLibrary.create).toHaveBeenLastCalledWith(8, expect.objectContaining({ name: '不丢失的格式' }))
})
it('格式编辑的未保存输入也受页面离开保护，服务端校验失败保持输入', async () => {
  await open(); await button('自定义格式').trigger('click'); await flushPromises()
  await wrapper.get('input[aria-label="格式名称"]').setValue('待修正')
  await wrapper.get('textarea[aria-label="格式表达式"]').setValue('{artist}')
  vi.mocked(ruleLibrary.create).mockRejectedValueOnce(new ApiError(400, '必须包含 title', { field: 'expression' }))
  await wrapper.get('form.format-editor').trigger('submit'); await flushPromises()
  expect(wrapper.text()).toContain('必须包含 title')
  expect(wrapper.get('textarea[aria-label="格式表达式"]').element).toHaveProperty('value', '{artist}')
  vi.mocked(ElMessageBox.confirm).mockRejectedValueOnce('cancel')
  await router.push('/other'); await flushPromises()
  expect(router.currentRoute.value.path).toBe('/library/media/recognition')
  const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
})
it('方向反了时启用真实反向格式并移到最前，不直接交换结果或自动请求', async () => {
  server.definitions.push({ id: 'builtin-reverse', name: '歌名-歌手（反向）', type: 'BUILTIN', expression: null, builtinId: 'reverse-hyphen', referencedBy: [] })
  server.profiles[0]!.entries.push({ ruleId: 'builtin-reverse', enabled: false })
  await open('default'); await parse()
  await button('歌名和歌手反了？').trigger('click')
  await button('启用反向并移到最前').trigger('click'); await flushPromises()
  expect(parserProfiles.preview).toHaveBeenCalledTimes(1)
  expect(wrapper.get('[data-testid="parsed-title"]').text()).toBe('晴天')
  expect(wrapper.text()).toContain('结果已过期')
  await parse()
  expect(parserProfiles.preview).toHaveBeenLastCalledWith('周杰伦-晴天.mkv', 0, [{ ruleId: 'builtin-reverse', enabled: true }, { ruleId: 'forward', enabled: true }])
})
it('新方案保存更新链接时保留刚核对的结果', async () => {
  await open(); await button('复制').trigger('click'); await flushPromises(); await parse()
  await button('保存方案').trigger('click'); await flushPromises()
  expect(router.currentRoute.value.query.profile).toBe('created-profile')
  expect(wrapper.get('[data-testid="parsed-title"]').text()).toBe('晴天')
  expect(wrapper.text()).toContain('已提取')
  expect(wrapper.text()).not.toContain('结果已过期')
})
