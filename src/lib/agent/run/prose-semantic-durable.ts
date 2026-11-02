import type { ChatMessage, WorkspaceScope } from '../../types'
import type { AssembleContextResult } from '../../registry/types'
import { estimateTokens } from '../../ai/context-budget'
import {
  createAgentSkillExecutionBindingV1,
  createAgentSkillExecutionBindingV2,
} from '../execution-binding'
import { getAgentSkillV1, resolveAgentSkillContextSourceKeysV1 } from '../skill-registry'
import {
  PROSE_SEMANTIC_REVIEW_PROMPT_VERSION_V1,
  runProseSemanticReviewCycleV1,
  type ProseSemanticModelCallV1,
  type ProseSemanticReviewCycleResultV1,
} from '../prose-semantic-review'
import type { InformationBoundaryManifestV1 } from '../information-boundary'
import { validateProseInformationBoundaryV1 } from '../information-boundary'
import type { AgentTeamBudgetTracker } from '../team-budget'
import { createContextManifestFromAssemblyV1 } from './context-manifest'
import { readAgentRunV1, type AgentRunSnapshotV1 } from './event-store'
import { recordUnavailableCreationResponseV1 } from './creation-response-evidence'
import { hashCanonicalValue } from './hash'
import {
  beginProseSemanticStepV1,
  completeProseSemanticStepV1,
  failProseSemanticStepV1,
  recordProseSemanticModelOutputV1,
  PROSE_SEMANTIC_REVIEW_STEP_ID_V1,
  PROSE_SEMANTIC_REVISION_STEP_ID_V1,
  PROSE_SEMANTIC_REREVIEW_STEP_ID_V1,
  type ProseSemanticStepIdV1,
} from './prose-generation-durable'

export type ProseSemanticHarnessStageV1 = 'reviewing' | 'revising' | 'rereviewing'

export async function runDurableProseSemanticReviewV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  projectId: number
  worldGroupId: number | null
  chapterId: number
  outlineNodeId: number | null
  chapterTitle: string
  originalText: string
  generationMessages: readonly ChatMessage[]
  generationAssembled: AssembleContextResult
  informationBoundary: InformationBoundaryManifestV1
  generationProvider: string
  generationModel: string
  reviewerProvider: string
  reviewerModel: string
  budget: AgentTeamBudgetTracker
  review: ProseSemanticModelCallV1
  revise: ProseSemanticModelCallV1
  onStage?: (stage: ProseSemanticHarnessStageV1) => void
  onSnapshot?: (snapshot: AgentRunSnapshotV1) => void
}): Promise<{
  snapshot: AgentRunSnapshotV1
  cycle: ProseSemanticReviewCycleResultV1
}> {
  let snapshot = input.snapshot
  const scope = Object.freeze({ ...input.scope })
  const runId = snapshot.run.id
  const generation = snapshot.projection.generation
  const contractHash = snapshot.projection.contractHash
  let activeStep: ProseSemanticStepIdV1 | null = null
  let activeRequest: Awaited<ReturnType<typeof beginProseSemanticStepV1>>['request'] | null = null
  const publish = () => input.onSnapshot?.(snapshot)
  const reviewerSkill = getAgentSkillV1('prose.review', 'prose')
  const revisionSkill = getAgentSkillV1('prose.revise', 'prose')
  if (reviewerSkill.promptVersion !== PROSE_SEMANTIC_REVIEW_PROMPT_VERSION_V1) {
    throw new Error('prose.review Skill promptVersion 与语义审查协议不一致')
  }
  const optionalContextActivations: [] = []
  const reviewerBinding = input.snapshot.contract.version !== 1
    ? await createAgentSkillExecutionBindingV2(reviewerSkill, {
        optionalContextActivations,
        writeTargets: [],
      })
    : createAgentSkillExecutionBindingV1(reviewerSkill)
  const revisionBinding = input.snapshot.contract.version !== 1
    ? await createAgentSkillExecutionBindingV2(revisionSkill, {
        optionalContextActivations,
        writeTargets: [],
      })
    : createAgentSkillExecutionBindingV1(revisionSkill)
  const reviewSourceKeys = reviewerBinding.version === 2
    ? reviewerBinding.contextSourceKeys
    : resolveAgentSkillContextSourceKeysV1(reviewerSkill, {
        includeOptional: input.informationBoundary.perspectiveCharacterId != null,
      })
  const revisionSourceKeys = revisionBinding.version === 2
    ? revisionBinding.contextSourceKeys
    : resolveAgentSkillContextSourceKeysV1(revisionSkill, {
        includeOptional: input.informationBoundary.perspectiveCharacterId != null,
      })
  // PROSE-1: review and revision consume the exact Gateway assembly used by
  // generation. A reviewer may interpret it differently, but cannot rebuild a
  // narrower hand-written source list or create a second context truth.
  const reviewAssembled = input.generationAssembled
  const manifestFor = (
    stepId: ProseSemanticStepIdV1,
    assembled: AssembleContextResult,
    declaredSourceKeys: readonly string[],
  ) => createContextManifestFromAssemblyV1({
    runId: snapshot.run.id,
    stepId,
    attempt: 1,
    projectId: input.projectId,
    worldGroupId: input.worldGroupId,
    declaredSourceKeys,
    assembled,
    boundary: {
      chapterId: input.chapterId,
      ...(input.outlineNodeId == null ? {} : { outlineNodeId: input.outlineNodeId }),
    },
    readerVersion: stepId === PROSE_SEMANTIC_REVISION_STEP_ID_V1
      ? 'prose-semantic-revision-context-v1'
      : 'prose-semantic-review-context-v1',
  })
  const [initialReviewManifest, revisionManifest, finalReviewManifest] = await Promise.all([
    manifestFor(
      PROSE_SEMANTIC_REVIEW_STEP_ID_V1,
      reviewAssembled,
      reviewSourceKeys,
    ),
    manifestFor(
      PROSE_SEMANTIC_REVISION_STEP_ID_V1,
      input.generationAssembled,
      revisionSourceKeys,
    ),
    manifestFor(
      PROSE_SEMANTIC_REREVIEW_STEP_ID_V1,
      reviewAssembled,
      reviewSourceKeys,
    ),
  ])
  const phaseEvidence = {
    review: {
      stepId: PROSE_SEMANTIC_REVIEW_STEP_ID_V1,
      stage: 'reviewing' as const,
      manifest: initialReviewManifest,
      binding: reviewerBinding,
    },
    revision: {
      stepId: PROSE_SEMANTIC_REVISION_STEP_ID_V1,
      stage: 'revising' as const,
      manifest: revisionManifest,
      binding: revisionBinding,
    },
    rereview: {
      stepId: PROSE_SEMANTIC_REREVIEW_STEP_ID_V1,
      stage: 'rereviewing' as const,
      manifest: finalReviewManifest,
      binding: reviewerBinding,
    },
  } as const

  try {
    const cycle = await runProseSemanticReviewCycleV1({
      chapterTitle: input.chapterTitle,
      originalText: input.originalText,
      generationMessages: input.generationMessages,
      assembled: reviewAssembled,
      contextManifestHashes: {
        initial: initialReviewManifest.manifestHash,
        final: finalReviewManifest.manifestHash,
      },
      reviewer: {
        provider: input.reviewerProvider,
        model: input.reviewerModel,
        promptVersion: PROSE_SEMANTIC_REVIEW_PROMPT_VERSION_V1,
        executionBinding: reviewerBinding,
        correlatedJudge: input.reviewerProvider === input.generationProvider
          && input.reviewerModel === input.generationModel,
      },
      revisionExecutionBinding: revisionBinding,
      budget: input.budget,
      review: input.review,
      revise: input.revise,
      validateRevision: revised => validateProseInformationBoundaryV1(
        revised,
        input.informationBoundary,
      ),
      onCall: async event => {
        const phase = phaseEvidence[event.phase]
        if (event.state === 'requested') {
          activeStep = phase.stepId
          input.onStage?.(phase.stage)
          const prepared = await beginProseSemanticStepV1({
            scope,
            snapshot,
            stepId: phase.stepId,
            contextManifest: phase.manifest,
            executionBinding: phase.binding,
            requestBinding: {
              phase: event.phase,
              messagesHash: await hashCanonicalValue(event.messages),
              sourceCandidateHash: await hashCanonicalValue(input.originalText),
            },
            messages: event.messages,
            reservedTokens: event.estimatedInputTokens + event.reservedOutputTokens,
          })
          snapshot = prepared.snapshot
          activeRequest = prepared.request
        } else if (event.state === 'responded') {
          if (!activeRequest) throw new Error('正文语义响应缺少原始请求证据。')
          snapshot = await recordProseSemanticModelOutputV1({
            scope,
            snapshot,
            stepId: phase.stepId,
            request: activeRequest,
            output: event.output,
            result: event.result,
            // This remains the pre-existing conservative policy accounting.
            // Provider usage is separately retained only from the real result.
            usedTokens: event.estimatedInputTokens + estimateTokens(event.output),
          })
        } else {
          if (!activeRequest) throw new Error('正文语义请求失败时缺少原始请求证据。')
          const failed = await recordUnavailableCreationResponseV1({
            snapshot, request: activeRequest, result: event.result, error: event.error,
          })
          snapshot = failed.snapshot
          throw failed.report
        }
        publish()
      },
      onReviewArtifact: async artifact => {
        snapshot = await completeProseSemanticStepV1({
          scope,
          snapshot,
          stepId: artifact.round === 1
            ? PROSE_SEMANTIC_REVIEW_STEP_ID_V1
            : PROSE_SEMANTIC_REREVIEW_STEP_ID_V1,
          artifactHash: artifact.artifactHash,
        })
        activeStep = null
        activeRequest = null
        publish()
      },
      onRevisionArtifact: async artifact => {
        snapshot = await completeProseSemanticStepV1({
          scope,
          snapshot,
          stepId: PROSE_SEMANTIC_REVISION_STEP_ID_V1,
          artifactHash: artifact.artifactHash,
        })
        activeStep = null
        activeRequest = null
        publish()
      },
    })
    return { snapshot, cycle }
  } catch (error) {
    if (activeStep) {
      try {
        // A metadata/raw transaction may already have committed before a
        // sibling evidence write failed. Use its real prefix, never retry it.
        snapshot = await readAgentRunV1(scope, runId)
        if (snapshot.projection.generation !== generation || snapshot.projection.contractHash !== contractHash) {
          throw new Error('正文语义失败证据不能写入已变化的运行代际或合同。')
        }
        snapshot = await failProseSemanticStepV1({
          scope,
          snapshot,
          stepId: activeStep,
          code: error instanceof Error ? error.message : 'prose_semantic_review_failed',
        })
        publish()
      } catch (persistenceFailure) {
        throw Object.assign(new Error('正文语义步骤已停止，失败证据未能完整保存。'), {
          cause: error, persistenceFailures: [persistenceFailure],
        })
      }
    }
    throw error
  }
}
