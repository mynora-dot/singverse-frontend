// @vitest-environment jsdom
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import ConversationPane from '../src/admin/modules/assistant/components/ConversationPane.vue'
import OperationCard from '../src/admin/modules/assistant/components/OperationCard.vue'
import AssistantTasks from '../src/admin/modules/assistant/components/AssistantTasks.vue'
import { assistantState as state, resetAssistant } from '../src/admin/modules/assistant/state'
import { assistantApi } from '../src/admin/modules/assistant/api'
import { backgroundTasks, type BackgroundTask } from '../src/admin/modules/background-tasks/api'
import type { Operation } from '../src/admin/modules/assistant/types'
vi.mock('../src/admin/modules/assistant/api'); vi.mock('../src/admin/modules/background-tasks/api')
let wrapper: VueWrapper
const run = {id:'r',conversationId:'c',requestId:'request',status:'COMPLETED',modelServiceId:'m',lastSequence:0,error:'',createdAt:'',updatedAt:''}
const detail = () => ({conversation:{id:'c',title:'测试',activeRunId:null as string|null,createdAt:'',updatedAt:''},messages:[],runs:[{...run}],operations:[]})
const global = {stubs:{RouterLink:{props:['to'],template:'<a :href="to"><slot /></a>'}}}
beforeEach(() => {vi.clearAllMocks();resetAssistant();state.detail=detail();state.status={ready:true,message:'',model:'测试模型',toolCount:68,settingsPage:'/system/ai/features/assistant'};vi.mocked(assistantApi.detail).mockResolvedValue(detail());vi.mocked(assistantApi.submit).mockResolvedValue(run)})
afterEach(() => {wrapper?.unmount();resetAssistant();vi.useRealTimers()})
it('中文输入法确认候选不发送，结束输入后的 Enter 才发送',async()=>{
 wrapper=mount(ConversationPane,{global});const input=wrapper.get('textarea');await input.setValue('查询歌曲');await input.trigger('compositionstart');await input.trigger('keydown',{key:'Enter',isComposing:true});expect(assistantApi.submit).not.toHaveBeenCalled();await input.trigger('compositionend');await input.trigger('keydown',{key:'Enter',shiftKey:true});expect(assistantApi.submit).not.toHaveBeenCalled();await input.trigger('keydown',{key:'Enter'});await flushPromises();expect(assistantApi.submit).toHaveBeenCalledWith('c',expect.any(String),'查询歌曲')
})
it('确认卡片展示冻结内容，等待检查点保存期间禁用动作',async()=>{
 state.detail!.conversation.activeRunId='r';state.detail!.runs[0]!.status='RUNNING'
 const op={id:'o',runId:'r',state:'PENDING',revision:'server-revision',preview:{summary:'创建歌单',targets:{songs:[{id:'song',title:'<script>危险</script>'}]},changes:{name:'周末客厅',count:1},impact:'创建共享歌单',page:'/library/playlists'}} as Operation
 wrapper=mount(OperationCard,{props:{operation:op},global});expect(wrapper.text()).toContain('周末客厅');expect(wrapper.find('script').exists()).toBe(false);expect(wrapper.get('button').attributes('disabled')).toBeDefined()
 state.detail!.runs[0]!.status='WAITING';await flushPromises();vi.mocked(assistantApi.decide).mockResolvedValue(run);await wrapper.get('button').trigger('click');await flushPromises();expect(assistantApi.decide).toHaveBeenCalledWith('r','o',expect.any(String),'server-revision',true)
})
it('历史与流式片段只显示一次助手回复',async()=>{
 state.detail!.messages=[{id:'u',conversationId:'c',runId:'r',role:'user',content:'你好',createdAt:''},{id:'a',conversationId:'c',runId:'r',role:'assistant',content:'已找到歌曲',createdAt:''}]
 state.selectedRunId='r';state.events=[{runId:'r',sequence:1,kind:'text_delta',data:{text:'已找到'},createdAt:''},{runId:'r',sequence:2,kind:'text_delta',data:{text:'歌曲'},createdAt:''}]
 wrapper=mount(ConversationPane,{global});expect(wrapper.findAll('.message.assistant')).toHaveLength(1);expect(wrapper.get('.message.assistant').text()).toContain('已找到歌曲')
})
it('业务任务在对话停止后继续刷新，使用真实返回的进度和页面',async()=>{
 vi.useFakeTimers();const task={id:'real-task',name:'下载批次',status:'RUNNING',stage:'DOWNLOADING',progress:{completed:1,total:3,percent:33,unit:'SONGS'},execution:{},statistics:{},relatedPath:'/library/downloads?batch=real-batch',error:'',waitingReason:''} as BackgroundTask
 vi.mocked(backgroundTasks.detail).mockResolvedValueOnce(task).mockResolvedValueOnce({...task,status:'COMPLETED',progress:{...task.progress,completed:3,percent:100}})
 wrapper=mount(AssistantTasks,{props:{ids:['real-task']},global});await flushPromises();expect(wrapper.text()).toContain('1 / 3');state.detail!.runs[0]!.status='STOPPED';await vi.advanceTimersByTimeAsync(5000);await flushPromises();expect(wrapper.text()).toContain('3 / 3');expect(wrapper.get('progress').attributes('value')).toBe('100');expect(wrapper.get('a').attributes('href')).toBe('/library/downloads?batch=real-batch')
})
