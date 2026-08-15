import { db } from '../../db/schema'
import type { AgentConversation, AgentEvent, WorkspaceScope } from '../../types'
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
import type { AssembleContextResult } from '../../registry/types'
import {
  assertRecordInScope,
  readOwnedRows,
} from '../../world-engine/scope'
import {
  getAgentSkillV1,
  OUTLINE_DETAIL_CONTEXT_SOURCE_KEYS,
  resolveAgentSkillContextSourceKeysV1,
} from '../skill-registry'
import {
  assertAgentSkillExecutionBindingV1,
  createAgentSkillExecutionBindingV1,
} from '../execution-binding'
import {
  creativeArtifactCanAdoptV1,
  parseCreativeArtifactV1,
  type CreativeArtifactV1,
} from '../creative-reliability'
import { parseNarrativeBriefV1, type NarrativeBriefV1 } from '../narrative-brief'

export const DETAILED_OUTLINE_GENERATION_STEP_ID_V1 = 'detailed-outline.generate'
export const DETAILED_OUTLINE_GENERATION_CONVERSATION_PURPOSE_V1 = 'detailed-outline-generation'
export const DETAILED_OUTLINE_GENERATION_CANDIDATE_TYPE_V1 = 'detailed-outline-generation-candidate'

/**
 * This is the exact CONTEXT_SOURCES allow-list used by the single-chapter
 * detailed-outline UI. The prompt builder may trim individual sections, but
 * it may not silently read a source that is absent from the run contract.
 */
export const DETAILED_OUTLINE_GENERATION_SOURCE_KEYS_V1 = OUTLINE_DETAIL_CONTEXT_SOURCE_KEYS

export type DetailedOutlineGenerationOperationV1 = 'scenes' | 'enhanced'

export interface DetailedOutlineGenerationCandidateV1 {
  version: 1
  type: typeof DETAILED_OUTLINE_GENERATION_CANDIDATE_TYPE_V1
  projectId: number
  outlineNodeId: number
  worldGroupId: number | null
  operation: DetailedOutlineGenerationOperationV1
  sourceSummaryHash: string
  output: string
  outputHash: string
  contextManifestHash: string
  /** Absent on candidates generated before CREL-8. */
  creativeArtifact?: CreativeArtifactV1
  /** Absent on candidates generated before CREL-8. */
  narrativeBrief?: NarrativeBriefV1
  workspaceScope: WorkspaceScope
  createdAt: number
  durable: {
    runId: number
    stepId: typeof DETAILED_OUTLINE_GENERATION_STEP_ID_V1
    attempt: number
    candidateHash: string
  }
}

export interface DetailedOutlineGenerationAdoptionResultV1 {
  snapshot: AgentRunSnapshotV1
  receiptHash: string
  postStateHash: string
}

export async function hashDetailedOutlineGenerationCandidateV1(
  candidate: DetailedOutlineGenerationCandidateV1,
): Promise<string> {
  return hashCanonicalValue({
    draft: candidate.output,
    payload: {
      version: 1,
      type: DETAILED_OUTLINE_GENERATION_CANDIDATE_TYPE_V1,
      projectId: candidate.projectId,
      runId: candidate.durable.runId,
      runStepId: candidate.durable.stepId,
      outlineNodeId: candidate.outlineNodeId,
      operation: candidate.operation,
      sourceSummaryHash: candidate.sourceSummaryHash,
      outputHash: candidate.outputHash,
      contextManifestHash: candidate.contextManifestHash,
      ...(candidate.creativeArtifact ? { creativeArtifact: candidate.creativeArtifact } : {}),
      ...(candidate.narrativeBrief ? { narrativeBrief: candidate.narrativeBrief } : {}),
      workspaceScope: {
        projectId: candidate.workspaceScope.projectId,
        worldId: candidate.workspaceScope.worldId,
        workId: candidate.workspaceScope.workId,
      },
    },
  })
}

export function buildDetailedOutlineGenerationRunContractV1(input: {
  projectId: number
  worldGroupId: number | null
  outlineNodeId: number
  operation: DetailedOutlineGenerationOperationV1
}) {
  const skill = getAgentSkillV1('outline.details', 'outline')
  return {
    version: 1 as const,
    objective: `${input.operation === 'scenes' ? '拆分场景' : '完善'}章节细纲 #${input.outlineNodeId}`,
    workflowKind: 'long-running-resumable' as const,
    scope: {
      projectId: input.projectId,
      worldGroupId: input.worldGroupId,
      outlineNodeIds: [input.outlineNodeId],
    },
    permissions: {
      contextSourceKeys: resolveAgentSkillContextSourceKeysV1(skill),
      writeTargets: skill.writeTargets.map(target => ({
        table: target.table,
        fields: [...target.fields],
        mode: 'author-confirmed' as const,
        ...(target.adoptionExtension ? { adoptionExtension: target.adoptionExtension } : {}),
      })),
    },
    executionBindings: [{
      stepId: DETAILED_OUTLINE_GENERATION_STEP_ID_V1,
      ...createAgentSkillExecutionBindingV1(skill),
    }],
    budget: {
      maxModelCalls: 1,
      maxToolCalls: 0,
      maxInputTokens: 16_000,
      maxOutputTokens: 8_000,
      maxAttemptsPerStep: 2,
      maxProtocolErrors: 1,
    },
    acceptance: [
      { id: 'detailed-outline.output', kind: 'output-present' as const, required: true },
      { id: 'detailed-outline.confirmed', kind: 'author-confirmed' as const, required: true },
      { id: 'detailed-outline.adopted', kind: 'adoption-committed' as const, required: true },
      { id: 'detailed-outline.post-state', kind: 'post-state-matches' as const, required: true },
    ],
    verificationPlan: [{
      id: 'detailed-outline.terminal',
      kind: 'terminal' as const,
      verifier: 'detailed-outline-terminal-v1',
      criterionIds: [
        'detailed-outline.output',
        'detailed-outline.confirmed',
        'detailed-outline.adopted',
        'detailed-outline.post-state',
      ],
    }],
    failurePolicy: {
      onProtocolError: 'fail' as const,
      onVerificationFailure: 'fail' as const,
      onStaleInput: 'pause-for-author' as const,
    },
  }
}

export function assertDetailedOutlineGenerationExecutionBindingV1(
  snapshot: AgentRunSnapshotV1,
): void {
  if (!snapshot.contract.executionBindings) return
  if (snapshot.contract.executionBindings.length !== 1) {
    throw new Error('细纲生成 RunContract execution binding 数量无效。')
  }
  const binding = snapshot.contract.executionBindings[0]
  if (binding?.stepId !== DETAILED_OUTLINE_GENERATION_STEP_ID_V1) {
    throw new Error('细纲生成 RunContract execution binding 步骤无效。')
  }
  const { stepId: _stepId, ...skillBinding } = binding
  assertAgentSkillExecutionBindingV1(
    skillBinding,
    getAgentSkillV1('outline.details', 'outline'),
    '细纲生成',
  )
}

export async function createDetailedOutlineGenerationDurableRunV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  outlineNodeId: number
  operation: DetailedOutlineGenerationOperationV1
}): Promise<AgentRunSnapshotV1> {
  const conversation = await getOrCreateAgentConversation({
    projectId: input.scope.projectId,
    worldGroupId: input.worldGroupId,
    purpose: DETAILED_OUTLINE_GENERATION_CONVERSATION_PURPOSE_V1,
    title: '细纲生成记录',
    scope: input.scope,
  })
  return createAgentRunV1({
    scope: input.scope,
    worldGroupId: input.worldGroupId,
    conversationId: conversation.id ?? null,
    contract: buildDetailedOutlineGenerationRunContractV1({
      projectId: input.scope.projectId,
      worldGroupId: input.worldGroupId,
      outlineNodeId: input.outlineNodeId,
      operation: input.operation,
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

export async function beginDetailedOutlineGenerationStepV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  contextManifest: ContextManifestV1
  binding: {
    operation: DetailedOutlineGenerationOperationV1
    sourceSummaryHash: string
    promptHash: string
  }
}): Promise<AgentRunSnapshotV1> {
  const { snapshot, contextManifest } = input
  assertDetailedOutlineGenerationExecutionBindingV1(snapshot)
  if (contextManifest.runId !== snapshot.run.id
    || contextManifest.stepId !== DETAILED_OUTLINE_GENERATION_STEP_ID_V1) {
    throw new Error('细纲生成 Context Manifest 与 durable run 不匹配。')
  }
  let next = await append(input.scope, snapshot, 'step.scheduled', {
    stepId: DETAILED_OUTLINE_GENERATION_STEP_ID_V1,
  })
  next = await append(input.scope, next, 'step.started', {
    stepId: DETAILED_OUTLINE_GENERATION_STEP_ID_V1,
    attempt: 1,
  })
  next = await append(input.scope, next, 'context.assembled', {
    stepId: DETAILED_OUTLINE_GENERATION_STEP_ID_V1,
    attempt: 1,
    manifestHash: contextManifest.manifestHash,
  })
  return append(input.scope, next, 'model.requested', {
    stepId: DETAILED_OUTLINE_GENERATION_STEP_ID_V1,
    attempt: 1,
    bindingHash: await hashCanonicalValue(input.binding),
  })
}

export async function recordDetailedOutlineGenerationModelOutputV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  output: string
}): Promise<AgentRunSnapshotV1> {
  assertDetailedOutlineGenerationExecutionBindingV1(input.snapshot)
  const step = input.snapshot.projection.steps[DETAILED_OUTLINE_GENERATION_STEP_ID_V1]
  if (!step || step.status !== 'running' || step.attempt !== 1) {
    throw new Error('细纲生成 durable step 不在模型响应状态。')
  }
  return append(input.scope, input.snapshot, 'model.responded', {
    stepId: DETAILED_OUTLINE_GENERATION_STEP_ID_V1,
    attempt: 1,
    outputHash: await hashCanonicalValue(input.output),
  })
}

export async function failDetailedOutlineGenerationStepV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  code: string
  retryable?: boolean
}): Promise<AgentRunSnapshotV1> {
  const step = input.snapshot.projection.steps[DETAILED_OUTLINE_GENERATION_STEP_ID_V1]
  if (!step || step.status !== 'running') return input.snapshot
  return append(input.scope, input.snapshot, 'step.failed', {
    stepId: DETAILED_OUTLINE_GENERATION_STEP_ID_V1,
    attempt: step.attempt,
    code: input.code.trim().slice(0, 160) || 'detailed_outline_generation_failed',
    retryable: input.retryable ?? true,
  })
}

function isCandidate(value: unknown): value is DetailedOutlineGenerationCandidateV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<DetailedOutlineGenerationCandidateV1>
  const baseValid = candidate.version === 1
    && candidate.type === DETAILED_OUTLINE_GENERATION_CANDIDATE_TYPE_V1
    && typeof candidate.projectId === 'number'
    && typeof candidate.outlineNodeId === 'number'
    && (candidate.operation === 'scenes' || candidate.operation === 'enhanced')
    && typeof candidate.sourceSummaryHash === 'string'
    && typeof candidate.output === 'string'
    && typeof candidate.outputHash === 'string'
    && typeof candidate.contextManifestHash === 'string'
    && !!candidate.workspaceScope
    && candidate.workspaceScope.projectId === candidate.projectId
    && !!candidate.durable
    && candidate.durable.stepId === DETAILED_OUTLINE_GENERATION_STEP_ID_V1
    && typeof candidate.durable.runId === 'number'
    && typeof candidate.durable.candidateHash === 'string'
  if (!baseValid) return false
  if ((candidate.creativeArtifact === undefined) !== (candidate.narrativeBrief === undefined)) return false
  if (candidate.creativeArtifact !== undefined) {
    try {
      candidate.creativeArtifact = parseCreativeArtifactV1(candidate.creativeArtifact)
      candidate.narrativeBrief = parseNarrativeBriefV1(candidate.narrativeBrief)
    } catch {
      return false
    }
  }
  return true
}

export async function persistDetailedOutlineGenerationCandidateV1(input: {
  scope: WorkspaceScope
  candidate: DetailedOutlineGenerationCandidateV1
}): Promise<{ conversation: AgentConversation & { id: number }; event: AgentEvent & { id: number } }> {
  if (input.candidate.projectId !== input.scope.projectId
    || input.candidate.workspaceScope.projectId !== input.scope.projectId
    || input.candidate.workspaceScope.worldId !== input.scope.worldId
    || input.candidate.workspaceScope.workId !== input.scope.workId) {
    throw new Error('细纲生成候选 WorkspaceScope 不匹配。')
  }
  const outline = await db.outlineNodes.get(input.candidate.outlineNodeId)
  if (!outline || !await assertRecordInScope(input.scope, 'outlineNodes', outline, { owner: 'work' })) {
    throw new Error('细纲生成候选的章节大纲不存在或越界。')
  }
  const conversation = await getOrCreateAgentConversation({
    projectId: input.scope.projectId,
    worldGroupId: input.candidate.worldGroupId,
    purpose: DETAILED_OUTLINE_GENERATION_CONVERSATION_PURPOSE_V1,
    title: '细纲生成记录',
    scope: input.scope,
  })
  if (conversation.id == null) throw new Error('细纲生成候选对话缺少持久化 ID。')
  const payload = {
    version: 1,
    type: DETAILED_OUTLINE_GENERATION_CANDIDATE_TYPE_V1,
    projectId: input.candidate.projectId,
    runId: input.candidate.durable.runId,
    runStepId: input.candidate.durable.stepId,
    outlineNodeId: input.candidate.outlineNodeId,
    operation: input.candidate.operation,
    sourceSummaryHash: input.candidate.sourceSummaryHash,
    outputHash: input.candidate.outputHash,
    contextManifestHash: input.candidate.contextManifestHash,
    ...(input.candidate.creativeArtifact
      ? { creativeArtifact: input.candidate.creativeArtifact }
      : {}),
    ...(input.candidate.narrativeBrief ? { narrativeBrief: input.candidate.narrativeBrief } : {}),
    workspaceScope: input.candidate.workspaceScope,
    candidateHash: input.candidate.durable.candidateHash,
  }
  const event = await appendAgentEvent({
    projectId: input.scope.projectId,
    conversationId: conversation.id,
    kind: 'candidate',
    content: input.candidate.output,
    payload,
    scope: input.scope,
  })
  return { conversation: conversation as AgentConversation & { id: number }, event: event as AgentEvent & { id: number } }
}

export async function recordDetailedOutlineGenerationCandidateV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  candidate: DetailedOutlineGenerationCandidateV1
}): Promise<AgentRunSnapshotV1> {
  assertDetailedOutlineGenerationExecutionBindingV1(input.snapshot)
  if (!isCandidate(input.candidate) || input.candidate.durable.runId !== input.snapshot.run.id) {
    throw new Error('细纲生成候选 durable evidence 不匹配。')
  }
  const step = input.snapshot.projection.steps[DETAILED_OUTLINE_GENERATION_STEP_ID_V1]
  if (!step || step.status !== 'running' || step.attempt !== input.candidate.durable.attempt) {
    throw new Error('细纲生成 durable step 不在候选持久化状态。')
  }
  const expected = await hashDetailedOutlineGenerationCandidateV1(input.candidate)
  if (expected !== input.candidate.durable.candidateHash) {
    throw new Error('细纲生成候选 hash 不匹配。')
  }
  return append(input.scope, input.snapshot, 'candidate.persisted', {
    stepId: DETAILED_OUTLINE_GENERATION_STEP_ID_V1,
    attempt: input.candidate.durable.attempt,
    candidateHash: input.candidate.durable.candidateHash,
    requiresConfirmation: true,
  })
}

export async function readLatestDetailedOutlineGenerationCandidateV1(input: {
  scope: WorkspaceScope
  outlineNodeId: number
}): Promise<{ candidate: DetailedOutlineGenerationCandidateV1; event: AgentEvent & { id: number }; snapshot: AgentRunSnapshotV1 } | null> {
  const conversations = (await readOwnedRows<AgentConversation>(input.scope, 'agentConversations', { owner: 'work' }))
    .filter(row => row.purpose === DETAILED_OUTLINE_GENERATION_CONVERSATION_PURPOSE_V1)
  const candidates: Array<{ candidate: DetailedOutlineGenerationCandidateV1; event: AgentEvent & { id: number } }> = []
  for (const conversation of conversations) {
    if (conversation.id == null) continue
    for (const event of await readAgentEvents(conversation.id, input.scope)) {
      if (event.kind !== 'candidate' || event.id == null) continue
      let payload: unknown
      try { payload = JSON.parse(event.payload) } catch { continue }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue
      const raw = payload as Record<string, unknown>
      const candidate = {
        version: raw.version,
        type: raw.type,
        projectId: raw.projectId,
        outlineNodeId: raw.outlineNodeId,
        worldGroupId: conversation.worldGroupId ?? null,
        operation: raw.operation,
        sourceSummaryHash: raw.sourceSummaryHash,
        output: event.content,
        outputHash: raw.outputHash,
        contextManifestHash: raw.contextManifestHash,
        creativeArtifact: raw.creativeArtifact,
        narrativeBrief: raw.narrativeBrief,
        workspaceScope: raw.workspaceScope,
        createdAt: event.createdAt,
        durable: {
          runId: raw.runId,
          stepId: raw.runStepId,
          attempt: 1,
          candidateHash: raw.candidateHash,
        },
      } as DetailedOutlineGenerationCandidateV1
      if (!isCandidate(candidate) || candidate.outlineNodeId !== input.outlineNodeId) continue
      const expected = await hashCanonicalValue({
        draft: event.content,
        payload: Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'candidateHash')),
      })
      if (expected !== candidate.durable.candidateHash) continue
      let snapshot = await readAgentRunV1(input.scope, candidate.durable.runId)
      assertDetailedOutlineGenerationExecutionBindingV1(snapshot)
      const step = snapshot.projection.steps[DETAILED_OUTLINE_GENERATION_STEP_ID_V1]
      if (step?.status === 'running' && step.candidateHash == null) {
        snapshot = await recoverDetailedOutlineGenerationCandidateV1({
          scope: input.scope,
          candidate,
        }) ?? snapshot
      }
      const recoveredStep = snapshot.projection.steps[DETAILED_OUTLINE_GENERATION_STEP_ID_V1]
      if (recoveredStep?.status === 'awaiting_confirmation' && recoveredStep.candidateHash === candidate.durable.candidateHash) {
        candidates.push({ candidate, event: event as AgentEvent & { id: number } })
      }
    }
  }
  const latest = candidates.sort((left, right) => (right.event.sequence ?? 0) - (left.event.sequence ?? 0))[0]
  if (!latest) return null
  return {
    ...latest,
    snapshot: await readAgentRunV1(input.scope, latest.candidate.durable.runId),
  }
}

export async function recoverDetailedOutlineGenerationCandidateV1(input: {
  scope: WorkspaceScope
  candidate: DetailedOutlineGenerationCandidateV1
}): Promise<AgentRunSnapshotV1 | null> {
  const snapshot = await readAgentRunV1(input.scope, input.candidate.durable.runId)
  assertDetailedOutlineGenerationExecutionBindingV1(snapshot)
  const step = snapshot.projection.steps[DETAILED_OUTLINE_GENERATION_STEP_ID_V1]
  if (step?.candidateHash === input.candidate.durable.candidateHash) return snapshot
  if (!step || step.status !== 'running') return null
  return append(input.scope, snapshot, 'candidate.persisted', {
    stepId: DETAILED_OUTLINE_GENERATION_STEP_ID_V1,
    attempt: input.candidate.durable.attempt,
    candidateHash: input.candidate.durable.candidateHash,
    requiresConfirmation: true,
  })
}

export async function rejectDetailedOutlineGenerationCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
  candidate: DetailedOutlineGenerationCandidateV1
}): Promise<AgentRunSnapshotV1> {
  const snapshot = await readAgentRunV1(input.scope, input.runId)
  assertDetailedOutlineGenerationExecutionBindingV1(snapshot)
  const step = snapshot.projection.steps[DETAILED_OUTLINE_GENERATION_STEP_ID_V1]
  if (step?.status === 'failed' && step.confirmation === 'reject') return snapshot
  if (!step || step.status !== 'awaiting_confirmation') throw new Error('细纲候选当前不等待作者确认。')
  return append(input.scope, snapshot, 'confirmation.recorded', {
    stepId: DETAILED_OUTLINE_GENERATION_STEP_ID_V1,
    candidateHash: input.candidate.durable.candidateHash,
    decision: 'reject',
  })
}

export async function commitDetailedOutlineGenerationAdoptionV1(input: {
  scope: WorkspaceScope
  runId: number
  candidate: DetailedOutlineGenerationCandidateV1
  output: string
  adopt: () => Promise<void>
  postState: () => Promise<unknown>
  currentSourceSummaryHash: () => Promise<string>
  currentContextManifestHash?: () => Promise<string>
  postStateMatches?: (postState: unknown) => boolean
}): Promise<DetailedOutlineGenerationAdoptionResultV1> {
  if (await hashDetailedOutlineGenerationCandidateV1(input.candidate)
    !== input.candidate.durable.candidateHash) {
    throw new Error('细纲候选 hash 校验失败，请重新生成。')
  }
  if (await hashCanonicalValue(input.candidate.output) !== input.candidate.outputHash) {
    throw new Error('细纲候选输出 hash 校验失败，请重新生成。')
  }
  if (
    input.candidate.creativeArtifact
    && !creativeArtifactCanAdoptV1(input.candidate.creativeArtifact)
  ) throw new Error('细纲候选仍有未修复的结构问题，不能采纳。')
  if (input.output !== input.candidate.output) throw new Error('细纲采纳内容与作者确认候选不一致。')
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  assertDetailedOutlineGenerationExecutionBindingV1(snapshot)
  const governed = snapshot.contract.executionBindings !== undefined
  const summaryChanged = await input.currentSourceSummaryHash() !== input.candidate.sourceSummaryHash
  const contextChanged = input.currentContextManifestHash
    ? await input.currentContextManifestHash() !== input.candidate.contextManifestHash
    : false
  if (governed && !input.currentContextManifestHash) {
    throw new Error('细纲采纳缺少当前 Context Manifest 校验。')
  }
  if (summaryChanged || contextChanged) {
    const stale = snapshot
    const step = stale.projection.steps[DETAILED_OUTLINE_GENERATION_STEP_ID_V1]
    if (step?.status === 'awaiting_confirmation') {
      await append(input.scope, stale, 'candidate.staled', {
        stepId: DETAILED_OUTLINE_GENERATION_STEP_ID_V1,
        candidateHash: input.candidate.durable.candidateHash,
        reason: 'source_changed',
      })
    }
    throw new Error(contextChanged
      ? '细纲生成所依据的正式上下文已变化，候选已过期，请重新生成。'
      : '章节大纲已变化，细纲候选已过期，请重新生成。')
  }
  const step = snapshot.projection.steps[DETAILED_OUTLINE_GENERATION_STEP_ID_V1]
  if (!step || step.status !== 'awaiting_confirmation' || step.candidateHash !== input.candidate.durable.candidateHash) {
    throw new Error('细纲 durable run 尚未满足作者采纳条件。')
  }
  snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
    stepId: DETAILED_OUTLINE_GENERATION_STEP_ID_V1,
    candidateHash: input.candidate.durable.candidateHash,
    decision: 'adopt',
  })
  snapshot = await append(input.scope, snapshot, 'adoption.started', {
    stepId: DETAILED_OUTLINE_GENERATION_STEP_ID_V1,
    candidateHash: input.candidate.durable.candidateHash,
    intentHash: await hashCanonicalValue({
      kind: DETAILED_OUTLINE_GENERATION_CANDIDATE_TYPE_V1,
      candidateHash: input.candidate.durable.candidateHash,
    }),
  })
  try {
    await input.adopt()
  } catch (error) {
    await append(input.scope, snapshot, 'adoption.rejected', {
      stepId: DETAILED_OUTLINE_GENERATION_STEP_ID_V1,
      candidateHash: input.candidate.durable.candidateHash,
      code: 'detailed_outline_adoption_failed',
    })
    throw error
  }
  const postState = await input.postState()
  if (postState == null || (input.postStateMatches && !input.postStateMatches(postState))) {
    await append(input.scope, snapshot, 'adoption.rejected', {
      stepId: DETAILED_OUTLINE_GENERATION_STEP_ID_V1,
      candidateHash: input.candidate.durable.candidateHash,
      code: postState == null
        ? 'detailed_outline_post_state_missing'
        : 'detailed_outline_post_state_mismatch',
    })
    throw new Error(postState == null
      ? '细纲采纳后未找到正式数据，终态校验失败。'
      : '细纲采纳后的正式数据与作者确认候选不一致。')
  }
  if (governed && !input.postStateMatches) {
    await append(input.scope, snapshot, 'adoption.rejected', {
      stepId: DETAILED_OUTLINE_GENERATION_STEP_ID_V1,
      candidateHash: input.candidate.durable.candidateHash,
      code: 'detailed_outline_post_state_verifier_missing',
    })
    throw new Error('细纲采纳缺少正式后状态匹配校验。')
  }
  const postStateHash = await hashCanonicalValue(postState)
  const adoptionHash = await hashCanonicalValue({
    candidateHash: input.candidate.durable.candidateHash,
    postStateHash,
  })
  snapshot = await append(input.scope, snapshot, 'adoption.committed', {
    stepId: DETAILED_OUTLINE_GENERATION_STEP_ID_V1,
    candidateHash: input.candidate.durable.candidateHash,
    adoptionHash,
  })
  snapshot = await append(input.scope, snapshot, 'step.succeeded', {
    stepId: DETAILED_OUTLINE_GENERATION_STEP_ID_V1,
    attempt: input.candidate.durable.attempt,
    outputHash: input.candidate.durable.candidateHash,
  })
  snapshot = await append(input.scope, snapshot, 'verification.started', {
    verifierSetVersion: 'detailed-outline-terminal-v1',
  })
  const adoptionEventIds = (await db.agentRunEvents.where('runId').equals(input.runId).toArray())
    .filter(event => event.type === 'adoption.committed' && event.id != null)
    .map(event => event.id!)
  const receipt = await createVerificationReceiptV1({
    version: 1,
    runId: input.runId,
    generation: snapshot.projection.generation,
    contractHash: snapshot.projection.contractHash,
    contextManifestHashes: [input.candidate.contextManifestHash],
    candidateHashes: [input.candidate.durable.candidateHash],
    adoptionEventIds,
    postStateHash,
    verifierSetVersion: 'detailed-outline-terminal-v1',
    criteria: [
      { id: 'detailed-outline.output', status: 'passed', evidenceRefs: [`candidate:${input.candidate.durable.candidateHash}`] },
      { id: 'detailed-outline.confirmed', status: 'passed', evidenceRefs: [`candidate:${input.candidate.durable.candidateHash}`] },
      { id: 'detailed-outline.adopted', status: 'passed', evidenceRefs: [`post-state:${postStateHash}`] },
      { id: 'detailed-outline.post-state', status: 'passed', evidenceRefs: [`post-state:${postStateHash}`] },
    ],
    acceptedAt: Date.now(),
  })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', {
    receiptHash: receipt.receiptHash,
  })
  return { snapshot, receiptHash: receipt.receiptHash, postStateHash }
}

export async function detailedOutlineManifestV1(input: {
  runId: number
  scope: WorkspaceScope
  worldGroupId: number | null
  outlineNodeId: number
  assembled: AssembleContextResult
}): Promise<ContextManifestV1> {
  return createContextManifestFromAssemblyV1({
    runId: input.runId,
    stepId: DETAILED_OUTLINE_GENERATION_STEP_ID_V1,
    attempt: 1,
    projectId: input.scope.projectId,
    worldGroupId: input.worldGroupId,
    declaredSourceKeys: DETAILED_OUTLINE_GENERATION_SOURCE_KEYS_V1,
    assembled: input.assembled,
    boundary: { outlineNodeId: input.outlineNodeId },
    readerVersion: 'detailed-outline-generation-context-v1',
  })
}

export async function hashDetailedOutlineSourceSummaryV1(summary: string): Promise<string> {
  return hashCanonicalValue({ version: 1, summary: summary.trim() })
}
