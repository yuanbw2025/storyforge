import { db } from '../../db/schema'
import type { WorkspaceScope } from '../../types'
import {
  adoptMasterCandidate,
  type ExecutedMasterCandidate,
} from '../orchestrator'
import { appendAgentEvent } from '../conversations'
import { scopeTransactionTables } from '../../world-engine/scope'
import {
  restoreMasterAgentCandidatesV1,
  type MasterAgentDurableCandidateV1,
} from './master-durable'
import {
  appendAgentRunEventV1,
  readAgentRunV1,
  type AgentRunSnapshotV1,
} from './event-store'
import { hashCanonicalValue } from './hash'

export interface MasterAgentCandidateAdoptionRefV1 {
  scope: WorkspaceScope
  runId: number
  candidateEventId: number
  runtime?: ExecutedMasterCandidate
}

export interface MasterAgentCandidateAdoptionResultV1 {
  message: string
  adoptionHash: string
  snapshot: AgentRunSnapshotV1
}

interface ResolvedMasterCandidateV1 {
  snapshot: AgentRunSnapshotV1
  candidate: MasterAgentDurableCandidateV1
  stepId: string
}

export interface MasterAgentAdoptionDependenciesV1 {
  adopt?: typeof adoptMasterCandidate
  afterBusinessAdoption?: () => void | Promise<void>
}

async function resolveCandidate(
  input: MasterAgentCandidateAdoptionRefV1,
): Promise<ResolvedMasterCandidateV1> {
  const restored = await restoreMasterAgentCandidatesV1({ scope: input.scope, runId: input.runId })
  const candidate = restored.candidates.find(item => item.event.id === input.candidateEventId)
  if (!candidate) throw new Error('主 Agent durable 候选不存在、越界或证据已损坏')
  const stepId = candidate.payload.runStepId
  if (!stepId) throw new Error('主 Agent durable 候选缺少 runStepId')
  const step = restored.snapshot.projection.steps[stepId]
  if (!step || step.candidateHash !== candidate.payload.candidateHash) {
    throw new Error('主 Agent durable 候选与 run ledger 不一致')
  }
  if (restored.snapshot.run.conversationId !== candidate.event.conversationId) {
    throw new Error('主 Agent durable 候选与运行对话不一致')
  }
  return { snapshot: restored.snapshot, candidate, stepId }
}

function startedFor(
  snapshot: AgentRunSnapshotV1,
  stepId: string,
  candidateHash: string,
): boolean {
  return snapshot.events.some(event => (
    event.type === 'adoption.started'
    && event.payload.stepId === stepId
    && event.payload.candidateHash === candidateHash
  ))
}

export async function beginMasterAgentCandidateAdoptionV1(
  input: MasterAgentCandidateAdoptionRefV1,
): Promise<ResolvedMasterCandidateV1> {
  const resolved = await resolveCandidate(input)
  const candidateHash = resolved.candidate.payload.candidateHash!
  const step = resolved.snapshot.projection.steps[resolved.stepId]
  if (
    step.status === 'running'
    && step.confirmation === 'adopt'
    && startedFor(resolved.snapshot, resolved.stepId, candidateHash)
  ) return resolved
  if (step.status === 'succeeded' && step.adoptionHash) return resolved
  if (step.status !== 'awaiting_confirmation') {
    throw new Error(`主 Agent durable 候选当前状态 ${step.status} 不等待作者确认`)
  }
  const conversationId = resolved.snapshot.run.conversationId
  if (conversationId == null) throw new Error('主 Agent durable run 缺少候选对话')
  const intentHash = await hashCanonicalValue({
    version: 1,
    kind: 'master-agent-adoption',
    candidateHash,
    taskId: resolved.candidate.payload.taskId,
  })
  await db.transaction(
    'rw',
    scopeTransactionTables(db.agentConversations, db.agentEvents, db.agentRuns, db.agentRunEvents),
    async () => {
      let snapshot = await appendAgentRunEventV1({
        scope: input.scope,
        runId: input.runId,
        type: 'confirmation.recorded',
        payload: {
          stepId: resolved.stepId,
          candidateHash,
          decision: 'adopt',
        },
        expectedLastSequence: resolved.snapshot.projection.lastSequence,
      })
      await appendAgentRunEventV1({
        scope: input.scope,
        runId: input.runId,
        type: 'adoption.started',
        payload: {
          stepId: resolved.stepId,
          candidateHash,
          intentHash,
        },
        expectedLastSequence: snapshot.projection.lastSequence,
      })
      await appendAgentEvent({
        projectId: input.scope.projectId,
        conversationId,
        kind: 'confirmation',
        content: '作者已确认采纳领域 Agent 候选。',
        payload: {
          version: 1,
          runId: input.runId,
          candidateEventId: input.candidateEventId,
          decision: 'adopted',
        },
        scope: input.scope,
      })
    },
  )
  return resolveCandidate(input)
}

export async function commitMasterAgentCandidateAdoptionV1(
  input: MasterAgentCandidateAdoptionRefV1,
  dependencies: MasterAgentAdoptionDependenciesV1 = {},
): Promise<MasterAgentCandidateAdoptionResultV1> {
  let resolved = await resolveCandidate(input)
  let step = resolved.snapshot.projection.steps[resolved.stepId]
  if (step.status === 'succeeded' && step.adoptionHash) {
    return {
      message: '候选已经完成采纳。',
      adoptionHash: step.adoptionHash,
      snapshot: resolved.snapshot,
    }
  }
  if (step.status === 'awaiting_confirmation') {
    resolved = await beginMasterAgentCandidateAdoptionV1(input)
    step = resolved.snapshot.projection.steps[resolved.stepId]
  }
  if (
    step.status !== 'running'
    || step.confirmation !== 'adopt'
    || !startedFor(resolved.snapshot, resolved.stepId, resolved.candidate.payload.candidateHash!)
  ) throw new Error('主 Agent durable 候选尚未进入可提交采纳状态')

  const adopt = dependencies.adopt ?? adoptMasterCandidate
  const message = await adopt({
    projectId: input.scope.projectId,
    scope: input.scope,
    worldGroupId: resolved.snapshot.run.worldGroupId ?? null,
    event: resolved.candidate.event,
    payload: resolved.candidate.payload,
    draft: resolved.candidate.draft,
    runtime: input.runtime,
  })
  await dependencies.afterBusinessAdoption?.()
  const adoptionHash = await hashCanonicalValue({
    version: 1,
    candidateHash: resolved.candidate.payload.candidateHash,
    evidence: {
      agentId: resolved.candidate.payload.agentId,
      candidateEventId: input.candidateEventId,
      message,
    },
  })
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  step = snapshot.projection.steps[resolved.stepId]
  await db.transaction(
    'rw',
    scopeTransactionTables(db.agentRuns, db.agentRunEvents),
    async () => {
      snapshot = await appendAgentRunEventV1({
        scope: input.scope,
        runId: input.runId,
        type: 'adoption.committed',
        payload: {
          stepId: resolved.stepId,
          candidateHash: resolved.candidate.payload.candidateHash!,
          adoptionHash,
        },
        expectedLastSequence: snapshot.projection.lastSequence,
      })
      snapshot = await appendAgentRunEventV1({
        scope: input.scope,
        runId: input.runId,
        type: 'step.succeeded',
        payload: {
          stepId: resolved.stepId,
          attempt: step.attempt,
          outputHash: resolved.candidate.payload.candidateHash!,
        },
        expectedLastSequence: snapshot.projection.lastSequence,
      })
    },
  )
  return { message, adoptionHash, snapshot }
}

export async function rejectMasterAgentCandidateV1(
  input: MasterAgentCandidateAdoptionRefV1,
  reason = '作者拒绝了领域 Agent 候选，没有写入项目。',
): Promise<AgentRunSnapshotV1> {
  const resolved = await resolveCandidate(input)
  const step = resolved.snapshot.projection.steps[resolved.stepId]
  if (step.status === 'failed' && step.confirmation === 'reject') return resolved.snapshot
  if (step.status !== 'awaiting_confirmation') {
    throw new Error(`主 Agent durable 候选当前状态 ${step.status} 不能拒绝`)
  }
  const conversationId = resolved.snapshot.run.conversationId
  if (conversationId == null) throw new Error('主 Agent durable run 缺少候选对话')
  let snapshot = resolved.snapshot
  await db.transaction(
    'rw',
    scopeTransactionTables(db.agentConversations, db.agentEvents, db.agentRuns, db.agentRunEvents),
    async () => {
      snapshot = await appendAgentRunEventV1({
        scope: input.scope,
        runId: input.runId,
        type: 'confirmation.recorded',
        payload: {
          stepId: resolved.stepId,
          candidateHash: resolved.candidate.payload.candidateHash!,
          decision: 'reject',
        },
        expectedLastSequence: snapshot.projection.lastSequence,
      })
      await appendAgentEvent({
        projectId: input.scope.projectId,
        conversationId,
        kind: 'confirmation',
        content: reason.trim().slice(0, 1_000) || '作者拒绝了领域 Agent 候选。',
        payload: {
          version: 1,
          runId: input.runId,
          candidateEventId: input.candidateEventId,
          decision: 'rejected',
        },
        scope: input.scope,
      })
    },
  )
  return snapshot
}
