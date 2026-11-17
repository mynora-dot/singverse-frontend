// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { assistantPets } from '../src/admin/modules/ai-settings/pets'
import AiSettingsView from '../src/admin/modules/ai-settings/views/AiSettingsView.vue'
import { ai } from '../src/admin/modules/ai-settings/api/ai'
import type { AiService, Feature, ModelDiscoveryResult } from '../src/admin/modules/ai-settings/types'
vi.mock('../src/admin/modules/ai-settings/api/ai')
const model: AiService = { id: 'model-1', kind: 'MODEL', name: '分类模型', provider: 'custom', protocol: 'CHAT_COMPLETIONS', endpoint: 'https://example.test/chat/completions', model: 'fixture', outputMode: 'JSON_SCHEMA', enabled: true, hasKey: true, timeoutSeconds: 60, maxResults: 5, revision: 1 }
const search: AiService = { ...model, id: 'search-1', kind: 'SEARCH', name: '搜索服务', provider: 'custom-search', protocol: 'CUSTOM-SEARCH', model: '' }
const features: Feature[] = [{ id: 'assistant', modelServiceId: null, searchServiceId: null, enabled: false, intervalSeconds: 3, revision: 1, displayMode: 'PET', petId: 'music-sprite' }, { id: 'classification', modelServiceId: 'model-1', searchServiceId: null, enabled: false, intervalSeconds: 3, revision: 1 }, { id: 'default-search', modelServiceId: null, searchServiceId: null, enabled: false, intervalSeconds: 3, revision: 1 }]
let wrapper: VueWrapper
const button = (text: string) => wrapper.findAll('button').find(b => b.text() === text)!
async function page(section = 'models') {
  const router = createRouter({ history: createMemoryHistory(), routes: ['models', 'search', 'features', 'features/assistant'].map(s => ({ path: '/system/ai/' + s, component: AiSettingsView })) })
  await router.push('/system/ai/' + section)
  wrapper = mount({ template: '<RouterView />' }, { attachTo: document.body, global: { plugins: [router] } })
  await flushPromises(); return router
}
beforeEach(() => {
  vi.mocked(ai.providers).mockResolvedValue([{ id: 'custom', name: '通用模型', kind: 'MODEL', protocol: 'CHAT_COMPLETIONS', endpoint: '', outputMode: 'JSON_SCHEMA' }, { id: 'anthropic', name: 'Anthropic', kind: 'MODEL', protocol: 'ANTHROPIC', endpoint: 'https://api.anthropic.com/v1/messages', outputMode: 'JSON_SCHEMA' }, { id: 'custom-search', name: '通用搜索', kind: 'SEARCH', protocol: 'CUSTOM-SEARCH', endpoint: '', outputMode: '' }])
  vi.mocked(ai.services).mockImplementation(async kind => kind === 'MODEL' ? [model] : [search])
  vi.mocked(ai.features).mockResolvedValue(features.map(f => ({ ...f })))
  vi.mocked(ai.save).mockResolvedValue(model)
  vi.mocked(ai.bind).mockImplementation(async f => ({ ...f, revision: f.revision + 1 }))
  vi.mocked(ai.test).mockResolvedValue({ success: true, message: '查询成功', elapsedMs: 15, results: [{ title: '测试结果', url: 'https://example.test/result', snippet: '返回摘要' }] })
  vi.mocked(ai.discoverModels).mockResolvedValue({ items: [{ id: 'local-model', name: '本地模型' }], truncated: false })
})
afterEach(() => { wrapper?.unmount(); vi.clearAllMocks(); vi.restoreAllMocks(); document.body.innerHTML = '' })
it('查询和锚点更新保留服务编辑草稿，不触发离页确认', async () => {
  const confirm = vi.spyOn(ElMessageBox, 'confirm')
  const router = await page()
  await button('编辑').trigger('click'); await flushPromises()
  const input = wrapper.get('input[placeholder="例如：日常分类模型"]')
  await input.setValue('尚未保存的服务名称')
  await router.push('/system/ai/models?probe=1#service'); await flushPromises()
  expect(router.currentRoute.value.query.probe).toBe('1')
  expect(wrapper.get('input[placeholder="例如：日常分类模型"]').element).toBe(input.element)
  expect(input.element).toHaveProperty('value', '尚未保存的服务名称')
  expect(confirm).not.toHaveBeenCalled()
  expect(ai.save).not.toHaveBeenCalled()
})
it('模型配置和分类任务分离，编辑密钥不回填，保存不会自动请求模型', async () => {
  await page(); expect(wrapper.text()).toContain('分类模型')
  await button('编辑').trigger('click'); await flushPromises()
  expect((wrapper.get('input[type="password"]').element as HTMLInputElement).value).toBe('')
  await wrapper.get('input[placeholder="例如：日常分类模型"]').setValue('新的配置名')
  await button('保存服务').trigger('click'); await flushPromises()
  expect(ai.save).toHaveBeenCalledWith('MODEL', expect.objectContaining({ name: '新的配置名', apiKey: '', revision: 1 }), 'model-1')
  expect(ai.test).not.toHaveBeenCalled()
})
it('厂商预设切换更新协议和地址，不携带前一个密钥', async () => {
  await page(); await button('添加模型服务').trigger('click'); await flushPromises()
  await wrapper.get('input[type="password"]').setValue('fixture-key')
  const provider = wrapper.findAllComponents({ name: 'ElSelect' })[0]!
  provider.vm.$emit('update:modelValue', 'anthropic'); provider.vm.$emit('change', 'anthropic'); await flushPromises()
  expect((wrapper.get('input[type="password"]').element as HTMLInputElement).value).toBe('')
  expect((wrapper.get('input[placeholder="https://服务地址/接口路径"]').element as HTMLInputElement).value).toBe('https://api.anthropic.com/v1/messages')
})
it('功能配置绑定模型，分类页面仍由曲库入口承载', async () => {
  await page('features'); expect(wrapper.find('a[href="/library/classification"]').exists()).toBe(true)
  expect(wrapper.text()).not.toContain('分类任务记录')
  await wrapper.get('[role="switch"]').trigger('click'); await button('保存功能配置').trigger('click'); await flushPromises()
  expect(ai.bind).toHaveBeenCalledWith(expect.objectContaining({ id: 'classification', modelServiceId: 'model-1', enabled: true }))
})
it('默认搜索选择不会发起查询，测试仅返回服务端结果', async () => {
  await page('search')
  const select = wrapper.findComponent({ name: 'ElSelect' }); select.vm.$emit('change', 'search-1'); await flushPromises()
  expect(ai.bind).toHaveBeenCalledWith(expect.objectContaining({ id: 'default-search', searchServiceId: 'search-1' }))
  expect(ai.test).not.toHaveBeenCalled()
  await button('测试查询').trigger('click'); await flushPromises()
  await wrapper.get('input[placeholder="输入测试关键词"]').setValue('测试查询')
  await button('开始测试').trigger('click'); await flushPromises()
  expect(ai.test).toHaveBeenCalledWith(search, 'generation', '测试查询')
  expect(wrapper.text()).toContain('返回摘要')
})
it('配置草稿离开保护，取消离开后保留输入', async () => {
  const router = await page(); await button('编辑').trigger('click'); await flushPromises()
  await wrapper.get('input[placeholder="例如：日常分类模型"]').setValue('未保存的名称')
  vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
  await router.push('/system/ai/search'); await flushPromises()
  expect(router.currentRoute.value.path).toBe('/system/ai/models')
  expect((wrapper.get('input[placeholder="例如：日常分类模型"]').element as HTMLInputElement).value).toBe('未保存的名称')
})
it('读取失败可重试，不显示虚假已保存状态', async () => {
  vi.mocked(ai.services).mockRejectedValueOnce(new Error('服务暂时不可用'))
  await page(); expect(wrapper.text()).toContain('服务暂时不可用')
  await button('重新加载').trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('分类模型')
})

it('助手独立配置形态并保护未保存草稿，保存不调用模型', async () => {
  const router = await page('features/assistant')
  expect(wrapper.text()).toContain('宠物形象')
  expect(wrapper.text()).not.toContain('分类任务请求间隔')
  await wrapper.get('[role="switch"]').trigger('click')
  vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
  await router.push('/system/ai/features'); await flushPromises()
  expect(router.currentRoute.value.path).toBe('/system/ai/features/assistant')
  await wrapper.get('input[value="CHAT"]').setValue(); await flushPromises()
  await button('保存助手配置').trigger('click'); await flushPromises()
  expect(ai.bind).toHaveBeenCalledWith(expect.objectContaining({ id: 'assistant', enabled: true, displayMode: 'CHAT', petId: 'music-sprite' }))
  expect(ai.test).not.toHaveBeenCalled()
  await router.push('/system/ai/features'); await flushPromises()
  expect(router.currentRoute.value.path).toBe('/system/ai/features')
  expect(wrapper.find('a[href="/system/ai/features/assistant"]').exists()).toBe(true)
})

it('内置形象可从选择列表保存并重新进入读取', async () => {
  const router = await page('features/assistant')
  expect(wrapper.findAll('.assistant-pet-options input[type="radio"]')).toHaveLength(14)
  for (const pet of assistantPets.filter(p => p.src)) {
    await wrapper.get(`input[value="${pet.id}"]`).setValue(); await flushPromises()
    await button('保存助手配置').trigger('click'); await flushPromises()
    expect(ai.bind).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'assistant', petId: pet.id }))
  }
  vi.mocked(ai.features).mockResolvedValue(features.map(f => f.id === 'assistant' ? { ...f, petId: 'alien-traveler' } : f))
  await router.push('/system/ai/features'); await flushPromises()
  await router.push('/system/ai/features/assistant'); await flushPromises()
  expect((wrapper.get('input[value="alien-traveler"]').element as HTMLInputElement).checked).toBe(true)
  expect(ai.test).not.toHaveBeenCalled()
})

it('助手可绑定模型与可选搜索，保存配置不会请求上游',async()=>{
 await page('features/assistant');const selects=wrapper.findAllComponents({name:'ElSelect'});selects[0]!.vm.$emit('update:modelValue','model-1');selects[1]!.vm.$emit('update:modelValue','search-1');await flushPromises();await button('保存助手配置').trigger('click');await flushPromises();expect(ai.bind).toHaveBeenCalledWith(expect.objectContaining({id:'assistant',modelServiceId:'model-1',searchServiceId:'search-1'}));expect(ai.test).not.toHaveBeenCalled()
})
it('模型设置提供无业务副作用的原生工具调用连接测试',async()=>{
 await page();await button('测试服务').trigger('click');await flushPromises();const selects=wrapper.findAllComponents({name:'ElSelect'});selects.at(-1)!.vm.$emit('update:modelValue','tools');await flushPromises();await button('开始测试').trigger('click');await flushPromises();expect(ai.test).toHaveBeenCalledWith(model,'tools','')
})

it('未保存的基础地址和密钥可获取模型，单个结果自动选用而不保存或生成', async () => {
  await page(); await button('添加模型服务').trigger('click'); await flushPromises()
  await wrapper.get('input[aria-label="服务地址"]').setValue('http://10.0.0.16:8080/v1')
  await wrapper.get('input[type="password"]').setValue('draft-key')
  expect(wrapper.text()).toContain('http://10.0.0.16:8080/v1/chat/completions')
  expect(ai.discoverModels).not.toHaveBeenCalled()
  await button('获取模型列表').trigger('click'); await flushPromises()
  expect(ai.discoverModels).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ endpoint: 'http://10.0.0.16:8080/v1', protocol: 'CHAT_COMPLETIONS', apiKey: 'draft-key' }))
  expect(wrapper.find('.ai-model-picker').findComponent({ name: 'ElSelect' }).props('modelValue')).toBe('local-model')
  expect(wrapper.text()).toContain('已获取 1 个模型')
  expect(ai.save).not.toHaveBeenCalled(); expect(ai.test).not.toHaveBeenCalled()
})

it('编辑已有服务时使用服务标识和修订获取模型，密钥不回填', async () => {
  await page(); await button('编辑').trigger('click'); await flushPromises()
  await button('获取模型列表').trigger('click'); await flushPromises()
  expect(ai.discoverModels).toHaveBeenCalledWith(expect.objectContaining({ serviceId: model.id, revision: model.revision, apiKey: '', endpoint: model.endpoint }))
  expect((wrapper.get('input[type="password"]').element as HTMLInputElement).value).toBe('')
  expect(wrapper.find('.ai-model-picker').findComponent({ name: 'ElSelect' }).props('modelValue')).toBe('fixture')
})

it('获取结果可搜索选择，同时保留未列出的自定义模型 ID', async () => {
  vi.mocked(ai.discoverModels).mockResolvedValue({ items: [{ id: 'model-a', name: '模型 A' }, { id: 'model-b', name: '模型 B' }], truncated: false })
  await page(); await button('编辑').trigger('click'); await flushPromises()
  await button('获取模型列表').trigger('click'); await flushPromises()
  const select = wrapper.find('.ai-model-picker').findComponent({ name: 'ElSelect' })
  expect(select.props('filterable')).toBe(true); expect(select.props('allowCreate')).toBe(true)
  select.vm.$emit('update:modelValue', 'model-b'); await flushPromises()
  await button('保存服务').trigger('click'); await flushPromises()
  expect(ai.save).toHaveBeenLastCalledWith('MODEL', expect.objectContaining({ model: 'model-b' }), model.id)
  await button('编辑').trigger('click'); await flushPromises()
  wrapper.find('.ai-model-picker').findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', 'private-unlisted')
  await flushPromises(); await button('保存服务').trigger('click'); await flushPromises()
  expect(ai.save).toHaveBeenLastCalledWith('MODEL', expect.objectContaining({ model: 'private-unlisted' }), model.id)
})

it('地址或凭据改变后丢弃迟到的列表，避免旧服务覆盖当前选择', async () => {
  let resolve!: (result: ModelDiscoveryResult) => void
  vi.mocked(ai.discoverModels).mockReturnValueOnce(new Promise(done => { resolve = done }))
  await page(); await button('编辑').trigger('click'); await flushPromises()
  await button('获取模型列表').trigger('click'); await flushPromises()
  await wrapper.get('input[aria-label="服务地址"]').setValue('https://other.test/v1')
  await wrapper.get('input[type="password"]').setValue('new-key')
  resolve({ items: [{ id: 'stale-model', name: '旧服务模型' }], truncated: false }); await flushPromises()
  expect(wrapper.text()).not.toContain('已获取 1 个模型')
  expect(wrapper.find('.ai-model-picker').findAllComponents({ name: 'ElOption' }).map((option: VueWrapper) => (option.props() as { value: string }).value)).not.toContain('stale-model')
  expect(wrapper.find('.ai-model-picker').findComponent({ name: 'ElSelect' }).props('modelValue')).toBe('fixture')
})

it('列表不支持时明确提示并保留手填及保存功能', async () => {
  vi.mocked(ai.discoverModels).mockRejectedValueOnce(new Error('服务未提供模型列表'))
  await page(); await button('编辑').trigger('click'); await flushPromises()
  await button('获取模型列表').trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('服务未提供模型列表')
  expect(wrapper.text()).toContain('也可手动输入模型 ID')
  await button('保存服务').trigger('click'); await flushPromises()
  expect(ai.save).toHaveBeenCalledWith('MODEL', expect.objectContaining({ model: 'fixture' }), model.id)
})

it('空列表不捏造候选，关闭编辑器后迟到结果不进入下一次编辑', async () => {
  vi.mocked(ai.discoverModels).mockResolvedValueOnce({ items: [], truncated: false })
  await page(); await button('编辑').trigger('click'); await flushPromises()
  await button('获取模型列表').trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('服务未返回可选模型')
  let resolve!: (result: ModelDiscoveryResult) => void
  vi.mocked(ai.discoverModels).mockReturnValueOnce(new Promise(done => { resolve = done }))
  await button('获取模型列表').trigger('click'); await flushPromises()
  await button('取消').trigger('click'); await flushPromises()
  resolve({ items: [{ id: 'closed-model', name: '迟到模型' }], truncated: false }); await flushPromises()
  await button('编辑').trigger('click'); await flushPromises()
  expect(wrapper.text()).not.toContain('已获取 1 个模型')
  expect(wrapper.find('.ai-model-picker').findAllComponents({ name: 'ElOption' }).map((option: VueWrapper) => (option.props() as { value: string }).value)).not.toContain('closed-model')
})
