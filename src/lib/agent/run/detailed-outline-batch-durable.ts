import { db } from '../../db/schema'
import type { AgentConversation, AgentEvent, WorkspaceScope } from '../../types'
import type { AssembleContextResult } from '../../registry/types'
import type { ContextManifestV1 } from '../../types/agent-run'
import {
  appendAgentEvent,
  getOrCreateAgentConversation,
  readAgentEvents,
} from '../conversations'
import {
  appendAgentRunEventV1,
  createAgentRunV1,
  readAgentRunV1,
  type AgentRunSnapshotV1,
} from './event-store'
import { createVerificationReceiptV1 } from './verification-receipt'
import { hashCanonicalValue } from './hash'
import { createContextManifestFromAssemblyV1 } from './context-manifest'
import {
  assertRecordInScope,
  readOwnedRows,
} from '../../world-engine/scope'
import { DETAILED_OUTLINE_GENERATION_SOURCE_KEYS_V1 } from './detailed-outline-generation-durable'

export const DETAILED_OUTLINE_BATCH_GENERATION_CONVERSATION_PURPOSE_V1 = 'detailed-outline-batch-generation'
export const DETAILED_OUTLINE_BATCH_GENERATION_CANDIDATE_TYPE_V1 = 'detailed-outline-batch-candidate'
export const DETAILED_OUTLINE_BATCH_GENERATION_VERIFIER_V1 = 'detailed-outline-batch-terminal-v1'

export type DetailedOutlineBatchOperationV1 = 'enhanced'

export function detailedOutlineBatchStepIdV1(outlineNodeId: number): string {
  return `detailed-outline.batch:${outlineNodeId}`
}

export interface DetailedOutlineBatchCandidateV1 {
  version: 1
  type: typeof DETAILED_OUTLINE_BATCH_GENERATION_CANDIDATE_TYPE_V1
  projectId: number
  runId: number
  stepId: string
  outlineNodeId: number
  worldGroupId: number | null
  operation: DetailedOutlineBatchOperationV1
  sourceSummaryHash: string
  output: string
  outputHash: string
  contextManifestHash: string
  workspaceScope: WorkspaceScope
  createdAt: number
  durable: {
    runId: number
    stepId: string
    attempt: number
    candidateHash: string
  }
}

function isCandidate(value: unknown): value is DetailedOutlineBatchCandidateV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<DetailedOutlineBatchCandidateV1>
  return candidate.version === 1
    && candidate.type === DETAILED_OUTLINE_BATCH_GENERATION_CANDIDATE_TYPE_V1
    && typeof candidate.projectId === 'number'
    && typeof candidate.runId === 'number'
    && typeof candidate.stepId === 'string'
    && typeof candidate.outlineNodeId === 'number'
    && candidate.operation === 'enhanced'
    && typeof candidate.sourceSummaryHash === 'string'
    && typeof candidate.output === 'string'
    && typeof candidate.outputHash === 'string'
    && typeof candidate.contextManifestHash === 'string'
    && !!candidate.workspaceScope
    && candidate.workspaceScope.projectId === candidate.projectId
    && !!candidate.durable
    && candidate.durable.runId === candidate.runId
    && candidate.durable.stepId === candidate.stepId
    && typeof candidate.durable.attempt === 'number'
    && typeof candidate.durable.candidateHash === 'string'
}

export async function hashDetailedOutlineBatchCandidateV1(
  candidate: DetailedOutlineBatchCandidateV1,
): Promise<string> {
  return hashCanonicalValue({
    draft: candidate.output,
    payload: {
      version: candidate.version,
      type: candidate.type,
      projectId: candidate.projectId,
      runId: candidate.runId,
      stepId: candidate.stepId,
      outlineNodeId: candidate.outlineNodeId,
      worldGroupId: candidate.worldGroupId,
      operation: candidate.operation,
      sourceSummaryHash: candidate.sourceSummaryHash,
      outputHash: candidate.outputHash,
      contextManifestHash: candidate.contextManifestHash,
      workspaceScope: candidate.workspaceScope,
    },
  })
}

export function buildDetailedOutlineBatchRunContractV1(input: {
  projectId: number
  worldGroupId: number | null
  outlineNodeIds: number[]
}) {
  const ids = [...new Set(input.outlineNodeIds)]
  if (!ids.length) throw new Error('批量细纲任务至少需要一个章节。')
  return {
    version: 1 as const,
    objective: `批量生成 ${ids.length} 个章节的细纲候选，并逐章等待作者确认`,
    workflowKind: 'long-running-resumable' as const,
    scope: {
      projectId: input.projectId,
      worldGroupId: input.worldGroupId,
      outlineNodeIds: ids,
    },
    permissions: {
      contextSourceKeys: [...DETAILED_OUTLINE_GENERATION_SOURCE_KEYS_V1],
      writeTargets: [{
        table: 'detailedOutlines',
        fields: [
          'scenes',
          'openingHook',
          'endingCliffhanger',
          'sceneLocation',
          'emotionArc',
          'appearingCharacterIds',
          'foreshadowIds',
          'prohibitions',
          'lastUsedSummary',
        ],
        mode: 'author-confirmed' as const,
      }],
    },
    budget: {
      maxModelCalls: ids.length,
      maxToolCalls: 0,
      maxInputTokens: 16_000 * ids.length,
      maxOutputTokens: 8_000 * ids.length,
      maxAttemptsPerStep: 2,
      maxProtocolErrors: ids.length,
    },
    acceptance: [
      { id: 'detailed-outline-batch.candidates', kind: 'output-present' as const, required: true },
      { id: 'detailed-outline-batch.confirmed', kind: 'author-confirmed' as const, required: true },
      { id: 'detailed-outline-batch.adopted', kind: 'adoption-committed' as const, required: true },
      { id: 'detailed-outline-batch.post-state', kind: 'post-state-matches' as const, required: true },
    ],
    verificationPlan: [{
      id: 'detailed-outline-batch.terminal',
      kind: 'terminal' as const,
      verifier: DETAILED_OUTLINE_BATCH_GENERATION_VERIFIER_V1,
      criterionIds: [
        'detailed-outline-batch.candidates',
        'detailed-outline-batch.confirmed',
        'detailed-outline-batch.adopted',
        'detailed-outline-batch.post-state',
      ],
    }],
    failurePolicy: {
      onProtocolError: 'retry' as const,
      onVerificationFailure: 'fail' as const,
      onStaleInput: 'pause-for-author' as const,
    },
  }
}

export async function createDetailedOutlineBatchDurableRunV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  outlineNodeIds: number[]
}): Promise<AgentRunSnapshotV1> {
  const conversation = await getOrCreateAgentConversation({
    projectId: input.scope.projectId,
    worldGroupId: input.worldGroupId,
    purpose: DETAILED_OUTLINE_BATCH_GENERATION_CONVERSATION_PURPOSE_V1,
    title: '批量细纲生成记录',
    scope: input.scope,
  })
  return createAgentRunV1({
    scope: input.scope,
    worldGroupId: input.worldGroupId,
    conversationId: conversation.id ?? null,
    contract: buildDetailedOutlineBatchRunContractV1({
      projectId: input.scope.projectId,
      worldGroupId: input.worldGroupId,
      outlineNodeIds: input.outlineNodeIds,
    }),
  })
}

async function append(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  type: Parameters<typeof appendAgentRunEventV1>[0]['type'],
  payload: any,
): Promise<AgentRunSnapshotV1> {
  return appendAgentRunEventV1({
    scope,
    runId: snapshot.run.id,
    type,
    payload,
    expectedLastSequence: snapshot.projection.lastSequence,
  } as any)
}

export async function beginDetailedOutlineBatchStepV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  contextManifest: ContextManifestV1
  binding: {
    outlineNodeId: number
    sourceSummaryHash: string
    promptHash: string
  }
}): Promise<AgentRunSnapshotV1> {
  const stepId = detailedOutlineBatchStepIdV1(input.binding.outlineNodeId)
  if (input.contextManifest.runId !== input.snapshot.run.id
    || input.contextManifest.stepId !== stepId) {
    throw new Error('批量细纲 Context Manifest 与 durable run 不匹配。')
  }
  let next = await append(input.scope, input.snapshot, 'step.scheduled', { stepId })
  next = await append(input.scope, next, 'step.started', { stepId, attempt: 1 })
  next = await append(input.scope, next, 'context.assembled', {
    stepId,
    attempt: 1,
    manifestHash: input.contextManifest.manifestHash,
  })
  return append(input.scope, next, 'model.requested', {
    stepId,
    attempt: 1,
    bindingHash: await hashCanonicalValue(input.binding),
  })
}

export async function recordDetailedOutlineBatchModelOutputV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  outlineNodeId: number
  output: string
}): Promise<AgentRunSnapshotV1> {
  const stepId = detailedOutlineBatchStepIdV1(input.outlineNodeId)
  const step = input.snapshot.projection.steps[stepId]
  if (!step || step.status !== 'running') throw new Error('批量细纲步骤不在模型响应状态。')
  return append(input.scope, input.snapshot, 'model.responded', {
    stepId,
    attempt: step.attempt,
    outputHash: await hashCanonicalValue(input.output),
  })
}

export async function failDetailedOutlineBatchStepV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  outlineNodeId: number
  code: string
  retryable?: boolean
}): Promise<AgentRunSnapshotV1> {
  const stepId = detailedOutlineBatchStepIdV1(input.outlineNodeId)
  let next = input.snapshot
  let step = next.projection.steps[stepId]
  if (!step) {
    next = await append(input.scope, next, 'step.scheduled', { stepId })
    next = await append(input.scope, next, 'step.started', { stepId, attempt: 1 })
    step = next.projection.steps[stepId]
  }
  if (!step || !['running', 'scheduled'].includes(step.status)) return next
  if (step.status === 'scheduled') {
    next = await append(input.scope, next, 'step.started', { stepId, attempt: 1 })
  }
  return append(input.scope, next, 'step.failed', {
    stepId,
    attempt: step.status === 'scheduled' ? 1 : step.attempt,
    code: input.code.trim().slice(0, 160) || 'detailed_outline_batch_failed',
    retryable: input.retryable ?? true,
  })
}

export async function pauseDetailedOutlineBatchRunV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  reason: string
}): Promise<AgentRunSnapshotV1> {
  if (!['running', 'awaiting_confirmation'].includes(input.snapshot.projection.state)) {
    return input.snapshot
  }
  return append(input.scope, input.snapshot, 'run.paused', {
    reason: input.reason.trim().slice(0, 1_000) || '批量细纲任务已暂停。',
    recoverable: true,
  })
}

export async function cancelDetailedOutlineBatchRunV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  reason?: string
}): Promise<AgentRunSnapshotV1> {
  if (['completed', 'failed', 'cancelled'].includes(input.snapshot.projection.state)) {
    return input.snapshot
  }
  return append(input.scope, input.snapshot, 'run.cancelled', {
    reason: input.reason?.trim().slice(0, 1_000) || '作者停止了批量细纲任务。',
  })
}

export async function persistDetailedOutlineBatchCandidateV1(input: {
  scope: WorkspaceScope
  candidate: DetailedOutlineBatchCandidateV1
}): Promise<{ conversation: AgentConversation & { id: number }; event: AgentEvent & { id: number } }> {
  if (input.candidate.projectId !== input.scope.projectId
    || input.candidate.workspaceScope.projectId !== input.scope.projectId
    || input.candidate.workspaceScope.worldId !== input.scope.worldId
    || input.candidate.workspaceScope.workId !== input.scope.workId) {
    throw new Error('批量细纲候选 WorkspaceScope 不匹配。')
  }
  const outline = await db.outlineNodes.get(input.candidate.outlineNodeId)
  if (!outline || !await assertRecordInScope(input.scope, 'outlineNodes', outline, { owner: 'work' })) {
    throw new Error('批量细纲候选的大纲节点不存在或越界。')
  }
  const conversation = await getOrCreateAgentConversation({
    projectId: input.scope.projectId,
    worldGroupId: input.candidate.worldGroupId,
    purpose: DETAILED_OUTLINE_BATCH_GENERATION_CONVERSATION_PURPOSE_V1,
    title: '批量细纲生成记录',
    scope: input.scope,
  })
  if (conversation.id == null) throw new Error('批量细纲候选对话缺少持久化 ID。')
  const event = await appendAgentEvent({
    projectId: input.scope.projectId,
    conversationId: conversation.id,
    kind: 'candidate',
    content: input.candidate.output,
    payload: {
      version: input.candidate.version,
      type: input.candidate.type,
      projectId: input.candidate.projectId,
      runId: input.candidate.runId,
      runStepId: input.candidate.stepId,
      outlineNodeId: input.candidate.outlineNodeId,
      worldGroupId: input.candidate.worldGroupId,
      operation: input.candidate.operation,
      sourceSummaryHash: input.candidate.sourceSummaryHash,
      outputHash: input.candidate.outputHash,
      contextManifestHash: input.candidate.contextManifestHash,
      workspaceScope: input.candidate.workspaceScope,
      candidateHash: input.candidate.durable.candidateHash,
    },
    scope: input.scope,
  })
  return {
    conversation: conversation as AgentConversation & { id: number },
    event: event as AgentEvent & { id: number },
  }
}

export async function recordDetailedOutlineBatchCandidateV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  candidate: DetailedOutlineBatchCandidateV1
}): Promise<AgentRunSnapshotV1> {
  const step = input.snapshot.projection.steps[input.candidate.stepId]
  if (!isCandidate(input.candidate)
    || input.candidate.runId !== input.snapshot.run.id
    || !step
    || step.status !== 'running'
    || step.attempt !== input.candidate.durable.attempt) {
    throw new Error('批量细纲候选 durable evidence 不匹配。')
  }
  if (await hashDetailedOutlineBatchCandidateV1(input.candidate) !== input.candidate.durable.candidateHash) {
    throw new Error('批量细纲候选 hash 不匹配。')
  }
  const responded = input.snapshot.events.some(event => (
    event.type === 'model.responded'
      && event.payload.stepId === input.candidate.stepId
      && event.payload.attempt === input.candidate.durable.attempt
  ))
  let next = input.snapshot
  if (!responded) {
    next = await append(input.scope, next, 'model.responded', {
      stepId: input.candidate.stepId,
      attempt: input.candidate.durable.attempt,
      outputHash: input.candidate.outputHash,
    })
  }
  return append(input.scope, next, 'candidate.persisted', {
    stepId: input.candidate.stepId,
    attempt: input.candidate.durable.attempt,
    candidateHash: input.candidate.durable.candidateHash,
    requiresConfirmation: true,
  })
}

export async function readLatestDetailedOutlineBatchCandidatesV1(input: {
  scope: WorkspaceScope
  runId: number
  includeSucceeded?: boolean
}): Promise<DetailedOutlineBatchCandidateV1[]> {
  const conversations = (await readOwnedRows<AgentConversation>(input.scope, 'agentConversations', { owner: 'work' }))
    .filter(row => row.purpose === DETAILED_OUTLINE_BATCH_GENERATION_CONVERSATION_PURPOSE_V1)
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const candidates: DetailedOutlineBatchCandidateV1[] = []
  for (const conversation of conversations) {
    if (conversation.id == null) continue
    for (const event of await readAgentEvents(conversation.id, input.scope)) {
      if (event.kind !== 'candidate') continue
      let raw: Record<string, any>
      try { raw = JSON.parse(event.payload) as Record<string, any> } catch { continue }
      const candidate: DetailedOutlineBatchCandidateV1 = {
        version: raw.version,
        type: raw.type,
        projectId: raw.projectId,
        runId: raw.runId,
        stepId: raw.runStepId,
        outlineNodeId: raw.outlineNodeId,
        worldGroupId: raw.worldGroupId ?? conversation.worldGroupId ?? null,
        operation: raw.operation,
        sourceSummaryHash: raw.sourceSummaryHash,
        output: event.content,
        outputHash: raw.outputHash,
        contextManifestHash: raw.contextManifestHash,
        workspaceScope: raw.workspaceScope,
        createdAt: event.createdAt,
        durable: {
          runId: raw.runId,
          stepId: raw.runStepId,
          attempt: 1,
          candidateHash: raw.candidateHash,
        },
      }
      if (!isCandidate(candidate) || candidate.runId !== input.runId) continue
      if (await hashDetailedOutlineBatchCandidateV1(candidate) !== candidate.durable.candidateHash) continue
      const step = snapshot.projection.steps[candidate.stepId]
      if (step?.status === 'running' && !step.candidateHash) {
        snapshot = await recordDetailedOutlineBatchCandidateV1({
          scope: input.scope,
          snapshot,
          candidate,
        })
      }
      const recoveredStep = snapshot.projection.steps[candidate.stepId]
      if ((recoveredStep?.status === 'awaiting_confirmation' || (
        input.includeSucceeded && recoveredStep?.status === 'succeeded'
      )) && recoveredStep.candidateHash === candidate.durable.candidateHash) {
        candidates.push(candidate)
      }
    }
  }
  return candidates.sort((left, right) => left.createdAt - right.createdAt)
}

export async function readLatestRecoverableDetailedOutlineBatchCandidateV1(input: {
  scope: WorkspaceScope
}): Promise<DetailedOutlineBatchCandidateV1 | null> {
  const conversations = (await readOwnedRows<AgentConversation>(input.scope, 'agentConversations', { owner: 'work' }))
    .filter(row => row.purpose === DETAILED_OUTLINE_BATCH_GENERATION_CONVERSATION_PURPOSE_V1)
  const runIds = new Set<number>()
  for (const conversation of conversations) {
    if (conversation.id == null) continue
    for (const event of await readAgentEvents(conversation.id, input.scope)) {
      if (event.kind !== 'candidate') continue
      try {
        const payload = JSON.parse(event.payload) as Record<string, unknown>
        if (typeof payload.runId === 'number') runIds.add(payload.runId)
      } catch {
        // Damaged conversational evidence is ignored; the durable run remains authoritative.
      }
    }
  }
  const candidates: DetailedOutlineBatchCandidateV1[] = []
  for (const runId of runIds) {
    try {
      candidates.push(...await readLatestDetailedOutlineBatchCandidatesV1({ scope: input.scope, runId }))
    } catch {
      // Cross-work or damaged runs are not recoverable in the current workspace.
    }
  }
  return candidates.sort((left, right) => right.createdAt - left.createdAt)[0] ?? null
}

export async function rejectDetailedOutlineBatchCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
  candidate: DetailedOutlineBatchCandidateV1
  pauseReason?: string
}): Promise<AgentRunSnapshotV1> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const step = snapshot.projection.steps[input.candidate.stepId]
  if (!step || step.status !== 'awaiting_confirmation' || step.candidateHash !== input.candidate.durable.candidateHash) {
    throw new Error('批量细纲候选当前不等待作者确认。')
  }
  snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
    stepId: input.candidate.stepId,
    candidateHash: input.candidate.durable.candidateHash,
    decision: 'reject',
  })
  return append(input.scope, snapshot, 'run.paused', {
    reason: input.pauseReason ?? '作者拒绝了批量细纲候选；任务保留断点，等待重新运行。',
    recoverable: true,
  })
}

export async function commitDetailedOutlineBatchCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
  candidate: DetailedOutlineBatchCandidateV1
  output: string
  currentSourceSummaryHash: () => Promise<string>
  adopt: () => Promise<void>
  postState: () => Promise<unknown>
}): Promise<AgentRunSnapshotV1> {
  if (input.output !== input.candidate.output
    || await hashDetailedOutlineBatchCandidateV1(input.candidate) !== input.candidate.durable.candidateHash) {
    throw new Error('批量细纲候选已变化或 hash 校验失败。')
  }
  if (await input.currentSourceSummaryHash() !== input.candidate.sourceSummaryHash) {
    let stale = await readAgentRunV1(input.scope, input.runId)
    const step = stale.projection.steps[input.candidate.stepId]
    if (step?.status === 'awaiting_confirmation') {
      stale = await append(input.scope, stale, 'candidate.staled', {
        stepId: input.candidate.stepId,
        candidateHash: input.candidate.durable.candidateHash,
        reason: 'source_changed',
      })
    }
    throw new Error('章节大纲已变化，批量细纲候选已过期。')
  }
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const step = snapshot.projection.steps[input.candidate.stepId]
  if (!step || step.status !== 'awaiting_confirmation' || step.candidateHash !== input.candidate.durable.candidateHash) {
    throw new Error('批量细纲候选不在等待作者确认状态。')
  }
  snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
    stepId: input.candidate.stepId,
    candidateHash: input.candidate.durable.candidateHash,
    decision: 'adopt',
  })
  snapshot = await append(input.scope, snapshot, 'adoption.started', {
    stepId: input.candidate.stepId,
    candidateHash: input.candidate.durable.candidateHash,
    intentHash: await hashCanonicalValue({ candidateHash: input.candidate.durable.candidateHash }),
  })
  try {
    await input.adopt()
    const postState = await input.postState()
    if (postState == null) throw new Error('批量细纲采纳后正式数据不存在。')
    const postStateHash = await hashCanonicalValue(postState)
    snapshot = await append(input.scope, snapshot, 'adoption.committed', {
      stepId: input.candidate.stepId,
      candidateHash: input.candidate.durable.candidateHash,
      adoptionHash: await hashCanonicalValue({ candidateHash: input.candidate.durable.candidateHash, postStateHash }),
    })
    return append(input.scope, snapshot, 'step.succeeded', {
      stepId: input.candidate.stepId,
      attempt: input.candidate.durable.attempt,
      outputHash: input.candidate.durable.candidateHash,
    })
  } catch (error) {
    await append(input.scope, snapshot, 'adoption.rejected', {
      stepId: input.candidate.stepId,
      candidateHash: input.candidate.durable.candidateHash,
      code: (error instanceof Error ? error.message : 'detailed_outline_batch_adoption_failed').slice(0, 160),
    })
    throw error
  }
}

export async function verifyDetailedOutlineBatchRunV1(input: {
  scope: WorkspaceScope
  runId: number
  candidates: DetailedOutlineBatchCandidateV1[]
  postStates: unknown[]
}): Promise<{ snapshot: AgentRunSnapshotV1; receiptHash: string }> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const expectedIds = snapshot.contract.scope.outlineNodeIds ?? []
  if (expectedIds.some(id => snapshot.projection.steps[detailedOutlineBatchStepIdV1(id)]?.status !== 'succeeded')) {
    throw new Error('批量细纲任务仍有未完成章节，不能终态验证。')
  }
  const candidateByOutline = new Map(input.candidates.map(candidate => [candidate.outlineNodeId, candidate]))
  if (input.candidates.length !== expectedIds.length
    || candidateByOutline.size !== expectedIds.length
    || input.postStates.length !== expectedIds.length) {
    throw new Error('批量细纲任务缺少候选或正式后状态证据。')
  }
  for (const outlineNodeId of expectedIds) {
    const candidate = candidateByOutline.get(outlineNodeId)
    if (!candidate
      || candidate.runId !== input.runId
      || candidate.stepId !== detailedOutlineBatchStepIdV1(outlineNodeId)
      || await hashDetailedOutlineBatchCandidateV1(candidate) !== candidate.durable.candidateHash) {
      throw new Error(`批量细纲章节 ${outlineNodeId} 的候选证据无效。`)
    }
  }
  snapshot = await append(input.scope, snapshot, 'verification.started', {
    verifierSetVersion: DETAILED_OUTLINE_BATCH_GENERATION_VERIFIER_V1,
  })
  const runEvents = await db.agentRunEvents.where('runId').equals(input.runId).toArray()
  const adoptionEventIds = runEvents
    .filter(event => event.type === 'adoption.committed' && event.id != null)
    .map(event => event.id!)
  if (adoptionEventIds.length !== expectedIds.length) throw new Error('批量细纲缺少逐章采纳事件证据。')
  const postStateHash = await hashCanonicalValue(input.postStates)
  const receipt = await createVerificationReceiptV1({
    version: 1,
    runId: input.runId,
    generation: snapshot.projection.generation,
    contractHash: snapshot.projection.contractHash,
    contextManifestHashes: [...new Set(input.candidates.map(candidate => candidate.contextManifestHash))],
    candidateHashes: input.candidates.map(candidate => candidate.durable.candidateHash),
    adoptionEventIds,
    postStateHash,
    verifierSetVersion: DETAILED_OUTLINE_BATCH_GENERATION_VERIFIER_V1,
    criteria: [
      { id: 'detailed-outline-batch.candidates', status: 'passed', evidenceRefs: input.candidates.map(candidate => `candidate:${candidate.durable.candidateHash}`) },
      { id: 'detailed-outline-batch.confirmed', status: 'passed', evidenceRefs: [`run:${input.runId}:confirmation`] },
      { id: 'detailed-outline-batch.adopted', status: 'passed', evidenceRefs: adoptionEventIds.map(id => `event:${id}`) },
      { id: 'detailed-outline-batch.post-state', status: 'passed', evidenceRefs: [`post-state:${postStateHash}`] },
    ],
    acceptedAt: Date.now(),
  })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  return { snapshot, receiptHash: receipt.receiptHash }
}

export async function detailedOutlineBatchManifestV1(input: {
  runId: number
  scope: WorkspaceScope
  worldGroupId: number | null
  outlineNodeId: number
  assembled: AssembleContextResult
}): Promise<ContextManifestV1> {
  return createContextManifestFromAssemblyV1({
    runId: input.runId,
    stepId: detailedOutlineBatchStepIdV1(input.outlineNodeId),
    attempt: 1,
    projectId: input.scope.projectId,
    worldGroupId: input.worldGroupId,
    declaredSourceKeys: [...DETAILED_OUTLINE_GENERATION_SOURCE_KEYS_V1],
    assembled: input.assembled,
    boundary: { outlineNodeId: input.outlineNodeId },
    readerVersion: 'detailed-outline-batch-context-v1',
  })
}
