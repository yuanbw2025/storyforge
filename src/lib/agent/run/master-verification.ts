import { db } from '../../db/schema'
import type {
  AnyAgentRunEventV1,
  VerificationReceiptV1,
  WorkspaceScope,
} from '../../types'
import {
  appendAgentRunEventV1,
  readAgentRunV1,
} from './event-store'
import {
  restoreMasterAgentCandidatesV1,
  type MasterAgentDurableCandidateV1,
} from './master-durable'
import {
  isMasterAgentCandidateBusinessStateMatchingV1,
  type MasterAgentCandidateAdoptionRefV1,
} from './master-adoption'
import { createVerificationReceiptV1 } from './verification-receipt'
import { hashCanonicalValue } from './hash'

export const MASTER_AGENT_VERIFIER_SET_VERSION_V1 = 'master-terminal-v1'

export interface MasterAgentVerificationResultV1 {
  accepted: boolean
  codes: string[]
  snapshot: Awaited<ReturnType<typeof readAgentRunV1>>
  receipt?: VerificationReceiptV1
}

interface AdoptionRecordV1 {
  id: number
  stepId: string
  candidateHash: string
}

function isContextAssembledEvent(
  event: AnyAgentRunEventV1,
): event is Extract<AnyAgentRunEventV1, { type: 'context.assembled' }> {
  return event.type === 'context.assembled'
}

function parseEventPayload(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

async function adoptionRecords(
  runId: number,
): Promise<AdoptionRecordV1[]> {
  const rows = await db.agentRunEvents.where('runId').equals(runId).toArray()
  return rows
    .filter(row => row.id != null && row.type === 'adoption.committed')
    .map(row => {
      const payload = parseEventPayload(row.payloadJson)
      return {
        id: row.id!,
        stepId: typeof payload?.stepId === 'string' ? payload.stepId : '',
        candidateHash: typeof payload?.candidateHash === 'string' ? payload.candidateHash : '',
      }
    })
    .filter(row => row.stepId.length > 0 && row.candidateHash.length > 0)
}

function evidenceForCriterion(
  kind: string,
  candidate: MasterAgentDurableCandidateV1,
  snapshot: Awaited<ReturnType<typeof readAgentRunV1>>,
  adoption: AdoptionRecordV1,
  postStateHash: string,
): string[] {
  if (kind === 'output-present') return [`candidate:${candidate.event.id ?? candidate.payload.candidateHash}`]
  if (kind === 'author-confirmed') {
    const event = snapshot.events.find(item => (
      item.type === 'confirmation.recorded'
      && item.payload.stepId === candidate.payload.runStepId
      && item.payload.candidateHash === candidate.payload.candidateHash
    ))
    return event ? [`run-event:${event.sequence}`] : [`candidate:${candidate.payload.candidateHash}`]
  }
  if (kind === 'adoption-committed') return [`event:${adoption.id}`]
  return [`post-state:${postStateHash}`]
}

async function rejectTerminalVerification(
  scope: WorkspaceScope,
  runId: number,
  snapshot: Awaited<ReturnType<typeof readAgentRunV1>>,
  codes: string[],
  now: number,
): Promise<MasterAgentVerificationResultV1> {
  let next = await appendAgentRunEventV1({
    scope,
    runId,
    type: 'verification.started',
    payload: { verifierSetVersion: MASTER_AGENT_VERIFIER_SET_VERSION_V1 },
    expectedLastSequence: snapshot.projection.lastSequence,
    now,
  })
  next = await appendAgentRunEventV1({
    scope,
    runId,
    type: 'verification.rejected',
    payload: { codes: [...new Set(codes)], retryable: false },
    expectedLastSequence: next.projection.lastSequence,
    now,
  })
  return { accepted: false, codes: [...new Set(codes)], snapshot: next }
}

/**
 * Performs the deterministic terminal check for a completed master run.
 * It never calls a model and only emits a receipt when the persisted business
 * state, adoption ledger and context evidence all agree with the run ledger.
 */
export async function verifyMasterAgentRunV1(input: {
  scope: WorkspaceScope
  runId: number
  now?: number
}): Promise<MasterAgentVerificationResultV1> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  if (snapshot.projection.state === 'completed') {
    return { accepted: true, codes: [], snapshot }
  }
  if (snapshot.projection.state !== 'running') {
    throw new Error(`主 Agent run 当前状态 ${snapshot.projection.state} 不允许终态验证`)
  }
  if (snapshot.contract.workflowKind !== 'multi-domain-sequential') {
    throw new Error('终态验证器只接受分步骤主 Agent run')
  }
  const steps = Object.values(snapshot.projection.steps)
  if (
    steps.length !== snapshot.contract.acceptance.filter(item => item.kind === 'output-present').length
    || steps.some(step => step.status !== 'succeeded' || !step.adoptionHash)
  ) {
    return { accepted: false, codes: ['run-not-ready'], snapshot }
  }

  const restored = await restoreMasterAgentCandidatesV1({ scope: input.scope, runId: input.runId })
  const adoptions = await adoptionRecords(input.runId)
  const adoptionByStep = new Map(adoptions.map(item => [item.stepId, item]))
  const candidatesByStep = new Map(restored.candidates.map(item => [item.payload.runStepId, item]))
  const codes: string[] = []
  const ordered: Array<{ candidate: MasterAgentDurableCandidateV1; adoption: AdoptionRecordV1; businessMatch: boolean }> = []

  for (const task of restored.plan.tasks) {
    const stepId = `master:${task.id}`
    const step = snapshot.projection.steps[stepId]
    const candidate = candidatesByStep.get(stepId)
    const adoption = adoptionByStep.get(stepId)
    if (!step || step.status !== 'succeeded' || !step.adoptionHash) codes.push(`${task.id}:step-not-succeeded`)
    if (!candidate || !candidate.payload.candidateHash) codes.push(`${task.id}:candidate-missing`)
    if (!adoption || adoption.candidateHash !== candidate?.payload.candidateHash) {
      codes.push(`${task.id}:adoption-missing`)
    }
    const contextEvent = snapshot.events
      .filter(isContextAssembledEvent)
      .find(event => event.payload.stepId === stepId && event.payload.attempt === step?.attempt)
    if (!contextEvent) codes.push(`${task.id}:context-manifest-missing`)
    if (!candidate || !adoption || candidate.event.id == null) {
      if (candidate?.event.id == null) codes.push(`${task.id}:candidate-event-missing`)
      continue
    }
    let businessMatch = false
    try {
      businessMatch = await isMasterAgentCandidateBusinessStateMatchingV1(
        {
          scope: input.scope,
          runId: input.runId,
          candidateEventId: candidate.event.id,
          worldGroupId: snapshot.projection.worldGroupId,
        } satisfies MasterAgentCandidateAdoptionRefV1,
        candidate,
      )
    } catch {
      codes.push(`${task.id}:candidate-invalid`)
    }
    if (!businessMatch) codes.push(`${task.id}:post-state-mismatch`)
    ordered.push({ candidate, adoption, businessMatch })
  }

  if (codes.length > 0) {
    return rejectTerminalVerification(input.scope, input.runId, snapshot, codes, input.now ?? Date.now())
  }

  const candidateHashes = ordered.map(item => item.candidate.payload.candidateHash!)
  const contextManifestHashes = restored.plan.tasks.map(task => {
    const event = snapshot.events
      .filter(isContextAssembledEvent)
      .find(item => item.payload.stepId === `master:${task.id}`)
    return event?.payload.manifestHash ?? ''
  })
  const postStateHash = await hashCanonicalValue({
    version: 1,
    runId: input.runId,
    worldGroupId: snapshot.projection.worldGroupId,
    steps: ordered.map(item => ({
      stepId: item.candidate.payload.runStepId,
      candidateHash: item.candidate.payload.candidateHash,
      adoptionEventId: item.adoption.id,
      businessMatch: item.businessMatch,
    })),
  })
  snapshot = await appendAgentRunEventV1({
    scope: input.scope,
    runId: input.runId,
    type: 'verification.started',
    payload: { verifierSetVersion: MASTER_AGENT_VERIFIER_SET_VERSION_V1 },
    expectedLastSequence: snapshot.projection.lastSequence,
    now: input.now ?? Date.now(),
  })
  const criteria = snapshot.contract.acceptance.map(criterion => {
    const candidate = ordered.find(item => criterion.id.startsWith(`${item.candidate.payload.taskId}.`))
    if (!candidate) {
      return { id: criterion.id, status: 'passed' as const, evidenceRefs: [`post-state:${postStateHash}`] }
    }
    return {
      id: criterion.id,
      status: 'passed' as const,
      evidenceRefs: evidenceForCriterion(
        criterion.kind,
        candidate.candidate,
        snapshot,
        candidate.adoption,
        postStateHash,
      ),
    }
  })
  const receipt = await createVerificationReceiptV1({
    version: 1,
    runId: input.runId,
    generation: snapshot.projection.generation,
    contractHash: snapshot.projection.contractHash,
    contextManifestHashes,
    candidateHashes,
    adoptionEventIds: ordered.map(item => item.adoption.id),
    postStateHash,
    verifierSetVersion: MASTER_AGENT_VERIFIER_SET_VERSION_V1,
    criteria,
    acceptedAt: input.now ?? Date.now(),
  })
  snapshot = await appendAgentRunEventV1({
    scope: input.scope,
    runId: input.runId,
    type: 'verification.accepted',
    payload: { receiptHash: receipt.receiptHash },
    expectedLastSequence: snapshot.projection.lastSequence,
    now: input.now ?? Date.now(),
  })
  return { accepted: true, codes: [], snapshot, receipt }
}
