export interface BaseAgentEvent<Type extends string, Payload> {
  readonly id: string
  readonly type: Type
  readonly runId: string
  readonly conversationId: string
  readonly sequence: number
  readonly timestamp: number
  readonly payload: Readonly<Payload>
}

export type RunStartedAgentEvent = BaseAgentEvent<'run.started', {
  readonly userMessage: string
}>

export type PhaseStartedAgentEvent = BaseAgentEvent<'phase.started', {
  readonly phase: string
  readonly label: string
}>

export type PhaseCompletedAgentEvent = BaseAgentEvent<'phase.completed', {
  readonly phase: string
  readonly summary?: string
}>

export type ReasoningSummaryDeltaAgentEvent = BaseAgentEvent<'reasoning.summary.delta', {
  readonly text: string
}>

export type ReasoningSummaryCompletedAgentEvent = BaseAgentEvent<'reasoning.summary.completed', {
  readonly text: string
}>

export type MessageDeltaAgentEvent = BaseAgentEvent<'message.delta', {
  readonly text: string
}>

export type MessageCompletedAgentEvent = BaseAgentEvent<'message.completed', {
  readonly text: string
}>

export type ToolRequestedAgentEvent = BaseAgentEvent<'tool.requested', {
  readonly toolCallId: string
  readonly toolName: string
  readonly summary: string
}>

export type ToolStartedAgentEvent = BaseAgentEvent<'tool.started', {
  readonly toolCallId: string
  readonly toolName: string
}>

export type ToolProgressAgentEvent = BaseAgentEvent<'tool.progress', {
  readonly toolCallId: string
  readonly message: string
  readonly percent?: number
}>

export type ToolCompletedAgentEvent = BaseAgentEvent<'tool.completed', {
  readonly toolCallId: string
  readonly toolName: string
  readonly summary: string
}>

export type ToolFailedAgentEvent = BaseAgentEvent<'tool.failed', {
  readonly toolCallId: string
  readonly toolName: string
  readonly error: string
}>

export type ApprovalRequestedAgentEvent = BaseAgentEvent<'approval.requested', {
  readonly approvalId: string
  readonly planId: string
  readonly summary: string
}>

export type ApprovalResolvedAgentEvent = BaseAgentEvent<'approval.resolved', {
  readonly approvalId: string
  readonly decision: 'approved' | 'edited' | 'rejected'
}>

export type RunCompletedAgentEvent = BaseAgentEvent<'run.completed', {
  readonly summary: string
}>

export type RunFailedAgentEvent = BaseAgentEvent<'run.failed', {
  readonly error: string
}>

export type RunCancelledAgentEvent = BaseAgentEvent<'run.cancelled', {
  readonly reason?: string
}>

export type AgentEvent =
  | RunStartedAgentEvent
  | PhaseStartedAgentEvent
  | PhaseCompletedAgentEvent
  | ReasoningSummaryDeltaAgentEvent
  | ReasoningSummaryCompletedAgentEvent
  | MessageDeltaAgentEvent
  | MessageCompletedAgentEvent
  | ToolRequestedAgentEvent
  | ToolStartedAgentEvent
  | ToolProgressAgentEvent
  | ToolCompletedAgentEvent
  | ToolFailedAgentEvent
  | ApprovalRequestedAgentEvent
  | ApprovalResolvedAgentEvent
  | RunCompletedAgentEvent
  | RunFailedAgentEvent
  | RunCancelledAgentEvent

export type TerminalAgentEvent =
  | RunCompletedAgentEvent
  | RunFailedAgentEvent
  | RunCancelledAgentEvent

export type NewAgentEvent = AgentEvent extends infer Event
  ? Event extends AgentEvent
    ? Omit<Event, 'id' | 'sequence' | 'timestamp'>
    : never
  : never

export function isTerminalAgentEvent(event: AgentEvent): event is TerminalAgentEvent {
  return event.type === 'run.completed'
    || event.type === 'run.failed'
    || event.type === 'run.cancelled'
}
