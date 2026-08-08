import type { AIProvider } from '../types/ai'
import type { AssembleContextSourceEvidence } from '../registry/types'
import type { AgentContextPolicy } from './context-policy'
import type { WorkspaceScope } from '../types/world-ownership'

export type AgentToolRisk = 'read' | 'generate' | 'write'

export interface AgentToolExecutionContext {
  projectId: number
  scope?: WorkspaceScope
  /**
   * 当前工作区选中的世界。多世界项目必须显式传；单世界项目会归一为 null。
   * 工具参数不能覆盖这个值。
   */
  worldGroupId?: number | null
  provider?: AIProvider
  model?: string
  /** 只由宿主编排层注入；模型工具参数不能覆盖。 */
  contextPolicy?: AgentContextPolicy
}

export interface AgentToolJsonSchema {
  type: 'object'
  properties: Record<string, {
    type: 'string' | 'integer' | 'array'
    description?: string
    minimum?: number
    maximum?: number
    minLength?: number
    maxLength?: number
    enum?: readonly string[]
    items?: { type: 'string'; enum?: readonly string[] }
  }>
  required?: readonly string[]
  additionalProperties: false
}

export interface AgentToolResult {
  ok: boolean
  content: string
  error?: string
  meta: {
    toolName: string
    sourceKeys: readonly string[]
    included: string[]
    omitted: string[]
    trimmed: string[]
    sourceEvidence?: AssembleContextSourceEvidence[]
    totalInputTokens: number
    inputBudget: number
    overBudgetBeforeTrim: boolean
    overBudgetAfterTrim: boolean
  }
}

export interface AgentToolDefinition {
  name: string
  description: string
  risk: AgentToolRisk
  parameters: AgentToolJsonSchema
  sourceKeys: readonly string[]
  inputBudgetTokens: number
  execute: (
    context: AgentToolExecutionContext,
    args: Record<string, unknown>,
  ) => Promise<AgentToolResult>
}
