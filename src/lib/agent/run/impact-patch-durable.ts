import { db } from '../../db/schema'
import { parseAgentEventPayload, type AgentEvent, type WorkspaceScope } from '../../types'
import { appendAgentEvent, getOrCreateAgentConversation } from '../conversations'
import { assembleContext } from '../../registry/assemble-context'
import { adopt } from '../../registry/adopt'
import { buildEditImpactGraphV1, type EditImpactGraphV1 } from '../../consistency/impact-analysis'
import { createContextManifestFromAssemblyV1 } from './context-manifest'
import { createAgentRunV1, appendAgentRunEventV1, readAgentRunV1, type AgentRunSnapshotV1 } from './event-store'
import { createVerificationReceiptV1 } from './verification-receipt'
import { hashCanonicalValue } from './hash'
import { hashChapterText } from '../../ai/chapter-memory/text-normalization'
import { assertRecordInScope, readOwnedRows } from '../../world-engine/scope'

export const IMPACT_PATCH_RUN_VERSION_V1 = 1 as const
export const IMPACT_PATCH_CANDIDATE_TYPE_V1 = 'impact-patch-candidate' as const
export const IMPACT_PATCH_STEP_ID_V1 = 'impact-patch:apply' as const
export const IMPACT_PATCH_VERIFIER_SET_V1 = 'impact-patch-terminal-v1' as const

/** HARNESS-44 deliberately starts with one upstream, unwritten planning field. */
export interface ImpactPatchProposalV1 {
  target: 'outlineNodes'
  recordId: number
  fields: { summary: string }
  reason: string
  evidenceRefs: string[]
}

export interface ImpactPatchDurableEvidenceV1 {
  runId: number
  stepId: typeof IMPACT_PATCH_STEP_ID_V1
  attempt: 1
  contextManifestHash: string
  candidateHash: string
}

export interface ImpactPatchCandidateV1 {
  version: typeof IMPACT_PATCH_RUN_VERSION_V1
  type: typeof IMPACT_PATCH_CANDIDATE_TYPE_V1
  projectId: number
  worldGroupId: number | null
  sourceChapterId: number
  sourceTextHash: string
  sourceGraphHash: string
  proposal: ImpactPatchProposalV1
  createdAt: number
  durable: ImpactPatchDurableEvidenceV1
}

function isImpactPatchCandidate(value: unknown): value is ImpactPatchCandidateV1 {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ImpactPatchCandidateV1>
  if (
    candidate.version !== IMPACT_PATCH_RUN_VERSION_V1
    || candidate.type !== IMPACT_PATCH_CANDIDATE_TYPE_V1
    || typeof candidate.projectId !== 'number'
    || typeof candidate.sourceChapterId !== 'number'
    || typeof candidate.sourceTextHash !== 'string'
    || typeof candidate.sourceGraphHash !== 'string'
    || typeof candidate.createdAt !== 'number'
    || !candidate.durable
  ) return false
  try {
    assertProposal(candidate.proposal as ImpactPatchProposalV1)
  } catch {
    return false
  }
  const durable = candidate.durable as Partial<ImpactPatchDurableEvidenceV1>
  return durable.stepId === IMPACT_PATCH_STEP_ID_V1
    && durable.attempt === 1
    && typeof durable.runId === 'number'
    && typeof durable.contextManifestHash === 'string'
    && typeof durable.candidateHash === 'string'
}

function assertProposal(input: ImpactPatchProposalV1): void {
  if (!input || typeof input !== 'object') throw new Error('影响 patch 候选格式无效。')
  if (input.target !== 'outlineNodes') throw new Error('影响 patch 当前只允许写入 outlineNodes。')
  if (!Number.isInteger(input.recordId) || input.recordId < 1) throw new Error('影响 patch 目标大纲节点无效。')
  if (!input.fields || typeof input.fields !== 'object'
    || Object.keys(input.fields).length !== 1
    || typeof input.fields.summary !== 'string'
    || !input.fields.summary.trim()) {
    throw new Error('影响 patch 只允许提供非空 summary 字段。')
  }
  if (input.fields.summary.length > 20_000) throw new Error('影响 patch 摘要超过长度上限。')
  if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 2_000) {
    throw new Error('影响 patch 缺少有效修改理由。')
  }
  if (!Array.isArray(input.evidenceRefs)
    || input.evidenceRefs.some(ref => typeof ref !== 'string' || !ref.trim())
    || input.evidenceRefs.length > 12) {
    throw new Error('影响 patch 证据引用无效或过多。')
  }
}

async function hashCandidateWithoutDurable(candidate: Omit<ImpactPatchCandidateV1, 'durable'>): Promise<string> {
  return hashCanonicalValue(candidate)
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

function buildImpactPatchContract(input: {
  projectId: number
  worldGroupId: number | null
  sourceChapterId: number
  targetOutlineNodeId: number
}) {
  return {
    version: 1 as const,
    objective: `根据章节 #${input.sourceChapterId} 的影响图，提出一次作者确认式后续大纲摘要修订`,
    workflowKind: 'plan-execute' as const,
    scope: {
      projectId: input.projectId,
      worldGroupId: input.worldGroupId,
      chapterIds: [input.sourceChapterId],
      outlineNodeIds: [input.targetOutlineNodeId],
    },
    permissions: {
      contextSourceKeys: ['chapterContent'],
      writeTargets: [{ table: 'outlineNodes', fields: ['summary'], mode: 'author-confirmed' as const }],
    },
    budget: {
      // RunContract keeps a positive ceiling even for deterministic work;
      // this step records modelCalls=0 in evidence and never emits a request.
      maxModelCalls: 1,
      maxToolCalls: 0,
      maxInputTokens: 8_000,
      maxOutputTokens: 1,
      maxAttemptsPerStep: 1,
      maxProtocolErrors: 0,
    },
    acceptance: [
      { id: 'impact-patch.candidate', kind: 'author-confirmed' as const, required: true },
      { id: 'impact-patch.adoption', kind: 'adoption-committed' as const, required: true },
      { id: 'impact-patch.post-state', kind: 'post-state-matches' as const, required: true },
    ],
    verificationPlan: [{
      id: 'impact-patch.terminal',
      kind: 'terminal' as const,
      verifier: IMPACT_PATCH_VERIFIER_SET_V1,
      criterionIds: ['impact-patch.candidate', 'impact-patch.adoption', 'impact-patch.post-state'],
    }],
    failurePolicy: {
      onProtocolError: 'fail' as const,
      onVerificationFailure: 'fail' as const,
      onStaleInput: 'pause-for-author' as const,
    },
  }
}

async function readTargetOutline(scope: WorkspaceScope, recordId: number): Promise<Record<string, any>> {
  const rows = await readOwnedRows<Record<string, any>>(scope, 'outlineNodes', { owner: 'work' })
  const row = rows.find(candidate => candidate.id === recordId)
  if (!row) throw new Error('影响 patch 目标大纲节点不存在或越界。')
  return row
}

function assertTargetUnlocked(target: Record<string, any>): void {
  // outlineNodes has no first-class lock column yet, but imported/forward-compatible
  // rows may carry one. Never let this narrow patch bypass an author lock.
  if (target.locked === true) throw new Error('影响 patch 目标大纲节点已锁定，拒绝写回。')
}

async function currentPostStateHash(scope: WorkspaceScope, candidate: ImpactPatchCandidateV1): Promise<string> {
  const target = await readTargetOutline(scope, candidate.proposal.recordId)
  const source = await db.chapters.get(candidate.sourceChapterId)
  return hashCanonicalValue({
    version: IMPACT_PATCH_RUN_VERSION_V1,
    sourceChapterId: candidate.sourceChapterId,
    sourceTextHash: await hashChapterText(source?.content ?? ''),
    target: { id: target.id, summary: target.summary ?? '' },
  })
}

/** Create a durable, author-confirmed candidate without modifying Canon. */
export async function createImpactPatchCandidateV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  sourceChapterId: number
  proposal: ImpactPatchProposalV1
}): Promise<{
  snapshot: AgentRunSnapshotV1
  candidate: ImpactPatchCandidateV1
  event: AgentEvent
  graph: EditImpactGraphV1
}> {
  assertProposal(input.proposal)
  const source = await db.chapters.get(input.sourceChapterId)
  if (!source || !await assertRecordInScope(input.scope, 'chapters', source, { owner: 'work' })) {
    throw new Error('影响 patch 来源章节不存在或越界。')
  }
  const graph = await buildEditImpactGraphV1(input.scope, input.sourceChapterId)
  if (!graph.nodes.some(node => node.kind === 'outline' && node.recordId === input.proposal.recordId)) {
    throw new Error('影响 patch 目标必须来自当前影响图的大纲依赖节点。')
  }
  await readTargetOutline(input.scope, input.proposal.recordId)
  const conversation = await getOrCreateAgentConversation({
    projectId: input.scope.projectId,
    worldGroupId: input.worldGroupId,
    purpose: 'impact-patch',
    title: '影响修订',
    scope: input.scope,
  })
  let snapshot = await createAgentRunV1({
    scope: input.scope,
    worldGroupId: input.worldGroupId,
    conversationId: conversation.id,
    contract: buildImpactPatchContract({
      projectId: input.scope.projectId,
      worldGroupId: input.worldGroupId,
      sourceChapterId: input.sourceChapterId,
      targetOutlineNodeId: input.proposal.recordId,
    }),
  })
  snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId: IMPACT_PATCH_STEP_ID_V1 })
  const assembled = await assembleContext({
    projectId: input.scope.projectId,
    scope: input.scope,
    worldGroupId: input.worldGroupId,
    chapterId: input.sourceChapterId,
    sourceKeys: ['chapterContent'],
    inputBudgetMaxTokens: 8_000,
  })
  const manifest = await createContextManifestFromAssemblyV1({
    runId: snapshot.run.id,
    stepId: IMPACT_PATCH_STEP_ID_V1,
    attempt: 1,
    projectId: input.scope.projectId,
    worldGroupId: input.worldGroupId,
    declaredSourceKeys: ['chapterContent'],
    assembled,
    boundary: { chapterId: input.sourceChapterId },
    readerVersion: 'impact-patch-context-v1',
  })
  snapshot = await append(input.scope, snapshot, 'step.started', { stepId: IMPACT_PATCH_STEP_ID_V1, attempt: 1 })
  snapshot = await append(input.scope, snapshot, 'context.assembled', {
    stepId: IMPACT_PATCH_STEP_ID_V1,
    attempt: 1,
    manifestHash: manifest.manifestHash,
  })
  const unsigned: Omit<ImpactPatchCandidateV1, 'durable'> = {
    version: IMPACT_PATCH_RUN_VERSION_V1,
    type: IMPACT_PATCH_CANDIDATE_TYPE_V1,
    projectId: input.scope.projectId,
    worldGroupId: input.worldGroupId,
    sourceChapterId: input.sourceChapterId,
    sourceTextHash: graph.source.sourceTextHash,
    sourceGraphHash: graph.graphHash,
    proposal: input.proposal,
    createdAt: Date.now(),
  }
  const candidateHash = await hashCandidateWithoutDurable(unsigned)
  const candidate: ImpactPatchCandidateV1 = {
    ...unsigned,
    durable: {
      runId: snapshot.run.id,
      stepId: IMPACT_PATCH_STEP_ID_V1,
      attempt: 1,
      contextManifestHash: manifest.manifestHash,
      candidateHash,
    },
  }
  const event = await appendAgentEvent({
    projectId: input.scope.projectId,
    conversationId: conversation.id!,
    durableRunId: snapshot.run.id,
    kind: 'candidate',
    role: 'assistant',
    content: `影响修订候选：${input.proposal.reason}`,
    payload: candidate,
    scope: input.scope,
  })
  snapshot = await append(input.scope, snapshot, 'candidate.persisted', {
    stepId: IMPACT_PATCH_STEP_ID_V1,
    attempt: 1,
    candidateHash,
    requiresConfirmation: true,
  })
  return { snapshot, candidate, event, graph }
}

/** Recover the newest candidate that is still at the author confirmation boundary. */
export async function readLatestImpactPatchCandidateV1(input: {
  scope: WorkspaceScope
  sourceChapterId: number
}): Promise<ImpactPatchCandidateV1 | null> {
  const events = await readOwnedRows<AgentEvent>(input.scope, 'agentEvents', { owner: 'work' })
  const candidates = events
    .filter(event => event.kind === 'candidate')
    .map(event => parseAgentEventPayload<unknown>(event, null))
    .filter((value): value is ImpactPatchCandidateV1 => isImpactPatchCandidate(value))
    .filter(candidate => (
      candidate.projectId === input.scope.projectId
      && candidate.sourceChapterId === input.sourceChapterId
    ))
    .sort((left, right) => right.createdAt - left.createdAt)
  for (const candidate of candidates) {
    try {
      const { durable: _durable, ...withoutDurable } = candidate
      if (await hashCandidateWithoutDurable(withoutDurable) !== candidate.durable.candidateHash) continue
      const graph = await buildEditImpactGraphV1(input.scope, candidate.sourceChapterId)
      if (graph.graphHash !== candidate.sourceGraphHash || graph.source.sourceTextHash !== candidate.sourceTextHash) continue
      const snapshot = await readAgentRunV1(input.scope, candidate.durable.runId)
      const step = snapshot.projection.steps[IMPACT_PATCH_STEP_ID_V1]
      if (step?.status === 'awaiting_confirmation' && step.candidateHash === candidate.durable.candidateHash) {
        return candidate
      }
    } catch {
      // Damaged or cross-scope candidates remain auditable but are not recoverable.
    }
  }
  return null
}

export async function rejectImpactPatchCandidateV1(input: {
  scope: WorkspaceScope
  candidate: ImpactPatchCandidateV1
}): Promise<AgentRunSnapshotV1> {
  assertProposal(input.candidate.proposal)
  const { durable: _durable, ...withoutDurable } = input.candidate
  if (await hashCandidateWithoutDurable(withoutDurable) !== input.candidate.durable.candidateHash) {
    throw new Error('影响 patch 候选 hash 不匹配。')
  }
  const snapshot = await readAgentRunV1(input.scope, input.candidate.durable.runId)
  const step = snapshot.projection.steps[IMPACT_PATCH_STEP_ID_V1]
  if (step?.status === 'failed' && step.confirmation === 'reject') return snapshot
  if (step?.status !== 'awaiting_confirmation' || step.candidateHash !== input.candidate.durable.candidateHash) {
    throw new Error('影响 patch 当前不在作者确认边界。')
  }
  return append(input.scope, snapshot, 'confirmation.recorded', {
    stepId: IMPACT_PATCH_STEP_ID_V1,
    candidateHash: input.candidate.durable.candidateHash,
    decision: 'reject',
  })
}

export async function adoptImpactPatchCandidateV1(input: {
  scope: WorkspaceScope
  candidate: ImpactPatchCandidateV1
}): Promise<{ snapshot: AgentRunSnapshotV1; receiptHash: string; adoption: { id: number; fields: string[] } }> {
  assertProposal(input.candidate.proposal)
  const durable = input.candidate.durable
  const { durable: _durable, ...withoutDurable } = input.candidate
  if (await hashCandidateWithoutDurable(withoutDurable) !== durable.candidateHash) {
    throw new Error('影响 patch 候选 hash 不匹配。')
  }
  const graph = await buildEditImpactGraphV1(input.scope, input.candidate.sourceChapterId)
  if (graph.graphHash !== input.candidate.sourceGraphHash || graph.source.sourceTextHash !== input.candidate.sourceTextHash) {
    throw new Error('影响 patch 来源正文或影响图已变化，候选已过期。')
  }
  const target = await readTargetOutline(input.scope, input.candidate.proposal.recordId)
  assertTargetUnlocked(target)
  let snapshot = await readAgentRunV1(input.scope, durable.runId)
  const step = snapshot.projection.steps[IMPACT_PATCH_STEP_ID_V1]
  if (!step || step.status !== 'awaiting_confirmation' || step.candidateHash !== durable.candidateHash) {
    throw new Error('影响 patch 当前不在作者确认边界。')
  }
  snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
    stepId: IMPACT_PATCH_STEP_ID_V1,
    candidateHash: durable.candidateHash,
    decision: 'adopt',
  })
  snapshot = await append(input.scope, snapshot, 'adoption.started', {
    stepId: IMPACT_PATCH_STEP_ID_V1,
    candidateHash: durable.candidateHash,
    intentHash: await hashCanonicalValue({ kind: 'impact-patch', candidateHash: durable.candidateHash }),
  })
  const result = await adopt({
    projectId: input.scope.projectId,
    scope: input.scope,
    recordId: target.id,
    target: 'outlineNodes',
    mode: 'merge-diffs',
    data: input.candidate.proposal.fields,
  })
  const adoption = result.written.find(row => row.id === target.id)
  if (!adoption) throw new Error(result.skipped[0]?.reason ?? '影响 patch 未写入目标大纲。')
  snapshot = await append(input.scope, snapshot, 'adoption.committed', {
    stepId: IMPACT_PATCH_STEP_ID_V1,
    candidateHash: durable.candidateHash,
    adoptionHash: await hashCanonicalValue({ candidateHash: durable.candidateHash, adoption }),
  })
  snapshot = await append(input.scope, snapshot, 'step.succeeded', {
    stepId: IMPACT_PATCH_STEP_ID_V1,
    attempt: durable.attempt,
    outputHash: await hashCanonicalValue({ candidateHash: durable.candidateHash, adoption }),
  })
  const postStateHash = await currentPostStateHash(input.scope, input.candidate)
  snapshot = await append(input.scope, snapshot, 'verification.started', { verifierSetVersion: IMPACT_PATCH_VERIFIER_SET_V1 })
  const adoptionEventIds = (await db.agentRunEvents.where('runId').equals(snapshot.run.id).toArray())
    .filter(row => row.type === 'adoption.committed' && row.id != null)
    .map(row => row.id!)
  const manifestHash = [...snapshot.events].reverse().find(event => event.type === 'context.assembled')?.payload.manifestHash
  if (!manifestHash) throw new Error('影响 patch 缺少 Context Manifest 证据。')
  const receipt = await createVerificationReceiptV1({
    version: 1,
    runId: snapshot.run.id,
    generation: snapshot.projection.generation,
    contractHash: snapshot.projection.contractHash,
    contextManifestHashes: [manifestHash],
    candidateHashes: [durable.candidateHash],
    adoptionEventIds,
    postStateHash,
    verifierSetVersion: IMPACT_PATCH_VERIFIER_SET_V1,
    criteria: [
      { id: 'impact-patch.candidate', status: 'passed', evidenceRefs: [`candidate:${durable.candidateHash}`] },
      { id: 'impact-patch.adoption', status: 'passed', evidenceRefs: adoptionEventIds.map(id => `event:${id}`) },
      { id: 'impact-patch.post-state', status: 'passed', evidenceRefs: [`post-state:${postStateHash}`] },
    ],
    acceptedAt: Date.now(),
  })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  return { snapshot, receiptHash: receipt.receiptHash, adoption }
}
