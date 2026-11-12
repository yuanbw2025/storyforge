import Dexie from 'dexie'
import { db } from '../../db/schema'
import { observeDuplicatedProseFrameV1 } from '../../prose/provider-frame-observation'
import { normalizeProseForEditorV1, plainTextToHtml } from '../../utils/html'
import { adopt, adoptionTransactionTablesV1 } from '../../registry/adopt'
import { hashChapterText, normalizeChapterText, sha256Text, CHAPTER_TEXT_NORMALIZATION_VERSION } from '../../ai/chapter-memory/text-normalization'
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
  readVerifiedAgentRunInTransactionV1,
  appendPrivilegedAgentRunEventInTransactionV1,
  appendAgentRunEventWithSettlementInTransactionV1,
  withAgentRunMutationLockV1,
  agentRunScopeTransactionTablesV1,
  type AgentRunSnapshotV1,
} from './event-store'
import { parseAgentRunEventV1 } from './event-schema'
import { createVerificationReceiptV1 } from './verification-receipt'
import { canonicalStringify, hashCanonicalValue } from './hash'
import type { TokenUsage } from '../../ai/logger'
import { createContextManifestFromAssemblyV1, createContextManifestV2FromV1 } from './context-manifest'
import {
  assertRecordInScope,
  readOwnedRows,
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
  AgentRunRecord,
  AgentSkillExecutionBindingV1,
  AgentSkillExecutionBindingV2,
} from '../../types/agent-run'
import {
  assertWorkspaceContentRevisionFreshV1,
  contentRevisionTableSpecsV1,
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
  verifyContextGatewayCandidateEvidenceV1,
  type ContextGatewayPreflightEvidenceV1,
} from '../../context-gateway/attempt-evidence'
import type { ContextGatewayExecutionV1 } from '../../context-gateway/execution'
import { assertContextGatewayCandidateAdoptableV1 } from '../../context-gateway/execution'
import { proseGatewayExecutionFromAssemblyV1 } from '../../prose/gateway-context'
import { proseRenderedRequestV1 } from '../../prose/request-evidence'
import type { AIRequestSettingsV1, ChatResult } from '../../ai/client'
import { recordCreationModelRequestV1, recordCreationModelResponseV1 } from './creation-response-evidence'
import { parseProseLengthObservationV1, type ProseLengthObservationV1 } from '../../prose/length-observation'
import { recordAgentRunArtifactV1, readAgentRunArtifactExactV1 } from '../../memory/artifact-store'
import { QUALITY_RECHECK_STEP_V1, verifyQualityRevisionEvidenceV1, type QualityRevisionEvidenceV1 } from '../../prose/quality-revision-evidence'
import { qualityRevisionProtectionErrorV1 } from '../../prose/quality-revision'
import { parseQualityRecheckV1 } from '../../prose/quality-recheck'

export const PROSE_GENERATION_STEP_ID_V1 = 'prose-generation'
export const PROSE_SEMANTIC_REVIEW_STEP_ID_V1 = 'prose-semantic-review'
export const PROSE_SEMANTIC_REVISION_STEP_ID_V1 = 'prose-semantic-revision'
export const PROSE_SEMANTIC_REREVIEW_STEP_ID_V1 = 'prose-semantic-rereview'
export const PROSE_GENERATION_VERIFIER_SET_V2 = 'prose-generation-terminal-v2-information-boundary'
export const PROSE_GENERATION_VERIFIER_SET_V3 = 'prose-generation-terminal-v3-semantic-review'
export const PROSE_GENERATION_CANDIDATE_TYPE_V1 = 'prose-generation-candidate'

export type ProseGenerationOperationV1 = 'generate' | 'continue' | 'quality-revise'

export function proseGenerationFormalEntryIdV1(operation: ProseGenerationOperationV1): string {
  return operation === 'quality-revise' ? 'prose.chapter.quality-revise' : operation === 'continue' ? 'prose.chapter.continue' : 'prose.chapter.generate'
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
  lengthObservation?: ProseLengthObservationV1
  version: 1
  type: typeof PROSE_GENERATION_CANDIDATE_TYPE_V1
  projectId: number
  chapterId: number
  chapterTitle: string
  worldGroupId: number | null
  operation: ProseGenerationOperationV1
  /** Hash of the chapter content at the moment the model request started. */
  sourceTextHash: string
  contentRevision: WorkspaceContentRevisionVectorV1
  outputText: string
  outputTextHash: string
  gatewayEvidenceVersion: 3
  /** Expected normalized chapter hash after this candidate is adopted. */
  expectedContentHash: string
  /** Candidate-bound information boundary. */
  informationBoundaryHash: string
  perspectiveCharacterId?: number | null
  perspectiveFromChapter?: boolean
  /** Absent on candidates created before HARNESS-19. */
  semanticReview?: ProseGenerationSemanticReviewEvidenceV1
  qualityRevision?: QualityRevisionEvidenceV1
  createdAt: number
  durable: ProseGenerationDurableEvidenceV1
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
    `prose.${input.operation}`,
    'prose',
  )
  const reviewSkill = getAgentSkillV1('prose.review', 'prose')
  const revisionSkill = getAgentSkillV1('prose.revise', 'prose')
  return {
    version: 1 as const,
    objective: `${input.operation === 'quality-revise' ? '定向修订' : input.operation === 'continue' ? '续写' : '生成'}章节 #${input.chapterId} 正文候选，并等待作者确认后写回`,
    workflowKind: semanticReview ? 'generate-verify-revise' as const : 'long-running-resumable' as const,
    scope: {
      projectId: input.projectId,
      worldGroupId: input.worldGroupId,
      chapterIds: [input.chapterId],
    },
    permissions: {
      contextSourceKeys: resolveAgentSkillContextSourceKeysV1(generationSkill),
      writeTargets: [{
        table: 'chapters',
        fields: ['content', 'wordCount'],
        mode: 'author-confirmed' as const,
      }],
    },
    executionBindings: [
      { stepId: PROSE_GENERATION_STEP_ID_V1, ...createAgentSkillExecutionBindingV1(generationSkill), ...(input.formalEntry ? { formalEntry: input.formalEntry } : {}) },
      ...(semanticReview ? [
        { stepId: PROSE_SEMANTIC_REVIEW_STEP_ID_V1, ...createAgentSkillExecutionBindingV1(reviewSkill) },
        { stepId: PROSE_SEMANTIC_REVISION_STEP_ID_V1, ...createAgentSkillExecutionBindingV1(revisionSkill) },
        { stepId: PROSE_SEMANTIC_REREVIEW_STEP_ID_V1, ...createAgentSkillExecutionBindingV1(reviewSkill) },
      ] : []),
    ],
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
  const executionBindings = snapshot.contract.executionBindings
  if (!executionBindings) throw new Error('正文生成 RunContract 缺少当前 execution bindings。')
  const operation = snapshot.contract.executionBindings?.find(binding => binding.stepId === PROSE_GENERATION_STEP_ID_V1)?.skillId === 'prose.quality-revise' ? 'quality-revise' : snapshot.contract.objective.startsWith('续写') ? 'continue' : 'generate'
  const expected = new Map<string, ReturnType<typeof getAgentSkillV1>>([
    [PROSE_GENERATION_STEP_ID_V1, getAgentSkillV1(`prose.${operation}`, 'prose')],
    ...(operation === 'quality-revise' ? [[QUALITY_RECHECK_STEP_V1, getAgentSkillV1('prose.quality-recheck', 'prose')]] as const : []),
    ...(requiresSemanticReview(snapshot) ? [
      [PROSE_SEMANTIC_REVIEW_STEP_ID_V1, getAgentSkillV1('prose.review', 'prose')],
      [PROSE_SEMANTIC_REVISION_STEP_ID_V1, getAgentSkillV1('prose.revise', 'prose')],
      [PROSE_SEMANTIC_REREVIEW_STEP_ID_V1, getAgentSkillV1('prose.review', 'prose')],
    ] as const : []),
  ])
  if (executionBindings.length !== expected.size) {
    throw new Error('正文生成 RunContract execution bindings 数量无效。')
  }
  for (const binding of executionBindings) {
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

function verifyQualityRevisionDurableEvidence(snapshot: AgentRunSnapshotV1, candidate: ProseGenerationCandidateV1): boolean {
  if (candidate.operation !== 'quality-revise') return candidate.qualityRevision === undefined
  const evidence = candidate.qualityRevision
  const step = snapshot.projection.steps[QUALITY_RECHECK_STEP_V1]
  return !!evidence && snapshot.contract.runtimeBindingHash === evidence.plan.planHash
    && step?.status === 'succeeded' && step.outputHash === evidence.recheck.artifactHash
    && snapshot.events.some(event => event.type === 'context.assembled' && event.payload.stepId === QUALITY_RECHECK_STEP_V1 && event.payload.manifestHash === evidence.recheckManifestHash)
}

async function verifyQualityRevisionGatewayEvidence(scope: WorkspaceScope, candidate: ProseGenerationCandidateV1): Promise<boolean> {
  try {
    const metadata = candidate.qualityRevision!
    const verified = await verifyContextGatewayCandidateEvidenceV1({ scope, runId: candidate.durable.runId, stepId: QUALITY_RECHECK_STEP_V1, attempt: 1, candidateHash: metadata.recheck.artifactHash })
    if (verified.manifest.manifestHash !== metadata.recheckManifestHash) return false
    const rawRef = verified.manifest.artifacts.find(ref => ref.role === 'raw-response')!
    const requestRef = verified.manifest.artifacts.find(ref => ref.role === 'rendered-request')!
    const raw = JSON.parse(await readAgentRunArtifactExactV1({ projectId: scope.projectId, artifactKind: 'raw-response', contentHash: rawRef.contentHash }))
    const request = JSON.parse(await readAgentRunArtifactExactV1({ projectId: scope.projectId, artifactKind: 'rendered-request', contentHash: requestRef.contentHash }))
    if (raw.version !== 'quality-recheck-response-v1' || raw.recheck.artifactHash !== metadata.recheck.artifactHash
      || await hashCanonicalValue(request.messages) !== await hashCanonicalValue(metadata.recheckMessages)) return false
    const parsed = await parseQualityRecheckV1({ raw: raw.raw, plan: metadata.plan, candidateText: candidate.outputText, messages: request.messages, settings: request.settings, completion: 'complete', createdAt: metadata.recheck.review.createdAt })
    return parsed.artifactHash === metadata.recheck.artifactHash
  } catch { return false }
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

async function appendAdoptionInTransaction(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  type: Parameters<typeof appendAgentRunEventV1>[0]['type'],
  payload: unknown,
): Promise<AgentRunSnapshotV1> {
  return appendAgentRunEventWithSettlementInTransactionV1({
    scope, snapshot,
    event: parseAgentRunEventV1({
      version: 1, runId: snapshot.run.id, sequence: snapshot.projection.lastSequence + 1,
      generation: snapshot.projection.generation, projectId: snapshot.run.projectId,
      worldGroupId: snapshot.run.worldGroupId ?? null, contractHash: snapshot.projection.contractHash,
      type, payload, createdAt: Date.now(),
    }),
  })
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
  requestSettings?: AIRequestSettingsV1
  binding: {
    operation: ProseGenerationOperationV1
    sourceTextHash: string
    promptHash: string
    informationBoundaryHash: string
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
  if (!input.messages.some(message => message.content.includes(execution.contextPacket.content))) {
    throw new Error('正文请求未完整包含已冻结的必读资料，已阻止模型调用。')
  }
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
    renderedRequest: input.requestSettings ? proseRenderedRequestV1(input.messages, input.requestSettings) : input.messages,
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

function parseObservedProseUsageV1(value: unknown): TokenUsage | null {
  if (value == null) return null
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('正文供应商用量观测格式无效。')
  const row = value as Record<string, unknown>
  const { inputTokens, outputTokens, totalTokens } = row
  if (typeof inputTokens !== 'number' || !Number.isSafeInteger(inputTokens) || inputTokens < 0
    || typeof outputTokens !== 'number' || !Number.isSafeInteger(outputTokens) || outputTokens < 0
    || typeof totalTokens !== 'number' || !Number.isSafeInteger(totalTokens) || totalTokens < 0) throw new Error('正文供应商用量必须是完整、非负的实际观测。')
  return { inputTokens, outputTokens, totalTokens }
}

/** Read only the original attempt's verified receipt; never infer from global
 * totals, a newer attempt or UI session state. Historical absent fields stay unknown. */
export async function readProseGenerationObservedUsageV1(input: {
  scope: WorkspaceScope; runId: number; attempt: number
}): Promise<TokenUsage | null> {
  if (!Number.isSafeInteger(input.attempt) || input.attempt < 1) throw new Error('正文用量读取缺少真实 attempt。')
  const snapshot = await readAgentRunV1(input.scope, input.runId)
  if (!snapshot.events.some(event => event.type === 'model.requested'
    && event.payload.stepId === PROSE_GENERATION_STEP_ID_V1 && event.payload.attempt === input.attempt)) return null
  const responded = snapshot.events.find(event => event.type === 'model.responded'
    && event.payload.stepId === PROSE_GENERATION_STEP_ID_V1 && event.payload.attempt === input.attempt)
  for (const event of [...snapshot.events].reverse()) {
    if (event.type !== 'evidence.artifact.recorded' || event.payload.stepId !== PROSE_GENERATION_STEP_ID_V1
      || event.payload.attempt !== input.attempt || event.payload.artifactKind !== 'raw-response') continue
    const content = await readAgentRunArtifactExactV1({ projectId: input.scope.projectId,
      artifactKind: 'raw-response', contentHash: event.payload.contentHash })
    let row: Record<string, unknown>
    try { row = JSON.parse(content) } catch { continue }
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || !['prose-observed-response-v1', 'prose-interrupted-response-v1'].includes(String(row.version))
      || !Object.prototype.hasOwnProperty.call(row, 'observedUsage')) continue
    if (row.version === 'prose-observed-response-v1') {
      // An old unwrapped model JSON body cannot authorize its own metering.
      if (typeof row.text !== 'string' || responded?.type !== 'model.responded'
        || responded.payload.outputHash !== await hashCanonicalValue(row.text)) continue
    } else if (responded || !['failed', 'cancelled', 'unknown'].includes(String(row.completion))) continue
    const usage = parseObservedProseUsageV1(row.observedUsage)
    if (row.usageBasis !== (usage ? 'provider-observed' : 'unknown')) throw new Error('正文用量观测来源不一致。')
    if (row.version === 'prose-interrupted-response-v1' ? row.budgetTokenBasis !== 'reserved'
      : usage ? row.budgetTokenBasis !== 'provider-observed' : !['estimated', 'not-settled'].includes(String(row.budgetTokenBasis))) throw new Error('正文用量预算依据不一致。')
    if (usage) return usage
  }
  return null
}

/** Finalize exact response and ContextManifestV3 before candidate.persisted. */
export async function finalizeProseGenerationGatewayStepV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  attempt: ProseGatewayAttemptV1
  output: string
  lengthObservation?: ProseLengthObservationV1
  usedTokens?: number
  observedUsage?: TokenUsage | null
}): Promise<{ snapshot: AgentRunSnapshotV1; manifest: ContextManifestV3 }> {
  const declaresUsage = Object.prototype.hasOwnProperty.call(input, 'observedUsage')
  const observedUsage = parseObservedProseUsageV1(input.observedUsage)
  const metering = declaresUsage ? { observedUsage, usageBasis: observedUsage ? 'provider-observed' : 'unknown',
    budgetTokenBasis: observedUsage ? 'provider-observed' : input.usedTokens != null ? 'estimated' : 'not-settled' } : {}
  const rawResponse = input.lengthObservation || declaresUsage ? {
    version: 'prose-observed-response-v1', text: input.output,
    ...(input.lengthObservation ? { length: parseProseLengthObservationV1(input.lengthObservation) } : {}), ...metering,
  } : input.output
  const outputHash = await hashCanonicalValue(input.output)
  let snapshot = input.snapshot
  if (declaresUsage) {
    const step = snapshot.projection.steps[PROSE_GENERATION_STEP_ID_V1]
    if (!step || step.status !== 'running' || step.attempt !== 1) throw new Error('正文用量观测不属于正在执行的原始 attempt。')
    // Retain paid text and metering before subsequent budget/manifest writes.
    // The gateway below reuses this exact canonical body and existing identity.
    snapshot = (await recordAgentRunArtifactV1({ scope: input.scope, runId: snapshot.run.id,
      stepId: PROSE_GENERATION_STEP_ID_V1, attempt: step.attempt, artifactKind: 'raw-response',
      content: typeof rawResponse === 'string' ? rawResponse : canonicalStringify(rawResponse),
      expectedLastSequence: snapshot.projection.lastSequence })).snapshot
  }
  snapshot = await append(input.scope, snapshot, 'model.responded', {
    stepId: PROSE_GENERATION_STEP_ID_V1,
    attempt: 1,
    outputHash,
  })
  if (observedUsage || input.usedTokens != null) {
    snapshot = await append(input.scope, snapshot, 'budget.settled', {
      stepId: PROSE_GENERATION_STEP_ID_V1,
      modelCalls: 1,
      toolCalls: 0,
      tokens: observedUsage?.totalTokens ?? Math.max(0, Math.floor(input.usedTokens!)),
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
    rawResponse,
    candidateHash: outputHash,
    expectedLastSequence: snapshot.projection.lastSequence,
  })
  return { snapshot: finalized.snapshot, manifest: finalized.manifest }
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
  messages: readonly ChatMessage[]
  reservedTokens: number
}) {
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
  const prepared = await recordCreationModelRequestV1({
    scope: input.scope, snapshot, stepId: input.stepId, attempt: 1,
    contextManifestHash: input.contextManifest.manifestHash, messages: input.messages,
  })
  snapshot = prepared.snapshot
  snapshot = await append(input.scope, snapshot, 'model.requested', {
    stepId: input.stepId,
    attempt: 1,
    bindingHash: await hashCanonicalValue({
      executionBinding: input.executionBinding,
      request: input.requestBinding,
      contextManifestHash: input.contextManifest.manifestHash,
    }),
  })
  snapshot = await append(input.scope, snapshot, 'budget.reserved', {
    stepId: input.stepId,
    modelCalls: 1,
    toolCalls: 0,
    tokens: Math.max(1, Math.floor(input.reservedTokens)),
  })
  return { snapshot, request: prepared.request }
}

export async function recordProseSemanticModelOutputV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  stepId: ProseSemanticStepIdV1
  output: string
  request: Awaited<ReturnType<typeof beginProseSemanticStepV1>>['request']
  result?: ChatResult
  usedTokens: number
}): Promise<AgentRunSnapshotV1> {
  const step = input.snapshot.projection.steps[input.stepId]
  if (!step || step.status !== 'running' || step.attempt !== 1) {
    throw new Error(`正文语义步骤 ${input.stepId} 不在模型响应状态。`)
  }
  if (input.request.stepId !== input.stepId || input.request.attempt !== 1
    || input.request.scope.projectId !== input.scope.projectId
    || input.request.scope.worldId !== input.scope.worldId
    || input.request.scope.workId !== input.scope.workId) {
    throw new Error('正文语义响应不属于原始请求的步骤或作用域。')
  }
  let snapshot = await recordCreationModelResponseV1({
    snapshot: input.snapshot, request: input.request, raw: input.output, result: input.result,
  })
  snapshot = await append(input.scope, snapshot, 'model.responded', {
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
    && (candidate.operation === 'generate' || candidate.operation === 'continue' || (candidate.operation === 'quality-revise' && candidate.qualityRevision?.version === 1))
    && typeof candidate.sourceTextHash === 'string'
    && typeof candidate.outputText === 'string'
    && typeof candidate.outputTextHash === 'string'
    && candidate.gatewayEvidenceVersion === 3
    && typeof candidate.expectedContentHash === 'string'
    && typeof candidate.informationBoundaryHash === 'string'
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
  try {
    candidate.contentRevision = parseWorkspaceContentRevisionV1(candidate.contentRevision)
    if (candidate.lengthObservation !== undefined) candidate.lengthObservation = parseProseLengthObservationV1(candidate.lengthObservation)
  } catch {
    return false
  }
  return true
}

export async function hashProseGenerationCandidateV1(
  candidate: Omit<ProseGenerationCandidateV1, 'durable'>,
): Promise<string> {
  if (candidate.operation === 'quality-revise') return hashCanonicalValue(candidate)
  // ContextManifestV3 already binds the exact response/candidate hash. Using
  // outputTextHash avoids a circular hash through durable.contextManifestHash.
  return candidate.outputTextHash
}

export async function persistProseGenerationCandidateV1(input: {
  scope: WorkspaceScope
  candidate: ProseGenerationCandidateV1
}): Promise<{ conversation: AgentConversation & { id: number }; event: AgentEvent & { id: number } }> {
  const { durable, ...candidateBody } = input.candidate
  if (await hashProseGenerationCandidateV1(candidateBody) !== durable.candidateHash) {
    throw new Error('正文生成候选 hash 不匹配。')
  }
  if (input.candidate.operation === 'quality-revise') {
    const snapshot = await readAgentRunV1(input.scope, durable.runId)
    if (!input.candidate.qualityRevision || !await verifyQualityRevisionEvidenceV1(input.candidate.qualityRevision, input.candidate.outputText)
      || !verifyQualityRevisionDurableEvidence(snapshot, input.candidate)
      || !await verifyQualityRevisionGatewayEvidence(input.scope, input.candidate)) throw new Error('范围修订候选没有完整的保护与复核证据。')
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
    purpose: 'prose.candidate',
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
  operations?: ProseGenerationOperationV1[]
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
      && (input.operations ?? ['generate', 'continue']).includes(value.value.operation)
    ))
    .sort((left, right) => right.event.createdAt - left.event.createdAt)
  return matches[0]?.value ?? null
}

export interface InterruptedProseGenerationV1 {
  version: 'prose-interrupted-response-v1'
  outputText: string
  completion: 'cancelled' | 'failed' | 'unknown'
  message: string
  /** Missing on historical payloads means not recorded, never zero. */
  observedUsage?: TokenUsage | null
  usageBasis?: 'provider-observed' | 'unknown'
  /** An interruption retains the original reservation, not a final invoice. */
  budgetTokenBasis?: 'reserved'
}

/** Keep the received bytes as run evidence. This is never a candidate or an adoption. */
export async function recordInterruptedProseGenerationV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  response: InterruptedProseGenerationV1
}): Promise<AgentRunSnapshotV1> {
  const step = input.snapshot.projection.steps[PROSE_GENERATION_STEP_ID_V1]
  if (!step || step.status !== 'running') throw new Error('中断片段缺少正在执行的正文步骤。')
  const response = structuredClone(input.response)
  const declaresUsage = Object.prototype.hasOwnProperty.call(response, 'observedUsage')
  if (!declaresUsage && (response.usageBasis != null || response.budgetTokenBasis != null)) throw new Error('正文用量依据缺少原始观测字段。')
  if (declaresUsage) {
    response.observedUsage = parseObservedProseUsageV1(response.observedUsage)
    response.usageBasis = response.observedUsage ? 'provider-observed' : 'unknown'
    response.budgetTokenBasis = 'reserved'
  }
  const recorded = await recordAgentRunArtifactV1({
    scope: input.scope,
    runId: input.snapshot.run.id,
    stepId: PROSE_GENERATION_STEP_ID_V1,
    attempt: step.attempt,
    artifactKind: 'raw-response',
    content: declaresUsage ? canonicalStringify(response) : JSON.stringify(response),
    expectedLastSequence: input.snapshot.projection.lastSequence,
  })
  return recorded.snapshot
}

/** A historical fragment may be read after refresh, with no write authority. */
export async function readLatestInterruptedProseGenerationV1(input: {
  scope: WorkspaceScope
  chapterId: number
}): Promise<(InterruptedProseGenerationV1 & { operation: ProseGenerationOperationV1 }) | null> {
  const chapter = await db.chapters.get(input.chapterId)
  if (!chapter || !await assertRecordInScope(input.scope, 'chapters', chapter, { owner: 'work' })) return null
  const runs = await readOwnedRows<AgentRunRecord>(input.scope, 'agentRuns', { owner: 'work' })
  const matching = runs.filter(run => {
    try {
      const contract = JSON.parse(run.contractJson)
      return contract.scope?.chapterIds?.length === 1 && contract.scope.chapterIds[0] === input.chapterId
        && contract.executionBindings?.some((binding: { stepId: string }) => binding.stepId === PROSE_GENERATION_STEP_ID_V1)
    } catch { return false }
  }).sort((left, right) => right.createdAt - left.createdAt || (right.id ?? 0) - (left.id ?? 0))
  const latest = matching[0]
  if (!latest?.id) return null
  const snapshot = await readAgentRunV1(input.scope, latest.id)
  if (snapshot.projection.steps[PROSE_GENERATION_STEP_ID_V1]?.status !== 'failed') return null
  const evidence = [...snapshot.events].reverse().find(event => event.type === 'evidence.artifact.recorded'
    && event.payload.artifactKind === 'raw-response' && event.payload.stepId === PROSE_GENERATION_STEP_ID_V1
    && event.payload.attempt === snapshot.projection.steps[PROSE_GENERATION_STEP_ID_V1]?.attempt)
  if (!evidence || evidence.type !== 'evidence.artifact.recorded') return null
  const content = await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: 'raw-response', contentHash: evidence.payload.contentHash })
  let row: InterruptedProseGenerationV1
  try { row = JSON.parse(content) } catch { return null }
  if (!row || row.version !== 'prose-interrupted-response-v1' || typeof row.outputText !== 'string'
    || !['cancelled', 'failed', 'unknown'].includes(row.completion) || typeof row.message !== 'string') return null
  if (Object.prototype.hasOwnProperty.call(row, 'observedUsage')) {
    if (snapshot.events.some(event => event.type === 'model.responded'
      && event.payload.stepId === PROSE_GENERATION_STEP_ID_V1 && event.payload.attempt === evidence.payload.attempt)) return null
    row.observedUsage = parseObservedProseUsageV1(row.observedUsage)
    if (row.usageBasis !== (row.observedUsage ? 'provider-observed' : 'unknown') || row.budgetTokenBasis !== 'reserved') throw new Error('中断正文用量观测的来源或预算依据不一致。')
  } else if (row.usageBasis != null || row.budgetTokenBasis != null) throw new Error('中断正文用量依据缺少原始观测字段。')
  return { ...row, operation: snapshot.contract.objective.startsWith('续写') ? 'continue' : 'generate' }
}

/** Preserve the generation receipt and append an explicit author revision before adoption. */
export async function reviseProseGenerationCandidateV1(input: {
  scope: WorkspaceScope
  candidate: ProseGenerationCandidateV1
  outputText: string
}): Promise<ProseGenerationCandidateV1> {
  const previous = input.candidate
  if (previous.operation === 'quality-revise') throw new Error('范围修订不能直接编辑整章候选；请在作者原稿中修改或重新选择修订范围。')
  const outputText = input.outputText
  if (!normalizeProseForEditorV1(outputText).trim()) throw new Error('正文候选不能为空。')
  if (outputText === previous.outputText) return previous
  const chapter = await db.chapters.get(previous.chapterId)
  if (!chapter || !await assertRecordInScope(input.scope, 'chapters', chapter, { owner: 'work' })) {
    throw new Error('正文候选的章节不存在或越界。')
  }
  await assertWorkspaceContentRevisionFreshV1(previous.contentRevision, {
    scope: input.scope, worldGroupId: previous.worldGroupId,
  })
  if (!await isProseGenerationCandidateCurrentV1(previous)) throw new Error('正文候选已过期，请重新生成。')
  const outputTextHash = await hashCanonicalValue(outputText)
  const revised: ProseGenerationCandidateV1 = {
    ...previous,
    outputText,
    outputTextHash,
    expectedContentHash: await hashChapterText(plainTextToHtml(previous.operation === 'continue'
      ? [normalizeChapterText(chapter.content ?? ''), normalizeProseForEditorV1(outputText)].filter(Boolean).join('\n')
      : normalizeProseForEditorV1(outputText))),
    durable: { ...previous.durable, candidateHash: outputTextHash },
  }
  if (!await isProseGenerationCandidateCurrentV1(revised)) {
    throw new Error('修订内容未通过信息边界校验，或旧候选需要重新评审。')
  }
  const events = await readOwnedRows<AgentEvent>(input.scope, 'agentEvents', { owner: 'work' })
  const event = events.find(row => {
    try {
      const value = JSON.parse(row.payload)
      return row.kind === 'candidate' && row.durableRunId === previous.durable.runId
        && isProseGenerationCandidate(value)
        && value.durable.candidateHash === previous.durable.candidateHash
        && value.chapterId === previous.chapterId
    } catch { return false }
  })
  if (!event?.id) throw new Error('未找到可修订的正文候选。')
  if (await hashCanonicalValue(JSON.parse(event.payload)) !== await hashCanonicalValue(previous)) {
    throw new Error('正文候选与已保存的证据不一致。')
  }
  await db.transaction('rw', scopeTransactionTables(db.agentEvents, db.agentRuns, db.agentRunEvents), async () => {
    const snapshot = await readVerifiedAgentRunInTransactionV1(input.scope, previous.durable.runId)
    assertProseGenerationExecutionBindingsV1(snapshot)
    if (requiresSemanticReview(snapshot)) throw new Error('该候选需要重新语义评审，不能直接修订采纳。')
    const step = snapshot.projection.steps[PROSE_GENERATION_STEP_ID_V1]
    const latestEvent = await db.agentEvents.get(event.id!)
    if (step?.status !== 'awaiting_confirmation'
      || step.candidateHash !== previous.durable.candidateHash
      || latestEvent?.payload !== event.payload) throw new Error('正文候选已变化，请重新确认。')
    await appendPrivilegedAgentRunEventInTransactionV1(snapshot, parseAgentRunEventV1({
      version: 1, runId: snapshot.run.id, sequence: snapshot.projection.lastSequence + 1,
      generation: snapshot.projection.generation, projectId: snapshot.run.projectId,
      worldGroupId: snapshot.run.worldGroupId ?? null, contractHash: snapshot.run.contractHash,
      type: 'candidate.revised', createdAt: Date.now(),
      payload: { stepId: PROSE_GENERATION_STEP_ID_V1, attempt: step.attempt,
        previousCandidateHash: previous.durable.candidateHash, candidateHash: outputTextHash },
    }))
    await db.agentEvents.update(event.id!, {
      content: `作者修订正文候选 ${outputText.length} 字`, payload: JSON.stringify(revised),
    })
  })
  return revised
}

export async function isProseGenerationCandidateCurrentV1(
  candidate: ProseGenerationCandidateV1,
): Promise<boolean> {
  const chapter = await db.chapters.get(candidate.chapterId)
  if (!chapter || await hashChapterText(chapter.content ?? '') !== candidate.sourceTextHash) return false
  if (candidate.operation === 'quality-revise' && (!candidate.qualityRevision
    || candidate.qualityRevision.sourceHtmlHash !== await sha256Text(chapter.content ?? '')
    || !await verifyQualityRevisionEvidenceV1(candidate.qualityRevision, candidate.outputText))) return false
  const { durable, ...candidateBody } = candidate
  if (await hashProseGenerationCandidateV1(candidateBody) !== durable.candidateHash) return false
  if (candidate.semanticReview && !await verifySemanticReviewEvidence(candidate)) return false
  let scope: WorkspaceScope
  try {
    scope = await resolveScopeForCandidate(candidate)
    await readAgentRunV1(scope, candidate.durable.runId)
  } catch {
    return false
  }
  if (candidate.operation === 'quality-revise') {
    const snapshot = await readAgentRunV1(scope, candidate.durable.runId)
    if (!verifyQualityRevisionDurableEvidence(snapshot, candidate)
      || !await verifyQualityRevisionGatewayEvidence(scope, candidate)
      || candidate.qualityRevision!.plan.scope.workId !== scope.workId
      || candidate.qualityRevision!.plan.scope.worldId !== scope.worldId
      || candidate.qualityRevision!.plan.chapterId !== candidate.chapterId) return false
    try { await assertWorkspaceContentRevisionFreshV1(candidate.contentRevision, { scope, worldGroupId: candidate.worldGroupId }) } catch { return false }
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
  throw new Error('正文候选来源章节缺少当前 Work 身份。')
}

/** Recover an event-store crash window without calling the model again. */
export async function recoverProseGenerationCandidateV1(input: {
  scope: WorkspaceScope
  candidate: ProseGenerationCandidateV1
}): Promise<AgentRunSnapshotV1 | null> {
  if (!await isProseGenerationCandidateCurrentV1(input.candidate)) return null
  const snapshot = await readAgentRunV1(input.scope, input.candidate.durable.runId)
  assertProseGenerationExecutionBindingsV1(snapshot)
  if (['completed', 'failed', 'cancelled', 'recovery_required'].includes(snapshot.projection.state)) return null
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
  return db.transaction('rw', scopeTransactionTables(db.agentRuns, db.agentRunEvents), async () => {
    let snapshot = await readAgentRunV1(input.scope, input.runId)
    assertProseGenerationExecutionBindingsV1(snapshot)
    if (input.candidate.durable.runId !== snapshot.run.id) throw new Error('正文候选与运行不一致。')
    const step = snapshot.projection.steps[PROSE_GENERATION_STEP_ID_V1]
    if (step?.candidateHash !== input.candidate.durable.candidateHash) return snapshot
    if (['completed', 'failed', 'cancelled', 'recovery_required'].includes(snapshot.projection.state)) return snapshot
    if (step.status === 'stale' && snapshot.projection.state === 'paused') {
      return append(input.scope, snapshot, 'run.cancelled', {
        reason: 'author-discarded-stale-prose-candidate',
      })
    }
    if (step.status === 'awaiting_confirmation') {
      snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
        stepId: PROSE_GENERATION_STEP_ID_V1,
        candidateHash: input.candidate.durable.candidateHash,
        decision: 'reject',
      })
    } else if (!(step.status === 'failed' && step.confirmation === 'reject')) return snapshot
    if (snapshot.contract.executionBindings?.some(binding => binding.stepId === PROSE_GENERATION_STEP_ID_V1 && binding.skillId === 'prose.quality-revise')) {
      return append(input.scope, snapshot, 'run.cancelled', { reason: 'author-rejected-quality-revision' })
    }
    return append(input.scope, snapshot, 'run.failed', { code: 'author_rejected', retryable: false })
  })
}

async function prosePostStateHash(input: { scope: WorkspaceScope; chapterId: number }): Promise<string> {
  const chapter = await db.chapters.get(input.chapterId)
  if (!chapter || !await assertRecordInScope(input.scope, 'chapters', chapter, { owner: 'work' })) {
    throw new Error('正文生成终态校验找不到章节。')
  }
  return Dexie.waitFor(hashCanonicalValue({
    version: 1,
    chapterId: input.chapterId,
    content: chapter.content,
    wordCount: chapter.wordCount,
  }))
}

export async function commitProseGenerationAdoptionV1(input: {
  scope: WorkspaceScope
  runId: number
  candidate: ProseGenerationCandidateV1
  contentHtml: string
  wordCount: number
}): Promise<{ snapshot: AgentRunSnapshotV1; receiptHash: string; receipt?: VerificationReceiptV1 }> {
  input = structuredClone(input)
  if (input.runId !== input.candidate.durable.runId) throw new Error('正文候选与 Run 不一致。')
  const intentBody = {
    version: 1, candidateHash: input.candidate.durable.candidateHash,
    chapterId: input.candidate.chapterId, operation: input.candidate.operation,
    sourceTextHash: input.candidate.sourceTextHash,
    contentHtml: input.contentHtml, wordCount: input.wordCount,
  }
  const intentHash = await hashCanonicalValue(intentBody)
  const previous = await readAgentRunV1(input.scope, input.runId)
  if (previous.projection.state === 'completed' && previous.projection.terminalReceiptHash) {
    const { durable, ...body } = input.candidate
    const chapter = await db.chapters.get(input.candidate.chapterId)
    const started = previous.events.find(event => event.type === 'adoption.started'
      && event.payload.stepId === PROSE_GENERATION_STEP_ID_V1
      && event.payload.candidateHash === durable.candidateHash && event.payload.intentHash === intentHash)
    const committed = previous.events.find(event => event.type === 'adoption.committed'
      && event.payload.stepId === PROSE_GENERATION_STEP_ID_V1
      && event.payload.candidateHash === durable.candidateHash)
    if (input.runId !== durable.runId || await hashProseGenerationCandidateV1(body) !== durable.candidateHash
      || !started || !committed || !chapter
      || !await assertRecordInScope(input.scope, 'chapters', chapter, { owner: 'work' })
      || chapter.content !== input.contentHtml || chapter.wordCount !== input.wordCount) {
      throw new Error('正文完成证明与原确认载荷或当前正式正文不一致，不能重放采纳。')
    }
    return { snapshot: previous, receiptHash: previous.projection.terminalReceiptHash }
  }
  const frame = observeDuplicatedProseFrameV1(input.candidate.outputText)
  if (frame) throw new Error(frame.message)
  if (input.candidate.operation === 'quality-revise' && input.candidate.qualityRevision) {
    const protectionError = qualityRevisionProtectionErrorV1(input.candidate.qualityRevision.plan, input.candidate.outputText)
    if (protectionError) throw new Error(protectionError)
  }
  if (input.candidate.operation === 'quality-revise' && input.contentHtml !== input.candidate.qualityRevision?.contentHtml) throw new Error('范围修订待写回的富文本与冻结候选不一致。')
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
  await assertProseTerminalCandidateEvidence(input, snapshot)
  const preflightSequence = snapshot.projection.lastSequence
  return withAgentRunMutationLockV1(input.runId, () => db.transaction(
    'rw',
    agentRunScopeTransactionTablesV1(input.runId,
      ...adoptionTransactionTablesV1('chapters', { content: input.contentHtml, wordCount: input.wordCount }),
      ...contentRevisionTableSpecsV1().map(spec => spec.table),
      db.characterDrivenPlans, db.agentRuns, db.agentRunEvents,
    ),
    async () => {
      snapshot = await readVerifiedAgentRunInTransactionV1(input.scope, input.runId)
      if (snapshot.projection.lastSequence !== preflightSequence) {
        throw new Error('正文 Run 已推进，请重新读取原候选后确认。')
      }
      await assertWorkspaceContentRevisionFreshV1(input.candidate.contentRevision, {
        scope: input.scope, worldGroupId: input.candidate.worldGroupId,
      })
      snapshot = await appendAdoptionInTransaction(input.scope, snapshot, 'confirmation.recorded', {
        stepId: PROSE_GENERATION_STEP_ID_V1,
        candidateHash: input.candidate.durable.candidateHash,
        decision: 'adopt',
      })
      snapshot = await appendAdoptionInTransaction(input.scope, snapshot, 'adoption.started', {
        stepId: PROSE_GENERATION_STEP_ID_V1,
        candidateHash: input.candidate.durable.candidateHash,
        intentHash,
      })
      const result = await adopt({
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
          ...(input.candidate.qualityRevision ? { expectedContentHash: input.candidate.qualityRevision.sourceHtmlHash } : {}),
          textNormalizationVersion: CHAPTER_TEXT_NORMALIZATION_VERSION,
        },
      })
      if (!result.written.some(item => item.id === input.candidate.chapterId && item.fields.includes('content'))
        || result.unknown.length || result.typeErrors.length || result.fkErrors.length || result.skipped.length) {
        throw new Error(result.skipped[0]?.reason || '正文候选没有完整写入章节。')
      }
      const writtenChapter = await db.chapters.get(input.candidate.chapterId)
      if (!writtenChapter || writtenChapter.content !== input.contentHtml || writtenChapter.wordCount !== input.wordCount) {
        throw new Error('正文写入后的完整 HTML 或字数与冻结确认不一致。')
      }
      const adoptionHash = await Dexie.waitFor(hashCanonicalValue({
        version: 1,
        candidateHash: input.candidate.durable.candidateHash,
        chapterId: input.candidate.chapterId,
        sourceTextHash: input.candidate.sourceTextHash,
        outputContentHash,
        wordCount: input.wordCount,
      }))
      snapshot = await appendAdoptionInTransaction(input.scope, snapshot, 'adoption.committed', {
        stepId: PROSE_GENERATION_STEP_ID_V1,
        candidateHash: input.candidate.durable.candidateHash,
        adoptionHash,
      })
      snapshot = await appendAdoptionInTransaction(input.scope, snapshot, 'step.succeeded', {
        stepId: PROSE_GENERATION_STEP_ID_V1,
        attempt: input.candidate.durable.attempt,
        outputHash: input.candidate.durable.candidateHash,
      })
      return verifyProseGenerationRunState({
        scope: input.scope,
        runId: input.runId,
        candidate: input.candidate,
        snapshot,
      }, appendAdoptionInTransaction)
    },
  ))
}

async function assertProseTerminalCandidateEvidence(input: {
  scope: WorkspaceScope
  runId: number
  candidate: ProseGenerationCandidateV1
}, snapshot: AgentRunSnapshotV1): Promise<void> {
  if (input.candidate.operation === 'quality-revise') {
    const state = snapshot
    if (!input.candidate.qualityRevision || !await verifyQualityRevisionEvidenceV1(input.candidate.qualityRevision, input.candidate.outputText)
      || !verifyQualityRevisionDurableEvidence(state, input.candidate)
      || !await verifyQualityRevisionGatewayEvidence(input.scope, input.candidate)) throw new Error('范围修订保护与复核证据不一致，不能通过终验。')
  }
  assertProseGenerationExecutionBindingsV1(snapshot)
  const semanticRequired = requiresSemanticReview(snapshot)
  if (semanticRequired && (
    !await verifySemanticReviewEvidence(input.candidate)
      || !verifySemanticReviewDurableEvidence(snapshot, input.candidate)
  )) {
    throw new Error('正文生成终态校验发现语义评审证据缺失、过期或被篡改。')
  }
}

export async function verifyProseGenerationRunV1(input: {
  scope: WorkspaceScope
  runId: number
  candidate: ProseGenerationCandidateV1
  snapshot?: AgentRunSnapshotV1
}): Promise<{ snapshot: AgentRunSnapshotV1; receiptHash: string; receipt?: VerificationReceiptV1 }> {
  const snapshot = input.snapshot ?? await readAgentRunV1(input.scope, input.runId)
  await assertProseTerminalCandidateEvidence(input, snapshot)
  return verifyProseGenerationRunState({ ...input, snapshot })
}

async function verifyProseGenerationRunState(input: {
  scope: WorkspaceScope
  runId: number
  candidate: ProseGenerationCandidateV1
  snapshot: AgentRunSnapshotV1
}, writeEvent: typeof append = append): Promise<{
  snapshot: AgentRunSnapshotV1; receiptHash: string; receipt?: VerificationReceiptV1
}> {
  let snapshot = input.snapshot
  if (snapshot.projection.state === 'completed' && snapshot.run.terminalReceiptHash) {
    return { snapshot, receiptHash: snapshot.run.terminalReceiptHash }
  }
  const step = snapshot.projection.steps[PROSE_GENERATION_STEP_ID_V1]
  assertProseGenerationExecutionBindingsV1(snapshot)
  const semanticRequired = requiresSemanticReview(snapshot)
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
  if (await Dexie.waitFor(hashChapterText(chapter.content ?? '')) !== input.candidate.expectedContentHash) {
    throw new Error('正文生成终态校验发现章节正文与候选不一致。')
  }
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
  const verifierSetVersion = semanticRequired
    ? PROSE_GENERATION_VERIFIER_SET_V3
    : PROSE_GENERATION_VERIFIER_SET_V2
  snapshot = await writeEvent(input.scope, snapshot, 'verification.started', {
    verifierSetVersion,
  })
  const postStateHash = await prosePostStateHash({
    scope: input.scope,
    chapterId: input.candidate.chapterId,
  })
  const receipt = await Dexie.waitFor(createVerificationReceiptV1({
    version: 1,
    runId: input.runId,
    generation: snapshot.projection.generation,
    contractHash: snapshot.projection.contractHash,
    contextManifestHashes: [...new Set([
      input.candidate.durable.contextManifestHash,
      ...(input.candidate.qualityRevision ? [input.candidate.qualityRevision.recheckManifestHash] : []),
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
      {
        id: 'prose-generation.information-boundary',
        status: 'passed' as const,
        evidenceRefs: [`information-boundary:${input.candidate.informationBoundaryHash}`],
      },
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
      ...(input.candidate.qualityRevision ? [
        { id: 'quality-revision.scope', status: 'passed' as const, evidenceRefs: [`plan:${input.candidate.qualityRevision.plan.planHash}`] },
        { id: 'quality-revision.recheck', status: 'passed' as const, evidenceRefs: [`recheck:${input.candidate.qualityRevision.recheck.artifactHash}`] },
      ] : []),
      { id: 'prose-generation.adopted', status: 'passed', evidenceRefs: [`event:${adoptionRecord.id}`] },
      { id: 'prose-generation.post-state', status: 'passed', evidenceRefs: [`post-state:${postStateHash}`] },
    ],
    acceptedAt: Date.now(),
  }))
  snapshot = await writeEvent(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  return { snapshot, receiptHash: receipt.receiptHash, receipt }
}
