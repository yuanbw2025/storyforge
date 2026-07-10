import type { ProjectLocator } from '../../storage/ports'

export type ToolRisk = 'read' | 'generate' | 'write' | 'destructive' | 'external'
export type ToolAvailability = 'web' | 'desktop' | 'both'
export type ToolScope =
  | 'project:read'
  | 'project:write'
  | 'manuscript:write'
  | 'external:read'
  | 'external:write'

export interface Actor {
  id: string
  kind: 'user' | 'background-agent' | 'system'
}

export interface ApprovalReference {
  approvalId: string
  planHash: string
}

export interface ToolExecutionContext {
  runId: string
  conversationId: string
  sessionId: string
  project: ProjectLocator
  platform: 'web' | 'desktop'
  scopes: ReadonlySet<ToolScope>
  signal: AbortSignal
  actor: Actor
  worldGroupId?: number | null
  outlineNodeId?: number | null
  chapterId?: number | null
  approval?: ApprovalReference
}

export type ExecutionContext = ToolExecutionContext

export interface StoryForgeTool<Input = unknown, Output = unknown> {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly inputSchema: Readonly<Record<string, unknown>>
  readonly risk: ToolRisk
  readonly availability: ToolAvailability
  readonly requiredScopes: readonly ToolScope[]
  execute(context: ToolExecutionContext, input: Input): Promise<Output>
  summarizeInput?(input: Input): string
  summarizeOutput?(output: Output): string
}
