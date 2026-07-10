import { nanoid } from 'nanoid'
import {
  type AgentEvent,
  type NewAgentEvent,
  isTerminalAgentEvent,
} from './agent-events'

type FreezableObject = Record<PropertyKey, unknown>

function isFreezableObject(value: unknown): value is FreezableObject {
  return typeof value === 'object' && value !== null
}

function cloneEvent<Event>(event: Event): Event {
  return structuredClone(event)
}

function deepFreeze<Event>(event: Event): Event {
  if (!isFreezableObject(event) || Object.isFrozen(event)) {
    return event
  }

  for (const key of Reflect.ownKeys(event)) {
    deepFreeze(event[key])
  }

  return Object.freeze(event) as Event
}

export class InMemoryAgentEventLog {
  private readonly eventsByRunId = new Map<string, readonly AgentEvent[]>()

  append(input: NewAgentEvent): AgentEvent {
    const existingEvents = this.eventsByRunId.get(input.runId) ?? []

    if (existingEvents.some(isTerminalAgentEvent)) {
      throw new Error(`[agent-events] ${input.runId} is already terminal`)
    }

    this.assertToolTransition(input, existingEvents)
    this.assertApprovalTransition(input, existingEvents)

    const event = deepFreeze({
      ...cloneEvent(input),
      id: nanoid(),
      sequence: existingEvents.length + 1,
      timestamp: Date.now(),
    } as AgentEvent)

    this.eventsByRunId.set(input.runId, [...existingEvents, event])

    return cloneEvent(event)
  }

  list(runId: string): AgentEvent[] {
    return (this.eventsByRunId.get(runId) ?? []).map(event => cloneEvent(event))
  }

  private assertToolTransition(input: NewAgentEvent, existingEvents: readonly AgentEvent[]): void {
    if (input.type !== 'tool.completed' && input.type !== 'tool.failed') {
      return
    }

    const { toolCallId } = input.payload
    const hasStarted = existingEvents.some(event => event.type === 'tool.started'
      && event.payload.toolCallId === toolCallId)

    if (!hasStarted) {
      throw new Error(`tool ${toolCallId} has not started`)
    }
  }

  private assertApprovalTransition(input: NewAgentEvent, existingEvents: readonly AgentEvent[]): void {
    if (input.type !== 'approval.resolved') {
      return
    }

    const { approvalId } = input.payload
    const hasRequested = existingEvents.some(event => event.type === 'approval.requested'
      && event.payload.approvalId === approvalId)
    const hasResolved = existingEvents.some(event => event.type === 'approval.resolved'
      && event.payload.approvalId === approvalId)

    if (!hasRequested || hasResolved) {
      throw new Error(`approval ${approvalId} is not pending`)
    }
  }
}
