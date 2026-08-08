import type { ChatMessage, WorkspaceScope } from '../../types'
import type { AssembleContextResult } from '../../registry/types'
import { assembleContext } from '../../registry/assemble-context'
import { estimateTokens } from '../../ai/context-budget'
import { createAgentSkillExecutionBindingV1 } from '../execution-binding'
import { getAgentSkillV1, resolveAgentSkillContextSourceKeysV1 } from '../skill-registry'
import {
  runProseSemanticReviewCycleV1,
  type ProseSemanticReviewCycleResultV1,
} from '../prose-semantic-review'
import type { InformationBoundaryManifestV1 } from '../information-boundary'
import { validateProseInformationBoundaryV1 } from '../information-boundary'
import type { AgentTeamBudgetTracker } from '../team-budget'
import { createContextManifestFromAssemblyV1 } from './context-manifest'
import type { AgentRunSnapshotV1 } from './event-store'
import { hashCanonicalValue } from './hash'
import {
  beginProseSemanticStepV1,
  completeProseSemanticStepV1,
  failProseSemanticStepV1,
  recordProseSemanticModelOutputV1,
  PROSE_GENERATION_SOURCE_KEYS_V1,
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
  reviewerProvider: NonNullable<Parameters<typeof assembleContext>[0]['provider']>
  reviewerModel: string
  budget: AgentTeamBudgetTracker
  review: (messages: ChatMessage[]) => Promise<string>
  revise: (messages: ChatMessage[]) => Promise<string>
  onStage?: (stage: ProseSemanticHarnessStageV1) => void
  onSnapshot?: (snapshot: AgentRunSnapshotV1) => void
}): Promise<{
  snapshot: AgentRunSnapshotV1
  cycle: ProseSemanticReviewCycleResultV1
}> {
  let snapshot = input.snapshot
  let activeStep: ProseSemanticStepIdV1 | null = null
  const publish = () => input.onSnapshot?.(snapshot)
  const reviewerSkill = getAgentSkillV1('prose.review', 'prose')
  const reviewSourceKeys = resolveAgentSkillContextSourceKeysV1(reviewerSkill, {
    includeOptional: input.informationBoundary.perspectiveCharacterId != null,
  })
  const reviewAssembled = await assembleContext({
    projectId: input.projectId,
    scope: input.scope,
    chapterId: input.chapterId,
    outlineNodeId: input.outlineNodeId,
    worldGroupId: input.worldGroupId,
    sourceKeys: reviewSourceKeys,
    provider: input.reviewerProvider,
    model: input.reviewerModel,
    inputBudgetMaxTokens: 24_000,
  })
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
      PROSE_GENERATION_SOURCE_KEYS_V1,
    ),
    manifestFor(
      PROSE_SEMANTIC_REREVIEW_STEP_ID_V1,
      reviewAssembled,
      reviewSourceKeys,
    ),
  ])
  const reviewerBinding = createAgentSkillExecutionBindingV1(reviewerSkill)
  const revisionBinding = createAgentSkillExecutionBindingV1(getAgentSkillV1('prose.revise'))
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
        promptVersion: 'prose-semantic-review-v1',
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
          snapshot = await beginProseSemanticStepV1({
            scope: input.scope,
            snapshot,
            stepId: phase.stepId,
            contextManifest: phase.manifest,
            executionBinding: phase.binding,
            requestBinding: {
              phase: event.phase,
              messagesHash: await hashCanonicalValue(event.messages ?? []),
              sourceCandidateHash: await hashCanonicalValue(input.originalText),
            },
            reservedTokens: event.estimatedInputTokens + event.reservedOutputTokens,
          })
        } else {
          snapshot = await recordProseSemanticModelOutputV1({
            scope: input.scope,
            snapshot,
            stepId: phase.stepId,
            output: event.output ?? '',
            usedTokens: event.estimatedInputTokens + estimateTokens(event.output ?? ''),
          })
        }
        publish()
      },
      onReviewArtifact: async artifact => {
        snapshot = await completeProseSemanticStepV1({
          scope: input.scope,
          snapshot,
          stepId: artifact.round === 1
            ? PROSE_SEMANTIC_REVIEW_STEP_ID_V1
            : PROSE_SEMANTIC_REREVIEW_STEP_ID_V1,
          artifactHash: artifact.artifactHash,
        })
        activeStep = null
        publish()
      },
      onRevisionArtifact: async artifact => {
        snapshot = await completeProseSemanticStepV1({
          scope: input.scope,
          snapshot,
          stepId: PROSE_SEMANTIC_REVISION_STEP_ID_V1,
          artifactHash: artifact.artifactHash,
        })
        activeStep = null
        publish()
      },
    })
    return { snapshot, cycle }
  } catch (error) {
    if (activeStep) {
      snapshot = await failProseSemanticStepV1({
        scope: input.scope,
        snapshot,
        stepId: activeStep,
        code: error instanceof Error ? error.message : 'prose_semantic_review_failed',
      })
      publish()
    }
    throw error
  }
}
