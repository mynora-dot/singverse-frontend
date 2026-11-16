import { authRequest } from '../../core/auth/api'
import type { AssistantStatus, Conversation, Detail, Run, ToolDefinition } from './types'
const root = '/api/v1/ai/assistant'
const part = encodeURIComponent
export const assistantApi = {
  status: () => authRequest<AssistantStatus>(`${root}/status`),
  tools: () => authRequest<ToolDefinition[]>(`${root}/tools`),
  conversations: () => authRequest<Conversation[]>(`${root}/conversations`),
  create: (title = '') => authRequest<Conversation>(`${root}/conversations`, 'POST', { title }),
  detail: (id: string) => authRequest<Detail>(`${root}/conversations/${part(id)}`),
  remove: (id: string) => authRequest(`${root}/conversations/${part(id)}`, 'DELETE'),
  submit: (id: string, requestId: string, content: string) => authRequest<Run>(`${root}/conversations/${part(id)}/messages`, 'POST', { requestId, content }),
  stop: (id: string) => authRequest(`${root}/runs/${part(id)}/stop`, 'POST'),
  decide: (run: string, id: string, requestId: string, revision: string, approve: boolean) => authRequest<Run>(`${root}/runs/${part(run)}/operations/${part(id)}/decision`, 'POST', { requestId, revision, approve }, 30000),
  eventsUrl: (id: string, after: number) => `${root}/runs/${part(id)}/events?after=${after}`,
  reconcile: (run: string, id: string) => authRequest<{ state: string; evidence?: unknown; page: string; message?: string }>(`${root}/runs/${part(run)}/operations/${part(id)}/reconcile`),
}
