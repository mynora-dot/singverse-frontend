import { computed, reactive } from 'vue'
import { assistantApi } from './api'
import type { AssistantStatus, Conversation, Detail, Operation, RunEvent, ToolDefinition } from './types'

export const assistantState = reactive({
  status: null as AssistantStatus | null, conversations: [] as Conversation[], detail: null as Detail | null,
  tools: [] as ToolDefinition[], events: [] as RunEvent[], selectedRunId: '', loading: false, busy: false,
  error: '', connected: false, draft: '',
})
export const activeRun = computed(() => assistantState.detail?.runs.find(r => r.id === assistantState.detail?.conversation.activeRunId) ?? null)
export const selectedRun = computed(() => assistantState.detail?.runs.find(r => r.id === assistantState.selectedRunId) ?? null)
export const pendingOperations = computed(() => assistantState.detail?.operations.filter(o => o.state === 'PENDING') ?? [])
export const isRunning = computed(() => activeRun.value?.status === 'RUNNING')
let generation = 0, loadGeneration = 0, accountGeneration = 0, source: EventSource | undefined, consumers = 0
let timer: ReturnType<typeof setTimeout> | undefined, poll: ReturnType<typeof setInterval> | undefined
let pendingSend: { conversation: string; content: string; id: string } | undefined
const decisions = new Map<string, { id: string; approve: boolean }>()
const selectedKey = 'singverse.assistant.conversation'
const message = (e: unknown) => e instanceof Error ? e.message : '助手暂时不可用，请重试'
function remember(id: string) { try { if (id) localStorage.setItem(selectedKey, id); else localStorage.removeItem(selectedKey) } catch { /* History is kept on the server. */ } }
function remembered() { try { return localStorage.getItem(selectedKey) ?? '' } catch { return '' } }
function disconnect() { source?.close(); source = undefined; clearTimeout(timer); assistantState.connected = false }

export function useAssistant(preferred?: string) {
  consumers++
  if (consumers === 1) {
    void loadAssistant(preferred)
    poll = setInterval(() => { if (!document.hidden && !assistantState.busy) void refreshConversation() }, 5000)
    window.addEventListener('singverse:session-expired', resetAssistant)
  }
  return () => { consumers = Math.max(0, consumers - 1); if (!consumers) { disconnect(); clearInterval(poll); window.removeEventListener('singverse:session-expired', resetAssistant) } }
}
export function resetAssistant() { generation++; loadGeneration++; accountGeneration++; disconnect(); assistantState.detail = null; assistantState.selectedRunId = ''; assistantState.tools = []; assistantState.events = []; assistantState.conversations = []; assistantState.draft = ''; assistantState.status = null; assistantState.loading = false; assistantState.busy = false; assistantState.error = ''; pendingSend = undefined; decisions.clear() }
export async function loadAssistant(preferred?: string) {
  const token = ++loadGeneration
  assistantState.loading = true; assistantState.error = ''
  try {
    const [status, conversations, tools] = await Promise.all([assistantApi.status(), assistantApi.conversations(), assistantApi.tools()])
    if (token !== loadGeneration) return
    assistantState.status = status; assistantState.conversations = conversations; assistantState.tools = tools
    const id = preferred || assistantState.detail?.conversation.id || remembered()
    const found = conversations.find(c => c.id === id) ?? conversations.find(c => c.activeRunId) ?? conversations[0]
    if (found) await selectConversation(found.id)
  } catch (e) { if (token === loadGeneration) assistantState.error = message(e) }
  finally { if (token === loadGeneration) assistantState.loading = false }
}
export async function selectConversation(id: string) {
  const token = ++generation; disconnect(); assistantState.events = []; assistantState.error = ''
  try {
    const detail = await assistantApi.detail(id); if (token !== generation) return
    assistantState.detail = detail; assistantState.selectedRunId = detail.runs.at(-1)?.id ?? ''; remember(id)
    if (assistantState.selectedRunId) subscribe(assistantState.selectedRunId, token)
  } catch (e) { if (token === generation) assistantState.error = message(e) }
}
export function selectRun(id: string) {
  generation++; disconnect(); assistantState.events = []; assistantState.selectedRunId = id
  if (id) subscribe(id, generation)
}
export async function newConversation() {
  if (assistantState.busy) return
  assistantState.busy = true; assistantState.error = ''
  try { const c = await assistantApi.create(); assistantState.conversations.unshift(c); await selectConversation(c.id); assistantState.draft = '' }
  catch (e) { assistantState.error = message(e) }
  finally { assistantState.busy = false }
}
export async function deleteConversation(id: string) {
  assistantState.busy = true; assistantState.error = ''
  try {
    await assistantApi.remove(id); assistantState.conversations = assistantState.conversations.filter(c => c.id !== id)
    if (assistantState.detail?.conversation.id === id) { generation++; disconnect(); assistantState.detail = null; assistantState.events = []; remember(''); const next = assistantState.conversations[0]; if (next) await selectConversation(next.id) }
  } catch (e) { assistantState.error = message(e) }
  finally { assistantState.busy = false }
}
export async function refreshConversation() {
  const id = assistantState.detail?.conversation.id, token = generation; if (!id) return
  try { const detail = await assistantApi.detail(id); if (token !== generation) return; assistantState.detail = detail
    const latest = detail.runs.at(-1)
    if (latest && latest.id !== assistantState.selectedRunId && detail.conversation.activeRunId === latest.id) selectRun(latest.id)
  } catch (e) { if (token === generation) assistantState.error = message(e) }
}
export async function sendMessage() {
  const content = assistantState.draft.trim(); if (!content || assistantState.busy || activeRun.value) return
  assistantState.busy = true; assistantState.error = ''
  const account = accountGeneration
  try {
    let conversation = assistantState.detail?.conversation.id
    if (!conversation) { const c = await assistantApi.create(content.slice(0, 35)); if (account !== accountGeneration) return; assistantState.conversations.unshift(c); await selectConversation(c.id); conversation = c.id }
    if (pendingSend?.conversation !== conversation || pendingSend.content !== content) pendingSend = { conversation, content, id: crypto.randomUUID() }
    const r = await assistantApi.submit(conversation, pendingSend.id, content)
    if (account !== accountGeneration) return
    pendingSend = undefined; assistantState.draft = ''; await refreshConversation(); selectRun(r.id)
  } catch (e) { assistantState.error = message(e); await refreshConversation() }
  finally { assistantState.busy = false }
}
export async function decideOperation(op: Operation, approve: boolean) {
  if (assistantState.busy) return
  assistantState.busy = true; assistantState.error = ''
  let decision = decisions.get(op.id)
  if (!decision || decision.approve !== approve) { decision = { id: crypto.randomUUID(), approve }; decisions.set(op.id, decision) }
  try { await assistantApi.decide(op.runId, op.id, decision.id, op.revision, approve); await refreshConversation(); subscribe(op.runId, generation) }
  catch (e) { assistantState.error = message(e); await refreshConversation() }
  finally { assistantState.busy = false }
}
export async function stopRun() {
  const run = activeRun.value; if (!run || assistantState.busy) return
  assistantState.busy = true; assistantState.error = ''
  try { await assistantApi.stop(run.id); await refreshConversation() } catch (e) { assistantState.error = message(e) }
  finally { assistantState.busy = false }
}
function subscribe(id: string, token: number) {
  disconnect(); if (!consumers || typeof EventSource === 'undefined') return
  const after = assistantState.events.at(-1)?.sequence ?? 0
  const connection = new EventSource(assistantApi.eventsUrl(id, after), { withCredentials: true }); source = connection
  source.onopen = () => { if (generation === token) assistantState.connected = true }
  source.onmessage = event => {
    if (generation !== token) return
    try {
      const value = JSON.parse(event.data) as RunEvent
      if (value.runId !== id || value.sequence <= (assistantState.events.at(-1)?.sequence ?? 0)) return
      assistantState.events.push(value)
      if (['approval_required', 'operation_result', 'approval_decided', 'run_status'].includes(value.kind)) void refreshConversation()
    } catch { assistantState.error = '事件格式无效，请重新加载会话' }
  }
  source.onerror = () => {
    if (token !== generation || source !== connection) return
    source?.close(); source = undefined; assistantState.connected = false
    void refreshConversation().then(() => { if (token === generation && consumers && activeRun.value?.status === 'RUNNING') timer = setTimeout(() => subscribe(id, token), 2000) })
  }
}
