import type { ProjectLocator } from '../../storage/ports'
import type { AgentEvent } from '../events/agent-events'

export interface AgentScope {
  worldGroupId?: number | null
  outlineNodeId?: number | null
  chapterId?: number | null
  module?: string
  entityId?: string | number | null
  selection?: { text: string; from?: number; to?: number }
}

export interface AgentRunInput {
  conversationId: string
  project: ProjectLocator
  scope: AgentScope
  userMessage: string
  preferredAgent?: string
  modelProfile?: string
  maxSteps?: number
  tokenBudget?: number
}

export interface ApprovalDecision {
  approvalId: string
  decision: 'approved' | 'edited' | 'rejected'
  editedPlan?: Record<string, unknown>
}

export interface AgentRuntimePort {
  run(input: AgentRunInput): AsyncIterable<AgentEvent>
  resume(runId: string, decision?: ApprovalDecision): AsyncIterable<AgentEvent>
  cancel(runId: string): AsyncIterable<AgentEvent>
}
