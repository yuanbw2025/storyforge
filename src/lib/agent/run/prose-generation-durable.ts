import { db } from '../../db/schema'
import { adopt } from '../../registry/adopt'
import { hashChapterText, CHAPTER_TEXT_NORMALIZATION_VERSION } from '../../ai/chapter-memory/text-normalization'
import type { AgentConversation, AgentEvent, Chapter, ChatMessage, WorkspaceScope } from '../../types'
import type {
  AgentRunFormalAIEntryBindingV1,
  ContextManifestV1,
  ContextManifestV2,
  ContextManifestV3,
  VerificationReceiptV1,
} from '../../types/agent-run'
import type { AssembleContextResult } from '../../registry/types'
import {
  appendAgentRunEventV1,
  createAgentRunV1,
  readAgentRunV1,
  type AgentRunSnapshotV1,
} from './event-store'
import { createVerificationReceiptV1 } from './verification-receipt'
import { hashCanonicalValue } from './hash'
import { createContextManifestFromAssemblyV1, createContextManifestV2FromV1 } from './context-manifest'
import {
  assertRecordInScope,
  readOwnedRows,
  resolveScope,
  scopeTransactionTables,
  stampNewRecord,
} from '../../workspace/scope'
import {
  buildChapterInformationBoundaryV1,
  validateProseInformationBoundaryV1,
} from '../information-boundary'
import {
  verifyProseSemanticReviewArtifactV1,
  verifyProseSemanticRevisionArtifactV1,
  type ProseSemanticReviewArtifactV1,
  type ProseSemanticRevisionArtifactV1,
} from '../prose-semantic-review'
import { AgentTeamBudgetTracker, type AgentTeamBudgetEvidence } from '../team-budget'
import {
  assertAgentSkillExecutionBindingV1,
  assertAgentSkillExecutionBindingIntegrityV2,
  createAgentSkillExecutionBindingV1,
  createAgentSkillExecutionBindingV2,
} from '../execution-binding'
import { getAgentSkillV1, resolveAgentSkillContextSourceKeysV1 } from '../skill-registry'
import type {
  AgentRunContractV2,
  AgentRunContractV3,
  AgentRunStepExecutionBindingV2,
  AgentSkillExecutionBindingV1,
  AgentSkillExecutionBindingV2,
} from '../../types/agent-run'
import {
  assertWorkspaceContentRevisionFreshV1,
  parseWorkspaceContentRevisionV1,
  type WorkspaceContentRevisionVectorV1,
} from '../../authoring/content-revision'
import {
  assertFormalAIEntrySnapshotIntegrityV1,
  freezeFormalAIEntryBindingV1,
} from '../formal-ai-entry'
import {
  finalizeContextGatewayAttemptEvidenceV1,
  recordContextGatewayPreflightEvidenceV1,
  type ContextGatewayPreflightEvidenceV1,
} from '../../context-gateway/attempt-evidence'
import type { ContextGatewayExecutionV1 } from '../../context-gateway/execution'
import { assertContextGatewayCandidateAdoptableV1 } from '../../context-gateway/execution'
import { proseGatewayExecutionFromAssemblyV1 } from '../../prose/gateway-context'

export const PROSE_GENERATION_STEP_ID_V1 = 'prose-generation'
export const PROSE_SEMANTIC_REVIEW_STEP_ID_V1 = 'prose-semantic-review'
export const PROSE_SEMANTIC_REVISION_STEP_ID_V1 = 'prose-semantic-revision'
export const PROSE_SEMANTIC_REREVIEW_STEP_ID_V1 = 'prose-semantic-rereview'
export const PROSE_GENERATION_VERIFIER_SET_V1 = 'prose-generation-terminal-v1'
export const PROSE_GENERATION_VERIFIER_SET_V2 = 'prose-generation-terminal-v2-information-boundary'
export const PROSE_GENERATION_VERIFIER_SET_V3 = 'prose-generation-terminal-v3-semantic-review'
export const PROSE_GENERATION_CANDIDATE_TYPE_V1 = 'prose-generation-candidate'

/** Historical read-only alias. Formal V2 runs resolve the exact runtime set. */
export const PROSE_GENERATION_SOURCE_KEYS_V1: readonly string[] = Object.freeze(
  resolveAgentSkillContextSourceKeysV1(
    getAgentSkillV1('prose.generate', 'prose'),
  ),
)

export type ProseGenerationOperationV1 = 'generate' | 'continue'

export function proseGenerationFormalEntryIdV1(operation: ProseGenerationOperationV1): string {
  return operation === 'continue' ? 'prose.chapter.continue' : 'prose.chapter.generate'
}

export async function resolveProseGenerationExecutionBindingV2(input: {
  operation: ProseGenerationOperationV1
  perspectiveCharacterId?: number | null
}): Promise<AgentSkillExecutionBindingV2> {
  const skill = getAgentSkillV1(`prose.${input.operation}`, 'prose')
  return createAgentSkillExecutionBindingV2(skill, {
    // Perspective-scoped knowledge is selected inside the single ragSelection
    // Gateway packet; it is no longer a second optional CONTEXT_SOURCES read.
    optionalContextActivations: [],
    writeTargets: [{
      table: 'chapters',
      fields: ['content', 'wordCount'],
      mode: 'author-confirmed',
    }],
  })
}

export interface ProseGenerationDurableEvidenceV1 {
  runId: number
  stepId: typeof PROSE_GENERATION_STEP_ID_V1
  attempt: number
  contextManifestHash: string
  candidateHash: string
}

export interface ProseGenerationSemanticReviewEvidenceV1 {
  version: 1
  initial: ProseSemanticReviewArtifactV1
  final: ProseSemanticReviewArtifactV1
  revision?: ProseSemanticRevisionArtifactV1
  budget: AgentTeamBudgetEvidence
}

export interface ProseGenerationCandidateV1 {
  version: 1
  type: typeof PROSE_GENERATION_CANDIDATE_TYPE_V1
  projectId: number
  chapterId: number
  chapterTitle: string
  worldGroupId: number | null
  operation: ProseGenerationOperationV1
  /** Hash of the chapter content at the moment the model request started. */
  sourceTextHash: string
  /** Absent on candidates generated before WEH-0C. */
  contentRevision?: WorkspaceContentRevisionVectorV1
  outputText: string
  outputTextHash: string
  /** Present when exact Context Gateway V3 evidence is required for adoption. */
  gatewayEvidenceVersion?: 3
  /** Expected normalized chapter hash after this candidate is adopted. */
  expectedContentHash: string
  /** H9：新候选绑定生成时的信息边界；旧候选缺省以保持刷新恢复兼容。 */
  informationBoundaryHash?: string
  perspectiveCharacterId?: number | null
  perspectiveFromChapter?: boolean
  /** Absent on candidates created before HARNESS-19. */
  semanticReview?: ProseGenerationSemanticReviewEvidenceV1
  createdAt: number
  durable: ProseGenerationDurableEvidenceV1
}

/**
 * New prose contracts (V2/V3) make the information-boundary verifier a
 * required acceptance criterion. Historical V1 runs did not have that
 * criterion and remain readable for migration/recovery compatibility.
 */
export function requiresProseInformationBoundaryV1(
  snapshot: AgentRunSnapshotV1,
): boolean {
  return snapshot.contract.acceptance.some(item => (
    item.id === 'prose-generation.information-boundary' && item.required
  )) || snapshot.contract.verificationPlan.some(item => (
    item.id === 'prose-generation.terminal'
      && [PROSE_GENERATION_VERIFIER_SET_V2, PROSE_GENERATION_VERIFIER_SET_V3].includes(item.verifier as typeof PROSE_GENERATION_VERIFIER_SET_V2 | typeof PROSE_GENERATION_VERIFIER_SET_V3)
  ))
}

export function buildProseGenerationRunContractV1(input: {
  projectId: number
  worldGroupId: number | null
  chapterId: number
  operation: ProseGenerationOperationV1
  semanticReview?: boolean
  formalEntry?: AgentRunFormalAIEntryBindingV1
}) {
  const semanticReview = input.semanticReview === true
  const generationSkill = getAgentSkillV1(
    input.operation === 'continue' ? 'prose.continue' : 'prose.generate',
    'prose',
  )
  const reviewSkill = getAgentSkillV1('prose.review', 'prose')
  const revisionSkill = getAgentSkillV1('prose.revise', 'prose')
  return {
    version: 1 as const,
    objective: `${input.operation === 'continue' ? '续写' : '生成'}章节 #${input.chapterId} 正文候选，并等待作者确认后写回`,
    workflowKind: semanticReview ? 'generate-verify-revise' as const : 'long-running-resumable' as const,
    scope: {
      projectId: input.projectId,
      worldGroupId: input.worldGroupId,
      chapterIds: [input.chapterId],
    },
    permissions: {
      contextSourceKeys: [...PROSE_GENERATION_SOURCE_KEYS_V1],
      writeTargets: [{
        table: 'chapters',
        fields: ['content', 'wordCount'],
        mode: 'author-confirmed' as const,
      }],
    },
    ...(semanticReview ? {
      executionBindings: [
        { stepId: PROSE_GENERATION_STEP_ID_V1, ...createAgentSkillExecutionBindingV1(generationSkill), ...(input.formalEntry ? { formalEntry: input.formalEntry } : {}) },
        { stepId: PROSE_SEMANTIC_REVIEW_STEP_ID_V1, ...createAgentSkillExecutionBindingV1(reviewSkill) },
        { stepId: PROSE_SEMANTIC_REVISION_STEP_ID_V1, ...createAgentSkillExecutionBindingV1(revisionSkill) },
        { stepId: PROSE_SEMANTIC_REREVIEW_STEP_ID_V1, ...createAgentSkillExecutionBindingV1(reviewSkill) },
      ],
    } : {}),
    budget: {
      maxModelCalls: semanticReview ? 4 : 1,
      maxToolCalls: 0,
      maxInputTokens: semanticReview ? 160_000 : 48_000,
      maxOutputTokens: semanticReview ? 38_000 : 16_000,
      maxAttemptsPerStep: 2,
      maxProtocolErrors: 1,
    },
    acceptance: [
      { id: 'prose-generation.candidate', kind: 'output-present' as const, required: true },
      { id: 'prose-generation.information-boundary', kind: 'deterministic-check' as const, required: true },
      ...(semanticReview
        ? [{ id: 'prose-generation.semantic-review', kind: 'semantic-review' as const, required: true }]
        : []),
      { id: 'prose-generation.confirmed', kind: 'author-confirmed' as const, required: true },
      { id: 'prose-generation.adopted', kind: 'adoption-committed' as const, required: true },
      { id: 'prose-generation.post-state', kind: 'post-state-matches' as const, required: true },
    ],
    verificationPlan: [
      ...(semanticReview ? [{
        id: 'prose-generation.semantic',
        kind: 'semantic' as const,
        verifier: PROSE_GENERATION_VERIFIER_SET_V3,
        criterionIds: ['prose-generation.semantic-review'],
      }] : []),
      {
      id: 'prose-generation.terminal',
      kind: 'terminal' as const,
      verifier: semanticReview ? PROSE_GENERATION_VERIFIER_SET_V3 : PROSE_GENERATION_VERIFIER_SET_V2,
      criterionIds: [
        'prose-generation.candidate',
        'prose-generation.information-boundary',
        ...(semanticReview ? ['prose-generation.semantic-review'] : []),
        'prose-generation.confirmed',
        'prose-generation.adopted',
        'prose-generation.post-state',
      ],
      },
    ],
    failurePolicy: {
      onProtocolError: 'retry' as const,
      onVerificationFailure: semanticReview ? 'revise' as const : 'fail' as const,
      onStaleInput: 'pause-for-author' as const,
    },
  }
}

export interface BuildProseGenerationRunContractV2Input {
  projectId: number
  worldGroupId: number | null
  chapterId: number
  operation: ProseGenerationOperationV1
  semanticReview?: boolean
  perspectiveCharacterId?: number | null
  generationBinding?: AgentSkillExecutionBindingV2
  formalEntry?: AgentRunFormalAIEntryBindingV1
}

export async function buildProseGenerationRunContractV2(
  input: BuildProseGenerationRunContractV2Input,
): Promise<AgentRunContractV2> {
  const baseContract = buildProseGenerationRunContractV1(input)
  const expectedGeneration = await resolveProseGenerationExecutionBindingV2(input)
  const generationBinding = input.generationBinding ?? expectedGeneration
  await assertAgentSkillExecutionBindingIntegrityV2(generationBinding, '正文生成 binding')
  if (await hashCanonicalValue(generationBinding) !== await hashCanonicalValue(expectedGeneration)) {
    throw new Error('正文生成 binding 与本轮 Skill/视角边界不一致。')
  }

  const stepBindings: AgentRunStepExecutionBindingV2[] = [{
    stepId: PROSE_GENERATION_STEP_ID_V1,
    ...generationBinding,
    ...(input.formalEntry ? { formalEntry: input.formalEntry } : {}),
  }]
  if (input.semanticReview === true) {
    const optionalContextActivations = generationBinding.optionalContextActivations
    for (const [stepId, skillId] of [
      [PROSE_SEMANTIC_REVIEW_STEP_ID_V1, 'prose.review'],
      [PROSE_SEMANTIC_REVISION_STEP_ID_V1, 'prose.revise'],
      [PROSE_SEMANTIC_REREVIEW_STEP_ID_V1, 'prose.review'],
    ] as const) {
      stepBindings.push({
        stepId,
        ...await createAgentSkillExecutionBindingV2(getAgentSkillV1(skillId, 'prose'), {
          optionalContextActivations,
          writeTargets: [],
        }),
      })
    }
  }
  const contextSourceKeys = [...new Set(stepBindings.flatMap(binding => binding.contextSourceKeys))]
  const writeTargets = generationBinding.writeTargets.map(target => ({ ...target, fields: [...target.fields] }))
  return {
    ...baseContract,
    version: 2,
    permissions: { contextSourceKeys, writeTargets },
    executionBindings: stepBindings,
  }
}

export async function buildProseGenerationRunContractV3(
  input: BuildProseGenerationRunContractV2Input,
): Promise<AgentRunContractV3> {
  const v2 = await buildProseGenerationRunContractV2(input)
  return { ...v2, version: 3, executionBoundary: 'formal' }
}

function requiresSemanticReview(snapshot: AgentRunSnapshotV1): boolean {
  return snapshot.contract.acceptance.some(criterion => (
    criterion.id === 'prose-generation.semantic-review'
      && criterion.kind === 'semantic-review'
      && criterion.required
  ))
}

export function assertProseGenerationExecutionBindingsV1(snapshot: AgentRunSnapshotV1): void {
  if (!snapshot.contract.executionBindings) return
  const operation = snapshot.contract.objective.startsWith('续写') ? 'continue' : 'generate'
  const expected = new Map<string, ReturnType<typeof getAgentSkillV1>>([
    [PROSE_GENERATION_STEP_ID_V1, getAgentSkillV1(`prose.${operation}`, 'prose')],
    ...(requiresSemanticReview(snapshot) ? [
      [PROSE_SEMANTIC_REVIEW_STEP_ID_V1, getAgentSkillV1('prose.review', 'prose')],
      [PROSE_SEMANTIC_REVISION_STEP_ID_V1, getAgentSkillV1('prose.revise', 'prose')],
      [PROSE_SEMANTIC_REREVIEW_STEP_ID_V1, getAgentSkillV1('prose.review', 'prose')],
    ] as const : []),
  ])
  if (snapshot.contract.executionBindings.length !== expected.size) {
    throw new Error('正文生成 RunContract execution bindings 数量无效。')
  }
  for (const binding of snapshot.contract.executionBindings) {
    const skill = expected.get(binding.stepId)
    if (!skill) throw new Error(`正文生成 RunContract 包含未知 execution binding：${binding.stepId}`)
    const { stepId: _stepId, formalEntry: _formalEntry, ...skillBinding } = binding
    if (skillBinding.version === 1) {
      assertAgentSkillExecutionBindingV1(skillBinding, skill, `正文生成 ${binding.stepId}`)
    } else if (skillBinding.skillId !== skill.id) {
      throw new Error(`正文生成 ${binding.stepId} 与冻结 Skill 身份不一致`)
    }
  }
}

async function verifySemanticReviewEvidence(
  candidate: ProseGenerationCandidateV1,
): Promise<boolean> {
  const evidence = candidate.semanticReview
  if (!evidence || evidence.version !== 1 || evidence.final.verdict !== 'pass') return false
  try {
    new AgentTeamBudgetTracker(evidence.budget.profile, evidence.budget)
    const verifyBinding = async (
      binding: AgentSkillExecutionBindingV1 | AgentSkillExecutionBindingV2,
      skillId: 'prose.review' | 'prose.revise',
      label: string,
    ) => {
      if (binding.version === 1) {
        assertAgentSkillExecutionBindingV1(binding, getAgentSkillV1(skillId, 'prose'), label)
      } else {
        await assertAgentSkillExecutionBindingIntegrityV2(binding, label)
        if (binding.skillId !== skillId) throw new Error(`${label} Skill 身份不一致`)
      }
    }
    await verifyBinding(evidence.initial.reviewer.executionBinding, 'prose.review', '正文语义初审 execution binding')
    await verifyBinding(evidence.final.reviewer.executionBinding, 'prose.review', '正文语义复核 execution binding')
    if (evidence.revision) {
      await verifyBinding(evidence.revision.executionBinding, 'prose.revise', '正文语义修订 execution binding')
    }
  } catch {
    return false
  }
  if (!await verifyProseSemanticReviewArtifactV1({
    artifact: evidence.initial,
    ...(evidence.revision
      ? { candidateTextHash: evidence.revision.sourceCandidateTextHash }
      : { candidateText: candidate.outputText }),
  })) return false
  if (!await verifyProseSemanticReviewArtifactV1({
    artifact: evidence.final,
    candidateText: candidate.outputText,
  })) return false
  if (!evidence.revision) {
    return evidence.initial.artifactHash === evidence.final.artifactHash
      && evidence.initial.round === 1
      && evidence.initial.verdict === 'pass'
  }
  if (
    evidence.initial.round !== 1
    || evidence.initial.verdict !== 'revise'
    || evidence.final.round !== 2
    || evidence.revision.sourceReviewArtifactHash !== evidence.initial.artifactHash
    || evidence.revision.outputTextHash !== await hashCanonicalValue(candidate.outputText)
    || evidence.initial.candidateTextHash !== evidence.revision.sourceCandidateTextHash
  ) return false
  return verifyProseSemanticRevisionArtifactV1(evidence.revision)
}

function hasSemanticStepEvidence(
  snapshot: AgentRunSnapshotV1,
  input: {
    stepId: ProseSemanticStepIdV1
    artifactHash: string
    contextManifestHash?: string
  },
): boolean {
  const step = snapshot.projection.steps[input.stepId]
  if (step?.status !== 'succeeded' || step.outputHash !== input.artifactHash) return false
  if (!input.contextManifestHash) return true
  return snapshot.events.some(event => (
    event.type === 'context.assembled'
      && event.payload.stepId === input.stepId
      && event.payload.attempt === 1
      && event.payload.manifestHash === input.contextManifestHash
  ))
}

function verifySemanticReviewDurableEvidence(
  snapshot: AgentRunSnapshotV1,
  candidate: ProseGenerationCandidateV1,
): boolean {
  const evidence = candidate.semanticReview
  if (!evidence) return !requiresSemanticReview(snapshot)
  if (!hasSemanticStepEvidence(snapshot, {
    stepId: PROSE_SEMANTIC_REVIEW_STEP_ID_V1,
    artifactHash: evidence.initial.artifactHash,
    contextManifestHash: evidence.initial.contextManifestHash,
  })) return false
  if (!evidence.revision) {
    return evidence.initial.artifactHash === evidence.final.artifactHash
  }
  return hasSemanticStepEvidence(snapshot, {
    stepId: PROSE_SEMANTIC_REVISION_STEP_ID_V1,
    artifactHash: evidence.revision.artifactHash,
  }) && hasSemanticStepEvidence(snapshot, {
    stepId: PROSE_SEMANTIC_REREVIEW_STEP_ID_V1,
    artifactHash: evidence.final.artifactHash,
    contextManifestHash: evidence.final.contextManifestHash,
  })
}

export async function createProseGenerationDurableRunV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  chapterId: number
  operation: ProseGenerationOperationV1
  semanticReview?: boolean
  perspectiveCharacterId?: number | null
  generationBinding?: AgentSkillExecutionBindingV2
}): Promise<AgentRunSnapshotV1> {
  const formalEntry = await freezeFormalAIEntryBindingV1(proseGenerationFormalEntryIdV1(input.operation))
  return createAgentRunV1({
    scope: input.scope,
    worldGroupId: input.worldGroupId,
    contract: await buildProseGenerationRunContractV3({
      projectId: input.scope.projectId,
      worldGroupId: input.worldGroupId,
      chapterId: input.chapterId,
      operation: input.operation,
      semanticReview: input.semanticReview,
      perspectiveCharacterId: input.perspectiveCharacterId,
      generationBinding: input.generationBinding,
      formalEntry,
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

export async function proseGenerationManifestV1(input: {
  runId: number
  scope: WorkspaceScope
  worldGroupId: number | null
  chapterId: number
  outlineNodeId: number
  operation: ProseGenerationOperationV1
  assembled: AssembleContextResult
}): Promise<ContextManifestV1> {
  return createContextManifestFromAssemblyV1({
    runId: input.runId,
    stepId: PROSE_GENERATION_STEP_ID_V1,
    attempt: 1,
    projectId: input.scope.projectId,
    worldGroupId: input.worldGroupId,
    declaredSourceKeys: resolveAgentSkillContextSourceKeysV1(getAgentSkillV1(`prose.${input.operation}`, 'prose')),
    assembled: input.assembled,
    boundary: { chapterId: input.chapterId, outlineNodeId: input.outlineNodeId },
    readerVersion: 'chapter-prose-gateway-context-v1',
  })
}

export interface ProseGatewayAttemptV1 {
  execution: ContextGatewayExecutionV1
  baseManifest: ContextManifestV2
  preflight: ContextGatewayPreflightEvidenceV1
}

/** Required-Gateway prose path: exact packet and rendered request are durable
 * before the registered model entry is called. */
export async function beginProseGenerationGatewayStepV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  worldGroupId: number | null
  chapterId: number
  outlineNodeId: number
  assembled: AssembleContextResult
  messages: ChatMessage[]
  binding: {
    operation: ProseGenerationOperationV1
    sourceTextHash: string
    promptHash: string
    informationBoundaryHash?: string
  }
  budgetReservationTokens?: number
}): Promise<{ snapshot: AgentRunSnapshotV1; attempt: ProseGatewayAttemptV1 }> {
  assertProseGenerationExecutionBindingsV1(input.snapshot)
  const frozen = input.snapshot.contract.executionBindings?.find(item => item.stepId === PROSE_GENERATION_STEP_ID_V1)
  if (frozen?.version === 2) {
    const { stepId: _stepId, formalEntry: _formalEntry, ...skillBinding } = frozen
    await assertAgentSkillExecutionBindingIntegrityV2(skillBinding, '正文 required Gateway binding')
  }
  const execution = proseGatewayExecutionFromAssemblyV1(input.assembled)
  if (!execution) throw new Error('正式正文生成缺少 required Context Gateway 执行结果。')
  const formalEntry = frozen?.formalEntry
  if (!formalEntry) throw new Error('正文生成 RunContract 缺少 FormalAIEntry snapshot。')
  const entry = await assertFormalAIEntrySnapshotIntegrityV1(formalEntry)
  if (entry.entryId !== proseGenerationFormalEntryIdV1(input.binding.operation)
    || entry.skillId !== `prose.${input.binding.operation}` || !entry.adoptAllowed
    || !entry.adoptionTargets.includes('chapters')) {
    throw new Error('正文生成 FormalAIEntry 与 operation/Skill/采纳目标不匹配。')
  }
  const manifestV1 = await proseGenerationManifestV1({
    runId: input.snapshot.run.id,
    scope: input.scope,
    worldGroupId: input.worldGroupId,
    chapterId: input.chapterId,
    outlineNodeId: input.outlineNodeId,
    operation: input.binding.operation,
    assembled: input.assembled,
  })
  const baseManifest = await createContextManifestV2FromV1({ manifest: manifestV1, scope: input.scope })
  let snapshot = await append(input.scope, input.snapshot, 'step.scheduled', { stepId: PROSE_GENERATION_STEP_ID_V1 })
  snapshot = await append(input.scope, snapshot, 'step.started', { stepId: PROSE_GENERATION_STEP_ID_V1, attempt: 1 })
  const recorded = await recordContextGatewayPreflightEvidenceV1({
    scope: input.scope,
    runId: snapshot.run.id,
    stepId: PROSE_GENERATION_STEP_ID_V1,
    attempt: 1,
    contextPacket: execution.contextPacket,
    selector: execution.selector,
    renderedRequest: input.messages,
    sourceSnapshots: execution.sourceSnapshots,
    toolTranscript: execution.toolTranscript,
    expectedLastSequence: snapshot.projection.lastSequence,
  })
  snapshot = await append(input.scope, recorded.snapshot, 'model.requested', {
    stepId: PROSE_GENERATION_STEP_ID_V1,
    attempt: 1,
    bindingHash: await hashCanonicalValue(input.binding),
  })
  if (input.budgetReservationTokens != null) {
    snapshot = await append(input.scope, snapshot, 'budget.reserved', {
      stepId: PROSE_GENERATION_STEP_ID_V1,
      modelCalls: 1,
      toolCalls: 0,
      tokens: Math.max(1, Math.floor(input.budgetReservationTokens)),
    })
  }
  return { snapshot, attempt: { execution, baseManifest, preflight: recorded.evidence } }
}

/** Finalize exact response and ContextManifestV3 before candidate.persisted. */
export async function finalizeProseGenerationGatewayStepV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  attempt: ProseGatewayAttemptV1
  output: string
  usedTokens?: number
}): Promise<{ snapshot: AgentRunSnapshotV1; manifest: ContextManifestV3 }> {
  const outputHash = await hashCanonicalValue(input.output)
  let snapshot = await append(input.scope, input.snapshot, 'model.responded', {
    stepId: PROSE_GENERATION_STEP_ID_V1,
    attempt: 1,
    outputHash,
  })
  if (input.usedTokens != null) {
    snapshot = await append(input.scope, snapshot, 'budget.settled', {
      stepId: PROSE_GENERATION_STEP_ID_V1,
      modelCalls: 1,
      toolCalls: 0,
      tokens: Math.max(0, Math.floor(input.usedTokens)),
    })
  }
  const finalized = await finalizeContextGatewayAttemptEvidenceV1({
    scope: input.scope,
    runId: snapshot.run.id,
    stepId: PROSE_GENERATION_STEP_ID_V1,
    attempt: 1,
    baseManifest: input.attempt.baseManifest,
    preflight: input.attempt.preflight,
    selector: input.attempt.execution.selector,
    sufficiency: input.attempt.execution.sufficiency,
    retrievalTrace: input.attempt.execution.retrievalTrace,
    gatewayVersionHash: input.attempt.execution.contextPacket.gatewayVersionHash,
    policyHash: input.attempt.execution.contextPacket.policyHash,
    rawResponse: input.output,
    candidateHash: outputHash,
    expectedLastSequence: snapshot.projection.lastSequence,
  })
  return { snapshot: finalized.snapshot, manifest: finalized.manifest }
}

export async function beginProseGenerationStepV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  contextManifest: ContextManifestV1
  binding: {
    operation: ProseGenerationOperationV1
    sourceTextHash: string
    promptHash: string
    informationBoundaryHash?: string
  }
  budgetReservationTokens?: number
}): Promise<AgentRunSnapshotV1> {
  assertProseGenerationExecutionBindingsV1(input.snapshot)
  const formalSnapshot = input.snapshot.contract.executionBindings
    ?.find(item => item.stepId === PROSE_GENERATION_STEP_ID_V1)?.formalEntry
  if (!formalSnapshot) throw new Error('正文生成 RunContract 缺少 FormalAIEntry snapshot。')
  const formalEntry = await assertFormalAIEntrySnapshotIntegrityV1(formalSnapshot)
  if (formalEntry.entryId !== proseGenerationFormalEntryIdV1(input.binding.operation)
    || formalEntry.skillId !== `prose.${input.binding.operation}`
    || !formalEntry.adoptAllowed || !formalEntry.adoptionTargets.includes('chapters')) {
    throw new Error('正文生成 FormalAIEntry 与 operation/Skill/采纳目标不匹配。')
  }
  if (input.contextManifest.runId !== input.snapshot.run.id
    || input.contextManifest.stepId !== PROSE_GENERATION_STEP_ID_V1) {
    throw new Error('正文生成 Context Manifest 与 durable run 不匹配。')
  }
  let snapshot = await append(input.scope, input.snapshot, 'step.scheduled', {
    stepId: PROSE_GENERATION_STEP_ID_V1,
  })
  snapshot = await append(input.scope, snapshot, 'step.started', {
    stepId: PROSE_GENERATION_STEP_ID_V1,
    attempt: 1,
  })
  snapshot = await append(input.scope, snapshot, 'context.assembled', {
    stepId: PROSE_GENERATION_STEP_ID_V1,
    attempt: 1,
    manifestHash: input.contextManifest.manifestHash,
  })
  snapshot = await append(input.scope, snapshot, 'model.requested', {
    stepId: PROSE_GENERATION_STEP_ID_V1,
    attempt: 1,
    bindingHash: await hashCanonicalValue(input.binding),
  })
  if (input.budgetReservationTokens == null) return snapshot
  return append(input.scope, snapshot, 'budget.reserved', {
    stepId: PROSE_GENERATION_STEP_ID_V1,
    modelCalls: 1,
    toolCalls: 0,
    tokens: Math.max(1, Math.floor(input.budgetReservationTokens)),
  })
}

export async function recordProseGenerationModelOutputV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  output: string
  usedTokens?: number
}): Promise<AgentRunSnapshotV1> {
  const step = input.snapshot.projection.steps[PROSE_GENERATION_STEP_ID_V1]
  if (!step || step.status !== 'running' || step.attempt !== 1) {
    throw new Error('正文生成 durable step 不在模型响应状态。')
  }
  let snapshot = await append(input.scope, input.snapshot, 'model.responded', {
    stepId: PROSE_GENERATION_STEP_ID_V1,
    attempt: 1,
    outputHash: await hashCanonicalValue(input.output),
  })
  if (input.usedTokens == null) return snapshot
  snapshot = await append(input.scope, snapshot, 'budget.settled', {
    stepId: PROSE_GENERATION_STEP_ID_V1,
    modelCalls: 1,
    toolCalls: 0,
    tokens: Math.max(0, Math.floor(input.usedTokens)),
  })
  return snapshot
}

export type ProseSemanticStepIdV1 =
  | typeof PROSE_SEMANTIC_REVIEW_STEP_ID_V1
  | typeof PROSE_SEMANTIC_REVISION_STEP_ID_V1
  | typeof PROSE_SEMANTIC_REREVIEW_STEP_ID_V1

export async function beginProseSemanticStepV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  stepId: ProseSemanticStepIdV1
  contextManifest: ContextManifestV1
  executionBinding: AgentSkillExecutionBindingV1 | AgentSkillExecutionBindingV2
  requestBinding: unknown
  reservedTokens: number
}): Promise<AgentRunSnapshotV1> {
  assertProseGenerationExecutionBindingsV1(input.snapshot)
  if (
    input.contextManifest.runId !== input.snapshot.run.id
    || input.contextManifest.stepId !== input.stepId
    || input.contextManifest.attempt !== 1
  ) throw new Error(`正文语义步骤 ${input.stepId} Context Manifest 不匹配。`)
  const contractBinding = input.snapshot.contract.executionBindings?.find(binding => binding.stepId === input.stepId)
  if (!contractBinding) throw new Error(`正文语义步骤 ${input.stepId} 缺少冻结 execution binding。`)
  const { stepId: _stepId, ...expectedBinding } = contractBinding
  if (JSON.stringify(expectedBinding) !== JSON.stringify(input.executionBinding)) {
    throw new Error(`正文语义步骤 ${input.stepId} execution binding 与 RunContract 不一致。`)
  }
  let snapshot = await append(input.scope, input.snapshot, 'step.scheduled', { stepId: input.stepId })
  snapshot = await append(input.scope, snapshot, 'step.started', { stepId: input.stepId, attempt: 1 })
  snapshot = await append(input.scope, snapshot, 'context.assembled', {
    stepId: input.stepId,
    attempt: 1,
    manifestHash: input.contextManifest.manifestHash,
  })
  snapshot = await append(input.scope, snapshot, 'model.requested', {
    stepId: input.stepId,
    attempt: 1,
    bindingHash: await hashCanonicalValue({
      executionBinding: input.executionBinding,
      request: input.requestBinding,
      contextManifestHash: input.contextManifest.manifestHash,
    }),
  })
  return append(input.scope, snapshot, 'budget.reserved', {
    stepId: input.stepId,
    modelCalls: 1,
    toolCalls: 0,
    tokens: Math.max(1, Math.floor(input.reservedTokens)),
  })
}

export async function recordProseSemanticModelOutputV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  stepId: ProseSemanticStepIdV1
  output: string
  usedTokens: number
}): Promise<AgentRunSnapshotV1> {
  const step = input.snapshot.projection.steps[input.stepId]
  if (!step || step.status !== 'running' || step.attempt !== 1) {
    throw new Error(`正文语义步骤 ${input.stepId} 不在模型响应状态。`)
  }
  let snapshot = await append(input.scope, input.snapshot, 'model.responded', {
    stepId: input.stepId,
    attempt: 1,
    outputHash: await hashCanonicalValue(input.output),
  })
  snapshot = await append(input.scope, snapshot, 'budget.settled', {
    stepId: input.stepId,
    modelCalls: 1,
    toolCalls: 0,
    tokens: Math.max(0, Math.floor(input.usedTokens)),
  })
  return snapshot
}

export async function completeProseSemanticStepV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  stepId: ProseSemanticStepIdV1
  artifactHash: string
}): Promise<AgentRunSnapshotV1> {
  return append(input.scope, input.snapshot, 'step.succeeded', {
    stepId: input.stepId,
    attempt: 1,
    outputHash: input.artifactHash,
  })
}

export async function failProseSemanticStepV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  stepId: ProseSemanticStepIdV1
  code: string
}): Promise<AgentRunSnapshotV1> {
  const step = input.snapshot.projection.steps[input.stepId]
  if (!step || step.status !== 'running') return input.snapshot
  return append(input.scope, input.snapshot, 'step.failed', {
    stepId: input.stepId,
    attempt: step.attempt,
    code: input.code.trim().slice(0, 160) || 'prose_semantic_step_failed',
    retryable: false,
  })
}

function isProseGenerationCandidate(value: unknown): value is ProseGenerationCandidateV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<ProseGenerationCandidateV1>
  const valid = candidate.version === 1
    && candidate.type === PROSE_GENERATION_CANDIDATE_TYPE_V1
    && typeof candidate.projectId === 'number'
    && typeof candidate.chapterId === 'number'
    && (candidate.operation === 'generate' || candidate.operation === 'continue')
    && typeof candidate.sourceTextHash === 'string'
    && typeof candidate.outputText === 'string'
    && typeof candidate.outputTextHash === 'string'
    && (candidate.gatewayEvidenceVersion === undefined || candidate.gatewayEvidenceVersion === 3)
    && typeof candidate.expectedContentHash === 'string'
    && (candidate.informationBoundaryHash === undefined || typeof candidate.informationBoundaryHash === 'string')
    && (candidate.perspectiveCharacterId === undefined
      || candidate.perspectiveCharacterId === null
      || typeof candidate.perspectiveCharacterId === 'number')
    && (candidate.perspectiveFromChapter === undefined || typeof candidate.perspectiveFromChapter === 'boolean')
    && (candidate.semanticReview === undefined || (
      !!candidate.semanticReview
      && candidate.semanticReview.version === 1
      && candidate.semanticReview.initial?.type === 'prose-semantic-review'
      && candidate.semanticReview.final?.type === 'prose-semantic-review'
      && !!candidate.semanticReview.budget
    ))
    && !!candidate.durable
    && candidate.durable.stepId === PROSE_GENERATION_STEP_ID_V1
  if (!valid) return false
  if (candidate.contentRevision !== undefined) {
    try {
      candidate.contentRevision = parseWorkspaceContentRevisionV1(candidate.contentRevision)
    } catch {
      return false
    }
  }
  return true
}

export async function hashProseGenerationCandidateV1(
  candidate: Omit<ProseGenerationCandidateV1, 'durable'>,
): Promise<string> {
  // ContextManifestV3 already binds the exact response/candidate hash. Using
  // outputTextHash avoids a circular hash through durable.contextManifestHash.
  if (candidate.gatewayEvidenceVersion === 3) return candidate.outputTextHash
  return hashCanonicalValue(candidate)
}

export async function persistProseGenerationCandidateV1(input: {
  scope: WorkspaceScope
  candidate: ProseGenerationCandidateV1
}): Promise<{ conversation: AgentConversation & { id: number }; event: AgentEvent & { id: number } }> {
  const { durable, ...candidateBody } = input.candidate
  if (await hashProseGenerationCandidateV1(candidateBody) !== durable.candidateHash) {
    throw new Error('正文生成候选 hash 不匹配。')
  }
  if (input.candidate.semanticReview && !await verifySemanticReviewEvidence(input.candidate)) {
    throw new Error('正文生成候选的语义评审证据无效。')
  }
  if (input.candidate.semanticReview) {
    const snapshot = await readAgentRunV1(input.scope, input.candidate.durable.runId)
    assertProseGenerationExecutionBindingsV1(snapshot)
    if (!verifySemanticReviewDurableEvidence(snapshot, input.candidate)) {
      throw new Error('正文生成候选的语义评审证据与 durable ledger 不一致。')
    }
  }
  const chapter = await db.chapters.get(input.candidate.chapterId)
  if (!chapter || !await assertRecordInScope(input.scope, 'chapters', chapter, { owner: 'work' })) {
    throw new Error('正文生成候选的章节不存在或越界。')
  }
  const now = Date.now()
  const conversation = stampNewRecord(input.scope, 'agentConversations', {
    projectId: input.scope.projectId,
    worldGroupId: input.candidate.worldGroupId,
    title: `${input.candidate.operation === 'continue' ? '续写' : '生成正文'} · ${input.candidate.chapterTitle}`,
    status: 'archived',
    createdAt: now,
    updatedAt: now,
  }, { owner: 'work' }) as AgentConversation
  return db.transaction(
    'rw',
    scopeTransactionTables(db.agentConversations, db.agentEvents),
    async () => {
      const conversationId = await db.agentConversations.add(conversation) as number
      const event = stampNewRecord(input.scope, 'agentEvents', {
        projectId: input.scope.projectId,
        conversationId,
        durableRunId: input.candidate.durable.runId,
        sequence: 1,
        kind: 'candidate',
        content: `正文生成候选 ${input.candidate.outputText.length} 字`,
        payload: JSON.stringify(input.candidate),
        createdAt: now,
      }, { owner: 'work' }) as AgentEvent
      const eventId = await db.agentEvents.add(event) as number
      return {
        conversation: { ...conversation, id: conversationId },
        event: { ...event, id: eventId },
      }
    },
  )
}

export async function recordProseGenerationCandidateV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  candidate: ProseGenerationCandidateV1
}): Promise<AgentRunSnapshotV1> {
  const durable = input.candidate.durable
  if (durable.runId !== input.snapshot.run.id) throw new Error('正文生成候选 durable evidence 不匹配。')
  const { durable: _durable, ...candidateBody } = input.candidate
  if (await hashProseGenerationCandidateV1(candidateBody) !== durable.candidateHash) {
    throw new Error('正文生成候选 hash 不匹配。')
  }
  assertProseGenerationExecutionBindingsV1(input.snapshot)
  if (requiresSemanticReview(input.snapshot) && !await verifySemanticReviewEvidence(input.candidate)) {
    throw new Error('正文生成候选缺少新鲜语义评审证据。')
  }
  if (requiresSemanticReview(input.snapshot)
    && !verifySemanticReviewDurableEvidence(input.snapshot, input.candidate)) {
    throw new Error('正文生成候选的语义评审证据与 durable ledger 不一致。')
  }
  const step = input.snapshot.projection.steps[PROSE_GENERATION_STEP_ID_V1]
  if (!step || step.status !== 'running' || step.attempt !== durable.attempt) {
    throw new Error('正文生成 durable step 不在候选持久化状态。')
  }
  const alreadyResponded = input.snapshot.events.some(event => (
    event.type === 'model.responded'
      && event.payload.stepId === PROSE_GENERATION_STEP_ID_V1
      && event.payload.attempt === durable.attempt
  ))
  let snapshot = input.snapshot
  if (!alreadyResponded) {
    snapshot = await append(input.scope, snapshot, 'model.responded', {
      stepId: PROSE_GENERATION_STEP_ID_V1,
      attempt: durable.attempt,
      outputHash: durable.candidateHash,
    })
  }
  return append(input.scope, snapshot, 'candidate.persisted', {
    stepId: PROSE_GENERATION_STEP_ID_V1,
    attempt: durable.attempt,
    candidateHash: durable.candidateHash,
    requiresConfirmation: true,
  })
}

export async function readLatestProseGenerationCandidateV1(input: {
  scope: WorkspaceScope
  chapterId: number
}): Promise<ProseGenerationCandidateV1 | null> {
  const events = await readOwnedRows<AgentEvent>(input.scope, 'agentEvents', { owner: 'work' })
  const matches = events
    .map(event => {
      try { return { event, value: JSON.parse(event.payload) as unknown } } catch { return null }
    })
    .filter((value): value is { event: AgentEvent; value: ProseGenerationCandidateV1 } => (
      !!value
      && isProseGenerationCandidate(value.value)
      && value.value.chapterId === input.chapterId
      && value.value.projectId === input.scope.projectId
    ))
    .sort((left, right) => right.event.createdAt - left.event.createdAt)
  return matches[0]?.value ?? null
}

export async function isProseGenerationCandidateCurrentV1(
  candidate: ProseGenerationCandidateV1,
): Promise<boolean> {
  const chapter = await db.chapters.get(candidate.chapterId)
  if (!chapter || await hashChapterText(chapter.content ?? '') !== candidate.sourceTextHash) return false
  const { durable, ...candidateBody } = candidate
  if (await hashProseGenerationCandidateV1(candidateBody) !== durable.candidateHash) return false
  if (candidate.semanticReview && !await verifySemanticReviewEvidence(candidate)) return false
  let scope: WorkspaceScope
  let run: AgentRunSnapshotV1
  try {
    scope = await resolveScopeForCandidate(candidate)
    run = await readAgentRunV1(scope, candidate.durable.runId)
  } catch {
    return false
  }
  if (candidate.semanticReview) {
    try {
      scope = await resolveScopeForCandidate(candidate)
      const snapshot = await readAgentRunV1(scope, candidate.durable.runId)
      assertProseGenerationExecutionBindingsV1(snapshot)
      if (!verifySemanticReviewDurableEvidence(snapshot, candidate)) return false
    } catch {
      return false
    }
  }
  if (
    candidate.perspectiveFromChapter
    && (chapter.perspectiveCharacterId ?? null) !== (candidate.perspectiveCharacterId ?? null)
  ) return false
  if (!candidate.informationBoundaryHash) return !requiresProseInformationBoundaryV1(run)
  try {
    scope ??= await resolveScopeForCandidate(candidate)
    const boundary = await buildChapterInformationBoundaryV1({
      scope,
      chapterId: candidate.chapterId,
      outlineNodeId: chapter.outlineNodeId,
      worldGroupId: candidate.worldGroupId,
      perspectiveCharacterId: candidate.perspectiveCharacterId ?? null,
    })
    return boundary.manifestHash === candidate.informationBoundaryHash
      && validateProseInformationBoundaryV1(candidate.outputText, boundary).length === 0
  } catch {
    return false
  }
}

async function resolveScopeForCandidate(candidate: ProseGenerationCandidateV1): Promise<WorkspaceScope> {
  const chapter = await db.chapters.get(candidate.chapterId)
  const workId = (chapter as (Chapter & { workId?: number }) | undefined)?.workId
  if (workId != null) {
    const work = await db.works.get(workId)
    if (work?.id != null && work.projectId === candidate.projectId) {
      return { projectId: candidate.projectId, worldId: work.worldId, workId: work.id }
    }
  }
  return resolveScope({ projectId: candidate.projectId })
}

/** Recover an event-store crash window without calling the model again. */
export async function recoverProseGenerationCandidateV1(input: {
  scope: WorkspaceScope
  candidate: ProseGenerationCandidateV1
}): Promise<AgentRunSnapshotV1 | null> {
  if (!await isProseGenerationCandidateCurrentV1(input.candidate)) return null
  const snapshot = await readAgentRunV1(input.scope, input.candidate.durable.runId)
  assertProseGenerationExecutionBindingsV1(snapshot)
  if (requiresSemanticReview(snapshot) && (
    !await verifySemanticReviewEvidence(input.candidate)
      || !verifySemanticReviewDurableEvidence(snapshot, input.candidate)
  )) return null
  const step = snapshot.projection.steps[PROSE_GENERATION_STEP_ID_V1]
  if (step?.candidateHash === input.candidate.durable.candidateHash) return snapshot
  if (step?.status !== 'running') return null
  return recordProseGenerationCandidateV1({
    scope: input.scope,
    snapshot,
    candidate: input.candidate,
  })
}

export async function failProseGenerationStepV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  code: string
  retryable?: boolean
}): Promise<AgentRunSnapshotV1> {
  const step = input.snapshot.projection.steps[PROSE_GENERATION_STEP_ID_V1]
  if (!step || !['running', 'scheduled'].includes(step.status)) return input.snapshot
  let snapshot = input.snapshot
  if (step.status === 'scheduled') {
    snapshot = await append(input.scope, snapshot, 'step.started', {
      stepId: PROSE_GENERATION_STEP_ID_V1,
      attempt: 1,
    })
  }
  return append(input.scope, snapshot, 'step.failed', {
    stepId: PROSE_GENERATION_STEP_ID_V1,
    attempt: step.status === 'scheduled' ? 1 : step.attempt,
    code: input.code.slice(0, 160),
    retryable: input.retryable ?? true,
  })
}

export async function markProseGenerationStaleV1(input: {
  scope: WorkspaceScope
  runId: number
  reason: string
}): Promise<AgentRunSnapshotV1> {
  const snapshot = await readAgentRunV1(input.scope, input.runId)
  const step = snapshot.projection.steps[PROSE_GENERATION_STEP_ID_V1]
  if (!step?.candidateHash || step.status === 'stale' || ['completed', 'failed', 'cancelled'].includes(snapshot.projection.state)) {
    return snapshot
  }
  return append(input.scope, snapshot, 'candidate.staled', {
    stepId: PROSE_GENERATION_STEP_ID_V1,
    candidateHash: step.candidateHash,
    reason: input.reason.slice(0, 1_000),
  })
}

export async function rejectProseGenerationCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
  candidate: ProseGenerationCandidateV1
}): Promise<AgentRunSnapshotV1> {
  const snapshot = await readAgentRunV1(input.scope, input.runId)
  const step = snapshot.projection.steps[PROSE_GENERATION_STEP_ID_V1]
  if (
    step?.status !== 'awaiting_confirmation'
    || step.candidateHash !== input.candidate.durable.candidateHash
  ) return snapshot
  return append(input.scope, snapshot, 'confirmation.recorded', {
    stepId: PROSE_GENERATION_STEP_ID_V1,
    candidateHash: input.candidate.durable.candidateHash,
    decision: 'reject',
  })
}

async function prosePostStateHash(input: { scope: WorkspaceScope; chapterId: number }): Promise<string> {
  const chapter = await db.chapters.get(input.chapterId)
  if (!chapter || !await assertRecordInScope(input.scope, 'chapters', chapter, { owner: 'work' })) {
    throw new Error('正文生成终态校验找不到章节。')
  }
  return hashCanonicalValue({
    version: 1,
    chapterId: input.chapterId,
    content: chapter.content,
    wordCount: chapter.wordCount,
  })
}

export async function commitProseGenerationAdoptionV1(input: {
  scope: WorkspaceScope
  runId: number
  candidate: ProseGenerationCandidateV1
  contentHtml: string
  wordCount: number
}): Promise<{ snapshot: AgentRunSnapshotV1; receiptHash: string; receipt?: VerificationReceiptV1 }> {
  if (input.candidate.contentRevision) {
    try {
      await assertWorkspaceContentRevisionFreshV1(input.candidate.contentRevision, {
        scope: input.scope,
        worldGroupId: input.candidate.worldGroupId,
      })
    } catch (error) {
      await markProseGenerationStaleV1({
        scope: input.scope,
        runId: input.runId,
        reason: error instanceof Error ? error.message : 'content_revision_changed',
      })
      throw new Error(`正文候选已过期：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (input.candidate.gatewayEvidenceVersion === 3) {
    await assertContextGatewayCandidateAdoptableV1({
      skill: getAgentSkillV1(`prose.${input.candidate.operation}`, 'prose'),
      writeTarget: 'chapters.content',
      scope: input.scope,
      worldGroupId: input.candidate.worldGroupId,
      chapterId: input.candidate.chapterId,
      characterId: input.candidate.perspectiveCharacterId ?? null,
      runId: input.runId,
      stepId: input.candidate.durable.stepId,
      attempt: input.candidate.durable.attempt,
      candidateHash: input.candidate.durable.candidateHash,
      contextManifestHash: input.candidate.durable.contextManifestHash,
    })
  }
  if (!await isProseGenerationCandidateCurrentV1(input.candidate)) {
    await markProseGenerationStaleV1({
      scope: input.scope,
      runId: input.runId,
      reason: '正文 hash 已变化；旧正文候选不可提交。',
    })
    throw new Error('章节正文已变化，这批正文候选已过期；请重新生成。')
  }
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  assertProseGenerationExecutionBindingsV1(snapshot)
  if (requiresSemanticReview(snapshot) && (
    !await verifySemanticReviewEvidence(input.candidate)
      || !verifySemanticReviewDurableEvidence(snapshot, input.candidate)
  )) {
    throw new Error('正文候选没有通过当前合同要求的语义评审。')
  }
  const step = snapshot.projection.steps[PROSE_GENERATION_STEP_ID_V1]
  if (!step || step.status !== 'awaiting_confirmation' || step.candidateHash !== input.candidate.durable.candidateHash) {
    throw new Error('正文生成候选不在等待作者确认状态。')
  }
  const outputContentHash = await hashChapterText(input.contentHtml)
  if (outputContentHash !== input.candidate.expectedContentHash) {
    snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
      stepId: PROSE_GENERATION_STEP_ID_V1,
      candidateHash: input.candidate.durable.candidateHash,
      decision: 'adopt',
    })
    snapshot = await append(input.scope, snapshot, 'adoption.rejected', {
      stepId: PROSE_GENERATION_STEP_ID_V1,
      candidateHash: input.candidate.durable.candidateHash,
      code: 'prose_adoption_output_mismatch',
    })
    throw new Error('正文编辑器的待写入内容与作者确认的候选不一致。')
  }
  snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
    stepId: PROSE_GENERATION_STEP_ID_V1,
    candidateHash: input.candidate.durable.candidateHash,
    decision: 'adopt',
  })
  snapshot = await append(input.scope, snapshot, 'adoption.started', {
    stepId: PROSE_GENERATION_STEP_ID_V1,
    candidateHash: input.candidate.durable.candidateHash,
    intentHash: await hashCanonicalValue({
      chapterId: input.candidate.chapterId,
      operation: input.candidate.operation,
      sourceTextHash: input.candidate.sourceTextHash,
    }),
  })
  let result
  try {
    result = await adopt({
      projectId: input.scope.projectId,
      scope: input.scope,
      target: 'chapters',
      recordId: input.candidate.chapterId,
      mode: 'replace',
      data: {
        content: input.contentHtml,
        wordCount: input.wordCount,
      },
      compareAndSet: {
        kind: 'chapter-source-text-hash',
        expectedHash: input.candidate.sourceTextHash,
        textNormalizationVersion: CHAPTER_TEXT_NORMALIZATION_VERSION,
      },
    })
  } catch (error) {
    const current = await readAgentRunV1(input.scope, input.runId)
    if (current.projection.state === 'running') {
      await append(input.scope, current, 'adoption.rejected', {
        stepId: PROSE_GENERATION_STEP_ID_V1,
        candidateHash: input.candidate.durable.candidateHash,
        code: error instanceof Error ? error.message : 'prose_adoption_failed',
      })
    }
    throw error
  }
  if (!result.written.some(item => item.id === input.candidate.chapterId && item.fields.includes('content'))) {
    const current = await readAgentRunV1(input.scope, input.runId)
    if (current.projection.state === 'running') {
      await append(input.scope, current, 'adoption.rejected', {
        stepId: PROSE_GENERATION_STEP_ID_V1,
        candidateHash: input.candidate.durable.candidateHash,
        code: result.skipped[0]?.reason || 'prose_adoption_skipped',
      })
    }
    throw new Error(result.skipped[0]?.reason || '正文候选没有写入章节。')
  }
  const adoptionHash = await hashCanonicalValue({
    version: 1,
    candidateHash: input.candidate.durable.candidateHash,
    chapterId: input.candidate.chapterId,
    sourceTextHash: input.candidate.sourceTextHash,
    outputContentHash,
    wordCount: input.wordCount,
  })
  snapshot = await append(input.scope, snapshot, 'adoption.committed', {
    stepId: PROSE_GENERATION_STEP_ID_V1,
    candidateHash: input.candidate.durable.candidateHash,
    adoptionHash,
  })
  snapshot = await append(input.scope, snapshot, 'step.succeeded', {
    stepId: PROSE_GENERATION_STEP_ID_V1,
    attempt: input.candidate.durable.attempt,
    outputHash: input.candidate.durable.candidateHash,
  })
  return verifyProseGenerationRunV1({
    scope: input.scope,
    runId: input.runId,
    candidate: input.candidate,
    snapshot,
  })
}

export async function verifyProseGenerationRunV1(input: {
  scope: WorkspaceScope
  runId: number
  candidate: ProseGenerationCandidateV1
  snapshot?: AgentRunSnapshotV1
}): Promise<{ snapshot: AgentRunSnapshotV1; receiptHash: string; receipt?: VerificationReceiptV1 }> {
  let snapshot = input.snapshot ?? await readAgentRunV1(input.scope, input.runId)
  if (snapshot.projection.state === 'completed' && snapshot.run.terminalReceiptHash) {
    return { snapshot, receiptHash: snapshot.run.terminalReceiptHash }
  }
  const step = snapshot.projection.steps[PROSE_GENERATION_STEP_ID_V1]
  assertProseGenerationExecutionBindingsV1(snapshot)
  const semanticRequired = requiresSemanticReview(snapshot)
  if (semanticRequired && (
    !await verifySemanticReviewEvidence(input.candidate)
      || !verifySemanticReviewDurableEvidence(snapshot, input.candidate)
  )) {
    throw new Error('正文生成终态校验发现语义评审证据缺失、过期或被篡改。')
  }
  const adoption = snapshot.events.find(event => (
    event.type === 'adoption.committed'
      && event.payload.stepId === PROSE_GENERATION_STEP_ID_V1
      && event.payload.candidateHash === input.candidate.durable.candidateHash
  ))
  const adoptionRecord = (await db.agentRunEvents.where('runId').equals(input.runId).toArray())
    .find(event => {
      if (event.type !== 'adoption.committed' || event.id == null) return false
      try {
        const payload = JSON.parse(event.payloadJson) as Record<string, unknown>
        return payload.stepId === PROSE_GENERATION_STEP_ID_V1
          && payload.candidateHash === input.candidate.durable.candidateHash
      } catch {
        return false
      }
    })
  if (!step || step.status !== 'succeeded' || !adoption || adoptionRecord?.id == null) {
    throw new Error('正文生成 durable 运行尚未满足终态验证条件。')
  }
  const chapter = await db.chapters.get(input.candidate.chapterId)
  if (!chapter || !await assertRecordInScope(input.scope, 'chapters', chapter, { owner: 'work' })) {
    throw new Error('正文生成终态校验找不到来源章节。')
  }
  if (await hashChapterText(chapter.content ?? '') !== input.candidate.expectedContentHash) {
    throw new Error('正文生成终态校验发现章节正文与候选不一致。')
  }
  const requiresInformationBoundary = requiresProseInformationBoundaryV1(snapshot)
  if (requiresInformationBoundary && !input.candidate.informationBoundaryHash) {
    throw new Error('正文生成终态校验缺少当前合同要求的信息边界证据。')
  }
  const hasInformationBoundary = Boolean(input.candidate.informationBoundaryHash)
  if (hasInformationBoundary) {
    const currentBoundary = await buildChapterInformationBoundaryV1({
      scope: input.scope,
      chapterId: input.candidate.chapterId,
      outlineNodeId: chapter.outlineNodeId,
      worldGroupId: input.candidate.worldGroupId,
      perspectiveCharacterId: input.candidate.perspectiveCharacterId ?? null,
    })
    if (
      currentBoundary.manifestHash !== input.candidate.informationBoundaryHash
      || validateProseInformationBoundaryV1(input.candidate.outputText, currentBoundary).length > 0
    ) throw new Error('正文生成终态校验发现信息边界已变化或候选包含提前泄漏。')
  }
  const verifierSetVersion = semanticRequired
    ? PROSE_GENERATION_VERIFIER_SET_V3
    : hasInformationBoundary
      ? PROSE_GENERATION_VERIFIER_SET_V2
      : PROSE_GENERATION_VERIFIER_SET_V1
  snapshot = await append(input.scope, snapshot, 'verification.started', {
    verifierSetVersion,
  })
  const postStateHash = await prosePostStateHash({
    scope: input.scope,
    chapterId: input.candidate.chapterId,
  })
  const receipt = await createVerificationReceiptV1({
    version: 1,
    runId: input.runId,
    generation: snapshot.projection.generation,
    contractHash: snapshot.projection.contractHash,
    contextManifestHashes: [...new Set([
      input.candidate.durable.contextManifestHash,
      ...(input.candidate.semanticReview ? [
        input.candidate.semanticReview.initial.contextManifestHash,
        input.candidate.semanticReview.final.contextManifestHash,
      ] : []),
    ])],
    candidateHashes: [input.candidate.durable.candidateHash],
    adoptionEventIds: [adoptionRecord.id],
    postStateHash,
    verifierSetVersion,
    ...(input.candidate.semanticReview ? {
      semanticVerifier: {
        provider: input.candidate.semanticReview.final.reviewer.provider,
        model: input.candidate.semanticReview.final.reviewer.model,
        promptVersion: input.candidate.semanticReview.final.reviewer.promptVersion,
      },
    } : {}),
    criteria: [
      { id: 'prose-generation.candidate', status: 'passed', evidenceRefs: [`candidate:${input.candidate.durable.candidateHash}`] },
      ...(hasInformationBoundary ? [{
        id: 'prose-generation.information-boundary',
        status: 'passed' as const,
        evidenceRefs: [`information-boundary:${input.candidate.informationBoundaryHash}`],
      }] : []),
      ...(semanticRequired ? [{
        id: 'prose-generation.semantic-review',
        status: 'passed' as const,
        evidenceRefs: [
          `semantic-review:${input.candidate.semanticReview!.final.artifactHash}`,
          ...(input.candidate.semanticReview!.revision
            ? [`semantic-revision:${input.candidate.semanticReview!.revision.artifactHash}`]
            : []),
        ],
      }] : []),
      { id: 'prose-generation.confirmed', status: 'passed', evidenceRefs: [`run:${input.runId}:confirmation`] },
      { id: 'prose-generation.adopted', status: 'passed', evidenceRefs: [`event:${adoptionRecord.id}`] },
      { id: 'prose-generation.post-state', status: 'passed', evidenceRefs: [`post-state:${postStateHash}`] },
    ],
    acceptedAt: Date.now(),
  })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  return { snapshot, receiptHash: receipt.receiptHash, receipt }
}
