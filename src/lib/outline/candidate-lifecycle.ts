import {
  appendAgentRunEventV1,
  hashCanonicalValue,
  readAgentRunV1,
  type AgentRunSnapshotV1,
  type GenerationNodeDurableTraceV1,
} from '../agent/run'
import {
  appendAgentEvent,
  readAgentEvents,
} from '../agent/conversations'
import { db } from '../db/schema'
import {
  parseAgentEventPayload,
  type AgentEvent,
  type AgentRunRecord,
  type WorkspaceScope,
} from '../types'
import {
  readOwnedRows,
  resolveScope,
  scopeTransactionTables,
} from '../world-engine/scope'
import {
  decodeGenerationOperation,
  encodeGenerationOperation,
  type OutlineGenerationRequest,
} from './generation-request'

export const OUTLINE_GENERATION_CONVERSATION_PURPOSE = 'outline-generation-v1'
export const OUTLINE_GENERATION_CANDIDATE_PAYLOAD_TYPE = 'outline-generation-candidate'

export interface OutlineGenerationCandidatePayloadV1 {
  version: 1
  type: typeof OUTLINE_GENERATION_CANDIDATE_PAYLOAD_TYPE
  runId: number
  stepId: string
  operation: string
  candidateHash: string
}

export interface OutlineGenerationCandidateV1 extends OutlineGenerationCandidatePayloadV1 {
  projectId: number
  worldGroupId: number | null
  conversationId: number
  candidateEventId: number
  output: string
}

export async function persistOutlineGenerationCandidateV1(input: {
  scope: WorkspaceScope
  conversationId: number
  request: OutlineGenerationRequest
  durable: GenerationNodeDurableTraceV1
  output: string
}): Promise<OutlineGenerationCandidateV1 | null> {
  if (!input.output.trim()) return null
  const candidateHash = await hashCanonicalValue(input.output)
  const operation = encodeGenerationOperation(input.request)
  const payload: OutlineGenerationCandidatePayloadV1 = {
    version: 1,
    type: OUTLINE_GENERATION_CANDIDATE_PAYLOAD_TYPE,
    runId: input.durable.runId,
    stepId: input.durable.stepId,
    operation,
    candidateHash,
  }
  const candidateEvent = await db.transaction(
    'rw',
    scopeTransactionTables(
      db.agentConversations,
      db.agentEvents,
      db.agentRuns,
      db.agentRunEvents,
    ),
    async () => {
      const event = await appendAgentEvent({
        projectId: input.scope.projectId,
        conversationId: input.conversationId,
        kind: 'candidate',
        role: 'assistant',
        content: input.output,
        payload,
        scope: input.scope,
      })
      await input.durable.candidatePersisted(candidateHash, true)
      return event
    },
  )
  if (!candidateEvent.id) throw new Error('大纲候选持久化后缺少事件 ID')
  return {
    ...payload,
    projectId: input.scope.projectId,
    worldGroupId: input.durable.projection().worldGroupId,
    conversationId: input.conversationId,
    candidateEventId: candidateEvent.id,
    output: input.output,
  }
}

function parseOutlineCandidatePayload(event: AgentEvent): OutlineGenerationCandidatePayloadV1 | null {
  const payload = parseAgentEventPayload<Partial<OutlineGenerationCandidatePayloadV1>>(event, {})
  if (
    payload.version !== 1
    || payload.type !== OUTLINE_GENERATION_CANDIDATE_PAYLOAD_TYPE
    || !Number.isInteger(payload.runId)
    || typeof payload.stepId !== 'string'
    || typeof payload.operation !== 'string'
    || !decodeGenerationOperation(payload.operation)
    || payload.stepId !== payload.operation
    || typeof payload.candidateHash !== 'string'
    || !/^[a-f0-9]{64}$/.test(payload.candidateHash)
  ) return null
  return payload as OutlineGenerationCandidatePayloadV1
}

async function resolveOutlineCandidate(input: OutlineGenerationCandidateV1): Promise<{
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
}> {
  const scope = await resolveScope({ projectId: input.projectId })
  const snapshot = await readAgentRunV1(scope, input.runId)
  if (
    snapshot.run.conversationId !== input.conversationId
    || (snapshot.run.worldGroupId ?? null) !== input.worldGroupId
  ) throw new Error('大纲候选与运行 scope 不匹配')
  const event = (await readAgentEvents(input.conversationId, scope))
    .find(row => row.id === input.candidateEventId)
  const payload = event ? parseOutlineCandidatePayload(event) : null
  if (
    !event
    || !payload
    || payload.runId !== input.runId
    || payload.stepId !== input.stepId
    || payload.candidateHash !== input.candidateHash
    || await hashCanonicalValue(event.content) !== input.candidateHash
  ) throw new Error('大纲候选正文或来源证据已损坏')
  return { scope, snapshot }
}

export async function restoreLatestOutlineGenerationCandidateV1(
  projectId: number,
): Promise<OutlineGenerationCandidateV1 | null> {
  const scope = await resolveScope({ projectId })
  const runs = (await readOwnedRows<AgentRunRecord>(scope, 'agentRuns', { owner: 'work' }))
    .filter(run => run.id != null && run.status === 'awaiting_confirmation' && run.conversationId != null)
    .sort((left, right) => right.updatedAt - left.updatedAt)
  for (const run of runs) {
    try {
      const snapshot = await readAgentRunV1(scope, run.id!)
      if (snapshot.projection.state !== 'awaiting_confirmation') continue
      const step = Object.values(snapshot.projection.steps)
        .find(item => item.status === 'awaiting_confirmation' && item.candidateHash)
      if (!step?.candidateHash || run.conversationId == null) continue
      const events = await readAgentEvents(run.conversationId, scope)
      for (const event of [...events].reverse()) {
        if (event.kind !== 'candidate' || event.id == null) continue
        const payload = parseOutlineCandidatePayload(event)
        if (
          !payload
          || payload.runId !== run.id
          || payload.stepId !== step.stepId
          || payload.candidateHash !== step.candidateHash
          || await hashCanonicalValue(event.content) !== payload.candidateHash
        ) continue
        return {
          ...payload,
          projectId,
          worldGroupId: run.worldGroupId ?? null,
          conversationId: run.conversationId,
          candidateEventId: event.id,
          output: event.content,
        }
      }
    } catch {
      // A corrupt or cross-scope ledger must not become a recoverable candidate.
    }
  }
  return null
}

export async function beginOutlineGenerationAdoptionV1(
  candidate: OutlineGenerationCandidateV1,
): Promise<void> {
  const { scope, snapshot } = await resolveOutlineCandidate(candidate)
  const step = snapshot.projection.steps[candidate.stepId]
  if (!step) throw new Error('大纲候选对应步骤不存在')
  const adoptionAlreadyStarted = snapshot.events.some(event => (
    event.type === 'adoption.started'
    && event.payload.stepId === candidate.stepId
    && event.payload.candidateHash === candidate.candidateHash
  ))
  if (step.status === 'running' && step.confirmation === 'adopt' && adoptionAlreadyStarted) return
  if (step.status !== 'awaiting_confirmation') throw new Error('大纲候选当前不等待作者确认')

  await db.transaction(
    'rw',
    scopeTransactionTables(
      db.agentConversations,
      db.agentEvents,
      db.agentRuns,
      db.agentRunEvents,
    ),
    async () => {
      await appendAgentRunEventV1({
        scope,
        runId: candidate.runId,
        type: 'confirmation.recorded',
        payload: {
          stepId: candidate.stepId,
          candidateHash: candidate.candidateHash,
          decision: 'adopt',
        },
      })
      await appendAgentRunEventV1({
        scope,
        runId: candidate.runId,
        type: 'adoption.started',
        payload: { stepId: candidate.stepId, candidateHash: candidate.candidateHash },
      })
      await appendAgentEvent({
        projectId: candidate.projectId,
        conversationId: candidate.conversationId,
        kind: 'confirmation',
        content: '作者已确认采纳大纲候选。',
        payload: {
          version: 1,
          runId: candidate.runId,
          candidateEventId: candidate.candidateEventId,
          decision: 'adopted',
        },
        scope,
      })
    },
  )
}

export async function commitOutlineGenerationAdoptionV1(
  candidate: OutlineGenerationCandidateV1,
  adoptionEvidence: unknown,
): Promise<void> {
  let resolved = await resolveOutlineCandidate(candidate)
  let step = resolved.snapshot.projection.steps[candidate.stepId]
  if (step?.status === 'succeeded' && step.adoptionHash) return
  if (step?.status === 'awaiting_confirmation') {
    await beginOutlineGenerationAdoptionV1(candidate)
    resolved = await resolveOutlineCandidate(candidate)
    step = resolved.snapshot.projection.steps[candidate.stepId]
  }
  if (!step || step.status !== 'running' || step.confirmation !== 'adopt') {
    throw new Error('大纲候选尚未进入可提交采纳状态')
  }
  const adoptionHash = await hashCanonicalValue({
    candidateHash: candidate.candidateHash,
    evidence: adoptionEvidence,
  })
  await db.transaction(
    'rw',
    scopeTransactionTables(db.agentRuns, db.agentRunEvents),
    async () => {
      await appendAgentRunEventV1({
        scope: resolved.scope,
        runId: candidate.runId,
        type: 'adoption.committed',
        payload: {
          stepId: candidate.stepId,
          candidateHash: candidate.candidateHash,
          adoptionHash,
        },
      })
      await appendAgentRunEventV1({
        scope: resolved.scope,
        runId: candidate.runId,
        type: 'step.succeeded',
        payload: {
          stepId: candidate.stepId,
          attempt: 1,
          outputHash: candidate.candidateHash,
        },
      })
    },
  )
}

export async function rejectOutlineGenerationCandidateV1(
  candidate: OutlineGenerationCandidateV1,
  reason: string,
): Promise<void> {
  const { scope, snapshot } = await resolveOutlineCandidate(candidate)
  const step = snapshot.projection.steps[candidate.stepId]
  if (!step || step.status === 'failed' || step.status === 'stale') return
  const content = reason.trim() || '作者未采纳大纲候选。'
  await db.transaction(
    'rw',
    scopeTransactionTables(
      db.agentConversations,
      db.agentEvents,
      db.agentRuns,
      db.agentRunEvents,
    ),
    async () => {
      if (step.status === 'awaiting_confirmation') {
        await appendAgentRunEventV1({
          scope,
          runId: candidate.runId,
          type: 'confirmation.recorded',
          payload: {
            stepId: candidate.stepId,
            candidateHash: candidate.candidateHash,
            decision: 'reject',
          },
        })
      } else if (step.status === 'running' && step.confirmation === 'adopt') {
        await appendAgentRunEventV1({
          scope,
          runId: candidate.runId,
          type: 'adoption.rejected',
          payload: {
            stepId: candidate.stepId,
            candidateHash: candidate.candidateHash,
            code: content.slice(0, 120),
          },
        })
      }
      await appendAgentEvent({
        projectId: candidate.projectId,
        conversationId: candidate.conversationId,
        kind: 'confirmation',
        content,
        payload: {
          version: 1,
          runId: candidate.runId,
          candidateEventId: candidate.candidateEventId,
          decision: 'rejected',
        },
        scope,
      })
    },
  )
}

export async function staleOutlineGenerationCandidateV1(
  candidate: OutlineGenerationCandidateV1,
  reason = '已被新的大纲生成替代',
): Promise<void> {
  const { scope, snapshot } = await resolveOutlineCandidate(candidate)
  const step = snapshot.projection.steps[candidate.stepId]
  if (!step || step.status === 'stale' || step.status === 'failed') return
  if (step.status !== 'awaiting_confirmation') throw new Error('只能标旧等待确认的大纲候选')
  await appendAgentRunEventV1({
    scope,
    runId: candidate.runId,
    type: 'candidate.staled',
    payload: {
      stepId: candidate.stepId,
      candidateHash: candidate.candidateHash,
      reason: reason.trim().slice(0, 200) || 'superseded',
    },
  })
}
