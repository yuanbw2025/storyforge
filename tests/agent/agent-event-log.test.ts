import { describe, expect, it } from 'vitest'
import { isTerminalAgentEvent } from '../../src/lib/agent/events/agent-events'
import { InMemoryAgentEventLog } from '../../src/lib/agent/events/in-memory-agent-event-log'

const runId = 'run-1'
const conversationId = 'conversation-1'

describe('InMemoryAgentEventLog', () => {
  it('generates non-empty ids, increments per-run sequence, and lists events in order', () => {
    const log = new InMemoryAgentEventLog()

    const first = log.append({
      type: 'run.started',
      runId,
      conversationId,
      payload: { userMessage: 'Start writing' },
    })
    const second = log.append({
      type: 'phase.started',
      runId,
      conversationId,
      payload: { phase: 'planning', label: 'Planning' },
    })

    expect(typeof first.id).toBe('string')
    expect(first.id.length).toBeGreaterThan(0)
    expect(typeof second.id).toBe('string')
    expect(second.id.length).toBeGreaterThan(0)
    expect(first.sequence).toBe(1)
    expect(second.sequence).toBe(2)
    expect(log.list(runId).map(event => event.id)).toEqual([first.id, second.id])
  })

  it('rejects tool.completed when the tool call has not started', () => {
    const log = new InMemoryAgentEventLog()

    expect(() => log.append({
      type: 'tool.completed',
      runId,
      conversationId,
      payload: { toolCallId: 'tool-1', toolName: 'search', summary: 'done' },
    })).toThrow('tool tool-1 has not started')
  })

  it('rejects approval.resolved when approval is not pending or was already resolved', () => {
    const log = new InMemoryAgentEventLog()

    expect(() => log.append({
      type: 'approval.resolved',
      runId,
      conversationId,
      payload: { approvalId: 'approval-1', decision: 'approved' },
    })).toThrow('approval approval-1 is not pending')

    log.append({
      type: 'approval.requested',
      runId,
      conversationId,
      payload: { approvalId: 'approval-1', planId: 'plan-1', summary: 'Approve plan' },
    })
    log.append({
      type: 'approval.resolved',
      runId,
      conversationId,
      payload: { approvalId: 'approval-1', decision: 'approved' },
    })

    expect(() => log.append({
      type: 'approval.resolved',
      runId,
      conversationId,
      payload: { approvalId: 'approval-1', decision: 'rejected' },
    })).toThrow('approval approval-1 is not pending')
  })

  it('rejects appends after a run enters a terminal state', () => {
    const log = new InMemoryAgentEventLog()

    const terminal = log.append({
      type: 'run.completed',
      runId,
      conversationId,
      payload: { summary: 'Finished' },
    })

    expect(isTerminalAgentEvent(terminal)).toBe(true)
    expect(() => log.append({
      type: 'phase.started',
      runId,
      conversationId,
      payload: { phase: 'finalize', label: 'Finalize' },
    })).toThrow('[agent-events] run-1 is already terminal')
  })

  it('does not let append input mutation or list output mutation pollute stored events', () => {
    const log = new InMemoryAgentEventLog()
    const input = {
      type: 'message.completed' as const,
      runId,
      conversationId,
      payload: { text: 'original' },
    }

    const appended = log.append(input)
    input.payload.text = 'mutated input'

    expect(appended.payload.text).toBe('original')
    expect(log.list(runId)[0].payload.text).toBe('original')

    const listed = log.list(runId)
    const listedPayload = listed[0].payload as { text: string }
    listedPayload.text = 'mutated list output'

    expect(log.list(runId)[0].payload.text).toBe('original')
  })

  it('allows valid tool started-to-completed and approval requested-to-resolved transitions', () => {
    const log = new InMemoryAgentEventLog()

    log.append({
      type: 'tool.started',
      runId,
      conversationId,
      payload: { toolCallId: 'tool-1', toolName: 'search' },
    })
    log.append({
      type: 'tool.completed',
      runId,
      conversationId,
      payload: { toolCallId: 'tool-1', toolName: 'search', summary: 'Found results' },
    })
    log.append({
      type: 'approval.requested',
      runId,
      conversationId,
      payload: { approvalId: 'approval-1', planId: 'plan-1', summary: 'Approve plan' },
    })
    log.append({
      type: 'approval.resolved',
      runId,
      conversationId,
      payload: { approvalId: 'approval-1', decision: 'edited' },
    })

    expect(log.list(runId).map(event => event.type)).toEqual([
      'tool.started',
      'tool.completed',
      'approval.requested',
      'approval.resolved',
    ])
  })
})
