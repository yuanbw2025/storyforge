import Dexie from 'dexie'
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
} from '../workspace/scope'
import type { WorkspaceScope } from '../types/world-ownership'
import { hashCanonicalValue } from './run/hash'
import {
  appendPrivilegedAgentRunEventInTransactionV1,
  readVerifiedAgentRunInTransactionV1,
} from './run/event-store'
import { parseAgentRunEventV1 } from './run/event-schema'
import type { MasterCandidatePayload } from './orchestrator'
import { parseCreativeArtifactV1, type CreativeArtifactV1 } from './creative-reliability'
import {
  contextManifestHashForStepAttemptV1,
  createMasterCandidateStepReceiptV1,
} from './run/master-step-verification'
import { computeMasterCandidateHashV1 } from './run/master-candidate-hash'

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

export async function updateAgentEventCandidate(
  eventId: number,
  projectId: number,
  content: string,
  scope?: WorkspaceScope,
  options?: {
    creativeArtifact?: CreativeArtifactV1
    revalidateCreativeArtifact?: (input: {
      creativeArtifact: CreativeArtifactV1
      payload: Readonly<Record<string, unknown>>
    }) => CreativeArtifactV1
    refreshOutputHash?: boolean
  },
): Promise<string | null> {
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
  if (payload && options?.revalidateCreativeArtifact && payload.creativeArtifact) {
    payload = {
      ...payload,
      creativeArtifact: parseCreativeArtifactV1(options.revalidateCreativeArtifact({
        creativeArtifact: parseCreativeArtifactV1(payload.creativeArtifact),
        payload,
      })),
    }
  } else if (payload && options?.creativeArtifact) {
    payload = {
      ...payload,
      creativeArtifact: parseCreativeArtifactV1(options.creativeArtifact),
    }
  }
  if (payload && options?.refreshOutputHash) {
    if (typeof payload.outputHash !== 'string') {
      throw new Error('该候选不支持刷新 outputHash。')
    }
    payload = { ...payload, outputHash: await hashCanonicalValue(content) }
  }

  if (
    !payload
    || typeof payload.runId !== 'number'
    || typeof payload.runStepId !== 'string'
    || typeof payload.candidateHash !== 'string'
    || event.durableRunId !== payload.runId
  ) {
    throw new Error('该候选缺少当前 durable Harness 绑定，不能进入正式修订流程。')
  }
  {
    const previousCandidateHash = payload.candidateHash
    const {
      candidateHash: _oldHash,
      semanticReview: _staleSemanticReview,
      ...withoutHash
    } = payload
    const candidateHash = options?.refreshOutputHash
      ? await hashCanonicalValue({ draft: content, payload: withoutHash })
      : await computeMasterCandidateHashV1(
          withoutHash as unknown as MasterCandidatePayload,
          content,
        )
    const revisedPayload = { ...withoutHash, candidateHash }
    const nextPayload = JSON.stringify(revisedPayload)
    await db.transaction(
      'rw',
      scopeTransactionTables(db.agentEvents, db.agentRuns, db.agentRunEvents),
      async () => {
        const durableRunId = event.durableRunId ?? payload!.runId as number
        let snapshot = await readVerifiedAgentRunInTransactionV1(resolved, durableRunId)
        const stepId = payload!.runStepId as string
        const step = snapshot.projection.steps[stepId]
        if (!step || step.status !== 'awaiting_confirmation' || step.candidateHash !== previousCandidateHash) {
          throw new Error('待更新的 durable 候选不在等待确认状态。')
        }
        if (step.verificationReceiptHash) {
          const staleEvent = parseAgentRunEventV1({
            version: 1,
            runId: snapshot.run.id,
            sequence: snapshot.projection.lastSequence + 1,
            generation: snapshot.projection.generation,
            projectId: snapshot.run.projectId,
            worldGroupId: snapshot.run.worldGroupId ?? null,
            contractHash: snapshot.run.contractHash,
            type: 'step.verification.staled',
            createdAt: Date.now(),
            payload: {
              stepId,
              previousReceiptHash: step.verificationReceiptHash,
              reason: 'author_revised_candidate',
            },
          })
          snapshot = await appendPrivilegedAgentRunEventInTransactionV1(snapshot, staleEvent)
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
            stepId,
            attempt: step.attempt,
            previousCandidateHash,
            candidateHash,
          },
        })
        snapshot = await appendPrivilegedAgentRunEventInTransactionV1(snapshot, runEvent)
        await db.agentEvents.update(eventId, { content, payload: nextPayload })
        const contextManifestHash = contextManifestHashForStepAttemptV1(snapshot, stepId, step.attempt)
        const semanticReviewRequired = snapshot.contract.candidateSemanticReviewPolicy
          ?.taskIds.includes(payload!.taskId as string) === true
        if (
          snapshot.contract.dependencyReceiptPolicy?.requiredForJoin
          && contextManifestHash
          && !semanticReviewRequired
        ) {
          let receipt = null
          try {
            receipt = await Dexie.waitFor(createMasterCandidateStepReceiptV1({
              payload: revisedPayload as unknown as MasterCandidatePayload,
              draft: content,
              attempt: step.attempt,
              contextManifestHash,
              acceptedAt: Date.now(),
              verifierSetVersion: snapshot.contract.dependencyReceiptPolicy.verifierSetVersion,
            }))
          } catch {
            // Invalid author edits remain editable candidates but cannot feed a downstream join.
          }
          if (receipt) {
            const acceptedEvent = parseAgentRunEventV1({
              version: 1,
              runId: snapshot.run.id,
              sequence: snapshot.projection.lastSequence + 1,
              generation: snapshot.projection.generation,
              projectId: snapshot.run.projectId,
              worldGroupId: snapshot.run.worldGroupId ?? null,
              contractHash: snapshot.run.contractHash,
              type: 'step.verification.accepted',
              createdAt: Date.now(),
              payload: { receipt },
            })
            await appendPrivilegedAgentRunEventInTransactionV1(snapshot, acceptedEvent)
          }
        }
      },
    )
    return nextPayload
  }

}
