export interface AssistantStatus { ready: boolean; message: string; model: string; toolCount: number; settingsPage: string }
export interface Conversation { id: string; title: string; activeRunId: string | null; createdAt: string; updatedAt: string }
export interface Run { id: string; conversationId: string; requestId: string; status: string; modelServiceId: string; lastSequence: number; error: string; createdAt: string; updatedAt: string }
export interface Message { id: string; conversationId: string; runId: string; role: string; content: string; createdAt: string }
export interface Preview { summary: string; targets: unknown; changes: unknown; impact: string; revision: string; page: string }
export interface Operation { id: string; runId: string; toolName: string; state: string; arguments: unknown; preview: Preview; revision: string; result: unknown; error: string; decisionId: string | null; createdAt: string; updatedAt: string }
export interface Detail { conversation: Conversation; messages: Message[]; runs: Run[]; operations: Operation[] }
export interface RunEvent { runId: string; sequence: number; kind: string; data: Record<string, unknown>; createdAt: string }
export interface ToolDefinition { name: string; title: string; group: string; description: string; write: boolean; page: string; inputSchema: unknown }
