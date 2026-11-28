import { db } from '../db/schema'
import type { AgentConversation, AgentEvent, AgentEventKind, WorkspaceScope } from '../types'
import { assertRecordInScope, readOwnedRows, resolveScope, scopeTransactionTables, stampNewRecord } from '../workspace/scope'

// Original conversation owner/append writer, kept free of Master/registry
// initialization so domain draft channels can reuse it without a module cycle.
export async function getOrCreateAgentConversation(input: {
  projectId: number
  worldGroupId: number | null
  purpose: string
  title?: string
  scope?: WorkspaceScope
}): Promise<AgentConversation> {
  const scope = input.scope ?? await resolveScope({ projectId: input.projectId })
  const purpose = input.purpose.trim()
  if (!purpose) throw new Error('Agent 对话必须声明稳定 purpose。')
  return db.transaction('rw', scopeTransactionTables(db.agentConversations), async () => {
    // React StrictMode and fast repeated clicks may request the same durable
    // conversation concurrently. Serialize the lookup/create pair so one
    // purpose cannot split into parallel ledgers.
    const rows = await readOwnedRows<AgentConversation>(scope, 'agentConversations', { owner: 'work' })
    const current = rows
      .filter(row => (
        row.status === 'active'
        && (row.worldGroupId ?? null) === input.worldGroupId
        && row.purpose === purpose
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
  })
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
  const ownership = await Promise.all(events.map(event => (
    assertRecordInScope(resolved, 'agentEvents', event, { owner: 'work' })
  )))
  return events.filter((_, index) => ownership[index])
}

export async function appendAgentEvent(input: {
  projectId: number
  conversationId: number
  durableRunId?: number | null
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
    // A long conversation can contain hundreds of direct-owner rows. Validate
    // them under one global Promise.all so the surrounding IndexedDB
    // transaction cannot auto-commit between synchronous ownership checks.
    const ownership = await Promise.all(candidates.map(event => (
      assertRecordInScope(scope, 'agentEvents', event, { owner: 'work' })
    )))
    const existing = candidates.filter((_, index) => ownership[index])
    const sequence = existing.reduce((max, event) => Math.max(max, event.sequence), 0) + 1
    const createdAt = Date.now()
    const event = stampNewRecord(scope, 'agentEvents', {
      projectId: input.projectId,
      conversationId: input.conversationId,
      durableRunId: input.durableRunId ?? null,
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

