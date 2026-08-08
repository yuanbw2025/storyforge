import type { AgentRunStepVerificationReceiptV1 } from '../../types/agent-run'
import { parseCharacterCandidateDraft } from '../character-copilot'
import {
  hasInspirationCandidateMaterialV1,
  parseInspirationCandidateDraft,
} from '../inspiration-copilot'
import { parseOutlineCandidateDraft } from '../outline-copilot'
import type { MasterCandidatePayload } from '../orchestrator'
import { parseProseCandidateDraft } from '../prose-copilot'
import type { AgentRunSnapshotV1 } from './event-store'
import { hashCanonicalValue } from './hash'
import {
  createAgentRunStepVerificationReceiptV1,
  verifyAgentRunStepVerificationReceiptIntegrityV1,
} from './verification-receipt'

export const MASTER_CANDIDATE_STEP_VERIFIER_SET_VERSION_V1 = 'master-candidate-step-v1'

function validateCandidateDraft(payload: MasterCandidatePayload, draft: string): void {
  if (payload.agentId === 'world-origin') {
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
}): Promise<AgentRunStepVerificationReceiptV1> {
  const stepId = input.payload.runStepId
  const candidateHash = input.payload.candidateHash
  if (!stepId || !candidateHash) throw new Error('主 Agent 候选缺少步骤或候选哈希。')
  validateCandidateDraft(input.payload, input.draft)
  const outputHash = await hashCanonicalValue(input.draft)
  return createAgentRunStepVerificationReceiptV1({
    version: 1,
    stepId,
    attempt: input.attempt,
    candidateHash,
    outputHash,
    contextManifestHash: input.contextManifestHash,
    verifierSetVersion: input.verifierSetVersion ?? MASTER_CANDIDATE_STEP_VERIFIER_SET_VERSION_V1,
    criteria: [
      {
        id: `${input.payload.taskId}.output-contract`,
        status: 'passed',
        evidenceRefs: [`candidate:${candidateHash}`, `output:${outputHash}`],
      },
      {
        id: `${input.payload.taskId}.context-manifest`,
        status: 'passed',
        evidenceRefs: [`context-manifest:${input.contextManifestHash}`],
      },
    ],
    acceptedAt: input.acceptedAt,
  })
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
}): Promise<AgentRunStepVerificationReceiptV1 | null> {
  const policy = input.snapshot.contract.dependencyReceiptPolicy
  if (!policy?.requiredForJoin) return null
  const accepted = acceptedReceiptEvents(input.snapshot, input)
  const event = accepted[accepted.length - 1]
  if (!event || event.type !== 'step.verification.accepted') return null
  const receipt = event.payload.receipt
  if (
    wasStaledBefore(input.snapshot, receipt.receiptHash, event.sequence)
    || !hasBoundContextManifest(input.snapshot, receipt, event.sequence)
    || input.snapshot.projection.steps[input.stepId]?.verificationReceiptHash !== receipt.receiptHash
    || receipt.verifierSetVersion !== policy.verifierSetVersion
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
}): Promise<boolean> {
  const accepted = acceptedReceiptEvents(input.snapshot, input)
  const event = accepted[accepted.length - 1]
  if (!event || event.type !== 'step.verification.accepted') return false
  const receipt = event.payload.receipt
  return receipt.outputHash === input.outputHash
    && receipt.verifierSetVersion
      === input.snapshot.contract.dependencyReceiptPolicy?.verifierSetVersion
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
