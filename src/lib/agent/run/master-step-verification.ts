import type { AgentRunStepVerificationReceiptV1 } from '../../types/agent-run'
import { parseCharacterCandidateDraft } from '../character-copilot'
import { parseCharacterDrivenCandidateDraftV1 } from '../character-driven-copilot'
import {
  hasInspirationCandidateMaterialV1,
  parseInspirationCandidateDraft,
} from '../inspiration-copilot'
import { parseOutlineCandidateDraft } from '../outline-copilot'
import type { MasterCandidatePayload } from '../orchestrator'
import { parseProseCandidateDraft } from '../prose-copilot'
import { parseStoryCoreCandidateDraft } from '../story-core-copilot'
import { parseCreativeRulesCandidateDraftV1 } from '../creative-rules-copilot'
import { parseStorylineProgressCandidateDraftV1 } from '../storyline-progress-copilot'
import { parseWorldviewFieldCandidateDraft } from '../worldview-field-copilot'
import type { AgentRunSnapshotV1 } from './event-store'
import { hashCanonicalValue } from './hash'
import {
  createAgentRunStepVerificationReceiptV1,
  verifyAgentRunStepVerificationReceiptIntegrityV1,
} from './verification-receipt'
import {
  MASTER_CANDIDATE_SEMANTIC_REVIEW_VERIFIER_SET_V1,
  type MasterCandidateModelIdentityV1,
  type MasterCandidateSemanticReviewArtifactV1,
  verifyMasterCandidateSemanticReviewArtifactV1,
} from '../master-candidate-semantic-review'

export const MASTER_CANDIDATE_STEP_VERIFIER_SET_VERSION_V1 = 'master-candidate-step-v1'

function validateCandidateDraft(payload: MasterCandidatePayload, draft: string): void {
  if (payload.agentId === 'world-origin') {
    if (payload.skillId === 'world-origin.worldview-field') {
      const candidate = parseWorldviewFieldCandidateDraft(draft)
      if (candidate.field !== payload.worldviewField) {
        throw new Error('世界基座候选字段与持久化目标不一致。')
      }
      return
    }
    if (payload.skillId === 'world-origin.story-core') {
      const candidate = parseStoryCoreCandidateDraft(draft)
      if (candidate.field !== payload.storyCoreField) {
        throw new Error('故事核心候选字段与持久化目标不一致。')
      }
      return
    }
    if (payload.skillId === 'world-origin.creative-rules') {
      const candidate = parseCreativeRulesCandidateDraftV1(draft)
      if (candidate.field !== payload.creativeRulesField) {
        throw new Error('创作规则候选字段与持久化目标不一致。')
      }
      return
    }
    if (!draft.trim()) throw new Error('世界来源候选为空。')
    return
  }
  if (payload.agentId === 'character') {
    parseCharacterCandidateDraft(draft)
    return
  }
  if (payload.agentId === 'inspiration') {
    if (!payload.mode) throw new Error('灵感反推候选缺少生成模式。')
    const parsed = parseInspirationCandidateDraft(draft, payload.mode)
    if (!hasInspirationCandidateMaterialV1(parsed, payload.mode)) {
      throw new Error('灵感反推候选未通过确定性校验：空壳候选。')
    }
    return
  }
  if (payload.agentId === 'outline') {
    if (payload.skillId === 'outline.storyline-progress') {
      parseStorylineProgressCandidateDraftV1(draft)
      return
    }
    if (payload.skillId === 'outline.character-driven') {
      parseCharacterDrivenCandidateDraftV1(draft)
      return
    }
    parseOutlineCandidateDraft(draft)
    return
  }
  parseProseCandidateDraft(draft)
}
export async function createMasterCandidateStepReceiptV1(input: {
  payload: MasterCandidatePayload
  draft: string
  attempt: number
  contextManifestHash: string
  acceptedAt: number
  verifierSetVersion?: string
  semanticReview?: MasterCandidateSemanticReviewArtifactV1
  generator?: MasterCandidateModelIdentityV1
}): Promise<AgentRunStepVerificationReceiptV1> {
  const stepId = input.payload.runStepId
  const candidateHash = input.payload.candidateHash
  if (!stepId || !candidateHash) throw new Error('主 Agent 候选缺少步骤或候选哈希。')
  validateCandidateDraft(input.payload, input.draft)
  const outputHash = await hashCanonicalValue(input.draft)
  const verifierSetVersion = input.verifierSetVersion ?? MASTER_CANDIDATE_STEP_VERIFIER_SET_VERSION_V1
  if (verifierSetVersion === MASTER_CANDIDATE_SEMANTIC_REVIEW_VERIFIER_SET_V1) {
    const semanticReview = input.semanticReview ?? input.payload.semanticReview
    const generator = input.generator ?? input.payload.generator
    if (
      !semanticReview
      || !generator
      || semanticReview.verdict !== 'pass'
      || semanticReview.taskId !== input.payload.taskId
      || semanticReview.candidateStepId !== stepId
      || semanticReview.attempt !== input.attempt
      || semanticReview.generationContextManifestHash !== input.contextManifestHash
      || !await verifyMasterCandidateSemanticReviewArtifactV1({
        artifact: semanticReview,
        candidateText: input.draft,
        generator,
      })
    ) throw new Error('主 Agent 候选缺少通过且可验证的独立语义终验 artifact。')
  }
  return createAgentRunStepVerificationReceiptV1({
    version: 1,
    stepId,
    attempt: input.attempt,
    candidateHash,
    outputHash,
    contextManifestHash: input.contextManifestHash,
    verifierSetVersion,
    criteria: [
      {
        id: `${input.payload.taskId}.output-contract`,
        status: 'passed',
        evidenceRefs: [`candidate:${candidateHash}`, `output:${outputHash}`],
      },
      ...(verifierSetVersion === MASTER_CANDIDATE_SEMANTIC_REVIEW_VERIFIER_SET_V1
        ? [{
            id: `${input.payload.taskId}.semantic-review`,
            status: 'passed' as const,
            evidenceRefs: [`semantic-review:${input.semanticReview?.artifactHash ?? input.payload.semanticReview!.artifactHash}`],
          }]
        : []),
      {
        id: `${input.payload.taskId}.context-manifest`,
        status: 'passed',
        evidenceRefs: [`context-manifest:${input.contextManifestHash}`],
      },
    ],
    acceptedAt: input.acceptedAt,
  })
}

function expectedVerifierSetVersion(
  snapshot: AgentRunSnapshotV1,
  stepId: string,
): string | null {
  const taskId = stepId.startsWith('master:') ? stepId.slice('master:'.length) : ''
  if (snapshot.contract.candidateSemanticReviewPolicy?.taskIds.includes(taskId)) {
    return snapshot.contract.candidateSemanticReviewPolicy.verifierSetVersion
  }
  return snapshot.contract.dependencyReceiptPolicy?.verifierSetVersion ?? null
}

function hasDurableSemanticReviewEvidence(input: {
  snapshot: AgentRunSnapshotV1
  artifact: MasterCandidateSemanticReviewArtifactV1
  beforeSequence?: number
}): boolean {
  const { snapshot, artifact } = input
  const before = (event: AgentRunSnapshotV1['events'][number]) => (
    input.beforeSequence === undefined || event.sequence < input.beforeSequence
  )
  const succeeded = snapshot.events.find(event => (
    event.generation === artifact.runGeneration
    && before(event)
    && event.type === 'step.succeeded'
    && event.payload.stepId === artifact.reviewStepId
    && event.payload.attempt === 1
    && event.payload.outputHash === artifact.artifactHash
  ))
  if (!succeeded) return false
  return snapshot.events.some(event => (
    event.generation === artifact.runGeneration
    && event.sequence < succeeded.sequence
    && event.type === 'context.assembled'
    && event.payload.stepId === artifact.reviewStepId
    && event.payload.attempt === 1
    && event.payload.manifestHash === artifact.reviewContextManifestHash
  )) && snapshot.events.some(event => (
    event.generation === artifact.runGeneration
    && event.sequence < succeeded.sequence
    && event.type === 'model.responded'
    && event.payload.stepId === artifact.reviewStepId
    && event.payload.attempt === 1
    && event.payload.outputHash === artifact.reviewResponseHash
  ))
}

function acceptedReceiptEvents(
  snapshot: AgentRunSnapshotV1,
  input: {
    stepId: string
    candidateHash: string
    receiptHash?: string
    generation?: number
    beforeSequence?: number
  },
) {
  return snapshot.events.filter(event => (
    event.type === 'step.verification.accepted'
    && event.generation === (input.generation ?? snapshot.projection.generation)
    && event.payload.receipt.stepId === input.stepId
    && event.payload.receipt.candidateHash === input.candidateHash
    && (input.receiptHash === undefined || event.payload.receipt.receiptHash === input.receiptHash)
    && (input.beforeSequence === undefined || event.sequence < input.beforeSequence)
  ))
}

function wasStaledBefore(
  snapshot: AgentRunSnapshotV1,
  receiptHash: string,
  acceptedSequence: number,
  beforeSequence?: number,
): boolean {
  return snapshot.events.some(event => (
    event.type === 'step.verification.staled'
    && event.sequence > acceptedSequence
    && (beforeSequence === undefined || event.sequence < beforeSequence)
    && event.payload.previousReceiptHash === receiptHash
  ))
}

function hasBoundContextManifest(
  snapshot: AgentRunSnapshotV1,
  receipt: AgentRunStepVerificationReceiptV1,
  acceptedSequence: number,
): boolean {
  return snapshot.events.some(event => (
    event.type === 'context.assembled'
    && event.sequence < acceptedSequence
    && event.payload.stepId === receipt.stepId
    && event.payload.attempt === receipt.attempt
    && event.payload.manifestHash === receipt.contextManifestHash
  ))
}

export async function readFreshMasterCandidateStepReceiptV1(input: {
  snapshot: AgentRunSnapshotV1
  stepId: string
  candidateHash: string
  outputHash?: string
  contextManifestHash?: string
  semanticReview?: MasterCandidateSemanticReviewArtifactV1
  generator?: MasterCandidateModelIdentityV1
}): Promise<AgentRunStepVerificationReceiptV1 | null> {
  const policy = input.snapshot.contract.dependencyReceiptPolicy
  if (!policy?.requiredForJoin) return null
  const accepted = acceptedReceiptEvents(input.snapshot, input)
  const event = accepted[accepted.length - 1]
  if (!event || event.type !== 'step.verification.accepted') return null
  const receipt = event.payload.receipt
  const expectedVerifier = expectedVerifierSetVersion(input.snapshot, input.stepId)
  if (!expectedVerifier) return null
  if (expectedVerifier === MASTER_CANDIDATE_SEMANTIC_REVIEW_VERIFIER_SET_V1) {
    if (
      !input.semanticReview
      || !input.generator
      || input.semanticReview.runGeneration !== input.snapshot.projection.generation
      || input.semanticReview.generationContextManifestHash !== receipt.contextManifestHash
      || !hasDurableSemanticReviewEvidence({ snapshot: input.snapshot, artifact: input.semanticReview })
      || !await verifyMasterCandidateSemanticReviewArtifactV1({
        artifact: input.semanticReview,
        generator: input.generator,
      })
    ) return null
  }
  if (
    wasStaledBefore(input.snapshot, receipt.receiptHash, event.sequence)
    || !hasBoundContextManifest(input.snapshot, receipt, event.sequence)
    || input.snapshot.projection.steps[input.stepId]?.verificationReceiptHash !== receipt.receiptHash
    || receipt.verifierSetVersion !== expectedVerifier
    || (input.outputHash !== undefined && receipt.outputHash !== input.outputHash)
    || (input.contextManifestHash !== undefined && receipt.contextManifestHash !== input.contextManifestHash)
    || !await verifyAgentRunStepVerificationReceiptIntegrityV1(receipt)
  ) return null
  return receipt
}

export async function verifyHistoricalMasterCandidateStepReceiptV1(input: {
  snapshot: AgentRunSnapshotV1
  stepId: string
  candidateHash: string
  outputHash: string
  receiptHash: string
  generation: number
  beforeSequence: number
  semanticReview?: MasterCandidateSemanticReviewArtifactV1
  generator?: MasterCandidateModelIdentityV1
}): Promise<boolean> {
  const accepted = acceptedReceiptEvents(input.snapshot, input)
  const event = accepted[accepted.length - 1]
  if (!event || event.type !== 'step.verification.accepted') return false
  const receipt = event.payload.receipt
  const expectedVerifier = expectedVerifierSetVersion(input.snapshot, input.stepId)
  if (!expectedVerifier) return false
  if (expectedVerifier === MASTER_CANDIDATE_SEMANTIC_REVIEW_VERIFIER_SET_V1) {
    if (
      !input.semanticReview
      || !input.generator
      || input.semanticReview.runGeneration !== input.generation
      || input.semanticReview.generationContextManifestHash !== receipt.contextManifestHash
      || !hasDurableSemanticReviewEvidence({
        snapshot: input.snapshot,
        artifact: input.semanticReview,
        beforeSequence: input.beforeSequence,
      })
      || !await verifyMasterCandidateSemanticReviewArtifactV1({
        artifact: input.semanticReview,
        generator: input.generator,
      })
    ) return false
  }
  return receipt.outputHash === input.outputHash
    && receipt.verifierSetVersion
      === expectedVerifier
    && hasBoundContextManifest(input.snapshot, receipt, event.sequence)
    && !wasStaledBefore(input.snapshot, receipt.receiptHash, event.sequence, input.beforeSequence)
    && await verifyAgentRunStepVerificationReceiptIntegrityV1(receipt)
}

export function contextManifestHashForStepAttemptV1(
  snapshot: AgentRunSnapshotV1,
  stepId: string,
  attempt: number,
): string | null {
  const event = [...snapshot.events].reverse().find(item => (
    item.type === 'context.assembled'
    && item.payload.stepId === stepId
    && item.payload.attempt === attempt
  ))
  return event?.type === 'context.assembled' ? event.payload.manifestHash : null
}
