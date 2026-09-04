export const AGENT_EVENT_KINDS = [
  'message',
  'plan',
  'task',
  'candidate',
  'confirmation',
  'error',
] as const

export type AgentEventKind = typeof AGENT_EVENT_KINDS[number]

export interface AgentConversation {
  id?: number
  projectId: number
  workId?: number | null
  worldGroupId?: number | null
  /** Stable product/workflow-owned channel. */
  purpose: string
  title: string
  status: 'active' | 'archived'
  createdAt: number
  updatedAt: number
}

/**
 * Agent 的可审计追加事件。
 *
 * payload 是版本化 JSON；message 的纯文本仍放 content，避免 UI 为读一句话解析大对象。
 * 候选不是 Canon，只有 confirmation(adopted) 对应的正式 adoption 才能改变业务表。
 */
export interface AgentEvent {
  id?: number
  projectId: number
  workId?: number | null
  conversationId: number
  /** Durable run ownership outside the hash-bound candidate payload; null for author-only messages. */
  durableRunId: number | null
  sequence: number
  kind: AgentEventKind
  role?: 'user' | 'assistant' | 'system'
  content: string
  payload: string
  createdAt: number
}

export function parseAgentEventPayload<T>(
  event: Pick<AgentEvent, 'payload'>,
  fallback: T,
): T {
  try {
    return JSON.parse(event.payload) as T
  } catch {
    return fallback
  }
}
