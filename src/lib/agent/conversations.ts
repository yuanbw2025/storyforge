import { db } from '../db/schema'
import type {
  AgentConversation,
  AgentEvent,
  AgentEventKind,
} from '../types'
import {
  assertRecordInScope,
  readOwnedRows,
  resolveScope,
  scopeTransactionTables,
  stampNewRecord,
} from '../world-engine/scope'
import type { WorkspaceScope } from '../types/world-ownership'
import { hashCanonicalValue } from './run/hash'
import {
  appendPrivilegedAgentRunEventInTransactionV1,
  readVerifiedAgentRunInTransactionV1,
} from './run/event-store'
import { parseAgentRunEventV1 } from './run/event-schema'

export async function getOrCreateAgentConversation(input: {
  projectId: number
  worldGroupId: number | null
  purpose?: string
  title?: string
  scope?: WorkspaceScope
}): Promise<AgentConversation> {
  const scope = input.scope ?? await resolveScope({ projectId: input.projectId })
  const purpose = input.purpose?.trim() || undefined
  const rows = await readOwnedRows<AgentConversation>(scope, 'agentConversations', { owner: 'work' })
  const current = rows
    .filter(row => (
      row.status === 'active'
      && (row.worldGroupId ?? null) === input.worldGroupId
      && (purpose ? row.purpose === purpose : row.purpose == null)
    ))
    .sort((left, right) => right.updatedAt - left.updatedAt)[0]
  if (current) return current

  const now = Date.now()
  const row = stampNewRecord(scope, 'agentConversations', {
    projectId: input.projectId,
    worldGroupId: input.worldGroupId,
    purpose,
    title: input.title?.trim() || '创作对话',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }, { owner: 'work' }) as AgentConversation
  const id = await db.agentConversations.add(row) as number
  return { ...row, id }
}

export async function readAgentEvents(conversationId: number, scope?: WorkspaceScope): Promise<AgentEvent[]> {
  const conversation = await db.agentConversations.get(conversationId)
  if (!conversation) return []
  const resolved = scope ?? await resolveScope({ projectId: conversation.projectId })
  if (!await assertRecordInScope(resolved, 'agentConversations', conversation, { owner: 'work' })) return []
  const events = await db.agentEvents
    .where('conversationId')
    .equals(conversationId)
    .sortBy('sequence')
  const owned: AgentEvent[] = []
  for (const event of events) {
    if (await assertRecordInScope(resolved, 'agentEvents', event, { owner: 'work' })) owned.push(event)
  }
  return owned
}

export async function appendAgentEvent(input: {
  projectId: number
  conversationId: number
  kind: AgentEventKind
  role?: AgentEvent['role']
  content: string
  payload?: unknown
  scope?: WorkspaceScope
}): Promise<AgentEvent> {
  const scope = input.scope ?? await resolveScope({ projectId: input.projectId })
  return db.transaction('rw', db.agentConversations, db.agentEvents, async () => {
    const conversation = await db.agentConversations.get(input.conversationId)
    if (!conversation || !await assertRecordInScope(scope, 'agentConversations', conversation, { owner: 'work' })) {
      throw new Error('Agent 对话不存在或不属于当前 scope。')
    }
    const candidates = await db.agentEvents
      .where('conversationId')
      .equals(input.conversationId)
      .toArray()
    const existing: AgentEvent[] = []
    for (const event of candidates) {
      if (await assertRecordInScope(scope, 'agentEvents', event, { owner: 'work' })) existing.push(event)
    }
    const sequence = existing.reduce((max, event) => Math.max(max, event.sequence), 0) + 1
    const createdAt = Date.now()
    const event = stampNewRecord(scope, 'agentEvents', {
      projectId: input.projectId,
      conversationId: input.conversationId,
      sequence,
      kind: input.kind,
      role: input.role,
      content: input.content,
      payload: JSON.stringify(input.payload ?? {}),
      createdAt,
    }, { owner: 'work' }) as AgentEvent
    const id = await db.agentEvents.add(event) as number
    await db.agentConversations.update(input.conversationId, {
      updatedAt: createdAt,
      ...(conversation.title === '创作对话' && input.role === 'user'
        ? { title: input.content.trim().slice(0, 40) || conversation.title }
        : {}),
    })
    return { ...event, id }
  })
}

export async function updateAgentEventCandidate(
  eventId: number,
  projectId: number,
  content: string,
  scope?: WorkspaceScope,
): Promise<void> {
  const event = await db.agentEvents.get(eventId)
  const resolved = scope ?? await resolveScope({ projectId })
  if (!event || !await assertRecordInScope(resolved, 'agentEvents', event, { owner: 'work' }) || event.kind !== 'candidate') {
    throw new Error('待更新的 Agent 候选不存在。')
  }
  let payload: Record<string, unknown> | null = null
  try {
    const parsed = JSON.parse(event.payload) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      payload = parsed as Record<string, unknown>
    }
  } catch {
    payload = null
  }

  // Legacy conversational candidates have no durable run binding and keep
  // their original lightweight update semantics. Durable candidates append an
  // event-store revision so the edited draft remains hash-bound and recoverable.
  if (
    payload
    && typeof payload.runId === 'number'
    && typeof payload.runStepId === 'string'
    && typeof payload.candidateHash === 'string'
  ) {
    const previousCandidateHash = payload.candidateHash
    const { candidateHash: _oldHash, ...withoutHash } = payload
    const candidateHash = await hashCanonicalValue({
      draft: content,
      payload: withoutHash,
    })
    const nextPayload = JSON.stringify({ ...payload, candidateHash })
    await db.transaction(
      'rw',
      scopeTransactionTables(db.agentEvents, db.agentRuns, db.agentRunEvents),
      async () => {
        const snapshot = await readVerifiedAgentRunInTransactionV1(resolved, payload!.runId as number)
        const step = snapshot.projection.steps[payload!.runStepId as string]
        if (!step || step.status !== 'awaiting_confirmation' || step.candidateHash !== previousCandidateHash) {
          throw new Error('待更新的 durable 候选不在等待确认状态。')
        }
        const runEvent = parseAgentRunEventV1({
          version: 1,
          runId: snapshot.run.id,
          sequence: snapshot.projection.lastSequence + 1,
          generation: snapshot.projection.generation,
          projectId: snapshot.run.projectId,
          worldGroupId: snapshot.run.worldGroupId ?? null,
          contractHash: snapshot.run.contractHash,
          type: 'candidate.revised',
          createdAt: Date.now(),
          payload: {
            stepId: payload!.runStepId as string,
            attempt: step.attempt,
            previousCandidateHash,
            candidateHash,
          },
        })
        await appendPrivilegedAgentRunEventInTransactionV1(snapshot, runEvent)
        await db.agentEvents.update(eventId, { content, payload: nextPayload })
      },
    )
    return
  }

  await db.agentEvents.update(eventId, { content })
}
