// @vitest-environment jsdom
import { flushPromises,mount,type VueWrapper } from '@vue/test-utils'
import { beforeEach,afterEach,it,expect,vi } from 'vitest'
import { ElMessageBox } from 'element-plus'
import { createMemoryHistory, createRouter } from 'vue-router'
import PlaylistsView from '../src/admin/modules/playlists/PlaylistsView.vue'
import { playlists } from '../src/admin/modules/playlists/api'
import { ai } from '../src/admin/modules/ai-settings/api/ai'
vi.mock('../src/admin/modules/playlists/api',()=>({playlists:Object.fromEntries(['list','get','save','remove','generate'].map(k=>[k,vi.fn()]))}))
vi.mock('../src/admin/modules/ai-settings/api/ai',()=>({ai:{services:vi.fn()}}))
const song={id:'song-1',title:'真实曲库歌曲',artists:['歌手']}
const playlist={id:'p1',name:'聚会歌单',description:'朋友相聚',count:1,missingCount:0,revision:2,songIds:['song-1'],songs:[song]}
let wrapper:VueWrapper|undefined
beforeEach(()=>{vi.mocked(playlists.list).mockResolvedValue({items:[playlist],totalElements:1});vi.mocked(playlists.get).mockResolvedValue(playlist);vi.mocked(playlists.save).mockResolvedValue({...playlist,revision:3});vi.mocked(ai.services).mockResolvedValue([{id:'m1',name:'已配置模型',enabled:true}] as never);vi.mocked(playlists.generate).mockResolvedValue({name:'AI聚会',description:'来自本地曲库',songIds:['song-1'],songs:[song],candidateCount:1,libraryCount:1});vi.mocked(playlists.remove).mockResolvedValue(undefined)})
afterEach(()=>{wrapper?.unmount();wrapper=undefined;vi.clearAllMocks();vi.restoreAllMocks();document.body.innerHTML=''})
async function page(){wrapper=mount(PlaylistsView,{global:{stubs:{teleport:true,SongPicker:{name:'SongPicker',props:['selectedIds','purpose'],emits:['confirm','selectedSongs','close'],template:'<div />'}}}});await flushPromises()}
it('编辑保存后卡片立即采用服务端名称，重读失败不回退', async () => {
  await page(); await button('编辑歌单').trigger('click'); await flushPromises()
  await wrapper!.get('input[aria-label="歌单名称"]').setValue('用户输入的名称')
  vi.mocked(playlists.save).mockResolvedValue({ ...playlist, name: '服务器确认的名称', revision: 3 })
  let fail!: (reason: Error) => void
  vi.mocked(playlists.list).mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject }))
  await button('保存歌单').trigger('click'); await flushPromises()
  expect(wrapper!.get('.card').text()).toContain('服务器确认的名称')
  fail(new Error('暂时无法重读')); await flushPromises()
  expect(wrapper!.get('.card').text()).toContain('服务器确认的名称')
  expect(wrapper!.text()).toContain('暂时无法重读')
})
function button(text:string){return wrapper!.findAll('button').find(b=>b.text()===text)!}
async function openAI(){await wrapper!.get('.ai-entry').trigger('click');await flushPromises()}
it('首次读取展示骨架，不提前显示空歌单提示', async () => {
  let finish!: (value: { items: typeof playlist[]; totalElements: number }) => void
  vi.mocked(playlists.list).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  await page()
  expect(wrapper!.find('[aria-label="正在读取歌单"]').exists()).toBe(true)
  expect(wrapper!.text()).not.toContain('暂无歌单')
  finish({ items: [playlist], totalElements: 1 }); await flushPromises()
  expect(wrapper!.get('.card').text()).toContain(playlist.name)
})
it('刷新失败保留已有歌单，重新读取成功后更新结果', async () => {
  await page()
  let fail!: (reason: Error) => void
  vi.mocked(playlists.list).mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject }))
  await wrapper!.get('form.playlist-filters').trigger('submit')
  expect(wrapper!.get('.card').text()).toContain(playlist.name)
  expect(wrapper!.text()).toContain('正在刷新歌单')
  fail(new Error('暂时无法连接')); await flushPromises()
  expect(wrapper!.text()).toContain('暂时无法连接')
  expect(wrapper!.get('.card').text()).toContain(playlist.name)
  vi.mocked(playlists.list).mockResolvedValueOnce({ items: [{ ...playlist, name: '更新后的歌单' }], totalElements: 1 })
  await wrapper!.get('form.playlist-filters').trigger('submit'); await flushPromises()
  expect(wrapper!.get('.card').text()).toContain('更新后的歌单')
})
async function submitAI(){await wrapper!.get('form.ai-composer').trigger('submit')}
function prompt(){return wrapper!.findAll('textarea').find(x=>x.attributes('placeholder')?.includes('朋友聚会'))!}
it('空态和未配置模型不阻止手动创建',async()=>{vi.mocked(playlists.list).mockResolvedValue({items:[],totalElements:0});vi.mocked(ai.services).mockResolvedValue([]);await page();expect(wrapper!.text()).toContain('暂无歌单');await button('创建歌单').trigger('click');await flushPromises();expect(wrapper!.text()).toContain('选择歌曲');await openAI();expect(wrapper!.text()).toContain('尚无可用模型')})
it('选择歌曲和排序保存，失败重试保留创建标识',async()=>{await page();await button('创建歌单').trigger('click');await flushPromises();await wrapper!.get('input[aria-label="歌单名称"]').setValue('家庭合唱');await button('选择歌曲').trigger('click');await flushPromises();const picker=wrapper!.findComponent({name:'SongPicker'});expect(picker.props('purpose')).toBe('playlist');picker.vm.$emit('selectedSongs',[{id:song.id,result:{title:song.title,artists:song.artists}},{id:'song-2',result:{title:'第二首',artists:['歌手']}}]);picker.vm.$emit('confirm',['song-1','song-2']);await flushPromises();await wrapper!.get('button[aria-label="下移第1首"]').trigger('click');vi.mocked(playlists.save).mockRejectedValueOnce(new Error('网络中断'));await button('保存歌单').trigger('click');await flushPromises();const first=vi.mocked(playlists.save).mock.calls[0]![0];expect(first.songIds).toEqual(['song-2','song-1']);await button('保存歌单').trigger('click');await flushPromises();expect(vi.mocked(playlists.save).mock.calls[1]![0].requestId).toBe(first.requestId)})
it('AI 只生成预览，放弃保持原值，采用后仍需保存',async()=>{await page();await button('编辑歌单').trigger('click');await flushPromises();await openAI();await prompt().setValue('适合朋友合唱');await submitAI();await flushPromises();expect(playlists.save).not.toHaveBeenCalled();expect(wrapper!.text()).toContain('尚未保存');await button('放弃建议').trigger('click');await flushPromises();expect(wrapper!.get('input[aria-label="歌单名称"]').element).toHaveProperty('value','聚会歌单');await submitAI();await flushPromises();await button('使用建议替换歌单').trigger('click');await flushPromises();expect(wrapper!.get('input[aria-label="歌单名称"]').element).toHaveProperty('value','AI聚会');expect(playlists.save).not.toHaveBeenCalled()})
it('生成中阻止重复请求，失败保留编辑内容',async()=>{await page();await button('编辑歌单').trigger('click');await flushPromises();await openAI();await prompt().setValue('聚会');let reject!:(e:Error)=>void;vi.mocked(playlists.generate).mockReturnValueOnce(new Promise((_,r)=>{reject=r}));await submitAI();await submitAI();expect(playlists.generate).toHaveBeenCalledTimes(1);reject(new Error('模型限流'));await flushPromises();expect(wrapper!.text()).toContain('模型限流');expect(wrapper!.get('input[aria-label="歌单名称"]').element).toHaveProperty('value','聚会歌单')})
it('删除先确认且携带当前版本',async()=>{await page();const confirm=vi.spyOn(ElMessageBox,'confirm').mockRejectedValueOnce('cancel');await button('删除').trigger('click');await flushPromises();expect(playlists.remove).not.toHaveBeenCalled();confirm.mockResolvedValueOnce('confirm' as Awaited<ReturnType<typeof ElMessageBox.confirm>>);await button('删除').trigger('click');await flushPromises();expect(playlists.remove).toHaveBeenCalledWith('p1',2)})
it('排序与搜索通过服务端分页查询，列表使用紧凑条目',async()=>{await page();expect(wrapper!.get('.card-open .cover')).toBeDefined();await wrapper!.get('select[aria-label="歌单排序"]').setValue('SONGS_DESC');await flushPromises();expect(playlists.list).toHaveBeenLastCalledWith('',0,'SONGS_DESC');await wrapper!.get('input[aria-label="搜索歌单"]').setValue('聚会');await wrapper!.get('form.playlist-filters').trigger('submit');await flushPromises();expect(playlists.list).toHaveBeenLastCalledWith('聚会',0,'SONGS_DESC')})

it('未保存歌单保护浏览器关闭与路由离开，继续编辑保留草稿', async () => {
  const router=createRouter({history:createMemoryHistory(),routes:[{path:'/playlists',component:PlaylistsView},{path:'/away',component:{template:'<p>其他页面</p>'}}]})
  await router.push('/playlists')
  wrapper=mount({template:'<RouterView />'},{global:{plugins:[router],stubs:{teleport:true,SongPicker:true}}})
  await flushPromises();await button('编辑歌单').trigger('click');await flushPromises()
  await wrapper.get('input[aria-label="歌单名称"]').setValue('尚未保存的歌单')
  const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  const confirm=vi.spyOn(ElMessageBox,'confirm').mockRejectedValueOnce('cancel')
  await router.push('/away');await flushPromises()
  expect(router.currentRoute.value.path).toBe('/playlists')
  expect(wrapper.get('input[aria-label="歌单名称"]').element).toHaveProperty('value','尚未保存的歌单')
  confirm.mockResolvedValueOnce('confirm' as Awaited<ReturnType<typeof ElMessageBox.confirm>>)
  await router.push('/away');await flushPromises()
  expect(router.currentRoute.value.path).toBe('/away');expect(playlists.save).not.toHaveBeenCalled()
})


it('同名曲目独立移除和撤销，拖拽结果保存为真实歌曲顺序', async () => {
  const second={...song,id:'song-2'}
  vi.mocked(playlists.get).mockResolvedValue({...playlist,count:2,songIds:[song.id,second.id],songs:[song,second]})
  await page();await button('编辑歌单').trigger('click');await flushPromises()
  await wrapper!.get('button[aria-label="移除第1首"]').trigger('click')
  expect(wrapper!.findAll('.editor-song-row')).toHaveLength(1)
  await button('撤销').trigger('click');await flushPromises()
  expect(wrapper!.findAll('.editor-song-row')).toHaveLength(2)
  const rows=wrapper!.findAll('.editor-song-row')
  await rows[0]!.trigger('dragstart',{dataTransfer:{effectAllowed:'',setData:vi.fn()}})
  await rows[1]!.trigger('drop')
  await button('保存歌单').trigger('click');await flushPromises()
  expect(vi.mocked(playlists.save).mock.calls.at(-1)![0].songIds).toEqual(['song-2','song-1'])
})

it('AI 替换后可撤销整个编辑内容，返回歌曲时保留未保存状态', async () => {
  const suggested={id:'ai-song',title:'建议歌曲',artists:['另一位歌手']}
  vi.mocked(playlists.generate).mockResolvedValue({name:'AI新名称',description:'AI新简介',songIds:[suggested.id],songs:[suggested],candidateCount:10,libraryCount:20})
  await page();await button('编辑歌单').trigger('click');await flushPromises();await openAI()
  await prompt().setValue('换个心情');await submitAI();await flushPromises()
  expect(wrapper!.text()).toContain('使用后将替换名称、简介和当前 1 首歌曲，可撤销')
  await button('使用建议替换歌单').trigger('click');await flushPromises()
  expect(wrapper!.get('input[aria-label="歌单名称"]').element).toHaveProperty('value','AI新名称')
  expect(wrapper!.text()).toContain('建议歌曲');expect(playlists.save).not.toHaveBeenCalled()
  await button('撤销').trigger('click');await flushPromises()
  expect(wrapper!.get('input[aria-label="歌单名称"]').element).toHaveProperty('value',playlist.name)
  expect(wrapper!.get('textarea[aria-label="歌单简介"]').element).toHaveProperty('value',playlist.description)
  await button('保存歌单').trigger('click');await flushPromises()
  expect(vi.mocked(playlists.save).mock.calls.at(-1)![0].songIds).toEqual(playlist.songIds)
})

it('AI 配置校验阻止无效推荐首数，返回歌曲保留手动编辑', async () => {
  await page();await button('编辑歌单').trigger('click');await flushPromises()
  await wrapper!.get('input[aria-label="歌单名称"]').setValue('自己起的名称')
  await openAI();await prompt().setValue('朋友聚会')
  await wrapper!.get('input[type="number"]').setValue('51')
  expect(button('生成歌单建议').attributes('disabled')).toBeDefined()
  expect(wrapper!.text()).toContain('推荐首数请输入 1–50 之间的整数')
  await submitAI();expect(playlists.generate).not.toHaveBeenCalled()
  await wrapper!.get('input[type="number"]').setValue('20')
  expect(button('生成歌单建议').attributes('disabled')).toBeUndefined()
  await button('返回歌曲').trigger('click');await flushPromises()
  expect(wrapper!.get('input[aria-label="歌单名称"]').element).toHaveProperty('value','自己起的名称')
  expect(wrapper!.get('.editor-draft').text()).toBe('尚未保存')
})


it('点击歌单卡片只浏览详情和录音版本，明确编辑后才进入表单', async () => {
  vi.mocked(playlists.get).mockResolvedValue({ ...playlist, songs: [{ ...song, album: '慈善演唱会', releaseDate: '2003-01-01', durationMs: 264000, version: 'LIVE', sourceName: 'WebDAV 歌曲', relativePath: '现场/一场游戏一场梦.mkv' }] })
  await page(); await wrapper!.get('.card-open').trigger('click'); await flushPromises()
  expect(wrapper!.find('[aria-label="歌单名称"]').exists()).toBe(false)
  expect(wrapper!.get('[aria-label="歌单歌曲"]').text()).toContain('慈善演唱会 · 2003 · 现场 · 4:24')
  expect(wrapper!.get('[aria-label="歌单歌曲"]').text()).toContain('现场/一场游戏一场梦.mkv')
  expect(playlists.save).not.toHaveBeenCalled()
  const detail=wrapper!.findComponent({ name: 'PlaylistDetailDialog' })
  detail.vm.$emit('edit'); await flushPromises()
  expect(wrapper!.get('input[aria-label="歌单名称"]').element).toHaveProperty('value', playlist.name)
  expect(wrapper!.get('.editor-song-list').text()).toContain('慈善演唱会 · 2003 · 现场 · 4:24')
  expect(playlists.save).not.toHaveBeenCalled()
})
